import { Prisma } from "@prisma/client";
import type { Route } from "next";

import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { redactSensitiveText } from "@/lib/security/redaction";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

import type { AssistantDraftAction } from "./assistant-draft-action-service";

export type AssistantConversationMemoryReference = {
  entityType: AssistantConversationReferenceEntityType;
  href?: Route;
  label: string;
  ordinal?: number;
  reason?: string;
  recordId: string;
  role: AssistantConversationReferenceRole;
  snapshot?: Record<string, unknown>;
  staleStatus: AssistantConversationReferenceStaleStatus;
};

export type AssistantConversationMemoryView = {
  contextWindow: AssistantConversationContextWindow;
  references: AssistantConversationMemoryReference[];
  summary: AssistantConversationSummary;
};

export type AssistantConversationReferenceResolution = {
  notice: string;
  reference: AssistantConversationMemoryReference;
  status: "current" | "deleted" | "stale";
};

export type AssistantConversationPreparedContext = {
  memory: AssistantConversationMemoryView;
  notices: string[];
  resolvedReference: AssistantConversationReferenceResolution | null;
  rewrittenMessage: string;
};

type AssistantConversationReferenceEntityType =
  | "activity"
  | "deal"
  | "email"
  | "lead"
  | "meeting_intake"
  | "note"
  | "organization"
  | "person"
  | "product"
  | "quote"
  | "report"
  | "saved_view";

type AssistantConversationReferenceRole =
  | "current_deal"
  | "pending_action_target"
  | "primary_subject"
  | "referenced"
  | "related_contact"
  | "related_organization"
  | "selected_result"
  | "source_email"
  | "source_meeting";

type AssistantConversationReferenceStaleStatus = "CURRENT" | "DELETED" | "STALE" | "SUPERSEDED" | "UNKNOWN";

type AssistantConversationSourceLike = {
  detail: string;
  href?: Route;
  label: string;
  recordType: string;
};

type AssistantConversationMessageLike = {
  content: string;
  createdAt: string;
  id: string;
  role: "assistant" | "user";
  title: string | null;
};

type AssistantConversationStoredMessageLike = {
  content: string;
  createdAt: Date;
  id: string;
  role: string;
  title: string | null;
};

type AssistantConversationSummary = {
  activeSubject: AssistantConversationSummaryReference | null;
  completedActions: AssistantConversationActionMemory[];
  confirmedFacts: string[];
  decisions: string[];
  pendingActions: AssistantConversationActionMemory[];
  recentResultSets: AssistantConversationResultSetMemory[];
  unresolvedQuestions: string[];
  userCorrections: AssistantConversationCorrectionMemory[];
  userGoals: string[];
};

type AssistantConversationSummaryReference = {
  entityType: AssistantConversationReferenceEntityType;
  href?: string;
  label: string;
  recordId: string;
  role: AssistantConversationReferenceRole;
};

type AssistantConversationActionMemory = {
  id: string;
  kind: string;
  status: "applied" | "drafted" | "pending_review" | "rejected" | "unknown";
  targetLabel: string;
  title: string;
};

type AssistantConversationCorrectionMemory = {
  createdAt: string;
  messageId: string;
  text: string;
};

type AssistantConversationResultSetMemory = {
  createdAt: string;
  entityType: AssistantConversationReferenceEntityType | "mixed";
  items: Array<{
    entityType: AssistantConversationReferenceEntityType;
    href?: string;
    label: string;
    ordinal: number;
    reason?: string;
    recordId: string;
  }>;
  key: string;
  messageId: string;
  title: string;
};

type AssistantConversationContextWindow = {
  limits: {
    maxCrmReferences: number;
    maxRecentMessages: number;
    maxResultSets: number;
    maxSummaryFacts: number;
    maxSummaryTextChars: number;
  };
  selectedReferenceCount: number;
  selectedResultSetCount: number;
  strategy: string;
};

type ReferenceUpsertInput = {
  entityType: AssistantConversationReferenceEntityType;
  href?: string;
  label: string;
  ordinal?: number;
  reason?: string;
  recordId: string;
  resultSetKey?: string;
  role: AssistantConversationReferenceRole;
  snapshot?: Prisma.InputJsonValue;
};

type VerifiedReference = {
  href?: string;
  label: string;
  snapshot?: Prisma.InputJsonValue;
  status: AssistantConversationReferenceStaleStatus;
  warning?: string;
};

export const assistantConversationMemoryLimits = {
  maxCrmReferences: 12,
  maxRecentMessages: 12,
  maxResultSets: 5,
  maxSummaryFacts: 8,
  maxSummaryTextChars: 2_400
} as const;

const resultSetKeyPrefix = "message:";

export async function getAssistantConversationMemory(
  actor: WorkspaceActor,
  conversationIdInput: unknown
): Promise<AssistantConversationMemoryView | null> {
  await ensureWorkspaceAccess(actor);
  const conversationId = normalizeId(conversationIdInput);
  if (!conversationId) return null;
  const memory = await prisma.assistantConversationMemory.findFirst({
    where: { conversationId, workspaceId: actor.workspaceId }
  });
  if (!memory) return null;
  const references = await prisma.assistantConversationReference.findMany({
    orderBy: [{ updatedAt: "desc" }],
    take: assistantConversationMemoryLimits.maxCrmReferences,
    where: { conversationId, workspaceId: actor.workspaceId, staleStatus: { not: "SUPERSEDED" } }
  });
  return {
    contextWindow: parseContextWindow(memory.contextWindow),
    references: references.map((reference) => ({
      entityType: entityType(reference.entityType),
      href: safeHref(reference.href),
      label: safeText(reference.label, 160),
      ordinal: reference.ordinal ?? undefined,
      reason: safeText(reference.reason, 180) || undefined,
      recordId: reference.recordId,
      role: referenceRole(reference.role),
      snapshot: parseSnapshot(reference.snapshot),
      staleStatus: staleStatus(reference.staleStatus)
    })),
    summary: parseSummary(memory.summary)
  };
}

