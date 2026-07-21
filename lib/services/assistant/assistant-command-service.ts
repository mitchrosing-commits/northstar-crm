import { createHash } from "node:crypto";

import type { WorkspaceActor } from "@/lib/services/workspace-access";
import { startOfDay } from "@/lib/activity-due";

import {
  buildAssistantDealBriefContext,
  buildAssistantDealRiskContext,
  buildAssistantEmailReplyContext,
  buildAssistantTodayContext,
  type AssistantDealBriefContext,
  type AssistantDealRiskContext,
  type AssistantDealRiskContextItem,
  type AssistantEmailReplyContext,
  type AssistantEmailReplyMessage,
  type AssistantTodayContext
} from "./assistant-context-service";
import {
  buildAssistantDraftActions,
  type AssistantDraftAction,
  type AssistantDraftCommandKind
} from "./assistant-draft-action-service";
import { assistantCrmProposalIdempotencyKey } from "./assistant-crm-change-proposal-service";
import { listCrmChangeProposals } from "@/lib/services/crm-change-proposal-service";

export type AssistantCommandKind =
  | "deal_brief"
  | "deal_risk"
  | "draft_activity"
  | "draft_ai_preferences"
  | "draft_crm_record_change"
  | "draft_contact_relationship"
  | "draft_note"
  | "draft_record_creation"
  | "email_reply_check"
  | "today"
  | "unsupported";
export type AssistantAnswerTone = "attention" | "info" | "success" | "warning";

export type AssistantAnswerItem = {
  detail: string;
  href?: string;
  label?: string;
  title: string;
  tone: AssistantAnswerTone;
};

export type AssistantAnswerSource = {
  detail: string;
  label: string;
};

export type AssistantCommandResult = {
  command: AssistantCommandKind;
  draftActions?: AssistantDraftAction[];
  generatedAt: string;
  items: AssistantAnswerItem[];
  query: string;
  reviewFirst: true;
  safetyNotice: string;
  sources: AssistantAnswerSource[];
  suggestions: string[];
  summary: string;
  title: string;
};

export type ParsedAssistantCommand = {
  intent?: AssistantDealBriefIntent;
  kind: AssistantCommandKind;
  target?: string;
};

export type AssistantDealBriefIntent =
  | "action_plan"
  | "activity"
  | "blockers"
  | "change_brief"
  | "changes"
  | "followups"
  | "next_steps"
  | "note"
  | "stakeholders"
  | "summary";

export const assistantSuggestedCommands = [
  "Tell me what I have to do today.",
  "Show me the highest-risk deals this week.",
  "Summarize the Acme renewal deal.",
  "Build a deal action plan for this deal.",
  "Give me the latest deal update for this deal.",
  "Create a reviewed next-step activity for this deal.",
  "Check whether Mike Fox replied to my recent email.",
  "Remind me to follow up with Jane Doe next Tuesday.",
  "Add a note for Jane Doe: she prefers concise email updates."
] as const;

const readOnlySafetyNotice =
  "Context-only, draft-only, and review-first: this Assistant does not create, update, delete, link, convert, close, send, sync, archive, mark read, save settings, or mutate provider mail from suggestions. Only saved eligible activity, note, contact, or organization proposals can be applied after explicit review and permission checks.";

export async function answerAssistantCommand(
  actor: WorkspaceActor,
  query: string,
  options: { now?: Date } = {}
): Promise<AssistantCommandResult> {
  const now = options.now ?? new Date();
  const parsed = parseAssistantCommand(query);
  if (parsed.kind === "today") {
    return buildTodayAssistantAnswer(await buildAssistantTodayContext(actor, now), query);
  }
  if (parsed.kind === "deal_risk") {
    return buildDealRiskAssistantAnswer(await buildAssistantDealRiskContext(actor, now), query);
  }
  if (parsed.kind === "deal_brief") {
    const context = await buildAssistantDealBriefContext(actor, parsed.target ?? "", now);
    const answer = buildDealBriefAssistantAnswer(
      context,
      query,
      parsed.intent ?? "summary",
      now
    );
    if (parsed.intent === "change_brief") {
      return enrichDealChangeBriefWithCrmProposalDrafts(actor, context, query, answer, now);
    }
    return answer;
  }
  if (parsed.kind === "email_reply_check" && parsed.target) {
    return buildEmailReplyAssistantAnswer(await buildAssistantEmailReplyContext(actor, parsed.target, now), query);
  }
  if (isDraftCommandKind(parsed.kind)) {
    return buildDraftActionAssistantAnswer(
      await buildAssistantDraftActions(actor, { kind: parsed.kind, query }, now),
      parsed.kind,
      query,
      now
    );
  }
  return buildUnsupportedAssistantAnswer(query, now);
}

export function parseAssistantCommand(query: string): ParsedAssistantCommand {
  const normalized = normalizeQuery(query);
  if (!normalized) return { kind: "unsupported" };
  if (/\b(today|to do|todo|agenda|my day|have to do|work queue)\b/.test(normalized)) return { kind: "today" };
  if (/\b(deal|deals|pipeline|opportunit(?:y|ies))\b/.test(normalized) && /\b(risk|risky|at risk|highest-risk|highest risk)\b/.test(normalized)) {
    return { kind: "deal_risk" };
  }
  if (isDealBriefQuery(normalized, query)) {
    return { kind: "deal_brief", target: extractDealBriefTarget(query), intent: dealBriefIntent(normalized) };
  }
  if (/\b(replied|reply|responded|response)\b/.test(normalized) && /\b(email|message|thread|inbox)\b/.test(normalized)) {
    const target = extractReplyTarget(query);
    return target ? { kind: "email_reply_check", target } : { kind: "unsupported" };
  }
  if (/\b(remind me|create (?:a )?(?:task|activity)|draft (?:a )?(?:task|activity)|follow up)\b/.test(normalized)) {
    return { kind: "draft_activity" };
  }
  if (/\bupdate\b/.test(normalized) && /\b(profile|relationship memory|relationship)\b/.test(normalized)) {
    return { kind: "draft_contact_relationship" };
  }
  if (/\b(?:add|create|draft|log|save)\s+(?:a\s+|this\s+)?note\b/.test(normalized)) {
    return { kind: "draft_note" };
  }
  if (
    /\b(create|update|set|change|add|link|attach|connect)\b/.test(normalized) &&
    /\b(contact|organization|company|account|email|phone|domain|website|first name|last name|title|role)\b/.test(normalized)
  ) {
    return { kind: "draft_crm_record_change" };
  }
  if (/\b(link|attach|connect)\b/.test(normalized) && /\bto\b/.test(normalized)) {
    return { kind: "draft_crm_record_change" };
  }
  if (/\bcreate\b/.test(normalized) && /\borganization\b/.test(normalized) && /\b(add|contact|person)\b/.test(normalized)) {
    return { kind: "draft_record_creation" };
  }
  if (/\b(make|set|change|update)\b/.test(normalized) && /\b(email replies|reply|replies|ai preference|assistant|tone|concise|casual|diagnostics|summaries)\b/.test(normalized)) {
    return { kind: "draft_ai_preferences" };
  }
  return { kind: "unsupported" };
}

export function buildDealBriefAssistantAnswer(
  context: AssistantDealBriefContext,
  query: string,
  intent: AssistantDealBriefIntent = "summary",
  now = new Date()
): AssistantCommandResult {
  if (!context.deal) {
    return {
      command: "deal_brief",
      generatedAt: context.generatedAt,
      items: context.candidates.length > 0
        ? context.candidates.map((candidate): AssistantAnswerItem => ({
            detail: [
              `Stage ${candidate.stageName}`,
              `Status ${candidate.status}`,
              candidate.relatedLabel ? `Related to ${candidate.relatedLabel}` : "No linked customer label"
            ].join(" · "),
            href: candidate.href,
            label: "Candidate",
            title: candidate.label,
            tone: "warning"
          }))
        : [{
            detail: context.missingInfo.join(" "),
            href: "/deals",
            label: "Missing deal",
            title: "Choose a deal before I summarize it",
            tone: "warning"
          }],
      query,
      reviewFirst: true,
      safetyNotice: readOnlySafetyNotice,
      sources: [
        { label: "Deal lookup", detail: context.target || "No deal target parsed" },
        { label: "Reviewed", detail: context.lookedAt.join(" · ") }
      ],
      suggestions: [
        "Open the deal and use “Ask Assistant about this deal.”",
        "Ask again with the exact deal name or a /deals/... link."
      ],
      summary: context.missingInfo.join(" ") || "I need a specific deal before producing a scoped deal brief.",
      title: "Clarify the deal"
    };
  }

  const sections = intent === "action_plan"
    ? dealActionPlanItems(context, now)
    : intent === "change_brief"
      ? dealChangeBriefItems(context, query, now)
      : dealBriefSections(context, intent, now);
  const draftActions = dealBriefDraftActions(context, intent, query, now);
  return {
    command: "deal_brief",
    draftActions: draftActions.length > 0 ? draftActions : undefined,
    generatedAt: context.generatedAt,
    items: sections,
    query,
    reviewFirst: true,
    safetyNotice: readOnlySafetyNotice,
    sources: dealBriefSources(context),
    suggestions: dealBriefSuggestions(context, intent),
    summary: dealBriefSummary(context, intent, draftActions.length),
    title: intent === "action_plan"
      ? `Deal action plan: ${context.deal.title}`
      : intent === "change_brief"
        ? `Deal change brief: ${context.deal.title}`
        : `Deal brief: ${context.deal.title}`
  };
}

export function buildTodayAssistantAnswer(context: AssistantTodayContext, query: string): AssistantCommandResult {
  const focus = [
    ...context.activities.filter((activity) => activity.bucket === "overdue"),
    ...context.activities.filter((activity) => activity.bucket === "today"),
    ...context.activities.filter((activity) => activity.bucket === "upcoming"),
    ...context.activities.filter((activity) => activity.bucket === "unscheduled")
  ].slice(0, 6);
  const items = focus.map((activity): AssistantAnswerItem => ({
    detail: [
      activity.dueAt ? `Due ${formatDate(activity.dueAt)}` : "No due date",
      activity.relatedLabel ? `Linked to ${activity.relatedLabel}` : "No linked CRM label visible",
      activity.type.toLowerCase()
    ].join(" · "),
    href: activity.href,
    label: bucketLabel(activity.bucket),
    title: activity.title,
    tone: activity.bucket === "overdue" ? "attention" : activity.bucket === "today" ? "warning" : "info"
  }));
  const countSummary = `${context.counts.overdue} overdue, ${context.counts.today} due today, ${context.counts.upcoming} upcoming, ${context.counts.unscheduled} unscheduled`;

  return {
    command: "today",
    generatedAt: context.generatedAt,
    items: items.length > 0
      ? items
      : [{
          detail: "No overdue, due-today, upcoming, or unscheduled open activities were found in the bounded workspace snapshot.",
          href: "/activities",
          label: "Clear",
          title: "No immediate activity queue found",
          tone: "success"
        }],
    query,
    reviewFirst: true,
    safetyNotice: readOnlySafetyNotice,
    sources: [
      { label: "Activity queue", detail: countSummary },
      { label: "Reviewed", detail: context.lookedAt.join(" · ") }
    ],
    suggestions: [...assistantSuggestedCommands],
    summary: items.length > 0
      ? `Start with overdue work, then due-today commitments. Current bounded queue: ${countSummary}.`
      : "No immediate activity queue was found. Review the Activities page before assuming there is no work outside this bounded snapshot.",
    title: "Today's Assistant agenda"
  };
}

export function buildDealRiskAssistantAnswer(context: AssistantDealRiskContext, query: string): AssistantCommandResult {
  const rankedDeals = context.deals
    .map((deal) => ({ deal, risk: dealRisk(deal, context.generatedAt) }))
    .filter(({ risk }) => risk.score > 0)
    .sort((a, b) => b.risk.score - a.risk.score || (b.deal.valueCents ?? 0) - (a.deal.valueCents ?? 0))
    .slice(0, 6);

  return {
    command: "deal_risk",
    generatedAt: context.generatedAt,
    items: rankedDeals.length > 0
      ? rankedDeals.map(({ deal, risk }): AssistantAnswerItem => ({
          detail: [
            risk.factors.join(" · "),
            deal.valueCents ? formatMoney(deal.valueCents, deal.currency) : "No value recorded",
            deal.relatedLabel ? `Related to ${deal.relatedLabel}` : `Stage ${deal.stageName}`
          ].join(" · "),
          href: deal.href,
          label: `Risk ${risk.score}`,
          title: deal.title,
          tone: risk.score >= 60 ? "attention" : risk.score >= 35 ? "warning" : "info"
        }))
      : [{
          detail: "No open deals matched the deterministic risk signals in the bounded workspace snapshot.",
          href: "/deals?status=OPEN",
          label: "Clear",
          title: "No high-risk open deals found",
          tone: "success"
        }],
    query,
    reviewFirst: true,
    safetyNotice: readOnlySafetyNotice,
    sources: [
      { label: "Open deals reviewed", detail: String(context.deals.length) },
      { label: "Risk signals", detail: "Overdue or missing follow-up, expected close timing, stale updates, and deal value." },
      { label: "Reviewed", detail: context.lookedAt.join(" · ") }
    ],
    suggestions: [...assistantSuggestedCommands],
    summary: rankedDeals.length > 0
      ? "These open deals have the strongest deterministic risk signals this week. Review the deal before changing stage, close status, owner, quote, or next activity."
      : "No high-risk open deals were detected from the current deterministic signals.",
    title: "Highest-risk deals this week"
  };
}

