import { expect, type BrowserContext, type Locator, type Page, test } from "@playwright/test";
import { ActivityType, MeetingIntakeSourceType, MeetingIntakeStatus, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { createLocalSession, revokeLocalSessionToken } from "@/lib/auth/local-auth";
import { hashPassword } from "@/lib/auth/password";
import { hashPasswordResetToken } from "@/lib/auth/password-reset";
import { localSessionCookieName, serializeLocalSessionCookieValue } from "@/lib/auth/session";
import { createMeetingIntake } from "@/lib/services/meeting-intelligence-service";
import { generatePublicQuoteToken } from "@/lib/services/quote-service";
import { generatePublicSchedulerToken } from "@/lib/services/scheduler-service";
import { generatePublicWebFormToken } from "@/lib/services/web-form-service";

const prisma = new PrismaClient();
const browserBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const activeWorkspaceCookieName = "northstar_workspace";
const smokeIds = {
  dealLineItemId: "",
  productId: "",
  publicLinkId: "",
  quoteId: "",
  quoteItemId: "",
  schedulerActivityId: "",
  schedulerLinkId: "",
  webFormId: "",
  webFormLeadId: ""
};
const browserFlowSuffixes = new Set<string>();
const browserAuthSmokeUserIds = new Set<string>();
const browserAuthSmokeInvitationIds = new Set<string>();
const browserMeetingIntakeIds = new Set<string>();

let smokeQuote: { dealId: string; quoteId: string; token: string };
let smokeAuth: { actorUserId: string; token: string; sessionCookieValue: string; workspaceId: string; expiresAt: Date };
let communicationDealPath: string;

test.describe("Northstar CRM browser smoke", () => {
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    smokeAuth = await createBrowserSmokeAuth();
    smokeQuote = await createSmokeQuote();
    communicationDealPath = await communicationDealDetailPath();
  });

  test.beforeEach(async ({ context }) => {
    await authenticateBrowserContext(context);
  });

  test.afterAll(async () => {
    if (smokeAuth?.token) await revokeLocalSessionToken(smokeAuth.token);
    await cleanupSmokeScheduler();
    await cleanupSmokeWebForm();
    await cleanupSmokeQuote();
    await cleanupBrowserMeetingIntakes();
    await cleanupBrowserFlowRecords();
    await cleanupBrowserAuthSmokeUsers();
    await prisma.$disconnect();
  });

  test("renders key seeded CRM pages and detail views", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const dealHref = await firstDetailHref(page, "/deals", "/deals/");
    const leadHref = await firstDetailHref(page, "/leads", "/leads/");
    const contactHref = await firstDetailHref(page, "/contacts", "/contacts/");
    const organizationHref = await firstDetailHref(page, "/organizations", "/organizations/");
    const activityEditHref = await firstActivityEditHref(page);
    const contactEditHref = `${contactHref}/edit`;
    const dealEditHref = `${dealHref}/edit`;
    const leadEditHref = `${leadHref}/edit`;
    const organizationEditHref = `${organizationHref}/edit`;

    await page.context().clearCookies();
    await expectPageReady(page, "/login", { requireAppShell: false });
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
    await expectPageReady(page, "/signup", { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();
    await expectPageReady(page, "/forgot-password", { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
    await expectPageReady(page, "/reset-password?token=invalid-smoke-token", { requireAppShell: false });
    await expect(page.getByText("This password reset link is invalid or expired.")).toBeVisible();
    await authenticateBrowserContext(page.context());

    for (const path of [
      "/",
      "/dashboard",
      "/onboarding",
      "/assistant",
      "/pipeline",
      "/deals",
      "/deals/new",
      dealHref,
      dealEditHref,
      communicationDealPath,
      "/leads",
      "/leads/new",
      leadHref,
      leadEditHref,
      "/meeting-intelligence",
      "/contacts",
      "/contacts/new",
      contactHref,
      contactEditHref,
      "/organizations",
      "/organizations/new",
      organizationHref,
      organizationEditHref,
      "/activities",
      "/activities/new",
      activityEditHref,
      "/email",
      "/products",
      "/reports",
      "/search?q=orbit",
      "/custom-fields",
      "/settings",
      "/settings/import-export",
      "/settings/developer-api"
    ]) {
      await expectPageReady(page, path);
      if (path === dealHref || path === communicationDealPath) {
        await expectRecordSectionNav(page, ["#overview", "#ai-record-brief", "#quotes", "#custom-fields", "#timeline"], "#quotes");
        await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Log Manual Email" })).toBeVisible();
        await expect(page.locator(".badge").getByText("Manual", { exact: true })).toBeVisible();
      }
      if (path === leadHref) {
        await expectRecordSectionNav(page, ["#overview", "#ai-record-brief", "#convert-lead", "#custom-fields", "#timeline"], "#convert-lead");
      }
      if (path === contactHref) {
        await expectRecordSectionNav(page, ["#profile", "#ai-record-brief", "#relationship-brief", "#notes", "#custom-fields"], "#relationship-brief");
        await expect(page.getByRole("heading", { name: "Relationship Context" })).toBeVisible();
      }
      if (path === organizationHref) {
        await expectRecordSectionNav(page, ["#overview", "#ai-record-brief", "#related-people", "#related-deals", "#custom-fields"], "#related-people");
      }
      if (path === communicationDealPath) {
        await expect(page.getByText("Quote shared for manager training package")).toBeVisible();
        await expect(page.getByText("Logged outbound email")).toBeVisible();
        const contractWorkflow = page.locator(".contract-workflow-panel");
        await expect(contractWorkflow.getByText("Contract management")).toBeVisible();
        await expect(contractWorkflow.locator(".contract-step-label").filter({ hasText: /^NDA$/ })).toBeVisible();
        await expect(contractWorkflow.locator(".contract-step-label").filter({ hasText: /^MSA$/ })).toBeVisible();
        await expect(contractWorkflow.locator(".contract-step-label").filter({ hasText: /^SOW$/ })).toBeVisible();
        await expect(contractWorkflow.locator(".contract-status-chip").getByText("Signed", { exact: true })).toBeVisible();
        await expect(contractWorkflow.locator(".contract-status-chip").getByText("Sent", { exact: true })).toBeVisible();
        await expect(contractWorkflow.locator(".contract-status-chip").getByText("In progress", { exact: true })).toBeVisible();
      }
      if (path === "/dashboard") {
        await expectSidebarLabelsReadable(page, path);
        await expect(page.getByRole("heading", { name: "Active Deals" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Priority Activities" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Recent Quotes" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Commercial Toolkit" })).toBeVisible();
        await expect(page.getByRole("link", { name: /Products and services/ })).toBeVisible();
        const dashboardDealHref = await firstHref(page, "/deals/");
        expect(dashboardDealHref, "Expected dashboard to include a deal detail link").toBeTruthy();
        const dashboardQuoteHref = await firstQuoteHref(page);
        expect(dashboardQuoteHref, "Expected dashboard to include a quote detail link").toBeTruthy();
        const settingsShortcut = page.locator('a.sidebar-settings-link[href="/settings"]');
        expect(await settingsShortcut.count(), "Expected one persistent Settings shortcut in the app shell").toBe(1);
        await expect(settingsShortcut, "Expected Settings shortcut to be visible in the app shell").toBeVisible();
        await expectSettingsShortcutNavigation(page, settingsShortcut);
      }
      if (path === "/onboarding") {
        await expect(page.getByRole("heading", { name: "First-Run AI-Guided Onboarding" })).toBeVisible();
        await expect(page.getByText("Personalize Your AI Guide")).toBeVisible();
        await expect(page.getByText("Stella", { exact: true })).toBeVisible();
        await expect(page.getByText("Nova", { exact: true })).toBeVisible();
        await expect(page.getByText("Warm and helpful")).toBeVisible();
        await expect(page.getByText("Future, not yet available")).toBeVisible();
      }
      if (path === "/assistant") {
        await expect(page.getByRole("link", { name: "Current section: Assistant" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Assistant" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Chat with Stella" })).toBeVisible();
        await expect(page.getByLabel("Suggested Assistant prompts")).toBeVisible();
        await expect(page.getByRole("textbox", { name: /^Question or command\b/ })).toBeVisible();
        await expect(page.getByRole("button", { name: "Ask" })).toBeVisible();
        await expect(page.getByText("draft safe actions for review")).toBeVisible();
      }
      if (path === "/pipeline") {
        const contractSummaries = page.locator(".contract-status-summary");
        expect(await contractSummaries.count(), "Expected pipeline cards to include contract summaries").toBeGreaterThan(0);
        await expect(page.getByText("NDA").first()).toBeVisible();
        await expect(page.getByText("MSA").first()).toBeVisible();
        await expect(page.getByText("SOW").first()).toBeVisible();
      }
      if (path === "/deals/new") {
        await expect(page.getByRole("heading", { name: "New deal" })).toBeVisible();
        await expect(page.getByLabel("Title")).toBeVisible();
      }
      if (path === "/contacts/new") {
        await expect(page.getByRole("heading", { name: "New contact" })).toBeVisible();
        await expect(page.getByLabel("Name")).toBeVisible();
      }
      if (path === "/organizations/new") {
        await expect(page.getByRole("heading", { name: "New organization" })).toBeVisible();
        await expect(page.getByLabel("Name")).toBeVisible();
      }
      if (path === "/leads/new") {
        await expect(page.getByRole("heading", { name: "New lead" })).toBeVisible();
        await expect(page.getByLabel("Title")).toBeVisible();
      }
      if (path === "/activities/new") {
        await expect(page.getByRole("heading", { name: "New activity" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Create Follow-up" })).toBeVisible();
      }
      if (path === "/deals") {
        await expect(page.getByRole("heading", { name: "Saved deal views" })).toBeVisible();
      }
      if (path === "/leads") {
        await expect(page.getByRole("heading", { name: "Saved lead views" })).toBeVisible();
      }
      if (path === "/contacts") {
        await expect(page.getByRole("heading", { name: "Saved contact views" })).toBeVisible();
      }
      if (path === "/organizations") {
        await expect(page.getByRole("heading", { name: "Saved organization views" })).toBeVisible();
      }
      if (path === "/activities") {
        await expect(page.getByRole("heading", { name: "Quick activity links" })).toBeVisible();
        await expect(page.getByRole("link", { name: "My open" })).toBeVisible();
      }
      if (path === "/meeting-intelligence") {
        await expect(page.getByRole("heading", { name: "Meeting Intelligence" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "New intake" })).toBeVisible();
        await expect(page.getByLabel("Source type")).toBeVisible();
        await expect(page.getByLabel("Meeting notes or transcript")).toBeVisible();
        await expect(page.getByLabel("Meeting Intelligence upload capability guidance")).toBeVisible();
        await expect(page.getByText("Local extraction")).toBeVisible();
        await expect(page.getByText("Direct and multipart upload")).toBeVisible();
        await expect(page.getByText("Review-first apply")).toBeVisible();
        await expect(page.getByRole("button", { name: "Analyze intake" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Recent intakes" })).toBeVisible();
      }
      if (path === "/email") {
        await expect(page.getByRole("link", { name: "Current section: Inbox" })).toBeVisible();
        await expect(page.getByRole("heading", { name: /Inbox|Connect Gmail or Google Workspace/ })).toBeVisible();
        await expect(page.getByText(/Bring your work inbox into Northstar|Showing latest .* synced threads/)).toBeVisible();
        const advancedDiagnostics = page.locator("details.email-advanced-diagnostics").first();
        if ((await advancedDiagnostics.count()) > 0) {
          await expect(advancedDiagnostics).toBeVisible();
          await advancedDiagnostics.locator("summary").click();
          await expect(page.getByLabel("Gmail inbox sync progress")).toBeVisible();
        }
        const overflowingProviderCards = await page.locator(".provider-card").evaluateAll((cards) =>
          cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length
        );
        expect(overflowingProviderCards, "Expected provider card text and controls to stay inside their cards").toBe(0);
      }
      if (path === "/products") {
        await expect(page.getByRole("link", { name: "Current section: Products" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "How Products Feed Quotes" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Product Catalog" })).toBeVisible();
        await expect(page.getByText("products, services, packages, and reusable pricing your company sells")).toBeVisible();
        await expect(page.getByText("Your sellable catalog for building deal scope, quote line items, and reusable pricing.")).toBeVisible();
        expect(await page.locator(".product-catalog-card").count(), "Expected seeded products to render as cards").toBeGreaterThan(0);
        const overflowingProductCards = await page.locator(".product-catalog-card").evaluateAll((cards) =>
          cards.filter((card) => card.scrollWidth > card.clientWidth + 1).length
        );
        expect(overflowingProductCards, "Expected product card text and edit controls to stay inside their cards").toBe(0);
      }
      if (path === "/settings") {
        await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();
        await expect(page.locator("#account-display-name")).toBeVisible();
        await expect(page.locator("#account-email")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Email Connections" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Gmail / Google Workspace" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Microsoft 365 / Outlook" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "IMAP / SMTP" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Open developer API surface" })).toBeVisible();
        expect(await page.getByText("Not configured").count()).toBeGreaterThanOrEqual(1);
        await expect(page.getByRole("button", { name: "Planned" })).toBeDisabled();
      }
      if (path === "/settings/import-export") {
        await expect(page.getByRole("heading", { name: "Deals Import Preview" })).toBeVisible();
        await expect(page.getByLabel("Deals CSV")).toBeVisible();
        const workspaceId = await demoWorkspaceId();
        for (const resource of ["deals", "contacts", "organizations", "leads", "activities", "products", "quotes"]) {
          const exportResponse = await page.context().request.get(`/api/v1/workspaces/${workspaceId}/exports/${resource}`);
          expect(exportResponse.ok(), `Expected ${resource} export to return ok`).toBeTruthy();
          expect(exportResponse.headers()["content-type"]).toContain("text/csv");
          expect(exportResponse.headers()["cache-control"]).toContain("private, no-store");
          expect(exportResponse.headers()["x-content-type-options"]).toBe("nosniff");
          const csv = await exportResponse.text();
          expect(csv).toContain("createdAt");
          expect(csv.split("\n").length, `Expected ${resource} export to include seeded rows`).toBeGreaterThan(1);
        }
      }
      if (path === "/settings/developer-api") {
        await expect(page.getByRole("heading", { name: "Developer / API" })).toBeVisible();
        await expect(page.getByText("/api/v1/workspaces/")).toBeVisible();
        await expect(page.getByText("docs/openapi.yaml")).toBeVisible();
        await expect(page.getByText("docs/api-route-map.md")).toBeVisible();
        await expect(page.getByRole("heading", { name: "API Keys" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Webhooks" })).toBeVisible();
        await expect(page.getByText("CSV exports are REST endpoints")).toBeVisible();
        await expect(page.getByRole("button", { name: "API Keys controls are planned and not yet available" })).toBeDisabled();
        await expect(page.getByRole("button", { name: /controls are planned and not yet available/ })).toHaveCount(3);
      }
      if (path === "/reports") {
        await expect(page.getByRole("heading", { name: "Goals v1" })).toBeVisible();
        await expect(page.getByText("not expected close date")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Forecasting v1" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Activity Status Summary" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Quote Status Summary" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Top Open Deals" })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Top Organizations" })).toBeVisible();
        await expect(page.getByRole("link", { name: "View open deals from reports" })).toHaveCount(1);
        await expect(page.getByRole("link", { name: "View top open deals from reports" })).toBeVisible();
      }
    }
  });

  test("renders a ready Meeting Intelligence review draft", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const intake = await createMeetingIntake(
      { actorUserId: smokeAuth.actorUserId, workspaceId: smokeAuth.workspaceId },
      {
        contextText: "Meeting date: 2030-05-01",
        hints: { dealId: smokeQuote.dealId },
        originalFilename: `browser-review-${uniqueSmokeSuffix()}.txt`,
        text: [
          "Meeting date: 2030-05-01",
          "The smoke quote deal needs a pricing recap and implementation plan.",
          "Action: send implementation recap by 2030-05-04."
        ].join("\n")
      }
    );
    browserMeetingIntakeIds.add(intake.id);
    expect(intake.status).toBe("READY_FOR_REVIEW");

    await expectPageReady(page, `/meeting-intelligence/${intake.id}`);
    await expect(page.getByRole("heading", { name: "Review Intake" })).toBeVisible();
    await expect(page.getByLabel("Status: Ready for review")).toBeVisible();
    await expect(page.getByLabel("Meeting Intelligence review summary")).toBeVisible();
    await expect(page.getByText("Editable proposals only until you apply.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meeting Log" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Matches and Warnings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Proposed Notes" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Follow-Ups" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Normalized Markdown" })).toBeVisible();
    await expect(page.getByText("Review-first safety").first()).toBeVisible();
    await expect(page.getByText("Nothing is written to notes, activities, associations, or Relationship Memory fields")).toBeVisible();
    await expect(page.getByText("Evidence:").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply reviewed Meeting Intelligence updates" })).toBeVisible();
  });

  test("renders Relationship Memory guidance, history filters, and source details", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const browserFlowSuffix = registerBrowserFlowSuffix();
    const contact = await createRelationshipBriefSmokeContact(browserFlowSuffix);
    const auditCountBefore = await prisma.auditLog.count({
      where: { action: "person.updated", entityId: contact.id, entityType: "Person", workspaceId: smokeAuth.workspaceId }
    });

    await expectPageReady(page, contact.path);
    const panel = page.locator("#relationship-brief");
    await expect(panel.getByRole("heading", { exact: true, name: "Relationship Memory" })).toBeVisible();
    await expect(panel.getByRole("button", { name: /Edit relationship memory for/ })).toBeVisible();
    await expect(panel.getByText("Rockies fan; prefers implementation stories.")).toBeVisible();

    const usageGuidance = panel.locator(".relationship-brief-usage-details");
    await usageGuidance.getByText("Usage guidance").click();
    const usageBadges = usageGuidance.locator(".badge");
    await expect(usageBadges.getByText("Safe personalization", { exact: true })).toBeVisible();
    await expect(usageBadges.getByText("Use for tone", { exact: true })).toBeVisible();
    await expect(usageBadges.getByText("Use cautiously", { exact: true })).toBeVisible();
    await expect(usageBadges.getByText("Internal only", { exact: true })).toBeVisible();
    await expect(usageBadges.getByText("Do not mention directly", { exact: true }).first()).toBeVisible();

    await expect(panel.getByRole("heading", { name: "Source and Change History" })).toBeVisible();
    await expect(panel.locator(".relationship-brief-history-source-filter").getByText("Source", { exact: true })).toBeVisible();
    const fieldFilter = panel.locator(".relationship-brief-history-field-filter select");
    await expect(fieldFilter).toBeVisible();
    await fieldFilter.selectOption({ label: "Communication style" });
    await expect(panel.locator(".relationship-brief-change-card").filter({ hasText: "Communication style" })).toBeVisible();

    await panel.getByRole("button", { name: "Manual" }).click();
    await expect(panel.getByText("No Relationship Memory changes match these filters.")).toBeVisible();
    await panel.getByRole("button", { name: "Meeting Intelligence" }).click();
    const changeCard = panel.locator(".relationship-brief-change-card").filter({ hasText: "Communication style" }).first();
    await expect(changeCard).toBeVisible();

    await changeCard.getByText("View source details").click();
    await expect(changeCard.getByText("Review-first Meeting Intelligence provenance")).toBeVisible();
    await expect(changeCard.getByText("Browser Relationship Brief review", { exact: true })).toBeVisible();
    await expect(changeCard.getByText("Accepted reviewed facts")).toBeVisible();
    await expect(changeCard.getByText("Prefers concise morning email summaries.", { exact: true }).first()).toBeVisible();

    const auditCountAfter = await prisma.auditLog.count({
      where: { action: "person.updated", entityId: contact.id, entityType: "Person", workspaceId: smokeAuth.workspaceId }
    });
    expect(auditCountAfter, "Opening Relationship Memory guidance and source details should not mutate CRM history").toBe(auditCountBefore);
  });

  test("renders a read-only Meeting Prep Brief from activity and linked record detail pages", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const suffix = registerBrowserFlowSuffix();
    const activityTitle = `Browser Flow Meeting Prep ${suffix}`;
    const priorTitle = `Browser Flow Prior Meeting ${suffix}`;
    const noteBody = `Browser Flow Meeting Prep note ${suffix}: customer wants quote timing and implementation risks covered.`;
    const linkedRecords = await meetingPrepSmokeLinkedRecords(suffix);
    const linkedContact = await prisma.person.findUniqueOrThrow({
      where: { id: linkedRecords.personId },
      select: { email: true }
    });
    const meeting = await prisma.activity.create({
      data: {
        description: linkedContact.email ? `Attendees: ${linkedContact.email}` : "Attendees: Browser Meeting Prep contact",
        dealId: smokeQuote.dealId,
        dueAt: new Date("2030-08-15T16:00:00.000Z"),
        ownerId: smokeAuth.actorUserId,
        organizationId: linkedRecords.organizationId,
        personId: linkedRecords.personId,
        title: activityTitle,
        type: ActivityType.MEETING,
        workspaceId: smokeAuth.workspaceId
      }
    });
    await prisma.note.create({
      data: {
        authorId: smokeAuth.actorUserId,
        body: noteBody,
        dealId: smokeQuote.dealId,
        workspaceId: smokeAuth.workspaceId
      }
    });
    const priorMeeting = await prisma.activity.create({
      data: {
        completedAt: new Date("2030-07-01T16:00:00.000Z"),
        dealId: smokeQuote.dealId,
        ownerId: smokeAuth.actorUserId,
        title: priorTitle,
        type: ActivityType.MEETING,
        workspaceId: smokeAuth.workspaceId
      }
    });
    const intake = await prisma.meetingIntake.create({
      data: {
        proposedChangesJson: {
          markdown: "RAW TRANSCRIPT should stay out of the prep card.",
          matchedObjects: [],
          meetingActivity: null,
          nextStepActivities: [],
          notes: [],
          relationshipBriefUpdates: [],
          summary: `Prior Meeting Intelligence ${suffix} confirmed implementation timing is the main discussion point.`,
          unmatchedEntities: [],
          warnings: []
        },
        sourceType: MeetingIntakeSourceType.TEXT_FILE,
        status: MeetingIntakeStatus.APPLIED,
        workspaceId: smokeAuth.workspaceId
      }
    });
    browserMeetingIntakeIds.add(intake.id);
    await prisma.meetingActivityAssociation.create({
      data: {
        activityId: priorMeeting.id,
        dealId: smokeQuote.dealId,
        meetingIntakeId: intake.id,
        workspaceId: smokeAuth.workspaceId
      }
    });

    await expectPageReady(page, `/activities/${meeting.id}/edit`);
    const activityBrief = page.locator("#meeting-prep-brief");
    await expect(activityBrief.getByRole("heading", { name: activityTitle })).toBeVisible();
    await expect(activityBrief.getByRole("heading", { name: "Attendee Confidence" })).toBeVisible();
    await expect(activityBrief.getByText("Matched to one CRM contact").first()).toBeVisible();
    await expect(activityBrief.getByText("Linked activity person")).toBeVisible();
    if (linkedContact.email) await expect(activityBrief.getByText("Exact email match")).toBeVisible();
    await expect(activityBrief.getByRole("link", { name: "Open matched contact" }).first()).toBeVisible();
    await expect(activityBrief.getByRole("link", { name: "Search contacts" }).first()).toHaveAttribute("href", /\/contacts\?q=/);
    await expect(activityBrief.getByRole("link", { name: "Search organizations" }).first()).toHaveAttribute("href", /\/organizations\?q=/);
    await expect(activityBrief.getByRole("link", { name: "Search deals" }).first()).toHaveAttribute("href", /\/deals\?q=/);
    await expect(activityBrief.getByRole("link", { name: "Open activity" }).first()).toHaveAttribute("href", `/activities/${meeting.id}/edit`);
    await expect(activityBrief.getByRole("heading", { name: "Active Deal Context" })).toBeVisible();
    await expect(activityBrief.getByRole("heading", { name: "Prior Meeting Intelligence" })).toBeVisible();
    await expect(activityBrief.getByText(`Prior Meeting Intelligence ${suffix}`)).toBeVisible();
    await expect(activityBrief.getByRole("heading", { name: "Suggested Topics" })).toBeVisible();
    await expect(activityBrief.getByText("This brief does not create notes, activities, associations, quotes, or Relationship Memory updates.")).toBeVisible();
    await expect(activityBrief.getByText("RAW TRANSCRIPT")).toHaveCount(0);

    for (const recordPath of [
      `/contacts/${linkedRecords.personId}`,
      `/organizations/${linkedRecords.organizationId}`,
      `/deals/${smokeQuote.dealId}`
    ]) {
      await expectPageReady(page, recordPath);
      await expect(page.locator('a[href="#meeting-prep-brief"]')).toBeVisible();
      await expect(page.locator("#meeting-prep-brief").getByRole("heading", { name: activityTitle })).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 860 });
    await expectPageReady(page, `/activities/${meeting.id}/edit`);
    const attendeeNameBox = await page.locator(".meeting-prep-attendee-main strong").first().boundingBox();
    expect(attendeeNameBox?.width ?? 0).toBeGreaterThan(80);
    const attendeeWordBreak = await page.locator(".meeting-prep-attendee-main strong").first().evaluate((node) => {
      const styles = window.getComputedStyle(node);
      return { overflowWrap: styles.overflowWrap, wordBreak: styles.wordBreak };
    });
    expect(attendeeWordBreak.wordBreak).not.toBe("break-all");
  });

  test("creates linked CRM records and completes a follow-up from the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const browserFlowSuffix = registerBrowserFlowSuffix();
    const organizationName = `Browser Flow Organization ${browserFlowSuffix}`;
    const contactName = `Browser Flow Contact ${browserFlowSuffix}`;
    const dealTitle = `Browser Flow Deal ${browserFlowSuffix}`;
    const activityTitle = `Browser Flow Follow-up ${browserFlowSuffix}`;

    await expectPageReady(page, "/organizations/new");
    await page.waitForLoadState("networkidle");
    const organizationForm = page.locator("form.form-card");
    const createOrganizationButton = organizationForm.getByRole("button", { name: "Create organization" });
    await organizationForm.getByLabel("Name").fill(organizationName);
    await organizationForm.getByLabel("Domain").fill(`browser-flow-${browserFlowSuffix}.example`);
    await expectSubmitEnabledAfterHydration(
      organizationForm.getByLabel("Name"),
      organizationName,
      createOrganizationButton
    );
    const organizationResponse = waitForWorkspaceApiResponse(page, "POST", "/organizations");
    await createOrganizationButton.click();
    await expectApiOk(organizationResponse, "Expected organization create API to succeed");
    const organizationPath = await waitForDetailPath(page, "/organizations/");
    await expect(page.locator(".page-title", { hasText: organizationName })).toBeVisible();

    await expectPageReady(page, "/contacts/new");
    await page.waitForLoadState("networkidle");
    const contactForm = page.locator("form.form-card");
    await contactForm.getByLabel("Name").fill(contactName);
    await contactForm.getByLabel("Email").fill(`browser-flow-${browserFlowSuffix}@example.test`);
    await contactForm.getByLabel("Phone").fill("555-0101");
    await contactForm.getByLabel("Organization").selectOption({ label: organizationName });
    const contactResponse = waitForWorkspaceApiResponse(page, "POST", "/people");
    await contactForm.getByRole("button", { name: "Create contact" }).click();
    await expectApiOk(contactResponse, "Expected contact create API to succeed");
    const contactPath = await waitForDetailPath(page, "/contacts/");
    await expect(page.locator(".page-title", { hasText: contactName })).toBeVisible();
    await expect(page.getByRole("link", { name: organizationName }).first()).toHaveAttribute("href", organizationPath);

    await expectPageReady(page, "/deals/new");
    await page.waitForLoadState("networkidle");
    const dealForm = page.locator("form.form-card");
    await dealForm.getByLabel("Title").fill(dealTitle);
    await dealForm.getByLabel("Value").fill("12345.67");
    await dealForm.getByLabel("Currency").fill("USD");
    await dealForm.getByLabel("Person").selectOption({ label: contactName });
    await dealForm.getByLabel("Organization").selectOption({ label: organizationName });
    await expect(dealForm.getByRole("button", { name: "Create deal" })).toBeEnabled();
    const dealResponse = waitForWorkspaceApiResponse(page, "POST", "/deals");
    await dealForm.getByRole("button", { name: "Create deal" }).click();
    await expectApiOk(dealResponse, "Expected deal create API to succeed");
    const dealPath = await waitForDetailPath(page, "/deals/");
    await expect(page.locator(".page-title", { hasText: dealTitle })).toBeVisible();
    await expect(page.getByRole("link", { name: contactName }).first()).toHaveAttribute("href", contactPath);
    await expect(page.getByRole("link", { name: organizationName }).first()).toHaveAttribute("href", organizationPath);

    const addActivity = page.locator("#add-activity");
    await addActivity.getByLabel("Title").fill(activityTitle);
    await addActivity.getByLabel("Type").selectOption("CALL");
    await addActivity.locator('input[type="date"]').fill("2026-07-15");
    await addActivity.getByLabel("Description").fill("Created by the browser regression workflow.");
    const activityResponse = waitForWorkspaceApiResponse(page, "POST", "/activities");
    await addActivity.getByRole("button", { name: "Add activity" }).click();
    await expectApiOk(activityResponse, "Expected activity create API to succeed");
    await page.reload();

    const activityItem = page.locator(".activity-item").filter({ hasText: activityTitle }).first();
    await expect(activityItem).toBeVisible();
    const completeResponse = waitForWorkspaceApiResponse(page, "PATCH", "/activities/");
    await activityItem.getByRole("button", { name: `Mark activity ${activityTitle} complete` }).click();
    await expectApiOk(completeResponse, "Expected activity completion API to succeed");

    await expect(page.locator(".activity-item").filter({ hasText: activityTitle }).first()).toBeVisible();

    await expectPageReady(page, contactPath);
    await expect(page.getByRole("link", { name: dealTitle }).first()).toHaveAttribute("href", dealPath);
    await expectPageReady(page, organizationPath);
    await expect(page.getByRole("link", { name: contactName }).first()).toHaveAttribute("href", contactPath);
    await expect(page.getByRole("link", { name: dealTitle }).first()).toHaveAttribute("href", dealPath);
  });

  test("signs in a returning local user from the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const suffix = uniqueSmokeSuffix();
    const password = `browser-login-${suffix}`;
    const user = await prisma.user.create({
      data: {
        email: `browser-login-${suffix}@example.test`,
        name: "Browser Login Smoke",
        passwordHash: hashPassword(password),
        memberships: {
          create: {
            workspaceId: smokeAuth.workspaceId,
            role: "MEMBER"
          }
        }
      },
      select: { email: true, id: true, name: true }
    });
    browserAuthSmokeUserIds.add(user.id);

    await page.context().clearCookies();
    await expectPageReady(page, "/login?next=/dashboard", { requireAppShell: false });
    await page.getByLabel("Email").fill(user.email.toUpperCase());
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard(?:[?#].*)?$/, { timeout: 10_000 });
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.locator(".signed-in-user")).toHaveText(user.name ?? user.email);
  });

  test("accepts a workspace invitation after signing in from a shared link", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const suffix = uniqueSmokeSuffix();
    const password = `browser-invite-${suffix}`;
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: smokeAuth.workspaceId },
      select: { id: true, name: true }
    });
    const user = await prisma.user.create({
      data: {
        email: `browser-invite-${suffix}@example.test`,
        name: "Browser Invite Smoke",
        passwordHash: hashPassword(password)
      },
      select: { email: true, id: true, name: true }
    });
    browserAuthSmokeUserIds.add(user.id);
    const invitation = await prisma.workspaceInvitation.create({
      data: {
        workspaceId: workspace.id,
        email: user.email,
        role: "MEMBER"
      }
    });
    browserAuthSmokeInvitationIds.add(invitation.id);
    const invitationPath = `/workspaces/invitations/${invitation.id}`;

    await page.context().clearCookies();
    await gotoWithConnectionRetry(page, invitationPath);
    await page.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("next") === invitationPath);
    await page.getByLabel("Email").fill(user.email.toUpperCase());
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL((url) => url.pathname === invitationPath, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: workspace.name })).toBeVisible();
    await expect(page.getByRole("button", { name: `Accept invitation to ${workspace.name}` })).toBeVisible();
    await page.getByRole("button", { name: `Accept invitation to ${workspace.name}` }).click();

    await page.waitForURL(/\/settings(?:[?#].*)?$/, { timeout: 10_000 });
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.locator(".signed-in-user")).toHaveText(user.name ?? user.email);
    await expect(page.locator("#account-email")).toHaveValue(user.email);
    await expect(page.locator(".stat-card").filter({ hasText: "Settings access" }).getByText("Member")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team / Workspace Invitations" })).toHaveCount(0);
    await expect
      .poll(() =>
        prisma.workspaceMembership.count({
          where: {
            workspaceId: workspace.id,
            userId: user.id,
            role: "MEMBER"
          }
        })
      )
      .toBe(1);
  });

  test("previews invalid CSV imports without exposing the import action", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await expectPageReady(page, "/settings/import-export");

    const organizationForm = page.locator("form.import-form").filter({ has: page.locator("#organizationCsv") });
    await organizationForm
      .getByLabel("Organizations CSV")
      .fill("\uFEFFname,domain,ownerEmail\nBrowser Invalid Import,browser-invalid.example,not-an-email");
    await organizationForm.getByRole("button", { name: "Preview organization CSV without creating records" }).click();

    await expect(organizationForm.getByText("Preview results")).toBeVisible();
    await expect(organizationForm.getByText("0 valid")).toBeVisible();
    await expect(organizationForm.getByText("1 invalid rows to skip")).toBeVisible();
    await expect(organizationForm.getByText("Browser Invalid Import", { exact: true })).toBeVisible();
    await expect(organizationForm.getByText("Owner email must be a valid email address.")).toBeVisible();
    await expect(organizationForm.getByRole("button", { name: "Import valid organizations" })).toHaveCount(0);
    await expect(
      prisma.organization.count({ where: { name: "Browser Invalid Import", domain: "browser-invalid.example" } })
    ).resolves.toBe(0);
  });

  test("saves and applies a filtered deal view from the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const browserFlowSuffix = registerBrowserFlowSuffix();
    const savedViewName = `Browser Flow Saved View ${browserFlowSuffix}`;

    await expectPageReady(page, "/deals?q=Needle&status=OPEN&sortBy=title&sortDirection=asc&page=2&pageSize=25");
    const savedViewsPanel = page.locator(".saved-views-panel").filter({ hasText: "Saved deal views" });
    await savedViewsPanel.getByLabel("Saved view name").fill(savedViewName);
    await savedViewsPanel.getByRole("button", { name: "Saved deal views: save current view" }).click();

    const savedViewLink = savedViewsPanel.getByRole("link", { name: savedViewName });
    await expect(savedViewLink).toBeVisible();
    const savedViewHref = await savedViewLink.getAttribute("href");
    expect(savedViewHref).toContain("q=Needle");
    expect(savedViewHref).toContain("status=OPEN");
    expect(savedViewHref).toContain("sortBy=title");
    expect(savedViewHref).toContain("pageSize=25");
    expect(savedViewHref).not.toContain("page=2");
    await expect
      .poll(async () => {
        const savedView = await prisma.savedView.findFirst({
          where: { workspaceId: smokeAuth.workspaceId, recordType: "DEAL", name: savedViewName },
          select: { state: true }
        });
        return savedView ? JSON.stringify(savedView.state) : "";
      }, { message: "Expected saved deal view to persist without transient page state" })
      .toContain("Needle");
    const persistedState = await prisma.savedView.findFirstOrThrow({
      where: { workspaceId: smokeAuth.workspaceId, recordType: "DEAL", name: savedViewName },
      select: { state: true }
    });
    const persistedStateText = JSON.stringify(persistedState.state);
    expect(persistedStateText).not.toContain("\"page\"");
    expect(persistedStateText).not.toContain("\"pagination\"");

    await savedViewLink.click();
    await page.waitForURL(
      (url) => url.pathname === "/deals" && url.searchParams.get("q") === "Needle" && url.searchParams.get("page") === null
    );
    expect(new URL(page.url()).searchParams.get("page")).toBeNull();
    await expect(page.getByText(`Saved view: ${savedViewName}`)).toBeVisible();
    await expect(page.getByRole("link", { name: `Clear saved view: Saved view: ${savedViewName}` })).toBeVisible();

    await page.getByRole("button", { name: `Delete saved view ${savedViewName}` }).click();
    await expect(savedViewLink).toHaveCount(0);
    await expect
      .poll(() =>
        prisma.savedView.count({
          where: { workspaceId: smokeAuth.workspaceId, recordType: "DEAL", name: savedViewName }
        })
      )
      .toBe(0);
  });

  test("creates and converts a lead from the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const browserFlowSuffix = registerBrowserFlowSuffix();
    const leadTitle = `Browser Flow Lead ${browserFlowSuffix}`;
    const dealTitle = `Browser Flow Converted Deal ${browserFlowSuffix}`;
    const emailSubject = `Browser Flow Lead Email ${browserFlowSuffix}`;

    await expectPageReady(page, "/leads/new");
    await page.waitForLoadState("networkidle");
    const leadForm = page.locator("form.form-card");
    const createLeadButton = leadForm.getByRole("button", { name: "Create lead" });
    await leadForm.getByLabel("Title").fill(leadTitle);
    await leadForm.getByLabel("Source").fill("Browser regression");
    await leadForm.getByLabel("Status").selectOption("QUALIFIED");
    await expectSubmitEnabledAfterHydration(leadForm.getByLabel("Title"), leadTitle, createLeadButton);
    const leadResponse = waitForWorkspaceApiResponse(page, "POST", "/leads");
    await createLeadButton.click();
    await expectApiOk(leadResponse, "Expected lead create API to succeed");
    const leadPath = await waitForDetailPath(page, "/leads/");
    await expect(page.locator(".page-title", { hasText: leadTitle })).toBeVisible();
    await expect(page.getByText("Browser regression", { exact: true }).first()).toBeVisible();

    const emailLogPanel = page.locator("#email-log");
    await emailLogPanel.getByLabel("Direction").selectOption("INBOUND");
    await emailLogPanel.getByLabel("Subject").fill(emailSubject);
    await emailLogPanel.getByLabel("Body").fill("Lead email context should move to the converted deal.");
    const emailLogResponse = waitForWorkspaceApiResponse(page, "POST", "/email-logs");
    await emailLogPanel.getByRole("button", { name: "Save email log" }).click();
    await expectApiOk(emailLogResponse, "Expected lead email log API to succeed");
    await page.reload();
    await expect(page.getByText(emailSubject)).toBeVisible();
    await expect(page.getByText("Logged inbound email")).toBeVisible();

    await page.getByLabel("Deal title").fill(dealTitle);
    const conversionResponse = waitForWorkspaceApiResponse(page, "POST", "/convert");
    await page.getByRole("button", { name: "Convert to deal" }).click();
    await expectApiOk(conversionResponse, "Expected lead conversion API to succeed");
    const dealPath = await waitForDetailPath(page, "/deals/");
    await expect(page.locator(".page-title", { hasText: dealTitle })).toBeVisible();
    await expect(page.getByText(emailSubject)).toBeVisible();
    await expect(page.getByText("Logged inbound email")).toBeVisible();

    await expectPageReady(page, leadPath);
    await expect(page.getByText("Locked after conversion")).toBeVisible();
    await expect(page.getByRole("button", { name: /Edit lead: .*: Converted lead locked/ })).toBeDisabled();
    await expect(page.getByText("This lead has already been converted.")).toBeVisible();
    expect(dealPath).toMatch(/^\/deals\/[^/]+$/);
  });

  test("requests and completes a password reset from the UI", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const suffix = uniqueSmokeSuffix();
    const resetUser = await prisma.user.create({
      data: {
        email: `browser-reset-${suffix}@example.test`,
        name: "Browser Reset Smoke"
      },
      select: { email: true, id: true }
    });
    browserAuthSmokeUserIds.add(resetUser.id);

    await page.context().clearCookies();
    await expectPageReady(page, "/forgot-password", { requireAppShell: false });
    await page.getByLabel("Email").fill(resetUser.email);
    await page.getByRole("button", { name: "Request reset" }).click();
    await expect(page.getByText("If an account exists for that email and password reset is configured")).toBeVisible();
    await expect
      .poll(() => prisma.passwordResetToken.count({ where: { userId: resetUser.id, consumedAt: null } }), {
        message: "Expected forgot-password form submission to create an active reset token"
      })
      .toBeGreaterThan(0);

    const resetToken = `browser-reset-token-${suffix}-${randomUUID()}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: resetUser.id,
        tokenHash: hashPasswordResetToken(resetToken),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      }
    });

    await expectPageReady(page, `/reset-password?token=${encodeURIComponent(resetToken)}`, { requireAppShell: false });
    await page.getByLabel("New password", { exact: true }).fill(`browser-reset-${suffix}`);
    await page.getByLabel("Confirm new password").fill(`browser-reset-${suffix}`);
    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByText("Password reset. You can sign in with your new password.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  });

  test("renders a small mobile viewport subset", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const dealHref = await firstDetailHref(page, "/deals", "/deals/");
    const leadHref = await firstDetailHref(page, "/leads", "/leads/");
    const contactHref = await firstDetailHref(page, "/contacts", "/contacts/");
    const organizationHref = await firstDetailHref(page, "/organizations", "/organizations/");

    for (const path of [
      "/dashboard",
      "/assistant",
      "/pipeline",
      "/deals",
      dealHref,
      "/leads",
      leadHref,
      "/contacts",
      contactHref,
      "/organizations",
      organizationHref,
      "/activities",
      "/email",
      "/products",
      "/quotes",
      "/reports",
      "/meeting-intelligence",
      "/web-forms",
      "/search?q=orbit",
      "/settings",
      "/settings/import-export",
      "/settings/developer-api",
      "/custom-fields"
    ]) {
      await expectPageReady(page, path);
      await expectNoPageHorizontalOverflow(page, path);
      await expectNoOneCharacterTextStacking(page, path);
      if (path === "/dashboard") await expectSidebarLabelsReadable(page, path);
    }
  });

  test("shows reopen action for a closed seeded deal", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const closedDealHref = await closedDealHrefFromList(page);

    await expectPageReady(page, closedDealHref);
    await expect(page.getByRole("button", { name: "Reopen deal" })).toBeVisible();
  });

  test("renders internal and public quote routes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    const quotePath = `/deals/${smokeQuote.dealId}/quotes/${smokeQuote.quoteId}`;
    await expectPageReady(page, quotePath);
    await expectRecordSectionNav(page, ["#quote-overview", "#quote-context", "#quote-totals", "#quote-readiness", "#quote-status", "#public-link", "#quote-items"], "#quote-items");
    await expect(page.getByRole("heading", { name: /Q-SMOKE-/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quote Overview" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Customer and Deal Context" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Totals and Adjustments" })).toBeVisible();
    await expect(page.getByText("Internal quote", { exact: true })).toBeVisible();
    await expect(page.getByText("Internal tracking only")).toBeVisible();

    await expectPageReady(page, `${quotePath}/print`, { requireAppShell: false });
    await expect(page.locator("main.quote-print-page")).toBeVisible();
    await expect(page.getByRole("button", { name: "Print quote" })).toBeVisible();

    const pdfResponse = await page.context().request.get(`${quotePath}/pdf`);
    expect(pdfResponse?.ok(), "Expected quote PDF route to return ok").toBeTruthy();
    expect(pdfResponse?.headers()["content-type"]).toContain("application/pdf");
    expect(pdfResponse?.headers()["content-disposition"]).toContain("Q-SMOKE-");

    await expectPageReady(page, `/q/${smokeQuote.token}`, { requireAppShell: false });
    await expect(page.getByRole("heading", { name: /Q-SMOKE-/ })).toBeVisible();
    await expect(page.getByText("Customer-facing quote view")).toBeVisible();
    await expect(page.getByText("automatically update internal deal value")).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);

    await page.getByRole("button", { name: "Accept Quote" }).click();
    await page.waitForURL(new RegExp(`/q/${smokeQuote.token}\\?accepted=1$`));
    await expect(page.getByRole("heading", { name: /Q-SMOKE-/ })).toBeVisible();
    await expect(page.getByText("Quote accepted")).toBeVisible();
    await expect(page.getByText("no payment, signature, email delivery, or automatic internal deal-value update was collected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept Quote" })).toHaveCount(0);
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);
    await expect
      .poll(() =>
        prisma.auditLog.count({
          where: {
            action: "quote.public_accepted",
            entityId: smokeQuote.quoteId
          }
        })
      )
      .toBe(1);
  });

  test("creates and submits a public web form lead capture flow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const suffix = uniqueSmokeSuffix();
    const formName = `Browser lead form ${suffix}`;
    const publicTitle = `Browser lead capture ${suffix}`;
    const leadEmail = `browser-web-form-${suffix}@example.test`;

    await expectPageReady(page, "/web-forms");
    await expect(page.getByRole("link", { exact: true, name: "Current section: Web Forms" })).toBeVisible();
    await expect(page.getByRole("heading", { exact: true, name: "Web Forms" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create Lead Capture Form" })).toBeVisible();

    await page.getByLabel("Internal name").fill(formName);
    await page.getByLabel("Public title").fill(publicTitle);
    await page.getByLabel("Public description").fill("Browser smoke public form description.");
    await page.getByLabel("Source label").fill(`Web Form / Browser smoke ${suffix}`);
    await page.getByRole("button", { name: "Create form" }).click();
    await page.waitForURL(/\/web-forms\?created=1$/);
    await expect(page.getByText("Web form created.")).toBeVisible();
    await expect(page.getByText(formName)).toBeVisible();
    await expect(page.getByText(publicTitle)).toBeVisible();

    const webForm = await prisma.webForm.findFirstOrThrow({
      where: { workspaceId: smokeAuth.workspaceId, name: formName, deletedAt: null },
      select: { id: true, token: true }
    });
    smokeIds.webFormId = webForm.id;
    const publicPath = `/f/${webForm.token}`;

    const createdFormRow = page.locator("tr", { hasText: formName });
    await expect(createdFormRow.getByLabel(`Public web form URL for ${formName}. Enabled`)).toHaveValue(publicPath);
    await expect(createdFormRow.getByRole("button", { name: `Copy public web form link for ${formName}` })).toBeVisible();
    await expect(createdFormRow.getByRole("link", { name: "Open", exact: true })).toBeVisible();
    await expect(createdFormRow.getByRole("link", { name: "Review", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review all submissions" })).toBeVisible();

    await createdFormRow.getByRole("link", { name: "Review", exact: true }).click();
    await page.waitForURL(new RegExp(`/web-forms/${webForm.id}$`));
    await expect(page.getByRole("heading", { name: formName })).toBeVisible();
    await expect(page.getByText("Accepted submissions", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No submissions yet" })).toBeVisible();
    await expect(page.getByText(webForm.token)).toHaveCount(0);

    await expectPageReady(page, publicPath, { requireAppShell: false });
    await expect(page.locator("main.public-form-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: publicTitle })).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);

    await page.getByLabel("What should we call this?").fill("Browser web form inquiry");
    await page.getByLabel("Your name").fill("Browser Form Contact");
    await page.getByLabel("Email").fill(leadEmail);
    await page.getByLabel("Phone").fill("+1 555 0133");
    await page.locator('input[name="organizationName"]').fill("Browser Forms Co");
    await page.getByLabel("Message").fill("This should create one lead and one note.");
    await page.getByRole("button", { name: "Submit" }).click();
    await page.waitForURL(new RegExp(`/f/${webForm.token}\\?submitted=1$`));
    await expect(page.getByText("Your request was received.")).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);

    const lead = await prisma.lead.findFirstOrThrow({
      where: {
        workspaceId: smokeAuth.workspaceId,
        source: `Web Form / Browser smoke ${suffix}`,
        title: "Browser web form inquiry"
      },
      include: { notes: true }
    });
    smokeIds.webFormLeadId = lead.id;
    expect(lead.personId).toBeNull();
    expect(lead.organizationId).toBeNull();
    expect(lead.notes).toHaveLength(1);
    expect(lead.notes[0]?.body).toContain("This should create one lead and one note.");
    const acceptedSubmission = await prisma.webFormSubmission.findFirstOrThrow({
      where: { workspaceId: smokeAuth.workspaceId, webFormId: webForm.id, leadId: lead.id },
      select: { id: true }
    });

    await page.goto(publicPath);
    await page.getByLabel("What should we call this?").fill("Browser web form inquiry");
    await page.getByLabel("Your name").fill("Browser Form Contact");
    await page.getByLabel("Email").fill(leadEmail);
    await page.getByLabel("Phone").fill("+1 555 0133");
    await page.locator('input[name="organizationName"]').fill("Browser Forms Co");
    await page.getByLabel("Message").fill("This should create one lead and one note.");
    await page.getByRole("button", { name: "Submit" }).click();
    await page.waitForURL(new RegExp(`/f/${webForm.token}\\?submitted=1$`));
    await expect
      .poll(() =>
        prisma.lead.count({
          where: { workspaceId: smokeAuth.workspaceId, source: `Web Form / Browser smoke ${suffix}` }
        })
      )
      .toBe(1);

    await page.goto(publicPath);
    await page.locator('input[name="website"]').fill("https://spam.example.test", { force: true });
    await page.getByLabel("Email").fill(`honeypot-${leadEmail}`);
    await page.getByRole("button", { name: "Submit" }).click();
    await page.waitForURL(new RegExp(`/f/${webForm.token}\\?submitted=1$`));
    await expect
      .poll(() =>
        prisma.lead.count({
          where: { workspaceId: smokeAuth.workspaceId, source: `Web Form / Browser smoke ${suffix}` }
        })
      )
      .toBe(1);

    await expectPageReady(page, `/web-forms/${webForm.id}`);
    await expect(page.getByRole("heading", { name: "Recent Accepted Submissions" })).toBeVisible();
    await expect(page.getByText("Browser Form Contact")).toBeVisible();
    await expect(page.getByText(leadEmail)).toBeVisible();
    await expect(page.getByText("Browser Forms Co")).toBeVisible();
    await expect(page.getByText("This should create one lead and one note.")).toBeVisible();
    await expect(page.getByText(webForm.token)).toHaveCount(0);
    await expect(page.getByText(`honeypot-${leadEmail}`)).toHaveCount(0);
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);

    const perFormSubmissionRow = page.locator("tbody tr", { hasText: "Browser web form inquiry" });
    await perFormSubmissionRow.getByRole("link", { name: "Review" }).click();
    await page.waitForURL(/\/web-forms\/submissions\/[^/?]+/);
    await expect(page.getByRole("heading", { name: "Browser web form inquiry" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Submitted Values" })).toBeVisible();
    const submittedValuesPanel = page.locator("section", { has: page.getByRole("heading", { name: "Submitted Values" }) });
    await expect(submittedValuesPanel.getByText("Browser Form Contact")).toBeVisible();
    await expect(submittedValuesPanel.getByText(leadEmail)).toBeVisible();
    await expect(submittedValuesPanel.getByText("+1 555 0133")).toBeVisible();
    await expect(submittedValuesPanel.getByText("Browser Forms Co")).toBeVisible();
    await expect(submittedValuesPanel.getByText("This should create one lead and one note.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Source Context" })).toBeVisible();
    await expect(page.getByText(`Web Form / Browser smoke ${suffix}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Linked CRM Records" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Browser web form inquiry" })).toBeVisible();
    await expect(page.getByText("Lead Note context")).toBeVisible();
    await expect(page.getByText("Web form submission:", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy submitted email" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy submitted phone" })).toBeVisible();
    await page.evaluate(() => {
      const pageWindow = window as Window & { __webFormCopiedValue?: string };
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            pageWindow.__webFormCopiedValue = value;
          }
        }
      });
    });
    const beforeCopyCounts = {
      leads: await prisma.lead.count({ where: { workspaceId: smokeAuth.workspaceId, source: `Web Form / Browser smoke ${suffix}` } }),
      notes: await prisma.note.count({ where: { leadId: lead.id, workspaceId: smokeAuth.workspaceId } }),
      submissions: await prisma.webFormSubmission.count({ where: { webFormId: webForm.id, workspaceId: smokeAuth.workspaceId } })
    };
    await page.getByRole("button", { name: "Copy submitted email" }).click();
    await expect(page.getByText("Submitted email copied.")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as Window & { __webFormCopiedValue?: string }).__webFormCopiedValue)).toBe(leadEmail);
    await page.getByRole("button", { name: "Copy submitted phone" }).click();
    await expect(page.getByText("Submitted phone copied.")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as Window & { __webFormCopiedValue?: string }).__webFormCopiedValue)).toBe("+1 555 0133");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("Clipboard blocked in test")) }
      });
    });
    await page.getByRole("button", { name: "Copy submitted phone" }).click();
    await expect(page.getByText("Submitted phone could not be copied.")).toBeVisible();
    await expect
      .poll(() =>
        prisma.lead.count({ where: { workspaceId: smokeAuth.workspaceId, source: `Web Form / Browser smoke ${suffix}` } })
      )
      .toBe(beforeCopyCounts.leads);
    await expect.poll(() => prisma.note.count({ where: { leadId: lead.id, workspaceId: smokeAuth.workspaceId } })).toBe(beforeCopyCounts.notes);
    await expect
      .poll(() => prisma.webFormSubmission.count({ where: { webFormId: webForm.id, workspaceId: smokeAuth.workspaceId } }))
      .toBe(beforeCopyCounts.submissions);
    await expect(page.getByText(webForm.token)).toHaveCount(0);
    await expect(page.getByText(`honeypot-${leadEmail}`)).toHaveCount(0);
    await page.getByRole("link", { name: "Back to Review" }).click();
    await page.waitForURL(new RegExp(`/web-forms/${webForm.id}#accepted-submissions$`));
    await expect(page.locator("#accepted-submissions")).toBeVisible();
    await expect(page.locator("#accepted-submissions")).toHaveAttribute("aria-labelledby", "accepted-submissions-title");
    await expect(page.locator("#accepted-submissions-title")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);

    const submissionFilterPanel = page.locator("section", { has: page.getByRole("heading", { name: "Filter Submissions" }) });
    await submissionFilterPanel.getByLabel("Search", { exact: true }).fill(leadEmail.toUpperCase());
    await submissionFilterPanel.getByLabel("Lead status").selectOption("NEW");
    await submissionFilterPanel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(new RegExp(`/web-forms/${webForm.id}\\?.*q=`));
    await expect(page.getByText(`Search: ${leadEmail.toUpperCase()}`)).toBeVisible();
    await expect(page.getByText("Lead status: New")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);
    await expect(page.getByText(webForm.token)).toHaveCount(0);

    await page.locator("tbody tr", { hasText: "Browser web form inquiry" }).getByRole("link", { name: "Review" }).click();
    await page.waitForURL(/\/web-forms\/submissions\/[^/?]+\?returnTo=/);
    await expect(page.getByRole("heading", { name: "Submitted Values" })).toBeVisible();
    await page.getByRole("link", { name: "Back to Review" }).click();
    await expect(page).toHaveURL(new RegExp(`/web-forms/${webForm.id}\\?.*q=.*#accepted-submissions$`));
    await expect(page.locator("#accepted-submissions")).toBeVisible();
    await expect(page.getByText(`Search: ${leadEmail.toUpperCase()}`)).toBeVisible();
    await expect(page.getByText("Lead status: New")).toBeVisible();

    await page.reload();
    await expect(submissionFilterPanel.getByLabel("Search", { exact: true })).toHaveValue(leadEmail.toUpperCase());
    await expect(submissionFilterPanel.getByLabel("Lead status")).toHaveValue("NEW");
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);

    await submissionFilterPanel.getByLabel("Search", { exact: true }).fill("definitely no matching web form submission");
    await submissionFilterPanel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("heading", { name: "No submissions match these filters" })).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.waitForURL(new RegExp(`/web-forms/${webForm.id}$`));
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);

    await expectPageReady(page, "/web-forms/submissions");
    await expect(page.getByRole("heading", { name: "Web Form Submissions" })).toBeVisible();
    await expect(page.getByText("Accepted submissions", { exact: true })).toBeVisible();
    const allSubmissionsRow = page.locator("tbody tr", { hasText: "Browser web form inquiry" });
    await expect(allSubmissionsRow).toHaveCount(1);
    await expect(allSubmissionsRow.getByRole("link", { name: formName })).toBeVisible();
    await expect(allSubmissionsRow.getByText("Browser Form Contact")).toBeVisible();
    await expect(allSubmissionsRow.getByText(leadEmail)).toBeVisible();
    await expect(allSubmissionsRow.getByText("Browser Forms Co")).toBeVisible();
    await expect(page.getByText(webForm.token)).toHaveCount(0);
    await expect(page.getByText(`honeypot-${leadEmail}`)).toHaveCount(0);

    const allSubmissionsFilterPanel = page.locator("section", { has: page.getByRole("heading", { name: "Filter Submissions" }) });
    await allSubmissionsFilterPanel.getByLabel("Search", { exact: true }).fill(leadEmail.toUpperCase());
    await allSubmissionsFilterPanel.getByLabel("Source form").selectOption(webForm.id);
    await allSubmissionsFilterPanel.getByLabel("Lead status").selectOption("NEW");
    await allSubmissionsFilterPanel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(new RegExp(`/web-forms/submissions\\?.*q=`));
    await expect(page.getByText(`Search: ${leadEmail.toUpperCase()}`)).toBeVisible();
    await expect(page.getByText(`Source form: ${formName}`)).toBeVisible();
    await expect(page.getByText("Lead status: New")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);

    await page.locator("tbody tr", { hasText: "Browser web form inquiry" }).getByRole("link", { name: "Review" }).click();
    await page.waitForURL(/\/web-forms\/submissions\/[^/?]+\?returnTo=/);
    await expect(page.getByRole("heading", { name: "Browser web form inquiry" })).toBeVisible();
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "Submitted Values" }) }).getByText("Browser Form Contact")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Lead" })).toBeVisible();
    await expect(page.getByText(webForm.token)).toHaveCount(0);
    await page.getByRole("link", { name: "Back to Review" }).click();
    await expect(page).toHaveURL(new RegExp(`/web-forms/submissions\\?.*q=.*#accepted-submissions$`));
    await expect(page.locator("#accepted-submissions")).toBeVisible();
    await expect(page.locator("#accepted-submissions")).toHaveAttribute("aria-labelledby", "accepted-submissions-title");
    await expect(page.locator("#accepted-submissions-title")).toBeVisible();
    await expect(page.getByText(`Source form: ${formName}`)).toBeVisible();

    await page.reload();
    await expect(allSubmissionsFilterPanel.getByLabel("Search", { exact: true })).toHaveValue(leadEmail.toUpperCase());
    await expect(allSubmissionsFilterPanel.getByLabel("Source form")).toHaveValue(webForm.id);
    await expect(allSubmissionsFilterPanel.getByLabel("Lead status")).toHaveValue("NEW");
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);

    await allSubmissionsFilterPanel.getByLabel("Search", { exact: true }).fill("definitely no all-form submission match");
    await allSubmissionsFilterPanel.getByRole("button", { name: "Apply filters" }).click();
    await expect(page.getByRole("heading", { name: "No submissions match these filters" })).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await page.waitForURL(/\/web-forms\/submissions$/);
    await expect(page.locator("tbody tr", { hasText: "Browser web form inquiry" })).toHaveCount(1);
    await page.locator("tbody tr", { hasText: "Browser web form inquiry" }).getByRole("link", { name: formName }).click();
    await page.waitForURL(new RegExp(`/web-forms/${webForm.id}$`));
    await expect(page.getByRole("heading", { name: formName })).toBeVisible();

    await page.getByRole("link", { name: "Browser web form inquiry" }).click();
    await page.waitForURL(new RegExp(`/leads/${lead.id}$`));
    await expect(page.locator("h1", { hasText: "Browser web form inquiry" })).toBeVisible();

    await prisma.webFormSubmission.update({
      where: { id: acceptedSubmission.id },
      data: { email: null, phone: null, message: null, organizationName: null, personName: null }
    });
    await expectPageReady(
      page,
      `/web-forms/submissions/${acceptedSubmission.id}?returnTo=${encodeURIComponent("https://evil.example.test/web-forms/submissions?q=bad")}`
    );
    await expect(page.getByRole("heading", { name: "Submitted Values" })).toBeVisible();
    await expect(page.getByText("Unavailable in this historical submission.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy submitted email" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy submitted phone" })).toHaveCount(0);
    await expect(page.getByText(webForm.token)).toHaveCount(0);
    await page.getByRole("link", { name: "Back to Review" }).click();
    await page.waitForURL(new RegExp(`/web-forms/${webForm.id}#accepted-submissions$`));

    await expectPageReady(page, "/web-forms");
    const formRow = page.locator("tr", { hasText: formName });
    await formRow.getByRole("button", { name: "Disable" }).click();
    await page.waitForURL(/\/web-forms\?disabled=1$/);
    await expect(page.getByText("Web form disabled.")).toBeVisible();

    await expectPageReady(page, publicPath, { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Form unavailable" })).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);

    await expectPageReady(page, `/f/${generatePublicWebFormToken()}`, { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Form unavailable" })).toBeVisible();
  });

  test("creates and submits a public scheduler booking flow", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const suffix = uniqueSmokeSuffix();
    const schedulerName = `Browser scheduler ${suffix}`;
    const meetingTitle = `Browser discovery ${suffix}`;
    const attendeeEmail = `browser-scheduler-${suffix}@example.test`;

    await expectPageReady(page, "/scheduler");
    await expect(page.getByRole("link", { exact: true, name: "Current section: Scheduler" })).toBeVisible();
    await expect(page.getByRole("heading", { exact: true, name: "Scheduler" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create Scheduling Link" })).toBeVisible();

    await page.getByLabel("Internal name").fill(schedulerName);
    await page.getByLabel("Meeting title").fill(meetingTitle);
    await page.getByLabel("Duration").selectOption("30");
    await page.getByLabel("Timezone").fill("UTC");
    await page.getByLabel("Minimum notice").selectOption("0");
    await page.getByLabel("Description").fill("Browser smoke scheduler description.");
    await page.getByRole("button", { name: "Create scheduling link" }).click();
    await page.waitForURL(/\/scheduler\?created=1$/);
    await expect(page.getByText("Scheduling link created.")).toBeVisible();
    await expect(page.getByText(schedulerName)).toBeVisible();
    await expect(page.getByText(meetingTitle)).toBeVisible();

    const schedulerLink = await prisma.schedulerLink.findFirstOrThrow({
      where: { workspaceId: smokeAuth.workspaceId, name: schedulerName, deletedAt: null },
      select: { id: true, token: true }
    });
    smokeIds.schedulerLinkId = schedulerLink.id;
    const publicPath = `/s/${schedulerLink.token}`;
    const schedulerRow = page.locator("tr", { hasText: schedulerName });
    await expect(schedulerRow.getByLabel(`Public scheduler URL for ${schedulerName}. Enabled`)).toHaveValue(publicPath);
    await expect(schedulerRow.getByRole("button", { name: `Copy public scheduler link for ${schedulerName}` })).toBeVisible();
    await expect(schedulerRow.getByRole("link", { name: "View", exact: true })).toBeVisible();

    await schedulerRow.getByRole("link", { name: "View", exact: true }).click();
    await page.waitForURL(new RegExp(`/scheduler/${schedulerLink.id}$`));
    await expect(page.getByRole("heading", { name: schedulerName })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Booking Requests" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No booking requests yet" })).toBeVisible();
    await expect(page.getByText(schedulerLink.token)).toHaveCount(0);

    await expectPageReady(page, publicPath, { requireAppShell: false });
    await expect(page.locator("main.public-form-page")).toBeVisible();
    await expect(page.getByRole("heading", { name: meetingTitle })).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);
    await expect(page.getByText("Northstar-configured availability")).toBeVisible();
    await expect.poll(() => page.locator('input[name="startAt"]').count()).toBeGreaterThan(0);

    await page.getByLabel("Your name").fill("Browser Scheduler Guest");
    await page.getByLabel("Email").fill(attendeeEmail);
    await page.locator('input[name="attendeeCompany"]').fill("Browser Scheduler Co");
    await page.getByLabel("Note").fill("This should create one meeting activity.");
    await page.getByRole("button", { name: "Request booking" }).click();
    await page.waitForURL(new RegExp(`/s/${schedulerLink.token}\\?booked=1$`));
    await expect(page.getByText("Your booking request was received.")).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);

    const booking = await prisma.schedulerBooking.findFirstOrThrow({
      where: { workspaceId: smokeAuth.workspaceId, schedulerLinkId: schedulerLink.id, attendeeEmail },
      select: { activityId: true, id: true }
    });
    smokeIds.schedulerActivityId = booking.activityId ?? "";
    const activity = await prisma.activity.findUniqueOrThrow({ where: { id: booking.activityId ?? "" } });
    expect(activity.workspaceId).toBe(smokeAuth.workspaceId);
    expect(activity.type).toBe(ActivityType.MEETING);
    expect(activity.description).toContain("This should create one meeting activity.");
    expect(activity.personId).toBeNull();
    await expect(
      prisma.person.count({
        where: { workspaceId: smokeAuth.workspaceId, email: attendeeEmail }
      })
    ).resolves.toBe(0);

    const bookingReviewPath = `/scheduler/bookings?link=${schedulerLink.id}&q=${encodeURIComponent("Browser Scheduler Guest")}&activity=open`;
    await expectPageReady(page, bookingReviewPath);
    await expect(page.getByRole("heading", { name: "Scheduler Bookings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Filter Bookings" })).toBeVisible();
    await expect(page.getByText("Source link:")).toBeVisible();
    await expect(page.getByText("Search: Browser Scheduler Guest")).toBeVisible();
    await expect(page.getByText("Activity state: Activity available")).toBeVisible();
    const allBookingsRow = page.locator("tbody tr", { hasText: attendeeEmail });
    await expect(allBookingsRow.getByText("Browser Scheduler Guest", { exact: true })).toBeVisible();
    await expect(allBookingsRow.getByText("Activity available")).toBeVisible();
    await expect(page.getByText(schedulerLink.token)).toHaveCount(0);

    await allBookingsRow.getByRole("link", { name: "Review" }).click();
    await page.waitForURL(new RegExp(`/scheduler/bookings/${booking.id}\\?returnTo=`));
    await expect(page.getByRole("heading", { name: meetingTitle })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Submitted Attendee Values" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scheduler Configuration" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Linked CRM Activity" })).toBeVisible();
    await expect(page.getByText("Browser Scheduler Guest", { exact: true })).toBeVisible();
    await expect(page.getByText(attendeeEmail)).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy attendee email" })).toBeVisible();
    await expect(page.getByText("Provider-calendar availability is not checked or inferred.")).toBeVisible();
    await expect(page.getByText(schedulerLink.token)).toHaveCount(0);

    await page.getByRole("link", { name: "Back to Review" }).click();
    await page.waitForURL(new RegExp(`/scheduler/bookings\\?link=${schedulerLink.id}&q=Browser\\+Scheduler\\+Guest&activity=open#scheduler-bookings$`));
    await expect(page.locator("tbody tr", { hasText: attendeeEmail })).toBeVisible();

    await expectPageReady(page, `/scheduler/bookings?q=${encodeURIComponent("no matching scheduler guest")}`);
    await expect(page.getByRole("heading", { name: "No bookings match these filters" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await expectPageReady(page, `/scheduler/bookings?link=${schedulerLink.id}`);
    await expectNoPageHorizontalOverflow(page, "/scheduler/bookings");
    await expectNoOneCharacterTextStacking(page, "/scheduler/bookings");
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(publicPath);
    await page.getByLabel("Your name").fill("Browser Scheduler Guest");
    await page.getByLabel("Email").fill(attendeeEmail);
    await page.locator('input[name="attendeeCompany"]').fill("Browser Scheduler Co");
    await page.getByLabel("Note").fill("This should create one meeting activity.");
    await page.getByRole("button", { name: "Request booking" }).click();
    await page.waitForURL(new RegExp(`/s/${schedulerLink.token}\\?booked=1$`));
    await expect
      .poll(() => prisma.schedulerBooking.count({ where: { workspaceId: smokeAuth.workspaceId, schedulerLinkId: schedulerLink.id } }))
      .toBe(1);

    await page.goto(publicPath);
    await page.locator('input[name="website"]').fill("https://spam.example.test", { force: true });
    await page.getByLabel("Your name").fill("Scheduler Spam");
    await page.getByLabel("Email").fill(`honeypot-${attendeeEmail}`);
    await page.getByRole("button", { name: "Request booking" }).click();
    await page.waitForURL(new RegExp(`/s/${schedulerLink.token}\\?booked=1$`));
    await expect
      .poll(() => prisma.schedulerBooking.count({ where: { workspaceId: smokeAuth.workspaceId, schedulerLinkId: schedulerLink.id } }))
      .toBe(1);

    await expectPageReady(page, `/scheduler/${schedulerLink.id}`);
    await expect(page.getByRole("heading", { name: "Recent Booking Requests" })).toBeVisible();
    const bookingRow = page.locator("tbody tr", { hasText: attendeeEmail });
    await expect(bookingRow.getByText("Browser Scheduler Guest", { exact: true })).toBeVisible();
    await expect(bookingRow.getByText(attendeeEmail)).toBeVisible();
    await expect(bookingRow.getByText("Browser Scheduler Co")).toBeVisible();
    await expect(bookingRow.getByText("This should create one meeting activity.")).toBeVisible();
    await expect(page.getByText(schedulerLink.token)).toHaveCount(0);
    await expect(page.getByText(`honeypot-${attendeeEmail}`)).toHaveCount(0);
    await expect(bookingRow.getByRole("link", { name: "Review" })).toBeVisible();
    await page.getByRole("link", { name: activity.title }).click();
    await page.waitForURL(new RegExp(`/activities/${activity.id}/edit$`));
    await expect(page.getByRole("heading", { name: "Edit activity" })).toBeVisible();
    await expect(page.getByText("Scheduler booking", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: schedulerName }).click();
    await page.waitForURL(new RegExp(`/scheduler/bookings/${booking.id}$`));
    await expect(page.getByRole("heading", { name: "Linked CRM Activity" })).toBeVisible();

    await expectPageReady(page, "/scheduler");
    const formRow = page.locator("tr", { hasText: schedulerName });
    await formRow.getByRole("button", { name: "Disable" }).click();
    await page.waitForURL(/\/scheduler\?disabled=1$/);
    await expect(page.getByText("Scheduling link disabled.")).toBeVisible();

    await expectPageReady(page, publicPath, { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Scheduling unavailable" })).toBeVisible();
    await expect(page.getByText("Northstar CRM")).toHaveCount(0);

    await expectPageReady(page, `/s/${generatePublicSchedulerToken()}`, { requireAppShell: false });
    await expect(page.getByRole("heading", { name: "Scheduling unavailable" })).toBeVisible();
  });
});

async function firstDetailHref(page: Page, listPath: string, hrefPrefix: string) {
  await expectPageReady(page, listPath);
  const href = await firstHref(page, hrefPrefix);
  expect(href, `Expected ${listPath} to include a seeded detail link`).toBeTruthy();
  return href;
}

async function createBrowserSmokeAuth() {
  const [user, workspace] = await Promise.all([
    prisma.user.findFirstOrThrow({
      where: {
        email: process.env.DEV_ACTOR_EMAIL ?? "alex@example.test",
        deletedAt: null
      },
      select: { id: true }
    }),
    prisma.workspace.findFirstOrThrow({
      where: {
        slug: process.env.DEV_WORKSPACE_SLUG ?? "northstar-revenue",
        deletedAt: null
      },
      select: { id: true }
    })
  ]);
  await prisma.workspaceMembership.findUniqueOrThrow({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id
      }
    },
    select: { id: true }
  });
  const session = await createLocalSession(user.id);

  return {
    actorUserId: user.id,
    token: session.token,
    sessionCookieValue: serializeLocalSessionCookieValue(session.token),
    workspaceId: workspace.id,
    expiresAt: session.expiresAt
  };
}

async function authenticateBrowserContext(context: BrowserContext) {
  await context.addCookies([
    {
      name: localSessionCookieName,
      value: smokeAuth.sessionCookieValue,
      url: browserBaseUrl,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(smokeAuth.expiresAt.getTime() / 1000)
    },
    {
      name: activeWorkspaceCookieName,
      value: smokeAuth.workspaceId,
      url: browserBaseUrl,
      sameSite: "Lax",
      expires: Math.floor(smokeAuth.expiresAt.getTime() / 1000)
    }
  ]);
}

async function waitForDetailPath(page: Page, prefix: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await page.waitForURL((url) => {
        const path = url.pathname;
        return path.startsWith(prefix) && !path.endsWith("/new") && !path.endsWith("/edit");
      });
      return new URL(page.url()).pathname;
    } catch (error) {
      lastError = error;
      if (!isRetriableNavigationError(error) || attempt === 9) throw error;
      await waitForBrowserServer(page);

      const currentUrl = new URL(page.url());
      if (currentUrl.pathname.startsWith(prefix) && !currentUrl.pathname.endsWith("/new") && !currentUrl.pathname.endsWith("/edit")) {
        await gotoWithConnectionRetry(page, `${currentUrl.pathname}${currentUrl.search}`);
        return new URL(page.url()).pathname;
      }
    }
  }

  throw lastError;
}

async function waitForWorkspaceApiResponse(page: Page, method: string, pathSuffix: string) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.startsWith("/api/v1/workspaces/") &&
      url.pathname.includes(pathSuffix) &&
      response.request().method() === method
    );
  });
}