export async function prepareAssistantConversationMemoryContext(
  actor: WorkspaceActor,
  input: {
    conversationId: string;
    history: AssistantConversationMessageLike[];
    message: string;
    now: Date;
  }
): Promise<AssistantConversationPreparedContext> {
  await ensureWorkspaceAccess(actor);
  const memory = await getOrBuildAssistantConversationMemory(actor, input.conversationId, input.history);
  const resolved = await resolveConversationalReference(actor, input.conversationId, input.message, memory.summary, input.now);
  const notices = resolved ? [resolved.notice] : [];
  return {
    memory,
    notices,
    resolvedReference: resolved,
    rewrittenMessage: resolved?.status === "deleted" ? input.message : rewriteMessageWithReference(input.message, resolved?.reference ?? null)
  };
}

export async function updateAssistantConversationMemory(
  actor: WorkspaceActor,
  input: {
    assistantMessage: { createdAt: Date; id: string; title: string | null };
    draftActions: AssistantDraftAction[];
    sources: AssistantConversationSourceLike[];
    supersededAssistantMessageId?: string | null;
    userMessage: { content: string; createdAt: Date; id: string };
  }
): Promise<AssistantConversationMemoryView> {
  await ensureWorkspaceAccess(actor);
  const conversationId = await conversationIdForMessage(actor, input.assistantMessage.id);
  if (!conversationId) throw new Error("Assistant conversation message was not found for memory update.");
  if (input.supersededAssistantMessageId) {
    await prisma.assistantConversationReference.updateMany({
      data: { staleStatus: "SUPERSEDED" },
      where: {
        conversationId,
        resultSetKey: resultSetKey(input.supersededAssistantMessageId),
        workspaceId: actor.workspaceId
      }
    });
  }

  const existing = await getOrBuildAssistantConversationMemory(actor, conversationId, []);
  const sourceReferences = referencesFromSources(input.sources);
  const draftReferences = referencesFromDraftActions(input.draftActions);
  const resultSetReferences = sourceReferences.map((reference, index) => ({
    ...reference,
    ordinal: index + 1,
    reason: reference.reason ?? input.assistantMessage.title ?? "Assistant result",
    resultSetKey: resultSetKey(input.assistantMessage.id),
    role: "selected_result" as const
  }));
  const conversationReferences = dedupeReferences([
    ...sourceReferences.map((reference, index) => ({
      ...reference,
      ordinal: index + 1,
      reason: reference.reason ?? input.assistantMessage.title ?? "Assistant referenced this record",
      role: index === 0 && isPrimarySubjectEntity(reference.entityType) ? primaryRole(reference.entityType) : "referenced" as const
    })),
    ...draftReferences
  ]);

  await Promise.all([
    ...resultSetReferences.map((reference) => upsertConversationReference(actor, conversationId, input.assistantMessage.id, input.userMessage.id, reference, input.assistantMessage.createdAt)),
    ...conversationReferences.map((reference) => upsertConversationReference(actor, conversationId, input.assistantMessage.id, input.userMessage.id, reference, input.assistantMessage.createdAt))
  ]);

  const summary = updateSummary(existing.summary, {
    assistantMessage: input.assistantMessage,
    draftActions: input.draftActions,
    references: conversationReferences,
    resultSetReferences,
    supersededAssistantMessageId: input.supersededAssistantMessageId ?? null,
    userMessage: input.userMessage
  });
  const contextWindow = buildContextWindow(conversationReferences.length, summary.recentResultSets.length);

  await prisma.assistantConversationMemory.upsert({
    create: {
      contextWindow: contextWindow as unknown as Prisma.InputJsonValue,
      conversationId,
      summary: summary as unknown as Prisma.InputJsonValue,
      updatedFromMessageId: input.assistantMessage.id,
      workspaceId: actor.workspaceId
    },
    update: {
      contextWindow: contextWindow as unknown as Prisma.InputJsonValue,
      summary: summary as unknown as Prisma.InputJsonValue,
      updatedFromMessageId: input.assistantMessage.id
    },
    where: { conversationId }
  });
  const updated = await getAssistantConversationMemory(actor, conversationId);
  if (!updated) throw new Error("Assistant conversation memory could not be loaded.");
  return updated;
}

