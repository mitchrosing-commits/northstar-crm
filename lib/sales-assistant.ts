import { DealStatus, LeadStatus, QuoteStatus } from "@prisma/client";

import { classifyActivityDue } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

export const salesAssistantThresholds = {
  staleDealDays: 14,
  quoteWaitingDays: 7,
  closingSoonDays: 7,
  recentInboundEmailDays: 7
} as const;

export type DealAttentionBadgeKind =
  | "no-next-activity"
  | "overdue"
  | "stale"
  | "contract-blocked"
  | "quote-waiting"
  | "email-follow-up"
  | "closing-soon";

export type DealAttentionBadge = {
  kind: DealAttentionBadgeKind;
  label: string;
};

export type NeedsAttentionItem = {
  id: string;
  kind:
    | "overdue-activity"
    | "activity-due-today"
    | "deal-no-next-activity"
    | "stale-deal"
    | "lead-no-activity"
    | "quote-waiting"
    | "contract-attention"
    | "closing-soon"
    | "email-follow-up";
  title: string;
  reason: string;
  href: string;
  actionLabel: string;
  actionHref: string;
  priority: number;
};

type ActivitySignal = {
  id?: string;
  title?: string;
  dueAt?: Date | string | null;
  completedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

type TimestampSignal = {
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  occurredAt?: Date | string | null;
  completedAt?: Date | string | null;
};

type QuoteSignal = {
  status?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

type EmailSignal = {
  direction?: string | null;
  occurredAt?: Date | string | null;
};

type ContractFieldSignal = {
  key: string;
  name: string;
  value: unknown;
  updatedAt?: Date | string | null;
};

export type DealAttentionSignal = {
  status?: string | null;
  updatedAt?: Date | string | null;
  expectedCloseAt?: Date | string | null;
  activities?: ActivitySignal[];
  notes?: TimestampSignal[];
  emailLogs?: EmailSignal[];
  quotes?: QuoteSignal[];
  contractFields?: ContractFieldSignal[];
};

const contractFieldKeys = ["nda_status", "msa_status", "sow_status"] as const;
const contractStatusAttentionValues = new Set(["blocked", "in review", "sent"]);

export async function getNeedsAttentionSummary(actor: WorkspaceActor, now = new Date()) {
  await ensureWorkspaceAccess(actor);

  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const quoteWaitingBefore = addDays(now, -salesAssistantThresholds.quoteWaitingDays);

  const [priorityActivities, openDeals, activeLeads, waitingQuotes] = await Promise.all([
    prisma.activity.findMany({
      where: {
        workspaceId: actor.workspaceId,
        completedAt: null,
        dueAt: { lt: tomorrow },
        ...activeWhere
      },
      include: {
        deal: true,
        lead: true,
        person: true,
        organization: true
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 8
    }),
    prisma.deal.findMany({
      where: { workspaceId: actor.workspaceId, status: DealStatus.OPEN, ...activeWhere },
      include: {
        stage: true,
        activities: {
          where: { ...activeWhere, completedAt: null },
          orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          take: 1
        },
        notes: {
          where: activeWhere,
          orderBy: { createdAt: "desc" },
          take: 1
        },
        emailLogs: {
          orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
          take: 1
        },
        quotes: {
          where: { status: QuoteStatus.SENT },
          orderBy: { updatedAt: "desc" },
          take: 1
        }
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      take: 50
    }),
    prisma.lead.findMany({
      where: { workspaceId: actor.workspaceId, status: { in: [LeadStatus.NEW, LeadStatus.QUALIFIED] }, ...activeWhere },
      include: {
        activities: {
          where: { ...activeWhere, completedAt: null },
          orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
          take: 1
        }
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      take: 20
    }),
    prisma.quote.findMany({
      where: {
        workspaceId: actor.workspaceId,
        status: QuoteStatus.SENT,
        updatedAt: { lte: quoteWaitingBefore },
        deal: { workspaceId: actor.workspaceId, status: DealStatus.OPEN, ...activeWhere }
      },
      include: { deal: true },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      take: 10
    })
  ]);

  const contractFields = await loadContractFields(actor.workspaceId, openDeals.map((deal) => deal.id));
  const items: NeedsAttentionItem[] = [];

  for (const activity of priorityActivities) {
    const dueBucket = classifyActivityDue(activity, now);
    const related = activity.deal ?? activity.lead ?? activity.person ?? activity.organization;
    const href = activity.deal
      ? `/deals/${activity.deal.id}`
      : activity.lead
        ? `/leads/${activity.lead.id}`
        : activity.person
          ? `/contacts/${activity.person.id}`
          : activity.organization
            ? `/organizations/${activity.organization.id}`
            : `/activities/${activity.id}/edit`;
    items.push({
      id: `activity-${activity.id}`,
      kind: dueBucket === "overdue" ? "overdue-activity" : "activity-due-today",
      title: activity.title,
      reason: dueBucket === "overdue" ? "This activity is overdue." : "This activity is due today.",
      href,
      actionLabel: "Open activity",
      actionHref: `/activities/${activity.id}/edit`,
      priority: dueBucket === "overdue" ? 10 : 20
    });
  }

  for (const deal of openDeals) {
    const fields = contractFields.get(deal.id) ?? [];
    const badges = buildDealAttentionBadges({ ...deal, contractFields: fields }, now);

    for (const badge of badges) {
      if (badge.kind === "overdue" || badge.kind === "quote-waiting") continue;
      items.push({
        id: `deal-${deal.id}-${badge.kind}`,
        kind: dealItemKind(badge.kind),
        title: deal.title,
        reason: dealReason(badge),
        href: `/deals/${deal.id}`,
        actionLabel: dealActionLabel(badge.kind),
        actionHref: dealActionHref(deal.id, badge.kind),
        priority: dealPriority(badge.kind)
      });
    }
  }

  for (const lead of activeLeads) {
    if (lead.activities.length > 0) continue;
    items.push({
      id: `lead-${lead.id}-no-activity`,
      kind: "lead-no-activity",
      title: lead.title,
      reason: "This active lead has no next activity.",
      href: `/leads/${lead.id}`,
      actionLabel: "Create activity",
      actionHref: `/leads/${lead.id}`,
      priority: 70
    });
  }

  for (const quote of waitingQuotes) {
    items.push({
      id: `quote-${quote.id}-waiting`,
      kind: "quote-waiting",
      title: quote.number,
      reason: "This quote is sent and waiting for a customer response.",
      href: `/deals/${quote.dealId}/quotes/${quote.id}`,
      actionLabel: "Review quote",
      actionHref: `/deals/${quote.dealId}/quotes/${quote.id}`,
      priority: 60
    });
  }

  return dedupeAttentionItems(items)
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title))
    .slice(0, 12);
}

export function buildDealAttentionBadges(deal: DealAttentionSignal, now = new Date()): DealAttentionBadge[] {
  if (deal.status && deal.status !== DealStatus.OPEN) return [];

  const badges: DealAttentionBadge[] = [];
  const openActivity = deal.activities?.find((activity) => !activity.completedAt);
  const dueBucket = openActivity ? classifyActivityDue(openActivity, now) : "none";

  if (!openActivity) {
    badges.push({ kind: "no-next-activity", label: "No next activity" });
  } else if (dueBucket === "overdue") {
    badges.push({ kind: "overdue", label: "Overdue" });
  }

  if (isStaleDeal(deal, now)) {
    badges.push({ kind: "stale", label: "Stale" });
  }

  if (hasContractAttention(deal.contractFields ?? [])) {
    badges.push({ kind: "contract-blocked", label: "Contract attention" });
  }

  if (hasWaitingQuote(deal.quotes ?? [], now)) {
    badges.push({ kind: "quote-waiting", label: "Quote waiting" });
  }

  if (hasRecentInboundEmail(deal.emailLogs ?? [], now) && !openActivity) {
    badges.push({ kind: "email-follow-up", label: "Email follow-up" });
  }

  if (isClosingSoon(deal.expectedCloseAt, now)) {
    badges.push({ kind: "closing-soon", label: "Closing soon" });
  }

  return badges;
}

function isStaleDeal(deal: DealAttentionSignal, now: Date) {
  const latest = latestTimestamp([
    deal.updatedAt,
    ...(deal.activities ?? []).flatMap((activity) => [activity.completedAt, activity.createdAt]),
    ...(deal.notes ?? []).map((note) => note.createdAt),
    ...(deal.emailLogs ?? []).map((emailLog) => emailLog.occurredAt),
    ...(deal.quotes ?? []).map((quote) => quote.updatedAt ?? quote.createdAt)
  ]);
  if (!latest) return false;
  return latest.getTime() <= addDays(now, -salesAssistantThresholds.staleDealDays).getTime();
}

function hasWaitingQuote(quotes: QuoteSignal[], now: Date) {
  const waitingBefore = addDays(now, -salesAssistantThresholds.quoteWaitingDays).getTime();
  return quotes.some((quote) => {
    if (quote.status !== QuoteStatus.SENT) return false;
    const timestamp = toDate(quote.updatedAt ?? quote.createdAt);
    return timestamp ? timestamp.getTime() <= waitingBefore : false;
  });
}

function hasContractAttention(fields: ContractFieldSignal[]) {
  return fields.some((field) => contractStatusAttentionValues.has(String(field.value ?? "").trim().toLowerCase()));
}

function hasRecentInboundEmail(emailLogs: EmailSignal[], now: Date) {
  const recentAfter = addDays(now, -salesAssistantThresholds.recentInboundEmailDays).getTime();
  return emailLogs.some((emailLog) => {
    if (emailLog.direction !== "INBOUND") return false;
    const occurredAt = toDate(emailLog.occurredAt);
    return occurredAt ? occurredAt.getTime() >= recentAfter : false;
  });
}

function isClosingSoon(value: Date | string | null | undefined, now: Date) {
  const expectedCloseAt = toDate(value);
  if (!expectedCloseAt) return false;
  return expectedCloseAt.getTime() >= startOfDay(now).getTime() && expectedCloseAt.getTime() <= addDays(now, salesAssistantThresholds.closingSoonDays).getTime();
}

function latestTimestamp(values: Array<Date | string | null | undefined>) {
  return values.reduce<Date | null>((latest, value) => {
    const date = toDate(value);
    if (!date) return latest;
    return !latest || date.getTime() > latest.getTime() ? date : latest;
  }, null);
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function loadContractFields(workspaceId: string, dealIds: string[]) {
  const fieldsByDeal = new Map<string, ContractFieldSignal[]>();
  if (dealIds.length === 0) return fieldsByDeal;

  const values = await prisma.customFieldValue.findMany({
    where: {
      workspaceId,
      entityType: "DEAL",
      entityId: { in: dealIds },
      field: {
        workspaceId,
        entityType: "DEAL",
        key: { in: [...contractFieldKeys] },
        ...activeWhere
      }
    },
    include: { field: true }
  });

  for (const value of values) {
    const existing = fieldsByDeal.get(value.entityId) ?? [];
    existing.push({
      key: value.field.key,
      name: value.field.name,
      updatedAt: value.updatedAt,
      value: value.value
    });
    fieldsByDeal.set(value.entityId, existing);
  }

  return fieldsByDeal;
}

function dealItemKind(kind: DealAttentionBadgeKind): NeedsAttentionItem["kind"] {
  if (kind === "no-next-activity") return "deal-no-next-activity";
  if (kind === "stale") return "stale-deal";
  if (kind === "contract-blocked") return "contract-attention";
  if (kind === "quote-waiting") return "quote-waiting";
  if (kind === "email-follow-up") return "email-follow-up";
  if (kind === "closing-soon") return "closing-soon";
  return "overdue-activity";
}

function dealReason(badge: DealAttentionBadge) {
  if (badge.kind === "no-next-activity") return "This open deal has no next activity scheduled.";
  if (badge.kind === "stale") return `No activity, note, quote, or email update in ${salesAssistantThresholds.staleDealDays}+ days.`;
  if (badge.kind === "contract-blocked") return "A contract status is blocked, in review, or sent.";
  if (badge.kind === "quote-waiting") return `A sent quote has been waiting ${salesAssistantThresholds.quoteWaitingDays}+ days.`;
  if (badge.kind === "email-follow-up") return "A recent inbound email is linked, but no next activity is scheduled.";
  if (badge.kind === "closing-soon") return `Expected close is within ${salesAssistantThresholds.closingSoonDays} days.`;
  return "This deal needs attention.";
}

function dealActionLabel(kind: DealAttentionBadgeKind) {
  if (kind === "contract-blocked") return "Update contract";
  if (kind === "quote-waiting") return "Review quote";
  if (kind === "email-follow-up") return "Open email";
  if (kind === "closing-soon") return "Open deal";
  return "Add follow-up";
}

function dealActionHref(dealId: string, kind: DealAttentionBadgeKind) {
  if (kind === "contract-blocked") return `/deals/${dealId}#contract-workflow`;
  if (kind === "quote-waiting") return `/deals/${dealId}`;
  if (kind === "email-follow-up") return "/email";
  if (kind === "closing-soon") return `/deals/${dealId}`;
  return `/deals/${dealId}#add-activity`;
}

function dealPriority(kind: DealAttentionBadgeKind) {
  if (kind === "contract-blocked") return 30;
  if (kind === "email-follow-up") return 35;
  if (kind === "no-next-activity") return 40;
  if (kind === "quote-waiting") return 50;
  if (kind === "closing-soon") return 55;
  if (kind === "stale") return 65;
  return 80;
}

function dedupeAttentionItems(items: NeedsAttentionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}