export function buildEmailReplyAssistantAnswer(context: AssistantEmailReplyContext, query: string): AssistantCommandResult {
  const latestOutbound = context.messages.find((message) => message.direction === "OUTBOUND");
  const inboundMessages = context.messages.filter((message) => message.direction === "INBOUND");
  const replyAfterOutbound = latestOutbound
    ? inboundMessages.find((message) => new Date(message.occurredAt).getTime() > new Date(latestOutbound.occurredAt).getTime())
    : inboundMessages[0];
  const supportingMessages = [
    ...(replyAfterOutbound ? [replyAfterOutbound] : []),
    ...(latestOutbound ? [latestOutbound] : []),
    ...inboundMessages.filter((message) => message !== replyAfterOutbound)
  ].slice(0, 5);

  return {
    command: "email_reply_check",
    generatedAt: context.generatedAt,
    items: supportingMessages.length > 0
      ? supportingMessages.map((message): AssistantAnswerItem => ({
          detail: [
            `${directionLabel(message.direction)} on ${formatDate(message.occurredAt)}`,
            message.accountLabel ? `Source account ${message.accountLabel}` : message.providerLabel ?? "Stored email log",
            participantSummary(message)
          ].filter(Boolean).join(" · "),
          label: message === replyAfterOutbound ? "Likely reply" : directionLabel(message.direction),
          title: message.subject,
          tone: message === replyAfterOutbound ? "success" : message.direction === "OUTBOUND" ? "info" : "warning"
        }))
      : [{
          detail: "No recent stored email logs matched that person or name in the bounded lookup.",
          href: "/email",
          label: "No match",
          title: "No likely reply found",
          tone: "info"
        }],
    query,
    reviewFirst: true,
    safetyNotice: readOnlySafetyNotice,
    sources: [
      { label: "Target", detail: context.target || "No target parsed" },
      { label: "Matched contacts", detail: context.matchedPeople.map((person) => person.email ? `${person.label} <${person.email}>` : person.label).join(" · ") || "No contact match; searched safe email fields by text." },
      { label: "Reviewed", detail: context.lookedAt.join(" · ") }
    ],
    suggestions: [...assistantSuggestedCommands],
    summary: emailReplySummary({ latestOutbound, messageCount: context.messages.length, replyAfterOutbound, target: context.target }),
    title: `Reply check for ${context.target || "recent email"}`
  };
}

export function buildUnsupportedAssistantAnswer(query: string, now = new Date()): AssistantCommandResult {
  return {
    command: "unsupported",
    generatedAt: now.toISOString(),
    items: assistantSuggestedCommands.map((command): AssistantAnswerItem => ({
      detail: "Supported in this review-first Assistant slice.",
      href: `/assistant?command=${encodeURIComponent(command)}`,
      label: "Try",
      title: command,
      tone: "info"
    })),
    query,
    reviewFirst: true,
    safetyNotice: readOnlySafetyNotice,
    sources: [{ label: "Supported commands", detail: "Today agenda, deal risk, stored-email reply checks, and draft-only CRM action previews." }],
    suggestions: [...assistantSuggestedCommands],
    summary: "I can answer deterministic CRM questions and draft a small set of review-first actions. Only saved eligible activity, note, contact, or organization proposals can be applied after explicit review; settings, email, sync, provider mail, and higher-risk CRM changes stay review-only.",
    title: "Try a supported Assistant command"
  };
}

export function buildDraftActionAssistantAnswer(
  draftActions: AssistantDraftAction[],
  command: AssistantDraftCommandKind,
  query: string,
  now = new Date()
): AssistantCommandResult {
  const firstDraft = draftActions[0];
  const needsClarification = draftActions.some((draft) => draft.confidence === "needs_clarification" || draft.missingInfo.length > 0);
  return {
    command,
    draftActions,
    generatedAt: now.toISOString(),
    items: draftActions.map((draft): AssistantAnswerItem => ({
      detail: [
        draft.targetLabel,
        `${draft.fields.length} proposed ${draft.fields.length === 1 ? "field" : "fields"}`,
        draft.missingInfo.length > 0 ? "Missing information needs review" : "Ready for review"
      ].join(" · "),
      href: draft.targetHref,
      label: draft.reviewLabel,
      title: draft.title,
      tone: draft.confidence === "high" ? "success" : needsClarification ? "warning" : "info"
    })),
    query,
    reviewFirst: true,
    safetyNotice: readOnlySafetyNotice,
    sources: [
      { label: "Draft status", detail: "Preview only. Save to the review queue before applying eligible activity, note, contact, or organization proposals." },
      { label: "Draft basis", detail: "Deterministic parsing plus bounded workspace record matching. No external AI provider was called." }
    ],
    suggestions: [...assistantSuggestedCommands],
    summary: needsClarification
      ? "I drafted a review-first CRM action, but it needs clarification before anyone should apply it later."
      : `I drafted ${draftSummaryNoun(firstDraft)} for review. Nothing has been saved or applied.`,
    title: "Draft action for review"
  };
}

type DealChangeComparison = {
  basis: string;
  label: string;
  missingInfo?: string;
  sinceAt: Date;
  sourceHref: string;
  sourceTitle: string;
};

type DealChangeEvent = {
  category: "Commercial changes" | "Customer signals" | "Internal actions" | "Material changes" | "Relationship changes" | "Risks/blockers";
  detail: string;
  href: string;
  occurredAt: string;
  priority: number;
  title: string;
  tone: AssistantAnswerTone;
};

function dealChangeBriefItems(context: AssistantDealBriefContext, query: string, now: Date): AssistantAnswerItem[] {
  const deal = requiredDeal(context);
  const comparison = dealChangeComparisonPoint(context, query, now);
  const events = dealChangeEvents(context, comparison.sinceAt, now);
  const missingInfo = missingDealInformation(context);
  const items: AssistantAnswerItem[] = [{
    detail: [
      `Comparison point: ${comparison.label}`,
      comparison.basis,
      comparison.missingInfo ?? "",
      "Confirmed CRM timestamps only; unchanged deal facts are omitted."
    ].filter(Boolean).join(" · "),
    href: comparison.sourceHref,
    label: "Since when",
    title: comparison.sourceTitle,
    tone: comparison.missingInfo ? "warning" : "info"
  }];

  if (events.length === 0) {
    const recent = latestMeaningfulDealEvent(context, now);
    items.push({
      detail: recent
        ? `Confirmed: no material change was found after ${formatDate(comparison.sinceAt.toISOString())}. Most recent meaningful event: ${recent.title} on ${formatDate(recent.occurredAt)}.`
        : `Confirmed: no material deal activity was found after ${formatDate(comparison.sinceAt.toISOString())}.`,
      href: recent?.href ?? deal.href,
      label: "Material changes",
      title: "No material change found",
      tone: "success"
    });
  } else {
    items.push(...[
      dealChangeSection("Material changes", events, "Confirmed deal movement", deal.href),
      dealChangeSection("Customer signals", events, "Customer-facing updates", deal.person?.href ?? deal.organization?.href ?? deal.href),
      dealChangeSection("Internal actions", events, "Internal CRM activity", deal.href),
      dealChangeSection("Commercial changes", events, "Commercial updates", deal.commercial.quotes[0]?.href ?? deal.href),
      dealChangeSection("Relationship changes", events, "Relationship context", deal.person?.href ?? deal.organization?.href ?? deal.href),
      dealChangeSection("Risks/blockers", events, "Attention needed", deal.href)
    ].filter((item): item is AssistantAnswerItem => Boolean(item)));
  }

  const recommended = changeBriefRecommendedFollowUp(context, events, now);
  items.push({
    detail: recommended,
    href: deal.href,
    label: "Recommended follow-up",
    title: "Review-first next action",
    tone: recommended.startsWith("Assistant interpretation") ? "warning" : "info"
  });

  items.push({
    detail: [
      ...missingInfo,
      comparison.missingInfo ?? "",
      events.length === 0 ? "No new customer signal, commercial event, note, meeting, activity, or material deal audit event was found in this window." : ""
    ].filter(Boolean).join(" · ") || "No major missing or uncertain context was detected for this change brief.",
    href: deal.href,
    label: "Missing/uncertain context",
    title: missingInfo.length > 0 || comparison.missingInfo ? "Verify before relying on the brief" : "Bounded context looks usable",
    tone: missingInfo.length > 0 || comparison.missingInfo ? "warning" : "success"
  });

  return items.slice(0, 9);
}

type DealChangeCrmUpdateRequest = {
  command: string;
  fieldKey: string;
  proposedValue: string;
  sourceHref: string;
  sourceLabel: string;
  sourceText: string;
  targetKey: string;
  title?: string;
};

async function enrichDealChangeBriefWithCrmProposalDrafts(
  actor: WorkspaceActor,
  context: AssistantDealBriefContext,
  query: string,
  answer: AssistantCommandResult,
  now: Date
): Promise<AssistantCommandResult> {
  if (!context.deal) return answer;
  const { conflicts, requests } = dealChangeCrmUpdateRequests(context, query, now);
  const draftGroups = await Promise.all(requests.map(async (request) => ({
    request,
    drafts: (await buildAssistantDraftActions(actor, { kind: "draft_crm_record_change", query: request.command }))
      .filter(isSupportedCrmUpdateDraft)
      .map((draft) => decorateDealChangeCrmDraft(draft, request))
  })));
  const proposalDrafts = compoundDealChangeCrmDrafts(draftGroups.flatMap((group) => group.drafts));
  const proposalStatus = proposalDrafts.length > 0
    ? await proposalStatusByDraft(actor, proposalDrafts)
    : new Map<string, Awaited<ReturnType<typeof listCrmChangeProposals>>["proposals"][number]>();
  const crmUpdateItem = proposalDrafts.length > 0
    ? dealChangeCrmUpdateItem(proposalDrafts, proposalStatus)
    : null;
  const conflictItem = conflicts.length > 0 ? dealChangeCrmConflictItem(conflicts, context.deal.href) : null;

  return {
    ...answer,
    draftActions: [...proposalDrafts, ...(answer.draftActions ?? [])].length > 0
      ? [...proposalDrafts, ...(answer.draftActions ?? [])]
      : undefined,
    items: [
      ...answer.items.slice(0, 1),
      ...(crmUpdateItem ? [crmUpdateItem] : []),
      ...answer.items.slice(1),
      ...(conflictItem ? [conflictItem] : [])
    ],
    summary: proposalDrafts.length > 0
      ? `${answer.summary} ${proposalDrafts.length} explicit contact/organization CRM update${proposalDrafts.length === 1 ? "" : "s"} can be saved to the existing review-first CRM Change Proposal flow.`
      : conflicts.length > 0
        ? `${answer.summary} I found conflicting structured CRM update evidence and did not guess.`
        : answer.summary
  };
}

function dealChangeCrmUpdateRequests(context: AssistantDealBriefContext, query: string, now: Date) {
  const comparison = dealChangeComparisonPoint(context, query, now);
  const sources = dealChangeCrmEvidenceSources(context, query, comparison.sinceAt);
  const requests = dedupeCrmUpdateRequests(sources.flatMap((source) => crmUpdateRequestsFromSource(context, source)));
  const groups = new Map<string, DealChangeCrmUpdateRequest[]>();
  for (const request of requests) {
    const key = `${request.targetKey}:${request.fieldKey}`;
    groups.set(key, [...(groups.get(key) ?? []), request]);
  }
  const conflicts = Array.from(groups.values()).filter((group) =>
    new Set(group.map((request) => normalizeComparable(request.proposedValue))).size > 1
  );
  const conflictKeys = new Set(conflicts.flatMap((group) => group.map((request) => `${request.targetKey}:${request.fieldKey}`)));
  return {
    conflicts,
    requests: requests.filter((request) => !conflictKeys.has(`${request.targetKey}:${request.fieldKey}`))
  };
}