export async function rebuildAssistantConversationMemory(
  actor: WorkspaceActor,
  conversationIdInput: unknown
): Promise<AssistantConversationMemoryView> {
  await ensureWorkspaceAccess(actor);
  const conversationId = normalizeId(conversationIdInput);
  if (!conversationId) throw new Error("Assistant conversation was not found.");
  const conversation = await prisma.assistantConversation.findFirst({
    include: { messages: { orderBy: { createdAt: "asc" } } },
    where: { id: conversationId, userId: actor.actorUserId, workspaceId: actor.workspaceId }
  });
  if (!conversation) throw new Error("Assistant conversation was not found.");
  await prisma.assistantConversationReference.deleteMany({ where: { conversationId, workspaceId: actor.workspaceId } });
  await prisma.assistantConversationMemory.deleteMany({ where: { conversationId, workspaceId: actor.workspaceId } });
  let summary = emptySummary();
  for (let index = 0; index < conversation.messages.length; index += 1) {
    const message = conversation.messages[index];
    if (!message || message.role !== "assistant") continue;
    const user = previousStoredUserMessage(conversation.messages, index);
    if (!user) continue;
    const sourceReferences = referencesFromSources(parseStoredSources(message.sources));
    const resultSetReferences = sourceReferences.map((reference, sourceIndex) => ({
      ...reference,
      ordinal: sourceIndex + 1,
      reason: reference.reason ?? message.title ?? "Assistant result",
      resultSetKey: resultSetKey(message.id),
      role: "selected_result" as const
    }));
    const conversationReferences = dedupeReferences(sourceReferences.map((reference, sourceIndex) => ({
      ...reference,
      ordinal: sourceIndex + 1,
      reason: reference.reason ?? message.title ?? "Assistant referenced this record",
      role: sourceIndex === 0 && isPrimarySubjectEntity(reference.entityType) ? primaryRole(reference.entityType) : "referenced" as const
    })));
    await Promise.all([
      ...resultSetReferences.map((reference) => upsertConversationReference(actor, conversationId, message.id, user.id, reference, message.createdAt)),
      ...conversationReferences.map((reference) => upsertConversationReference(actor, conversationId, message.id, user.id, reference, message.createdAt))
    ]);
    summary = updateSummary(summary, {
      assistantMessage: message,
      draftActions: parseStoredDraftActions(message.draftActions),
      references: conversationReferences,
      resultSetReferences,
      userMessage: user
    });
  }
  const contextWindow = buildContextWindow(summary.activeSubject ? 1 : 0, summary.recentResultSets.length);
  await prisma.assistantConversationMemory.create({
    data: {
      contextWindow: contextWindow as unknown as Prisma.InputJsonValue,
      conversationId,
      lastRebuiltAt: new Date(),
      summary: summary as unknown as Prisma.InputJsonValue,
      updatedFromMessageId: conversation.messages.at(-1)?.id ?? null,
      workspaceId: actor.workspaceId
    }
  });
  const memory = await getAssistantConversationMemory(actor, conversationId);
  if (!memory) throw new Error("Assistant conversation memory could not be rebuilt.");
  return memory;
}

export async function verifyAssistantConversationReference(
  actor: WorkspaceActor,
  reference: AssistantConversationMemoryReference,
  now = new Date()
): Promise<AssistantConversationReferenceResolution> {
  await ensureWorkspaceAccess(actor);
  const verified = await verifyReference(actor, reference);
  return {
    notice: referenceNotice(reference, verified),
    reference: {
      ...reference,
      href: safeHref(verified.href) ?? reference.href,
      label: verified.label || reference.label,
      staleStatus: verified.status
    },
    status: verified.status === "DELETED" ? "deleted" : verified.status === "STALE" ? "stale" : "current"
  };
}

async function getOrBuildAssistantConversationMemory(
  actor: WorkspaceActor,
  conversationId: string,
  history: AssistantConversationMessageLike[]
) {
  const existing = await getAssistantConversationMemory(actor, conversationId);
  if (existing) return existing;
  const contextWindow = buildContextWindow(0, 0);
  const summary = history.length > 0 ? summaryFromRecentMessages(history) : emptySummary();
  await prisma.assistantConversationMemory.upsert({
    create: {
      contextWindow: contextWindow as unknown as Prisma.InputJsonValue,
      conversationId,
      summary: summary as unknown as Prisma.InputJsonValue,
      workspaceId: actor.workspaceId
    },
    update: {},
    where: { conversationId }
  });
  const memory = await getAssistantConversationMemory(actor, conversationId);
  if (!memory) throw new Error("Assistant conversation memory could not be initialized.");
  return memory;
}

async function resolveConversationalReference(
  actor: WorkspaceActor,
  conversationId: string,
  message: string,
  summary: AssistantConversationSummary,
  now: Date
): Promise<AssistantConversationReferenceResolution | null> {
  const ordinal = referencedOrdinal(message);
  const implied = impliedEntityType(message);
  let candidate: AssistantConversationMemoryReference | null = null;

  if (ordinal) {
    const resultSet = [...summary.recentResultSets]
      .reverse()
      .find((set) => set.items.some((item) => item.ordinal === ordinal && (!implied || compatibleEntity(implied, item.entityType))));
    const item = resultSet?.items.find((entry) => entry.ordinal === ordinal && (!implied || compatibleEntity(implied, entry.entityType)));
    if (item) {
      candidate = {
        entityType: item.entityType,
        href: safeHref(item.href),
        label: item.label,
        ordinal: item.ordinal,
        reason: resultSet?.title,
        recordId: item.recordId,
        role: "selected_result",
        snapshot: await latestReferenceSnapshot(actor, conversationId, {
          entityType: item.entityType,
          href: item.href,
          label: item.label,
          recordId: item.recordId,
          role: "selected_result"
        }),
        staleStatus: "CURRENT"
      };
    }
  }

  if (!candidate && refersToRememberedSubject(message)) {
    candidate = summary.activeSubject
      ? {
          entityType: summary.activeSubject.entityType,
          href: safeHref(summary.activeSubject.href),
          label: summary.activeSubject.label,
          recordId: summary.activeSubject.recordId,
          role: summary.activeSubject.role,
          snapshot: await latestReferenceSnapshot(actor, conversationId, summary.activeSubject),
          staleStatus: "CURRENT"
        }
      : null;
  }

  if (!candidate && implied) {
    const reference = await prisma.assistantConversationReference.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        conversationId,
        entityType: implied,
        staleStatus: { not: "SUPERSEDED" },
        workspaceId: actor.workspaceId
      }
    });
    if (reference) {
      candidate = {
        entityType: entityType(reference.entityType),
        href: safeHref(reference.href),
        label: reference.label,
        recordId: reference.recordId,
        role: referenceRole(reference.role),
        snapshot: parseSnapshot(reference.snapshot),
        staleStatus: staleStatus(reference.staleStatus)
      };
    }
  }

  if (!candidate) return null;
  const verified = await verifyAssistantConversationReference(actor, candidate, now);
  await prisma.assistantConversationReference.updateMany({
    data: {
      href: verified.reference.href,
      label: verified.reference.label,
      lastVerifiedAt: now,
      staleStatus: verified.reference.staleStatus
    },
    where: {
      conversationId,
      entityType: candidate.entityType,
      recordId: candidate.recordId,
      workspaceId: actor.workspaceId
    }
  });
  return verified;
}

