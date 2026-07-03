import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { FormSuccessMessage } from "@/components/form-success-message";
import {
  formatActivityType,
  formatDate,
  formatMoney,
} from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatusBadge } from "@/components/status-badge";
import { StatCard as MetricCard } from "@/components/stat-card";
import { TableScroll } from "@/components/table-scroll";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { dealListStateOptions, dealStatuses } from "@/lib/deal-list-state";
import {
  enumListViewFilter,
  getSearchParam,
  parseListViewState,
  serializeListViewState,
  serializedListViewStateToSearchParams,
  type ListSearchParams,
} from "@/lib/list-page-query";
import {
  getDealReport,
  getMonthlyWonRevenueGoalProgress,
} from "@/lib/services/crm";
import { canManageWorkspaceSettings } from "@/lib/workspace-roles";
import { saveMonthlyWonRevenueGoalAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId, membership } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const canManageGoals = canManageWorkspaceSettings(membership.role);
  const listState = parseListViewState(params, dealListStateOptions);
  const goalMonth = parseGoalMonthParam(getSearchParam(params, "goalMonth"));
  const goalCurrency = parseGoalCurrencyParam(
    getSearchParam(params, "goalCurrency"),
  );
  const report = await getDealReport(actor, {
    q: listState.q,
    status: enumListViewFilter(listState, "status", dealStatuses),
    stageId: listState.filters.stageId,
    ownerId: listState.filters.ownerId,
    personId: listState.filters.personId,
    organizationId: listState.filters.organizationId,
    customFieldId: listState.filters.customFieldId,
    customFieldValue: listState.filters.customFieldValue,
    sortBy: listState.sortBy,
    sortDirection: listState.sortDirection,
  });
  const goalProgress = await getMonthlyWonRevenueGoalProgress(actor, {
    month: goalMonth,
    currency: goalCurrency,
  });
  const dealQuery = serializedListViewStateToSearchParams(
    serializeListViewState(listState),
  ).toString();
  const dealsHref = (dealQuery ? `/deals?${dealQuery}` : "/deals") as Route;
  const openDealsHref = reportMetricDealsHref(dealQuery, "OPEN");
  const wonDealsHref = reportMetricDealsHref(dealQuery, "WON");
  const lostDealsHref = reportMetricDealsHref(dealQuery, "LOST");
  const goalSaved = getSearchParam(params, "goalSaved") === "1";
  const goalError = getSearchParam(params, "goalError");
  const viewDealsLabel = "View deals matching this report";
  const reviewNeedsAttentionLabel = "Review dashboard needs attention";
  const viewActivitiesLabel = "View activities from reports";
  const createFollowUpLabel = "Create follow-up activity from reports";
  const findQuotesLabel = "Find deals with quotes from reports";
  const viewTopOpenDealsLabel = "View top open deals from reports";
  const createDealLabel = "Create deal from reports";
  const viewOrganizationsLabel = "View organizations from reports";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link aria-label={viewDealsLabel} className="button-secondary" href={dealsHref} title={viewDealsLabel}>
            View deals
          </Link>
        }
        eyebrow="Deal Reporting v1"
        subtitle="Operating metrics for pipeline value, activity coverage, quote movement, and forecast health."
        title="Reports"
      />

      <section className="stat-grid">
        <MetricCard
          actionLabel="View open deal value from reports"
          href={openDealsHref}
          label="Open value"
          value={formatMoney(report.metrics.openPipelineValueCents)}
        />
        <MetricCard
          actionLabel="View open deals from reports"
          href={openDealsHref}
          label="Open deals"
          value={report.metrics.openDealsCount}
        />
        <MetricCard
          actionLabel="View won deal value from reports"
          href={wonDealsHref}
          label="Won value"
          value={formatMoney(report.metrics.wonDealsValueCents)}
        />
        <MetricCard
          actionLabel="View won deals from reports"
          href={wonDealsHref}
          label="Won deals"
          value={report.metrics.wonDealsCount}
        />
        <MetricCard
          actionLabel="View lost deal value from reports"
          href={lostDealsHref}
          label="Lost value"
          value={formatMoney(report.metrics.lostDealsValueCents)}
        />
        <MetricCard
          actionLabel="View lost deals from reports"
          href={lostDealsHref}
          label="Lost deals"
          value={report.metrics.lostDealsCount}
        />
      </section>

      <section className="panel">
        <PanelTitleRow title="Pipeline Hygiene" />
        <div className="stat-grid">
          <MetricCard
            href="/deals?followUp=overdue"
            label="Overdue activity"
            value={report.metrics.dealsWithOverdueActivities}
          />
          <MetricCard
            href="/deals?followUp=today"
            label="Due today"
            value={report.metrics.dealsDueToday}
          />
          <MetricCard
            href="/deals?followUp=missing"
            label="No next activity"
            value={report.metrics.dealsWithNoNextActivity}
          />
        </div>
      </section>

      <section className="panel">
        <PanelTitleRow
          actions={
            <Link aria-label={reviewNeedsAttentionLabel} className="inline-link" href="/dashboard" title={reviewNeedsAttentionLabel}>
              Review Needs Attention
            </Link>
          }
          description="Quick cleanup signals that make CRM data easier to trust before a pipeline review."
          title="Data Hygiene"
        />
        <div className="stat-grid">
          <MetricCard
            href="/contacts"
            label="Contacts missing email"
            value={report.dataHygiene.contactsMissingEmail}
          />
          <MetricCard
            href="/deals?status=OPEN"
            label="Deals missing contact/org"
            value={report.dataHygiene.openDealsMissingContactOrOrganization}
          />
          <MetricCard
            href="/deals?status=OPEN"
            label="Deals with no owner"
            value={report.dataHygiene.openDealsWithoutOwner}
          />
          <MetricCard
            href="/deals?followUp=missing"
            label="Open deals no next activity"
            value={report.dataHygiene.openDealsWithNoNextActivity}
          />
          <MetricCard
            href="/leads"
            label="Leads missing source"
            value={report.dataHygiene.leadsMissingSource}
          />
          <MetricCard
            href="/organizations"
            label="Organizations with no people"
            value={report.dataHygiene.organizationsWithoutPeople}
          />
        </div>
      </section>

      <section className="panel">
        <PanelTitleRow title="Pipeline By Stage" />
        {report.stageBreakdown.length > 0 ? (
          <TableScroll aria-label="Pipeline by stage table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Pipeline</th>
                  <th>Stage</th>
                  <th>Open deals</th>
                  <th>Open value</th>
                </tr>
              </thead>
              <tbody>
                {report.stageBreakdown.map((stage) => (
                  <tr key={stage.stageId}>
                    <td data-label="Pipeline">{stage.pipelineName}</td>
                    <td data-label="Stage">{stage.stageName}</td>
                    <td data-label="Open deals">{stage.openDealCount}</td>
                    <td data-label="Open value">
                      {formatMoney(stage.openDealValueCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ) : (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            description="No pipeline stages match this report view yet."
            title="No pipeline stage data"
          />
        )}
      </section>

      <section className="content-grid section-spaced">
        <div className="panel">
          <PanelTitleRow
            actions={
              <Link aria-label={viewActivitiesLabel} className="inline-link" href="/activities" title={viewActivitiesLabel}>
                View activities
              </Link>
            }
            title="Activity Status Summary"
          />
          {report.activitySummary.open + report.activitySummary.completed >
          0 ? (
            <>
              <div className="stat-grid stat-grid-compact">
                <MetricCard
                  href="/activities?status=open"
                  label="Open"
                  value={report.activitySummary.open}
                />
                <MetricCard
                  href="/activities?status=completed"
                  label="Completed"
                  value={report.activitySummary.completed}
                />
              </div>
              <TableScroll aria-label="Activity status summary table">
                <table className="table crm-list-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Activities</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.activitySummary.byType.map((item) => (
                      <tr key={item.type}>
                        <td data-label="Type">
                          {formatActivityType(item.type)}
                        </td>
                        <td data-label="Activities">{item.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </>
          ) : (
            <EmptyState
              actions={
                <Link
                  aria-label={createFollowUpLabel}
                  className="button-secondary button-compact"
                  href="/activities/new"
                  title={createFollowUpLabel}
                >
                  Create follow-up
                </Link>
              }
              className="empty-state-compact empty-state-panel"
              description="Create a follow-up to start reporting on work queue health."
              title="No activities yet"
            />
          )}
        </div>

        <div className="panel">
          <PanelTitleRow
            actions={
              <Link aria-label={findQuotesLabel} className="inline-link" href="/deals" title={findQuotesLabel}>
                Find quotes
              </Link>
            }
            title="Quote Status Summary"
          />
          {report.quoteSummary.some((item) => item.count > 0) ? (
            <TableScroll aria-label="Quote status summary table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Quotes</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.quoteSummary.map((item) => (
                    <tr key={item.status}>
                      <td data-label="Status">
                        <StatusBadge status={item.status} />
                      </td>
                      <td data-label="Quotes">{item.count}</td>
                      <td data-label="Total">
                        {formatMoney(item.totalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="Quotes appear after a deal has line items and an internal quote draft."
              title="No quotes yet"
            />
          )}
        </div>
      </section>

      <section className="content-grid section-spaced">
        <div className="panel">
          <PanelTitleRow
            actions={
              <Link
                aria-label={viewTopOpenDealsLabel}
                className="inline-link"
                href="/deals?status=OPEN"
                title={viewTopOpenDealsLabel}
              >
                View open deals
              </Link>
            }
            title="Top Open Deals"
          />
          {report.topOpenDeals.length > 0 ? (
            <TableScroll aria-label="Top open deals table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Deal</th>
                    <th>Stage</th>
                    <th>Owner</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topOpenDeals.map((deal) => (
                    <tr key={deal.id}>
                      <td data-label="Deal">
                        <div className="table-primary-cell">
                          <Link
                            className="inline-link"
                            href={`/deals/${deal.id}`}
                          >
                            <strong>{deal.title}</strong>
                          </Link>
                          {deal.organization ? (
                            <span className="table-secondary-text">
                              <Link
                                className="inline-link"
                                href={`/organizations/${deal.organization.id}`}
                              >
                                {deal.organization.name}
                              </Link>
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td data-label="Stage">{deal.stageName}</td>
                      <td data-label="Owner">{deal.ownerName}</td>
                      <td data-label="Value">
                        {formatMoney(deal.valueCents, deal.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <EmptyState
              actions={
                <Link
                  aria-label={createDealLabel}
                  className="button-secondary button-compact"
                  href="/deals/new"
                  title={createDealLabel}
                >
                  Create deal
                </Link>
              }
              className="empty-state-compact empty-state-panel"
              description="Create a deal to start ranking opportunities by value."
              title="No open deals yet"
            />
          )}
        </div>

        <div className="panel">
          <PanelTitleRow
            actions={
              <Link aria-label={viewOrganizationsLabel} className="inline-link" href="/organizations" title={viewOrganizationsLabel}>
                View organizations
              </Link>
            }
            title="Top Organizations"
          />
          {report.topOrganizations.length > 0 ? (
            <TableScroll aria-label="Top organizations table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Open deals</th>
                    <th>Open value</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topOrganizations.map((organization) => (
                    <tr key={organization.organizationId}>
                      <td data-label="Organization">
                        <div className="table-primary-cell">
                          <Link
                            className="inline-link"
                            href={`/organizations/${organization.organizationId}`}
                          >
                            <strong>{organization.organizationName}</strong>
                          </Link>
                        </div>
                      </td>
                      <td data-label="Open deals">
                        {organization.openDealCount}
                      </td>
                      <td data-label="Open value">
                        {formatMoney(
                          organization.openValueCents,
                          organization.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="Open deal value by organization will appear after opportunities are linked to companies."
              title="No organization pipeline value yet"
            />
          )}
        </div>
      </section>

      <section className="panel">
        <PanelTitleRow title="Goals v1" />
        <ReportScopeNote title="Goal scope">
          Workspace-level monthly won-revenue goal only. Progress uses
          same-currency WON deals whose actual won timestamp (wonAt) falls
          inside the selected month, not expected close date. Legacy won deals
          without wonAt are excluded. Same currency only; no FX conversion is
          applied.
        </ReportScopeNote>

        {canManageGoals ? (
          <form
            action={saveMonthlyWonRevenueGoalAction}
            className="form-grid section-separated"
          >
            <label className="form-field">
              <FormFieldLabel required>Month</FormFieldLabel>
              <input
                type="month"
                name="goalMonth"
                defaultValue={formatGoalMonthInput(goalProgress.periodStart)}
                required
              />
            </label>
            <label className="form-field">
              <FormFieldLabel required>Currency</FormFieldLabel>
              <input
                name="goalCurrency"
                defaultValue={goalProgress.currency}
                maxLength={3}
                pattern="[A-Za-z]{3}"
                required
              />
            </label>
            <label className="form-field">
              <FormFieldLabel required>Target</FormFieldLabel>
              <input
                name="goalTargetAmount"
                defaultValue={
                  goalProgress.targetCents == null
                    ? ""
                    : formatMoneyInput(goalProgress.targetCents)
                }
                inputMode="decimal"
                placeholder="10000"
                required
              />
            </label>
            <FormActionBar isSaving={false} submitLabel="Save goal" />
          </form>
        ) : (
          <FormIntroCallout className="section-separated" title="Goal management">
            Workspace admins and owners can save monthly goals. Members can view goal progress.
          </FormIntroCallout>
        )}

        {goalSaved ? <FormSuccessMessage className="section-separated" compact>Goal saved.</FormSuccessMessage> : null}
        {goalError ? <FormErrorMessage className="section-separated" compact>{goalError}</FormErrorMessage> : null}

        <TableScroll aria-label="Goals v1 monthly won revenue table">
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Currency</th>
                <th>Target</th>
                <th>Won revenue</th>
                <th>Remaining</th>
                <th>Progress</th>
                <th>Included deals</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td data-label="Month">
                  {formatGoalMonthLabel(goalProgress.periodStart)}
                </td>
                <td data-label="Currency">{goalProgress.currency}</td>
                <td data-label="Target">
                  {goalProgress.targetCents == null
                    ? "No monthly target saved yet"
                    : formatMoney(
                        goalProgress.targetCents,
                        goalProgress.currency,
                      )}
                </td>
                <td data-label="Won revenue">
                  {formatMoney(
                    goalProgress.wonRevenueCents,
                    goalProgress.currency,
                  )}
                </td>
                <td data-label="Remaining">
                  {goalProgress.remainingCents == null
                    ? "Save a target to track remaining"
                    : formatMoney(
                        goalProgress.remainingCents,
                        goalProgress.currency,
                      )}
                </td>
                <td data-label="Progress">
                  {goalProgress.progressPercent == null
                    ? "Save target first"
                    : formatGoalPercent(goalProgress.progressPercent)}
                </td>
                <td data-label="Included deals">
                  {goalProgress.includedDealCount}
                </td>
              </tr>
            </tbody>
          </table>
        </TableScroll>
      </section>

      <section className="panel">
        <PanelTitleRow title="Forecasting v1" />
        <ReportScopeNote title="Forecast scope">
          Open deals by currency, expected close date, pipeline, stage, owner,
          and stage probability when set.
        </ReportScopeNote>
        {report.forecast.openDealCount > 0 ? (
          <>
            <div className="stat-grid">
              <MetricCard
                label="Open forecast"
                value={report.forecast.openDealCount}
              />
              <MetricCard
                label="Currencies"
                value={report.forecast.currencyCount}
              />
              <MetricCard
                label="No close date"
                value={report.forecast.dealsWithoutExpectedCloseCount}
              />
              <MetricCard
                label="Missing probability"
                value={report.forecast.summaries.reduce(
                  (total, summary) =>
                    total + summary.missingProbabilityDealCount,
                  0,
                )}
              />
            </div>

            {report.forecast.hasMultipleCurrencies ? (
              <ReportScopeNote title="Currency scope">
                Multiple currencies are shown separately. No FX conversion is
                applied in Forecasting v1.
              </ReportScopeNote>
            ) : null}
            {report.forecast.hasMissingStageProbabilities ? (
              <ReportScopeNote title="Probability scope">
                Missing stage probability means a deal is in a stage with no
                probability set, so that deal is not included in weighted
                forecast value.
              </ReportScopeNote>
            ) : null}
            {report.forecast.dealsWithoutExpectedCloseCount > 0 ? (
              <ReportScopeNote title="Close date scope">
                No expected close date means the deal has no expected close date
                set and is shown outside dated forecast planning.
              </ReportScopeNote>
            ) : null}

            <TableScroll aria-label="Forecast currency summary table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Open deals</th>
                    <th>Open forecast value</th>
                    <th>Weighted forecast value (probability set)</th>
                    <th>Missing stage probability</th>
                    <th>No expected close date</th>
                  </tr>
                </thead>
                <tbody>
                  {report.forecast.summaries.map((summary) => (
                    <tr key={summary.currency}>
                      <td data-label="Currency">{summary.currency}</td>
                      <td data-label="Open deals">
                        {summary.openDealCount}
                      </td>
                      <td data-label="Open forecast value">
                        {formatMoney(
                          summary.openForecastValueCents,
                          summary.currency,
                        )}
                      </td>
                      <td data-label="Weighted forecast value">
                        {summary.weightedForecastValueCents > 0 ||
                        summary.openDealCount >
                          summary.missingProbabilityDealCount
                          ? formatMoney(
                              summary.weightedForecastValueCents,
                              summary.currency,
                            )
                          : "No stage probabilities set"}
                      </td>
                      <td data-label="Missing stage probability">
                        {summary.missingProbabilityDealCount} /{" "}
                        {formatMoney(
                          summary.missingProbabilityValueCents,
                          summary.currency,
                        )}
                      </td>
                      <td data-label="No expected close date">
                        {summary.noExpectedCloseDealCount} /{" "}
                        {formatMoney(
                          summary.noExpectedCloseValueCents,
                          summary.currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>

            <TableScroll aria-label="Forecast deal detail table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Deal</th>
                    <th>Pipeline / Stage</th>
                    <th>Owner</th>
                    <th>Expected close</th>
                    <th>Open value</th>
                    <th>Stage probability</th>
                    <th>Weighted value</th>
                  </tr>
                </thead>
                <tbody>
                  {report.forecast.rows.map((row) => (
                    <tr key={row.dealId}>
                      <td data-label="Deal">
                        <span className="table-primary-cell">
                          <Link
                            className="inline-link"
                            href={`/deals/${row.dealId}`}
                          >
                            <strong>{row.dealTitle}</strong>
                          </Link>
                        </span>
                      </td>
                      <td data-label="Pipeline / Stage">
                        {row.pipelineName} / {row.stageName}
                      </td>
                      <td data-label="Owner">{row.ownerName}</td>
                      <td data-label="Expected close">
                        {row.expectedCloseAt
                          ? formatDate(row.expectedCloseAt)
                          : "No expected close date"}
                      </td>
                      <td data-label="Open value">
                        {formatMoney(row.valueCents, row.currency)}
                      </td>
                      <td data-label="Stage probability">
                        {formatProbability(row.stageProbability)}
                      </td>
                      <td data-label="Weighted value">
                        {row.weightedValueCents == null
                          ? "Not weighted: stage probability missing"
                          : formatMoney(row.weightedValueCents, row.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </>
        ) : (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            description="Forecasting v1 excludes won and lost deals."
            title="No open deals are available for forecasting yet"
          />
        )}
      </section>
    </AppShell>
  );
}

function ReportScopeNote({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <FormIntroCallout
      className="section-separated report-scope-note"
      title={title}
    >
      {children}
    </FormIntroCallout>
  );
}

function formatProbability(value: number | null) {
  return value == null ? "Missing stage probability" : `${value}%`;
}

function parseGoalMonthParam(value: string) {
  return /^\d{4}-\d{2}$/.test(value) ? value : formatGoalMonthInput(new Date());
}

function parseGoalCurrencyParam(value: string) {
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
}

function reportMetricDealsHref(
  dealQuery: string,
  status: (typeof dealStatuses)[number],
) {
  const params = new URLSearchParams(dealQuery);
  params.set("status", status);
  params.delete("page");
  return `/deals?${params.toString()}` as Route;
}

function formatGoalMonthInput(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatGoalMonthLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatMoneyInput(valueCents: number) {
  return (valueCents / 100).toFixed(2);
}

function formatGoalPercent(value: number) {
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}%`;
}
