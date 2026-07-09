import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { ActivityCompleteButton } from "@/components/activity-complete-button";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { ActionGroup } from "@/components/action-group";
import { AttentionBadge } from "@/components/attention-badge";
import { AuditEventList } from "@/components/audit-event-list";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { CrmAiInsightCard } from "@/components/crm-ai-insight-card";
import { EmptyState } from "@/components/empty-state";
import {
  FieldMetric as DashboardHealthItem,
  FieldMetric as SnapshotItem,
} from "@/components/field-metric";
import {
  formatActivityType,
  formatDate,
  formatMoney,
} from "@/components/format";
import { ListRowActions } from "@/components/list-row-actions";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatusBadge } from "@/components/status-badge";
import { StatCard as MetricCard } from "@/components/stat-card";
import { TableScroll } from "@/components/table-scroll";
import { TimelineMetaRow } from "@/components/timeline-meta-row";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { formatPersonName } from "@/lib/person-name";
import { recordOwnerLabel } from "@/lib/record-owner-label";
import {
  buildDashboardAiInsight,
  getDashboardSummary,
  getNeedsAttentionSummary,
  type NeedsAttentionItem,
} from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type DashboardPipelineHealth = {
  dueTodayActivities: number;
  activeLeadsWithoutNextActivity: number;
  openDeals: number;
  openDealsWithoutNextActivity: number;
  openValueCents: number;
  overdueActivities: number;
};