function rewriteMessageWithReference(message: string, reference: AssistantConversationMemoryReference | null) {
  if (!reference) return message;
  if (reference.entityType === "deal") {
    const target = `/deals/${reference.recordId}`;
    if (/\/deals\/[A-Za-z0-9_-]{8,80}/.test(message)) return message;
    if (/\b(main contact|stakeholder|relationship risk)\b/i.test(message)) return `Show the important stakeholders and relationship risks for this deal ${target}. ${message}`;
    if (/\b(follow up|follow-up|activity|task|remind)\b/i.test(message)) return `Create a reviewed next-step activity for this deal ${target}. ${message}`;
    if (/\b(note|current situation)\b/i.test(message)) return `Draft a concise CRM note summarizing this deal ${target}. ${message}`;
    if (/\b(changed|latest|before i call|since)\b/i.test(message)) return `Give me the latest deal update for this deal ${target}. ${message}`;
    if (/\b(block|risk|next|summarize|summary|tell me more|what should)\b/i.test(message)) return `Summarize this deal ${target}. ${message}`;
  }
  if (reference.entityType === "person" && /\b(them|their|that contact|this contact|person we discussed|same contact)\b/i.test(message)) {
    return `${message} ${reference.label}`;
  }
  if (reference.entityType === "organization" && /\b(account|organization|company|them|their)\b/i.test(message)) {
    return `${message} ${reference.label}`;
  }
  return message;
}

function updateSummary(
  existing: AssistantConversationSummary,
  input: {
    assistantMessage: { createdAt: Date; id: string; title: string | null };
    draftActions: AssistantDraftAction[];
    references: ReferenceUpsertInput[];
    resultSetReferences: ReferenceUpsertInput[];
    supersededAssistantMessageId?: string | null;
    userMessage: { content: string; createdAt: Date; id: string };
  }
): AssistantConversationSummary {
  const primary = input.references.find((reference) => reference.role !== "referenced") ?? input.references[0];
  const resultItems = input.resultSetReferences
    .filter((reference) => typeof reference.ordinal === "number")
    .map((reference) => ({
      entityType: reference.entityType,
      href: reference.href,
      label: reference.label,
      ordinal: reference.ordinal ?? 0,
      reason: reference.reason,
      recordId: reference.recordId
    }))
    .slice(0, assistantConversationMemoryLimits.maxCrmReferences);
  const newResultSet = resultItems.length > 0
    ? [{
        createdAt: input.assistantMessage.createdAt.toISOString(),
        entityType: new Set(resultItems.map((item) => item.entityType)).size === 1 ? resultItems[0]?.entityType ?? "mixed" : "mixed",
        items: resultItems,
        key: resultSetKey(input.assistantMessage.id),
        messageId: input.assistantMessage.id,
        title: safeText(input.assistantMessage.title, 140) || "Assistant results"
      } satisfies AssistantConversationResultSetMemory]
    : [];
  const corrections = extractUserCorrections(input.userMessage.content).map((text) => ({
    createdAt: input.userMessage.createdAt.toISOString(),
    messageId: input.userMessage.id,
    text
  }));
  const retainedResultSets = input.supersededAssistantMessageId
    ? existing.recentResultSets.filter((set) => set.messageId !== input.supersededAssistantMessageId)
    : existing.recentResultSets;
  return {
    activeSubject: primary ? {
      entityType: primary.entityType,
      href: primary.href,
      label: primary.label,
      recordId: primary.recordId,
      role: primary.role
    } : existing.activeSubject,
    completedActions: existing.completedActions.slice(-8),
    confirmedFacts: boundedStrings([
      ...existing.confirmedFacts,
      ...input.references.slice(0, 3).map((reference) => `Referenced ${reference.entityType}: ${reference.label}`)
    ], assistantConversationMemoryLimits.maxSummaryFacts, 220),
    decisions: boundedStrings(existing.decisions, 8, 220),
    pendingActions: boundedActions([
      ...existing.pendingActions,
      ...input.draftActions.map((draft): AssistantConversationActionMemory => ({
        id: draft.id,
        kind: draft.kind,
        status: "drafted",
        targetLabel: safeText(draft.targetLabel, 160),
        title: safeText(draft.title, 160)
      }))
    ]),
    recentResultSets: [...retainedResultSets, ...newResultSet].slice(-assistantConversationMemoryLimits.maxResultSets),
    unresolvedQuestions: boundedStrings(existing.unresolvedQuestions, 8, 220),
    userCorrections: [...existing.userCorrections, ...corrections].slice(-10),
    userGoals: boundedStrings([...existing.userGoals, userGoal(input.userMessage.content)].filter(Boolean), 8, 220)
  };
}

function referencesFromSources(sources: AssistantConversationSourceLike[]) {
  return dedupeReferences(sources.flatMap((source) => {
    const parsed = referenceFromHref(source.href, source.recordType);
    if (!parsed) return [];
    return [{
      entityType: parsed.entityType,
      href: source.href,
      label: safeText(source.label, 160) || parsed.recordId,
      recordId: parsed.recordId,
      reason: safeText(source.detail, 180) || source.recordType,
      role: parsed.entityType === "email" ? "source_email" as const : "referenced" as const
    }];
  }));
}

