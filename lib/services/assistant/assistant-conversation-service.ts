import { Prisma } from "@prisma/client";
import type { Route } from "next";

import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { redactSensitiveText } from "@/lib/security/redaction";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

import {
  answerAssistantCommand,
  parseAssistantCommand,
  type AssistantAnswerItem,
  type AssistantCommandResult
} from "./assistant-command-service";
import {
  buildAssistantDealRiskContext,
  buildAssistantTodayContext
} from "./assistant-context-service";
import {
  resolveAssistantCrmDraftClarification,
  type AssistantDraftAction,
  type AssistantDraftActionCandidate
} from "./assistant-draft-action-service";
import {
  prepareAssistantConversationMemoryContext,
  updateAssistantConversationMemory
} from "./assistant-conversation-memory-service";

export type AssistantConversationSource = {
  detail: string;
  href?: Route;
  label: string;
  recordType: string;
};

export type AssistantConversationMessageView = {
  content: string;
  createdAt: string;
  draftActions: AssistantDraftAction[];
  errorCode: string | null;
  id: string;
  retryPrompt: string | null;
  role: "assistant" | "user";
  sources: AssistantConversationSource[];
  title: string | null;
};

export type AssistantConversationListItem = {
  createdAt: string;
  id: string;
  lastMessagePreview: string;
  title: string;
  updatedAt: string;
};

export type AssistantConversationView = {
  id: string;
  messages: AssistantConversationMessageView[];
  title: string;
};

export type SendAssistantConversationMessageInput = {
  conversationId?: string;
  message: unknown;
  now?: Date;
};

type ConversationReply = {
  content: string;
  draftActions?: AssistantDraftAction[];
  errorCode?: string;
  sources: AssistantConversationSource[];
  title: string;
};

type RetrievedRecord = {
  detail: string;
  href: Route;
  label: string;
  recordType: string;
};

export const assistantConversationStarterPrompts = [
  "Help me plan my day.",
  "What should I focus on?",
  "Summarize the Acme relationship.",
  "Which deals look risky?",
  "Help me prepare for my meeting.",
  "What am I waiting on?"
] as const;

const maxConversationMessages = 40;
const maxStoredMessageLength = 2_000;
const maxAssistantMessageLength = 4_000;
const maxSourceCount = 12;
const maxSourceTextLength = 260;
const noMutationNotice =
  "Permission-checked only: this conversation can read scoped CRM and stored Inbox context, but it does not send email, sync providers, or apply anything outside eligible activity, note, contact, or organization proposals allowed by your AI Preferences.";

export async function getAssistantConversation(
  actor: WorkspaceActor,
  conversationId: string | undefined
): Promise<AssistantConversationView | null> {
  await ensureWorkspaceAccess(actor);
  const id = normalizeId(conversationId);
  if (!id) return null;
  const conversation = await prisma.assistantConversation.findFirst({
    include: { messages: { orderBy: { createdAt: "asc" }, take: maxConversationMessages } },
    where: { id, userId: actor.actorUserId, workspaceId: actor.workspaceId }
  });
  return conversation ? assistantConversationView(conversation) : null;
}

export async function listAssistantConversations(
  actor: WorkspaceActor,
  options: { limit?: number } = {}
): Promise<AssistantConversationListItem[]> {
  await ensureWorkspaceAccess(actor);
  const limit = Math.min(Math.max(options.limit ?? 18, 1), 40);
  const conversations = await prisma.assistantConversation.findMany({
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        select: { content: true, role: true },
        take: 1
      }
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    where: { userId: actor.actorUserId, workspaceId: actor.workspaceId }
  });
  return conversations.map((conversation) => ({
    createdAt: conversation.createdAt.toISOString(),
    id: conversation.id,
    lastMessagePreview: safeText(conversation.messages[0]?.content ?? "No messages yet.", 120),
    title: safeText(conversation.title, 80) || "Untitled conversation",
    updatedAt: conversation.updatedAt.toISOString()
  }));
}

export async function sendAssistantConversationMessage(
  actor: WorkspaceActor,
  input: SendAssistantConversationMessageInput
): Promise<AssistantConversationView> {
  await ensureWorkspaceAccess(actor);
  const rawMessage = normalizeConversationText(input.message);
  const message = sanitizeConversationText(rawMessage);
  if (!message) throw new Error("Enter a question or command before asking.");
  const now = input.now ?? new Date();
  const existing = await getExistingConversation(actor, input.conversationId);
  const conversation = existing ?? await prisma.assistantConversation.create({
    data: {
      title: conversationTitle(message),
      userId: actor.actorUserId,
      workspaceId: actor.workspaceId
    }
  });
  const recentMessages = await prisma.assistantConversationMessage.findMany({
    orderBy: { createdAt: "asc" },
    take: maxConversationMessages,
    where: {
      conversationId: conversation.id,
      workspaceId: actor.workspaceId
    }
  });
  const userMessage = await prisma.assistantConversationMessage.create({
    data: {
      content: message,
      conversationId: conversation.id,
      role: "user",
      workspaceId: actor.workspaceId
    }
  });

  const memoryContext = await prepareAssistantConversationMemoryContext(actor, {
    conversationId: conversation.id,
    history: recentMessages.map(messageViewBase),
    message: rawMessage,
    now
  });
  const reply = memoryContext.resolvedReference?.status === "deleted"
    ? deletedReferencedRecordReply(memoryContext.notices[0] ?? "The remembered record is no longer available.")
    : withMemoryNotices(
        await safeBuildConversationReply(actor, memoryContext.rewrittenMessage, recentMessages.map(messageViewBase), now),
        memoryContext.notices
      );
  const assistantMessage = await prisma.assistantConversationMessage.create({
    data: {
      content: sanitizeAssistantText(reply.content),
      conversationId: conversation.id,
      draftActions: jsonArrayOrNull(reply.draftActions ?? []),
      errorCode: reply.errorCode ?? null,
      role: "assistant",
      sources: jsonArrayOrNull(reply.sources),
      title: safeText(reply.title, 160),
      workspaceId: actor.workspaceId
    }
  });
  await updateAssistantConversationMemory(actor, {
    assistantMessage,
    draftActions: reply.draftActions ?? [],
    sources: reply.sources,
    userMessage
  });
  await prisma.assistantConversation.update({
    data: {
      title: existing ? existing.title : conversationTitle(message),
      updatedAt: now
    },
    where: { id: conversation.id }
  });
  const updated = await getAssistantConversation(actor, conversation.id);
  if (!updated) throw new Error("Assistant conversation could not be loaded.");
  return updated;
}

