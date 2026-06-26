import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { monthBounds, normalizeGoalCurrency, normalizeGoalTargetCents } from "@/lib/services/goal-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(join(process.cwd(), "prisma/migrations/20260625050000_goals_v1_targets/migration.sql"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/services/goal-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const reportsPage = readFileSync(join(process.cwd(), "app/reports/page.tsx"), "utf8");
const reportsActions = readFileSync(join(process.cwd(), "app/reports/actions.ts"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const goalsDesign = readFileSync(join(process.cwd(), "docs/goals-v1-design.md"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");

describe("Goals v1", () => {
  it("adds a workspace-scoped monthly won-revenue goal target model", () => {
    expect(schema).toContain("model Goal");
    expect(schema).toMatch(/goals\s+Goal\[\]/);
    expect(schema).toContain("enum GoalType");
    expect(schema).toContain("WON_REVENUE");
    expect(schema).toContain("@@unique([workspaceId, type, currency, periodStart])");
    expect(schema).toContain("@@index([workspaceId, type, periodStart])");
    expect(migration).toContain("CREATE TYPE \"GoalType\" AS ENUM ('WON_REVENUE')");
    expect(migration).toContain("CREATE TABLE \"Goal\"");
    expect(migration).toContain("CREATE UNIQUE INDEX \"Goal_workspaceId_type_currency_periodStart_key\"");
  });

  it("normalizes monthly period, currency, and positive target inputs", () => {
    expect(monthBounds("2030-03")).toEqual({
      periodStart: new Date("2030-03-01T00:00:00.000Z"),
      periodEnd: new Date("2030-04-01T00:00:00.000Z")
    });
    expect(monthBounds("2030-03-31T23:59:59.000Z")).toEqual({
      periodStart: new Date("2030-03-01T00:00:00.000Z"),
      periodEnd: new Date("2030-04-01T00:00:00.000Z")
    });
    expect(normalizeGoalCurrency(" usd ")).toBe("USD");
    expect(normalizeGoalTargetCents(1)).toBe(1);
    expect(() => monthBounds("2030-13")).toThrow(/valid month/);
    expect(() => normalizeGoalCurrency("US")).toThrow(/three-letter/);
    expect(() => normalizeGoalTargetCents(0)).toThrow(/positive/);
  });

  it("calculates progress from wonAt only and avoids UI/API surface changes", () => {
    expect(crmBarrel).toContain("export * from \"./goal-service\"");
    expect(service).toContain("export async function createOrUpdateMonthlyWonRevenueGoal");
    expect(service).toContain("export async function getMonthlyWonRevenueGoalProgress");
    expect(service).toContain("const wonRevenueGoalType: GoalType = \"WON_REVENUE\"");
    expect(service).toContain("status: DealStatus.WON");
    expect(service).toContain("wonAt: {");
    expect(service).toContain("gte: periodStart");
    expect(service).toContain("lt: periodEnd");
    expect(service).toContain("_sum: { valueCents: true }");
    expect(service).not.toContain("expectedCloseAt");
    expect(service).not.toContain("updatedAt");
    expect(service).not.toContain("createdAt");
  });

  it("adds a small table-first Reports UI using the goal service", () => {
    expect(reportsPage).toContain("getMonthlyWonRevenueGoalProgress(actor");
    expect(reportsPage).toContain("saveMonthlyWonRevenueGoalAction");
    expect(reportsPage).toContain("Goals v1");
    expect(reportsPage).toContain("Workspace-level monthly won-revenue goal only");
    expect(reportsPage).toContain("Progress uses same-currency WON deals whose actual won timestamp (wonAt)");
    expect(reportsPage).toContain("not expected close date");
    expect(reportsPage).toContain("Legacy won deals without wonAt are excluded");
    expect(reportsPage).toContain("Same currency only");
    expect(reportsPage).toContain("no FX conversion is applied");
    expect(reportsPage).toContain("aria-label=\"Goals v1 monthly won revenue table\"");
    expect(reportsPage).toContain("No monthly target saved yet");
    expect(reportsPage).not.toContain("Chart");
  });

  it("validates and saves monthly goals through a focused Reports action", () => {
    expect(reportsActions).toContain("export async function saveMonthlyWonRevenueGoalAction");
    expect(reportsActions).toContain("createOrUpdateMonthlyWonRevenueGoal(actor");
    expect(reportsActions).toContain("parseMoneyToCents(targetAmount)");
    expect(reportsActions).toContain("goalCurrency: currency.trim().toUpperCase()");
    expect(reportsActions).toContain("Goal target must be a positive currency amount.");
    expect(reportsActions).toContain("revalidatePath(\"/reports\")");
    expect(reportsActions).toContain("redirect(`/reports?");
  });

  it("documents the Goals v1 UI MVP and remaining boundaries", () => {
    expect(goalsDesign).toContain("workspace-level monthly won-revenue goal targets exist behind service functions");
    expect(goalsDesign).toContain("Reports UI MVP implemented");
    expect(currentStatus).toContain("Goals v1 UI MVP");
    expect(currentStatus).toContain("No charts, dashboard widgets, owner/user/team goals, quarterly goals, activity goals, or FX conversion");
    expect(routeMap).toContain("Goals v1 monthly won-revenue UI");
  });
});