function referencesFromDraftActions(drafts: AssistantDraftAction[]) {
  return dedupeReferences(drafts.flatMap((draft) => {
    const parsed = referenceFromHref(draft.targetHref as Route | undefined, draft.targetKind);
    if (!parsed) return [];
    return [{
      entityType: parsed.entityType,
      href: draft.targetHref,
      label: safeText(draft.targetLabel, 160) || parsed.recordId,
      recordId: parsed.recordId,
      reason: draft.title,
      role: "pending_action_target" as const
    }];
  }));
}

function referenceFromHref(href: string | undefined, recordType: string): { entityType: AssistantConversationReferenceEntityType; recordId: string } | null {
  const quote = href?.match(/\/deals\/[A-Za-z0-9_-]{8,80}\/quotes\/([A-Za-z0-9_-]{8,80})/);
  if (quote?.[1]) return { entityType: "quote", recordId: quote[1] };
  const mappings: Array<[RegExp, AssistantConversationReferenceEntityType]> = [
    [/\/contacts\/([A-Za-z0-9_-]{8,80})/, "person"],
    [/\/organizations\/([A-Za-z0-9_-]{8,80})/, "organization"],
    [/\/deals\/([A-Za-z0-9_-]{8,80})/, "deal"],
    [/\/leads\/([A-Za-z0-9_-]{8,80})/, "lead"],
    [/\/activities\/([A-Za-z0-9_-]{8,80})/, "activity"],
    [/email#email-card-([A-Za-z0-9_-]{8,80})/, "email"]
  ];
  for (const [pattern, type] of mappings) {
    const match = href?.match(pattern);
    if (match?.[1]) return { entityType: type, recordId: match[1] };
  }
  const normalized = recordType.toLowerCase();
  if (normalized.includes("contact")) return null;
  return null;
}

async function upsertConversationReference(
  actor: WorkspaceActor,
  conversationId: string,
  assistantMessageId: string,
  userMessageId: string,
  reference: ReferenceUpsertInput,
  now: Date
) {
  const verified = await verifyReference(actor, {
    entityType: reference.entityType,
    label: reference.label,
    recordId: reference.recordId
  });
  await prisma.assistantConversationReference.upsert({
    create: {
      conversationId,
      entityType: reference.entityType,
      firstMessageId: userMessageId,
      href: verified.href ?? reference.href,
      label: verified.label || reference.label,
      lastMessageId: assistantMessageId,
      lastVerifiedAt: now,
      ordinal: reference.ordinal,
      reason: safeText(reference.reason, 220),
      recordId: reference.recordId,
      resultSetKey: reference.resultSetKey ?? "conversation",
      role: reference.role,
      snapshot: verified.snapshot ?? reference.snapshot ?? Prisma.JsonNull,
      staleStatus: verified.status,
      workspaceId: actor.workspaceId
    },
    update: {
      href: verified.href ?? reference.href,
      label: verified.label || reference.label,
      lastMessageId: assistantMessageId,
      lastVerifiedAt: now,
      ordinal: reference.ordinal,
      reason: safeText(reference.reason, 220),
      snapshot: verified.snapshot ?? reference.snapshot ?? Prisma.JsonNull,
      staleStatus: verified.status
    },
    where: {
      workspaceId_conversationId_entityType_recordId_role_resultSetKey: {
        conversationId,
        entityType: reference.entityType,
        recordId: reference.recordId,
        resultSetKey: reference.resultSetKey ?? "conversation",
        role: reference.role,
        workspaceId: actor.workspaceId
      }
    }
  });
}

async function verifyReference(actor: WorkspaceActor, reference: Pick<AssistantConversationMemoryReference, "entityType" | "label" | "recordId" | "snapshot">): Promise<VerifiedReference> {
  if (reference.entityType === "deal") {
    const deal = await prisma.deal.findFirst({
      select: { id: true, status: true, title: true, updatedAt: true },
      where: { id: reference.recordId, workspaceId: actor.workspaceId, ...activeWhere }
    });
    if (!deal) return { label: reference.label, status: "DELETED", warning: "The remembered deal is no longer available in this workspace." };
    return {
      href: `/deals/${deal.id}`,
      label: safeText(deal.title, 160),
      snapshot: { status: deal.status, title: deal.title, updatedAt: deal.updatedAt.toISOString() },
      status: snapshotChanged(reference.snapshot, { status: deal.status }) ? "STALE" : "CURRENT"
    };
  }
  if (reference.entityType === "person") {
    const person = await prisma.person.findFirst({
      select: { email: true, firstName: true, id: true, lastName: true, title: true, updatedAt: true },
      where: { id: reference.recordId, workspaceId: actor.workspaceId, ...activeWhere }
    });
    if (!person) return { label: reference.label, status: "DELETED", warning: "The remembered contact is no longer available in this workspace." };
    return {
      href: `/contacts/${person.id}`,
      label: safeText(formatPersonName(person) ?? person.email ?? "Unnamed contact", 160),
      snapshot: { email: person.email, title: person.title, updatedAt: person.updatedAt.toISOString() },
      status: snapshotChanged(reference.snapshot, { email: person.email, title: person.title }) ? "STALE" : "CURRENT"
    };
  }
  if (reference.entityType === "organization") {
    const organization = await prisma.organization.findFirst({
      select: { domain: true, id: true, name: true, updatedAt: true },
      where: { id: reference.recordId, workspaceId: actor.workspaceId, ...activeWhere }
    });
    if (!organization) return { label: reference.label, status: "DELETED", warning: "The remembered organization is no longer available in this workspace." };
    return {
      href: `/organizations/${organization.id}`,
      label: safeText(organization.name, 160),
      snapshot: { domain: organization.domain, name: organization.name, updatedAt: organization.updatedAt.toISOString() },
      status: snapshotChanged(reference.snapshot, { domain: organization.domain, name: organization.name }) ? "STALE" : "CURRENT"
    };
  }
  if (reference.entityType === "lead") {
    const lead = await prisma.lead.findFirst({
      select: { id: true, status: true, title: true, updatedAt: true },
      where: { id: reference.recordId, workspaceId: actor.workspaceId, ...activeWhere }
    });
    if (!lead) return { label: reference.label, status: "DELETED", warning: "The remembered lead is no longer available in this workspace." };
    return {
      href: `/leads/${lead.id}`,
      label: safeText(lead.title, 160),
      snapshot: { status: lead.status, updatedAt: lead.updatedAt.toISOString() },
      status: snapshotChanged(reference.snapshot, { status: lead.status }) ? "STALE" : "CURRENT"
    };
  }
  if (reference.entityType === "activity") {
    const activity = await prisma.activity.findFirst({
      select: { completedAt: true, dueAt: true, id: true, title: true, updatedAt: true },
      where: { id: reference.recordId, workspaceId: actor.workspaceId, ...activeWhere }
    });
    if (!activity) return { label: reference.label, status: "DELETED", warning: "The remembered activity is no longer available in this workspace." };
    return {
      href: `/activities/${activity.id}/edit`,
      label: safeText(activity.title, 160),
      snapshot: {
        completedAt: activity.completedAt?.toISOString() ?? null,
        dueAt: activity.dueAt?.toISOString() ?? null,
        updatedAt: activity.updatedAt.toISOString()
      },
      status: snapshotChanged(reference.snapshot, { completedAt: activity.completedAt?.toISOString() ?? null, dueAt: activity.dueAt?.toISOString() ?? null }) ? "STALE" : "CURRENT"
    };
  }
  if (reference.entityType === "quote") {
    const quote = await prisma.quote.findFirst({
      select: { dealId: true, id: true, number: true, status: true, updatedAt: true },
      where: { id: reference.recordId, workspaceId: actor.workspaceId }
    });
    if (!quote) return { label: reference.label, status: "DELETED", warning: "The remembered quote is no longer available in this workspace." };
    return {
      href: `/deals/${quote.dealId}/quotes/${quote.id}`,
      label: safeText(`Quote ${quote.number}`, 160),
      snapshot: { status: quote.status, updatedAt: quote.updatedAt.toISOString() },
      status: snapshotChanged(reference.snapshot, { status: quote.status }) ? "STALE" : "CURRENT"
    };
  }
  if (reference.entityType === "email") {
    const email = await prisma.emailLog.findFirst({
      select: { id: true, occurredAt: true, subject: true, updatedAt: true },
      where: { id: reference.recordId, workspaceId: actor.workspaceId }
    });
    if (!email) return { label: reference.label, status: "DELETED", warning: "The remembered email is no longer available in this workspace." };
    return {
      href: `/email#email-card-${email.id}`,
      label: safeText(email.subject, 160),
      snapshot: { occurredAt: email.occurredAt.toISOString(), updatedAt: email.updatedAt.toISOString() },
      status: "CURRENT"
    };
  }
  return { label: reference.label, status: "UNKNOWN" };
}

function referenceNotice(reference: AssistantConversationMemoryReference, verified: VerifiedReference) {
  if (verified.status === "DELETED") {
    return `The remembered ${entityLabel(reference.entityType)} “${reference.label}” is no longer available in this workspace, so I did not redirect the request to another record.`;
  }
  if (verified.status === "STALE") {
    return `I rechecked the remembered ${entityLabel(reference.entityType)} “${reference.label}” before answering because remembered context is only a pointer to current CRM data.`;
  }
  return `Using remembered context: “${reference.label}” is the ${entityLabel(reference.entityType)} from this conversation. I rechecked current CRM access before using it.`;
}

async function conversationIdForMessage(actor: WorkspaceActor, messageId: string) {
  const message = await prisma.assistantConversationMessage.findFirst({
    select: { conversationId: true },
    where: { id: messageId, workspaceId: actor.workspaceId }
  });
  return message?.conversationId ?? null;
}

async function latestReferenceSnapshot(
  actor: WorkspaceActor,
  conversationId: string,
  reference: AssistantConversationSummaryReference
) {
  const stored = await prisma.assistantConversationReference.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { snapshot: true },
    where: {
      conversationId,
      entityType: reference.entityType,
      recordId: reference.recordId,
      staleStatus: { not: "SUPERSEDED" },
      workspaceId: actor.workspaceId
    }
  });
  return parseSnapshot(stored?.snapshot ?? null);
}