export async function renameAssistantConversation(
  actor: WorkspaceActor,
  input: { conversationId: unknown; title: unknown }
): Promise<AssistantConversationView> {
  await ensureWorkspaceAccess(actor);
  const conversationId = normalizeId(input.conversationId);
  const title = safeText(input.title, 80);
  if (!conversationId || !title) throw new Error("Conversation title is required.");
  const updated = await prisma.assistantConversation.updateMany({
    data: { title },
    where: { id: conversationId, userId: actor.actorUserId, workspaceId: actor.workspaceId }
  });
  if (updated.count !== 1) throw new Error("Assistant conversation was not found.");
  const conversation = await getAssistantConversation(actor, conversationId);
  if (!conversation) throw new Error("Assistant conversation could not be loaded.");
  return conversation;
}

export async function deleteAssistantConversation(
  actor: WorkspaceActor,
  conversationIdInput: unknown
): Promise<void> {
  await ensureWorkspaceAccess(actor);
  const conversationId = normalizeId(conversationIdInput);
  if (!conversationId) throw new Error("Assistant conversation was not found.");
  await prisma.assistantConversation.deleteMany({
    where: { id: conversationId, userId: actor.actorUserId, workspaceId: actor.workspaceId }
  });
}

export async function regenerateLatestAssistantConversationResponse(
  actor: WorkspaceActor,
  input: { conversationId: unknown; now?: Date }
): Promise<AssistantConversationView> {
  await ensureWorkspaceAccess(actor);
  const conversationId = normalizeId(input.conversationId);
  if (!conversationId) throw new Error("Assistant conversation was not found.");
  const conversation = await prisma.assistantConversation.findFirst({
    include: {
      messages: { orderBy: { createdAt: "asc" }, take: maxConversationMessages }
    },
    where: { id: conversationId, userId: actor.actorUserId, workspaceId: actor.workspaceId }
  });
  if (!conversation) throw new Error("Assistant conversation was not found.");
  const messages = conversation.messages.map(messageViewBase);
  const lastAssistantIndex = findLastMessageIndex(messages, "assistant");
  const prompt = lastAssistantIndex >= 0 ? previousUserPrompt(messages, lastAssistantIndex) : previousUserPrompt(messages, messages.length);
  if (!prompt) throw new Error("No user prompt is available to regenerate.");
  const history = messages.slice(0, Math.max(lastAssistantIndex, 0));
  const now = input.now ?? new Date();
  const memoryContext = await prepareAssistantConversationMemoryContext(actor, {
    conversationId: conversation.id,
    history,
    message: prompt,
    now
  });
  const reply = memoryContext.resolvedReference?.status === "deleted"
    ? deletedReferencedRecordReply(memoryContext.notices[0] ?? "The remembered record is no longer available.")
    : withMemoryNotices(await safeBuildConversationReply(actor, memoryContext.rewrittenMessage, history, now), memoryContext.notices);
  const existingDraftIds = new Set(messages.flatMap((message) => message.draftActions.map((draft) => draft.id)));
  const draftActions = (reply.draftActions ?? []).filter((draft) => !existingDraftIds.has(draft.id));
  const assistantMessage = await prisma.assistantConversationMessage.create({
    data: {
      content: sanitizeAssistantText(reply.content),
      conversationId: conversation.id,
      draftActions: jsonArrayOrNull(draftActions),
      errorCode: reply.errorCode ?? null,
      role: "assistant",
      sources: jsonArrayOrNull(reply.sources),
      title: safeText(reply.title, 160),
      workspaceId: actor.workspaceId
    }
  });
  const previousUser = lastAssistantIndex >= 0 ? previousUserMessage(messages, lastAssistantIndex) : previousUserMessage(messages, messages.length);
  if (previousUser) {
    await updateAssistantConversationMemory(actor, {
      assistantMessage,
      draftActions,
      sources: reply.sources,
      supersededAssistantMessageId: lastAssistantIndex >= 0 ? messages[lastAssistantIndex]?.id ?? null : null,
      userMessage: {
        content: previousUser.content,
        createdAt: new Date(previousUser.createdAt),
        id: previousUser.id
      }
    });
  }
  await prisma.assistantConversation.update({
    data: { updatedAt: input.now ?? new Date() },
    where: { id: conversation.id }
  });
  const updated = await getAssistantConversation(actor, conversation.id);
  if (!updated) throw new Error("Assistant conversation could not be loaded.");
  return updated;
}

export async function clarifyAssistantConversationDraft(
  actor: WorkspaceActor,
  input: { candidateId: unknown; candidateType: unknown; conversationId: unknown; draftAction: AssistantDraftAction }
): Promise<AssistantConversationView> {
  await ensureWorkspaceAccess(actor);
  const conversationId = normalizeId(input.conversationId);
  const candidateId = stringInput(input.candidateId, 160);
  const candidateType = input.candidateType === "person" || input.candidateType === "organization" ? input.candidateType : "";
  if (!conversationId || !candidateId || !candidateType) throw new Error("Clarification selection is incomplete.");
  const conversation = await getExistingConversation(actor, conversationId);
  if (!conversation) throw new Error("Assistant conversation was not found.");

  const draft = await resolveAssistantCrmDraftClarification(actor, {
    candidateId,
    candidateType,
    draftAction: input.draftAction
  });
  const resolutionKey = draft.clarification?.resolutionKey ?? "";
  if (resolutionKey && await conversationAlreadyHasClarificationDraft(actor, conversation.id, resolutionKey)) {
    const existing = await getAssistantConversation(actor, conversation.id);
    if (existing) return existing;
  }
  const selected = input.draftAction.candidates.find((candidate) => candidate.id === candidateId && candidate.type === candidateType);
  await appendAssistantConversationMessages(actor, conversation.id, {
    assistant: {
      content: draft.confidence === "high"
        ? "I used your selected record and resumed the original request as a review-first draft. Review the values before saving it to CRM Change Proposals."
        : "I tried to use your selected record, but the draft still needs review before it can continue.",
      draftActions: [draft],
      sources: selected ? [candidateSource(selected)] : [],
      title: draft.confidence === "high" ? "Clarification applied" : "Clarification still needed"
    },
    user: `Selected ${selected?.label ?? "a candidate"} for ${candidateType === "person" ? "contact" : "organization"} clarification.`
  });
  const updated = await getAssistantConversation(actor, conversation.id);
  if (!updated) throw new Error("Assistant conversation could not be loaded.");
  return updated;
}

