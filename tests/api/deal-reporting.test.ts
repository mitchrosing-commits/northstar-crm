import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DealStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { classifyDealAttention } from "@/lib/deal-attention";
import { calculateDealForecast, type DealForecastInput } from "@/lib/services/deal-report-service";

const service = readFileSync(join(process.cwd(), "lib/services/deal-report-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const reportsPage = readFileSync(join(process.cwd(), "app/reports/page.tsx"), "utf8");
const dealsPage = readFileSync(join(process.cwd(), "app/deals/page.tsx"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const dealAttention = readFileSync(join(process.cwd(), "lib/deal-attention.ts"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("Deal Reporting v1", () => {
  it("classifies deal attention from the next open activity", () => {
    const now = new Date("2030-03-04T12:00:00.000Z");

    expect(classifyDealAttention({ activities: [] }, now)).toBe("none");
    expect(classifyDealAttention({ activities: [{ dueAt: "2030-03-03T09:00:00.000Z" }] }, now)).toBe("overdue");
    expect(classifyDealAttention({ activities: [{ dueAt: "2030-03-04T09:00:00.000Z" }] }, now)).toBe("today");
    expect(classifyDealAttention({ activities: [{ dueAt: "2030-03-05T09:00:00.000Z" }] }, now)).toBe("upcoming");
    expect(classifyDealAttention({ activities: [{ dueAt: null }] }, now)).toBe("unscheduled");
  });

  it("adds a workspace-scoped deal report service using existing deal and stage semantics", () => {
    expect(crmBarrel).toContain("export * from \"./deal-report-service\"");
    expect(service).toContain("export async function getDealReport");
    expect(service).toContain("ensureWorkspaceAccess(actor)");
    expect(service).toContain("listDeals(actor, filters)");
    expect(service).toContain("prisma.pipelineStage.findMany");
    expect(service).toContain("DealStatus.OPEN");
    expect(service).toContain("DealStatus.WON");
    expect(service).toContain("DealStatus.LOST");
    expect(service).toContain("openPipelineValueCents");
    expect(service).toContain("stageBreakdown");
    expect(service).toContain("classifyDealAttention(deal)");
    expect(service).toContain("dealsWithOverdueActivities");
    expect(service).toContain("dealsDueToday");
    expect(service).toContain("dealsWithNoNextActivity");
    expect(service).toContain("activitySummary");
    expect(service).toContain("quoteSummary");
    expect(service).toContain("topOpenDeals");
    expect(service).toContain("topOrganizations");
    expect(service).toContain("dataHygiene");
    expect(service).toContain("contactsMissingEmail");
    expect(service).toContain("openDealsMissingContactOrOrganization");
    expect(service).toContain("organizationsWithoutPeople");
    expect(service).toContain("prisma.activity.groupBy");
    expect(service).toContain("prisma.quote.groupBy");
    expect(service).toContain("organizationKey = `${deal.organization.id}:${organizationCurrency}`");
    expect(service).toContain("forecast: calculateDealForecast(deals)");
  });

  it("calculates Forecasting v1 from active open deal inputs", () => {
    const forecast = calculateDealForecast([
      forecastDeal({
        id: "open-usd-weighted",
        title: "Open USD weighted",
        status: DealStatus.OPEN,
        valueCents: 10000,
        currency: "USD",
        probability: 50,
        expectedCloseAt: "2030-04-01T00:00:00.000Z"
      }),
      forecastDeal({
        id: "open-usd-missing-probability",
        title: "Open USD missing probability",
        status: DealStatus.OPEN,
        valueCents: 3000,
        currency: "USD",
        probability: null,
        expectedCloseAt: null
      }),
      forecastDeal({
        id: "open-eur-weighted",
        title: "Open EUR weighted",
        status: DealStatus.OPEN,
        valueCents: 2000,
        currency: "EUR",
        probability: 25,
        expectedCloseAt: "2030-03-01T00:00:00.000Z",
        owner: null
      }),
      forecastDeal({
        id: "open-eur-zero",
        title: "Open EUR zero value",
        status: DealStatus.OPEN,
        valueCents: 0,
        currency: "EUR",
        probability: 80,
        expectedCloseAt: "2030-03-15T00:00:00.000Z",
        owner: null
      }),
      forecastDeal({
        id: "won-noise",
        title: "Won noise",
        status: DealStatus.WON,
        valueCents: 999999,
        currency: "USD",
        probability: 100,
        expectedCloseAt: "2030-03-01T00:00:00.000Z"
      }),
      forecastDeal({
        id: "lost-noise",
        title: "Lost noise",
        status: DealStatus.LOST,
        valueCents: 999999,
        currency: "EUR",
        probability: 100,
        expectedCloseAt: "2030-03-01T00:00:00.000Z"
      })
    ]);

    expect(forecast.openDealCount).toBe(4);
    expect(forecast.currencyCount).toBe(2);
    expect(forecast.hasMultipleCurrencies).toBe(true);
    expect(forecast.hasStageProbabilities).toBe(true);
    expect(forecast.hasMissingStageProbabilities).toBe(true);
    expect(forecast.dealsWithoutExpectedCloseCount).toBe(1);
    expect(forecast.rows.map((row) => row.dealId)).toEqual([
      "open-eur-weighted",
      "open-eur-zero",
      "open-usd-weighted",
      "open-usd-missing-probability"
    ]);
    expect(forecast.rows.find((row) => row.dealId === "open-eur-weighted")).toMatchObject({
      ownerName: "Unassigned",
      weightedValueCents: 500
    });
    expect(forecast.rows.find((row) => row.dealId === "open-eur-zero")).toMatchObject({
      valueCents: 0,
      weightedValueCents: 0
    });
    expect(forecast.summaries).toEqual([
      {
        currency: "EUR",
        openDealCount: 2,
        openForecastValueCents: 2000,
        weightedForecastValueCents: 500,
        missingProbabilityDealCount: 0,
        missingProbabilityValueCents: 0,
        noExpectedCloseDealCount: 0,
        noExpectedCloseValueCents: 0
      },
      {
        currency: "USD",
        openDealCount: 2,
        openForecastValueCents: 13000,
        weightedForecastValueCents: 5000,
        missingProbabilityDealCount: 1,
        missingProbabilityValueCents: 3000,
        noExpectedCloseDealCount: 1,
        noExpectedCloseValueCents: 3000
      }
    ]);
  });

  it("keeps Forecasting v1 workspace scoped and open-deal only at the service boundary", () => {
    expect(service).toContain("ensureWorkspaceAccess(actor)");
    expect(service).toContain("listDeals(actor, filters)");
    expect(service).toContain("filter((deal) => deal.status === DealStatus.OPEN)");
    expect(service).toContain("summary.openForecastValueCents += row.valueCents");
    expect(service).not.toContain("lineItems");
    expect(service).not.toContain("lineTotalCents");
    expect(service).not.toContain("goals");
    expect(service).not.toContain("snapshots");
  });

  it("adds a simple server-rendered reports page without charts or builders", () => {
    expect(primaryNav).toContain("href: \"/reports\"");
    expect(reportsPage).toContain("getDealReport(actor");
    expect(reportsPage).toContain("parseListViewState(params");
    expect(reportsPage).toContain("customFieldId: listState.filters.customFieldId");
    expect(reportsPage).toContain("Deal Reporting v1");
    expect(reportsPage).toContain("Open value");
    expect(reportsPage).toContain("Won value");
    expect(reportsPage).toContain("Lost value");
    expect(reportsPage).toContain("Pipeline Hygiene");
    expect(reportsPage).toContain("Data Hygiene");
    expect(reportsPage).toContain("Contacts missing email");
    expect(reportsPage).toContain("Deals missing contact/org");
    expect(reportsPage).toContain("Organizations with no people");
    expect(reportsPage).toContain("Overdue activity");
    expect(reportsPage).toContain("Due today");
    expect(reportsPage).toContain("No next activity");
    expect(reportsPage).toContain("Pipeline By Stage");
    expect(reportsPage).toContain("Activity Status Summary");
    expect(reportsPage).toContain("Quote Status Summary");
    expect(reportsPage).toContain("Top Open Deals");
    expect(reportsPage).toContain("Top Organizations");
    expect(reportsPage).toContain("No activities yet.");
    expect(reportsPage).toContain("No quotes yet.");
    expect(reportsPage).toContain("Open deal value by organization will appear");
    expect(reportsPage).toContain("href=\"/activities?status=open\"");
    expect(reportsPage).toContain("href=\"/deals?status=OPEN\"");
    expect(reportsPage).toContain("No pipeline stages match this report view yet.");
    expect(reportsPage).toContain("Forecasting v1");
    expect(reportsPage).toContain("Open forecast value");
    expect(reportsPage).toContain("Weighted forecast value (probability set)");
    expect(reportsPage).toContain("Missing probability");
    expect(reportsPage).toContain("Missing stage probability");
    expect(reportsPage).toContain("No expected close date");
    expect(reportsPage).toContain("No FX conversion is applied in Forecasting v1.");
    expect(reportsPage).toContain("Missing stage probability means a deal is in a stage with no probability set");
    expect(reportsPage).toContain("No expected close date means the deal has no expected close date set");
    expect(reportsPage).toContain("No open deals are available for forecasting yet. Forecasting v1 excludes won and lost deals.");
    expect(reportsPage).toContain("className=\"table-scroll\"");
    expect(reportsPage).toContain("aria-label=\"Forecast deal detail table\"");
    expect(globalStyles).toContain(".table-scroll");
    expect(reportsPage).not.toContain("Chart");
  });

  it("surfaces compact deal attention badges on the Deals list", () => {
    expect(dealAttention).toContain("export function classifyDealAttention");
    expect(dealAttention).toContain("No next activity");
    expect(dealsPage).toContain("<th>Attention</th>");
    expect(dealsPage).toContain("DealAttentionBadge");
    expect(dealsPage).toContain("classifyDealAttention(deal)");
    expect(globalStyles).toContain("deal-attention-overdue");
    expect(globalStyles).toContain("deal-attention-none");
  });

  it("documents reporting v1 capabilities and boundaries", () => {
    expect(currentStatus).toContain("Deal Reporting v1");
    expect(currentStatus).toContain("Deals list shows pipeline hygiene cues");
    expect(currentStatus).toContain("Forecasting v1 MVP");
    expect(currentStatus).toContain("No charting, forecast history, saved reports, scheduled reports, or report builder");
  });
});

function forecastDeal({
  id,
  title,
  status,
  valueCents,
  currency,
  probability,
  expectedCloseAt,
  owner = { id: "owner_1", name: "Forecast Owner", email: "owner@example.test" }
}: {
  id: string;
  title: string;
  status: DealStatus;
  valueCents: number;
  currency: string;
  probability: number | null;
  expectedCloseAt: string | null;
  owner?: DealForecastInput["owner"];
}): DealForecastInput {
  return {
    id,
    title,
    status,
    valueCents,
    currency,
    expectedCloseAt,
    pipeline: { id: "pipeline_1", name: "Pipeline", sortOrder: 1 },
    stage: { id: `stage_${probability ?? "none"}`, name: "Stage", probability, sortOrder: 1 },
    owner
  };
}
