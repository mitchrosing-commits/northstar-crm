import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const signupActions = readFileSync(join(process.cwd(), "app/signup/actions.ts"), "utf8");
const signupForm = readFileSync(join(process.cwd(), "app/signup/signup-form.tsx"), "utf8");
const loginActions = readFileSync(join(process.cwd(), "app/login/actions.ts"), "utf8");
const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const pipelineService = readFileSync(join(process.cwd(), "lib/services/pipeline-service.ts"), "utf8");
const dashboardService = readFileSync(join(process.cwd(), "lib/services/dashboard-service.ts"), "utf8");
const dashboardPage = readFileSync(join(process.cwd(), "app/dashboard/page.tsx"), "utf8");
const pipelineBoard = readFileSync(join(process.cwd(), "components/pipeline-board.tsx"), "utf8");
const dealForm = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");
const leadForm = readFileSync(join(process.cwd(), "components/lead-form.tsx"), "utf8");
const formRelatedRecordCallout = readFileSync(join(process.cwd(), "components/form-related-record-callout.tsx"), "utf8");
const dealsPage = readFileSync(join(process.cwd(), "app/deals/page.tsx"), "utf8");
const contactsPage = readFileSync(join(process.cwd(), "app/contacts/page.tsx"), "utf8");
const organizationsPage = readFileSync(join(process.cwd(), "app/organizations/page.tsx"), "utf8");
const activitiesPage = readFileSync(join(process.cwd(), "app/activities/page.tsx"), "utf8");
const newActivitiesPage = readFileSync(join(process.cwd(), "app/activities/new/page.tsx"), "utf8");
const quoteDraftsPanel = readFileSync(join(process.cwd(), "components/quote-drafts-panel.tsx"), "utf8");

