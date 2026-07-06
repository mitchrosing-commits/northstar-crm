import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DealStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { formatStatusBadgeLabel } from "@/components/status-badge";
import { summarizeDealStatusMetrics } from "@/lib/services/dashboard-service";

const dashboardService = readFileSync(
  join(process.cwd(), "lib/services/dashboard-service.ts"),
  "utf8",
);
const dashboardPage = readFileSync(
  join(process.cwd(), "app/dashboard/page.tsx"),
  "utf8",
);
const inlineEmptyStateText = readFileSync(
  join(process.cwd(), "components/inline-empty-state-text.tsx"),
  "utf8",
);
const auditEventList = readFileSync(
  join(process.cwd(), "components/audit-event-list.tsx"),
  "utf8",
);
const crmBarrel = readFileSync(
  join(process.cwd(), "lib/services/crm.ts"),
  "utf8",
);
const fieldMetric = readFileSync(
  join(process.cwd(), "components/field-metric.tsx"),
  "utf8",
);
const recordOwnerLabel = readFileSync(
  join(process.cwd(), "lib/record-owner-label.ts"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const statCard = readFileSync(
  join(process.cwd(), "components/stat-card.tsx"),
  "utf8",
);
const statusBadge = readFileSync(
  join(process.cwd(), "components/status-badge.tsx"),
  "utf8",
);
const tableScroll = readFileSync(
  join(process.cwd(), "components/table-scroll.tsx"),
  "utf8",
);

describe("dashboard summary behavior", () => {
  it("adds a workspace-scoped dashboard summary service", () => {
    expect(dashboardService).toContain(
      "export async function getDashboardSummary",
    );
    expect(dashboardService).toContain("ensureWorkspaceAccess(actor)");
    expect(dashboardService).toContain("workspaceId: actor.workspaceId");
    expect(dashboardService).toContain("prisma.deal.groupBy");
    expect(dashboardService).toContain("prisma.pipelineStage.findMany");
    expect(dashboardService).toContain("prisma.lead.groupBy");
    expect(dashboardService).toContain("prisma.activity.count");
    expect(dashboardService).toContain("prisma.auditLog.findMany");
    expect(dashboardService).toContain("actor: { select: userDisplaySelect }");
    expect(dashboardService).not.toContain("include: { actor: true }");
    expect(crmBarrel).toContain('export * from "./dashboard-service"');
  });

  it("calculates the requested dashboard buckets", () => {
    expect(dashboardService).toContain("openPipelineValueCents");
    expect(dashboardService).toContain("openDealsCount");
    expect(dashboardService).toContain("wonDealsCount");
    expect(dashboardService).toContain("wonDealsValueCents");
    expect(dashboardService).toContain("lostDealsCount");
    expect(dashboardService).toContain("lostDealsValueCents");
    expect(dashboardService).toContain("activeLeadsCount");
    expect(dashboardService).toContain("overdueActivitiesCount");
    expect(dashboardService).toContain("dueTodayActivitiesCount");
    expect(dashboardService).toContain("pipelineBreakdown");
    expect(dashboardService).toContain("pipelineHealth");
    expect(dashboardService).toContain("commercialSnapshot");
    expect(dashboardService).toContain("openQuotedDealValueCents");
    expect(dashboardService).toContain("openUnquotedDealValueCents");
    expect(dashboardService).toContain("openDealsWithoutQuotes");
    expect(dashboardService).toContain("openValueWithoutLineItems");
    expect(dashboardService).toContain("draftQuotes");
    expect(dashboardService).toContain("acceptedQuotes");
    expect(dashboardService).toContain("getFollowUpHealthSummary");
    expect(dashboardService).toContain(
      "openDealsWithoutNextActivity: followUpHealth.openDealsMissingNextActivity",
    );
    expect(dashboardService).toContain("activeLeadsMissingNextActivity");
    expect(dashboardService).toContain("leadBreakdown");
    expect(dashboardService).toContain("activitySnapshot");
    expect(dashboardService).toContain("recentClosedDeals");
    expect(dashboardService).toContain("recentChanges");
  });

  it("calculates deal status value metrics from grouped deal rows", () => {
    expect(
      summarizeDealStatusMetrics([
        {
          status: DealStatus.OPEN,
          _count: { _all: 3 },
          _sum: { valueCents: 12500 },
        },
        {
          status: DealStatus.WON,
          _count: { _all: 2 },
          _sum: { valueCents: 9000 },
        },
        {
          status: DealStatus.LOST,
          _count: { _all: 1 },
          _sum: { valueCents: null },
        },
      ]),
    ).toEqual({
      totalDealsCount: 6,
      openPipelineValueCents: 12500,
      openDealsCount: 3,
      wonDealsCount: 2,
      wonDealsValueCents: 9000,
      lostDealsCount: 1,
      lostDealsValueCents: 0,
    });
  });

  it("renders the dashboard as a read-only sales overview", () => {
    expect(dashboardPage).toContain("getDashboardSummary(actor)");
    expect(dashboardPage).toContain("Open pipeline value");
    expect(dashboardPage).toContain("Open quoted value");
    expect(dashboardPage).toContain("Open unquoted value");
    expect(dashboardPage).toContain("Won deal value");
    expect(dashboardPage).toContain("Lost deal value");
    expect(dashboardPage).toContain("Open deals");
    expect(dashboardPage).toContain("Won deals");
    expect(dashboardPage).toContain("Lost deals");
    expect(dashboardPage).toContain("Active leads");
    expect(dashboardPage).toContain("Active leads no next activity");
    expect(dashboardPage).toContain("Open overdue activities");
    expect(dashboardPage).toContain("Open due today");
    expect(dashboardPage).toContain('href="/deals?status=OPEN"');
    expect(dashboardPage).toContain('href="/deals?status=WON"');
    expect(dashboardPage).toContain(
      'href="/activities?status=open&due=overdue"',
    );
    expect(dashboardPage).toContain('href="/deals?followUp=missing"');
    expect(dashboardPage).toContain('href="/leads?followUp=missing"');
    expect(dashboardPage).toContain("StatCard as MetricCard");
    expect(statCard).toContain("export function StatCard");
    expect(statCard).toContain('className="stat-card-link"');
    expect(statCard).toContain('className="stat-card"');
    expect(statCard).toContain(
      "const resolvedActionLabel = actionLabel ?? `View ${label.toLowerCase()}`",
    );
    expect(statCard).toContain("aria-label={resolvedActionLabel}");
    expect(statCard).toContain("title={resolvedActionLabel}");
    expect(dashboardPage).toContain("PanelTitleRow");
    expect(dashboardPage).toContain(
      'const viewPipelineLabel = "View pipeline board"',
    );
    expect(dashboardPage).toContain(
      'const newDealLabel = "Create a new deal from dashboard"',
    );
    expect(dashboardPage).toContain("aria-label={viewPipelineLabel}");
    expect(dashboardPage).toContain("title={viewPipelineLabel}");
    expect(dashboardPage).toContain("aria-label={newDealLabel}");
    expect(dashboardPage).toContain("title={newDealLabel}");
    expect(dashboardPage).toContain(
      'const viewActiveDealsLabel = "View all open deals"',
    );
    expect(dashboardPage).toContain(
      'const createOpenDealLabel = "Create a deal from dashboard"',
    );
    expect(dashboardPage).toContain("aria-label={viewActiveDealsLabel}");
    expect(dashboardPage).toContain("title={viewActiveDealsLabel}");
    expect(dashboardPage).toContain("aria-label={createOpenDealLabel}");
    expect(dashboardPage).toContain("title={createOpenDealLabel}");
    expect(dashboardPage).toContain('title="Active Deals"');
    expect(dashboardPage).toContain('href="/deals?status=OPEN"');
    expect(dashboardPage).toContain(
      'const viewPriorityActivitiesLabel = "View priority activity queue"',
    );
    expect(dashboardPage).toContain(
      'const createActivityLabel = "Create an activity from dashboard"',
    );
    expect(dashboardPage).toContain("aria-label={viewPriorityActivitiesLabel}");
    expect(dashboardPage).toContain("title={viewPriorityActivitiesLabel}");
    expect(dashboardPage).toContain("aria-label={createActivityLabel}");
    expect(dashboardPage).toContain("title={createActivityLabel}");
    expect(dashboardPage).toContain('title="Priority Activities"');
    expect(dashboardPage).toContain('title="Recent Quotes"');
    expect(dashboardPage).toContain(
      'const viewQuotedDealsLabel = "View deals with quotes"',
    );
    expect(dashboardPage).toContain("aria-label={viewQuotedDealsLabel}");
    expect(dashboardPage).toContain("title={viewQuotedDealsLabel}");
    expect(dashboardPage).toContain("Quoted deals");
    expect(dashboardPage).toContain('title="Activity Snapshot"');
    expect(dashboardPage).toContain(
      'const viewActivitySnapshotLabel = "View activity queue"',
    );
    expect(dashboardPage).toContain("aria-label={viewActivitySnapshotLabel}");
    expect(dashboardPage).toContain("title={viewActivitySnapshotLabel}");
    expect(dashboardPage).toContain("View queue");
    expect(dashboardPage).toContain('title="Pipeline By Stage"');
    expect(dashboardPage).toContain(
      'const viewPipelineStagesLabel = "View open deals by stage"',
    );
    expect(dashboardPage).toContain("aria-label={viewPipelineStagesLabel}");
    expect(dashboardPage).toContain("title={viewPipelineStagesLabel}");
    expect(dashboardPage).toContain("Open deals");
    expect(dashboardPage).toContain('title="Leads By Status"');
    expect(dashboardPage).toContain(
      'const viewLeadStatusLabel = "View leads list"',
    );
    expect(dashboardPage).toContain("aria-label={viewLeadStatusLabel}");
    expect(dashboardPage).toContain("title={viewLeadStatusLabel}");
    expect(dashboardPage).toContain("View leads");
    expect(dashboardPage).toContain('title="Recent Changes"');
    expect(dashboardPage).toContain("Pipeline Health");
    expect(dashboardPage).toContain('title="Pipeline Health"');
    expect(dashboardPage).toContain("Commercial Snapshot");
    expect(dashboardPage).toContain('title="Commercial Snapshot"');
    expect(dashboardPage).toContain(
      "Quote-to-cash signals based on current deal value and quote status.",
    );
    expect(dashboardPage).toContain('href="/deals?commercial=noQuote"');
    expect(dashboardPage).toContain(
      'const reviewUnquotedLabel = "Review open deals without quotes"',
    );
    expect(dashboardPage).toContain("aria-label={reviewUnquotedLabel}");
    expect(dashboardPage).toContain("title={reviewUnquotedLabel}");
    expect(dashboardPage).toContain('href="/deals?commercial=hasQuote"');
    expect(dashboardPage).toContain(
      'href="/deals?commercial=valueNoLineItems"',
    );
    expect(dashboardPage).toContain('href="/deals?commercial=acceptedQuote"');
    expect(dashboardPage).toContain("Open pipeline operating signals");
    expect(dashboardPage).toContain("Deals with no next activity");
    expect(dashboardPage).toContain("Leads with no next activity");
    expect(dashboardPage).toContain("FieldMetric as DashboardHealthItem");
    expect(dashboardPage).toContain("FieldMetric as SnapshotItem");
    expect(dashboardPage).not.toContain("function DashboardHealthItem");
    expect(dashboardPage).not.toContain("function SnapshotItem");
    expect(fieldMetric).toContain("export function FieldMetric");
    expect(fieldMetric).toContain('className="field-label"');
    expect(fieldMetric).toContain(
      'className={["field-value", valueClassName].filter(Boolean).join(" ")}',
    );
    expect(fieldMetric).toContain(
      'className={["field-link", className].filter(Boolean).join(" ")}',
    );
    expect(fieldMetric).toContain(
      "const resolvedActionLabel = actionLabel ?? `View ${label.toLowerCase()}`",
    );
    expect(fieldMetric).toContain("aria-label={resolvedActionLabel}");
    expect(fieldMetric).toContain("title={resolvedActionLabel}");
    expect(globalStyles).toContain(".field-link");
    expect(globalStyles).toContain(".field-label");
    expect(globalStyles).toContain(".field-value");
    expect(globalStyles).toContain("min-width: 0");
    expect(globalStyles).toContain("overflow-wrap: anywhere");
    expect(dashboardPage).toContain("pipeline-health-empty");
    expect(dashboardPage).toContain('title="No pipeline health signals yet"');
    expect(dashboardPage).toContain("const createHealthDealLabel =");
    expect(dashboardPage).toContain(
      "Create a deal to start pipeline health tracking",
    );
    expect(dashboardPage).toContain("aria-label={createHealthDealLabel}");
    expect(dashboardPage).toContain("title={createHealthDealLabel}");
    expect(dashboardPage).toContain(
      "Create a deal or add an active lead follow-up to start tracking operating signals.",
    );
    expect(dashboardPage).not.toContain(
      "No open deals or active lead follow-ups need attention yet.",
    );
    expect(dashboardPage).toContain("function getPipelineHealthFocusItems");
    expect(dashboardPage).toContain("function PipelineHealthFocusList");
    expect(dashboardPage).toContain("Pipeline health focus queue");
    expect(dashboardPage).toContain(
      "const actionLabel = `${item.label}: ${item.value}. ${item.detail}`;",
    );
    expect(dashboardPage).toContain("Review overdue activities");
    expect(dashboardPage).toContain("Work today's activity queue");
    expect(dashboardPage).toContain("Schedule deal next steps");
    expect(dashboardPage).toContain("Schedule lead follow-ups");
    expect(dashboardPage).toContain(
      "dashboard-action-card dashboard-action-card-critical",
    );
    expect(globalStyles).toContain(".dashboard-action-list");
    expect(globalStyles).toContain(".dashboard-action-card");
    expect(globalStyles).toContain(".dashboard-action-card-critical");
    expect(globalStyles).toContain(".dashboard-action-copy small");
    expect(dashboardPage).toContain("Recent Won / Lost Movement");
    expect(dashboardPage).toContain('title="Recent Won / Lost Movement"');
    expect(dashboardPage).toContain(
      "Closed deals with recorded won/lost timestamps.",
    );
    expect(dashboardPage).toContain(
      'href="/deals?status=WON&sortBy=updatedAt&sortDirection=desc"',
    );
    expect(dashboardPage).toContain(
      'href="/deals?status=LOST&sortBy=updatedAt&sortDirection=desc"',
    );
    expect(dashboardPage).toContain("ariaLabel: `Open deal ${deal.title}`");
    expect(dashboardPage).toContain('eyebrow="Sales Assistant"');
    expect(dashboardPage).toContain('title="Needs Attention"');
    expect(dashboardPage).toContain('titleId="needs-attention-title"');
    expect(dashboardPage).toContain("CompactTitleRow");
    expect(dashboardPage).toContain("EmptyState");
    expect(dashboardPage).toContain("empty-state-panel");
    expect(dashboardPage).toContain("description={item.reason}");
    expect(dashboardPage).toContain("title={");
    expect(dashboardPage).toContain(
      "const actionLabel = `${item.actionLabel} for ${item.title}`;",
    );
    expect(dashboardPage).toContain("attentionKindLabel(item.kind)");
    expect(dashboardPage).not.toContain("<p>{item.reason}</p>");
    expect(dashboardPage).toContain("title={");
    expect(dashboardPage).toContain('isCleanWorkspace ? "No follow-ups yet"');
    expect(dashboardPage).toContain('"Nothing urgent right now"');
    expect(dashboardPage).not.toContain(
      '<div className="empty-state empty-state-compact">',
    );
    expect(globalStyles).toContain(".needs-attention-item .panel-title-row");
    expect(globalStyles).toContain(".needs-attention-item .compact-title");
    expect(globalStyles).toContain(".content-grid > *");
    expect(globalStyles).toContain(".dashboard-action-count");
    expect(globalStyles).toContain("width: 42px");
    expect(globalStyles).toContain(".command-card strong");
    expect(globalStyles).toContain(".pipeline-summary div");
    expect(globalStyles).toContain("min-height: 82px");
    expect(globalStyles).not.toContain(".needs-attention-item h3");
    expect(dashboardPage).toContain("function DashboardCommandCard");
    expect(dashboardPage).toContain("function dashboardWorkQueueHref");
    expect(dashboardPage).toContain(
      "const workQueueHref = dashboardWorkQueueHref({ dueToday, overdue })",
    );
    expect(dashboardPage).toContain(
      'actionLabel={`Review ${needsAttentionCount} dashboard attention ${needsAttentionCount === 1 ? "item" : "items"}`}',
    );
    expect(dashboardPage).toContain(
      "actionLabel={`View open pipeline value of ${openPipelineValue}`}",
    );
    expect(dashboardPage).toContain(
      "actionLabel={`Open work queue with ${overdue} overdue and ${dueToday} due today activities`}",
    );
    expect(dashboardPage).toContain(
      'if (overdue > 0) return "/activities?status=open&due=overdue"',
    );
    expect(dashboardPage).toContain(
      'if (dueToday > 0) return "/activities?status=open&due=today"',
    );
    expect(dashboardPage).toContain("aria-label={actionLabel}");
    expect(dashboardPage).toContain("title={actionLabel}");
    expect(dashboardPage).toContain('tone?: "critical"');
    expect(dashboardPage).toContain("className={");
    expect(dashboardPage).toContain('tone === "critical"');
    expect(dashboardPage).toContain("command-card command-card-critical");
    expect(dashboardPage).toContain('label="Needs attention"');
    expect(dashboardPage).toContain('label="Open pipeline"');
    expect(dashboardPage).toContain('label="Today\'s work queue"');
    expect(dashboardPage).toContain('eyebrow="First run"');
    expect(dashboardPage).toContain('title="Set up your sales workspace"');
    expect(dashboardPage).toContain('titleId="first-run-title"');
    expect(dashboardPage).toContain("summary.recentClosedDeals");
    expect(dashboardPage).toContain(
      "Won and lost deal movement will appear here after deals are closed in Northstar.",
    );
    expect(dashboardPage).toContain(
      'const wonFilterLabel = "Show recently won deals"',
    );
    expect(dashboardPage).toContain(
      'const lostFilterLabel = "Show recently lost deals"',
    );
    expect(dashboardPage).toContain(
      'actionsLabel="Recent closed deal filters"',
    );
    expect(dashboardPage).toContain("aria-label={wonFilterLabel}");
    expect(dashboardPage).toContain("title={wonFilterLabel}");
    expect(dashboardPage).toContain("aria-label={lostFilterLabel}");
    expect(dashboardPage).toContain("title={lostFilterLabel}");
    expect(dashboardPage).toContain(
      'className="button-secondary button-compact"',
    );
    expect(dashboardPage).not.toContain(
      '<span className="table-row-actions">\n            <Link className="inline-link" href="/deals?status=WON&sortBy=updatedAt&sortDirection=desc">',
    );
    expect(globalStyles).toContain(".empty-state-panel");
    expect(dashboardPage).toContain("StatusBadge");
    expect(statusBadge).toContain("const statusSlug = statusLabel");
    expect(statusBadge).toContain('import { Badge } from "@/components/badge"');
    expect(statusBadge).toContain("const accessibleLabel = `Status: ${statusLabel}`");
    expect(statusBadge).toContain('.replace(/[^a-z0-9]+/g, "-")');
    expect(statusBadge).toContain('const statusClassName = `badge badge-${statusSlug || "default"}`');
    expect(statusBadge).toContain("<Badge className={statusClassName} label={accessibleLabel}>");
    expect(statusBadge).toContain("export function formatStatusBadgeLabel");
    expect(statusBadge).toContain("const statusLabel = formatStatusBadgeLabel(status)");
    expect(statusBadge).toContain("{statusLabel}");
    expect(statusBadge).toContain("return \"Unknown\"");
    expect(statusBadge).toContain("replace(/[_-]+/g, \" \")");
    expect(formatStatusBadgeLabel("OPEN")).toBe("Open");
    expect(formatStatusBadgeLabel("READY_FOR_REVIEW")).toBe("Ready for review");
    expect(formatStatusBadgeLabel(" in-progress ")).toBe("In progress");
    expect(formatStatusBadgeLabel("")).toBe("Unknown");
    expect(dashboardPage).toContain("table-primary-cell");
    expect(dashboardPage).toContain("<strong>{quote.number}</strong>");
    expect(dashboardPage).toContain('className="table-secondary-text"');
    expect(dashboardPage).toContain("formatDate(quote.createdAt)");
    expect(dashboardPage).toContain("<StatusBadge status={quote.status} />");
    expect(dashboardPage).toContain("ListRowActions");
    expect(dashboardPage).toContain("ActivityCompleteButton");
    expect(dashboardPage).toContain(
      "aria-label={`Edit priority activity ${activity.title}`}",
    );
    expect(dashboardPage).toContain(
      "title={`Edit priority activity ${activity.title}`}",
    );
    expect(dashboardPage).toContain(
      "const priorityActivityWorkspaceLabel = `Edit priority activity ${activity.title}`",
    );
    expect(dashboardPage).toContain(
      'className="activity-item activity-item-open"',
    );
    expect(dashboardPage).toContain(
      "aria-label={priorityActivityWorkspaceLabel}",
    );
    expect(dashboardPage).toContain("title={priorityActivityWorkspaceLabel}");
    expect(dashboardPage).toContain(
      "ariaLabel={`Mark priority activity ${activity.title} complete`}",
    );
    expect(dashboardPage).toContain("href={`/activities/${activity.id}/edit`}");
    expect(dashboardPage).toContain(
      "const priorityActivityActionsLabel = `${activity.title} priority activity actions`",
    );
    expect(dashboardPage).toContain("import { ActionGroup }");
    expect(dashboardPage).toContain('<ActionGroup');
    expect(dashboardPage).toContain('className="activity-actions"');
    expect(dashboardPage).toContain("label={priorityActivityActionsLabel}");
    expect(dashboardPage).toContain("import { TimelineMetaRow }");
    expect(dashboardPage).toContain(
      "ariaLabel={`${activity.title} priority activity metadata`}",
    );
    expect(dashboardPage).toContain('className="activity-row-header"');
    expect(dashboardPage).toContain('className="activity-title-group"');
    expect(dashboardPage).toContain('import { recordOwnerLabel } from "@/lib/record-owner-label"');
    expect(dashboardPage).toContain("recordOwnerLabel(activity.owner)");
    expect(dashboardPage).not.toContain("function ownerLabel");
    expect(recordOwnerLabel).toContain("export function recordOwnerLabel");
    expect(dashboardPage).toContain("Deal: {activity.deal.title}");
    expect(dashboardPage).toContain("Lead: {activity.lead.title}");
    expect(dashboardPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(dashboardPage).not.toContain("function formatPersonName");
    expect(dashboardPage).toContain(
      'Contact: {formatPersonName(activity.person) ?? "Unnamed contact"}',
    );
    expect(dashboardPage).toContain(
      "Organization: {activity.organization.name}",
    );
    expect(dashboardPage).toContain("InlineEmptyStateText");
    expect(dashboardPage).toContain("<InlineEmptyStateText>No linked CRM record</InlineEmptyStateText>");
    expect(dashboardPage).not.toContain('<span className="muted">None</span>');
    expect(inlineEmptyStateText).toContain("inline-empty-state-text");
    expect(dashboardPage).toContain("buildActivityFollowUpHref");
    expect(dashboardPage).toContain('related: { type: "deal", id: deal.id }');
    expect(dashboardPage).toContain('returnTo: "/dashboard"');
    expect(dashboardPage).toContain('label: "Open deal"');
    expect(dashboardPage).toContain('label: "Add activity"');
    expect(dashboardPage).toContain(
      "aria-label={`${quote.number} quote actions`}",
    );
    expect(dashboardPage).toContain('label: "Open quote"');
    expect(dashboardPage).toContain("ariaLabel: `Open quote ${quote.number}`");
    expect(dashboardPage).toContain(
      "ariaLabel: `Open deal for quote ${quote.number}`",
    );
    expect(dashboardPage).toContain(
      "href: `/deals/${quote.dealId}/quotes/${quote.id}`",
    );
    expect(dashboardPage).toContain("href: `/deals/${quote.dealId}`");
    expect(dashboardPage).toContain('className="table-actions-cell"');
    expect(dashboardPage).toContain(
      "aria-label={`${deal.title} active deal actions`}",
    );
    expect(dashboardPage).toContain(
      "aria-label={`${deal.title} recent closed deal actions`}",
    );
    expect(dashboardPage).toContain("<RelatedLinks");
    expect(dashboardPage).toContain(
      "ariaLabel={`${deal.title} related records`}",
    );
    expect(dashboardPage).toContain("organization={deal.organization}");
    expect(dashboardPage).toContain("person={deal.person}");
    expect(dashboardPage).toContain("ariaLabel: string");
    expect(dashboardPage).toContain(
      '<span aria-label={ariaLabel} className="deal-meta">',
    );
    expect(dashboardPage).toContain("Open overdue");
    expect(dashboardPage).toContain("Open upcoming");
    expect(dashboardPage).toContain("Completed activities");
    expect(dashboardPage).toContain("Completed recently");
    expect(dashboardPage).toContain(
      'href="/activities?status=open&due=overdue"',
    );
    expect(dashboardPage).toContain('href="/activities?status=open&due=today"');
    expect(dashboardPage).toContain(
      'href="/activities?status=open&due=upcoming"',
    );
    expect(dashboardPage).toContain('href="/activities?status=completed"');
    expect(dashboardPage).toContain(
      'href="/activities?status=completed&completed=recent"',
    );
    expect(dashboardPage).toContain("Pipeline By Stage");
    expect(dashboardPage).toContain("href={");
    expect(dashboardPage).toContain(
      "`/deals?status=OPEN&stageId=${stage.stageId}`",
    );
    expect(dashboardPage).toContain("as Route");
    expect(dashboardPage).toContain("Leads By Status");
    expect(dashboardPage).toContain(
      "href={`/leads?status=${lead.status}` as Route}",
    );
    expect(dashboardPage).toContain("<StatusBadge status={lead.status} />");
    expect(dashboardPage).toContain(
      'title="No pipeline stages are available yet"',
    );
    expect(dashboardPage).toContain(
      'description="Add stages to see open deal value by stage."',
    );
    expect(dashboardPage).toContain('title="No leads have been created yet"');
    expect(dashboardPage).toContain("Activity Snapshot");
    expect(dashboardPage).toContain("Recent Changes");
    expect(dashboardPage).toContain('title="No recent workspace changes"');
    expect(dashboardPage).toContain(
      "CRM updates, imports, lifecycle changes, and workspace activity will appear here as records change.",
    );
    expect(dashboardPage).not.toContain(
      '<p className="empty-copy">Recent workspace changes will appear here as CRM records are updated.</p>',
    );
    expect(dashboardPage).toContain("AuditEventList");
    expect(dashboardPage).toContain("showTarget");
    expect(dashboardPage).toContain("TableScroll");
    expect(tableScroll).toContain(
      'className={["table-scroll", className].filter(Boolean).join(" ")}',
    );
    expect(tableScroll).toContain('role="region"');
    expect(tableScroll).toContain("tabIndex={0}");
    expect(dashboardPage).toContain('className="table crm-list-table"');
    expect(dashboardPage).toContain('data-label="Deal"');
    expect(dashboardPage).toContain('data-label="Value"');
    expect(dashboardPage).toContain('data-label="Stage"');
    expect(dashboardPage).toContain('data-label="Related"');
    expect(dashboardPage).toContain('data-label="Actions"');
    expect(dashboardPage).toContain('data-label="Quote"');
    expect(dashboardPage).toContain('data-label="Status"');
    expect(dashboardPage).toContain('data-label="Total"');
    expect(dashboardPage).toContain('data-label="Open deals"');
    expect(dashboardPage).toContain('data-label="Open value"');
    expect(dashboardPage).toContain('data-label="Leads"');
    expect(dashboardPage).toContain('data-label="Closed"');
    expect(dashboardPage).toContain('data-label="Owner"');
    for (const tableLabel of [
      "Dashboard active deals table",
      "Dashboard recent quotes table",
      "Dashboard pipeline by stage table",
      "Dashboard leads by status table",
      "Dashboard recent won and lost movement table",
    ]) {
      expect(dashboardPage).toContain(`aria-label="${tableLabel}"`);
    }
    expect(dashboardPage).toContain("content-grid section-spaced");
    expect(dashboardPage).not.toContain('<div className="panel-title-row">');
    expect(dashboardPage).not.toContain('<h2 className="panel-title"');
    expect(dashboardPage).not.toContain("PipelineBoard");
  });

  it("renders recent changes through shared audit formatting instead of raw action strings", () => {
    expect(dashboardPage).toContain("<AuditEventList");
    expect(dashboardPage).toContain("entries={summary.recentChanges}");
    expect(dashboardPage).toContain('label="Recent workspace changes"');
    expect(auditEventList).toContain("formatAuditEvent(entry)");
    expect(auditEventList).toContain("<strong>{event.label}</strong>");
    expect(auditEventList).toContain("event.actorLabel");
    expect(dashboardPage).not.toContain("entry.action");
    expect(dashboardPage).not.toContain("deal.updated");
    expect(dashboardPage).not.toContain("note.created");
  });
});
