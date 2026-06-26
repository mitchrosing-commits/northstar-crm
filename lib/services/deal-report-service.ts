import { ActivityType, DealStatus, QuoteStatus } from "@prisma/client";

import { classifyDealAttention } from "@/lib/deal-attention";
import { prisma } from "@/lib/db/prisma";
import type { DealListFilters } from "./deal-service";
import { listDeals } from "./deal-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export type DealForecastInput = {
  id: string;
  title: string;
  status: DealStatus | string;
  valueCents: number | null;
  currency: string;
  expectedCloseAt: Date | string | null;
  pipeline: { id: string; name: string; sortOrder?: number | null };
  stage: { id: string; name: string; probability: number | null; sortOrder?: number | null };
  owner: { id: string; name: string | null; email: string } | null;
};

export async function getDealReport(actor: WorkspaceActor, filters: DealListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const [deals, stages] = await Promise.all([
    listDeals(actor, filters),
    prisma.pipelineStage.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      include: { pipeline: { select: { id: true, name: true, sortOrder: true } } },
      orderBy: [{ pipeline: { sortOrder: "asc" } }, { sortOrder: "asc" }]
    })
  ]);

  const metrics = {
    openPipelineValueCents: 0,
    openDealsCount: 0,
    wonDealsCount: 0,
    wonDealsValueCents: 0,
    lostDealsCount: 0,
    lostDealsValueCents: 0,
    dealsWithOverdueActivities: 0,
    dealsDueToday: 0,
    dealsWithNoNextActivity: 0
  };
  const stageTotals = new Map<string, { openDealCount: number; openDealValueCents: number }>();
  const quoteStatusEntries = Object.values(QuoteStatus).map((status) => [status, { count: 0, totalCents: 0 }] as const);
  const quoteStatusSummary = Object.fromEntries(quoteStatusEntries) as Record<QuoteStatus, { count: number; totalCents: number }>;
  const topOrganizations = new Map<
    string,
    { organizationId: string; organizationName: string; currency: string; openDealCount: number; openValueCents: number }
  >();

  for (const deal of deals) {
    const valueCents = deal.valueCents ?? 0;

    if (deal.status === DealStatus.OPEN) {
      metrics.openDealsCount += 1;
      metrics.openPipelineValueCents += valueCents;
      const current = stageTotals.get(deal.stageId) ?? { openDealCount: 0, openDealValueCents: 0 };
      current.openDealCount += 1;
      current.openDealValueCents += valueCents;
      stageTotals.set(deal.stageId, current);
      if (deal.organization) {
        const organizationCurrency = deal.currency || "USD";
        const organizationKey = `${deal.organization.id}:${organizationCurrency}`;
        const organization = topOrganizations.get(organizationKey) ?? {
          organizationId: deal.organization.id,
          organizationName: deal.organization.name,
          currency: organizationCurrency,
          openDealCount: 0,
          openValueCents: 0
        };
        organization.openDealCount += 1;
        organization.openValueCents += valueCents;
        topOrganizations.set(organizationKey, organization);
      }

      const attention = classifyDealAttention(deal);
      if (attention === "overdue") metrics.dealsWithOverdueActivities += 1;
      if (attention === "today") metrics.dealsDueToday += 1;
      if (attention === "none") metrics.dealsWithNoNextActivity += 1;
    }

    if (deal.status === DealStatus.WON) {
      metrics.wonDealsCount += 1;
      metrics.wonDealsValueCents += valueCents;
    }

    if (deal.status === DealStatus.LOST) {
      metrics.lostDealsCount += 1;
      metrics.lostDealsValueCents += valueCents;
    }
  }

  const [activityTypeGroups, openActivityCount, completedActivityCount, quoteGroups, topOpenDeals] = await Promise.all([
    prisma.activity.groupBy({
      by: ["type"],
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      _count: { _all: true }
    }),
    prisma.activity.count({ where: { workspaceId: actor.workspaceId, completedAt: null, ...activeWhere } }),
    prisma.activity.count({ where: { workspaceId: actor.workspaceId, completedAt: { not: null }, ...activeWhere } }),
    prisma.quote.groupBy({
      by: ["status"],
      where: { workspaceId: actor.workspaceId, deal: { workspaceId: actor.workspaceId, ...activeWhere } },
      _count: { _all: true },
      _sum: { totalCents: true }
    }),
    prisma.deal.findMany({
      where: { workspaceId: actor.workspaceId, status: DealStatus.OPEN, ...activeWhere },
      include: {
        stage: true,
        organization: true,
        owner: { select: userDisplaySelect }
      },
      orderBy: [{ valueCents: "desc" }, { updatedAt: "desc" }],
      take: 5
    })
  ]);

  for (const quote of quoteGroups) {
    quoteStatusSummary[quote.status] = {
      count: quote._count._all,
      totalCents: quote._sum.totalCents ?? 0
    };
  }

  return {
    metrics,
    activitySummary: {
      open: openActivityCount,
      completed: completedActivityCount,
      byType: Object.values(ActivityType).map((type) => ({
        type,
        count: activityTypeGroups.find((group) => group.type === type)?._count._all ?? 0
      }))
    },
    quoteSummary: Object.values(QuoteStatus).map((status) => ({
      status,
      count: quoteStatusSummary[status].count,
      totalCents: quoteStatusSummary[status].totalCents
    })),
    topOpenDeals: topOpenDeals.map((deal) => ({
      id: deal.id,
      title: deal.title,
      valueCents: deal.valueCents ?? 0,
      currency: deal.currency,
      stageName: deal.stage.name,
      organization: deal.organization ? { id: deal.organization.id, name: deal.organization.name } : null,
      ownerName: deal.owner?.name ?? deal.owner?.email ?? "Unassigned"
    })),
    topOrganizations: Array.from(topOrganizations.values())
      .sort((a, b) => b.openValueCents - a.openValueCents || a.organizationName.localeCompare(b.organizationName))
      .slice(0, 5),
    forecast: calculateDealForecast(deals),
    stageBreakdown: stages.map((stage) => {
      const totals = stageTotals.get(stage.id) ?? { openDealCount: 0, openDealValueCents: 0 };
      return {
        stageId: stage.id,
        stageName: stage.name,
        pipelineId: stage.pipelineId,
        pipelineName: stage.pipeline.name,
        openDealCount: totals.openDealCount,
        openDealValueCents: totals.openDealValueCents
      };
    })
  };
}