export async function cancelAssistantConversationDraftClarification(
  actor: WorkspaceActor,
  input: { conversationId: unknown; draftAction: AssistantDraftAction }
): Promise<AssistantConversationView> {
  await ensureWorkspaceAccess(actor);
  const conversationId = normalizeId(input.conversationId);
  if (!conversationId) throw new Error("Assistant conversation was not found.");
  const conversation = await getExistingConversation(actor, conversationId);
  if (!conversation) throw new Error("Assistant conversation was not found.");
  await appendAssistantConversationMessages(actor, conversation.id, {
    assistant: {
      content: "Clarification canceled. I did not create a CRM Change Proposal or mutate any records.",
      draftActions: [],
      sources: [],
      title: "Clarification canceled"
    },
    user: `Canceled clarification for ${input.draftAction.title}.`
  });
  const updated = await getAssistantConversation(actor, conversation.id);
  if (!updated) throw new Error("Assistant conversation could not be loaded.");
  return updated;
}

export function sanitizeAssistantConversationFailure(error: unknown) {
  const detail = error instanceof Error ? redactSensitiveText(error.message) : "";
  return detail
    ? `I could not finish that answer safely. ${safeText(detail, 220)}`
    : "I could not finish that answer safely. Retry the question or start a new conversation.";
}

async function safeBuildConversationReply(
  actor: WorkspaceActor,
  message: string,
  history: AssistantConversationMessageView[],
  now: Date
): Promise<ConversationReply> {
  try {
    return await buildConversationReply(actor, message, history, now);
  } catch (error) {
    return {
      content: sanitizeAssistantConversationFailure(error),
      errorCode: "ASSISTANT_CONVERSATION_FAILED",
      sources: [],
      title: "Assistant response unavailable"
    };
  }
}

async function buildConversationReply(
  actor: WorkspaceActor,
  message: string,
  history: AssistantConversationMessageView[],
  now: Date
): Promise<ConversationReply> {
  const parsed = parseAssistantCommand(message);
  if (parsed.kind !== "unsupported") {
    return commandResultToConversationReply(await answerAssistantCommand(actor, message, { now }));
  }

  const intent = classifyConversationIntent(message, history);
  if (intent === "day") return buildDayPlanningReply(actor, message, now);
  if (intent === "deal_risk") return commandResultToConversationReply(await answerAssistantCommand(actor, "Show me the highest-risk deals this week.", { now }));
  if (intent === "waiting") return buildWaitingOnReply(actor, message, history, now);
  if (intent === "meeting") return buildMeetingPrepReply(actor, message, history, now);
  if (intent === "compare") return buildCompareReply(actor, message, history, now);
  if (intent === "general") return buildGeneralWorkReply(message, history);
  return buildRelationshipReply(actor, message, history, now);
}

async function buildDayPlanningReply(actor: WorkspaceActor, message: string, now: Date): Promise<ConversationReply> {
  const [today, dealRisk, emails] = await Promise.all([
    buildAssistantTodayContext(actor, now),
    buildAssistantDealRiskContext(actor, now),
    listRelevantEmails(actor, message, now, { waitingOnCustomer: true })
  ]);
  const activities = today.activities.slice(0, 4);
  const riskyDeals = dealRisk.deals
    .filter((deal) => deal.activities.length === 0 || deal.activities.some((activity) => activity.bucket === "overdue"))
    .slice(0, 3);
  const sources = [
    ...activities.map((activity): AssistantConversationSource => ({
      detail: activity.dueAt ? `Due ${formatDate(activity.dueAt)}` : "No due date recorded",
      href: activity.href as Route,
      label: activity.title,
      recordType: "Activity"
    })),
    ...riskyDeals.map((deal): AssistantConversationSource => ({
      detail: deal.relatedLabel ?? deal.stageName,
      href: deal.href as Route,
      label: deal.title,
      recordType: "Deal"
    })),
    ...emails.slice(0, 3)
  ].slice(0, maxSourceCount);
  const facts = [
    `${today.counts.overdue} overdue and ${today.counts.today} due-today open activities are visible in this workspace.`,
    riskyDeals.length > 0
      ? `${riskyDeals.length} open deal${riskyDeals.length === 1 ? "" : "s"} have deterministic risk signals.`
      : "No high-risk open deals stood out in the bounded risk snapshot.",
    emails.length > 0
      ? `${emails.length} stored Inbox item${emails.length === 1 ? "" : "s"} may need a reply or customer follow-up.`
      : "No obvious stored Inbox waiting-on-customer item appeared in this bounded lookup."
  ];
  const suggestions = [
    activities[0] ? `Start with ${activities[0].title}.` : "Open Activities before assuming the day is clear.",
    riskyDeals[0] ? `Review ${riskyDeals[0].title} before changing deal state or quote terms.` : "Use the Command Center for the next deterministic priority.",
    "Ask a follow-up like “what should I do first?” or “draft a follow-up for this customer” when you want a review-first draft."
  ];
  return {
    content: conversationContent({
      facts,
      intro: "Here is a safe work plan from bounded CRM and stored Inbox context.",
      suggestions
    }),
    sources,
    title: "Plan your day"
  };
}

