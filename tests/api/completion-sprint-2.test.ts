import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const automationService = readFileSync(join(process.cwd(), "lib/services/automation-template-service.ts"), "utf8");
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const leadPage = readFileSync(join(process.cwd(), "app/leads/[leadId]/page.tsx"), "utf8");
const dealActions = readFileSync(join(process.cwd(), "app/deals/actions.ts"), "utf8");
const leadActions = readFileSync(join(process.cwd(), "app/leads/actions.ts"), "utf8");
const activitiesPage = readFileSync(join(process.cwd(), "app/activities/page.tsx"), "utf8");
const importExportPage = readFileSync(join(process.cwd(), "app/settings/import-export/page.tsx"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");

describe("rapid completion sprint 2 surfaces", () => {
  it("adds one-click automation templates that create activities without a broad rule builder", () => {
    expect(automationService).toContain("export async function createAutomationTemplateActivity");
    expect(automationService).toContain("lead-first-outreach");
    expect(automationService).toContain("deal-proposal-follow-up");
    expect(automationService).toContain("quote-follow-up");
    expect(automationService).toContain("contract-follow-up");
    expect(automationService).toContain("post-sale-handoff");
    expect(automationService).toContain("lost-reengagement");
    expect(automationService).toContain("const existing = await prisma.activity.findFirst");
    expect(automationService).toContain("created: false");
    expect(automationService).not.toContain("background");
    expect(automationService).not.toContain("ruleBuilder");
  });

  it("surfaces automation suggestions on deal and lead detail pages", () => {
    expect(dealActions).toContain("createDealAutomationActivityAction");
    expect(leadActions).toContain("createLeadAutomationActivityAction");
    expect(dealPage).toContain("DealAutomationTemplatesPanel");
    expect(dealPage).toContain("One-click next actions");
    expect(dealPage).toContain("Post-sale handoff");
    expect(dealPage).toContain("Future re-engagement");
    expect(leadPage).toContain("Suggested Automation");
    expect(leadPage).toContain("Lead first outreach");
    expect(leadPage).toContain("createLeadAutomationActivityAction");
  });

  it("adds a My Day agenda on Activities using existing activity data", () => {
    expect(activitiesPage).toContain("ActivityAgendaPanel");
    expect(activitiesPage).toContain("My Day Agenda");
    expect(activitiesPage).toContain("Overdue");
    expect(activitiesPage).toContain("Due today");
    expect(activitiesPage).toContain("Upcoming");
    expect(activitiesPage).toContain("Recently completed");
    expect(activitiesPage).toContain("showCompleteAction");
  });

  it("adds import samples and hosted admin readiness without exposing secret values", () => {
    expect(importExportPage).toContain("Sample CSV Templates");
    expect(importExportPage).toContain("Required:");
    expect(importExportPage).toContain("Deals");
    expect(importExportPage).toContain("title,pipeline,stage");
    expect(importExportPage).toContain("Organizations");
    expect(settingsPage).toContain("AdminReadinessPanel");
    expect(settingsPage).toContain("Admin Readiness Checklist");
    expect(settingsPage).toContain("Secret values are never shown here.");
    expect(settingsPage).toContain("APP_BASE_URL");
    expect(settingsPage).toContain("passwordResetEmailReadiness(process.env)");
    expect(settingsPage).toContain("Worker required");
    expect(settingsPage).toContain("npm run jobs:work");
    expect(settingsPage).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(settingsPage).not.toContain("process.env.GOOGLE_OAUTH_CLIENT_SECRET}");
  });
});
