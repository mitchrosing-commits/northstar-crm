import type { WorkspaceActor } from "@/lib/services/workspace-access";
import { startOfDay } from "@/lib/activity-due";

import {
  buildAssistantDealRiskContext,
  buildAssistantEmailReplyContext,
  buildAssistantTodayContext,
  type AssistantDealRiskContext,
  type AssistantDealRiskContextItem,
  type AssistantEmailReplyContext,
  type AssistantEmailReplyMessage,
  type AssistantTodayContext
} from "./assistant-context-service";

export type AssistantCommandKind = "deal_risk" | "email_reply_check" | "today" | "unsupported";
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
  kind: AssistantCommandKind;
  target?: string;
};

export const assistantSuggestedCommands = [
  "Tell me what I have to do today.",
  "Show me the highest-risk deals this week.",
  "Check whether Mike Fox replied to my recent email."
] as const;

const readOnlySafetyNotice =
  "Context-only and review-first: this Assistant does not create, update, delete, link, convert, close, send, sync, archive, mark read, or mutate provider mail in this version.";

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
  if (parsed.kind === "email_reply_check" && parsed.target) {
    return buildEmailReplyAssistantAnswer(await buildAssistantEmailReplyContext(actor, parsed.target, now), query);
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
  if (/\b(replied|reply|responded|response)\b/.test(normalized) && /\b(email|message|thread|inbox)\b/.test(normalized)) {
    const target = extractReplyTarget(query);
    return target ? { kind: "email_reply_check", target } : { kind: "unsupported" };
  }
  return { kind: "unsupported" };
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
      detail: "Supported in this read-only Assistant slice.",
      href: `/assistant?command=${encodeURIComponent(command)}`,
      label: "Try",
      title: command,
      tone: "info"
    })),
    query,
    reviewFirst: true,
    safetyNotice: readOnlySafetyNotice,
    sources: [{ label: "Supported commands", detail: "Today agenda, deal risk, and stored-email reply checks." }],
    suggestions: [...assistantSuggestedCommands],
    summary: "I can answer a small set of deterministic, read-only CRM questions right now. I will not mutate CRM records or provider mail.",
    title: "Try a supported Assistant command"
  };
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