async function buildRelationshipReply(
  actor: WorkspaceActor,
  message: string,
  history: AssistantConversationMessageView[],
  now: Date
): Promise<ConversationReply> {
  const term = entitySearchTerm(message, history);
  const records = term ? await retrieveConversationRecords(actor, term, now) : await retrieveConversationRecords(actor, message, now);
  const primaryRecords = records.filter((record) => ["Contact", "Organization", "Deal", "Lead"].includes(record.recordType));
  if (isAmbiguous(primaryRecords, term)) {
    return {
      content: conversationContent({
        facts: [`I found ${primaryRecords.length} possible records for “${term}”.`],
        intro: "I should not guess which CRM record you mean.",
        suggestions: ["Open the right source below, or ask again with the full contact, organization, deal, or lead name."]
      }),
      sources: primaryRecords.slice(0, maxSourceCount),
      title: "Clarify the record"
    };
  }
  const sources = records.slice(0, maxSourceCount);
  if (sources.length === 0) {
    return {
      content: conversationContent({
        facts: [`I did not find matching CRM or stored Inbox records for “${term || message}” in this workspace.`],
        intro: "I only used scoped Northstar records.",
        suggestions: ["Try a more specific customer, deal, quote number, contact email, or meeting title."]
      }),
      sources: [],
      title: "No scoped records found"
    };
  }
  return {
    content: conversationContent({
      facts: sources.slice(0, 6).map((source) => `${source.recordType}: ${source.label}. ${source.detail}`),
      intro: `Here is the scoped relationship context I found for “${term || message}”.`,
      suggestions: [
        "Treat these as stored facts, not automatic changes.",
        "Ask a follow-up to focus on risks, next steps, recent email, or a review-first follow-up draft."
      ]
    }),
    sources,
    title: "Relationship summary"
  };
}

async function buildWaitingOnReply(
  actor: WorkspaceActor,
  message: string,
  history: AssistantConversationMessageView[],
  now: Date
): Promise<ConversationReply> {
  const emails = await listRelevantEmails(actor, entitySearchTerm(message, history) || message, now, { waitingOnCustomer: true });
  return {
    content: conversationContent({
      facts: emails.length > 0
        ? emails.slice(0, 5).map((email) => `Stored email: ${email.label}. ${email.detail}`)
        : ["No obvious waiting-on-customer stored email appeared in this bounded lookup."],
      intro: "I checked stored Inbox context only; I did not sync, refresh, send, archive, or mark provider mail.",
      suggestions: emails.length > 0
        ? ["Open the source email before replying.", "Ask me to draft a follow-up if you want a review-first draft."]
        : ["Try a customer or deal name, or review Relationship Inbox filters."]
    }),
    sources: emails.slice(0, maxSourceCount),
    title: "Waiting-on context"
  };
}

async function buildMeetingPrepReply(
  actor: WorkspaceActor,
  message: string,
  history: AssistantConversationMessageView[],
  now: Date
): Promise<ConversationReply> {
  const term = entitySearchTerm(message, history);
  const [records, meetings] = await Promise.all([
    retrieveConversationRecords(actor, term || message, now),
    listUpcomingMeetings(actor, term || message, now)
  ]);
  const sources = [...meetings, ...records].slice(0, maxSourceCount);
  return {
    content: conversationContent({
      facts: sources.length > 0
        ? sources.slice(0, 6).map((source) => `${source.recordType}: ${source.label}. ${source.detail}`)
        : ["No upcoming meeting or matching CRM context appeared in the bounded workspace lookup."],
      intro: "Here is meeting prep context from stored CRM records.",
      suggestions: [
        "Review the linked activity and relationship records before the meeting.",
        "Ask a follow-up for likely questions, risks, or a review-first follow-up draft."
      ]
    }),
    sources,
    title: "Meeting prep"
  };
}

async function buildCompareReply(
  actor: WorkspaceActor,
  message: string,
  history: AssistantConversationMessageView[],
  now: Date
): Promise<ConversationReply> {
  const terms = compareTerms(message, history);
  const recordSets = await Promise.all(terms.map((term) => retrieveConversationRecords(actor, term, now)));
  const dealSources = recordSets.flat().filter((record) => record.recordType === "Deal").slice(0, 4);
  const fallback = dealSources.length > 0 ? dealSources : recordSets.flat().slice(0, 4);
  return {
    content: conversationContent({
      facts: fallback.length > 0
        ? fallback.map((source) => `${source.recordType}: ${source.label}. ${source.detail}`)
        : ["I could not find enough scoped records to compare."],
      intro: "Here is a safe comparison based on visible stored records.",
      suggestions: [
        "Compare value, next activity, expected close date, and relationship risk before changing either opportunity.",
        "Ask with exact deal names if you want a tighter comparison."
      ]
    }),
    sources: fallback,
    title: "Compare opportunities"
  };
}

function buildGeneralWorkReply(message: string, history: AssistantConversationMessageView[]): ConversationReply {
  const suppliedText = extractSuppliedText(message) || extractSuppliedText(recentUserText(history));
  const wantsRewrite = /\b(rewrite|make this sound|polish|professional|concise|less formal|more formal)\b/i.test(message);
  const wantsSummary = /\b(summarize|summary|tl;dr|recap)\b/i.test(message);
  const wantsBrainstorm = /\b(brainstorm|ideas|questions|agenda|plan|outline)\b/i.test(message);
  const facts = suppliedText
    ? [
        wantsRewrite ? `Draft: ${rewritePlainWorkText(suppliedText, message)}` : "",
        wantsSummary ? `Summary: ${summarizePlainWorkText(suppliedText)}` : "",
        !wantsRewrite && !wantsSummary ? `Working text: ${safeText(suppliedText, 360)}` : ""
      ].filter(Boolean)
    : [
        "I can help with writing, planning, brainstorming, explanations, and summaries without retrieving CRM records unless you ask for CRM context."
      ];
  const suggestions = [
    wantsBrainstorm ? "Pick the strongest idea, then ask me to turn it into a meeting agenda or follow-up note." : "",
    "Paste the exact text if you want a tighter rewrite.",
    "Ask for CRM context separately if this should connect to a customer, deal, email, meeting, or quote."
  ].filter(Boolean);
  return {
    content: conversationContent({
      facts,
      intro: suppliedText ? "Here is a conversational work draft that does not mutate CRM data." : "I can help with that as a general work question.",
      suggestions
    }),
    sources: [],
    title: wantsRewrite ? "Writing help" : wantsSummary ? "Summary help" : wantsBrainstorm ? "Planning help" : "General work help"
  };
}