function parseSnapshot(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function snapshotChanged(previous: Record<string, unknown> | undefined, current: Record<string, unknown>) {
  if (!previous) return false;
  return Object.entries(current).some(([key, value]) => {
    if (!(key in previous)) return false;
    return comparableSnapshotValue(previous[key]) !== comparableSnapshotValue(value);
  });
}

function comparableSnapshotValue(value: unknown) {
  return value == null ? "" : String(value).trim().toLowerCase();
}

function parseSummary(value: Prisma.JsonValue): AssistantConversationSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptySummary();
  const record = value as Record<string, unknown>;
  return {
    activeSubject: parseSummaryReference(record.activeSubject),
    completedActions: parseActions(record.completedActions),
    confirmedFacts: parseStringArray(record.confirmedFacts, assistantConversationMemoryLimits.maxSummaryFacts, 220),
    decisions: parseStringArray(record.decisions, 8, 220),
    pendingActions: parseActions(record.pendingActions),
    recentResultSets: parseResultSets(record.recentResultSets),
    unresolvedQuestions: parseStringArray(record.unresolvedQuestions, 8, 220),
    userCorrections: parseCorrections(record.userCorrections),
    userGoals: parseStringArray(record.userGoals, 8, 220)
  };
}

function parseStringArray(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringField(item, maxLength)).filter(Boolean).slice(-limit);
}