export function calculateDealForecast(deals: DealForecastInput[]) {
  const rows = deals
    .filter((deal) => deal.status === DealStatus.OPEN)
    .map((deal) => {
      const valueCents = deal.valueCents ?? 0;
      const probability = deal.stage.probability;
      return {
        dealId: deal.id,
        dealTitle: deal.title,
        pipelineId: deal.pipeline.id,
        pipelineName: deal.pipeline.name,
        pipelineSortOrder: deal.pipeline.sortOrder ?? 0,
        stageId: deal.stage.id,
        stageName: deal.stage.name,
        stageSortOrder: deal.stage.sortOrder ?? 0,
        stageProbability: probability,
        ownerName: deal.owner?.name ?? deal.owner?.email ?? "Unassigned",
        expectedCloseAt: deal.expectedCloseAt,
        valueCents,
        currency: deal.currency || "USD",
        weightedValueCents: probability == null ? null : Math.round((valueCents * probability) / 100)
      };
    })
    .sort((a, b) => {
      const dateA = a.expectedCloseAt ? new Date(a.expectedCloseAt).getTime() : Number.POSITIVE_INFINITY;
      const dateB = b.expectedCloseAt ? new Date(b.expectedCloseAt).getTime() : Number.POSITIVE_INFINITY;
      if (dateA !== dateB) return dateA - dateB;
      if (a.pipelineSortOrder !== b.pipelineSortOrder) return a.pipelineSortOrder - b.pipelineSortOrder;
      if (a.stageSortOrder !== b.stageSortOrder) return a.stageSortOrder - b.stageSortOrder;
      return a.dealTitle.localeCompare(b.dealTitle);
    });

  const currencySummaries = new Map<
    string,
    {
      currency: string;
      openDealCount: number;
      openForecastValueCents: number;
      weightedForecastValueCents: number;
      missingProbabilityDealCount: number;
      missingProbabilityValueCents: number;
      noExpectedCloseDealCount: number;
      noExpectedCloseValueCents: number;
    }
  >();

  for (const row of rows) {
    const summary = currencySummaries.get(row.currency) ?? {
      currency: row.currency,
      openDealCount: 0,
      openForecastValueCents: 0,
      weightedForecastValueCents: 0,
      missingProbabilityDealCount: 0,
      missingProbabilityValueCents: 0,
      noExpectedCloseDealCount: 0,
      noExpectedCloseValueCents: 0
    };

    summary.openDealCount += 1;
    summary.openForecastValueCents += row.valueCents;
    if (row.weightedValueCents == null) {
      summary.missingProbabilityDealCount += 1;
      summary.missingProbabilityValueCents += row.valueCents;
    } else {
      summary.weightedForecastValueCents += row.weightedValueCents;
    }
    if (!row.expectedCloseAt) {
      summary.noExpectedCloseDealCount += 1;
      summary.noExpectedCloseValueCents += row.valueCents;
    }

    currencySummaries.set(row.currency, summary);
  }

  const summaries = Array.from(currencySummaries.values()).sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    openDealCount: rows.length,
    currencyCount: summaries.length,
    hasMultipleCurrencies: summaries.length > 1,
    hasStageProbabilities: rows.some((row) => row.stageProbability != null),
    hasMissingStageProbabilities: rows.some((row) => row.stageProbability == null),
    dealsWithoutExpectedCloseCount: rows.filter((row) => !row.expectedCloseAt).length,
    summaries,
    rows
  };
}