async function retrieveConversationRecords(actor: WorkspaceActor, term: string, now: Date): Promise<RetrievedRecord[]> {
  const query = normalizeSearchTerm(term);
  if (!query) return [];
  const contains = { contains: query, mode: "insensitive" as const };
  const scoped = { workspaceId: actor.workspaceId, ...activeWhere };
  const [people, organizations, deals, leads, quotes, activities, notes, emails] = await Promise.all([
    prisma.person.findMany({
      orderBy: [{ updatedAt: "desc" }, { firstName: "asc" }],
      select: {
        email: true,
        firstName: true,
        id: true,
        lastName: true,
        organization: { select: { name: true, workspaceId: true, deletedAt: true } },
        relationshipBusinessConcerns: true,
        relationshipCommunicationStyle: true,
        relationshipFollowUpReminders: true,
        updatedAt: true
      },
      take: 4,
      where: { ...scoped, OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] }
    }),
    prisma.organization.findMany({
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      select: { domain: true, id: true, name: true, updatedAt: true },
      take: 4,
      where: { ...scoped, OR: [{ name: contains }, { domain: contains }] }
    }),
    prisma.deal.findMany({
      orderBy: [{ updatedAt: "desc" }],
      select: {
        currency: true,
        expectedCloseAt: true,
        id: true,
        organization: { select: { name: true, workspaceId: true, deletedAt: true } },
        person: { select: { firstName: true, lastName: true, workspaceId: true, deletedAt: true } },
        stage: { select: { name: true } },
        status: true,
        title: true,
        updatedAt: true,
        valueCents: true
      },
      take: 5,
      where: { ...scoped, title: contains }
    }),
    prisma.lead.findMany({
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        organization: { select: { name: true, workspaceId: true, deletedAt: true } },
        person: { select: { firstName: true, lastName: true, workspaceId: true, deletedAt: true } },
        source: true,
        status: true,
        title: true,
        updatedAt: true
      },
      take: 4,
      where: { ...scoped, OR: [{ title: contains }, { source: contains }] }
    }),
    prisma.quote.findMany({
      orderBy: [{ updatedAt: "desc" }],
      select: {
        deal: { select: { id: true, title: true, workspaceId: true, deletedAt: true } },
        id: true,
        number: true,
        status: true,
        totalCents: true,
        updatedAt: true
      },
      take: 4,
      where: { workspaceId: actor.workspaceId, OR: [{ number: contains }, { deal: { is: { workspaceId: actor.workspaceId, title: contains } } }] }
    }),
    prisma.activity.findMany({
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      select: { dueAt: true, id: true, title: true, type: true },
      take: 4,
      where: { ...scoped, OR: [{ title: contains }, { description: contains }] }
    }),
    prisma.note.findMany({
      orderBy: [{ createdAt: "desc" }],
      select: { body: true, dealId: true, id: true, leadId: true, organizationId: true, personId: true },
      take: 4,
      where: { ...scoped, body: contains }
    }),
    prisma.emailLog.findMany({
      orderBy: [{ occurredAt: "desc" }],
      select: { body: true, direction: true, fromText: true, id: true, occurredAt: true, providerSnippet: true, subject: true, toText: true },
      take: 4,
      where: { workspaceId: actor.workspaceId, OR: [{ subject: contains }, { body: contains }, { fromText: contains }, { toText: contains }, { providerSnippet: contains }] }
    })
  ]);
  return [
    ...people.map((person): RetrievedRecord => ({
      detail: [
        person.email ? `Email ${person.email}` : "No email recorded",
        person.organization?.workspaceId === actor.workspaceId && !person.organization.deletedAt ? `Organization ${person.organization.name}` : "",
        person.relationshipCommunicationStyle ? `Communication style: ${person.relationshipCommunicationStyle}` : "",
        person.relationshipBusinessConcerns ? `Business concerns: ${person.relationshipBusinessConcerns}` : "",
        person.relationshipFollowUpReminders ? `Follow-up reminders: ${person.relationshipFollowUpReminders}` : ""
      ].filter(Boolean).map((part) => safeText(part, 140)).join(" · "),
      href: `/contacts/${person.id}` as Route,
      label: formatPersonName(person) ?? person.email ?? "Unnamed contact",
      recordType: "Contact"
    })),
    ...organizations.map((organization): RetrievedRecord => ({
      detail: [organization.domain ? `Domain ${organization.domain}` : "No domain recorded", `Updated ${formatDate(organization.updatedAt)}`].join(" · "),
      href: `/organizations/${organization.id}` as Route,
      label: organization.name,
      recordType: "Organization"
    })),
    ...deals.map((deal): RetrievedRecord => ({
      detail: [
        `Status ${deal.status}`,
        `Stage ${deal.stage.name}`,
        deal.valueCents ? formatMoney(deal.valueCents, deal.currency) : "No value recorded",
        deal.expectedCloseAt ? `Expected close ${formatDate(deal.expectedCloseAt)}` : "No expected close recorded",
        deal.organization?.workspaceId === actor.workspaceId && !deal.organization.deletedAt ? `Organization ${deal.organization.name}` : "",
        deal.person?.workspaceId === actor.workspaceId && !deal.person.deletedAt ? `Contact ${formatPersonName(deal.person)}` : ""
      ].filter(Boolean).join(" · "),
      href: `/deals/${deal.id}` as Route,
      label: deal.title,
      recordType: "Deal"
    })),
    ...leads.map((lead): RetrievedRecord => ({
      detail: [
        `Status ${lead.status}`,
        lead.source ? `Source ${lead.source}` : "No source recorded",
        lead.organization?.workspaceId === actor.workspaceId && !lead.organization.deletedAt ? `Organization ${lead.organization.name}` : "",
        lead.person?.workspaceId === actor.workspaceId && !lead.person.deletedAt ? `Contact ${formatPersonName(lead.person)}` : ""
      ].filter(Boolean).join(" · "),
      href: `/leads/${lead.id}` as Route,
      label: lead.title,
      recordType: "Lead"
    })),
    ...quotes.map((quote): RetrievedRecord => ({
      detail: [`Status ${quote.status}`, `Total ${formatMoney(quote.totalCents, "USD")}`, quote.deal ? `Deal ${quote.deal.title}` : ""].filter(Boolean).join(" · "),
      href: `/deals/${quote.deal.id}/quotes/${quote.id}` as Route,
      label: `Quote ${quote.number}`,
      recordType: "Quote"
    })),
    ...activities.map((activity): RetrievedRecord => ({
      detail: [activity.type, activity.dueAt ? `Due ${formatDate(activity.dueAt)}` : "No due date"].join(" · "),
      href: `/activities/${activity.id}/edit` as Route,
      label: activity.title,
      recordType: "Activity"
    })),
    ...notes.map((note): RetrievedRecord => ({
      detail: safeText(note.body, 180),
      href: note.dealId ? `/deals/${note.dealId}` as Route : note.leadId ? `/leads/${note.leadId}` as Route : note.personId ? `/contacts/${note.personId}` as Route : note.organizationId ? `/organizations/${note.organizationId}` as Route : "/search" as Route,
      label: "Internal note",
      recordType: "Note"
    })),
    ...emails.map((email): RetrievedRecord => ({
      detail: [
        `${email.direction} on ${formatDate(email.occurredAt)}`,
        email.fromText ? `From ${safeText(email.fromText, 80)}` : "",
        safeText(email.providerSnippet || email.body, 180)
      ].filter(Boolean).join(" · "),
      href: `/email#email-card-${email.id}` as Route,
      label: email.subject,
      recordType: "Email"
    }))
  ].slice(0, maxSourceCount);
}

