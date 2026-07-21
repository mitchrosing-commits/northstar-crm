import type { Route } from "next";

import { buildActivityFollowUpHref } from "@/lib/follow-up-links";

type ActivityType = "CALL" | "EMAIL" | "MEETING" | "TASK";

type QuoteFollowUpActivity = {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: Date | string | null;
  completedAt?: Date | string | null;
  owner?: {
    name?: string | null;
    email: string;
  } | null;
};

export type QuoteFollowUpQuote = {
  id: string;
  number: string;
  status: string;
  dealId: string;
  deal: {
    title: string;
    activities?: QuoteFollowUpActivity[];
  };
  dealValueSyncConflict?: string | null;
  dealValueSyncReviewedAt?: Date | string | null;
  dealValueSyncedAt?: Date | string | null;
};

type QuoteFollowUpContext = {
  event?: string;
  historyFilter?: string | null;
  now?: Date | string;
  returnTo?: Route | string;
  returnHash?: string;
};

export type QuoteFollowUpStatus = {
  activity?: QuoteFollowUpActivity;
  label: "No open quote follow-up" | "Follow-up scheduled" | "Follow-up overdue" | "Follow-up completed";
  tone: "muted" | "success" | "warning";
};

export function buildQuoteFollowUpHref(
  quote: QuoteFollowUpQuote,
  context: QuoteFollowUpContext = {}
) {
  const suggestion = quoteFollowUpSuggestion(quote, context.event);
  const returnTo = quoteReturnHref(quote, context);
  const href = buildActivityFollowUpHref({
    description: suggestion.description,
    dueInDays: suggestion.dueInDays,
    now: context.now,
    related: { type: "deal", id: quote.dealId },
    returnTo,
    title: suggestion.title,
    type: suggestion.type
  });
  const params = new URLSearchParams(href.split("?")[1] ?? "");
  params.set("quoteNumber", quote.number);
  params.set("quoteContext", suggestion.context);
  params.set("quoteStatus", quote.status);
  if (context.event) params.set("quoteEvent", context.event);
  return `/activities/new?${params.toString()}` as Route;
}

export function quoteFollowUpStatus(quote: QuoteFollowUpQuote, now = new Date()): QuoteFollowUpStatus {
  const related = quoteFollowUpActivities(quote);
  const openActivities = related.filter((activity) => !activity.completedAt);
  const completed = related.find((activity) => activity.completedAt);
  const today = startOfUtcDay(now);
  const overdue = openActivities.find((activity) => activity.dueAt && new Date(activity.dueAt) < today);

  if (overdue) return { activity: overdue, label: "Follow-up overdue", tone: "warning" };
  if (openActivities[0]) return { activity: openActivities[0], label: "Follow-up scheduled", tone: "success" };
  if (completed) return { activity: completed, label: "Follow-up completed", tone: "muted" };
  return { label: "No open quote follow-up", tone: "warning" };
}

export function quoteHasSimilarOpenFollowUp(quote: QuoteFollowUpQuote) {
  return quoteFollowUpActivities(quote).some((activity) => !activity.completedAt);
}

function quoteFollowUpActivities(quote: QuoteFollowUpQuote) {
  return (quote.deal.activities ?? [])
    .filter((activity) => activityMatchesQuote(activity, quote.number))
    .sort(compareQuoteFollowUpActivities);
}

function compareQuoteFollowUpActivities(a: QuoteFollowUpActivity, b: QuoteFollowUpActivity) {
  const aDone = Boolean(a.completedAt);
  const bDone = Boolean(b.completedAt);
  if (aDone !== bDone) return aDone ? 1 : -1;
  return eventTime(a.dueAt) - eventTime(b.dueAt);
}

function activityMatchesQuote(activity: QuoteFollowUpActivity, quoteNumber: string) {
  const needle = quoteNumber.toLowerCase();
  return `${activity.title} ${activity.description ?? ""}`.toLowerCase().includes(needle);
}

function quoteReturnHref(quote: QuoteFollowUpQuote, context: QuoteFollowUpContext) {
  if (context.returnTo) return context.returnTo as Route;

  const hash = context.returnHash ?? "quote-lifecycle";
  const history = context.historyFilter && context.historyFilter !== "all"
    ? `?history=${encodeURIComponent(context.historyFilter)}`
    : "";
  return `/deals/${quote.dealId}/quotes/${quote.id}${history}#${hash}` as Route;
}

function quoteFollowUpSuggestion(quote: QuoteFollowUpQuote, event?: string): {
  context: string;
  description: string;
  dueInDays: number;
  title: string;
  type: ActivityType;
} {
  const base = `Quote ${quote.number} for deal "${quote.deal.title}" is currently ${quote.status}.`;
  if (quote.dealValueSyncConflict && !quote.dealValueSyncedAt && !quote.dealValueSyncReviewedAt) {
    return {
      context: "Deal-value sync conflict needs review",
      description: `${base}\n\nReview the accepted quote value conflict and confirm whether the deal value should change.`,
      dueInDays: 1,
      title: "Resolve accepted quote value conflict",
      type: "TASK"
    };
  }
  if (quote.status === "DECLINED" || event === "quote.declined") {
    return {
      context: "Quote was declined",
      description: `${base}\n\nReview why the customer declined and confirm whether a revised quote or close-out step is needed.`,
      dueInDays: 1,
      title: "Review declined quote with customer",
      type: "CALL"
    };
  }
  if (quote.status === "ACCEPTED" || event === "quote.public_accepted" || event === "quote.accepted") {
    return {
      context: "Quote was accepted",
      description: `${base}\n\nConfirm next steps after acceptance and make sure handoff details are clear.`,
      dueInDays: 1,
      title: "Confirm next steps after quote acceptance",
      type: "TASK"
    };
  }
  if (event === "quote.public_link_created") {
    return {
      context: "Public quote link was generated",
      description: `${base}\n\nConfirm the customer received the public quote link and answer any questions.`,
      dueInDays: 2,
      title: "Follow up on public quote link",
      type: "EMAIL"
    };
  }
  return {
    context: "Quote is awaiting response",
    description: `${base}\n\nCheck whether the customer has reviewed the quote and confirm next steps.`,
    dueInDays: 3,
    title: "Follow up on sent quote",
    type: "TASK"
  };
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function eventTime(value: Date | string | null | undefined) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  return new Date(value).getTime();
}