function parseSummaryReference(value: unknown): AssistantConversationSummaryReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const recordId = stringField(record.recordId, 160);
  const label = stringField(record.label, 160);
  if (!recordId || !label) return null;
  return {
    entityType: entityType(record.entityType),
    href: stringField(record.href, 240) || undefined,
    label,
    recordId,
    role: referenceRole(record.role)
  };
}

function parseResultSets(value: unknown): AssistantConversationResultSetMemory[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const items = Array.isArray(record.items)
      ? record.items.flatMap((raw) => {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
          const entry = raw as Record<string, unknown>;
          const recordId = stringField(entry.recordId, 160);
          const label = stringField(entry.label, 160);
          const ordinal = typeof entry.ordinal === "number" ? entry.ordinal : 0;
          if (!recordId || !label || ordinal < 1) return [];
          return [{
            entityType: entityType(entry.entityType),
            href: stringField(entry.href, 240) || undefined,
            label,
            ordinal,
            reason: stringField(entry.reason, 180) || undefined,
            recordId
          }];
        })
      : [];
    if (items.length === 0) return [];
    return [{
      createdAt: stringField(record.createdAt, 80),
      entityType: record.entityType === "mixed" ? "mixed" as const : entityType(record.entityType),
      items: items.slice(0, assistantConversationMemoryLimits.maxCrmReferences),
      key: stringField(record.key, 180) || "result-set",
      messageId: stringField(record.messageId, 160),
      title: stringField(record.title, 160) || "Assistant results"
    }];
  }).slice(-assistantConversationMemoryLimits.maxResultSets);
}

function parseActions(value: unknown): AssistantConversationActionMemory[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const id = stringField(record.id, 160);
    if (!id) return [];
    return [{
      id,
      kind: stringField(record.kind, 80),
      status: actionStatus(record.status),
      targetLabel: stringField(record.targetLabel, 160),
      title: stringField(record.title, 160)
    }];
  }).slice(-12);
}

function parseCorrections(value: unknown): AssistantConversationCorrectionMemory[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const text = stringField(record.text, 220);
    const messageId = stringField(record.messageId, 160);
    if (!text || !messageId) return [];
    return [{ createdAt: stringField(record.createdAt, 80), messageId, text }];
  }).slice(-10);
}

function parseContextWindow(value: Prisma.JsonValue | null): AssistantConversationContextWindow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return buildContextWindow(0, 0);
  const record = value as Record<string, unknown>;
  const limits = record.limits && typeof record.limits === "object" && !Array.isArray(record.limits)
    ? record.limits as Record<string, unknown>
    : {};
  return {
    limits: {
      maxCrmReferences: numberField(limits.maxCrmReferences, assistantConversationMemoryLimits.maxCrmReferences),
      maxRecentMessages: numberField(limits.maxRecentMessages, assistantConversationMemoryLimits.maxRecentMessages),
      maxResultSets: numberField(limits.maxResultSets, assistantConversationMemoryLimits.maxResultSets),
      maxSummaryFacts: numberField(limits.maxSummaryFacts, assistantConversationMemoryLimits.maxSummaryFacts),
      maxSummaryTextChars: numberField(limits.maxSummaryTextChars, assistantConversationMemoryLimits.maxSummaryTextChars)
    },
    selectedReferenceCount: numberField(record.selectedReferenceCount, 0),
    selectedResultSetCount: numberField(record.selectedResultSetCount, 0),
    strategy: stringField(record.strategy, 220) || contextStrategyText()
  };
}

function emptySummary(): AssistantConversationSummary {
  return {
    activeSubject: null,
    completedActions: [],
    confirmedFacts: [],
    decisions: [],
    pendingActions: [],
    recentResultSets: [],
    unresolvedQuestions: [],
    userCorrections: [],
    userGoals: []
  };
}

function summaryFromRecentMessages(history: AssistantConversationMessageLike[]) {
  return {
    ...emptySummary(),
    userGoals: boundedStrings(history.filter((message) => message.role === "user").slice(-4).map((message) => userGoal(message.content)).filter(Boolean), 4, 220)
  };
}

function buildContextWindow(referenceCount: number, resultSetCount: number): AssistantConversationContextWindow {
  return {
    limits: { ...assistantConversationMemoryLimits },
    selectedReferenceCount: Math.min(referenceCount, assistantConversationMemoryLimits.maxCrmReferences),
    selectedResultSetCount: Math.min(resultSetCount, assistantConversationMemoryLimits.maxResultSets),
    strategy: contextStrategyText()
  };
}

function contextStrategyText() {
  return "Use the durable summary, recent message window, unresolved clarification/action state, selected structured references, and targeted current CRM re-fetches; never send the full conversation or unrestricted CRM data by default.";
}

function dedupeReferences<T extends ReferenceUpsertInput>(references: T[]): T[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.entityType}:${reference.recordId}:${reference.role}:${reference.resultSetKey ?? "conversation"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(reference.recordId && reference.label);
  });
}

function previousStoredUserMessage(messages: AssistantConversationStoredMessageLike[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "user") return messages[cursor];
  }
  return null;
}