async function listRelevantEmails(
  actor: WorkspaceActor,
  term: string,
  now: Date,
  options: { waitingOnCustomer?: boolean } = {}
): Promise<AssistantConversationSource[]> {
  const query = normalizeSearchTerm(term);
  const since = new Date(now);
  since.setDate(since.getDate() - 30);
  const contains = query ? { contains: query, mode: "insensitive" as const } : undefined;
  const entityIds = query ? await matchingEmailRelationIds(actor, query) : { dealIds: [], leadIds: [], organizationIds: [], personIds: [] };
  const emails = await prisma.emailLog.findMany({
    orderBy: [{ occurredAt: "desc" }],
    select: {
      body: true,
      direction: true,
      fromText: true,
      id: true,
      occurredAt: true,
      providerSnippet: true,
      subject: true,
      toText: true
    },
    take: 8,
    where: {
      workspaceId: actor.workspaceId,
      occurredAt: { gte: since },
      ...(contains
        ? {
            OR: [
              { subject: contains },
              { body: contains },
              { fromText: contains },
              { toText: contains },
              { providerSnippet: contains },
              ...(entityIds.personIds.length > 0 ? [{ personId: { in: entityIds.personIds } }] : []),
              ...(entityIds.organizationIds.length > 0 ? [{ organizationId: { in: entityIds.organizationIds } }] : []),
              ...(entityIds.dealIds.length > 0 ? [{ dealId: { in: entityIds.dealIds } }] : []),
              ...(entityIds.leadIds.length > 0 ? [{ leadId: { in: entityIds.leadIds } }] : [])
            ]
          }
        : {}),
      ...(options.waitingOnCustomer ? { direction: "OUTBOUND" } : {})
    }
  });
  return emails.map((email): AssistantConversationSource => ({
    detail: [
      `${email.direction} on ${formatDate(email.occurredAt)}`,
      email.toText ? `To ${safeText(email.toText, 80)}` : email.fromText ? `From ${safeText(email.fromText, 80)}` : "",
      safeText(email.providerSnippet || email.body, 180)
    ].filter(Boolean).join(" · "),
    href: `/email#email-card-${email.id}` as Route,
    label: email.subject,
    recordType: "Email"
  }));
}

async function matchingEmailRelationIds(actor: WorkspaceActor, query: string) {
  const contains = { contains: query, mode: "insensitive" as const };
  const [people, organizations, deals, leads] = await Promise.all([
    prisma.person.findMany({
      select: { id: true },
      take: 8,
      where: { workspaceId: actor.workspaceId, ...activeWhere, OR: [{ firstName: contains }, { lastName: contains }, { email: contains }] }
    }),
    prisma.organization.findMany({
      select: { id: true },
      take: 8,
      where: { workspaceId: actor.workspaceId, ...activeWhere, OR: [{ name: contains }, { domain: contains }] }
    }),
    prisma.deal.findMany({
      select: { id: true },
      take: 8,
      where: { workspaceId: actor.workspaceId, ...activeWhere, title: contains }
    }),
    prisma.lead.findMany({
      select: { id: true },
      take: 8,
      where: { workspaceId: actor.workspaceId, ...activeWhere, title: contains }
    })
  ]);
  return {
    dealIds: deals.map((deal) => deal.id),
    leadIds: leads.map((lead) => lead.id),
    organizationIds: organizations.map((organization) => organization.id),
    personIds: people.map((person) => person.id)
  };
}

async function listUpcomingMeetings(actor: WorkspaceActor, term: string, now: Date): Promise<AssistantConversationSource[]> {
  const query = normalizeSearchTerm(term);
  const nextMonth = new Date(now);
  nextMonth.setDate(nextMonth.getDate() + 30);
  const contains = query ? { contains: query, mode: "insensitive" as const } : undefined;
  const meetings = await prisma.activity.findMany({
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    select: { description: true, dueAt: true, id: true, title: true },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      completedAt: null,
      deletedAt: null,
      type: "MEETING",
      OR: [
        { dueAt: { gte: now, lte: nextMonth } },
        ...(contains ? [{ title: contains }, { description: contains }] : [])
      ]
    }
  });
  return meetings.map((meeting): AssistantConversationSource => ({
    detail: [meeting.dueAt ? `Scheduled ${formatDate(meeting.dueAt)}` : "No meeting date recorded", safeText(meeting.description, 140)].filter(Boolean).join(" · "),
    href: `/activities/${meeting.id}/edit` as Route,
    label: meeting.title,
    recordType: "Activity"
  }));
}