function dealChangeCrmEvidenceSources(context: AssistantDealBriefContext, query: string, sinceAt: Date) {
  const deal = requiredDeal(context);
  return [
    ...deal.notes
      .filter((note) => isOnOrAfter(note.createdAt, sinceAt))
      .map((note) => ({
        href: deal.href,
        label: `CRM note on ${formatDate(note.createdAt)}`,
        text: note.body
      })),
    ...deal.emails
      .filter((email) => isOnOrAfter(email.occurredAt, sinceAt))
      .map((email) => ({
        href: email.href,
        label: `Stored ${email.direction.toLowerCase()} email "${email.subject}" on ${formatDate(email.occurredAt)}`,
        text: email.snippet
      })),
    ...deal.meetings
      .filter((meeting) => isOnOrAfter(meeting.updatedAt, sinceAt))
      .map((meeting) => ({
        href: meeting.activityHref ?? deal.href,
        label: `Meeting Intelligence ${meeting.status.toLowerCase()} on ${formatDate(meeting.updatedAt)}`,
        text: meeting.detail
      })),
    ...(isCrmUpdateLanguage(query)
      ? [{ href: deal.href, label: "User request", text: query }]
      : [])
  ];
}

function crmUpdateRequestsFromSource(
  context: AssistantDealBriefContext,
  source: { href: string; label: string; text: string }
): DealChangeCrmUpdateRequest[] {
  const deal = requiredDeal(context);
  const text = source.text;
  const requests: DealChangeCrmUpdateRequest[] = [];
  const linkedPersonName = deal.person?.label ?? "";
  const linkedOrganizationName = deal.organization?.name ?? "";
  const contactNames = Array.from(new Set([
    linkedPersonName,
    ...extractCapitalizedNames(text)
  ].map(cleanPossessiveCrmName).filter((name) => name.length >= 2)));
  const organizationNames = Array.from(new Set([
    linkedOrganizationName,
    ...extractOrganizationNames(text)
  ].filter((name) => name.length >= 2)));

  requests.push(...extractDirectContactFieldRequests(text, source));

  for (const name of contactNames) {
    const titleAtOrg = extractContactTitleAtOrganization(text, name);
    if (titleAtOrg) {
      requests.push(crmRequest(`Update ${name}'s title to ${titleAtOrg.title}.`, name, "title", titleAtOrg.title, source, "Contact title changed"));
      requests.push(crmRequest(`Link ${name} to ${titleAtOrg.organizationName}.`, name, "organizationId", titleAtOrg.organizationName, source, "Contact organization changed"));
      continue;
    }
    const title = extractContactFieldValue(text, name, "title");
    if (title) requests.push(crmRequest(`Update ${name}'s title to ${title}.`, name, "title", title, source, "Contact title changed"));
    const email = extractContactFieldValue(text, name, "email");
    if (email) requests.push(crmRequest(`Update ${name}'s email to ${email}.`, name, "email", email, source, "Contact email changed"));
    const phone = extractContactFieldValue(text, name, "phone");
    if (phone) requests.push(crmRequest(`Update ${name}'s phone to ${phone}.`, name, "phone", phone, source, "Contact phone changed"));
    const organizationName = extractContactOrganizationValue(text, name);
    if (organizationName) requests.push(crmRequest(`Link ${name} to ${organizationName}.`, name, "organizationId", organizationName, source, "Contact organization changed"));
  }

  for (const name of organizationNames) {
    const domain = extractOrganizationFieldValue(text, name, "domain");
    if (domain) requests.push(crmRequest(`Update ${name}'s domain to ${domain}.`, name, "domain", domain, source, "Organization domain changed"));
    const updatedName = extractOrganizationFieldValue(text, name, "name");
    if (updatedName) requests.push(crmRequest(`Update ${name}'s name to ${updatedName}.`, name, "name", updatedName, source, "Organization name changed"));
  }

  for (const contact of extractNewContactRequests(text)) {
    requests.push(crmRequest(
      `Create a contact for ${contact.name}${contact.organizationName ? ` at ${contact.organizationName}` : ""}${contact.email ? ` with email ${contact.email}` : ""}${contact.phone ? ` and phone ${contact.phone}` : ""}.`,
      contact.name,
      "create_contact",
      contact.email || contact.phone || contact.organizationName || contact.name,
      source,
      "New contact identified"
    ));
  }
  for (const organization of extractNewOrganizationRequests(text)) {
    requests.push(crmRequest(
      `Create an organization for ${organization.name}${organization.domain ? ` with domain ${organization.domain}` : ""}.`,
      organization.name,
      "create_organization",
      organization.domain || organization.name,
      source,
      "New organization identified"
    ));
  }

  return requests.filter((request) => !alreadyContainsRequestedValue(context, request));
}

