import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const dashboardService = readFileSync(join(process.cwd(), "lib/services/dashboard-service.ts"), "utf8");
const dashboardPage = readFileSync(join(process.cwd(), "app/dashboard/page.tsx"), "utf8");
const auditEventList = readFileSync(join(process.cwd(), "components/audit-event-list.tsx"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");

describe("dashboard summary behavior", () => {
  it("adds a workspace-scoped dashboard summary service", () => {
    expect(dashboardService).toContain("export async function getDashboardSummary");
    expect(dashboardService).toContain("ensureWorkspaceAccess(actor)");
    expect(dashboardService).toContain("workspaceId: actor.workspaceId");
    expect(dashboardService).toContain("prisma.deal.groupBy");
    expect(dashboardService).toContain("prisma.pipelineStage.findMany");
    expect(dashboardService).toContain("prisma.lead.groupBy");
    expect(dashboardService).toContain("prisma.activity.count");
    expect(dashboardService).toContain("prisma.auditLog.findMany");
    expect(dashboardService).toContain("actor: { select: userDisplaySelect }");
    expect(dashboardService).not.toContain("include: { actor: true }");
    expect(crmBarrel).toContain("export * from \"./dashboard-service\"");
  });

  it("calculates the requested dashboard buckets", () => {
    expect(dashboardService).toContain("openPipelineValueCents");
    expect(dashboardService).toContain("openDealsCount");
    expect(dashboardService).toContain("wonDealsCount");
    expect(dashboardService).toContain("lostDealsCount");
    expect(dashboardService).toContain("activeLeadsCount");
    expect(dashboardService).toContain("overdueActivitiesCount");
    expect(dashboardService).toContain("dueTodayActivitiesCount");
    expect(dashboardService).toContain("pipelineBreakdown");
    expect(dashboardService).toContain("leadBreakdown");
    expect(dashboardService).toContain("activitySnapshot");
    expect(dashboardService).toContain("recentChanges");
  });

  it("renders the dashboard as a read-only sales overview", () => {
    expect(dashboardPage).toContain("getDashboardSummary(actor)");
    expect(dashboardPage).toContain("Open pipeline value");
    expect(dashboardPage).toContain("Open deals");
    expect(dashboardPage).toContain("Won deals");
    expect(dashboardPage).toContain("Lost deals");
    expect(dashboardPage).toContain("Active leads");
    expect(dashboardPage).toContain("Open overdue activities");
    expect(dashboardPage).toContain("Open due today");
    expect(dashboardPage).toContain("href=\"/deals?status=OPEN\"");
    expect(dashboardPage).toContain("href=\"/deals?status=WON\"");
    expect(dashboardPage).toContain("href=\"/activities?status=open&due=overdue\"");
    expect(dashboardPage).toContain("stat-card-link");
    expect(dashboardPage).toContain("Open overdue");
    expect(dashboardPage).toContain("Open upcoming");
    expect(dashboardPage).toContain("Completed activities");
    expect(dashboardPage).toContain("Pipeline By Stage");
    expect(dashboardPage).toContain("Leads By Status");
    expect(dashboardPage).toContain("No pipeline stages are available yet. Add stages to see open deal value by stage.");
    expect(dashboardPage).toContain("No leads have been created yet.");
    expect(dashboardPage).toContain("Activity Snapshot");
    expect(dashboardPage).toContain("Recent Changes");
    expect(dashboardPage).toContain("Recent workspace changes will appear here as CRM records are updated.");
    expect(dashboardPage).toContain("AuditEventList");
    expect(dashboardPage).toContain("showTarget");
    expect(dashboardPage).not.toContain("PipelineBoard");
  });

  it("renders recent changes through shared audit formatting instead of raw action strings", () => {
    expect(dashboardPage).toContain("<AuditEventList entries={summary.recentChanges}");
    expect(dashboardPage).toContain("label=\"Recent workspace changes\"");
    expect(auditEventList).toContain("formatAuditEvent(entry)");
    expect(auditEventList).toContain("<strong>{event.label}</strong>");
    expect(auditEventList).toContain("event.actorLabel");
    expect(dashboardPage).not.toContain("entry.action");
    expect(dashboardPage).not.toContain("deal.updated");
    expect(dashboardPage).not.toContain("note.created");
  });
});