describe("first-run clean workspace experience", () => {
  it("keeps normal signup clean while provisioning only the workspace and default pipeline foundation", () => {
    expect(signupActions).toContain("signupWithEmailAndPassword({ email, name, password })");
    expect(signupActions).toContain("validateWorkspaceName(workspaceName)");
    expect(signupActions).toContain("createWorkspaceFromName(result.user.id, normalizedWorkspaceName)");
    expect(workspaceService).toContain("await ensureDefaultPipelineForWorkspace(workspace.id)");
    expect(pipelineService).toContain("export const defaultPipelineName = \"New Business\"");
    expect(pipelineService).toContain("{ name: \"Qualified\", probability: 20 }");
    expect(pipelineService).toContain("{ name: \"Discovery\", probability: 35 }");
    expect(pipelineService).toContain("{ name: \"Proposal\", probability: 60 }");
    expect(pipelineService).toContain("{ name: \"Negotiation\", probability: 80 }");
    expect(pipelineService).toContain("{ name: \"Closed\", probability: 100 }");

    const signupPath = [signupActions, workspaceService].join("\n");
    expect(signupPath).not.toContain("prisma.deal.create");
    expect(signupPath).not.toContain("prisma.person.create");
    expect(signupPath).not.toContain("prisma.organization.create");
    expect(signupPath).not.toContain("prisma.activity.create");
    expect(signupPath).not.toContain("prisma.note.create");
    expect(signupPath).not.toContain("prisma.quote.create");
    expect(signupPath).not.toContain("prisma.product.create");
    expect(signupPath).not.toContain("prisma.emailLog.create");
    expect(signupPath).not.toContain("prisma.emailTemplate.create");
    expect(signupPath).not.toContain("prisma.emailConnection.create");
    expect(signupPath).not.toContain("prisma.emailConnectionSecret.create");
    expect(signupPath).not.toContain("NDA Status");
    expect(signupPath).not.toContain("MSA Status");
    expect(signupPath).not.toContain("SOW Status");
  });

  it("preserves email-based signup and login identity", () => {
    expect(signupForm).toContain("name=\"email\"");
    expect(signupForm).toContain("type=\"email\"");
    expect(signupActions).toContain("const email = String(formData.get(\"email\") ?? \"\")");
    expect(signupActions).toContain("signupWithEmailAndPassword({ email, name, password })");
    expect(loginActions).toContain("const email = String(formData.get(\"email\") ?? \"\")");
    expect(loginActions).toContain("loginWithEmailAndPassword(email, password)");
  });

  it("shows first-run onboarding only for clean workspaces and keeps dashboard records visible", () => {
    expect(dashboardService).toContain("hasMeaningfulCrmData");
    expect(dashboardService).toContain("isCleanWorkspace: !hasMeaningfulCrmData");
    expect(dashboardService).toContain("prisma.deal.groupBy");
    expect(dashboardService).toContain("prisma.lead.count");
    expect(dashboardService).toContain("prisma.person.count");
    expect(dashboardService).toContain("prisma.organization.count");
    expect(dashboardService).toContain("prisma.activity.count");
    expect(dashboardService).toContain("prisma.quote.count");
    expect(dashboardService).toContain("prisma.product.count");
    expect(dashboardService).toContain("prisma.note.count");
    expect(dashboardService).toContain("where: { workspaceId: actor.workspaceId, ...activeWhere }");

    expect(dashboardPage).toContain("summary.onboarding.isCleanWorkspace ? <FirstRunChecklist /> : null");
    expect(dashboardPage).toContain("summary.recentOpenDeals.length > 0");
    expect(dashboardPage).toContain("summary.priorityActivities.length > 0");
    expect(dashboardPage).toContain("summary.recentQuotes.length > 0");
    expect(dashboardPage).toContain("Pipeline By Stage");
    expect(dashboardPage).toContain("Recent Changes");
  });

  it("renders a polished first-run checklist with useful CRM actions", () => {
    expect(dashboardPage).toContain("Set up your sales workspace");
    expect(dashboardPage).toContain("Your workspace is clean and ready.");
    expect(dashboardPage).toContain("Create or import contacts");
    expect(dashboardPage).toContain("href: \"/contacts/new\"");
    expect(dashboardPage).toContain("Add an organization");
    expect(dashboardPage).toContain("href: \"/organizations/new\"");
    expect(dashboardPage).toContain("Create your first deal");
    expect(dashboardPage).toContain("href: \"/deals/new\"");
    expect(dashboardPage).toContain("Schedule a follow-up activity");
    expect(dashboardPage).toContain("href: \"/activities/new\"");
    expect(dashboardPage).toContain("Connect Gmail or Google Workspace");
    expect(dashboardPage).toContain("href: \"/email\"");
    expect(dashboardPage).toContain("Invite a teammate");
    expect(dashboardPage).toContain("href: \"/settings\"");
    expect(dashboardPage).toContain("const actionLabel = `${step.action}: ${step.title}`");
    expect(dashboardPage).toContain("aria-label={actionLabel}");
    expect(dashboardPage).toContain("title={actionLabel}");
  });

  it("keeps fresh-workspace empty states product-facing and action-oriented", () => {
    const emptyStateSources = [
      dashboardPage,
      pipelineBoard,
      dealsPage,
      contactsPage,
      organizationsPage,
      activitiesPage,
      newActivitiesPage,
      quoteDraftsPanel
    ].join("\n");

    expect(pipelineBoard).toContain("Your stages are ready.");
    expect(pipelineBoard).toContain("Create your first deal to start moving opportunities through this board.");
    expect(pipelineBoard).toContain("href=\"/deals/new\"");
    expect(dealsPage).toContain("Create a deal or convert a lead to start tracking opportunities.");
    expect(contactsPage).toContain("Create a contact to start linking people to deals, activities, and organizations.");
    expect(organizationsPage).toContain("Create a company or account to group contacts, deals, activities, and notes.");
    expect(activitiesPage).toContain("No activities yet. Create a follow-up to plan the next call, email, meeting, or task.");
    expect(activitiesPage).toContain("href=\"/activities/new\"");
    expect(dashboardPage).toContain("title=\"No quotes yet\"");
    expect(dashboardPage).toContain("description=\"Quotes usually come after a deal has a customer conversation and line items to review.\"");
    expect(quoteDraftsPanel).toContain("title=\"No internal quote drafts yet\"");
    expect(quoteDraftsPanel).toContain("Create one after the deal has line items to review a frozen snapshot.");
    expect(emptyStateSources).not.toContain("run seed script");
    expect(emptyStateSources).not.toContain("Run the seed script");
  });

  it("removes first-user dead ends when forms have no related records yet", () => {
    const relatedRecordFormSources = [dealForm, leadForm, formRelatedRecordCallout].join("\n");

    expect(dealForm).toContain("Create a deal now, even if the buyer or company is not in Northstar yet.");
    expect(dealForm).toContain("No contacts yet - create deal without contact");
    expect(dealForm).toContain("No organizations yet - create deal without one");
    expect(dealForm).toContain("FormRelatedRecordCallout");

    expect(leadForm).toContain("Capture a possible opportunity before it is qualified.");
    expect(leadForm).toContain("No contacts yet - save lead without contact");
    expect(leadForm).toContain("No organizations yet - save lead without one");
    expect(leadForm).toContain("FormRelatedRecordCallout");
    expect(relatedRecordFormSources).toContain("Add a contact");
    expect(relatedRecordFormSources).toContain("Add an organization");
    expect(relatedRecordFormSources).toContain("Import contacts");

    expect(newActivitiesPage).toContain("Create something to follow up on");
    expect(newActivitiesPage).toContain("Activities need a related deal, contact, organization, or lead.");
    expect(newActivitiesPage).toContain("href={\"/deals/new\" as Route}");
    expect(newActivitiesPage).toContain("href={\"/contacts/new\" as Route}");
    expect(newActivitiesPage).toContain("href={\"/organizations/new\" as Route}");
    expect(newActivitiesPage).toContain("href={\"/leads/new\" as Route}");
    expect(newActivitiesPage).toContain('const addDealActionLabel = "Add a deal before creating an activity";');
    expect(newActivitiesPage).toContain('const addContactActionLabel = "Add a contact before creating an activity";');
    expect(newActivitiesPage).toContain('const addOrganizationActionLabel = "Add an organization before creating an activity";');
    expect(newActivitiesPage).toContain('const addLeadActionLabel = "Add a lead before creating an activity";');
    expect(newActivitiesPage).toContain("aria-label={addDealActionLabel}");
    expect(newActivitiesPage).toContain("title={addDealActionLabel}");
    expect(newActivitiesPage).toContain("aria-label={addContactActionLabel}");
    expect(newActivitiesPage).toContain("title={addContactActionLabel}");
    expect(newActivitiesPage).toContain("aria-label={addOrganizationActionLabel}");
    expect(newActivitiesPage).toContain("title={addOrganizationActionLabel}");
    expect(newActivitiesPage).toContain("aria-label={addLeadActionLabel}");
    expect(newActivitiesPage).toContain("title={addLeadActionLabel}");
  });
});