function extractDirectContactFieldRequests(
  text: string,
  source: { href: string; label: string; text: string }
): DealChangeCrmUpdateRequest[] {
  return [
    ...text.matchAll(/\b(?:also,?\s+|and\s+|then\s+)?([A-Z][A-Za-z.-]+(?:\s+[A-Z][A-Za-z.-]+)*)(?:'s|’s|s)?\s+(title|role|job title|email|email address|phone|phone number)\s*(?:changed to|is now|now|updated to|new .*? is|became|as)\s+([^.;]+)/gi),
    ...text.matchAll(/\bupdate\s+([A-Z][A-Za-z.-]+(?:\s+[A-Z][A-Za-z.-]+)*)(?:'s|’s|s)?\s+(title|role|job title|email|email address|phone|phone number)\s+to\s+([^.;]+)/gi)
  ]
    .flatMap((match): DealChangeCrmUpdateRequest[] => {
      const targetName = cleanCrmEvidenceValue(match[1] ?? "");
      const rawField = (match[2] ?? "").toLowerCase();
      const rawValue = cleanCrmEvidenceValue(match[3] ?? "");
      if (!targetName || !rawValue) return [];
      if (rawField.includes("email")) {
        const email = rawValue.match(new RegExp(emailPatternSource, "i"))?.[0] ?? "";
        return email ? [crmRequest(`Update ${targetName}'s email to ${email}.`, targetName, "email", email, source, "Contact email changed")] : [];
      }
      if (rawField.includes("phone")) {
        return [crmRequest(`Update ${targetName}'s phone to ${rawValue}.`, targetName, "phone", rawValue, source, "Contact phone changed")];
      }
      return [crmRequest(`Update ${targetName}'s title to ${rawValue}.`, targetName, "title", rawValue, source, "Contact title changed")];
    });
}

function crmRequest(
  command: string,
  targetKey: string,
  fieldKey: string,
  proposedValue: string,
  source: { href: string; label: string; text: string },
  title: string
): DealChangeCrmUpdateRequest {
  return {
    command,
    fieldKey,
    proposedValue: proposedValue.trim(),
    sourceHref: source.href,
    sourceLabel: source.label,
    sourceText: source.text,
    targetKey,
    title
  };
}

function isSupportedCrmUpdateDraft(draft: AssistantDraftAction) {
  const supportedKinds = new Set(["contact_create", "contact_organization_link", "contact_update", "organization_create", "organization_update"]);
  if (!supportedKinds.has(draft.kind)) return false;
  if (draft.missingInfo.some((info) => /no supported .*field change|already contains|unsupported/i.test(info))) return false;
  return Boolean(draft.proposal || draft.confidence === "needs_clarification");
}

function decorateDealChangeCrmDraft(draft: AssistantDraftAction, request: DealChangeCrmUpdateRequest): AssistantDraftAction {
  return {
    ...draft,
    evidence: [
      `${request.sourceLabel}: ${request.sourceText}`,
      `Structured request: ${request.command}`,
      ...draft.evidence
    ],
    id: `deal-change-crm-${shortHash(`${request.command}:${request.sourceLabel}`)}`,
    title: request.title ?? draft.title,
    warnings: [
      ...draft.warnings,
      `Confirmed evidence source: ${request.sourceLabel}.`,
      "CRM Change Proposal permissions are checked server-side when saved and again at apply time."
    ]
  };
}

function compoundDealChangeCrmDrafts(drafts: AssistantDraftAction[]) {
  const used = new Set<number>();
  const result: AssistantDraftAction[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    if (used.has(index)) continue;
    const draft = drafts[index];
    if (!draft || draft.kind !== "contact_update" || !draft.proposal?.targetRecordId || draft.proposal.fields.organizationId) {
      result.push(draft);
      used.add(index);
      continue;
    }
    const linkIndex = drafts.findIndex((candidate, candidateIndex) =>
      candidateIndex !== index &&
      !used.has(candidateIndex) &&
      candidate.kind === "contact_organization_link" &&
      candidate.proposal?.targetRecordId === draft.proposal?.targetRecordId &&
      Boolean(candidate.proposal?.fields.organizationId)
    );
    const linkDraft = linkIndex >= 0 ? drafts[linkIndex] : undefined;
    if (!linkDraft?.proposal) {
      result.push(draft);
      used.add(index);
      continue;
    }
    used.add(index);
    used.add(linkIndex);
    result.push({
      ...draft,
      fields: [...draft.fields, ...linkDraft.fields],
      id: `deal-change-crm-compound-${shortHash(`${draft.id}:${linkDraft.id}`)}`,
      kind: "contact_update",
      proposal: {
        expectedCurrentValues: {
          ...(draft.proposal.expectedCurrentValues ?? {}),
          organizationId: linkDraft.proposal.expectedCurrentValues?.organizationId ?? null
        },
        fields: {
          ...draft.proposal.fields,
          organizationId: linkDraft.proposal.fields.organizationId ?? null
        },
        operation: "update_contact",
        secondaryRecordId: linkDraft.proposal.secondaryRecordId,
        targetRecordId: draft.proposal.targetRecordId
      },
      targetKind: "Contact + organization",
      title: "Propose updating contact and linking organization",
      warnings: Array.from(new Set([...draft.warnings, ...linkDraft.warnings, "This will be saved as one compound CRM Change Proposal for review."]))
    });
  }
  return result;
}

async function proposalStatusByDraft(actor: WorkspaceActor, drafts: AssistantDraftAction[]) {
  const proposals = await listCrmChangeProposals(actor);
  const byKey = new Map(proposals.proposals.map((proposal) => [proposal.idempotencyKey, proposal]));
  return new Map(drafts.flatMap((draft) => {
    if (!draft.proposal) return [];
    return [[draft.id, byKey.get(assistantCrmProposalIdempotencyKey(draft))] as const];
  }));
}

function dealChangeCrmUpdateItem(
  drafts: AssistantDraftAction[],
  proposalStatus: Map<string, Awaited<ReturnType<typeof listCrmChangeProposals>>["proposals"][number] | undefined>
): AssistantAnswerItem {
  const details = drafts.slice(0, 3).map((draft) => {
    const existing = proposalStatus.get(draft.id);
    const fieldSummary = draft.fields.map((field) =>
      `${field.label}: ${field.currentValue ?? "blank"} -> ${field.value}`
    ).join("; ");
    return [
      `${draft.title} for ${draft.targetLabel}`,
      fieldSummary,
      `Evidence: ${draft.evidence[0]}`,
      `Confidence: ${draft.confidence}`,
      existing
        ? `Existing proposal status: ${existing.status}; permission ${existing.permissionState}`
        : "Permission state: checked server-side when the proposal is saved and again at apply time",
      existing ? "Review proposal action: open existing proposal" : "Review proposal action: save this draft to CRM Change Proposals"
    ].join(". ");
  });
  return {
    detail: details.join(" "),
    href: proposalStatus.get(drafts[0]?.id ?? "")?.targetHref ?? drafts[0]?.targetHref,
    label: "CRM updates found",
    title: `${drafts.length} review-first CRM update${drafts.length === 1 ? "" : "s"}`,
    tone: drafts.some((draft) => draft.confidence === "needs_clarification") ? "warning" : "info"
  };
}

function dealChangeCrmConflictItem(conflicts: DealChangeCrmUpdateRequest[][], href: string): AssistantAnswerItem {
  return {
    detail: conflicts.slice(0, 2).map((group) =>
      `Conflicting evidence for ${group[0]?.targetKey ?? "a CRM record"} ${group[0]?.fieldKey ?? "field"}: ${group.map((request) => `${request.proposedValue} from ${request.sourceLabel}`).join(" vs ")}. No proposal was created for that field.`
    ).join(" "),
    href,
    label: "CRM update warning",
    title: "Conflicting structured evidence",
    tone: "warning"
  };
}

function dedupeCrmUpdateRequests(requests: DealChangeCrmUpdateRequest[]) {
  const seen = new Set<string>();
  return requests.filter((request) => {
    const key = `${request.command}:${request.sourceLabel}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractContactTitleAtOrganization(text: string, name: string) {
  const namePattern = escapedNamePattern(name);
  const match = text.match(new RegExp(`${namePattern}(?:'s|’s)?\\s+(?:title|role|job title)?\\s*(?:changed to|is now|now serves as|now is|became)\\s+([^.;,]+?)\\s+(?:at|with|for)\\s+([^.;,]+)`, "i"));
  if (!match) return null;
  const title = cleanCrmEvidenceValue(match[1] ?? "");
  const organizationName = cleanCrmEvidenceValue(match[2] ?? "");
  return title && organizationName ? { organizationName, title } : null;
}

function extractContactFieldValue(text: string, name: string, field: "email" | "phone" | "title") {
  const namePattern = escapedNamePattern(name);
  if (field === "email") {
    const match = text.match(new RegExp(`${namePattern}[^.;]{0,80}(?:email|email address)\\s*(?:changed to|is now|now|updated to|new email is|new email address is)\\s*(${emailPatternSource})`, "i"));
    return match?.[1] ?? "";
  }
  if (field === "phone") {
    const match = text.match(new RegExp(`${namePattern}[^.;]{0,80}(?:phone|phone number)\\s*(?:changed to|is now|now|updated to|new phone is|new phone number is)\\s*([+()\\-\\d\\s.]{7,24})`, "i"));
    return cleanCrmEvidenceValue(match?.[1] ?? "");
  }
  const titleMatch = text.match(new RegExp(`${namePattern}(?:'s|’s)?\\s+(?:title|role|job title)\\s*(?:changed to|is now|now|updated to|became|as)\\s+([^.;,]+)`, "i"));
  if (titleMatch) return cleanCrmEvidenceValue(titleMatch[1] ?? "");
  const nowMatch = text.match(new RegExp(`${namePattern}\\s+(?:is now|now serves as|became)\\s+([^.;,]+?)(?:\\s+(?:at|with|for)\\s+[^.;,]+)?[.;,]?`, "i"));
  return cleanCrmEvidenceValue(nowMatch?.[1] ?? "");
}

function extractContactOrganizationValue(text: string, name: string) {
  const namePattern = escapedNamePattern(name);
  const match = text.match(new RegExp(`${namePattern}[^.;]{0,80}(?:now belongs to|belongs to|should be linked to|is now at|moved to|joined)\\s+([^.;,]+)`, "i"));
  return cleanCrmEvidenceValue(match?.[1] ?? "");
}

function extractOrganizationFieldValue(text: string, name: string, field: "domain" | "name") {
  const namePattern = escapedNamePattern(name);
  if (field === "domain") {
    const match = text.match(new RegExp(`${namePattern}[^.;]{0,80}(?:domain|website)\\s*(?:changed to|is now|now|updated to|new domain is|new website is)\\s*([A-Za-z0-9.-]+\\.[A-Za-z]{2,})`, "i"));
    return match?.[1] ?? "";
  }
  const match = text.match(new RegExp(`${namePattern}[^.;]{0,80}(?:name)\\s*(?:changed to|is now|now|updated to|renamed to)\\s+([^.;,]+)`, "i"));
  return cleanCrmEvidenceValue(match?.[1] ?? "");
}

function extractNewContactRequests(text: string) {
  return [...text.matchAll(/\b(?:new stakeholder|new contact|add contact|create contact)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)+)(?:,\s*([^.;,]+))?(?:[^.;]*?\bemail\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}))?(?:[^.;]*?\bphone\s+([+()\-\d\s.]{7,24}))?/gi)]
    .map((match) => ({
      email: match[3] ?? "",
      name: cleanCrmEvidenceValue(match[1] ?? ""),
      organizationName: extractInlineOrganizationName(match[0] ?? ""),
      phone: cleanCrmEvidenceValue(match[4] ?? ""),
      title: cleanCrmEvidenceValue(match[2] ?? "")
    }))
    .filter((contact) => contact.name && (contact.email || contact.phone || contact.organizationName));
}

function extractNewOrganizationRequests(text: string) {
  return [...text.matchAll(/\b(?:new organization|new company|create organization)\s+([A-Z][A-Za-z0-9 &.'-]+)(?:[^.;]*?\bdomain\s+([A-Za-z0-9.-]+\.[A-Za-z]{2,}))?/gi)]
    .map((match) => ({
      domain: match[2] ?? "",
      name: cleanCrmEvidenceValue(match[1] ?? "")
    }))
    .filter((organization) => organization.name);
}

function extractInlineOrganizationName(value: string) {
  return cleanCrmEvidenceValue(value.match(/\b(?:at|with|for)\s+([A-Z][A-Za-z0-9 &.'-]+)(?:\s+with\b|\s+email\b|\s+phone\b|$)/i)?.[1] ?? "");
}

function extractCapitalizedNames(text: string) {
  return [
    ...text.matchAll(/\b([A-Z][A-Za-z.-]+(?:\s+[A-Z][A-Za-z.-]+)+)(?:'s|’s)?\s+(?:title|role|job title|email|phone|phone number|is now|now belongs to|should be linked to|moved to|joined)\b/g),
    ...text.matchAll(/\b([A-Z][A-Za-z.-]+)(?:'s|’s)\s+(?:title|role|job title|email|phone|phone number)\b/g)
  ]
    .map((match) => cleanCrmEvidenceValue(match[1] ?? ""))
    .filter((name) => !/\b(CRM|Meeting Intelligence|Source|Assistant)\b/.test(name))
    .filter((name) => !/^(Contact|Stakeholder|Organization|Company)$/i.test(name));
}

function extractOrganizationNames(text: string) {
  return [...text.matchAll(/\b([A-Z][A-Za-z0-9 &.'-]+)(?:'s|’s)?\s+(?:domain|website|name)\s+(?:changed to|is now|now|updated to|renamed to)\b/g)]
    .map((match) => cleanCrmEvidenceValue(match[1] ?? ""));
}

function alreadyContainsRequestedValue(context: AssistantDealBriefContext, request: DealChangeCrmUpdateRequest) {
  const deal = requiredDeal(context);
  if (deal.person && normalizeComparable(request.targetKey) === normalizeComparable(deal.person.label)) {
    if (request.fieldKey === "title") return sameComparable(request.proposedValue, deal.person.title);
    if (request.fieldKey === "email") return sameComparable(request.proposedValue, deal.person.email);
    if (request.fieldKey === "phone") return sameComparable(request.proposedValue, deal.person.phone);
    if (request.fieldKey === "organizationId") return sameComparable(request.proposedValue, deal.person.organizationLabel);
  }
  if (deal.organization && normalizeComparable(request.targetKey) === normalizeComparable(deal.organization.name)) {
    if (request.fieldKey === "domain") return sameComparable(request.proposedValue, deal.organization.domain);
    if (request.fieldKey === "name") return sameComparable(request.proposedValue, deal.organization.name);
  }
  return false;
}

function isCrmUpdateLanguage(value: string) {
  return /\b(update|changed to|is now|new email|new phone|belongs to|linked to|new stakeholder|new contact|new organization)\b/i.test(value);
}

const emailPatternSource = "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}";

function escapedNamePattern(value: string) {
  return value.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
}

function cleanCrmEvidenceValue(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^(?:also|and|then)\s+/i, "")
    .replace(/\b(?:from|source|because|per)\b.*$/i, "")
    .replace(/(?:'s|’s)$/i, "")
    .replace(/[.;,]+$/g, "")
    .trim()
    .slice(0, 160);
}

function cleanPossessiveCrmName(value: string) {
  return cleanCrmEvidenceValue(value).replace(/(?:'s|’s)$/i, "");
}

function sameComparable(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(normalizeComparable(left) && normalizeComparable(left) === normalizeComparable(right));
}

function normalizeComparable(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function dealChangeComparisonPoint(context: AssistantDealBriefContext, query: string, now: Date): DealChangeComparison {
  const deal = requiredDeal(context);
  const normalized = normalizeQuery(query);
  const lastSevenDays = addDays(startOfDay(now), -7);

  if (/\b(last week|last 7 days|past week)\b/.test(normalized)) {
    return {
      basis: "User requested a one-week comparison window.",
      label: `last 7 days, starting ${formatDate(lastSevenDays.toISOString())}`,
      sinceAt: lastSevenDays,
      sourceHref: deal.href,
      sourceTitle: "Last 7 days"
    };
  }

  if (/\b(yesterday)\b/.test(normalized)) {
    const yesterday = addDays(startOfDay(now), -1);
    return {
      basis: "User requested changes since yesterday.",
      label: `yesterday, starting ${formatDate(yesterday.toISOString())}`,
      sinceAt: yesterday,
      sourceHref: deal.href,
      sourceTitle: "Since yesterday"
    };
  }

  if (/\b(last meeting|since the meeting|since our meeting|since meeting)\b/.test(normalized)) {
    const meeting = latestMeetingComparisonEvent(context, now);
    if (meeting) {
      return {
        basis: "Inferred from the latest linked meeting context.",
        label: `the last meeting on ${formatDate(meeting.occurredAt)}`,
        sinceAt: new Date(meeting.occurredAt),
        sourceHref: meeting.href,
        sourceTitle: meeting.title
      };
    }
    return {
      basis: "User asked for the last meeting, but no linked meeting context was available.",
      label: `fallback last 7 days, starting ${formatDate(lastSevenDays.toISOString())}`,
      missingInfo: "No linked meeting was found, so I used the last 7 days instead.",
      sinceAt: lastSevenDays,
      sourceHref: deal.href,
      sourceTitle: "No linked meeting found"
    };
  }

  if (/\b(quote was sent|since quote|since the quote|quote sent)\b/.test(normalized)) {
    const sentQuote = [...deal.commercial.quotes]
      .filter((quote) => quote.status === "SENT")
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    if (sentQuote) {
      return {
        basis: "Inferred from the most recently updated sent quote.",
        label: `quote ${sentQuote.number} was sent or last marked sent on ${formatDate(sentQuote.updatedAt)}`,
        sinceAt: new Date(sentQuote.updatedAt),
        sourceHref: sentQuote.href,
        sourceTitle: `Quote ${sentQuote.number}`
      };
    }
    return {
      basis: "User asked for the sent quote, but no sent quote was available.",
      label: `fallback last 7 days, starting ${formatDate(lastSevenDays.toISOString())}`,
      missingInfo: "No sent quote was found, so I used the last 7 days instead.",
      sinceAt: lastSevenDays,
      sourceHref: deal.href,
      sourceTitle: "No sent quote found"
    };
  }

  if (/\b(last meaningful activity|last meaningful interaction)\b/.test(normalized)) {
    const latest = latestMeaningfulDealEvent(context, now);
    if (latest) {
      return {
        basis: "Inferred from the latest meaningful CRM event linked to this deal.",
        label: `${latest.title} on ${formatDate(latest.occurredAt)}`,
        sinceAt: new Date(latest.occurredAt),
        sourceHref: latest.href,
        sourceTitle: latest.title
      };
    }
  }

  return {
    basis: /\b(before i call|before calling|latest deal update|latest update)\b/.test(normalized)
      ? "Inferred as the last 7 days for a pre-call/latest-update view."
      : "No explicit comparison point was provided, so I used the last 7 days.",
    label: `last 7 days, starting ${formatDate(lastSevenDays.toISOString())}`,
    sinceAt: lastSevenDays,
    sourceHref: deal.href,
    sourceTitle: "Latest deal update"
  };
}

function dealChangeEvents(context: AssistantDealBriefContext, sinceAt: Date, now: Date): DealChangeEvent[] {
  const deal = requiredDeal(context);
  const events: DealChangeEvent[] = [];
  for (const activity of deal.activities) {
    if (isOnOrAfter(activity.createdAt, sinceAt)) {
      events.push({
        category: "Internal actions",
        detail: `Confirmed: activity was created ${formatDate(activity.createdAt)}${activity.dueAt ? ` and is due ${formatDate(activity.dueAt)}` : ""}${activity.ownerLabel ? `; owner ${activity.ownerLabel}` : ""}.`,
        href: activity.href,
        occurredAt: activity.createdAt,
        priority: 60,
        title: `Activity created: ${activity.title}`,
        tone: "info"
      });
    }
    if (activity.completedAt && isOnOrAfter(activity.completedAt, sinceAt)) {
      events.push({
        category: "Internal actions",
        detail: `Confirmed: activity completed ${formatDate(activity.completedAt)}. ${activity.description ?? "No safe description was stored."}`,
        href: activity.href,
        occurredAt: activity.completedAt,
        priority: 70,
        title: `Activity completed: ${activity.title}`,
        tone: "success"
      });
    }
    if (activity.dueAt && !activity.completedAt && new Date(activity.dueAt).getTime() < startOfDay(now).getTime() && (isOnOrAfter(activity.dueAt, sinceAt) || isOnOrAfter(activity.updatedAt, sinceAt))) {
      events.push({
        category: "Risks/blockers",
        detail: `Confirmed: open activity is overdue since ${formatDate(activity.dueAt)}${activity.ownerLabel ? `; owner ${activity.ownerLabel}` : ""}.`,
        href: activity.href,
        occurredAt: activity.updatedAt,
        priority: 95,
        title: `Overdue activity: ${activity.title}`,
        tone: "warning"
      });
    }
  }

  for (const note of deal.notes.filter((note) => isOnOrAfter(note.createdAt, sinceAt))) {
    events.push({
      category: "Internal actions",
      detail: `Confirmed CRM note on ${formatDate(note.createdAt)}: ${note.body}`,
      href: deal.href,
      occurredAt: note.createdAt,
      priority: 55,
      title: "CRM note added",
      tone: "info"
    });
  }

  for (const email of deal.emails.filter((email) => isOnOrAfter(email.occurredAt, sinceAt))) {
    const inbound = email.direction === "INBOUND";
    events.push({
      category: inbound ? "Customer signals" : "Internal actions",
      detail: `Confirmed ${email.direction.toLowerCase()} stored email on ${formatDate(email.occurredAt)}. ${email.participantSummary}. Snippet: ${email.snippet}`,
      href: email.href,
      occurredAt: email.occurredAt,
      priority: inbound ? 90 : 62,
      title: email.subject,
      tone: inbound ? "warning" : "info"
    });
  }

  for (const meeting of deal.meetings.filter((meeting) => isOnOrAfter(meeting.updatedAt, sinceAt))) {
    events.push({
      category: "Customer signals",
      detail: `Confirmed Meeting Intelligence ${meeting.status.toLowerCase()} on ${formatDate(meeting.updatedAt)}: ${meeting.detail}`,
      href: meeting.activityHref ?? deal.href,
      occurredAt: meeting.updatedAt,
      priority: 88,
      title: meeting.activityTitle ?? "Meeting context updated",
      tone: "info"
    });
  }

  for (const quote of deal.commercial.quotes.filter((quote) => isOnOrAfter(quote.updatedAt, sinceAt) || isOnOrAfter(quote.createdAt, sinceAt))) {
    events.push({
      category: "Commercial changes",
      detail: `Confirmed: quote ${quote.number} is ${quote.status} for ${formatMoney(quote.totalCents, deal.commercial.currency)}; last updated ${formatDate(quote.updatedAt)}.`,
      href: quote.href,
      occurredAt: quote.updatedAt,
      priority: quote.status === "SENT" ? 92 : 75,
      title: `Quote ${quote.number}`,
      tone: quote.status === "SENT" ? "warning" : "info"
    });
  }

  for (const lineItem of deal.commercial.lineItems.filter((item) => isOnOrAfter(item.updatedAt, sinceAt) || isOnOrAfter(item.createdAt, sinceAt))) {
    events.push({
      category: "Commercial changes",
      detail: `Confirmed: ${lineItem.quantity} x ${lineItem.productName} totals ${formatMoney(lineItem.lineTotalCents, deal.commercial.currency)}${lineItem.description ? `; ${lineItem.description}` : ""}.`,
      href: deal.href,
      occurredAt: lineItem.updatedAt,
      priority: 68,
      title: "Line item changed",
      tone: "info"
    });
  }

  for (const event of deal.auditEvents.filter((event) => isOnOrAfter(event.createdAt, sinceAt) && isMaterialAuditAction(event.action))) {
    events.push({
      category: "Material changes",
      detail: `Confirmed: ${formatAuditAction(event.action)} on ${formatDate(event.createdAt)}${event.actorLabel ? ` by ${event.actorLabel}` : ""}. Raw audit metadata was not included.`,
      href: deal.href,
      occurredAt: event.createdAt,
      priority: 82,
      title: formatAuditAction(event.action),
      tone: "info"
    });
  }

  if (deal.person && isOnOrAfter(deal.person.updatedAt, sinceAt)) {
    events.push({
      category: "Relationship changes",
      detail: `Confirmed: linked contact ${deal.person.label} was updated ${formatDate(deal.person.updatedAt)}${deal.person.relationshipBusinessConcerns ? `; relationship risk: ${deal.person.relationshipBusinessConcerns}` : ""}.`,
      href: deal.person.href,
      occurredAt: deal.person.updatedAt,
      priority: 66,
      title: `Contact updated: ${deal.person.label}`,
      tone: deal.person.relationshipBusinessConcerns ? "warning" : "info"
    });
  }

  if (deal.organization && isOnOrAfter(deal.organization.updatedAt, sinceAt)) {
    events.push({
      category: "Relationship changes",
      detail: `Confirmed: linked organization ${deal.organization.name} was updated ${formatDate(deal.organization.updatedAt)}${deal.organization.ownerLabel ? `; owner ${deal.organization.ownerLabel}` : ""}.`,
      href: deal.organization.href,
      occurredAt: deal.organization.updatedAt,
      priority: 64,
      title: `Organization updated: ${deal.organization.name}`,
      tone: "info"
    });
  }

  return events
    .sort((a, b) => b.priority - a.priority || new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .filter((event, index, all) => all.findIndex((candidate) => candidate.category === event.category && candidate.title === event.title && candidate.occurredAt === event.occurredAt) === index)
    .slice(0, 12);
}

function dealChangeSection(
  category: DealChangeEvent["category"],
  events: DealChangeEvent[],
  title: string,
  fallbackHref: string
): AssistantAnswerItem | null {
  const matching = events.filter((event) => event.category === category).slice(0, 2);
  if (matching.length === 0) return null;
  return {
    detail: matching.map((event) => `${event.title}: ${event.detail}`).join(" "),
    href: matching[0]?.href ?? fallbackHref,
    label: category,
    title,
    tone: matching.some((event) => event.tone === "warning") ? "warning" : matching.some((event) => event.tone === "success") ? "success" : "info"
  };
}

function changeBriefRecommendedFollowUp(context: AssistantDealBriefContext, events: DealChangeEvent[], now: Date) {
  const deal = requiredDeal(context);
  if (deal.status !== "OPEN") return "Informational only: the deal is not open, so no follow-up draft was prepared.";
  const risks = events.filter((event) => event.category === "Risks/blockers");
  const customerSignals = events.filter((event) => event.category === "Customer signals");
  const sentQuote = deal.commercial.quotes.find((quote) => quote.status === "SENT");
  if (!hasOpenDealFollowUp(context) && (risks.length > 0 || customerSignals.length > 0 || sentQuote)) {
    return `Assistant interpretation: prepare one reviewed follow-up activity tied to this deal. Evidence: ${(risks[0] ?? customerSignals[0])?.title ?? `quote ${sentQuote?.number}`} needs attention. Due date, if saved, is an Assistant recommendation for review.`;
  }
  if (hasOpenDealFollowUp(context)) return "Confirmed: an open deal activity already exists, so review that commitment before adding another follow-up.";
  return `Informational only: no strong new signal after ${formatDate(addDays(startOfDay(now), -7).toISOString())} required a follow-up draft.`;
}

function latestMeetingComparisonEvent(context: AssistantDealBriefContext, now: Date): DealChangeEvent | null {
  const deal = requiredDeal(context);
  const candidates: DealChangeEvent[] = [
    ...deal.meetings.map((meeting) => ({
      category: "Customer signals" as const,
      detail: meeting.detail,
      href: meeting.activityHref ?? deal.href,
      occurredAt: meeting.updatedAt,
      priority: 1,
      title: meeting.activityTitle ?? "Latest meeting context",
      tone: "info" as const
    })),
    ...deal.activities
      .filter((activity) => activity.type === "MEETING" && (activity.completedAt || activity.updatedAt))
      .map((activity) => ({
        category: "Customer signals" as const,
        detail: activity.description ?? "Meeting activity",
        href: activity.href,
        occurredAt: activity.completedAt ?? activity.updatedAt,
        priority: 1,
        title: activity.title,
        tone: "info" as const
      }))
  ];
  return latestEventBefore(candidates, now);
}

function latestMeaningfulDealEvent(context: AssistantDealBriefContext, now: Date): DealChangeEvent | null {
  const deal = requiredDeal(context);
  const events: DealChangeEvent[] = [
    ...deal.emails.map((email) => ({
      category: email.direction === "INBOUND" ? "Customer signals" as const : "Internal actions" as const,
      detail: email.snippet,
      href: email.href,
      occurredAt: email.occurredAt,
      priority: 1,
      title: email.subject,
      tone: "info" as const
    })),
    ...deal.notes.map((note) => ({
      category: "Internal actions" as const,
      detail: note.body,
      href: deal.href,
      occurredAt: note.createdAt,
      priority: 1,
      title: "CRM note added",
      tone: "info" as const
    })),
    ...deal.meetings.map((meeting) => ({
      category: "Customer signals" as const,
      detail: meeting.detail,
      href: meeting.activityHref ?? deal.href,
      occurredAt: meeting.updatedAt,
      priority: 1,
      title: meeting.activityTitle ?? "Meeting context updated",
      tone: "info" as const
    })),
    ...deal.commercial.quotes.map((quote) => ({
      category: "Commercial changes" as const,
      detail: quote.status,
      href: quote.href,
      occurredAt: quote.updatedAt,
      priority: 1,
      title: `Quote ${quote.number}`,
      tone: "info" as const
    })),
    ...deal.activities.map((activity) => ({
      category: "Internal actions" as const,
      detail: activity.description ?? activity.title,
      href: activity.href,
      occurredAt: activity.completedAt ?? activity.updatedAt,
      priority: 1,
      title: activity.title,
      tone: "info" as const
    })),
    ...deal.auditEvents.filter((event) => isMaterialAuditAction(event.action)).map((event) => ({
      category: "Material changes" as const,
      detail: formatAuditAction(event.action),
      href: deal.href,
      occurredAt: event.createdAt,
      priority: 1,
      title: formatAuditAction(event.action),
      tone: "info" as const
    }))
  ];
  return latestEventBefore(events, now);
}

function latestEventBefore(events: DealChangeEvent[], now: Date) {
  return events
    .filter((event) => new Date(event.occurredAt).getTime() <= now.getTime())
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())[0] ?? null;
}

function isOnOrAfter(value: string, sinceAt: Date) {
  return new Date(value).getTime() > sinceAt.getTime();
}

function isMaterialAuditAction(action: string) {
  return /\b(deal|stage|status|quote|line|product|activity|note|meeting|relationship|contact|organization)\b/i.test(action) &&
    !/\b(view|read|token|provider|sync cursor|diagnostic)\b/i.test(action);
}

function formatAuditAction(action: string) {
  return action
    .replace(/[_:.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Deal updated";
}

function dealBriefSections(
  context: AssistantDealBriefContext,
  intent: AssistantDealBriefIntent,
  now: Date
): AssistantAnswerItem[] {
  const deal = context.deal;
  if (!deal) return [];
  const openActivities = deal.activities.filter((activity) => !activity.completedAt);
  const completedActivities = deal.activities.filter((activity) => activity.completedAt);
  const blockers = dealBriefBlockers(context, now);
  const stakeholderDetail = [
    deal.person ? `Contact ${deal.person.label}${deal.person.title ? `, ${deal.person.title}` : ""}` : "No primary contact linked",
    deal.organization ? `Organization ${deal.organization.name}` : "No organization linked",
    deal.person?.relationshipCommunicationStyle ? `Communication style: ${deal.person.relationshipCommunicationStyle}` : "",
    deal.person?.relationshipBusinessConcerns ? `Relationship risk: ${deal.person.relationshipBusinessConcerns}` : ""
  ].filter(Boolean).join(" · ");
  const commercialDetail = [
    deal.commercial.valueCents ? `Value ${formatMoney(deal.commercial.valueCents, deal.commercial.currency)}` : "No value recorded",
    deal.expectedCloseAt ? `Expected close ${formatDate(deal.expectedCloseAt)}` : "No expected close recorded",
    deal.commercial.quotes.length > 0
      ? `${deal.commercial.quotes.length} quote${deal.commercial.quotes.length === 1 ? "" : "s"}; latest ${deal.commercial.quotes[0].status}`
      : "No quotes recorded",
    deal.commercial.lineItems.length > 0
      ? `${deal.commercial.lineItems.length} line item${deal.commercial.lineItems.length === 1 ? "" : "s"}`
      : "No line items recorded"
  ].join(" · ");
  const sections: AssistantAnswerItem[] = [
    {
      detail: [
        `Confirmed: ${deal.status} deal in ${deal.stageName}`,
        `Owner ${deal.ownerLabel}`,
        `Updated ${formatDate(deal.updatedAt)}`
      ].join(" · "),
      href: deal.href,
      label: "Current state",
      title: deal.title,
      tone: "info"
    },
    {
      detail: recentDevelopments(context),
      href: deal.href,
      label: "Recent developments",
      title: "Latest visible movement",
      tone: deal.emails.length + deal.notes.length + completedActivities.length + deal.auditEvents.length > 0 ? "info" : "warning"
    },
    {
      detail: blockers.length > 0 ? blockers.join(" · ") : "No deterministic blocker signal was found in the bounded deal snapshot.",
      href: deal.href,
      label: "Risks/blockers",
      title: blockers.length > 0 ? "Review these before the next customer touch" : "No strong blocker signal",
      tone: blockers.length > 0 ? "warning" : "success"
    },
    {
      detail: stakeholderDetail,
      href: deal.person?.href ?? deal.organization?.href ?? deal.href,
      label: "Stakeholders",
      title: deal.person?.label ?? deal.organization?.name ?? "No stakeholder linked",
      tone: deal.person || deal.organization ? "info" : "warning"
    },
    {
      detail: commercialDetail,
      href: deal.commercial.quotes[0]?.href ?? deal.href,
      label: "Commercial context",
      title: deal.commercial.quotes[0] ? `Latest quote ${deal.commercial.quotes[0].number}` : "Deal commercial snapshot",
      tone: deal.commercial.valueCents || deal.commercial.quotes.length > 0 || deal.commercial.lineItems.length > 0 ? "info" : "warning"
    },
    {
      detail: openActivities.length > 0
        ? openActivities.slice(0, 3).map((activity) => `${activity.title}${activity.dueAt ? ` due ${formatDate(activity.dueAt)}` : " with no due date"}`).join(" · ")
        : "No open commitments or next-step activities are linked to this deal.",
      href: deal.href,
      label: "Open commitments",
      title: openActivities.length > 0 ? `${openActivities.length} open activity${openActivities.length === 1 ? "" : "ies"}` : "No open deal activity",
      tone: openActivities.length > 0 ? "info" : "warning"
    },
    {
      detail: recommendedNextSteps(context, intent, now).join(" · "),
      href: deal.href,
      label: "Recommended next steps",
      title: "Review-first next actions",
      tone: "info"
    },
    {
      detail: missingDealInformation(context).join(" · ") || "No major missing fields were detected in this bounded brief.",
      href: deal.href,
      label: "Missing/uncertain info",
      title: "Fields to verify",
      tone: missingDealInformation(context).length > 0 ? "warning" : "success"
    }
  ];

  if (intent === "blockers") return sections.filter((section) => ["Current state", "Risks/blockers", "Open commitments", "Recommended next steps", "Missing/uncertain info"].includes(section.label ?? ""));
  if (intent === "stakeholders") return sections.filter((section) => ["Current state", "Stakeholders", "Risks/blockers", "Recommended next steps"].includes(section.label ?? ""));
  if (intent === "changes") return sections.filter((section) => ["Current state", "Recent developments", "Open commitments", "Missing/uncertain info"].includes(section.label ?? ""));
  if (intent === "next_steps" || intent === "activity" || intent === "followups") return sections.filter((section) => ["Current state", "Risks/blockers", "Open commitments", "Recommended next steps"].includes(section.label ?? ""));
  if (intent === "note") return sections.filter((section) => ["Current state", "Recent developments", "Risks/blockers", "Stakeholders", "Commercial context", "Open commitments"].includes(section.label ?? ""));
  return sections;
}

function dealBriefDraftActions(
  context: AssistantDealBriefContext,
  intent: AssistantDealBriefIntent,
  query: string,
  now: Date
): AssistantDraftAction[] {
  const actions: AssistantDraftAction[] = [];
  if (!context.deal) return actions;
  if (intent === "action_plan") {
    if (shouldDraftActionPlanActivity(context)) actions.push(dealActionPlanActivityDraft(context, now));
    if (shouldDraftActionPlanNote(context)) actions.push(dealActionPlanNoteDraft(context, now));
    return actions;
  }
  if (intent === "change_brief") {
    const events = dealChangeEvents(context, dealChangeComparisonPoint(context, query, now).sinceAt, now);
    if (shouldDraftChangeBriefActivity(context, events)) actions.push(dealChangeBriefActivityDraft(context, now, events));
    if (shouldDraftChangeBriefNote(context, events)) actions.push(dealChangeBriefNoteDraft(context, query, now));
    return actions;
  }
  if ((intent === "activity" || intent === "followups") && !hasOpenDealFollowUp(context)) {
    actions.push(dealFollowUpDraftAction(context, now));
  }
  if (intent === "note" && !hasRecentSimilarDealNote(context)) {
    actions.push(dealSituationNoteDraftAction(context));
  }
  return actions;
}

function dealActionPlanItems(context: AssistantDealBriefContext, now: Date): AssistantAnswerItem[] {
  const deal = requiredDeal(context);
  const blockers = dealBriefBlockers(context, now);
  const openActivities = deal.activities.filter((activity) => !activity.completedAt);
  const sentQuote = deal.commercial.quotes.find((quote) => quote.status === "SENT");
  const missingInfo = missingDealInformation(context);
  const items: AssistantAnswerItem[] = [];

  if (sentQuote && !hasSimilarOpenActivity(context, "quote")) {
    items.push(actionPlanItem({
      actionType: "Can prepare activity draft",
      confidence: "High confidence",
      detail: `Recommendation: follow up on sent quote ${sentQuote.number}. Evidence: quote ${sentQuote.number} is SENT and was updated ${formatDate(sentQuote.updatedAt)}. Owner: ${deal.ownerLabel}. Due: recommended next day for review, not a confirmed customer commitment.`,
      href: sentQuote.href,
      label: "Immediate follow-ups",
      title: `Follow up on quote ${sentQuote.number}`,
      tone: "warning"
    }));
  } else if (!hasOpenDealFollowUp(context) && deal.status === "OPEN") {
    items.push(actionPlanItem({
      actionType: "Can prepare activity draft",
      confidence: "High confidence",
      detail: `Recommendation: create one reviewed next-step activity. Evidence: no open activity is linked to this open deal. Owner: ${deal.ownerLabel}. Due: recommended next day for review, not a confirmed customer commitment.`,
      href: deal.href,
      label: "Immediate follow-ups",
      title: `Confirm next step for ${deal.title}`,
      tone: "warning"
    }));
  } else {
    items.push(actionPlanItem({
      actionType: "Informational only",
      confidence: "High confidence",
      detail: openActivities.length > 0
        ? `Confirmed: existing open activity already covers follow-up review: ${openActivities[0].title}${openActivities[0].dueAt ? ` due ${formatDate(openActivities[0].dueAt)}` : ""}. No duplicate draft prepared.`
        : "No immediate follow-up draft was prepared.",
      href: deal.href,
      label: "Immediate follow-ups",
      title: "Review existing follow-up coverage",
      tone: openActivities.length > 0 ? "info" : "success"
    }));
  }

  if (openActivities.length > 0) {
    items.push(actionPlanItem({
      actionType: "Informational only",
      confidence: "Confirmed",
      detail: openActivities.slice(0, 2).map((activity) => `Confirmed commitment: ${activity.title}${activity.dueAt ? ` due ${formatDate(activity.dueAt)}` : " with no due date"}${activity.ownerLabel ? ` owned by ${activity.ownerLabel}` : ""}.`).join(" "),
      href: deal.href,
      label: "Customer commitments",
      title: "Review open commitments",
      tone: "info"
    }));
  } else {
    items.push(actionPlanItem({
      actionType: "Informational only",
      confidence: "High confidence",
      detail: "No open customer commitments are linked as activities in this bounded deal snapshot.",
      href: deal.href,
      label: "Customer commitments",
      title: "No open commitments found",
      tone: "warning"
    }));
  }

  if (shouldDraftActionPlanNote(context)) {
    items.push(actionPlanItem({
      actionType: "Can prepare CRM note draft",
      confidence: deal.notes.length + deal.emails.length + deal.meetings.length > 0 ? "High confidence" : "Medium confidence",
      detail: "Recommendation: save a concise CRM note with durable deal context. Evidence: this plan uses scoped deal fields, recent notes, stored emails, quotes, meeting context, and Relationship Memory where present.",
      href: deal.href,
      label: "Internal actions",
      title: "Capture current deal situation",
      tone: "info"
    }));
  } else {
    items.push(actionPlanItem({
      actionType: "Informational only",
      confidence: "High confidence",
      detail: "A recent Assistant deal-situation note already appears to exist. No duplicate note draft prepared.",
      href: deal.href,
      label: "Internal actions",
      title: "Existing situation note found",
      tone: "success"
    }));
  }

  items.push(actionPlanItem({
    actionType: "Informational only",
    confidence: missingInfo.length > 0 ? "High confidence" : "Confirmed",
    detail: missingInfo.length > 0
      ? `Missing information: ${missingInfo.join("; ")}. Add or verify these on the relevant CRM record before relying on the plan.`
      : "No major missing deal fields were detected in this bounded snapshot.",
    href: deal.href,
    label: "Missing information",
    title: missingInfo.length > 0 ? "Fill in missing deal context" : "Core deal context present",
    tone: missingInfo.length > 0 ? "warning" : "success"
  }));

  if (deal.person?.relationshipBusinessConcerns || deal.person?.relationshipFollowUpReminders) {
    items.push(actionPlanItem({
      actionType: "Informational only",
      confidence: "Confirmed",
      detail: [
        deal.person.relationshipBusinessConcerns ? `Relationship risk: ${deal.person.relationshipBusinessConcerns}.` : "",
        deal.person.relationshipFollowUpReminders ? `Follow-up reminder: ${deal.person.relationshipFollowUpReminders}.` : ""
      ].filter(Boolean).join(" "),
      href: deal.person.href,
      label: "Relationship risks",
      title: `Review relationship context for ${deal.person.label}`,
      tone: "warning"
    }));
  } else {
    items.push(actionPlanItem({
      actionType: "Informational only",
      confidence: "Low uncertainty",
      detail: "No Relationship Memory risk or follow-up reminder was present for the linked contact.",
      href: deal.person?.href ?? deal.organization?.href ?? deal.href,
      label: "Relationship risks",
      title: "No relationship risk recorded",
      tone: "info"
    }));
  }

  items.push(actionPlanItem({
    actionType: sentQuote && !hasSimilarOpenActivity(context, "quote") ? "Can prepare activity draft" : "Informational only",
    confidence: sentQuote ? "High confidence" : "Medium confidence",
    detail: sentQuote
      ? `Confirmed commercial attention: quote ${sentQuote.number} is ${sentQuote.status} for ${formatMoney(sentQuote.totalCents, deal.commercial.currency)}. ${hasSimilarOpenActivity(context, "quote") ? "Similar open quote follow-up already exists, so no duplicate draft is prepared." : "A reviewed follow-up draft can cover this item."}`
      : `${deal.commercial.quotes.length} quotes and ${deal.commercial.lineItems.length} line items were reviewed; no sent quote needs follow-up.`,
    href: sentQuote?.href ?? deal.href,
    label: "Commercial attention",
    title: sentQuote ? `Review quote ${sentQuote.number}` : "No sent quote follow-up detected",
    tone: sentQuote ? "warning" : "info"
  }));

  items.push(actionPlanItem({
    actionType: "Informational only",
    confidence: blockers.length > 0 ? "Medium confidence" : "Low uncertainty",
    detail: blockers.length > 0
      ? `Longer-term recommendation: resolve the top blocker before changing deal stage, forecast, or quote terms. Evidence: ${blockers.slice(0, 2).join(" · ")}.`
      : "No longer-term deterministic blocker was found; revisit after the next customer touch or CRM update.",
    href: deal.href,
    label: "Longer-term next steps",
    title: blockers.length > 0 ? "Resolve blocker before stage movement" : "Revisit after next customer touch",
    tone: blockers.length > 0 ? "warning" : "info"
  }));

  return items.slice(0, 7);
}

function actionPlanItem(input: AssistantAnswerItem & { actionType: string; confidence: string }): AssistantAnswerItem {
  return {
    detail: `${input.actionType}. ${input.confidence}. ${input.detail}`,
    href: input.href,
    label: input.label,
    title: input.title,
    tone: input.tone
  };
}

function dealFollowUpDraftAction(context: AssistantDealBriefContext, now: Date): AssistantDraftAction {
  const deal = requiredDeal(context);
  const dueAt = addDays(startOfDay(now), 1);
  const blockers = dealBriefBlockers(context, now);
  const description = [
    `Review ${deal.title} before the next customer touch.`,
    blockers[0] ? `Evidence: ${blockers[0]}` : "Evidence: no open next-step activity was found in this deal brief.",
    deal.emails[0] ? `Latest stored email: ${deal.emails[0].subject} on ${formatDate(deal.emails[0].occurredAt)}.` : "",
    "Due date is a recommendation for review, not a confirmed customer commitment."
  ].filter(Boolean).join(" ");

  return {
    applyState: "disabled",
    candidates: [],
    confidence: "high",
    evidence: [`Deal brief for ${deal.title}`, ...blockers.slice(0, 3)],
    fields: [
      { label: "Title", value: followUpTitle(context) },
      { label: "Type", value: "Task" },
      { label: "Due date", value: formatDate(dueAt.toISOString()) },
      { label: "Description", value: description },
      { label: "Related record", value: deal.title }
    ],
    id: `deal-follow-up-${deal.id}`,
    kind: "activity",
    missingInfo: [],
    reviewLabel: "Draft only",
    targetHref: deal.href,
    targetKind: "Activity",
    targetLabel: deal.title,
    title: "Draft deal follow-up activity",
    warnings: ["Review the recommended due date before applying. The Assistant did not confirm a customer commitment."]
  };
}

function dealActionPlanActivityDraft(context: AssistantDealBriefContext, now: Date): AssistantDraftAction {
  const deal = requiredDeal(context);
  const sentQuote = deal.commercial.quotes.find((quote) => quote.status === "SENT");
  const dueAt = addDays(startOfDay(now), 1);
  const title = sentQuote ? `Follow up on quote ${sentQuote.number}` : `Confirm next step for ${deal.title}`;
  const evidence = [
    sentQuote ? `Quote ${sentQuote.number} is SENT` : "No open next-step activity is linked to this open deal",
    deal.expectedCloseAt ? `Expected close ${formatDate(deal.expectedCloseAt)}` : "",
    deal.ownerLabel !== "Unassigned" ? `Deal owner ${deal.ownerLabel}` : ""
  ].filter(Boolean);

  return {
    applyState: "disabled",
    candidates: [],
    confidence: "high",
    evidence: [`Deal action plan for ${deal.title}`, ...evidence],
    fields: [
      { label: "Title", value: title },
      { label: "Type", value: "Task" },
      { label: "Due date", value: formatDate(dueAt.toISOString()) },
      {
        label: "Description",
        value: [
          `Review ${deal.title} and complete the next customer follow-up.`,
          `Evidence: ${evidence.join("; ") || "bounded deal action plan"}.`,
          "Due date is an Assistant recommendation for review, not a confirmed customer commitment."
        ].join(" ")
      },
      { label: "Related record", value: deal.title }
    ],
    id: `deal-action-plan-activity-${deal.id}`,
    kind: "activity",
    missingInfo: [],
    reviewLabel: "Draft only",
    targetHref: deal.href,
    targetKind: "Activity",
    targetLabel: deal.title,
    title: "Prepare action-plan activity",
    warnings: ["Review owner and due date before applying. The Assistant did not create or confirm a customer commitment."]
  };
}

function dealActionPlanNoteDraft(context: AssistantDealBriefContext, now: Date): AssistantDraftAction {
  const deal = requiredDeal(context);
  const items = dealActionPlanItems(context, now);
  const body = [
    `Deal action plan for ${deal.title}`,
    "Source: Assistant deal action plan from stored CRM, quote, activity, note, email, meeting, and relationship context.",
    `Current state: ${deal.status} in ${deal.stageName}; owner ${deal.ownerLabel}.`,
    ...items.slice(0, 6).map((item) => `${item.label}: ${item.title}. ${item.detail}`)
  ].join("\n").slice(0, 1_400);

  return {
    applyState: "disabled",
    candidates: [],
    confidence: "high",
    evidence: [`Deal action plan for ${deal.title}`],
    fields: [
      { label: "Body", value: body },
      { label: "Related record", value: deal.title }
    ],
    id: `deal-action-plan-note-${deal.id}`,
    kind: "note",
    missingInfo: [],
    reviewLabel: "Draft only",
    targetHref: deal.href,
    targetKind: "Note",
    targetLabel: deal.title,
    title: "Prepare action-plan CRM note",
    warnings: ["Review for durable CRM value before saving. This is an action-plan summary, not a transcript."]
  };
}

function dealChangeBriefActivityDraft(context: AssistantDealBriefContext, now: Date, events: DealChangeEvent[]): AssistantDraftAction {
  const deal = requiredDeal(context);
  const dueAt = addDays(startOfDay(now), 1);
  const topSignal = events.find((event) => event.category === "Risks/blockers" || event.category === "Customer signals" || event.category === "Commercial changes");
  const description = [
    `Review latest changes on ${deal.title} and confirm the next customer-safe step.`,
    topSignal ? `Evidence: ${topSignal.title} (${topSignal.category}) on ${formatDate(topSignal.occurredAt)}.` : "Evidence: Assistant deal change brief from bounded CRM context.",
    deal.commercial.quotes.find((quote) => quote.status === "SENT") ? "A sent quote is present; check the quote record before outreach." : "",
    "Due date is an Assistant recommendation for review, not a confirmed customer commitment."
  ].filter(Boolean).join(" ");

  return {
    applyState: "disabled",
    candidates: [],
    confidence: topSignal ? "high" : "medium",
    evidence: [`Deal change brief for ${deal.title}`, ...(topSignal ? [topSignal.detail] : [])],
    fields: [
      { label: "Title", value: `Follow up on latest changes for ${deal.title}` },
      { label: "Type", value: "Task" },
      { label: "Due date", value: formatDate(dueAt.toISOString()) },
      { label: "Description", value: description },
      { label: "Related record", value: deal.title }
    ],
    id: `deal-change-brief-activity-${deal.id}`,
    kind: "activity",
    missingInfo: [],
    reviewLabel: "Draft only",
    targetHref: deal.href,
    targetKind: "Activity",
    targetLabel: deal.title,
    title: "Prepare change-brief follow-up",
    warnings: ["Review the evidence, owner, and due date before applying. The Assistant did not confirm a customer commitment."]
  };
}

function dealChangeBriefNoteDraft(context: AssistantDealBriefContext, query: string, now: Date): AssistantDraftAction {
  const deal = requiredDeal(context);
  const items = dealChangeBriefItems(context, query, now);
  const body = [
    `Deal change brief for ${deal.title}`,
    "Source: Assistant deal change brief from stored CRM, quote, activity, note, email, meeting, relationship, and audit context.",
    ...items.slice(0, 7).map((item) => `${item.label}: ${item.title}. ${item.detail}`)
  ].join("\n").slice(0, 1_400);

  return {
    applyState: "disabled",
    candidates: [],
    confidence: "high",
    evidence: [`Deal change brief for ${deal.title}`],
    fields: [
      { label: "Body", value: body },
      { label: "Related record", value: deal.title }
    ],
    id: `deal-change-brief-note-${deal.id}`,
    kind: "note",
    missingInfo: [],
    reviewLabel: "Draft only",
    targetHref: deal.href,
    targetKind: "Note",
    targetLabel: deal.title,
    title: "Prepare change-brief CRM note",
    warnings: ["Review for durable CRM value before saving. This is a change brief, not a transcript or raw audit dump."]
  };
}

function dealSituationNoteDraftAction(context: AssistantDealBriefContext): AssistantDraftAction {
  const deal = requiredDeal(context);
  const body = [
    `Current state: ${deal.status} in ${deal.stageName}; owner ${deal.ownerLabel}.`,
    deal.organization || deal.person
      ? `Stakeholders: ${[deal.organization?.name, deal.person?.label].filter(Boolean).join(" / ")}.`
      : "Stakeholders: no primary contact or organization is linked.",
    `Commercial context: ${deal.commercial.valueCents ? formatMoney(deal.commercial.valueCents, deal.commercial.currency) : "no value recorded"}; ${deal.expectedCloseAt ? `expected close ${formatDate(deal.expectedCloseAt)}` : "no expected close recorded"}.`,
    `Recent developments: ${recentDevelopments(context)}`,
    `Risks/blockers: ${dealBriefBlockers(context, new Date(context.generatedAt)).join(" · ") || "no deterministic blocker signal found"}.`,
    "Source: Assistant deal brief from stored CRM, timeline, quote, email, meeting, and relationship context."
  ].join("\n");

  return {
    applyState: "disabled",
    candidates: [],
    confidence: "high",
    evidence: [`Deal brief for ${deal.title}`],
    fields: [
      { label: "Body", value: body.slice(0, 1_200) },
      { label: "Related record", value: deal.title }
    ],
    id: `deal-note-${deal.id}`,
    kind: "note",
    missingInfo: [],
    reviewLabel: "Draft only",
    targetHref: deal.href,
    targetKind: "Note",
    targetLabel: deal.title,
    title: "Draft deal situation note",
    warnings: ["Review for durable CRM value before saving. This is a concise summary, not a transcript."]
  };
}

function dealBriefSources(context: AssistantDealBriefContext): AssistantAnswerSource[] {
  const deal = context.deal;
  if (!deal) return [{ label: "Reviewed", detail: context.lookedAt.join(" · ") }];
  return [
    { label: "Deal", detail: `${deal.title} (${deal.status}, ${deal.stageName})` },
    { label: "Activities", detail: `${deal.activities.length} recent open/completed activities reviewed` },
    { label: "Notes", detail: `${deal.notes.length} recent notes reviewed` },
    { label: "Stored email", detail: `${deal.emails.length} deal-linked email logs reviewed; provider ids excluded` },
    { label: "Commercial context", detail: `${deal.commercial.quotes.length} quotes and ${deal.commercial.lineItems.length} line items reviewed` },
    { label: "Reviewed", detail: context.lookedAt.join(" · ") }
  ];
}

function dealBriefSuggestions(context: AssistantDealBriefContext, intent: AssistantDealBriefIntent) {
  const deal = context.deal;
  if (!deal) return ["Open the deal and ask again from that record."];
  const suggestions = [
    `Ask “build an action plan for this deal /deals/${deal.id}.”`,
    `Ask “what changed since last week on this deal /deals/${deal.id}.”`,
    `Ask “what is blocking ${deal.title}?”`,
    `Ask “what changed recently on ${deal.title}?”`,
    `Ask “draft a concise CRM note for this deal /deals/${deal.id}.”`
  ];
  if (!hasOpenDealFollowUp(context)) {
    suggestions.unshift(`Ask “create a reviewed next-step activity for this deal /deals/${deal.id}.”`);
  }
  if (intent === "activity" && hasOpenDealFollowUp(context)) {
    suggestions.unshift("Review the existing open activity before creating another follow-up.");
  }
  return suggestions;
}

function dealBriefSummary(context: AssistantDealBriefContext, intent: AssistantDealBriefIntent, draftCount: number) {
  const deal = context.deal;
  if (!deal) return "I need a specific deal before producing a deal brief.";
  if (intent === "action_plan") {
    const supportText = draftCount > 0
      ? `${draftCount} supported item${draftCount === 1 ? "" : "s"} can be prepared as review-first draft cards below. Save only the items you choose; unselected recommendations stay informational.`
      : "No supported draft was prepared because the plan either lacks enough evidence or similar work already exists.";
    return `This compact action plan separates confirmed commitments from Assistant recommendations. ${supportText}`;
  }
  if (intent === "change_brief") {
    const supportText = draftCount > 0
      ? ` I also prepared ${draftCount} review-first draft${draftCount === 1 ? "" : "s"} from supported change-brief items; nothing was saved or applied.`
      : " No supported draft was prepared because there was not enough new evidence or similar work already exists.";
    return `This change brief compares timestamped CRM evidence from an explicit point and omits unchanged deal facts.${supportText}`;
  }
  const blockers = dealBriefBlockers(context, new Date(context.generatedAt));
  const draftText = draftCount > 0 ? ` I also prepared ${draftCount} review-first draft${draftCount === 1 ? "" : "s"}; nothing was saved or applied.` : "";
  if (intent === "activity" && hasOpenDealFollowUp(context)) {
    return `I found an existing open follow-up, so I did not create a duplicate draft. Review the current commitment before adding another.${draftText}`;
  }
  if (intent === "note" && hasRecentSimilarDealNote(context)) {
    return `A recent deal-situation note already appears to exist, so I did not create a duplicate note draft. Review the existing note first.${draftText}`;
  }
  return blockers.length > 0
    ? `The main deal risks are evidence-grounded: ${blockers.slice(0, 2).join(" · ")}.${draftText}`
    : `I did not find a strong deterministic blocker signal in the bounded deal snapshot.${draftText}`;
}

function dealBriefBlockers(context: AssistantDealBriefContext, now: Date) {
  const deal = requiredDeal(context);
  const blockers: string[] = [];
  const openActivities = deal.activities.filter((activity) => !activity.completedAt);
  const overdue = openActivities.filter((activity) => activity.dueAt && new Date(activity.dueAt).getTime() < startOfDay(now).getTime());
  if (overdue.length > 0) blockers.push(`Confirmed: ${overdue.length} overdue open activity${overdue.length === 1 ? "" : "ies"}`);
  if (openActivities.length === 0 && deal.status === "OPEN") blockers.push("Confirmed: no open next-step activity is linked to this open deal");
  if (deal.expectedCloseAt) {
    const daysUntilClose = Math.ceil((new Date(deal.expectedCloseAt).getTime() - startOfDay(now).getTime()) / 86_400_000);
    if (daysUntilClose < 0) blockers.push("Confirmed: expected close date has passed");
    else if (daysUntilClose <= 7) blockers.push(`Confirmed: expected close is in ${daysUntilClose} day${daysUntilClose === 1 ? "" : "s"}`);
  }
  const daysSinceUpdated = Math.floor((now.getTime() - new Date(deal.updatedAt).getTime()) / 86_400_000);
  if (daysSinceUpdated >= 14 && deal.status === "OPEN") blockers.push(`Confirmed: no visible deal update in ${daysSinceUpdated} days`);
  if (deal.commercial.quotes.some((quote) => quote.status === "SENT")) blockers.push("Confirmed: at least one quote is sent and may need review");
  if (deal.person?.relationshipBusinessConcerns) blockers.push(`Confirmed relationship risk: ${deal.person.relationshipBusinessConcerns}`);
  if (!deal.person && !deal.organization) blockers.push("Confirmed: no primary contact or organization is linked");
  return blockers;
}

function recentDevelopments(context: AssistantDealBriefContext) {
  const deal = requiredDeal(context);
  const developments = [
    ...deal.emails.slice(0, 2).map((email) => `Stored ${email.direction.toLowerCase()} email “${email.subject}” on ${formatDate(email.occurredAt)}`),
    ...deal.notes.slice(0, 2).map((note) => `Note on ${formatDate(note.createdAt)}: ${note.body}`),
    ...deal.meetings.slice(0, 1).map((meeting) => `Meeting Intelligence ${meeting.status.toLowerCase()} on ${formatDate(meeting.updatedAt)}: ${meeting.detail}`),
    ...deal.auditEvents.slice(0, 2).map((event) => `Audit event ${event.action} on ${formatDate(event.createdAt)}`)
  ].slice(0, 4);
  return developments.length > 0 ? developments.join(" · ") : "No recent notes, stored emails, meeting summaries, or audit events were found for this deal.";
}

function recommendedNextSteps(context: AssistantDealBriefContext, intent: AssistantDealBriefIntent, now: Date) {
  const deal = requiredDeal(context);
  const recommendations: string[] = [];
  if (!hasOpenDealFollowUp(context) && deal.status === "OPEN") {
    recommendations.push("Suggestion: create one reviewed next-step activity tied to this deal");
  } else {
    recommendations.push("Confirmed: review the existing open activity before adding a duplicate follow-up");
  }
  if (deal.commercial.quotes.some((quote) => quote.status === "SENT")) {
    recommendations.push("Suggestion: follow up on the sent quote after checking the quote record");
  }
  if (dealBriefBlockers(context, now).length > 0) {
    recommendations.push("Suggestion: address the top blocker before changing stage, quote, or forecast details");
  }
  if (intent === "note") recommendations.push("Suggestion: save only durable deal context as a reviewed CRM note");
  return recommendations;
}

function missingDealInformation(context: AssistantDealBriefContext) {
  const deal = requiredDeal(context);
  return [
    ...(deal.expectedCloseAt ? [] : ["No expected close date recorded"]),
    ...(deal.commercial.valueCents ? [] : ["No deal value recorded"]),
    ...(deal.person || deal.organization ? [] : ["No contact or organization linked"]),
    ...(deal.commercial.lineItems.length > 0 ? [] : ["No line items recorded"]),
    ...(deal.commercial.quotes.length > 0 ? [] : ["No quotes recorded"]),
    ...(deal.activities.length > 0 ? [] : ["No activities recorded"])
  ];
}

function hasOpenDealFollowUp(context: AssistantDealBriefContext) {
  const deal = requiredDeal(context);
  return deal.activities.some((activity) => !activity.completedAt);
}

function shouldDraftActionPlanActivity(context: AssistantDealBriefContext) {
  const deal = requiredDeal(context);
  if (deal.status !== "OPEN") return false;
  const sentQuote = deal.commercial.quotes.some((quote) => quote.status === "SENT");
  if (sentQuote) return !hasSimilarOpenActivity(context, "quote");
  return !hasOpenDealFollowUp(context);
}

function shouldDraftActionPlanNote(context: AssistantDealBriefContext) {
  const deal = requiredDeal(context);
  const hasEvidence = Boolean(
    deal.expectedCloseAt ||
      deal.commercial.valueCents ||
      deal.commercial.quotes.length ||
      deal.activities.length ||
      deal.notes.length ||
      deal.emails.length ||
      deal.meetings.length ||
      deal.person ||
      deal.organization
  );
  return hasEvidence && !hasRecentSimilarDealNote(context) && !hasRecentActionPlanNote(context);
}

function shouldDraftChangeBriefActivity(context: AssistantDealBriefContext, events: DealChangeEvent[]) {
  const deal = requiredDeal(context);
  if (deal.status !== "OPEN" || hasOpenDealFollowUp(context)) return false;
  return events.some((event) => ["Commercial changes", "Customer signals", "Risks/blockers"].includes(event.category)) ||
    deal.commercial.quotes.some((quote) => quote.status === "SENT");
}

function shouldDraftChangeBriefNote(context: AssistantDealBriefContext, events: DealChangeEvent[]) {
  return events.length > 0 && !hasRecentChangeBriefNote(context);
}

function hasSimilarOpenActivity(context: AssistantDealBriefContext, keyword: string) {
  const normalizedKeyword = keyword.toLowerCase();
  return requiredDeal(context).activities.some((activity) =>
    !activity.completedAt &&
    [activity.title, activity.description ?? ""].some((value) => value.toLowerCase().includes(normalizedKeyword))
  );
}

function hasRecentActionPlanNote(context: AssistantDealBriefContext) {
  return requiredDeal(context).notes.some((note) => note.body.toLowerCase().includes("source: assistant deal action plan"));
}

function hasRecentChangeBriefNote(context: AssistantDealBriefContext) {
  return requiredDeal(context).notes.some((note) => note.body.toLowerCase().includes("source: assistant deal change brief"));
}

function hasRecentSimilarDealNote(context: AssistantDealBriefContext) {
  const deal = requiredDeal(context);
  return deal.notes.some((note) => {
    const body = note.body.toLowerCase();
    return body.includes("current state:") &&
      (body.includes("source: assistant deal brief") ||
        (body.includes("stakeholders:") && body.includes("commercial context:") && body.includes("risks/blockers:")));
  });
}

function followUpTitle(context: AssistantDealBriefContext) {
  const deal = requiredDeal(context);
  if (deal.commercial.quotes.some((quote) => quote.status === "SENT")) return `Follow up on ${deal.title} quote`;
  if (deal.expectedCloseAt) return `Confirm next step for ${deal.title}`;
  return `Follow up on ${deal.title}`;
}

function requiredDeal(context: AssistantDealBriefContext) {
  if (!context.deal) throw new Error("Deal brief requires a selected deal.");
  return context.deal;
}

function isDealBriefQuery(normalized: string, rawQuery: string) {
  const hasDealTarget = /\b(deal|opportunity|pipeline)\b/.test(normalized) || /\/deals\/[A-Za-z0-9_-]{8,80}/.test(rawQuery);
  if (!hasDealTarget) return false;
  return /\b(action plan|plan of action|deal plan|summarize|summary|brief|what should i do next|next step|next-step|blocking|blocker|blocked|stakeholder|relationship risk|changed recently|what changed|what happened since|latest deal update|latest update|before i call|since last week|since the last meeting|since the quote|quote was sent|commercial|current situation|prepare follow-ups|follow-ups|reviewed next-step activity|crm note)\b/.test(normalized);
}

function dealBriefIntent(normalized: string): AssistantDealBriefIntent {
  if (/\b(action plan|plan of action|deal plan)\b/.test(normalized)) return "action_plan";
  if (/\b(what changed|what happened since|latest deal update|latest update|before i call|since last week|since the last meeting|since the quote|quote was sent|last meaningful activity)\b/.test(normalized)) return "change_brief";
  if (/\b(reviewed next-step activity|create .*activity|next-step activity)\b/.test(normalized)) return "activity";
  if (/\b(prepare follow-ups|follow-ups|follow up)\b/.test(normalized)) return "followups";
  if (/\b(crm note|draft .*note|summarizing the current situation)\b/.test(normalized)) return "note";
  if (/\b(blocking|blocker|blocked)\b/.test(normalized)) return "blockers";
  if (/\b(stakeholder|relationship risk)\b/.test(normalized)) return "stakeholders";
  if (/\b(changed recently|what changed|recently changed)\b/.test(normalized)) return "changes";
  if (/\b(what should i do next|next steps?|next action)\b/.test(normalized)) return "next_steps";
  return "summary";
}

function extractDealBriefTarget(query: string) {
  const hrefMatch = query.match(/\/deals\/([A-Za-z0-9_-]{8,80})/);
  if (hrefMatch) return hrefMatch[1];
  const quoted = query.match(/["“]([^"”]{2,120})["”]/);
  if (quoted) return quoted[1].trim();
  const cleaned = query
    .replace(/\/deals\/[A-Za-z0-9_-]{8,80}/g, "")
    .replace(/^[\s"']*(please\s+|can you\s+|could you\s+)?/i, "")
    .replace(/\b(summarize|summary|brief|show|prepare|create|draft|what is|what's|what has|what should i do|tell me)\b/gi, " ")
    .replace(/\b(this|the|current|important|concise|reviewed|next-step|crm|current situation|from the latest|latest|activity|activities|notes?|email|meeting context|stakeholders?|relationship risks?|changed recently|blocking|blockers?|deal|opportunity|follow-ups?|next steps?|next action|for|on|about|from|with)\b/gi, " ")
    .replace(/[?.!:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120);
}

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractReplyTarget(query: string) {
  const withoutPrefix = query
    .trim()
    .replace(/^[\s"']*(check whether|whether|did|has|have|can you check whether)\s+/i, "")
    .replace(/\s+(replied|reply|responded|response)\b.*$/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  return withoutPrefix.length >= 2 ? withoutPrefix.slice(0, 120) : "";
}

function dealRisk(deal: AssistantDealRiskContextItem, generatedAt: string) {
  const now = new Date(generatedAt);
  const factors: string[] = [];
  let score = 0;
  const overdueActivities = deal.activities.filter((activity) => activity.bucket === "overdue");
  if (overdueActivities.length > 0) {
    score += 35;
    factors.push(`${overdueActivities.length} overdue follow-up${overdueActivities.length === 1 ? "" : "s"}`);
  }
  if (deal.activities.length === 0) {
    score += 30;
    factors.push("No open next activity");
  }
  if (deal.expectedCloseAt) {
    const closeAt = new Date(deal.expectedCloseAt);
    const daysUntilClose = Math.ceil((closeAt.getTime() - startOfDay(now).getTime()) / 86_400_000);
    if (daysUntilClose < 0) {
      score += 25;
      factors.push("Expected close date has passed");
    } else if (daysUntilClose <= 7) {
      score += 15;
      factors.push("Expected close is within 7 days");
    }
  }
  const daysSinceUpdated = Math.floor((now.getTime() - new Date(deal.updatedAt).getTime()) / 86_400_000);
  if (daysSinceUpdated >= 14) {
    score += 10;
    factors.push(`No visible update in ${daysSinceUpdated} days`);
  }
  if ((deal.valueCents ?? 0) >= 100_000) {
    score += 10;
    factors.push("High value");
  }
  return { factors: factors.length > 0 ? factors : ["No strong risk signal"], score };
}

function emailReplySummary(input: {
  latestOutbound: AssistantEmailReplyMessage | undefined;
  messageCount: number;
  replyAfterOutbound: AssistantEmailReplyMessage | undefined;
  target: string;
}) {
  if (input.replyAfterOutbound && input.latestOutbound) {
    return `Likely yes: a stored inbound email for ${input.target} appears after the latest matching outbound email.`;
  }
  if (input.replyAfterOutbound) {
    return `A recent inbound stored email matched ${input.target}, but there was no matching outbound email in the bounded lookup to compare against.`;
  }
  if (input.latestOutbound) {
    return `No likely reply was found after the latest matching outbound email in ${input.messageCount} recent stored email ${input.messageCount === 1 ? "log" : "logs"}.`;
  }
  return `No likely reply from ${input.target} was found in recent stored email logs.`;
}

function bucketLabel(bucket: string) {
  if (bucket === "overdue") return "Overdue";
  if (bucket === "today") return "Due today";
  if (bucket === "upcoming") return "Upcoming";
  return "No due date";
}

function directionLabel(direction: string) {
  if (direction === "INBOUND") return "Inbound";
  if (direction === "OUTBOUND") return "Outbound";
  return direction;
}

function participantSummary(message: AssistantEmailReplyMessage) {
  if (message.fromText && message.toText) return `From ${message.fromText} to ${message.toText}`;
  if (message.fromText) return `From ${message.fromText}`;
  if (message.toText) return `To ${message.toText}`;
  return "";
}

function isDraftCommandKind(kind: AssistantCommandKind): kind is AssistantDraftCommandKind {
  return kind === "draft_activity" ||
    kind === "draft_ai_preferences" ||
    kind === "draft_crm_record_change" ||
    kind === "draft_contact_relationship" ||
    kind === "draft_note" ||
    kind === "draft_record_creation";
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function draftSummaryNoun(draft: AssistantDraftAction | undefined) {
  if (!draft) return "a CRM action";
  if (draft.kind === "activity") return "an activity";
  if (draft.kind === "ai_preference_update") return "an AI preference change";
  if (draft.kind === "contact_create") return "a contact creation proposal";
  if (draft.kind === "contact_organization_link") return "a contact organization link";
  if (draft.kind === "contact_relationship_update") return "a contact relationship update";
  if (draft.kind === "contact_update") return "a contact update";
  if (draft.kind === "note") return "a note";
  if (draft.kind === "organization_create") return "an organization creation proposal";
  if (draft.kind === "organization_update") return "an organization update";
  return "an organization/contact creation preview";
}

function formatDate(value: string) {
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
