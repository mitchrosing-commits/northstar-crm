import { DealStatus, LeadStatus, QuoteStatus } from "@prisma/client";

import { startOfDay } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { getFollowUpHealthSummary } from "@/lib/services/activity-service";
import { activityAttachmentRelationsWhere, noteAttachmentRelationsWhere } from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

const leadStatuses = [LeadStatus.NEW, LeadStatus.QUALIFIED, LeadStatus.DISQUALIFIED, LeadStatus.CONVERTED] as const;
const activeLeadStatuses = [LeadStatus.NEW, LeadStatus.QUALIFIED] as const;

type DashboardDealStatusGroup = {
  status: DealStatus;
  _count: { _all: number };
  _sum: { valueCents: number | null };
};

export async function getDashboardSummary(actor: WorkspaceActor, now = new Date()) {
  await ensureWorkspaceAccess(actor);

  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const scopedActivityWhere = {
    workspaceId: actor.workspaceId,
    ...activityAttachmentRelationsWhere(actor.workspaceId),
    ...activeWhere
  };

  const [
    dealStatusGroups,
    stages,
    recentOpenDeals,
    priorityActivities,
    recentQuotes,
    leadStatusGroups,
    activeLeadsCount,
    leadRecordCount,
    personRecordCount,
    organizationRecordCount,
    activityRecordCount,
    quoteRecordCount,
    productRecordCount,
    noteRecordCount,
    overdueActivitiesCount,
    dueTodayActivitiesCount,
    upcomingActivitiesCount,
    completedActivitiesCount,
    followUpHealth,
    openQuotedDealValue,
    openUnquotedDealValue,
    openDealsWithoutQuotesCount,
    openValueWithoutLineItemsCount,
    draftQuotesCount,
    acceptedQuotesCount,
    recentClosedDealRecords,
    recentChanges
  ] = await Promise.all([
    prisma.deal.groupBy({
      by: ["status"],
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      _count: { _all: true },
      _sum: { valueCents: true }
    }),
    prisma.pipelineStage.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        pipeline: { select: { id: true, name: true, sortOrder: true } },
        deals: {
          where: { workspaceId: actor.workspaceId, status: DealStatus.OPEN, ...activeWhere },
          select: { id: true, valueCents: true }
        }
      },
      orderBy: [{ pipelineId: "asc" }, { sortOrder: "asc" }]
    }),
    prisma.deal.findMany({
      where: { workspaceId: actor.workspaceId, status: DealStatus.OPEN, ...activeWhere },
      include: {
        stage: true,
        person: true,
        organization: true,
        owner: { select: userDisplaySelect }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 5
    }),
    prisma.activity.findMany({
      where: { ...scopedActivityWhere, completedAt: null },
      include: {
        deal: true,
        lead: true,
        person: true,
        organization: true,
        owner: { select: userDisplaySelect }
      },
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 5
    }),
    prisma.quote.findMany({
      where: { workspaceId: actor.workspaceId, deal: { workspaceId: actor.workspaceId, ...activeWhere } },
      include: {
        deal: {
          include: {
            person: true,
            organization: true
          }
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 5
    }),
    prisma.lead.groupBy({
      by: ["status"],
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      _count: { _all: true }
    }),
    prisma.lead.count({
      where: { workspaceId: actor.workspaceId, status: { in: [...activeLeadStatuses] }, ...activeWhere }
    }),
    prisma.lead.count({
      where: { workspaceId: actor.workspaceId, ...activeWhere }
    }),
    prisma.person.count({
      where: { workspaceId: actor.workspaceId, ...activeWhere }
    }),
    prisma.organization.count({
      where: { workspaceId: actor.workspaceId, ...activeWhere }
    }),
    prisma.activity.count({
      where: scopedActivityWhere
    }),
    prisma.quote.count({
      where: { workspaceId: actor.workspaceId, deal: { workspaceId: actor.workspaceId, ...activeWhere } }
    }),
    prisma.product.count({
      where: { workspaceId: actor.workspaceId, ...activeWhere }
    }),
    prisma.note.count({
      where: { workspaceId: actor.workspaceId, ...noteAttachmentRelationsWhere(actor.workspaceId), ...activeWhere }
    }),
    prisma.activity.count({
      where: { ...scopedActivityWhere, completedAt: null, dueAt: { lt: today } }
    }),
    prisma.activity.count({
      where: { ...scopedActivityWhere, completedAt: null, dueAt: { gte: today, lt: tomorrow } }
    }),
    prisma.activity.count({
      where: { ...scopedActivityWhere, completedAt: null, dueAt: { gte: tomorrow } }
    }),
    prisma.activity.count({
      where: { ...scopedActivityWhere, completedAt: { not: null } }
    }),
    getFollowUpHealthSummary(actor, now),
    prisma.deal.aggregate({
      where: {
        workspaceId: actor.workspaceId,
        status: DealStatus.OPEN,
        quotes: { some: { workspaceId: actor.workspaceId } },
        ...activeWhere
      },
      _sum: { valueCents: true }
    }),
    prisma.deal.aggregate({
      where: {
        workspaceId: actor.workspaceId,
        status: DealStatus.OPEN,
        quotes: { none: { workspaceId: actor.workspaceId } },
        ...activeWhere
      },
      _sum: { valueCents: true }
    }),
    prisma.deal.count({
      where: {
        workspaceId: actor.workspaceId,
        status: DealStatus.OPEN,
        quotes: { none: { workspaceId: actor.workspaceId } },
        ...activeWhere
      }
    }),
    prisma.deal.count({
      where: {
        workspaceId: actor.workspaceId,
        status: DealStatus.OPEN,
        valueCents: { gt: 0 },
        lineItems: { none: { workspaceId: actor.workspaceId } },
        ...activeWhere
      }
    }),
    prisma.quote.count({
      where: {
        workspaceId: actor.workspaceId,
        status: QuoteStatus.DRAFT,
        deal: { workspaceId: actor.workspaceId, status: DealStatus.OPEN, ...activeWhere }
      }
    }),
    prisma.quote.count({
      where: {
        workspaceId: actor.workspaceId,
        status: QuoteStatus.ACCEPTED,
        deal: { workspaceId: actor.workspaceId, ...activeWhere }
      }
    }),
    prisma.deal.findMany({
      where: {
        workspaceId: actor.workspaceId,
        status: { in: [DealStatus.WON, DealStatus.LOST] },
        OR: [{ wonAt: { not: null } }, { lostAt: { not: null } }],
        ...activeWhere
      },
      include: {
        organization: true,
        owner: { select: userDisplaySelect },
        person: true,
        stage: true
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 20
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);

  const dealMetrics = summarizeDealStatusMetrics(dealStatusGroups);
  const leadCounts = new Map(leadStatusGroups.map((group) => [group.status, group._count._all]));
  const dealRecordCount = dealMetrics.totalDealsCount;
  const recentClosedDeals = recentClosedDealRecords
    .flatMap((deal) => {
      const scopedDeal = scopeDashboardDealRelations(deal);
      const closedAt = deal.status === DealStatus.WON ? deal.wonAt : deal.lostAt;
      if (!closedAt) return [];

      return [
        {
          id: scopedDeal.id,
          title: scopedDeal.title,
          status: scopedDeal.status,
          valueCents: scopedDeal.valueCents ?? 0,
          currency: scopedDeal.currency,
          closedAt,
          organization: scopedDeal.organization ? { id: scopedDeal.organization.id, name: scopedDeal.organization.name } : null,
          ownerName: scopedDeal.owner?.name ?? scopedDeal.owner?.email ?? "Unassigned",
          person: scopedDeal.person
            ? { id: scopedDeal.person.id, firstName: scopedDeal.person.firstName, lastName: scopedDeal.person.lastName }
            : null,
          stageName: scopedDeal.stage.name
        }
      ];
    })
    .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime())
    .slice(0, 6);
  const hasMeaningfulCrmData =
    dealRecordCount +
      leadRecordCount +
      personRecordCount +
      organizationRecordCount +
      activityRecordCount +
      quoteRecordCount +
      productRecordCount +
      noteRecordCount >
    0;

  return {
    metrics: {
      openPipelineValueCents: dealMetrics.openPipelineValueCents,
      openDealsCount: dealMetrics.openDealsCount,
      wonDealsCount: dealMetrics.wonDealsCount,
      wonDealsValueCents: dealMetrics.wonDealsValueCents,
      lostDealsCount: dealMetrics.lostDealsCount,
      lostDealsValueCents: dealMetrics.lostDealsValueCents,
      activeLeadsCount,
      activeLeadsMissingNextActivity: followUpHealth.activeLeadsMissingNextActivity,
      overdueActivitiesCount,
      dueTodayActivitiesCount
    },
    onboarding: {
      isCleanWorkspace: !hasMeaningfulCrmData,
      counts: {
        deals: dealRecordCount,
        contacts: personRecordCount,
        organizations: organizationRecordCount,
        activities: activityRecordCount,
        quotes: quoteRecordCount,
        products: productRecordCount,
        notes: noteRecordCount,
        leads: leadRecordCount
      }
    },
    pipelineBreakdown: stages.map((stage) => ({
      stageId: stage.id,
      stageName: stage.name,
      pipelineId: stage.pipelineId,
      pipelineName: stage.pipeline.name,
      openDealCount: stage.deals.length,
      openDealValueCents: stage.deals.reduce((sum, deal) => sum + (deal.valueCents ?? 0), 0)
    })),
    leadBreakdown: leadStatuses.map((status) => ({
      status,
      count: leadCounts.get(status) ?? 0
    })),
    activitySnapshot: {
      overdue: overdueActivitiesCount,
      dueToday: dueTodayActivitiesCount,
      upcoming: upcomingActivitiesCount,
      completed: completedActivitiesCount,
      completedRecently: followUpHealth.recentlyCompletedActivities
    },
    pipelineHealth: {
      openDeals: dealMetrics.openDealsCount,
      openValueCents: dealMetrics.openPipelineValueCents,
      overdueActivities: overdueActivitiesCount,
      dueTodayActivities: dueTodayActivitiesCount,
      activeLeadsWithoutNextActivity: followUpHealth.activeLeadsMissingNextActivity,
      openDealsWithoutNextActivity: followUpHealth.openDealsMissingNextActivity
    },
    commercialSnapshot: {
      openQuotedDealValueCents: openQuotedDealValue._sum.valueCents ?? 0,
      openUnquotedDealValueCents: openUnquotedDealValue._sum.valueCents ?? 0,
      openDealsWithoutQuotes: openDealsWithoutQuotesCount,
      openValueWithoutLineItems: openValueWithoutLineItemsCount,
      draftQuotes: draftQuotesCount,
      acceptedQuotes: acceptedQuotesCount
    },
    recentClosedDeals,
    recentOpenDeals: recentOpenDeals.map((deal) => scopeDashboardDealRelations(deal)),
    priorityActivities,
    recentQuotes: recentQuotes.map((quote) => scopeDashboardQuoteRelations(quote)),
    recentChanges
  };
}

function scopeDashboardDealRelations<T extends { workspaceId: string; person: WorkspaceScopedRelation; organization: WorkspaceScopedRelation }>(
  deal: T
) {
  return {
    ...deal,
    person: scopeWorkspaceRelation(deal.workspaceId, deal.person),
    organization: scopeWorkspaceRelation(deal.workspaceId, deal.organization)
  };
}

function scopeDashboardQuoteRelations<
  T extends {
    deal: { workspaceId: string; person: WorkspaceScopedRelation; organization: WorkspaceScopedRelation };
  }
>(quote: T) {
  return {
    ...quote,
    deal: scopeDashboardDealRelations(quote.deal)
  };
}

export function summarizeDealStatusMetrics(groups: DashboardDealStatusGroup[]) {
  const dealCounts = new Map(groups.map((group) => [group.status, group]));
  const openDealGroup = dealCounts.get(DealStatus.OPEN);
  const wonDealGroup = dealCounts.get(DealStatus.WON);
  const lostDealGroup = dealCounts.get(DealStatus.LOST);

  return {
    totalDealsCount: groups.reduce((sum, group) => sum + group._count._all, 0),
    openPipelineValueCents: openDealGroup?._sum.valueCents ?? 0,
    openDealsCount: openDealGroup?._count._all ?? 0,
    wonDealsCount: wonDealGroup?._count._all ?? 0,
    wonDealsValueCents: wonDealGroup?._sum.valueCents ?? 0,
    lostDealsCount: lostDealGroup?._count._all ?? 0,
    lostDealsValueCents: lostDealGroup?._sum.valueCents ?? 0
  };
}
