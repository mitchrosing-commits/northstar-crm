import { AssistantActionRequestStatus, DealStatus, LeadStatus, Prisma, QuoteStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { activityAttachmentRelationsWhere, actionableActivityRelationsWhere } from "@/lib/services/record-guards";
import { scopeWorkspaceRelation } from "@/lib/services/relation-scope";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

const commandCenterItemLimit = 10;
const activityLookaheadDays = 1;
const expectedCloseLookaheadDays = 7;
const staleDealDays = 14;
const quoteFollowUpDays = 3;
const recentLeadDays = 7;
const commandCenterCandidateLimit = 25;
const itemKeyPattern = /^[a-z][a-z0-9-]{1,220}$/;

export type AssistantTodayCommandCenterItemKind =
  | "activity_due"
  | "assistant_request"
  | "deal_close_date"
  | "deal_no_activity"
  | "deal_stale"
  | "lead_review"
  | "quote_follow_up";

export type AssistantTodayCommandCenterItem = {
  draftHref: string | null;
  explanation: AssistantTodayCommandCenterExplanation;
  hiddenAt: string | null;
  href: string;
  id: string;
  itemKey: string;
  kind: AssistantTodayCommandCenterItemKind;
  priority: number;
  reason: string;
  recordLabel: string;
  recordType: "Activity" | "Assistant request" | "Deal" | "Lead" | "Quote";
  safeNextAction: string;
  title: string;
};

export type AssistantTodayCommandCenterExplanation = {
  calculation: string;
  result: string;
  rule: string;
  sourceRecord: {
    href: string;
    label: string;
    lastUpdatedAt: string | null;
  };
  storedValues: Array<{
    label: string;
    value: string;
  }>;
  threshold: string;
};

export type AssistantTodayCommandCenter = {
  emptyState: {
    description: string;
    title: string;
  };
  generatedAt: string;
  hiddenCount: number;
  hiddenItems: AssistantTodayCommandCenterItem[];
  items: AssistantTodayCommandCenterItem[];
  localDateKey: string;
  reviewFirstNotice: string;
  showHidden: boolean;
  timeZone: string;
};

type AssistantTodayCommandCenterOptions = {
  showHidden?: boolean;
  timeZone?: string;
};

export async function buildAssistantTodayCommandCenter(
  actor: WorkspaceActor,
  now = new Date(),
  options: AssistantTodayCommandCenterOptions = {}
): Promise<AssistantTodayCommandCenter> {
  await ensureWorkspaceAccess(actor);
  const timeZone = normalizeTimeZone(options.timeZone);
  const localDateKey = assistantTodayLocalDateKey(now, timeZone);
  const today = startOfUtcDay(now);
  const tomorrow = addUtcDays(today, activityLookaheadDays);
  const expectedCloseThrough = addUtcDays(today, expectedCloseLookaheadDays + 1);
  const staleOnOrBefore = addUtcDays(today, -staleDealDays);
  const quoteFollowUpOnOrBefore = addUtcDays(today, -quoteFollowUpDays);
  const recentLeadAfter = addUtcDays(today, -recentLeadDays);
  const activityWhere = {
    workspaceId: actor.workspaceId,
    ...activeWhere,
    ...activityAttachmentRelationsWhere(actor.workspaceId)
  } satisfies Prisma.ActivityWhereInput;

  const [dueActivities, dealsNoUpcomingActivity, closeDateDeals, staleDeals, quotesAwaitingFollowUp, recentLeads, pendingRequests, hiddenRows] =
    await Promise.all([
      prisma.activity.findMany({
        where: {
          workspaceId: actor.workspaceId,
          completedAt: null,
          dueAt: { lt: tomorrow },
          ...activeWhere,
          ...actionableActivityRelationsWhere(actor.workspaceId)
        },
        select: {
          deal: { select: { title: true, workspaceId: true, deletedAt: true } },
          dueAt: true,
          id: true,
          lead: { select: { title: true, workspaceId: true, deletedAt: true } },
          organization: { select: { name: true, workspaceId: true, deletedAt: true } },
          person: { select: { firstName: true, lastName: true, workspaceId: true, deletedAt: true } },
          title: true,
          type: true
        },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        take: commandCenterCandidateLimit
      }),
      prisma.deal.findMany({
        where: {
          workspaceId: actor.workspaceId,
          status: DealStatus.OPEN,
          activities: {
            none: {
              ...activityWhere,
              completedAt: null,
              dueAt: { gte: today }
            }
          },
          ...activeWhere
        },
        select: dealCommandCenterSelect(actor.workspaceId),
        orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
        take: commandCenterCandidateLimit
      }),
      prisma.deal.findMany({
        where: {
          workspaceId: actor.workspaceId,
          status: DealStatus.OPEN,
          expectedCloseAt: { lt: expectedCloseThrough },
          ...activeWhere
        },
        select: dealCommandCenterSelect(actor.workspaceId),
        orderBy: [{ expectedCloseAt: "asc" }, { updatedAt: "asc" }],
        take: commandCenterCandidateLimit
      }),
      prisma.deal.findMany({
        where: {
          workspaceId: actor.workspaceId,
          status: DealStatus.OPEN,
          updatedAt: { lte: staleOnOrBefore },
          ...activeWhere
        },
        select: dealCommandCenterSelect(actor.workspaceId),
        orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
        take: commandCenterCandidateLimit
      }),
      prisma.quote.findMany({
        where: {
          workspaceId: actor.workspaceId,
          status: QuoteStatus.SENT,
          updatedAt: { lte: quoteFollowUpOnOrBefore },
          deal: { workspaceId: actor.workspaceId, status: DealStatus.OPEN, ...activeWhere }
        },
        select: {
          deal: {
            select: {
              organization: { select: { name: true, workspaceId: true, deletedAt: true } },
              person: { select: { firstName: true, lastName: true, workspaceId: true, deletedAt: true } },
              title: true,
              workspaceId: true
            }
          },
          dealId: true,
          id: true,
          number: true,
          totalCents: true,
          updatedAt: true
        },
        orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
        take: commandCenterCandidateLimit
      }),
      prisma.lead.findMany({
        where: {
          workspaceId: actor.workspaceId,
          status: LeadStatus.NEW,
          createdAt: { gte: recentLeadAfter },
          ...activeWhere
        },
        select: {
          createdAt: true,
          id: true,
          organization: { select: { name: true, workspaceId: true, deletedAt: true } },
          person: { select: { firstName: true, lastName: true, workspaceId: true, deletedAt: true } },
          source: true,
          title: true
        },
        orderBy: [{ createdAt: "desc" }],
        take: commandCenterCandidateLimit
      }),
      prisma.assistantActionRequest.findMany({
        where: {
          createdById: actor.actorUserId,
          status: AssistantActionRequestStatus.PENDING,
          workspaceId: actor.workspaceId
        },
        select: {
          actionType: true,
          createdAt: true,
          id: true,
          riskLevel: true,
          targetLabel: true,
          title: true
        },
        orderBy: [{ createdAt: "desc" }],
        take: commandCenterCandidateLimit
      }),
      prisma.assistantTodayItemHide.findMany({
        where: {
          localDateKey,
          userId: actor.actorUserId,
          workspaceId: actor.workspaceId
        },
        select: {
          createdAt: true,
          itemKey: true
        }
      })
    ]);

  const rankedItems = rankCommandCenterItems([
    ...dueActivities.map((activity) => dueActivityItem(actor.workspaceId, activity, now)),
    ...pendingRequests.map(pendingRequestItem),
    ...closeDateDeals.map((deal) => closeDateDealItem(actor.workspaceId, deal, today)),
    ...dealsNoUpcomingActivity.map((deal) => dealNoActivityItem(actor.workspaceId, deal)),
    ...staleDeals.map((deal) => staleDealItem(actor.workspaceId, deal, today)),
    ...quotesAwaitingFollowUp.map((quote) => quoteFollowUpItem(actor.workspaceId, quote, today)),
    ...recentLeads.map((lead) => recentLeadItem(actor.workspaceId, lead))
  ]);
  const hiddenByKey = hiddenRows.reduce<Map<string, Date>>((hiddenKeys, row) => {
    if (isSafeItemKey(row.itemKey) && !hiddenKeys.has(row.itemKey)) hiddenKeys.set(row.itemKey, row.createdAt);
    return hiddenKeys;
  }, new Map());
  const hiddenItems = rankedItems.filter((item) => hiddenByKey.has(item.itemKey)).map((item) => withHiddenAt(item, hiddenByKey.get(item.itemKey) ?? null));
  const visibleItems = rankedItems.filter((item) => !hiddenByKey.has(item.itemKey)).slice(0, commandCenterItemLimit);

  return {
    emptyState: {
      description: "Overdue or due-today activities, aging sent quotes, open deals without upcoming activity, close-date risk, stale deals, new leads, or pending Assistant action requests will appear here.",
      title: "No Command Center items for today"
    },
    generatedAt: now.toISOString(),
    hiddenCount: hiddenItems.length,
    hiddenItems,
    items: visibleItems,
    localDateKey,
    reviewFirstNotice: "Review-first suggestions only. Opening this page does not create records, send email, sync inboxes, convert leads, close deals, or apply drafts.",
    showHidden: Boolean(options.showHidden),
    timeZone
  };
}

export async function hideAssistantTodayCommandCenterItem(
  actor: WorkspaceActor,
  input: { itemKey: string },
  now = new Date(),
  options: Pick<AssistantTodayCommandCenterOptions, "timeZone"> = {}
) {
  const itemKey = normalizeAssistantTodayItemKey(input.itemKey);
  if (!itemKey) throw new ApiError("VALIDATION_ERROR", "Assistant Command Center item could not be hidden.", 422);
  const commandCenter = await buildAssistantTodayCommandCenter(actor, now, { ...options, showHidden: true });
  const activeItem = [...commandCenter.items, ...commandCenter.hiddenItems].find((item) => item.itemKey === itemKey);
  if (!activeItem) throw new ApiError("NOT_FOUND", "Assistant Command Center item is no longer available.", 404);

  await prisma.assistantTodayItemHide.upsert({
    create: {
      itemKey,
      localDateKey: commandCenter.localDateKey,
      userId: actor.actorUserId,
      workspaceId: actor.workspaceId
    },
    update: {
      updatedAt: new Date()
    },
    where: {
      workspaceId_userId_itemKey_localDateKey: {
        itemKey,
        localDateKey: commandCenter.localDateKey,
        userId: actor.actorUserId,
        workspaceId: actor.workspaceId
      }
    }
  });

  return {
    hiddenItem: activeItem,
    localDateKey: commandCenter.localDateKey
  };
}

const dealCommandCenterSelect = (workspaceId: string) => ({
  expectedCloseAt: true,
  id: true,
  organization: { select: { name: true, workspaceId: true, deletedAt: true } },
  person: { select: { firstName: true, lastName: true, workspaceId: true, deletedAt: true } },
  stage: { select: { name: true } },
  title: true,
  updatedAt: true,
  valueCents: true,
  activities: {
    where: {
      workspaceId,
      completedAt: null,
      ...activeWhere,
      ...activityAttachmentRelationsWhere(workspaceId)
    },
    select: { dueAt: true, title: true },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 1
  }
}) satisfies Prisma.DealSelect;

type DueActivityRecord = {
  deal: { title: string; workspaceId: string; deletedAt: Date | null } | null;
  dueAt: Date | null;
  id: string;
  lead: { title: string; workspaceId: string; deletedAt: Date | null } | null;
  organization: { name: string; workspaceId: string; deletedAt: Date | null } | null;
  person: { firstName: string | null; lastName: string | null; workspaceId: string; deletedAt: Date | null } | null;
  title: string;
  type: string;
};

type DealCommandCenterRecord = Prisma.DealGetPayload<{ select: ReturnType<typeof dealCommandCenterSelect> }>;
type QuoteCommandCenterRecord = {
  deal: {
    organization: { name: string; workspaceId: string; deletedAt: Date | null } | null;
    person: { firstName: string | null; lastName: string | null; workspaceId: string; deletedAt: Date | null } | null;
    title: string;
    workspaceId: string;
  };
  dealId: string;
  id: string;
  number: string;
  totalCents: number;
  updatedAt: Date;
};
type LeadCommandCenterRecord = {
  createdAt: Date;
  id: string;
  organization: { name: string; workspaceId: string; deletedAt: Date | null } | null;
  person: { firstName: string | null; lastName: string | null; workspaceId: string; deletedAt: Date | null } | null;
  source: string | null;
  title: string;
};

function dueActivityItem(workspaceId: string, activity: DueActivityRecord, now: Date): AssistantTodayCommandCenterItem {
  const bucket = activityDueBucket(activity, now);
  const relatedLabel = activityRelatedLabel(workspaceId, activity);
  const dueReason = bucket === "overdue" ? `Overdue since ${formatDate(activity.dueAt)}` : `Due today (${formatDate(activity.dueAt)})`;
  const today = startOfUtcDay(now);
  const tomorrow = addUtcDays(today, activityLookaheadDays);
  const daysOverdue = activity.dueAt ? Math.max(0, daysBetween(activity.dueAt, today)) : 0;
  const href = `/activities/${activity.id}/edit`;
  return {
    draftHref: null,
    explanation: commandCenterExplanation({
      calculation:
        bucket === "overdue"
          ? `The due date is before ${formatDate(today)}, so it is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue.`
          : `The due date falls on or after ${formatDate(today)} and before ${formatDate(tomorrow)}.`,
      result: bucket === "overdue" ? "Shown as an overdue activity." : "Shown as an activity due today.",
      rule: bucket === "overdue" ? "Incomplete activity due before the current UTC day." : "Incomplete activity due during the current UTC day.",
      sourceHref: href,
      sourceLabel: activity.title,
      storedValues: [
        { label: "Due date/time", value: formatDateTime(activity.dueAt) },
        { label: "Comparison date", value: `${formatDate(today)} UTC` },
        { label: "Activity type", value: activity.type || "Not set" },
        { label: "Related record", value: relatedLabel ?? "No linked record" }
      ],
      threshold: `Due before ${formatDate(tomorrow)} UTC and not completed.`
    }),
    hiddenAt: null,
    href,
    id: `activity-${activity.id}`,
    itemKey: `activity-${activity.id}`,
    kind: "activity_due",
    priority: bucket === "overdue" ? 10 : 20,
    reason: `${dueReason}${relatedLabel ? ` · Linked to ${relatedLabel}` : ""}`,
    recordLabel: activity.title,
    recordType: "Activity",
    safeNextAction: "Open the activity, review the CRM context, then complete or reschedule it manually.",
    title: bucket === "overdue" ? "Overdue activity" : "Activity due today"
  };
}

function pendingRequestItem(request: {
  actionType: string;
  createdAt: Date;
  id: string;
  riskLevel: string;
  targetLabel: string;
  title: string;
}): AssistantTodayCommandCenterItem {
  return {
    draftHref: null,
    explanation: commandCenterExplanation({
      calculation: `The request status is ${AssistantActionRequestStatus.PENDING}, so it is still waiting for explicit review.`,
      result: "Shown as a pending Assistant review item.",
      rule: "Assistant action request created by you is still pending.",
      sourceHref: "/assistant?queue=pending#assistant-review-queue",
      sourceLabel: request.title,
      lastUpdatedAt: request.createdAt,
      storedValues: [
        { label: "Created", value: formatDateTime(request.createdAt) },
        { label: "Action type", value: request.actionType },
        { label: "Risk", value: request.riskLevel },
        { label: "Target", value: request.targetLabel || "No target label" },
        { label: "Status", value: AssistantActionRequestStatus.PENDING }
      ],
      threshold: "Pending requests remain visible until applied or rejected."
    }),
    hiddenAt: null,
    href: "/assistant?queue=pending#assistant-review-queue",
    id: `assistant-request-${request.id}`,
    itemKey: `assistant-request-${request.id}`,
    kind: "assistant_request",
    priority: 30,
    reason: `Pending ${request.riskLevel} risk ${request.actionType} request saved ${formatDate(request.createdAt)} for ${request.targetLabel}.`,
    recordLabel: request.title,
    recordType: "Assistant request",
    safeNextAction: "Open the review queue and explicitly apply eligible activity or note drafts, or reject the request.",
    title: "Pending Assistant request"
  };
}

function closeDateDealItem(workspaceId: string, deal: DealCommandCenterRecord, today: Date): AssistantTodayCommandCenterItem {
  const days = daysBetween(today, deal.expectedCloseAt ?? today);
  const pastDue = days < 0;
  const href = `/deals/${deal.id}`;
  const recordLabel = dealRecordLabel(workspaceId, deal);
  return {
    draftHref: draftActivityHref(deal.title),
    explanation: commandCenterExplanation({
      calculation: pastDue
        ? `Expected close is ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} before ${formatDate(today)}.`
        : `Expected close is ${days} day${days === 1 ? "" : "s"} from ${formatDate(today)}.`,
      result: pastDue ? "Shown as a deal past expected close." : "Shown as a deal approaching expected close.",
      rule: "Open deal has an expected close date inside the seven-day UTC lookahead window, or already past due.",
      sourceHref: href,
      sourceLabel: recordLabel,
      lastUpdatedAt: deal.updatedAt,
      storedValues: [
        { label: "Expected close", value: formatDate(deal.expectedCloseAt) },
        { label: "Comparison date", value: `${formatDate(today)} UTC` },
        { label: "Stage", value: deal.stage.name || "No stage name" },
        { label: "Deal last updated", value: formatDateTime(deal.updatedAt) }
      ],
      threshold: `Expected close before ${formatDate(addUtcDays(today, expectedCloseLookaheadDays + 1))} UTC (${expectedCloseLookaheadDays}-day window).`
    }),
    hiddenAt: null,
    href,
    id: `deal-close-${deal.id}`,
    itemKey: `deal-close-${deal.id}`,
    kind: "deal_close_date",
    priority: pastDue ? 40 : 45,
    reason: pastDue
      ? `Expected close date passed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago.`
      : `Expected close is in ${days} day${days === 1 ? "" : "s"}.`,
    recordLabel,
    recordType: "Deal",
    safeNextAction: "Review the deal and draft a follow-up activity before changing stage, quote, close status, or forecast.",
    title: pastDue ? "Deal past expected close" : "Deal close date approaching"
  };
}

function dealNoActivityItem(workspaceId: string, deal: DealCommandCenterRecord): AssistantTodayCommandCenterItem {
  const href = `/deals/${deal.id}`;
  const recordLabel = dealRecordLabel(workspaceId, deal);
  const nextOpenActivity = deal.activities[0];
  return {
    draftHref: draftActivityHref(deal.title),
    explanation: commandCenterExplanation({
      calculation: "The workspace query found no open activity with a due date today or later for this deal.",
      result: "Shown because the deal has no qualifying upcoming activity.",
      rule: "Open deal has no upcoming open activity.",
      sourceHref: href,
      sourceLabel: recordLabel,
      lastUpdatedAt: deal.updatedAt,
      storedValues: [
        { label: "Deal last updated", value: formatDateTime(deal.updatedAt) },
        {
          label: "Nearest open activity",
          value: nextOpenActivity ? `${nextOpenActivity.title} (${formatDueValue(nextOpenActivity.dueAt)})` : "No open activity found"
        }
      ],
      threshold: "At least one open activity with a due date on or after today's UTC date."
    }),
    hiddenAt: null,
    href,
    id: `deal-no-activity-${deal.id}`,
    itemKey: `deal-no-activity-${deal.id}`,
    kind: "deal_no_activity",
    priority: 50,
    reason: "Open deal has no upcoming open activity.",
    recordLabel,
    recordType: "Deal",
    safeNextAction: "Open the deal or draft a follow-up activity for review.",
    title: "Deal needs next activity"
  };
}

function staleDealItem(workspaceId: string, deal: DealCommandCenterRecord, today: Date): AssistantTodayCommandCenterItem {
  const days = Math.max(0, daysBetween(deal.updatedAt, today));
  const href = `/deals/${deal.id}`;
  const recordLabel = dealRecordLabel(workspaceId, deal);
  return {
    draftHref: draftActivityHref(deal.title),
    explanation: commandCenterExplanation({
      calculation: `The deal was last updated ${days} day${days === 1 ? "" : "s"} before ${formatDate(today)}.`,
      result: "Shown as a stale open deal.",
      rule: "Open deal has not been visibly updated for at least 14 UTC days.",
      sourceHref: href,
      sourceLabel: recordLabel,
      lastUpdatedAt: deal.updatedAt,
      storedValues: [
        { label: "Deal last updated", value: formatDateTime(deal.updatedAt) },
        { label: "Comparison date", value: `${formatDate(today)} UTC` },
        { label: "Stage", value: deal.stage.name || "No stage name" }
      ],
      threshold: `${staleDealDays} days without a visible deal update.`
    }),
    hiddenAt: null,
    href,
    id: `deal-stale-${deal.id}`,
    itemKey: `deal-stale-${deal.id}`,
    kind: "deal_stale",
    priority: 60,
    reason: `Open deal has not been visibly updated in ${days} day${days === 1 ? "" : "s"}.`,
    recordLabel,
    recordType: "Deal",
    safeNextAction: "Review the deal history and draft a follow-up activity if the next step is still unclear.",
    title: "Stale open deal"
  };
}

function quoteFollowUpItem(workspaceId: string, quote: QuoteCommandCenterRecord, today: Date): AssistantTodayCommandCenterItem {
  const days = Math.max(0, daysBetween(quote.updatedAt, today));
  const relatedLabel = quoteDealLabel(workspaceId, quote.deal);
  const href = `/deals/${quote.dealId}/quotes/${quote.id}`;
  const recordLabel = `Quote ${quote.number}`;
  return {
    draftHref: draftActivityHref(`quote ${quote.number}`),
    explanation: commandCenterExplanation({
      calculation: `The sent quote follow-up date basis is ${days} day${days === 1 ? "" : "s"} before ${formatDate(today)}.`,
      result: "Shown as a sent quote awaiting follow-up.",
      rule: "Sent quote has waited at least three UTC days for follow-up while its deal is still open.",
      sourceHref: href,
      sourceLabel: recordLabel,
      lastUpdatedAt: quote.updatedAt,
      storedValues: [
        { label: "Quote status", value: QuoteStatus.SENT },
        { label: "Follow-up date basis", value: formatDateTime(quote.updatedAt) },
        { label: "Deal", value: relatedLabel ?? quote.deal.title },
        { label: "Quote total", value: formatCents(quote.totalCents) }
      ],
      threshold: `${quoteFollowUpDays} days since the sent quote follow-up date basis.`
    }),
    hiddenAt: null,
    href,
    id: `quote-follow-up-${quote.id}`,
    itemKey: `quote-follow-up-${quote.id}`,
    kind: "quote_follow_up",
    priority: 70,
    reason: `Sent quote has waited ${days} day${days === 1 ? "" : "s"} for follow-up${relatedLabel ? ` · Deal ${relatedLabel}` : ""}.`,
    recordLabel,
    recordType: "Quote",
    safeNextAction: "Open the quote, review the deal, then draft or create a manual follow-up activity.",
    title: "Quote awaiting follow-up"
  };
}

function recentLeadItem(workspaceId: string, lead: LeadCommandCenterRecord): AssistantTodayCommandCenterItem {
  const relatedLabel = leadRecordRelatedLabel(workspaceId, lead);
  const href = `/leads/${lead.id}`;
  return {
    draftHref: draftActivityHref(lead.title),
    explanation: commandCenterExplanation({
      calculation: `The lead was created within the ${recentLeadDays}-day new-lead review window.`,
      result: "Shown as a recently created lead needing review.",
      rule: "New lead was created inside the seven-day review window.",
      sourceHref: href,
      sourceLabel: lead.title,
      lastUpdatedAt: lead.createdAt,
      storedValues: [
        { label: "Created", value: formatDateTime(lead.createdAt) },
        { label: "Lead status", value: LeadStatus.NEW },
        { label: "Source", value: lead.source || "No source" },
        { label: "Linked record", value: relatedLabel ?? "No linked contact or organization" }
      ],
      threshold: `Created within the last ${recentLeadDays} UTC days.`
    }),
    hiddenAt: null,
    href,
    id: `lead-review-${lead.id}`,
    itemKey: `lead-review-${lead.id}`,
    kind: "lead_review",
    priority: 80,
    reason: `New lead created ${formatDate(lead.createdAt)}${relatedLabel ? ` · ${relatedLabel}` : lead.source ? ` · Source ${lead.source}` : ""}.`,
    recordLabel: lead.title,
    recordType: "Lead",
    safeNextAction: "Open the lead and review qualification before converting, disqualifying, or drafting a follow-up.",
    title: "New lead needs review"
  };
}

function rankCommandCenterItems(items: AssistantTodayCommandCenterItem[]) {
  const unique = new Map<string, AssistantTodayCommandCenterItem>();
  for (const item of items) {
    const existing = unique.get(item.id);
    if (!existing || item.priority < existing.priority) unique.set(item.id, item);
  }
  return Array.from(unique.values()).sort((a, b) => a.priority - b.priority || a.recordType.localeCompare(b.recordType) || a.recordLabel.localeCompare(b.recordLabel));
}

function withHiddenAt(item: AssistantTodayCommandCenterItem, hiddenAt: Date | null): AssistantTodayCommandCenterItem {
  return {
    ...item,
    hiddenAt: hiddenAt ? hiddenAt.toISOString() : null
  };
}

function commandCenterExplanation(input: {
  calculation: string;
  lastUpdatedAt?: Date | null;
  result: string;
  rule: string;
  sourceHref: string;
  sourceLabel: string;
  storedValues: Array<{ label: string; value: string | null | undefined }>;
  threshold: string;
}): AssistantTodayCommandCenterExplanation {
  return {
    calculation: input.calculation,
    result: input.result,
    rule: input.rule,
    sourceRecord: {
      href: input.sourceHref,
      label: input.sourceLabel,
      lastUpdatedAt: input.lastUpdatedAt ? input.lastUpdatedAt.toISOString() : null
    },
    storedValues: input.storedValues.map((row) => ({
      label: row.label,
      value: row.value?.trim() || "Not available"
    })),
    threshold: input.threshold
  };
}

function activityRelatedLabel(workspaceId: string, activity: DueActivityRecord) {
  const deal = scopeWorkspaceRelation(workspaceId, activity.deal);
  const lead = scopeWorkspaceRelation(workspaceId, activity.lead);
  const organization = scopeWorkspaceRelation(workspaceId, activity.organization);
  const person = scopeWorkspaceRelation(workspaceId, activity.person);
  return deal?.title ?? lead?.title ?? organization?.name ?? formatPersonName(person);
}

function dealRecordLabel(workspaceId: string, deal: DealCommandCenterRecord) {
  const organization = scopeWorkspaceRelation(workspaceId, deal.organization);
  const person = scopeWorkspaceRelation(workspaceId, deal.person);
  const relatedLabel = organization?.name ?? formatPersonName(person) ?? deal.stage.name;
  return `${deal.title} · ${relatedLabel}`;
}

function quoteDealLabel(workspaceId: string, deal: QuoteCommandCenterRecord["deal"]) {
  if (deal.workspaceId !== workspaceId) return null;
  const organization = scopeWorkspaceRelation(workspaceId, deal.organization);
  const person = scopeWorkspaceRelation(workspaceId, deal.person);
  return organization?.name ?? formatPersonName(person) ?? deal.title;
}

function leadRecordRelatedLabel(workspaceId: string, lead: LeadCommandCenterRecord) {
  const organization = scopeWorkspaceRelation(workspaceId, lead.organization);
  const person = scopeWorkspaceRelation(workspaceId, lead.person);
  if (organization?.name) return `Organization ${organization.name}`;
  const personName = formatPersonName(person);
  if (personName) return `Contact ${personName}`;
  return null;
}

function draftActivityHref(recordTitle: string) {
  const command = `Draft a follow-up activity for ${recordTitle}.`;
  return `/assistant?command=${encodeURIComponent(command)}`;
}

export function assistantTodayLocalDateKey(now = new Date(), timeZone = normalizeTimeZone()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric"
    }).formatToParts(now);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return assistantTodayLocalDateKey(now, "UTC");
  }
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function normalizeTimeZone(timeZone?: string) {
  const candidate = timeZone || process.env.NORTHSTAR_LOCAL_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return "UTC";
  }
}