function commandResultToConversationReply(answer: AssistantCommandResult): ConversationReply {
  return {
    content: conversationContent({
      facts: [
        answer.summary,
        ...answer.items.slice(0, 6).map((item) => `${item.label ?? "Context"}: ${item.title}. ${item.detail}`)
      ],
      intro: answer.title,
      suggestions: [
        answer.safetyNotice,
        "You can ask a follow-up in this conversation, or save any eligible draft to the review queue first."
      ]
    }),
    draftActions: answer.draftActions ?? [],
    sources: [
      ...answer.items.filter((item) => item.href).map(itemSource),
      ...answer.sources.map((source): AssistantConversationSource => ({
        detail: source.detail,
        label: source.label,
        recordType: "Context"
      }))
    ].slice(0, maxSourceCount),
    title: answer.title
  };
}

function withMemoryNotices(reply: ConversationReply, notices: string[]) {
  const safeNotices = notices.map((notice) => safeText(notice, 260)).filter(Boolean);
  if (safeNotices.length === 0) return reply;
  return {
    ...reply,
    content: [...safeNotices, "", reply.content].join("\n")
  };
}

function deletedReferencedRecordReply(notice: string): ConversationReply {
  return {
    content: conversationContent({
      facts: [notice],
      intro: "I could not safely continue from the remembered record.",
      suggestions: [
        "Ask with the current CRM record name or open the intended record and use its Assistant action.",
        "I did not redirect this request to another record or create any draft."
      ]
    }),
    sources: [],
    title: "Remembered record unavailable"
  };
}

async function appendAssistantConversationMessages(
  actor: WorkspaceActor,
  conversationId: string,
  messages: {
    assistant: { content: string; draftActions: AssistantDraftAction[]; sources: AssistantConversationSource[]; title: string };
    user: string;
  }
) {
  const userMessage = await prisma.assistantConversationMessage.create({
    data: {
      content: sanitizeConversationText(messages.user),
      conversationId,
      role: "user",
      workspaceId: actor.workspaceId
    }
  });
  const assistantMessage = await prisma.assistantConversationMessage.create({
    data: {
      content: sanitizeAssistantText(messages.assistant.content),
      conversationId,
      draftActions: jsonArrayOrNull(messages.assistant.draftActions),
      role: "assistant",
      sources: jsonArrayOrNull(messages.assistant.sources),
      title: safeText(messages.assistant.title, 160),
      workspaceId: actor.workspaceId
    }
  });
  await updateAssistantConversationMemory(actor, {
    assistantMessage,
    draftActions: messages.assistant.draftActions,
    sources: messages.assistant.sources,
    userMessage
  });
  await prisma.assistantConversation.update({
    data: { updatedAt: new Date() },
    where: { id: conversationId }
  });
}

async function conversationAlreadyHasClarificationDraft(actor: WorkspaceActor, conversationId: string, resolutionKey: string) {
  const recent = await prisma.assistantConversationMessage.findMany({
    orderBy: { createdAt: "desc" },
    select: { draftActions: true },
    take: maxConversationMessages,
    where: { conversationId, workspaceId: actor.workspaceId }
  });
  return recent.some((message) =>
    parseDraftActions(message.draftActions).some((draft) => draft.clarification?.resolutionKey === resolutionKey)
  );
}

function candidateSource(candidate: AssistantDraftActionCandidate): AssistantConversationSource {
  return {
    detail: candidate.detail ?? "Selected candidate",
    href: candidate.href as Route,
    label: candidate.label,
    recordType: candidate.type === "person" ? "Contact" : "Organization"
  };
}

function itemSource(item: AssistantAnswerItem): AssistantConversationSource {
  return {
    detail: item.detail,
    href: item.href as Route,
    label: item.title,
    recordType: item.label ?? "CRM record"
  };
}

function conversationContent({ facts, intro, suggestions }: { facts: string[]; intro: string; suggestions: string[] }) {
  return [
    intro,
    "",
    "Stored facts:",
    ...facts.filter(Boolean).map((fact) => `- ${safeText(fact, 360)}`),
    "",
    "Suggestions:",
    ...suggestions.filter(Boolean).map((suggestion) => `- ${safeText(suggestion, 360)}`),
    "",
    noMutationNotice
  ].join("\n");
}

function classifyConversationIntent(message: string, history: AssistantConversationMessageView[]) {
  const text = `${message} ${recentUserText(history)}`.toLowerCase();
  if (/\b(compare|versus| vs\.? |which (?:opportunity|deal))\b/.test(text)) return "compare";
  if (/\b(waiting on|waiting for|owe me|customer owes|needs reply|inbox)\b/.test(text)) return "waiting";
  if (/\b(meeting|prepare|prep|agenda)\b/.test(text)) return "meeting";
  if (/\b(risky|risk|at risk|pipeline|opportunit(?:y|ies)|deals?)\b/.test(text)) return "deal_risk";
  if (/\b(plan my day|focus|prioriti[sz]e|what should i do|help me plan|my day)\b/.test(text)) return "day";
  if (/\b(summari[sz]e|summary)\b/.test(text) && /\b(relationship|customer|account|contact|organization|deal|lead|quote)\b/.test(text)) return "relationship";
  if (/\b(rewrite|summari[sz]e|summary|brainstorm|make this sound|polish|agenda|outline|explain|sales concept|less formal|more formal|professional|concise)\b/.test(text)) return "general";
  return "relationship";
}

function entitySearchTerm(message: string, history: AssistantConversationMessageView[]) {
  const current = extractEntityTerm(message);
  if (current) return current;
  const previous = [...history].reverse().find((item) => item.role === "user" && extractEntityTerm(item.content));
  return previous ? extractEntityTerm(previous.content) : "";
}