async function expectApiOk(responsePromise: Promise<Awaited<ReturnType<Page["waitForResponse"]>>>, message: string) {
  const response = await responsePromise;
  expect(response.ok(), message).toBeTruthy();
}

async function expectSubmitEnabledAfterHydration(
  field: Locator,
  value: string,
  submitButton: Locator
) {
  await expect
    .poll(async () => {
      if (await submitButton.isEnabled()) return true;
      await field.fill(value);
      return submitButton.isEnabled();
    }, { timeout: 10_000 })
    .toBe(true);
}

function registerBrowserFlowSuffix() {
  const suffix = uniqueSmokeSuffix();
  browserFlowSuffixes.add(suffix);
  return suffix;
}

function uniqueSmokeSuffix() {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function closedDealHrefFromList(page: Page) {
  for (const status of ["LOST", "WON"]) {
    await expectPageReady(page, `/deals?status=${status}&pageSize=50`);
    const href = await firstHref(page, "/deals/");
    if (href) return href;
  }

  throw new Error("Expected seeded data to include at least one WON or LOST deal.");
}

async function firstHref(page: Page, hrefPrefix: string) {
  return page.locator(`a[href^="${hrefPrefix}"]`).evaluateAll((links, prefix) => {
    const values = links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .filter((href) => href.startsWith(String(prefix)))
      .filter((href) => !href.endsWith("/new") && !href.endsWith("/edit") && !href.includes("/edit?"))
      .filter((href) => {
        const path = href.split(/[?#]/)[0];
        const rest = path.slice(String(prefix).length);
        return rest.length > 0 && !rest.includes("/");
      });

    return values[0] ?? null;
  }, hrefPrefix);
}

async function firstQuoteHref(page: Page) {
  return page.locator('a[href*="/quotes/"]').evaluateAll((links) => {
    const values = links
      .map((link) => link.getAttribute("href"))
      .filter((href): href is string => Boolean(href))
      .filter((href) => href.startsWith("/deals/") && href.includes("/quotes/"));

    return values[0] ?? null;
  });
}

async function firstActivityEditHref(page: Page) {
  await expectPageReady(page, "/activities");
  const href = await page.locator('a[href^="/activities/"][href$="/edit"]').evaluateAll((links) => {
    const values = links
      .map((link) => link.getAttribute("href"))
      .filter((value): value is string => Boolean(value));

    return values[0] ?? null;
  });
  expect(href, "Expected activities list to include a seeded activity edit link").toBeTruthy();
  return href;
}

async function expectPageReady(page: Page, path: string, options: { requireAppShell?: boolean } = {}) {
  const requireAppShell = options.requireAppShell ?? true;
  const errors: string[] = [];
  const serverErrors: string[] = [];
  const onResponse = (response: Awaited<ReturnType<Page["waitForResponse"]>>) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.url()}`);
    }
  };

  const onPageError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  try {
    let response: Awaited<ReturnType<typeof gotoWithConnectionRetry>> | null = null;
    let bodyText = "";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      errors.length = 0;
      serverErrors.length = 0;
      response = await gotoWithConnectionRetry(page, path);
      await page.waitForTimeout(250);
      bodyText = await page.locator("body").innerText({ timeout: 5_000 });
      if (!bodyText.includes("Application error") || !shouldRetryApplicationError(errors) || attempt === 2) break;
      await page.goto("about:blank");
      await page.waitForTimeout(500);
    }

    expect(response?.ok(), `Expected ${path} to return an ok response`).toBeTruthy();
    expect(response?.status(), `Expected ${path} not to return a server error`).toBeLessThan(500);
    expect(bodyText).not.toContain("Application error");
    expect(bodyText).not.toContain("Internal Server Error");
    expect(bodyText).not.toContain("PrismaClientKnownRequestError");
    expect(bodyText).not.toContain("P2022");
    expect(bodyText).not.toContain("This site can't be reached");
    if (requireAppShell) await expect(page.locator("#main-content")).toBeVisible();
    expect(errors, `Unexpected browser error on ${path}`).toEqual([]);
    expect(serverErrors, `Unexpected 5xx response while loading ${path}`).toEqual([]);
  } finally {
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
  }
}

async function expectNoPageHorizontalOverflow(page: Page, path: string) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      clientWidth: root.clientWidth,
      overflowPixels: Math.max(0, root.scrollWidth - root.clientWidth),
      scrollWidth: root.scrollWidth
    };
  });

  expect(
    overflow.overflowPixels,
    `Expected ${path} not to create document-level horizontal overflow at ${overflow.clientWidth}px viewport; scrollWidth was ${overflow.scrollWidth}px`
  ).toBeLessThanOrEqual(2);
}

async function expectNoOneCharacterTextStacking(page: Page, path: string) {
  const offenders = await page.evaluate(() => {
    const selectors = [
      ".badge",
      ".count-badge",
      ".attention-kind",
      ".deal-attention-badge",
      ".button-primary",
      ".button-secondary",
      ".button-danger",
      ".button-compact",
      ".nav-item-label",
      ".page-subtitle",
      ".field-label",
      ".field-value",
      ".field-link",
      ".search-action-link strong",
      ".search-result-main > strong",
      ".search-result-meta span",
      ".table-primary-cell strong",
      ".table-secondary-text",
      ".settings-member-action-status",
      ".record-summary-value",
      ".record-panel-jump-nav",
      ".compact-title",
      ".email-reader-participants",
      ".meeting-prep-attendee",
      ".meeting-prep-action-links"
    ].join(",");

    return Array.from(document.querySelectorAll<HTMLElement>(selectors))
      .filter((element) => {
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text.length < 4 || text.length > 80) return false;
        if (!/[A-Za-z]/.test(text)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") return false;
        const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.3 || 16;
        const hasUnsafeWrap = style.wordBreak === "break-all" || style.overflowWrap === "anywhere";
        const likelyCharacterStack = rect.width < 28 && rect.height > lineHeight * 2.4;
        return hasUnsafeWrap || likelyCharacterStack;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return {
          className: element.className.toString(),
          height: Math.round(rect.height),
          overflowWrap: style.overflowWrap,
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
          width: Math.round(rect.width),
          wordBreak: style.wordBreak
        };
      });
  });

  expect(offenders, `Expected protected UI labels not to stack one character per line on ${path}`).toEqual([]);
}

async function expectSidebarLabelsReadable(page: Page, path: string) {
  const truncated = await page.evaluate(() => {
    const navLabels = Array.from(document.querySelectorAll(".nav-item-label"))
      .filter((label) => label.scrollWidth > label.clientWidth + 1)
      .map((label) => label.textContent?.trim() ?? "");
    const quickLabels = Array.from(document.querySelectorAll(".sidebar-quick-actions strong, .sidebar-quick-actions small"))
      .filter((label) => label.scrollWidth > label.clientWidth + 1)
      .map((label) => label.textContent?.trim() ?? "");

    return { navLabels, quickLabels };
  });

  expect(truncated.navLabels, `Expected primary nav labels to fit naturally on ${path}`).toEqual([]);
  expect(truncated.quickLabels, `Expected sidebar quick-action labels to fit naturally on ${path}`).toEqual([]);
}

async function expectRecordSectionNav(page: Page, hrefs: string[], clickHref: string) {
  const nav = page.locator(".record-panel-jump-nav").first();
  await expect(nav, "Expected record section navigation to be visible").toBeVisible();

  for (const href of hrefs) {
    await expect(nav.locator(`a[href="${href}"]`), `Expected section nav link ${href}`).toBeVisible();
    await expect(page.locator(href), `Expected section target ${href}`).toHaveCount(1);
  }

  await nav.locator(`a[href="${clickHref}"]`).click();
  await expect.poll(() => new URL(page.url()).hash, {
    message: `Expected section nav click to update URL hash to ${clickHref}`
  }).toBe(clickHref);
}

async function expectSettingsShortcutNavigation(page: Page, settingsShortcut: Locator) {
  const errors: string[] = [];
  const onPageError = (error: Error) => errors.push(error.message);
  page.on("pageerror", onPageError);

  try {
    await settingsShortcut.click();
    await page.waitForURL(/\/settings(?:[?#].*)?$/, { timeout: 5_000 });
    let bodyText = await page.locator("body").innerText({ timeout: 5_000 });

    if (bodyText.includes("Application error") && shouldRetryApplicationError(errors)) {
      errors.length = 0;
      await page.waitForTimeout(500);
      const response = await gotoWithConnectionRetry(page, "/settings");
      bodyText = await page.locator("body").innerText({ timeout: 5_000 });
      expect(response?.ok(), "Expected Settings retry to return an ok response").toBeTruthy();
    }

    expect(bodyText).not.toContain("Application error");
    expect(errors, "Unexpected browser error after clicking Settings shortcut").toEqual([]);
    await expect(page.getByRole("heading", { exact: true, name: "Settings" })).toBeVisible();
  } finally {
    page.off("pageerror", onPageError);
  }
}

async function gotoWithConnectionRetry(page: Page, path: string) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await page.goto(path);
    } catch (error) {
      lastError = error;
      if (!isRetriableNavigationError(error) || attempt === 9) throw error;
      await waitForBrowserServer(page);
    }
  }

  throw lastError;
}

async function waitForBrowserServer(page: Page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await page.context().request.get(`${browserBaseUrl}/api/health`, { timeout: 2_000 });
      if (response.ok()) return;
    } catch {
      // Keep retrying until the local Next listener is back.
    }
    await page.waitForTimeout(1_000);
  }
}

function isConnectionRefusedError(error: unknown) {
  return error instanceof Error && error.message.includes("ERR_CONNECTION_REFUSED");
}

function isNavigationAbortedError(error: unknown) {
  return error instanceof Error && error.message.includes("net::ERR_ABORTED");
}

function isEmptyResponseError(error: unknown) {
  return error instanceof Error && error.message.includes("ERR_EMPTY_RESPONSE");
}

function isRetriableNavigationError(error: unknown) {
  return isConnectionRefusedError(error) || isNavigationAbortedError(error) || isEmptyResponseError(error);
}

function isChunkLoadError(message: string) {
  return message.includes("ChunkLoadError") || message.includes("Loading chunk");
}

function shouldRetryApplicationError(errors: string[]) {
  return errors.length === 0 || errors.some(isChunkLoadError);
}

async function createSmokeQuote() {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  const deal = await prisma.deal.findFirstOrThrow({
    where: { workspaceId: workspace.id, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  const suffix = uniqueSmokeSuffix();
  const product = await prisma.product.create({
    data: {
      workspaceId: workspace.id,
      name: `Smoke product ${suffix}`,
      description: "Browser smoke product",
      unitPriceCents: 123400,
      currency: "USD"
    }
  });
  smokeIds.productId = product.id;

  const lineItem = await prisma.dealLineItem.create({
    data: {
      workspaceId: workspace.id,
      dealId: deal.id,
      productId: product.id,
      productName: product.name,
      description: product.description,
      quantity: 1,
      unitPriceCents: product.unitPriceCents,
      lineTotalCents: product.unitPriceCents,
      currency: product.currency
    }
  });
  smokeIds.dealLineItemId = lineItem.id;

  const quote = await prisma.quote.create({
    data: {
      workspaceId: workspace.id,
      dealId: deal.id,
      number: `Q-SMOKE-${suffix}`,
      status: "SENT",
      currency: "USD",
      subtotalCents: lineItem.lineTotalCents,
      totalCents: lineItem.lineTotalCents
    }
  });
  smokeIds.quoteId = quote.id;

  const quoteItem = await prisma.quoteItem.create({
    data: {
      workspaceId: workspace.id,
      quoteId: quote.id,
      dealLineItemId: lineItem.id,
      productId: product.id,
      name: lineItem.productName,
      description: lineItem.description,
      quantity: lineItem.quantity,
      unitPriceCents: lineItem.unitPriceCents,
      lineTotalCents: lineItem.lineTotalCents,
      currency: lineItem.currency
    }
  });
  smokeIds.quoteItemId = quoteItem.id;

  const publicLink = await prisma.quotePublicLink.create({
    data: {
      workspaceId: workspace.id,
      quoteId: quote.id,
      token: generatePublicQuoteToken()
    }
  });
  smokeIds.publicLinkId = publicLink.id;

  return { dealId: deal.id, quoteId: quote.id, token: publicLink.token };
}

async function communicationDealDetailPath() {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  const deal = await prisma.deal.findFirstOrThrow({
    where: { workspaceId: workspace.id, title: "Atlas manager training package", deletedAt: null },
    select: { id: true }
  });
  return `/deals/${deal.id}`;
}

async function createRelationshipBriefSmokeContact(suffix: string) {
  const contact = await prisma.person.create({
    data: {
      email: `browser-flow-${suffix}@example.test`,
      firstName: "Browser",
      lastName: `Relationship Brief ${suffix}`,
      ownerId: smokeAuth.actorUserId,
      relationshipBusinessConcerns: "Wants proof that onboarding will not disrupt active customer work.",
      relationshipCommunicationStyle: "Prefers concise morning email summaries.",
      relationshipFollowUpReminders: "Ask whether the enablement team has finished the rollout checklist.",
      relationshipInternalGuidance: "Keep the implementation-risk discussion internal unless the contact raises it.",
      relationshipPersonalContext: "Rockies fan; prefers implementation stories.",
      workspaceId: smokeAuth.workspaceId
    },
    select: { id: true, firstName: true, lastName: true }
  });
  await prisma.auditLog.create({
    data: {
      action: "person.updated",
      actorId: smokeAuth.actorUserId,
      entityId: contact.id,
      entityType: "Person",
      metadata: {
        relationshipBriefChanges: [
          {
            acceptedFactCount: 1,
            acceptedFacts: ["Prefers concise morning email summaries."],
            changedAt: "2030-06-01T15:30:00.000Z",
            field: "relationshipCommunicationStyle",
            fieldLabel: "Communication style",
            newValue: "Prefers concise morning email summaries.",
            previousValue: null,
            source: {
              intakeId: `browser-relationship-brief-${suffix}`,
              occurredAt: "2030-06-01T14:00:00.000Z",
              title: "Browser Relationship Brief review",
              type: "meeting_intelligence"
            },
            target: {
              id: contact.id,
              label: `${contact.firstName} ${contact.lastName}`,
              type: "person"
            }
          }
        ],
        source: { type: "meeting_intelligence" }
      },
      workspaceId: smokeAuth.workspaceId
    }
  });

  return {
    id: contact.id,
    name: `${contact.firstName} ${contact.lastName}`,
    path: `/contacts/${contact.id}`
  };
}

async function meetingPrepSmokeLinkedRecords(suffix: string) {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: smokeQuote.dealId },
    select: {
      organizationId: true,
      personId: true,
      pipelineId: true,
      stageId: true
    }
  });
  let organizationId = deal.organizationId;
  if (!organizationId) {
    const organization = await prisma.organization.create({
      data: {
        domain: `meeting-prep-${suffix}.example`,
        name: `Browser Flow Meeting Prep Organization ${suffix}`,
        ownerId: smokeAuth.actorUserId,
        workspaceId: smokeAuth.workspaceId
      },
      select: { id: true }
    });
    organizationId = organization.id;
  }

  let personId = deal.personId;
  if (!personId) {
    const person = await prisma.person.create({
      data: {
        email: `browser-flow-meeting-prep-${suffix}@example.test`,
        firstName: "Browser",
        lastName: `Meeting Prep ${suffix}`,
        organizationId,
        ownerId: smokeAuth.actorUserId,
        workspaceId: smokeAuth.workspaceId
      },
      select: { id: true }
    });
    personId = person.id;
  }

  return { organizationId, personId };
}

async function demoWorkspaceId() {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  return workspace.id;
}

async function cleanupSmokeQuote() {
  if (smokeIds.publicLinkId) await prisma.quotePublicLink.deleteMany({ where: { id: smokeIds.publicLinkId } });
  if (smokeIds.quoteItemId) await prisma.quoteItem.deleteMany({ where: { id: smokeIds.quoteItemId } });
  if (smokeIds.quoteId) await prisma.quote.deleteMany({ where: { id: smokeIds.quoteId } });
  if (smokeIds.dealLineItemId) await prisma.dealLineItem.deleteMany({ where: { id: smokeIds.dealLineItemId } });
  if (smokeIds.productId) await prisma.product.deleteMany({ where: { id: smokeIds.productId } });
}

async function cleanupSmokeWebForm() {
  if (smokeIds.webFormLeadId) {
    await prisma.webFormSubmission.deleteMany({ where: { leadId: smokeIds.webFormLeadId } });
    await prisma.auditLog.deleteMany({
      where: {
        entityId: smokeIds.webFormLeadId,
        entityType: "Lead",
        workspaceId: smokeAuth.workspaceId
      }
    });
    await prisma.note.deleteMany({ where: { leadId: smokeIds.webFormLeadId, workspaceId: smokeAuth.workspaceId } });
    await prisma.lead.deleteMany({ where: { id: smokeIds.webFormLeadId, workspaceId: smokeAuth.workspaceId } });
  }
  if (smokeIds.webFormId) {
    await prisma.auditLog.deleteMany({
      where: {
        entityId: smokeIds.webFormId,
        entityType: "WebForm",
        workspaceId: smokeAuth.workspaceId
      }
    });
    await prisma.webFormSubmission.deleteMany({ where: { webFormId: smokeIds.webFormId, workspaceId: smokeAuth.workspaceId } });
    await prisma.webForm.deleteMany({ where: { id: smokeIds.webFormId, workspaceId: smokeAuth.workspaceId } });
  }
}

async function cleanupSmokeScheduler() {
  if (smokeIds.schedulerLinkId) {
    await prisma.auditLog.deleteMany({
      where: {
        entityId: smokeIds.schedulerLinkId,
        entityType: "SchedulerLink",
        workspaceId: smokeAuth.workspaceId
      }
    });
    await prisma.schedulerBooking.deleteMany({
      where: { schedulerLinkId: smokeIds.schedulerLinkId, workspaceId: smokeAuth.workspaceId }
    });
    await prisma.schedulerLink.deleteMany({ where: { id: smokeIds.schedulerLinkId, workspaceId: smokeAuth.workspaceId } });
  }
  if (smokeIds.schedulerActivityId) {
    await prisma.auditLog.deleteMany({
      where: {
        entityId: smokeIds.schedulerActivityId,
        entityType: "Activity",
        workspaceId: smokeAuth.workspaceId
      }
    });
    await prisma.activity.deleteMany({ where: { id: smokeIds.schedulerActivityId, workspaceId: smokeAuth.workspaceId } });
  }
}

async function cleanupBrowserMeetingIntakes() {
  const intakeIds = Array.from(browserMeetingIntakeIds);
  if (intakeIds.length === 0) return;

  await prisma.auditLog.deleteMany({
    where: {
      entityId: { in: intakeIds },
      entityType: "MeetingIntake",
      workspaceId: smokeAuth.workspaceId
    }
  });
  await prisma.meetingIntake.deleteMany({ where: { id: { in: intakeIds }, workspaceId: smokeAuth.workspaceId } });
}

async function cleanupBrowserFlowRecords() {
  if (browserFlowSuffixes.size === 0) return;

  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { slug: "northstar-revenue" },
    select: { id: true }
  });
  const suffixFilters = Array.from(browserFlowSuffixes);
  const [deals, leads, people, organizations] = await Promise.all([
    prisma.deal.findMany({
      where: { workspaceId: workspace.id, OR: suffixFilters.map((suffix) => ({ title: { contains: suffix } })) },
      select: { id: true }
    }),
    prisma.lead.findMany({
      where: { workspaceId: workspace.id, OR: suffixFilters.map((suffix) => ({ title: { contains: suffix } })) },
      select: { id: true }
    }),
    prisma.person.findMany({
      where: {
        workspaceId: workspace.id,
        OR: suffixFilters.flatMap((suffix) => [
          { email: `browser-flow-${suffix}@example.test` },
          { email: `browser-flow-meeting-prep-${suffix}@example.test` }
        ])
      },
      select: { id: true }
    }),
    prisma.organization.findMany({
      where: { workspaceId: workspace.id, OR: suffixFilters.map((suffix) => ({ name: { contains: suffix } })) },
      select: { id: true }
    })
  ]);
  const dealIds = deals.map((deal) => deal.id);
  const leadIds = leads.map((lead) => lead.id);
  const personIds = people.map((person) => person.id);
  const organizationIds = organizations.map((organization) => organization.id);
  const savedViews = await prisma.savedView.findMany({
    where: { workspaceId: workspace.id, OR: suffixFilters.map((suffix) => ({ name: { contains: suffix } })) },
    select: { id: true }
  });
  const activities = await prisma.activity.findMany({
    where: {
      workspaceId: workspace.id,
      OR: [
        ...suffixFilters.map((suffix) => ({ title: { contains: suffix } })),
        { dealId: { in: dealIds } },
        { leadId: { in: leadIds } },
        { personId: { in: personIds } },
        { organizationId: { in: organizationIds } }
      ]
    },
    select: { id: true }
  });
  const notes = await prisma.note.findMany({
    where: {
      workspaceId: workspace.id,
      OR: [
        ...suffixFilters.map((suffix) => ({ body: { contains: suffix } })),
        { dealId: { in: dealIds } },
        { leadId: { in: leadIds } },
        { personId: { in: personIds } },
        { organizationId: { in: organizationIds } }
      ]
    },
    select: { id: true }
  });
  const emailLogs = await prisma.emailLog.findMany({
    where: {
      workspaceId: workspace.id,
      OR: [
        ...suffixFilters.map((suffix) => ({ subject: { contains: suffix } })),
        ...suffixFilters.map((suffix) => ({ body: { contains: suffix } })),
        { dealId: { in: dealIds } },
        { leadId: { in: leadIds } },
        { personId: { in: personIds } },
        { organizationId: { in: organizationIds } }
      ]
    },
    select: { id: true }
  });
  const activityIds = activities.map((activity) => activity.id);
  const noteIds = notes.map((note) => note.id);
  const emailLogIds = emailLogs.map((emailLog) => emailLog.id);
  const savedViewIds = savedViews.map((savedView) => savedView.id);
  const entityIds = [...activityIds, ...noteIds, ...emailLogIds, ...dealIds, ...leadIds, ...personIds, ...organizationIds];

  if (savedViewIds.length > 0) await prisma.savedView.deleteMany({ where: { id: { in: savedViewIds } } });
  if (entityIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { workspaceId: workspace.id, entityId: { in: entityIds } } });
  }
  if (emailLogIds.length > 0) await prisma.emailLog.deleteMany({ where: { id: { in: emailLogIds } } });
  if (noteIds.length > 0) await prisma.note.deleteMany({ where: { id: { in: noteIds } } });
  if (activityIds.length > 0) await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
  if (dealIds.length > 0) await prisma.deal.deleteMany({ where: { id: { in: dealIds } } });
  if (leadIds.length > 0) await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  if (personIds.length > 0) await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  if (organizationIds.length > 0) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
}

async function cleanupBrowserAuthSmokeUsers() {
  const userIds = Array.from(browserAuthSmokeUserIds);
  const invitationIds = Array.from(browserAuthSmokeInvitationIds);
  if (userIds.length === 0 && invitationIds.length === 0) return;

  if (userIds.length > 0 || invitationIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          ...(userIds.length > 0 ? [{ actorId: { in: userIds } }] : []),
          ...(invitationIds.length > 0 ? [{ entityId: { in: invitationIds } }] : [])
        ]
      }
    });
  }
  if (invitationIds.length > 0) await prisma.workspaceInvitation.deleteMany({ where: { id: { in: invitationIds } } });
  if (userIds.length > 0) {
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.workspaceMembership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