function parseStoredSources(value: Prisma.JsonValue | null): AssistantConversationSourceLike[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = stringField(record.label, 180);
    const detail = stringField(record.detail, 220);
    const recordType = stringField(record.recordType, 80);
    if (!label || !detail || !recordType) return [];
    return [{ detail, href: safeHref(record.href), label, recordType }];
  });
}

function parseStoredDraftActions(value: Prisma.JsonValue | null): AssistantDraftAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AssistantDraftAction =>
    Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string")
  ).slice(0, 8);
}

function extractUserCorrections(value: string) {
  const text = safeText(value, 400);
  if (!/\b(not|use|don't|do not|when i say|actually|instead)\b/i.test(text)) return [];
  return [text];
}

function userGoal(value: string) {
  const text = safeText(value, 220);
  if (!/\b(summarize|draft|create|follow up|compare|what should|tell me|continue|prepare|rewrite|plan|changed|risk|blocking)\b/i.test(text)) return "";
  return text;
}

function referencedOrdinal(value: string) {
  const text = value.toLowerCase();
  const match = text.match(/\b(?:the\s+)?(first|1st|one|number one|second|2nd|two|number two|third|3rd|three|number three|fourth|4th|four|fifth|5th|five|sixth|6th|six)(?:\s+one)?\b/);
  if (!match) {
    if (/\b(most urgent|highest risk|top one|first result)\b/.test(text)) return 1;
    return 0;
  }
  const token = match[1] ?? "";
  if (["first", "1st", "one", "number one"].includes(token)) return 1;
  if (["second", "2nd", "two", "number two"].includes(token)) return 2;
  if (["third", "3rd", "three", "number three"].includes(token)) return 3;
  if (["fourth", "4th", "four"].includes(token)) return 4;
  if (["fifth", "5th", "five"].includes(token)) return 5;
  if (["sixth", "6th", "six"].includes(token)) return 6;
  return 0;
}

function refersToRememberedSubject(value: string) {
  return /\b(that|this|the previous|same|them|their|it|current|go back to|continue)\b/i.test(value);
}

function impliedEntityType(value: string): AssistantConversationReferenceEntityType | "" {
  const text = value.toLowerCase();
  if (/\b(deal|opportunity|pipeline)\b/.test(text)) return "deal";
  if (/\b(contact|person|stakeholder|main contact)\b/.test(text)) return "person";
  if (/\b(account|organization|company)\b/.test(text)) return "organization";
  if (/\b(quote)\b/.test(text)) return "quote";
  if (/\b(email|message|inbox)\b/.test(text)) return "email";
  if (/\b(activity|task|follow-up|follow up)\b/.test(text)) return "";
  return "";
}

function compatibleEntity(implied: AssistantConversationReferenceEntityType, actual: AssistantConversationReferenceEntityType) {
  return implied === actual || (implied === "person" && actual === "deal") || (implied === "organization" && actual === "deal");
}

function isPrimarySubjectEntity(entityType: AssistantConversationReferenceEntityType) {
  return ["deal", "lead", "organization", "person"].includes(entityType);
}

function primaryRole(entityType: AssistantConversationReferenceEntityType): AssistantConversationReferenceRole {
  if (entityType === "deal") return "current_deal";
  return "primary_subject";
}

function resultSetKey(messageId: string) {
  return `${resultSetKeyPrefix}${messageId}`;
}

function boundedStrings(values: string[], limit: number, maxLength: number) {
  return Array.from(new Set(values.map((value) => safeText(value, maxLength)).filter(Boolean))).slice(-limit);
}

function boundedActions(values: AssistantConversationActionMemory[]) {
  const seen = new Set<string>();
  return values.filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  }).slice(-12);
}

function entityType(value: unknown): AssistantConversationReferenceEntityType {
  const raw = typeof value === "string" ? value : "";
  if (["activity", "deal", "email", "lead", "meeting_intake", "note", "organization", "person", "product", "quote", "report", "saved_view"].includes(raw)) {
    return raw as AssistantConversationReferenceEntityType;
  }
  return "deal";
}

function referenceRole(value: unknown): AssistantConversationReferenceRole {
  const raw = typeof value === "string" ? value : "";
  if (["current_deal", "pending_action_target", "primary_subject", "referenced", "related_contact", "related_organization", "selected_result", "source_email", "source_meeting"].includes(raw)) {
    return raw as AssistantConversationReferenceRole;
  }
  return "referenced";
}

function staleStatus(value: unknown): AssistantConversationReferenceStaleStatus {
  const raw = typeof value === "string" ? value : "";
  if (["CURRENT", "DELETED", "STALE", "SUPERSEDED", "UNKNOWN"].includes(raw)) return raw as AssistantConversationReferenceStaleStatus;
  return "UNKNOWN";
}

function actionStatus(value: unknown): AssistantConversationActionMemory["status"] {
  const raw = typeof value === "string" ? value : "";
  if (["applied", "drafted", "pending_review", "rejected", "unknown"].includes(raw)) return raw as AssistantConversationActionMemory["status"];
  return "unknown";
}

function entityLabel(value: AssistantConversationReferenceEntityType) {
  if (value === "person") return "contact";
  if (value === "meeting_intake") return "meeting";
  if (value === "saved_view") return "saved view";
  return value.replace("_", " ");
}

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function numberField(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringField(value: unknown, maxLength: number) {
  return typeof value === "string" ? safeText(value, maxLength) : "";
}

function safeHref(value: unknown): Route | undefined {
  if (typeof value !== "string") return undefined;
  const href = value.trim();
  if (!href.startsWith("/") || href.startsWith("//") || /[\s<>]/.test(href)) return undefined;
  return href.slice(0, 240) as Route;
}

function safeText(value: unknown, maxLength = 2_000) {
  if (typeof value !== "string") return "";
  return redactSensitiveText(value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}
