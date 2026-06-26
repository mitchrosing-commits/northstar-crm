import { DealStatus, LeadStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

const leadStatuses = [LeadStatus.NEW, LeadStatus.QUALIFIED, LeadStatus.DISQUALIFIED, LeadStatus.CONVERTED] as const;
const activeLeadStatuses = [LeadStatus.NEW, LeadStatus.QUALIFIED] as const;

export async function getDashboardSummary(actor: WorkspaceActor, now = new Date()) {
  await ensureWorkspaceAccess(actor);

  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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
      where: { workspaceId: actor.workspaceId, completedAt: null, ...activeWhere },
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
      where: { workspaceId: actor.workspaceId, ...activeWhere }
    }),
    prisma.quote.count({
      where: { workspaceId: actor.workspaceId }
    }),
    prisma.product.count({
      where: { workspaceId: actor.workspaceId, ...activeWhere }
    }),
    prisma.note.count({
      where: { workspaceId: actor.workspaceId, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: null, dueAt: { lt: today }, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: null, dueAt: { gte: today, lt: tomorrow }, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: null, dueAt: { gte: tomorrow }, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: { not: null }, ...activeWhere }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);

  const dealCounts = new Map(dealStatusGroups.map((group) => [group.status, group]));
  const leadCounts = new Map(leadStatusGroups.map((group) => [group.status, group._count._all]));
  const openDealGroup = dealCounts.get(DealStatus.OPEN);
  const dealRecordCount = dealStatusGroups.reduce((sum, group) => sum + group._count._all, 0);
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
      openPipelineValueCents: openDealGroup?._sum.valueCents ?? 0,
      openDealsCount: openDealGroup?._count._all ?? 0,
      wonDealsCount: dealCounts.get(DealStatus.WON)?._count._all ?? 0,
      lostDealsCount: dealCounts.get(DealStatus.LOST)?._count._all ?? 0,
      activeLeadsCount,
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
      completed: completedActivitiesCount
    },
    recentOpenDeals,
    priorityActivities,
    recentQuotes,
    recentChanges
  };
}

function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}