function normalizeAssistantTodayItemKey(value: string) {
  const itemKey = value.trim().slice(0, 240);
  return isSafeItemKey(itemKey) ? itemKey : "";
}

function isSafeItemKey(value: string) {
  return itemKeyPattern.test(value);
}

function addUtcDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function daysBetween(start: Date, end: Date) {
  return Math.ceil((startOfUtcDay(end).getTime() - startOfUtcDay(start).getTime()) / 86_400_000);
}

function formatDate(value: Date | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" }).format(value);
}

function formatDateTime(value: Date | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric"
  }).format(value);
}

function formatDueValue(value: Date | null) {
  return value ? `due ${formatDateTime(value)}` : "no due date";
}

function formatCents(value: number) {
  return new Intl.NumberFormat("en-US", { currency: "USD", style: "currency" }).format(value / 100);
}

function activityDueBucket(activity: { completedAt?: Date | string | null; dueAt?: Date | string | null }, now: Date) {
  if (activity.completedAt) return "unscheduled";
  if (!activity.dueAt) return "unscheduled";
  const dueAt = new Date(activity.dueAt);
  if (Number.isNaN(dueAt.getTime())) return "unscheduled";
  const today = startOfUtcDay(now);
  const tomorrow = addUtcDays(today, 1);
  if (dueAt < today) return "overdue";
  if (dueAt < tomorrow) return "today";
  return "upcoming";
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
