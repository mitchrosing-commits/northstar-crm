import Link from "next/link";
import type { Route } from "next";

import { ActivityDueBadge } from "@/components/activity-due-badge";
import { AuditEventList } from "@/components/audit-event-list";
import { AppShell } from "@/components/app-shell";
import { formatActivityType, formatDate, formatMoney } from "@/components/format";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getDashboardSummary, getNeedsAttentionSummary, type NeedsAttentionItem } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [summary, needsAttention] = await Promise.all([getDashboardSummary(actor), getNeedsAttentionSummary(actor)]);

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Workspace</p>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">A command center for pipeline health, urgent follow-ups, and recent customer work.</p>
        </div>
        <div className="header-actions">
          <Link className="button-secondary" href="/pipeline">
            View pipeline
          </Link>
          <Link className="button-primary" href="/deals/new">
            New deal
          </Link>
        </div>
      </header>

      <DashboardFocusStrip
        dueToday={summary.metrics.dueTodayActivitiesCount}
        needsAttentionCount={needsAttention.length}
        openPipelineValue={formatMoney(summary.metrics.openPipelineValueCents)}
        overdue={summary.metrics.overdueActivitiesCount}
      />

      {summary.onboarding.isCleanWorkspace ? <FirstRunChecklist /> : null}

      <NeedsAttentionPanel items={needsAttention} isCleanWorkspace={summary.onboarding.isCleanWorkspace} />

      <section className="stat-grid">
        <MetricCard href="/deals?status=OPEN" label="Open pipeline value" value={formatMoney(summary.metrics.openPipelineValueCents)} />
        <MetricCard href="/deals?status=OPEN" label="Open deals" value={summary.metrics.openDealsCount} />
        <MetricCard href="/deals?status=WON" label="Won deals" value={summary.metrics.wonDealsCount} />
        <MetricCard href="/deals?status=LOST" label="Lost deals" value={summary.metrics.lostDealsCount} />
        <MetricCard href="/leads?status=QUALIFIED" label="Active leads" value={summary.metrics.activeLeadsCount} />
        <MetricCard href="/activities?status=open&due=overdue" label="Open overdue activities" value={summary.metrics.overdueActivitiesCount} />
        <MetricCard href="/activities?status=open&due=today" label="Open due today" value={summary.metrics.dueTodayActivitiesCount} />
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">Active Deals</h2>
            <Link className="inline-link" href="/deals">
              View all
            </Link>
          </div>
          {summary.recentOpenDeals.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Deal</th>
                  <th>Value</th>
                  <th>Stage</th>
                  <th>Related</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentOpenDeals.map((deal) => (
                  <tr key={deal.id}>
                    <td>
                      <Link className="inline-link" href={`/deals/${deal.id}`}>
                        {deal.title}
                      </Link>
                    </td>
                    <td>{formatMoney(deal.valueCents, deal.currency)}</td>
                    <td>{deal.stage.name}</td>
                    <td>
                      <RelatedLinks organization={deal.organization} person={deal.person} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">
              No open deals yet. <Link href="/deals/new">Create a deal</Link> or convert a qualified lead.
            </p>
          )}
        </div>

        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">Priority Activities</h2>
            <Link className="inline-link" href="/activities">
              View queue
            </Link>
          </div>
          {summary.priorityActivities.length > 0 ? (
            <ul className="activity-list">
              {summary.priorityActivities.map((activity) => (
                <li className="activity-item" key={activity.id}>
                  <span className="activity-icon" aria-hidden="true">
                    {formatActivityType(activity.type).slice(0, 1)}
                  </span>
                  <div className="activity-content">
                    <Link className="inline-link" href={`/activities/${activity.id}/edit`}>
                      <strong>{activity.title}</strong>
                    </Link>
                    <div className="deal-meta">
                      <span>{formatActivityType(activity.type)}</span>
                      <ActivityDueBadge activity={activity} />
                      {activity.deal ? (
                        <Link className="inline-link" href={`/deals/${activity.deal.id}`}>
                          {activity.deal.title}
                        </Link>
                      ) : null}
                      {activity.lead ? (
                        <Link className="inline-link" href={`/leads/${activity.lead.id}`}>
                          {activity.lead.title}
                        </Link>
                      ) : null}
                      {activity.person ? (
                        <Link className="inline-link" href={`/contacts/${activity.person.id}`}>
                          {formatPersonName(activity.person)}
                        </Link>
                      ) : null}
                      {activity.organization ? (
                        <Link className="inline-link" href={`/organizations/${activity.organization.id}`}>
                          {activity.organization.name}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">
              No open activities yet. <Link href="/activities/new">Create an activity</Link> to plan the next step.
            </p>
          )}
        </div>
      </section>

      <section className="content-grid" style={{ marginTop: 14 }}>
        <div className="panel">
          <div className="panel-title-row">
            <h2 className="panel-title">Recent Quotes</h2>
            <Link className="inline-link" href="/deals">
              Find deals
            </Link>
          </div>
          {summary.recentQuotes.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Deal</th>
                </tr>
              </thead>
              <tbody>
                {summary.recentQuotes.map((quote) => (
                  <tr key={quote.id}>
                    <td>
                      <Link className="inline-link" href={`/deals/${quote.dealId}/quotes/${quote.id}`}>
                        {quote.number}
                      </Link>
                      <div className="deal-meta">{formatDate(quote.createdAt)}</div>
                    </td>
                    <td>{quote.status}</td>
                    <td>{formatMoney(quote.totalCents, quote.currency)}</td>
                    <td>
                      <Link className="inline-link" href={`/deals/${quote.dealId}`}>
                        {quote.deal.title}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">
              No quotes yet. Quotes usually come after a deal has a customer conversation and line items to review.
            </p>
          )}
        </div>
        <div className="panel">
          <h2 className="panel-title">Activity Snapshot</h2>
          <div className="field-grid">
            <SnapshotItem label="Open overdue" value={summary.activitySnapshot.overdue} />
            <SnapshotItem label="Open due today" value={summary.activitySnapshot.dueToday} />
            <SnapshotItem label="Open upcoming" value={summary.activitySnapshot.upcoming} />
            <SnapshotItem label="Completed activities" value={summary.activitySnapshot.completed} />
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <h2 className="panel-title">Pipeline By Stage</h2>
          {summary.pipelineBreakdown.length > 0 ? (
            <table className="table">
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
                    <td>
                      <strong>{stage.stageName}</strong>
                      <div className="deal-meta">{stage.pipelineName}</div>
                    </td>
                    <td>{stage.openDealCount}</td>
                    <td>{formatMoney(stage.openDealValueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">No pipeline stages are available yet. Add stages to see open deal value by stage.</p>
          )}
        </div>
      </section>

      <section className="content-grid" style={{ marginTop: 14 }}>
        <div className="panel">
          <h2 className="panel-title">Leads By Status</h2>
          {summary.leadBreakdown.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Leads</th>
                </tr>
              </thead>
              <tbody>
                {summary.leadBreakdown.map((lead) => (
                  <tr key={lead.status}>
                    <td>{lead.status}</td>
                    <td>{lead.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-copy">No leads have been created yet.</p>
          )}
        </div>
        <div className="panel">
          <h2 className="panel-title">Recent Changes</h2>
          {summary.recentChanges.length > 0 ? (
            <AuditEventList entries={summary.recentChanges} label="Recent workspace changes" showTarget />
          ) : (
            <p className="empty-copy">Recent workspace changes will appear here as CRM records are updated.</p>
          )}
        </div>
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

function SnapshotItem({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <p className="field-value">{value}</p>
    </div>
  );
}

function DashboardFocusStrip({
  dueToday,
  needsAttentionCount,
  openPipelineValue,
  overdue
}: {
  dueToday: number;
  needsAttentionCount: number;
  openPipelineValue: string;
  overdue: number;
}) {
  return (
    <section className="command-strip" aria-label="Dashboard focus">
      <Link className="command-card command-card-critical" href="/dashboard#needs-attention-title">
        <span>Needs attention</span>
        <strong>{needsAttentionCount}</strong>
        <small>{needsAttentionCount === 1 ? "next action" : "next actions"}</small>
      </Link>
      <Link className="command-card" href="/deals?status=OPEN">
        <span>Open pipeline</span>
        <strong>{openPipelineValue}</strong>
        <small>active opportunity value</small>
      </Link>
      <Link className="command-card" href="/activities?status=open">
        <span>Today&apos;s work queue</span>
        <strong>{dueToday + overdue}</strong>
        <small>
          {overdue} overdue, {dueToday} due today
        </small>
      </Link>
    </section>
  );
}

function NeedsAttentionPanel({ items, isCleanWorkspace }: { items: NeedsAttentionItem[]; isCleanWorkspace: boolean }) {
  return (
    <section className="panel needs-attention-panel" aria-labelledby="needs-attention-title">
      <div className="panel-title-row">
        <div>
          <p className="page-kicker">Sales Assistant</p>
          <h2 className="panel-title" id="needs-attention-title">
            Needs Attention
          </h2>
        </div>
        <span className="badge">{items.length > 0 ? `${items.length} next action${items.length === 1 ? "" : "s"}` : "Caught up"}</span>
      </div>
      {items.length > 0 ? (
        <div className="needs-attention-list">
          {items.map((item) => (
            <article className="needs-attention-item" key={item.id}>
              <div>
                <span className={`attention-kind attention-kind-${item.kind}`}>{attentionKindLabel(item.kind)}</span>
                <h3>
                  <Link className="inline-link" href={item.href as Route}>
                    {item.title}
                  </Link>
                </h3>
                <p>{item.reason}</p>
              </div>
              <Link className="button-secondary button-compact" href={item.actionHref as Route}>
                {item.actionLabel}
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state-compact">
          <h3>{isCleanWorkspace ? "No follow-ups yet" : "Nothing urgent right now"}</h3>
          <p>
            {isCleanWorkspace
              ? "As you add real deals, activities, quotes, and emails, Northstar will highlight the next actions here."
              : "Overdue work, stale deals, waiting quotes, and contract follow-ups will appear here automatically."}
          </p>
          <Link className="button-secondary button-compact" href={isCleanWorkspace ? "/deals/new" : "/activities"}>
            {isCleanWorkspace ? "Create first deal" : "View activities"}
          </Link>
        </div>
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
  organization,
  person
}: {
  organization?: { id: string; name: string } | null;
  person?: { id: string; firstName: string; lastName: string | null } | null;
}) {
  if (!organization && !person) return <span className="muted">None</span>;

  return (
    <span className="deal-meta">
      {organization ? (
        <Link className="inline-link" href={`/organizations/${organization.id}`}>
          {organization.name}
        </Link>
      ) : null}
      {person ? (
        <Link className="inline-link" href={`/contacts/${person.id}`}>
          {formatPersonName(person)}
        </Link>
      ) : null}
    </span>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function FirstRunChecklist() {
  const steps = [
    {
      title: "Create or import contacts",
      description: "Add the people you sell to, or import a CSV when you already have a list.",
      href: "/contacts/new",
      action: "Add contact"
    },
    {
      title: "Add an organization",
      description: "Create the company or account behind the opportunity.",
      href: "/organizations/new",
      action: "New organization"
    },
    {
      title: "Create your first deal",
      description: "Start the sales workflow in your ready-to-use New Business pipeline.",
      href: "/deals/new",
      action: "New deal"
    },
    {
      title: "Schedule a follow-up activity",
      description: "Plan the next call, email, meeting, or task.",
      href: "/activities/new",
      action: "New activity"
    },
    {
      title: "Connect Gmail or Google Workspace",
      description: "Sync recent matched email metadata and snippets from known contacts.",
      href: "/email",
      action: "Open email"
    },
    {
      title: "Invite a teammate",
      description: "Add another Northstar user to the workspace when you are ready to collaborate.",
      href: "/settings",
      action: "Open settings"
    }
  ] as const;

  return (
    <section className="onboarding-panel" aria-labelledby="first-run-title">
      <div>
        <p className="page-kicker">First run</p>
        <h2 className="panel-title" id="first-run-title">
          Set up your sales workspace
        </h2>
        <p className="empty-copy">
          Your workspace is clean and ready. The New Business pipeline is already in place; add real records as you start working.
        </p>
      </div>
      <ol className="onboarding-list">
        {steps.map((step, index) => (
          <li className="onboarding-item" key={step.title}>
            <span className="onboarding-step">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.description}</p>
            </div>
            <Link className="button-secondary button-compact" href={step.href}>
              {step.action}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