export default async function DashboardPage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [summary, needsAttention] = await Promise.all([
    getDashboardSummary(actor),
    getNeedsAttentionSummary(actor),
  ]);
  const dashboardAiInsight = buildDashboardAiInsight(summary, needsAttention);
  const viewPipelineLabel = "View pipeline board";
  const newDealLabel = "Create a new deal from dashboard";
  const viewActiveDealsLabel = "View all open deals";
  const createOpenDealLabel = "Create a deal from dashboard";
  const viewPriorityActivitiesLabel = "View priority activity queue";
  const createActivityLabel = "Create an activity from dashboard";
  const viewQuotedDealsLabel = "View deals with quotes";
  const viewActivitySnapshotLabel = "View activity queue";
  const viewPipelineStagesLabel = "View open deals by stage";
  const viewLeadStatusLabel = "View leads list";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <>
            <Link
              aria-label={viewPipelineLabel}
              className="button-secondary"
              href="/pipeline"
              title={viewPipelineLabel}
            >
              View pipeline
            </Link>
            <Link
              aria-label={newDealLabel}
              className="button-primary"
              href="/deals/new"
              title={newDealLabel}
            >
              New deal
            </Link>
          </>
        }
        eyebrow="Workspace"
        subtitle="A command center for pipeline health, urgent follow-ups, and recent customer work."
        title="Dashboard"
      />

      <section className="dashboard-priority-zone" aria-label="Dashboard priority work">
        <DashboardFocusStrip
          dueToday={summary.metrics.dueTodayActivitiesCount}
          needsAttentionCount={needsAttention.length}
          openPipelineValue={formatMoney(summary.metrics.openPipelineValueCents)}
          overdue={summary.metrics.overdueActivitiesCount}
        />

        {summary.onboarding.isCleanWorkspace ? <FirstRunChecklist /> : null}

        <CrmAiInsightCard insight={dashboardAiInsight} />

        <NeedsAttentionPanel
          items={needsAttention}
          isCleanWorkspace={summary.onboarding.isCleanWorkspace}
        />
      </section>

      <section className="panel dashboard-scorecard" aria-labelledby="dashboard-scorecard-title">
        <PanelTitleRow
          actions={<Badge>12 metrics</Badge>}
          description="Linked sales health metrics for pipeline, quote coverage, outcomes, leads, and activity queues."
          title="Pipeline Scorecard"
          titleId="dashboard-scorecard-title"
        />
        <div className="stat-grid">
          <MetricCard
            href="/deals?status=OPEN"
            label="Open pipeline value"
            value={formatMoney(summary.metrics.openPipelineValueCents)}
          />
          <MetricCard
            href={"/quotes" as Route}
            label="Open quoted value"
            value={formatMoney(
              summary.commercialSnapshot.openQuotedDealValueCents,
            )}
          />
          <MetricCard
            href="/deals?commercial=noQuote"
            label="Open unquoted value"
            value={formatMoney(
              summary.commercialSnapshot.openUnquotedDealValueCents,
            )}
          />
          <MetricCard
            href="/deals?status=WON"
            label="Won deal value"
            value={formatMoney(summary.metrics.wonDealsValueCents)}
          />
          <MetricCard
            href="/deals?status=LOST"
            label="Lost deal value"
            value={formatMoney(summary.metrics.lostDealsValueCents)}
          />
          <MetricCard
            href="/deals?status=OPEN"
            label="Open deals"
            value={summary.metrics.openDealsCount}
          />
          <MetricCard
            href="/deals?status=WON"
            label="Won deals"
            value={summary.metrics.wonDealsCount}
          />
          <MetricCard
            href="/deals?status=LOST"
            label="Lost deals"
            value={summary.metrics.lostDealsCount}
          />
          <MetricCard
            href="/leads?status=QUALIFIED"
            label="Active leads"
            value={summary.metrics.activeLeadsCount}
          />
          <MetricCard
            href="/leads?followUp=missing"
            label="Active leads no next activity"
            value={summary.metrics.activeLeadsMissingNextActivity}
          />
          <MetricCard
            href="/activities?status=open&due=overdue"
            label="Open overdue activities"
            value={summary.metrics.overdueActivitiesCount}
          />
          <MetricCard
            href="/activities?status=open&due=today"
            label="Open due today"
            value={summary.metrics.dueTodayActivitiesCount}
          />
        </div>
      </section>

      <section className="content-grid">
        <PipelineHealthPanel health={summary.pipelineHealth} />
        <CommercialSnapshotPanel snapshot={summary.commercialSnapshot} />
      </section>

      <section className="content-grid">
        <RecentClosedDealsPanel deals={summary.recentClosedDeals} />
      </section>

      <section className="content-grid">
        <div className="panel">
          <PanelTitleRow
            actions={
              <Link
                aria-label={viewActiveDealsLabel}
                className="inline-link"
                href="/deals?status=OPEN"
                title={viewActiveDealsLabel}
              >
                View all
              </Link>
            }
            title="Active Deals"
          />
          {summary.recentOpenDeals.length > 0 ? (
            <TableScroll aria-label="Dashboard active deals table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Deal</th>
                    <th>Value</th>
                    <th>Stage</th>
                    <th>Related</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentOpenDeals.map((deal) => (
                    <tr key={deal.id}>
                      <td data-label="Deal">
                        <span className="table-primary-cell">
                          <Link
                            className="inline-link"
                            href={`/deals/${deal.id}`}
                          >
                            <strong>{deal.title}</strong>
                          </Link>
                          <span className="table-secondary-text">
                            {deal.owner?.name ??
                              deal.owner?.email ??
                              "Unassigned"}
                          </span>
                        </span>
                      </td>
                      <td data-label="Value">
                        {formatMoney(deal.valueCents, deal.currency)}
                      </td>
                      <td data-label="Stage">{deal.stage.name}</td>
                      <td data-label="Related">
                        <RelatedLinks
                          ariaLabel={`${deal.title} related records`}
                          organization={deal.organization}
                          person={deal.person}
                        />
                      </td>
                      <td className="table-actions-cell" data-label="Actions">
                        <ListRowActions
                          aria-label={`${deal.title} active deal actions`}
                          actions={[
                            {
                              href: `/deals/${deal.id}`,
                              label: "Open deal",
                              ariaLabel: `Open deal ${deal.title}`,
                            },
                            {
                              href: buildActivityFollowUpHref({
                                related: { type: "deal", id: deal.id },
                                returnTo: "/dashboard",
                                title: `Follow up: ${deal.title}`,
                              }),
                              label: "Add activity",
                              ariaLabel: `Add activity for deal ${deal.title}`,
                            },
                          ]}
                        />
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
                  aria-label={createOpenDealLabel}
                  className="button-secondary button-compact"
                  href="/deals/new"
                  title={createOpenDealLabel}
                >
                  Create deal
                </Link>
              }
              className="empty-state-compact empty-state-panel"
              description="Create a deal or convert a qualified lead to start tracking active pipeline."
              title="No open deals yet"
            />
          )}
        </div>

        <div className="panel">
          <PanelTitleRow
            actions={
              <Link
                aria-label={viewPriorityActivitiesLabel}
                className="inline-link"
                href="/activities"
                title={viewPriorityActivitiesLabel}
              >
                View queue
              </Link>
            }
            title="Priority Activities"
          />
          {summary.priorityActivities.length > 0 ? (
            <ul className="activity-list">
              {summary.priorityActivities.map((activity) => {
                const priorityActivityActionsLabel = `${activity.title} priority activity actions`;
                const priorityActivityWorkspaceLabel = `Edit priority activity ${activity.title}`;

                return (
                  <li className="activity-item activity-item-open" key={activity.id}>
                    <span className="activity-icon" aria-hidden="true">
                      {formatActivityType(activity.type).slice(0, 1)}
                    </span>
                    <div className="activity-content">
                      <div className="activity-row-header">
                        <div className="activity-title-group">
                          <Link
                            aria-label={priorityActivityWorkspaceLabel}
                            className="inline-link"
                            href={`/activities/${activity.id}/edit`}
                            title={priorityActivityWorkspaceLabel}
                          >
                            <strong>{activity.title}</strong>
                          </Link>
                          <span>{formatActivityType(activity.type)}</span>
                        </div>
                        <ActivityDueBadge activity={activity} />
                      </div>
                      <TimelineMetaRow
                        ariaLabel={`${activity.title} priority activity metadata`}
                        className="activity-context-line"
                        items={[
                          recordOwnerLabel(activity.owner),
                          activity.deal ? (
                            <Link
                              className="inline-link"
                              href={`/deals/${activity.deal.id}`}
                              key="deal"
                            >
                              Deal: {activity.deal.title}
                            </Link>
                          ) : null,
                          activity.lead ? (
                            <Link
                              className="inline-link"
                              href={`/leads/${activity.lead.id}`}
                              key="lead"
                            >
                              Lead: {activity.lead.title}
                            </Link>
                          ) : null,
                          activity.person ? (
                            <Link
                              className="inline-link"
                              href={`/contacts/${activity.person.id}`}
                              key="person"
                            >
                              Contact: {formatPersonName(activity.person) ?? "Unnamed contact"}
                            </Link>
                          ) : null,
                          activity.organization ? (
                            <Link
                              className="inline-link"
                              href={`/organizations/${activity.organization.id}`}
                              key="organization"
                            >
                              Organization: {activity.organization.name}
                            </Link>
                          ) : null,
                        ]}
                      />
                      <ActionGroup
                        className="activity-actions"
                        label={priorityActivityActionsLabel}
                      >
                        <Link
                          aria-label={`Edit priority activity ${activity.title}`}
                          className="button-secondary button-compact"
                          href={`/activities/${activity.id}/edit`}
                          title={`Edit priority activity ${activity.title}`}
                        >
                          Edit
                        </Link>
                        <ActivityCompleteButton
                          activityId={activity.id}
                          ariaLabel={`Mark priority activity ${activity.title} complete`}
                          inline
                          workspaceId={workspace.id}
                        />
                      </ActionGroup>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              actions={
                <Link
                  aria-label={createActivityLabel}
                  className="button-secondary button-compact"
                  href="/activities/new"
                  title={createActivityLabel}
                >
                  Create activity
                </Link>
              }
              className="empty-state-compact empty-state-panel"
              description="Plan the next call, email, meeting, or task so follow-up work stays visible."
              title="No open activities yet"
            />
          )}
        </div>
      </section>

      <section className="content-grid section-spaced">
        <div className="panel">
          <PanelTitleRow
            actions={
              <Link
                aria-label={viewQuotedDealsLabel}
                className="inline-link"
                href={"/quotes" as Route}
                title={viewQuotedDealsLabel}
              >
                Quoted deals
              </Link>
            }
            title="Recent Quotes"
          />
          {summary.recentQuotes.length > 0 ? (
            <TableScroll aria-label="Dashboard recent quotes table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Quote</th>
                    <th>Status</th>
                    <th>Total</th>
                    <th>Deal</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentQuotes.map((quote) => (
                    <tr key={quote.id}>
                      <td data-label="Quote">
                        <span className="table-primary-cell">
                          <Link
                            className="inline-link"
                            href={`/deals/${quote.dealId}/quotes/${quote.id}`}
                          >
                            <strong>{quote.number}</strong>
                          </Link>
                          <span className="table-secondary-text">
                            {formatDate(quote.createdAt)}
                          </span>
                        </span>
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={quote.status} />
                      </td>
                      <td data-label="Total">
                        {formatMoney(quote.totalCents, quote.currency)}
                      </td>
                      <td data-label="Deal">
                        <Link
                          className="inline-link"
                          href={`/deals/${quote.dealId}`}
                        >
                          {quote.deal.title}
                        </Link>
                      </td>
                      <td className="table-actions-cell" data-label="Actions">
                        <ListRowActions
                          aria-label={`${quote.number} quote actions`}
                          actions={[
                            {
                              href: `/deals/${quote.dealId}/quotes/${quote.id}`,
                              label: "Open quote",
                              ariaLabel: `Open quote ${quote.number}`,
                            },
                            {
                              href: `/deals/${quote.dealId}`,
                              label: "Open deal",
                              ariaLabel: `Open deal for quote ${quote.number}`,
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="Quotes usually come after a deal has a customer conversation and line items to review."
              title="No quotes yet"
            />
          )}
        </div>
        <div className="panel">
          <PanelTitleRow
            actions={
              <Link
                aria-label={viewActivitySnapshotLabel}
                className="inline-link"
                href="/activities"
                title={viewActivitySnapshotLabel}
              >
                View queue
              </Link>
            }
            title="Activity Snapshot"
          />
          <div className="field-grid">
            <SnapshotItem
              href="/activities?status=open&due=overdue"
              label="Open overdue"
              value={summary.activitySnapshot.overdue}
            />
            <SnapshotItem
              href="/activities?status=open&due=today"
              label="Open due today"
              value={summary.activitySnapshot.dueToday}
            />
            <SnapshotItem
              href="/activities?status=open&due=upcoming"
              label="Open upcoming"
              value={summary.activitySnapshot.upcoming}
            />
            <SnapshotItem
              href="/activities?status=completed"
              label="Completed activities"
              value={summary.activitySnapshot.completed}
            />
            <SnapshotItem
              href="/activities?status=completed&completed=recent"
              label="Completed recently"
              value={summary.activitySnapshot.completedRecently}
            />
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <PanelTitleRow
            actions={
              <Link
                aria-label={viewPipelineStagesLabel}
                className="inline-link"
                href="/deals?status=OPEN"
                title={viewPipelineStagesLabel}
              >
                Open deals
              </Link>
            }
            title="Pipeline By Stage"
          />
          {summary.pipelineBreakdown.length > 0 ? (
            <TableScroll aria-label="Dashboard pipeline by stage table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th>Open deals</th>
                    <th>Open value</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.pipelineBreakdown.map((stage) => (
                    <tr key={stage.stageId}>
                      <td data-label="Stage">
                        <span className="table-primary-cell">
                          <Link
                            className="inline-link"
                            href={
                              `/deals?status=OPEN&stageId=${stage.stageId}` as Route
                            }
                          >
                            <strong>{stage.stageName}</strong>
                          </Link>
                          <span className="table-secondary-text">
                            {stage.pipelineName}
                          </span>
                        </span>
                      </td>
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
              description="Add stages to see open deal value by stage."
              title="No pipeline stages are available yet"
            />
          )}
        </div>
      </section>

      <section className="content-grid section-spaced">
        <div className="panel">
          <PanelTitleRow
            actions={
              <Link
                aria-label={viewLeadStatusLabel}
                className="inline-link"
                href="/leads"
                title={viewLeadStatusLabel}
              >
                View leads
              </Link>
            }
            title="Leads By Status"
          />
          {summary.leadBreakdown.length > 0 ? (
            <TableScroll aria-label="Dashboard leads by status table">
              <table className="table crm-list-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Leads</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.leadBreakdown.map((lead) => (
                    <tr key={lead.status}>
                      <td data-label="Status">
                        <Link
                          className="inline-link"
                          href={`/leads?status=${lead.status}` as Route}
                        >
                          <StatusBadge status={lead.status} />
                        </Link>
                      </td>
                      <td data-label="Leads">{lead.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="Qualified leads will appear here as they move through intake."
              title="No leads have been created yet"
            />
          )}
        </div>
        <div className="panel">
          <PanelTitleRow title="Recent Changes" />
          {summary.recentChanges.length > 0 ? (
            <AuditEventList
              entries={summary.recentChanges}
              label="Recent workspace changes"
              showTarget
            />
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel"
              description="CRM updates, imports, lifecycle changes, and workspace activity will appear here as records change."
              title="No recent workspace changes"
            />
          )}
        </div>
      </section>
    </AppShell>
  );
}

function PipelineHealthPanel({ health }: { health: DashboardPipelineHealth }) {
  const healthLabel =
    health.overdueActivities > 0 ||
    health.dueTodayActivities > 0 ||
    health.openDealsWithoutNextActivity > 0 ||
    health.activeLeadsWithoutNextActivity > 0
      ? "Needs action"
      : "Healthy";
  const focusItems = getPipelineHealthFocusItems(health);
  const createHealthDealLabel =
    "Create a deal to start pipeline health tracking";

  return (
    <div className="panel">
      <PanelTitleRow
        actions={
          <Badge className={healthLabel === "Healthy" ? "badge badge-won" : "badge badge-lost"}>
            {healthLabel}
          </Badge>
        }
        description="Open pipeline operating signals, not forecast promises."
        title="Pipeline Health"
      />
      {health.openDeals > 0 || focusItems.length > 0 ? (
        <>
          {focusItems.length > 0 ? (
            <PipelineHealthFocusList items={focusItems} />
          ) : null}
          <div className="field-grid">
            <DashboardHealthItem
              href="/deals?status=OPEN"
              label="Open value"
              value={formatMoney(health.openValueCents)}
            />
            <DashboardHealthItem
              href="/deals?status=OPEN"
              label="Open deals"
              value={health.openDeals}
            />
            <DashboardHealthItem
              href="/activities?status=open&due=overdue"
              label="Overdue activities"
              value={health.overdueActivities}
            />
            <DashboardHealthItem
              href="/activities?status=open&due=today"
              label="Due today"
              value={health.dueTodayActivities}
            />
            <DashboardHealthItem
              href="/deals?followUp=missing"
              label="Deals with no next activity"
              value={health.openDealsWithoutNextActivity}
            />
            <DashboardHealthItem
              href="/leads?followUp=missing"
              label="Leads with no next activity"
              value={health.activeLeadsWithoutNextActivity}
            />
          </div>
        </>
      ) : (
        <EmptyState
          actions={
            <Link
              aria-label={createHealthDealLabel}
              className="button-secondary button-compact"
              href="/deals/new"
              title={createHealthDealLabel}
            >
              Create deal
            </Link>
          }
          className="empty-state-compact empty-state-panel pipeline-health-empty"
          description="Create a deal or add an active lead follow-up to start tracking operating signals."
          title="No pipeline health signals yet"
        />
      )}
    </div>
  );
}

function getPipelineHealthFocusItems(health: DashboardPipelineHealth) {
  return [
    {
      href: "/activities?status=open&due=overdue",
      label: "Review overdue activities",
      detail: "Past-due work that can block active pipeline.",
      value: health.overdueActivities,
      tone: "critical" as const,
    },
    {
      href: "/activities?status=open&due=today",
      label: "Work today's activity queue",
      detail: "Calls, emails, meetings, and tasks due today.",
      value: health.dueTodayActivities,
    },
    {
      href: "/deals?followUp=missing",
      label: "Schedule deal next steps",
      detail: "Open deals missing a planned next activity.",
      value: health.openDealsWithoutNextActivity,
    },
    {
      href: "/leads?followUp=missing",
      label: "Schedule lead follow-ups",
      detail: "Active leads missing a planned next activity.",
      value: health.activeLeadsWithoutNextActivity,
    },
  ].filter((item) => item.value > 0);
}

function PipelineHealthFocusList({
  items,
}: {
  items: Array<{
    detail: string;
    href: string;
    label: string;
    tone?: "critical";
    value: number;
  }>;
}) {
  return (
    <div
      className="dashboard-action-list"
      aria-label="Pipeline health focus queue"
    >
      {items.map((item) => {
        const actionLabel = `${item.label}: ${item.value}. ${item.detail}`;

        return (
          <Link
            aria-label={actionLabel}
            className={
              item.tone === "critical"
                ? "dashboard-action-card dashboard-action-card-critical"
                : "dashboard-action-card"
            }
            href={item.href as Route}
            key={item.href}
            title={actionLabel}
          >
            <span className="dashboard-action-count">{item.value}</span>
            <span className="dashboard-action-copy">
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function CommercialSnapshotPanel({
  snapshot,
}: {
  snapshot: {
    acceptedQuotes: number;
    draftQuotes: number;
    openDealsWithoutQuotes: number;
    openQuotedDealValueCents: number;
    openUnquotedDealValueCents: number;
    openValueWithoutLineItems: number;
  };
}) {
  const reviewUnquotedLabel = "Review open deals without quotes";

  return (
    <div className="panel">
      <PanelTitleRow
        actions={
          <Link
            aria-label={reviewUnquotedLabel}
            className="inline-link"
            href="/deals?commercial=noQuote"
            title={reviewUnquotedLabel}
          >
            Review unquoted
          </Link>
        }
        description="Quote-to-cash signals based on current deal value and quote status."
        title="Commercial Snapshot"
      />
      <div className="field-grid">
        <DashboardHealthItem
          href={"/quotes" as Route}
          label="Open quoted value"
          value={formatMoney(snapshot.openQuotedDealValueCents)}
        />
        <DashboardHealthItem
          href="/deals?commercial=noQuote"
          label="Open unquoted value"
          value={formatMoney(snapshot.openUnquotedDealValueCents)}
        />
        <DashboardHealthItem
          href="/deals?commercial=noQuote"
          label="Open deals without quotes"
          value={snapshot.openDealsWithoutQuotes}
        />
        <DashboardHealthItem
          href="/deals?commercial=valueNoLineItems"
          label="Value without line items"
          value={snapshot.openValueWithoutLineItems}
        />
        <DashboardHealthItem
          href="/deals?status=OPEN"
          label="Draft quotes"
          value={snapshot.draftQuotes}
        />
        <DashboardHealthItem
          href="/deals?commercial=acceptedQuote"
          label="Accepted quotes"
          value={snapshot.acceptedQuotes}
        />
      </div>
    </div>
  );
}

function RecentClosedDealsPanel({
  deals,
}: {
  deals: Array<{
    closedAt: Date | string;
    currency: string;
    id: string;
    organization?: { id: string; name: string } | null;
    ownerName: string;
    person?: { id: string; firstName: string; lastName: string | null } | null;
    stageName: string;
    status: string;
    title: string;
    valueCents: number;
  }>;
}) {
  const wonFilterLabel = "Show recently won deals";
  const lostFilterLabel = "Show recently lost deals";

  return (
    <div className="panel">
      <PanelTitleRow
        actions={
          <>
            <Link
              aria-label={wonFilterLabel}
              className="button-secondary button-compact"
              href="/deals?status=WON&sortBy=updatedAt&sortDirection=desc"
              title={wonFilterLabel}
            >
              Won
            </Link>
            <Link
              aria-label={lostFilterLabel}
              className="button-secondary button-compact"
              href="/deals?status=LOST&sortBy=updatedAt&sortDirection=desc"
              title={lostFilterLabel}
            >
              Lost
            </Link>
          </>
        }
        actionsLabel="Recent closed deal filters"
        description="Closed deals with recorded won/lost timestamps."
        title="Recent Won / Lost Movement"
      />
      {deals.length > 0 ? (
        <TableScroll aria-label="Dashboard recent won and lost movement table">
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Status</th>
                <th>Value</th>
                <th>Closed</th>
                <th>Owner</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal.id}>
                  <td data-label="Deal">
                    <span className="table-primary-cell">
                      <Link className="inline-link" href={`/deals/${deal.id}`}>
                        <strong>{deal.title}</strong>
                      </Link>
                      <span className="table-secondary-text">
                        {deal.stageName}
                      </span>
                      <RelatedLinks
                        ariaLabel={`${deal.title} related records`}
                        organization={deal.organization}
                        person={deal.person}
                      />
                    </span>
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={deal.status} />
                  </td>
                  <td data-label="Value">
                    {formatMoney(deal.valueCents, deal.currency)}
                  </td>
                  <td data-label="Closed">{formatDate(deal.closedAt)}</td>
                  <td data-label="Owner">{deal.ownerName}</td>
                  <td className="table-actions-cell" data-label="Actions">
                    <ListRowActions
                      aria-label={`${deal.title} recent closed deal actions`}
                      actions={[
                        {
                          href: `/deals/${deal.id}`,
                          label: "Open deal",
                          ariaLabel: `Open deal ${deal.title}`,
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <EmptyState
          className="empty-state-compact empty-state-panel"
          description="Won and lost deal movement will appear here after deals are closed in Northstar."
          title="No closed deal movement yet"
        />
      )}
    </div>
  );
}

function DashboardFocusStrip({
  dueToday,
  needsAttentionCount,
  openPipelineValue,
  overdue,
}: {
  dueToday: number;
  needsAttentionCount: number;
  openPipelineValue: string;
  overdue: number;
}) {
  const workQueueHref = dashboardWorkQueueHref({ dueToday, overdue });

  return (
    <section className="command-strip" aria-label="Dashboard focus">
      <DashboardCommandCard
        actionLabel={`Review ${needsAttentionCount} dashboard attention ${needsAttentionCount === 1 ? "item" : "items"}`}
        href="/dashboard#needs-attention-title"
        label="Needs attention"
        tone="critical"
        value={needsAttentionCount}
      >
        {needsAttentionCount === 1 ? "next action" : "next actions"}
      </DashboardCommandCard>
      <DashboardCommandCard
        actionLabel={`View open pipeline value of ${openPipelineValue}`}
        href="/deals?status=OPEN"
        label="Open pipeline"
        value={openPipelineValue}
      >
        active opportunity value
      </DashboardCommandCard>
      <DashboardCommandCard
        actionLabel={`Open work queue with ${overdue} overdue and ${dueToday} due today activities`}
        href={workQueueHref}
        label="Today's work queue"
        value={dueToday + overdue}
      >
        {overdue} overdue, {dueToday} due today
      </DashboardCommandCard>
    </section>
  );
}

function dashboardWorkQueueHref({
  dueToday,
  overdue,
}: {
  dueToday: number;
  overdue: number;
}) {
  if (overdue > 0) return "/activities?status=open&due=overdue";
  if (dueToday > 0) return "/activities?status=open&due=today";
  return "/activities?status=open";
}

function DashboardCommandCard({
  actionLabel,
  children,
  href,
  label,
  tone,
  value,
}: {
  actionLabel: string;
  children: ReactNode;
  href: string;
  label: string;
  tone?: "critical";
  value: ReactNode;
}) {
  return (
    <Link
      aria-label={actionLabel}
      className={
        tone === "critical"
          ? "command-card command-card-critical"
          : "command-card"
      }
      href={href as Route}
      title={actionLabel}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{children}</small>
    </Link>
  );
}

function NeedsAttentionPanel({
  items,
  isCleanWorkspace,
}: {
  items: NeedsAttentionItem[];
  isCleanWorkspace: boolean;
}) {
  return (
    <section
      className="panel needs-attention-panel"
      aria-labelledby="needs-attention-title"
    >
      <PanelTitleRow
        actions={
          <Badge>
            {items.length > 0
              ? `${items.length} next action${items.length === 1 ? "" : "s"}`
              : "Caught up"}
          </Badge>
        }
        eyebrow="Sales Assistant"
        title="Needs Attention"
        titleId="needs-attention-title"
      />
      {items.length > 0 ? (
        <div className="needs-attention-list">
          {items.map((item) => {
            const actionLabel = `${item.actionLabel} for ${item.title}`;

            return (
              <article className="needs-attention-item" key={item.id}>
                <CompactTitleRow
                  actions={
                    <AttentionBadge tone={item.kind}>
                      {attentionKindLabel(item.kind)}
                    </AttentionBadge>
                  }
                  description={item.reason}
                  title={
                    <Link className="inline-link" href={item.href as Route}>
                      {item.title}
                    </Link>
                  }
                />
                <Link
                  aria-label={actionLabel}
                  className="button-secondary button-compact"
                  href={item.actionHref as Route}
                  title={actionLabel}
                >
                  {item.actionLabel}
                </Link>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          actions={
            <Link
              className="button-secondary button-compact"
              href={isCleanWorkspace ? "/deals/new" : "/activities"}
            >
              {isCleanWorkspace ? "Create first deal" : "View activities"}
            </Link>
          }
          className="empty-state-compact"
          description={
            isCleanWorkspace
              ? "As you add real deals, activities, quotes, and emails, Northstar will highlight the next actions here."
              : "Overdue work, stale deals, waiting quotes, and contract follow-ups will appear here automatically."
          }
          title={
            isCleanWorkspace ? "No follow-ups yet" : "Nothing urgent right now"
          }
        />
      )}
    </section>
  );
}

function attentionKindLabel(kind: NeedsAttentionItem["kind"]) {
  if (kind === "overdue-activity") return "Overdue";
  if (kind === "activity-due-today") return "Due today";
  if (kind === "deal-no-next-activity") return "No next activity";
  if (kind === "stale-deal") return "Stale deal";
  if (kind === "lead-no-activity") return "Lead";
  if (kind === "quote-waiting") return "Quote waiting";
  if (kind === "contract-attention") return "Contract";
  if (kind === "closing-soon") return "Closing soon";
  return "Email follow-up";
}

function RelatedLinks({
  ariaLabel,
  organization,
  person,
}: {
  ariaLabel: string;
  organization?: { id: string; name: string } | null;
  person?: { id: string; firstName: string; lastName: string | null } | null;
}) {
  if (!organization && !person) return <InlineEmptyStateText>No linked CRM record</InlineEmptyStateText>;

  return (
    <span aria-label={ariaLabel} className="deal-meta">
      {organization ? (
        <Link
          className="inline-link"
          href={`/organizations/${organization.id}`}
        >
          {organization.name}
        </Link>
      ) : null}
      {person ? (
        <Link className="inline-link" href={`/contacts/${person.id}`}>
          {formatPersonName(person) ?? "Unnamed contact"}
        </Link>
      ) : null}
    </span>
  );
}

function FirstRunChecklist() {
  const steps = [
    {
      title: "Create or import contacts",
      description:
        "Add the people you sell to, or import a CSV when you already have a list.",
      href: "/contacts/new",
      action: "Add contact",
    },
    {
      title: "Add an organization",
      description: "Create the company or account behind the opportunity.",
      href: "/organizations/new",
      action: "New organization",
    },
    {
      title: "Create your first deal",
      description:
        "Start the sales workflow in your ready-to-use New Business pipeline.",
      href: "/deals/new",
      action: "New deal",
    },
    {
      title: "Schedule a follow-up activity",
      description: "Plan the next call, email, meeting, or task.",
      href: "/activities/new",
      action: "New activity",
    },
    {
      title: "Connect Gmail or Google Workspace",
      description:
        "Sync recent matched email metadata and snippets from known contacts.",
      href: "/email",
      action: "Open email",
    },
    {
      title: "Invite a teammate",
      description:
        "Add another Northstar user to the workspace when you are ready to collaborate.",
      href: "/settings",
      action: "Open settings",
    },
  ] as const;

  return (
    <section className="onboarding-panel" aria-labelledby="first-run-title">
      <PanelTitleRow
        description="Your workspace is clean and ready. The New Business pipeline is already in place; add real records as you start working."
        eyebrow="First run"
        title="Set up your sales workspace"
        titleId="first-run-title"
      />
      <ol className="onboarding-list">
        {steps.map((step, index) => {
          const actionLabel = `${step.action}: ${step.title}`;

          return (
            <li className="onboarding-item" key={step.title}>
              <span className="onboarding-step">{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.description}</p>
              </div>
              <Link
                aria-label={actionLabel}
                className="button-secondary button-compact"
                href={step.href}
                title={actionLabel}
              >
                {step.action}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