function extractEntityTerm(value: string) {
  const cleaned = value
    .replace(/[?!.]+/g, " ")
    .replace(/\b(summarize|summary|relationship|customer|account|contact|deal|lead|quote|meeting|prepare|prep|for|from|about|with|the|this|that|them|their|they|it|please|help|me|compare|opportunities|opportunity|what|am|i|waiting|on|focus|should|do|first)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const quoted = value.match(/["“]([^"”]{2,120})["”]/);
  if (quoted?.[1]) return quoted[1].trim();
  return cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : "";
}

function compareTerms(message: string, history: AssistantConversationMessageView[]) {
  const cleaned = message.replace(/\b(compare|opportunities|opportunity|deals?|please|help|me)\b/gi, " ");
  const parts = cleaned.split(/\b(?:and|vs\.?|versus)\b/i).map((part) => extractEntityTerm(part)).filter(Boolean);
  if (parts.length >= 2) return parts.slice(0, 2);
  const fallback = entitySearchTerm(message, history);
  return fallback ? [fallback] : [];
}

function isAmbiguous(records: RetrievedRecord[], term: string) {
  if (records.length < 2 || !term) return false;
  const normalizedTerm = term.toLowerCase();
  const closeMatches = records.filter((record) => record.label.toLowerCase().includes(normalizedTerm));
  return closeMatches.length > 1;
}

function recentUserText(history: AssistantConversationMessageView[]) {
  return history
    .filter((message) => message.role === "user")
    .slice(-2)
    .map((message) => message.content)
    .join(" ");
}

async function getExistingConversation(actor: WorkspaceActor, conversationId: string | undefined) {
  const id = normalizeId(conversationId);
  if (!id) return null;
  return prisma.assistantConversation.findFirst({
    where: { id, userId: actor.actorUserId, workspaceId: actor.workspaceId }
  });
}

function assistantConversationView<T extends {
  id: string;
  messages: Array<{
    content: string;
    createdAt: Date;
    draftActions: Prisma.JsonValue | null;
    errorCode: string | null;
    id: string;
    role: string;
    sources: Prisma.JsonValue | null;
    title: string | null;
  }>;
  title: string;
}>(conversation: T): AssistantConversationView {
  const baseMessages = conversation.messages.map(messageViewBase);
  return {
    id: conversation.id,
    messages: baseMessages.map((message, index) => ({
      ...message,
      retryPrompt: message.role === "assistant" ? previousUserPrompt(baseMessages, index) : null
    })),
    title: conversation.title
  };
}

function messageViewBase(message: {
  content: string;
  createdAt: Date;
  draftActions: Prisma.JsonValue | null;
  errorCode: string | null;
  id: string;
  role: string;
  sources: Prisma.JsonValue | null;
  title: string | null;
}): AssistantConversationMessageView {
  return {
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    draftActions: parseDraftActions(message.draftActions),
    errorCode: message.errorCode,
    id: message.id,
    retryPrompt: null,
    role: message.role === "user" ? "user" : "assistant",
    sources: parseSources(message.sources),
    title: message.title
  };
}

function previousUserPrompt(messages: AssistantConversationMessageView[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "user") return messages[cursor]?.content ?? null;
  }
  return null;
}

function previousUserMessage(messages: AssistantConversationMessageView[], index: number) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "user") return messages[cursor] ?? null;
  }
  return null;
}

function findLastMessageIndex(messages: AssistantConversationMessageView[], role: AssistantConversationMessageView["role"]) {
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === role) return cursor;
  }
  return -1;
}

function extractSuppliedText(value: string) {
  const match = value.match(/(?:rewrite|summari[sz]e|polish|make this sound|turn this into|draft|text|notes?)\s*:?\s*([\s\S]{20,1600})$/i);
  if (match?.[1]) return safeText(match[1], 1200);
  const quoted = value.match(/["“]([^"”]{20,1600})["”]/);
  return quoted?.[1] ? safeText(quoted[1], 1200) : "";
}

function rewritePlainWorkText(value: string, instruction: string) {
  const concise = /\b(concise|shorter|brief)\b/i.test(instruction);
  const formal = /\b(professional|formal|polish)\b/i.test(instruction);
  const cleaned = safeText(value, concise ? 360 : 700).replace(/\s+/g, " ");
  if (!cleaned) return "";
  if (formal) {
    return `Thanks for the context. ${cleaned.replace(/^hey\b/i, "Hello").replace(/\bASAP\b/g, "as soon as practical")} Please let me know what timing works best.`;
  }
  return concise ? cleaned.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ") : cleaned;
}

function summarizePlainWorkText(value: string) {
  const sentences = safeText(value, 900).split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length === 0) return "";
  return sentences.slice(0, 3).join(" ");
}

function parseSources(value: Prisma.JsonValue | null): AssistantConversationSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = stringField(record.label, maxSourceTextLength);
    const detail = stringField(record.detail, maxSourceTextLength);
    const recordType = stringField(record.recordType, 80);
    if (!label || !detail || !recordType) return [];
    const href = safeHref(record.href);
    return [{ detail, href, label, recordType }];
  }).slice(0, maxSourceCount);
}

function parseDraftActions(value: Prisma.JsonValue | null): AssistantDraftAction[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AssistantDraftAction =>
    Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string")
  ).slice(0, 4);
}

function sanitizeConversationText(value: unknown) {
  if (typeof value !== "string") return "";
  return safeMultilineText(value, maxStoredMessageLength);
}

function normalizeConversationText(value: unknown) {
  if (typeof value !== "string") return "";
  return safeMultilineText(value, maxStoredMessageLength);
}

function sanitizeAssistantText(value: string) {
  return safeText(value, maxAssistantMessageLength);
}

function normalizeId(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 160) : "";
}

function stringInput(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeSearchTerm(value: string) {
  return safeText(value, 120);
}

function conversationTitle(message: string) {
  return safeText(message, 64) || "New Assistant conversation";
}

function safeText(value: unknown, maxLength = maxStoredMessageLength) {
  if (typeof value !== "string") return "";
  return redactSensitiveText(value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function safeMultilineText(value: unknown, maxLength = maxStoredMessageLength) {
  if (typeof value !== "string") return "";
  return redactSensitiveText(value)
    .trim()
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, maxLength);
}

function stringField(value: unknown, maxLength: number) {
  return typeof value === "string" ? safeText(value, maxLength) : "";
}

function safeHref(value: unknown) {
  if (typeof value !== "string") return undefined;
  if (!value.startsWith("/") || value.startsWith("/api/")) return undefined;
  return value.slice(0, 260) as Route;
}

function jsonArrayOrNull(value: unknown[]) {
  return value.length > 0 ? (value.slice(0, maxSourceCount) as Prisma.InputJsonArray) : Prisma.JsonNull;
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function formatMoney(valueCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    maximumFractionDigits: Math.abs(valueCents) % 100 === 0 ? 0 : 2,
    minimumFractionDigits: Math.abs(valueCents) % 100 === 0 ? 0 : 2,
    style: "currency"
  }).format(valueCents / 100);
}
