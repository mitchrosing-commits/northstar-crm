import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { formatActivityType, formatDate, formatMoney } from "@/components/format";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { dealListStateOptions, dealStatuses } from "@/lib/deal-list-state";
import {
  enumListViewFilter,
  getSearchParam,
  parseListViewState,
  serializeListViewState,
  serializedListViewStateToSearchParams,
  type ListSearchParams
} from "@/lib/list-page-query";
import { getDealReport, getMonthlyWonRevenueGoalProgress } from "@/lib/services/crm";
import { saveMonthlyWonRevenueGoalAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const listState = parseListViewState(params, dealListStateOptions);
  const goalMonth = parseGoalMonthParam(getSearchParam(params, "goalMonth"));
  const goalCurrency = parseGoalCurrencyParam(getSearchParam(params, "goalCurrency"));
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
    sortDirection: listState.sortDirection
  });
  const goalProgress = await getMonthlyWonRevenueGoalProgress(actor, {
    month: goalMonth,
    currency: goalCurrency
  });
  const dealQuery = serializedListViewStateToSearchParams(serializeListViewState(listState)).toString();
  const dealsHref = (dealQuery ? `/deals?${dealQuery}` : "/deals") as Route;
  const goalSaved = getSearchParam(params, "goalSaved") === "1";
  const goalError = getSearchParam(params, "goalError");

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Deal Reporting v1</p>
          <h1 className="page-title">Reports</h1>
        </div>
        <Link className="button-secondary" href={dealsHref}>
          View deals
        </Link>
      </header>

      <section className="stat-grid">
        <MetricCard label="Open value" value={formatMoney(report.metrics.openPipelineValueCents)} />
        <MetricCard label="Open deals" value={report.metrics.openDealsCount} />
        <MetricCard label="Won value" value={formatMoney(report.metrics.wonDealsValueCents)} />
        <MetricCard label="Won deals" value={report.metrics.wonDealsCount} />
        <MetricCard label="Lost value" value={formatMoney(report.metrics.lostDealsValueCents)} />
        <MetricCard label="Lost deals" value={report.metrics.lostDealsCount} />
      </section>

      <section className="panel">
        <h2 className="panel-title">Pipeline Hygiene</h2>
        <div className="stat-grid">
          <MetricCard href="/dashboard" label="Overdue activity" value={report.metrics.dealsWithOverdueActivities} />
          <MetricCard href="/activities?due=today" label="Due today" value={report.metrics.dealsDueToday} />
          <MetricCard href="/deals" label="No next activity" value={report.metrics.dealsWithNoNextActivity} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2 className="panel-title">Data Hygiene</h2>
            <p className="empty-copy">Quick cleanup signals that make CRM data easier to trust before a pipeline review.</p>
          </div>
          <Link className="inline-link" href="/dashboard">
            Review Needs Attention
          </Link>
        </div>
        <div className="stat-grid">
          <MetricCard href="/contacts" label="Contacts missing email" value={report.dataHygiene.contactsMissingEmail} />
          <MetricCard href="/deals" label="Deals missing contact/org" value={report.dataHygiene.openDealsMissingContactOrOrganization} />
          <MetricCard href="/deals" label="Deals with no owner" value={report.dataHygiene.openDealsWithoutOwner} />
          <MetricCard href="/deals" label="Open deals no next activity" value={report.dataHygiene.openDealsWithNoNextActivity} />
          <MetricCard href="/leads" label="Leads missing source" value={report.dataHygiene.leadsMissingSource} />
          <MetricCard href="/organizations" label="Organizations with no people" value={report.dataHygiene.organizationsWithoutPeople} />
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Pipeline By Stage</h2>
        {report.stageBreakdown.length > 0 ? (
          <div className="table-scroll" role="region" aria-label="Pipeline by stage table" tabIndex={0}>
            <table className="table">
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
                    <td>{stage.pipelineName}</td>
                    <td>{stage.stageName}</td>
                    <td>{stage.openDealCount}</td>
                    <td>{formatMoney(stage.openDealValueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-copy">No pipeline stages match this report view yet.</p>
        )}
      </section>

      <section className="content-grid" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">Activity Status Summary</h2>
            <Link className="inline-link" href="/activities">
              View activities
            </Link>
          </div>
          {report.activitySummary.open + report.activitySummary.completed > 0 ? (
            <>
              <div className="stat-grid stat-grid-compact">
                <MetricCard href="/activities?status=open" label="Open" value={report.activitySummary.open} />
                <MetricCard href="/activities?status=completed" label="Completed" value={report.activitySummary.completed} />
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Activities</th>
                  </tr>
                </thead>
                <tbody>
                  {report.activitySummary.byType.map((item) => (
                    <tr key={item.type}>
                      <td>{formatActivityType(item.type)}</td>
                      <td>{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="empty-copy">
              No activities yet. <Link href="/activities/new">Create a follow-up</Link> to start reporting on work queue health.
            </p>
          )}
        </div>

        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">Quote Status Summary</h2>
            <Link className="inline-link" href="/deals">
              Find quotes
            </Link>
          </div>
          {report.quoteSummary.some((item) => item.count > 0) ? (
            <table className="table">
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
                    <td>{item.status}</td>
                    <td>{item.count}</td>
                    <td>{formatMoney(item.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">
              No quotes yet. Quotes appear after a deal has line items and an internal quote draft.
            </p>
          )}
        </div>
      </section>

      <section className="content-grid" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">Top Open Deals</h2>
            <Link className="inline-link" href="/deals?status=OPEN">
              View open deals
            </Link>
          </div>
          {report.topOpenDeals.length > 0 ? (
            <table className="table">
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
                    <td>
                      <Link className="inline-link" href={`/deals/${deal.id}`}>
                        {deal.title}
                      </Link>
                      {deal.organization ? (
                        <div className="deal-meta">
                          <Link className="inline-link" href={`/organizations/${deal.organization.id}`}>
                            {deal.organization.name}
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td>{deal.stageName}</td>
                    <td>{deal.ownerName}</td>
                    <td>{formatMoney(deal.valueCents, deal.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">
              No open deals yet. <Link href="/deals/new">Create a deal</Link> to start ranking opportunities by value.
            </p>
          )}
        </div>

        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">Top Organizations</h2>
            <Link className="inline-link" href="/organizations">
              View organizations
            </Link>
          </div>
          {report.topOrganizations.length > 0 ? (
            <table className="table">
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
                    <td>
                      <Link className="inline-link" href={`/organizations/${organization.organizationId}`}>
                        {organization.organizationName}
                      </Link>
                    </td>
                    <td>{organization.openDealCount}</td>
                    <td>{formatMoney(organization.openValueCents, organization.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">
              Open deal value by organization will appear after opportunities are linked to companies.
            </p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Goals v1</h2>
        <p className="empty-copy" style={{ marginBottom: 16 }}>
          Workspace-level monthly won-revenue goal only. Progress uses same-currency WON deals whose actual won timestamp (wonAt)
          falls inside the selected month, not expected close date. Legacy won deals without wonAt are excluded. Same currency only;
          no FX conversion is applied.
        </p>

        <form action={saveMonthlyWonRevenueGoalAction} className="form-grid" style={{ marginBottom: 16 }}>
          <label className="form-field">
            <span>Month</span>
            <input type="month" name="goalMonth" defaultValue={formatGoalMonthInput(goalProgress.periodStart)} required />
          </label>
          <label className="form-field">
            <span>Currency</span>
            <input name="goalCurrency" defaultValue={goalProgress.currency} maxLength={3} pattern="[A-Za-z]{3}" required />
          </label>
          <label className="form-field">
            <span>Target</span>
            <input
              name="goalTargetAmount"
              defaultValue={goalProgress.targetCents == null ? "" : formatMoneyInput(goalProgress.targetCents)}
              inputMode="decimal"
              placeholder="10000"
              required
            />
          </label>
          <div className="form-actions">
            <button className="button-primary" type="submit">
              Save goal
            </button>
          </div>
        </form>

        {goalSaved ? (
          <p className="compact-success" role="status" style={{ marginBottom: 16 }}>
            Goal saved.
          </p>
        ) : null}
        {goalError ? (
          <p className="compact-error" role="alert" style={{ marginBottom: 16 }}>
            {goalError}
          </p>
        ) : null}

        <div className="table-scroll" role="region" aria-label="Goals v1 monthly won revenue table" tabIndex={0}>
          <table className="table">
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
                <td>{formatGoalMonthLabel(goalProgress.periodStart)}</td>
                <td>{goalProgress.currency}</td>
                <td>
                  {goalProgress.targetCents == null
                    ? "No monthly target saved yet"
                    : formatMoney(goalProgress.targetCents, goalProgress.currency)}
                </td>
                <td>{formatMoney(goalProgress.wonRevenueCents, goalProgress.currency)}</td>
                <td>
                  {goalProgress.remainingCents == null
                    ? "Save a target to track remaining"
                    : formatMoney(goalProgress.remainingCents, goalProgress.currency)}
                </td>
                <td>{goalProgress.progressPercent == null ? "Save target first" : formatGoalPercent(goalProgress.progressPercent)}</td>
                <td>{goalProgress.includedDealCount}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Forecasting v1</h2>
        <p className="empty-copy" style={{ marginBottom: 16 }}>
          Open deals by currency, expected close date, pipeline, stage, owner, and stage probability when set.
        </p>
        {report.forecast.openDealCount > 0 ? (
          <>
            <div className="stat-grid">
              <MetricCard label="Open forecast" value={report.forecast.openDealCount} />
              <MetricCard label="Currencies" value={report.forecast.currencyCount} />
              <MetricCard label="No close date" value={report.forecast.dealsWithoutExpectedCloseCount} />
              <MetricCard
                label="Missing probability"
                value={report.forecast.summaries.reduce((total, summary) => total + summary.missingProbabilityDealCount, 0)}
              />
            </div>

            {report.forecast.hasMultipleCurrencies ? (
              <p className="empty-copy" style={{ marginBottom: 16 }}>
                Multiple currencies are shown separately. No FX conversion is applied in Forecasting v1.
              </p>
            ) : null}
            {report.forecast.hasMissingStageProbabilities ? (
              <p className="empty-copy" style={{ marginBottom: 16 }}>
                Missing stage probability means a deal is in a stage with no probability set, so that deal is not included in weighted forecast value.
              </p>
            ) : null}
            {report.forecast.dealsWithoutExpectedCloseCount > 0 ? (
              <p className="empty-copy" style={{ marginBottom: 16 }}>
                No expected close date means the deal has no expected close date set and is shown outside dated forecast planning.
              </p>
            ) : null}

            <div className="table-scroll" role="region" aria-label="Forecast currency summary table" tabIndex={0}>
              <table className="table">
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
                      <td>{summary.currency}</td>
                      <td>{summary.openDealCount}</td>
                      <td>{formatMoney(summary.openForecastValueCents, summary.currency)}</td>
                      <td>
                        {summary.weightedForecastValueCents > 0 || summary.openDealCount > summary.missingProbabilityDealCount
                          ? formatMoney(summary.weightedForecastValueCents, summary.currency)
                          : "No stage probabilities set"}
                      </td>
                      <td>
                        {summary.missingProbabilityDealCount} / {formatMoney(summary.missingProbabilityValueCents, summary.currency)}
                      </td>
                      <td>
                        {summary.noExpectedCloseDealCount} / {formatMoney(summary.noExpectedCloseValueCents, summary.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-scroll" role="region" aria-label="Forecast deal detail table" tabIndex={0}>
              <table className="table">
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
                      <td>{row.dealTitle}</td>
                      <td>
                        {row.pipelineName} / {row.stageName}
                      </td>
                      <td>{row.ownerName}</td>
                      <td>{row.expectedCloseAt ? formatDate(row.expectedCloseAt) : "No expected close date"}</td>
                      <td>{formatMoney(row.valueCents, row.currency)}</td>
                      <td>{formatProbability(row.stageProbability)}</td>
                      <td>
                        {row.weightedValueCents == null
                          ? "Not weighted: stage probability missing"
                          : formatMoney(row.weightedValueCents, row.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="empty-copy">No open deals are available for forecasting yet. Forecasting v1 excludes won and lost deals.</p>
        )}
      </section>
    </AppShell>
  );
}

function MetricCard({ href, label, value }: { href?: Route | string; label: string; value: number | string }) {
  const content = (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
    </div>
  );

  return href ? (
    <Link className="stat-card-link" href={href as Route}>
      {content}
    </Link>
  ) : (
    content
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

function formatGoalMonthInput(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatGoalMonthLabel(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(value);
}

function formatMoneyInput(valueCents: number) {
  return (valueCents / 100).toFixed(2);
}

function formatGoalPercent(value: number) {
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}%`;
}
