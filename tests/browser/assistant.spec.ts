import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { MembershipRole, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { createLocalSession, revokeLocalSessionToken } from "@/lib/auth/local-auth";
import { localSessionCookieName, serializeLocalSessionCookieValue } from "@/lib/auth/session";
import { defaultAiActionPermissions } from "@/lib/services/ai-action-permissions";

const prisma = new PrismaClient();
const browserBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const activeWorkspaceCookieName = "northstar_workspace";

type AssistantBrowserFixture = {
  ambiguousContactName: string;
  dealId: string;
  expiresAt: Date;
  personId: string;
  primaryContactName: string;
  sessionCookieValue: string;
  token: string;
  userId: string;
  workspaceId: string;
};

let fixture: AssistantBrowserFixture;

test.describe("Assistant review-first browser workflow", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    fixture = await createAssistantBrowserFixture();
  });

  test.beforeEach(async ({ context }) => {
    await resetAssistantBrowserWorkspace();
    await authenticateAssistantBrowserContext(context);
  });

  test.afterAll(async () => {
    await cleanupAssistantBrowserFixture();
    await prisma.$disconnect();
  });

  test("renders permission limits, safe suggestions, and a read-only answer without browser errors", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await expectAssistantPageReady(page);
    await expect(page.getByTestId("assistant-icon")).toHaveCount(2);
    const commandPanelBox = await page.locator(".assistant-command-panel").boundingBox();
    const todayPanelBox = await page.locator(".assistant-today-command-center").boundingBox();
    expect(commandPanelBox?.y ?? 0).toBeLessThan(todayPanelBox?.y ?? 0);
    await expect(commandInput(page)).toHaveAttribute("aria-describedby", /description/);
    await expect(page.getByRole("status")).toContainText("Ready for a review-first CRM question.");
    const todayPanel = page.locator(".assistant-today-command-center");
    const commandCenter = page.getByLabel("Prioritized Assistant Command Center items");
    await expect(page.getByRole("heading", { name: "Command Center" })).toBeVisible();
    await expect(todayPanel).toContainText("Review-first suggestions only");
    await expect(commandCenter).toContainText("Deal needs next activity");
    await expect(commandCenter).toContainText("Quote awaiting follow-up");
    await expect(commandCenter).toContainText("New lead needs review");
    await expect(commandCenter).toContainText("Draft follow-up");
    await expect(commandCenter).toContainText("Why this is here");
    await expect(commandCenter.getByRole("button", { name: /Apply/i })).toHaveCount(0);
    await expect(commandCenter).not.toContainText(/refresh_token|provider payload|access token/i);
    const dealItem = commandCenter.locator(".assistant-today-item").filter({ hasText: "Deal needs next activity" }).first();
    const explanation = dealItem.locator("details.assistant-today-explanation");
    await expect(explanation).not.toHaveAttribute("open", "");
    await explanation.locator("summary").click();
    await expect(explanation).toHaveAttribute("open", "");
    await expect(explanation).toContainText("Rule");
    await expect(explanation).toContainText("Open deal has no upcoming open activity.");
    await expect(explanation).toContainText("Stored values");
    await expect(explanation).toContainText("Threshold");
    await expect(explanation).toContainText("Calculation");
    await expect(explanation).toContainText("Source record");
    await expect(explanation).not.toContainText(/provider payload|providerMessageId|providerThreadId|access token|refresh_token/i);
    const permissionSummary = page.getByLabel("Assistant permissions and limits");
    await expect(permissionSummary).toContainText("Available now");
    await expect(permissionSummary).toContainText("Read-only answers");
    await expect(permissionSummary).toContainText("confirmed activity or note apply, and contact or organization CRM Change Proposals");
    await expect(permissionSummary).toContainText("Settings-only for now");
    await expect(permissionSummary).toContainText("email send, sync, provider mutation, destructive actions, and unsupported automatic actions");

    const suggestions = page.getByLabel("Suggested Assistant prompts");
    await expect(suggestions).toContainText("Help me plan my day.");
    await expect(suggestions).toContainText("What should I focus on?");
    await expect(suggestions).toContainText("Summarize the Acme relationship.");
    await expect(suggestions).toContainText("Which deals look risky?");
    await expect(suggestions).toContainText("Help me prepare for my meeting.");
    await expect(suggestions).toContainText("What am I waiting on?");
    await expect(suggestions).not.toContainText(/create (?:a )?(?:deal|quote|organization)/i);
    await expect(suggestions).not.toContainText(/send|sync|convert|delete|autonomous/i);

    await commandInput(page).fill("Tell me what I have to do today.");
    await page.getByRole("button", { name: "Send" }).click();
    const thread = page.getByLabel("Assistant conversation");
    await expect(thread.getByRole("heading", { name: "Today's Assistant agenda" })).toBeVisible();
    const commandResultUrl = new URL(page.url());
    expect(commandResultUrl.pathname).toBe("/assistant");
    expect(commandResultUrl.searchParams.get("conversation")).toBeTruthy();
    expect(commandResultUrl.searchParams.get("assistantChat")).toBe("sent");
    expect(["", "#assistant-chat-composer"]).toContain(commandResultUrl.hash);
    await expect(thread).toContainText("You");
    await expect(thread).toContainText("Assistant");
    await expect(thread).toContainText("Sources");
    await expect(thread).toContainText("Context-only");
    await expect(thread).toContainText("draft-only");
    await expect(page.getByRole("status")).toContainText("Reply ready in the conversation.");
    await expect(commandInput(page)).toBeFocused();

    await commandInput(page).fill("What should I do first?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("status")).toContainText("Reply ready in the conversation.", { timeout: 15_000 });
    await expect(thread).toContainText("What should I do first?", { timeout: 15_000 });
    await expect(thread.locator(".assistant-chat-message")).toHaveCount(4);
    await page.getByRole("link", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/assistant$/);
    await expect(page.getByLabel("Assistant conversation")).toContainText("ready for a work conversation");

    expect(errors.current()).toEqual([]);
  });

  test("keeps the top command form accessible with empty and loading states", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await expectAssistantPageReady(page);
    await commandInput(page).focus();
    await expect(commandInput(page)).toBeFocused();
    await commandInput(page).fill("");
    await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
    await expect(page.getByRole("status")).toContainText("Ready for a review-first CRM question.");

    await commandInput(page).fill("Tell me what I have to do today.");
    await page.locator(".assistant-command-form").dispatchEvent("submit");
    await expect(page.getByRole("status")).toContainText("is building a review-first reply");

    expect(errors.current()).toEqual([]);
  });

  test("remembers a numbered deal reference across refresh without leaking into New chat", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await expectAssistantPageReady(page);
    await commandInput(page).fill("Show me the highest-risk deals this week.");
    await page.getByRole("button", { name: "Send" }).click();
    const thread = page.getByRole("region", { name: "Assistant conversation" });
    await expect(thread.getByRole("heading", { name: "Highest-risk deals this week" })).toBeVisible({ timeout: 15_000 });

    await commandInput(page).fill("Tell me more about the first one.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(thread).toContainText("Using remembered context", { timeout: 15_000 });
    await expect(thread.getByRole("heading", { name: /Deal brief:/ })).toBeVisible();

    await page.reload();
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.getByRole("heading", { exact: true, name: "Assistant" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chat with Stella" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Assistant conversation" })).toContainText("Using remembered context");

    await page.getByRole("link", { name: "New chat" }).click();
    await expect(page).toHaveURL(/\/assistant$/);
    await commandInput(page).fill("Tell me more about the first one.");
    await page.getByRole("button", { name: "Send" }).click();
    const freshThread = page.getByRole("region", { name: "Assistant conversation" });
    await expect(freshThread).not.toContainText("Using remembered context");
    await expect(freshThread).not.toContainText(/Deal brief:/);

    expect(errors.current()).toEqual([]);
  });

  test("hides a Today Command Center item for today and reveals it across refresh", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await expectAssistantPageReady(page);
    const commandCenter = page.getByLabel("Prioritized Assistant Command Center items");
    const targetItem = commandCenter.locator(".assistant-today-item").filter({ hasText: "Deal needs next activity" }).first();
    await expect(targetItem).toContainText("Assistant command deal");
    await targetItem.getByRole("button", { name: "Hide for today" }).click();
    await expect(page.locator(".assistant-today-command-center")).toContainText("Command Center item hidden for today.");
    await expect(commandCenter).not.toContainText("Deal needs next activity");

    await page.reload();
    await expectAssistantPageReady(page);
    await expect(page.getByLabel("Prioritized Assistant Command Center items")).not.toContainText("Deal needs next activity");
    await page.getByRole("link", { name: /Show hidden \(1\)/ }).click();
    const hiddenItems = page.getByLabel("Hidden Assistant Command Center items");
    await expect(hiddenItems).toContainText("Deal needs next activity");
    await expect(hiddenItems).toContainText("Hidden today");
    await expect(hiddenItems.getByRole("button", { name: "Hide for today" })).toHaveCount(0);
    const hiddenExplanation = hiddenItems.locator("details.assistant-today-explanation").first();
    await hiddenExplanation.locator("summary").click();
    await expect(hiddenExplanation).toHaveAttribute("open", "");
    await expect(hiddenExplanation).toContainText("Open deal has no upcoming open activity.");
    await expect(hiddenExplanation).toContainText("no qualifying upcoming activity");

    expect(errors.current()).toEqual([]);
  });

  test("keeps Today Command Center explanation controls readable on a narrow viewport", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await page.setViewportSize({ width: 360, height: 900 });

    await expectAssistantPageReady(page);
    const commandBoxes = await page.locator(".assistant-command-form textarea, .assistant-command-form button, .assistant-suggestion").evaluateAll((elements) =>
      elements.filter((element) => element.checkVisibility()).map((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, text: element.textContent ?? element.getAttribute("placeholder") ?? "", width: rect.width };
      })
    );
    for (const box of commandBoxes) {
      expect.soft(box.width, `${box.text} should not collapse in the command area`).toBeGreaterThan(88);
      expect.soft(box.height, `${box.text} should stay readable in the command area`).toBeLessThan(120);
    }
    const item = page.getByLabel("Prioritized Assistant Command Center items").locator(".assistant-today-item").filter({ hasText: "Deal needs next activity" }).first();
    await expect(item).toBeVisible();
    await item.locator("summary", { hasText: "Why this is here" }).click();
    await expect(item.locator("details.assistant-today-explanation")).toHaveAttribute("open", "");
    await expect(item).toContainText("Stored values");

    const boxes = await item.locator("summary, .assistant-today-actions .button-compact").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, text: element.textContent ?? "", width: rect.width };
      })
    );
    expect(boxes.length).toBeGreaterThanOrEqual(3);
    for (const box of boxes) {
      expect.soft(box.width, `${box.text} should not collapse into stacked letters`).toBeGreaterThan(72);
      expect.soft(box.height, `${box.text} should stay compact while wrapping`).toBeLessThan(78);
    }
    await expect(item).not.toContainText(/provider payload|refresh_token|access token/i);

    expect(errors.current()).toEqual([]);
  });

  test("saves and applies eligible activity and note drafts from the review queue", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await draftCommand(page, `Remind me to follow up with ${fixture.primaryContactName} next Tuesday.`);
    const activityDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Draft activity" });
    await expect(activityDraft).toContainText("Save, then review");
    await expect(activityDraft).toContainText("Saving does not apply changes");
    await activityDraft.getByRole("button", { name: "Save to review queue" }).click();

    const activityRequest = reviewRequest(page, "Draft activity");
    await expect(activityRequest).toContainText("Review-first activity");
    await expect(activityRequest).toContainText("AI Preferences require confirmation");
    await expect(activityRequest.getByRole("button", { name: "Apply activity" })).toBeVisible();
    await activityRequest.getByRole("button", { name: "Apply activity" }).click();
    await expect(activityRequest).toContainText("APPLIED");
    await expect(activityRequest).toContainText("This request has already been applied and cannot be applied again.");
    await expect(activityRequest).toHaveClass(/assistant-review-request-applied/);
    await expect(activityRequest.getByRole("button", { name: /Apply activity/i })).toHaveCount(0);

    await draftCommand(page, `Add a note for ${fixture.primaryContactName}: she prefers concise email updates.`);
    const noteDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Draft note" });
    await expect(noteDraft).toContainText("Save, then review");
    await noteDraft.getByRole("button", { name: "Save to review queue" }).click();

    const noteRequest = reviewRequest(page, "Draft note");
    await expect(noteRequest).toContainText("Review-first note");
    await expect(noteRequest).toContainText("AI Preferences require confirmation");
    await expect(noteRequest.getByRole("button", { name: "Apply note" })).toBeVisible();
    await noteRequest.getByRole("button", { name: "Apply note" }).click();
    await expect(noteRequest).toContainText("APPLIED");
    await expect(noteRequest).toContainText("This request has already been applied and cannot be applied again.");
    await expect(noteRequest).toHaveClass(/assistant-review-request-applied/);
    await expect(noteRequest.getByRole("button", { name: /Apply note/i })).toHaveCount(0);

    expect(errors.current()).toEqual([]);
  });

  test("opens a deal action plan and drafts a reviewed deal follow-up", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await page.goto(`/deals/${fixture.dealId}`);
    await expect(page.getByRole("heading", { level: 1, name: /Assistant command deal/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ask Assistant about this deal" })).toBeVisible();
    await page.getByRole("link", { name: "Action plan" }).click();
    await expect(page).toHaveURL(/\/assistant\?command=/);
    const thread = page.getByLabel("Assistant conversation");
    await expect(thread.getByRole("heading", { name: /Deal action plan:/ })).toBeVisible();
    await expect(thread).toContainText("Immediate follow-ups");
    await expect(thread).toContainText("Commercial attention");
    await expect(thread).not.toContainText(/providerMessageId|providerThreadId|refresh_token|access token/i);

    const activityDraft = thread.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Prepare action-plan activity" });
    await expect(activityDraft).toContainText("Save, then review");
    await expect(activityDraft).toContainText("Description");
    await activityDraft.getByRole("button", { name: "Save to review queue" }).click();
    const request = reviewRequest(page, "Prepare action-plan activity");
    await expect(request).toContainText("Review-first activity");
    await expect(request).toContainText("Apply activity");

    expect(errors.current()).toEqual([]);
  });

  test("opens a deal latest-changes brief from deal detail", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await page.goto(`/deals/${fixture.dealId}`);
    await expect(page.getByRole("heading", { level: 1, name: /Assistant command deal/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Latest changes" })).toBeVisible();
    await page.getByRole("link", { name: "Latest changes" }).click();
    await expect(page).toHaveURL(/\/assistant\?command=/);
    const thread = page.getByLabel("Assistant conversation");
    await expect(thread.getByRole("heading", { name: /Deal change brief:/ })).toBeVisible();
    await expect(thread).toContainText("Since when");
    await expect(thread).toContainText("Recommended follow-up");
    await expect(thread).not.toContainText(/providerMessageId|providerThreadId|refresh_token|access token/i);

    expect(errors.current()).toEqual([]);
  });

  test("routes supported contact drafts into CRM change proposals before applying", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    const email = `proposal-${randomUUID()}@example.test`;

    await prisma.workspace.update({
      data: {
        aiActionPermissionDefaults: {
          ...defaultAiActionPermissions,
          create_contact: "require_confirmation"
        }
      },
      where: { id: fixture.workspaceId }
    });

    await draftCommand(page, `Create a contact for Browser Proposal with email ${email} and phone 555-0177.`);
    const contactDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Propose creating contact" });
    await expect(contactDraft).toContainText("Save, then review");
    await expect(contactDraft).toContainText("Email");
    await expect(contactDraft).toContainText("Not provided");
    await expect(contactDraft).toContainText("[redacted email]");
    await expect(contactDraft).not.toContainText(email);
    await expect(contactDraft).toContainText("Phone");

    await Promise.all([
      page.waitForURL(/\/crm-change-proposals\/[^/]+\?source=assistant$/),
      contactDraft.getByRole("button", { name: "Save to review queue" }).click()
    ]);

    await expect(page.getByRole("heading", { level: 1, name: /Create contact: Browser/i })).toBeVisible();
    await expect(page.getByLabel("CRM change proposal summary")).toContainText("Assistant conversation");
    await expect(page.getByText("Current vs Proposed")).toBeVisible();
    await expect(page.getByLabel("CRM change proposal summary")).toContainText("Create contacts");

    const proposalUrl = page.url();
    await page.goto("/assistant");
    const pendingProposalOutcome = reviewQueue(page).getByLabel("CRM proposal outcomes").locator(".assistant-proposal-outcome").first();
    await expect(pendingProposalOutcome).toContainText("CRM Change Proposal pending review");
    await expect(pendingProposalOutcome).toContainText("Requested action");
    await expect(pendingProposalOutcome).toContainText("Selected record");
    await expect(pendingProposalOutcome.getByRole("link", { name: "Review proposal" })).toBeVisible();

    await page.goto(proposalUrl);
    await page.locator('input[name="field.firstName"]').fill("Browser Reviewed");
    await page.getByRole("button", { name: "Apply reviewed change" }).click();
    await expect(page).toHaveURL(/status=applied/);
    await expect(page.getByText("CRM change proposal applied after review.")).toBeVisible();
    await expect(page.getByLabel("CRM change proposal summary").getByRole("link", { name: "Applied contact" })).toBeVisible();

    await page.goto("/assistant?queue=applied");
    const appliedProposalOutcome = reviewQueue(page).getByLabel("CRM proposal outcomes").locator(".assistant-proposal-outcome").first();
    await expect(appliedProposalOutcome).toContainText("Proposal applied");
    await expect(appliedProposalOutcome).toContainText("Applied record");
    await expect(appliedProposalOutcome.getByRole("link", { name: "Applied contact" })).toBeVisible();

    const created = await prisma.person.findFirst({
      where: { firstName: "Browser Reviewed", lastName: "Proposal", phone: "555-0177", workspaceId: fixture.workspaceId },
      select: { firstName: true, lastName: true, phone: true }
    });
    expect(created).toEqual({ firstName: "Browser Reviewed", lastName: "Proposal", phone: "555-0177" });
    expect(errors.current()).toEqual([]);
  });

  test("clarifies an ambiguous contact update in chat before creating a CRM proposal", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await prisma.workspace.update({
      data: {
        aiActionPermissionDefaults: {
          ...defaultAiActionPermissions,
          update_contact: "require_confirmation"
        }
      },
      where: { id: fixture.workspaceId }
    });

    await draftCommand(page, `Update ${fixture.ambiguousContactName}'s phone to 555-0190.`);
    const ambiguousDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Propose updating contact" }).first();
    await expect(ambiguousDraft).toContainText("Needs clarification");
    await expect(ambiguousDraft).toContainText("Candidates to review");
    await expect(ambiguousDraft.getByRole("button", { name: "Use this contact" }).first()).toBeVisible();

    await ambiguousDraft.getByRole("button", { name: "Use this contact" }).first().click();
    await expect(page.getByRole("heading", { name: "Clarification applied" })).toBeVisible();
    const finalDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Propose updating contact" }).last();
    await expect(finalDraft).toContainText("High");
    await expect(finalDraft).toContainText("555-0190");

    await Promise.all([
      page.waitForURL(/\/crm-change-proposals\/[^/]+\?source=assistant$/),
      finalDraft.getByRole("button", { name: "Save to review queue" }).click()
    ]);
    await expect(page.getByRole("heading", { level: 1, name: /Update contact:/i })).toBeVisible();
    await expect(page.getByText("Current vs Proposed")).toBeVisible();
    await expect(page.getByText("555-0190")).toBeVisible();
    expect(errors.current()).toEqual([]);
  });

  test("blocks unsupported and ambiguous drafts from applying in the UI", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await draftCommand(page, "Make email replies more casual and concise.");
    const preferenceDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Draft AI preference change" });
    await expect(preferenceDraft).toContainText("Review-only for now");
    await preferenceDraft.getByRole("button", { name: "Save to review queue" }).click();

    const preferenceRequest = reviewRequest(page, "Draft AI preference change");
    await expect(preferenceRequest).toContainText("settings-only until a scoped apply handler exists");
    await expect(preferenceRequest.getByRole("button", { name: /Apply/i })).toHaveCount(0);
    await preferenceRequest.getByRole("button", { name: "Reject request" }).click();
    await expect(preferenceRequest).toContainText("REJECTED");
    await expect(preferenceRequest).toContainText("This request was rejected and cannot be applied.");
    await expect(preferenceRequest).toHaveClass(/assistant-review-request-rejected/);

    await draftCommand(page, `Remind me to follow up with ${fixture.ambiguousContactName} tomorrow.`);
    const ambiguousDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Draft activity" });
    await expect(ambiguousDraft).toContainText("Needs clearer target");
    await expect(ambiguousDraft).toContainText("Candidates to review");
    await ambiguousDraft.getByRole("button", { name: "Save to review queue" }).click();

    const ambiguousRequest = reviewRequest(page, `Follow up with ${fixture.ambiguousContactName}`);
    await expect(ambiguousRequest).toContainText("Apply is only available for pending supported requests with clear targets, supported fields, and explicit review.");
    await expect(ambiguousRequest.getByRole("button", { name: /Apply/i })).toHaveCount(0);
    await expect(ambiguousRequest.getByRole("button", { name: "Reject request" })).toBeVisible();

    expect(errors.current()).toEqual([]);
  });

  test("filters the review queue without deleting completed requests", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await expectAssistantPageReady(page);
    const queue = reviewQueue(page);
    await expect(queue.getByRole("link", { name: /Pending \(0\)/ })).toHaveAttribute("aria-current", "page");
    await expect(queue).toContainText("No pending Assistant action requests.");

    await queue.getByRole("link", { name: /Applied \(0\)/ }).click();
    await expect(queue).toContainText("No applied Assistant action requests yet.");
    await expect(queue).toContainText("Hide completed requests");

    await queue.getByRole("link", { name: /Rejected \(0\)/ }).click();
    await expect(queue).toContainText("No rejected Assistant action requests yet.");

    await queue.getByRole("link", { name: /All \(0\)/ }).click();
    await expect(queue).toContainText("No Assistant action requests yet.");

    await draftCommand(page, `Remind me to follow up with ${fixture.primaryContactName} next Tuesday.`);
    const activityDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Draft activity" });
    await activityDraft.getByRole("button", { name: "Save to review queue" }).click();
    const pendingActivity = reviewRequest(page, "Draft activity");
    await expect(pendingActivity).toContainText("Created");
    await expect(pendingActivity).toContainText("Action type");
    await expect(pendingActivity).toContainText("Activity");
    await expect(pendingActivity).toContainText("Apply availability");
    await expect(pendingActivity.getByRole("button", { name: "Apply activity" })).toBeVisible();
    await pendingActivity.getByRole("button", { name: "Apply activity" }).click();

    const appliedActivity = reviewRequest(page, "Draft activity");
    await expect(reviewQueue(page).getByRole("link", { name: /Applied \(1\)/ })).toHaveAttribute("aria-current", "page");
    await expect(appliedActivity).toContainText("APPLIED");
    await expect(appliedActivity.getByRole("button", { name: /Apply activity/i })).toHaveCount(0);

    await reviewQueue(page).getByRole("link", { name: /Pending \(0\)/ }).click();
    await expect(reviewQueue(page)).toContainText("No pending Assistant action requests.");
    await expect(reviewRequest(page, "Draft activity")).toHaveCount(0);

    await draftCommand(page, "Make email replies more casual and concise.");
    const preferenceDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Draft AI preference change" });
    await preferenceDraft.getByRole("button", { name: "Save to review queue" }).click();
    const preferenceRequest = reviewRequest(page, "Draft AI preference change");
    await expect(preferenceRequest).toContainText("Review-only");
    await expect(preferenceRequest.getByRole("button", { name: /Apply/i })).toHaveCount(0);
    await preferenceRequest.getByRole("button", { name: "Reject request" }).click();
    await expect(reviewQueue(page).getByRole("link", { name: /Rejected \(1\)/ })).toHaveAttribute("aria-current", "page");
    await expect(reviewRequest(page, "Draft AI preference change")).toContainText("REJECTED");

    await reviewQueue(page).getByRole("link", { name: /All \(2\)/ }).click();
    await expect(reviewRequest(page, "Draft activity")).toContainText("APPLIED");
    await expect(reviewRequest(page, "Draft AI preference change")).toContainText("REJECTED");
    await expect(reviewQueue(page)).not.toContainText("refresh_token");
    await expect(reviewQueue(page)).not.toContainText("provider payload");

    expect(errors.current()).toEqual([]);
  });

  test("saves AI action permissions back to the active settings section on narrow viewports", async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await page.setViewportSize({ width: 390, height: 900 });

    await page.goto(`${browserBaseUrl}/settings/ai`);
    await expect(page.getByRole("heading", { exact: true, name: "AI Preferences" })).toBeVisible();
    const permissions = page.locator("#ai-permissions");
    await expect(permissions).toContainText("Assistant Action Boundaries");
    await expect(permissions).toContainText("Never allow");
    await expect(permissions).toContainText("Allow automatically");
    const followUps = permissions.locator("details.ai-permission-group").filter({ hasText: "Follow-ups and notes" }).first();
    await expect(followUps).toHaveAttribute("open", "");
    await expect(followUps).toContainText("Create follow-up activities");
    await expect(followUps).toContainText("Create notes");
    await followUps.locator('select[name="assistantActionPermission:create_note"]').selectOption("suggest_only");
    await followUps.getByRole("button", { name: "Save follow-ups and notes" }).click();

    await expect(page).toHaveURL(/\/settings\/ai\?saved=1&section=permissions&group=follow_ups_notes(?:#ai-permissions)?$/);
    await expect(page.locator(".form-success")).toContainText("AI preferences saved.");
    await expect(followUps).toHaveAttribute("open", "");
    await expect(followUps.locator('select[name="assistantActionPermission:create_note"]')).toHaveValue("suggest_only");

    const controlBoxes = await permissions.locator("summary, select, button").evaluateAll((elements) =>
      elements.filter((element) => element.checkVisibility()).map((element) => {
        const rect = element.getBoundingClientRect();
        return { height: rect.height, text: element.textContent ?? "", width: rect.width };
      })
    );
    for (const box of controlBoxes) {
      expect.soft(box.width, `${box.text} should stay readable in AI permission controls`).toBeGreaterThan(86);
      expect.soft(box.height, `${box.text} should not become a tall narrow control`).toBeLessThan(120);
    }

    expect(errors.current()).toEqual([]);
  });
});

async function createAssistantBrowserFixture(): Promise<AssistantBrowserFixture> {
  const suffix = randomUUID();
  const nameSuffix = suffix.slice(0, 8);
  const primaryContactName = `Avery Assistant ${nameSuffix}`;
  const ambiguousContactName = `Jordan River ${nameSuffix}`;
  const user = await prisma.user.create({
    data: { email: `assistant-browser-${suffix}@example.test`, name: "Assistant Browser" }
  });
  const workspace = await prisma.workspace.create({
    data: {
      memberships: { create: { role: MembershipRole.OWNER, userId: user.id } },
      name: `Assistant Browser ${suffix}`,
      slug: `assistant-browser-${suffix}`
    }
  });
  const [person] = await prisma.person.createManyAndReturn({
    data: [
      {
        email: `avery-${suffix}@example.test`,
        firstName: "Avery",
        lastName: `Assistant ${nameSuffix}`,
        ownerId: user.id,
        workspaceId: workspace.id
      },
      {
        email: `jordan-one-${suffix}@example.test`,
        firstName: "Jordan",
        lastName: `River ${nameSuffix}`,
        workspaceId: workspace.id
      },
      {
        email: `jordan-two-${suffix}@example.test`,
        firstName: "Jordan",
        lastName: `River ${nameSuffix}`,
        workspaceId: workspace.id
      }
    ],
    select: { id: true }
  });
  const pipeline = await prisma.pipeline.create({
    data: { name: `Assistant Pipeline ${nameSuffix}`, sortOrder: 1, workspaceId: workspace.id }
  });
  const stage = await prisma.pipelineStage.create({
    data: { name: "Review", pipelineId: pipeline.id, sortOrder: 1, workspaceId: workspace.id }
  });
  const organization = await prisma.organization.create({
    data: { name: `Assistant Org ${nameSuffix}`, ownerId: user.id, workspaceId: workspace.id }
  });
  const deal = await prisma.deal.create({
    data: {
      organizationId: organization.id,
      ownerId: user.id,
      pipelineId: pipeline.id,
      stageId: stage.id,
      title: `Assistant command deal ${nameSuffix}`,
      updatedAt: new Date("2026-07-09T12:00:00.000Z"),
      workspaceId: workspace.id
    }
  });
  await prisma.quote.create({
    data: {
      dealId: deal.id,
      number: `BROWSER-${nameSuffix}`,
      status: "SENT",
      subtotalCents: 25000,
      totalCents: 25000,
      updatedAt: new Date("2026-07-01T12:00:00.000Z"),
      workspaceId: workspace.id
    }
  });
  await prisma.lead.create({
    data: {
      ownerId: user.id,
      source: "Assistant browser fixture",
      title: `Assistant browser lead ${nameSuffix}`,
      workspaceId: workspace.id
    }
  });
  const session = await createLocalSession(user.id);
  return {
    ambiguousContactName,
    dealId: deal.id,
    expiresAt: session.expiresAt,
    personId: person.id,
    primaryContactName,
    sessionCookieValue: serializeLocalSessionCookieValue(session.token),
    token: session.token,
    userId: user.id,
    workspaceId: workspace.id
  };
}

async function resetAssistantBrowserWorkspace() {
  await prisma.aiPreference.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.workspace.update({
    data: { aiActionPermissionDefaults: defaultAiActionPermissions },
    where: { id: fixture.workspaceId }
  });
  await prisma.crmChangeProposal.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantTodayItemHide.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantConversationMessage.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantConversation.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantActionRequest.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.activity.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.note.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.person.deleteMany({ where: { email: { startsWith: "proposal-" }, workspaceId: fixture.workspaceId } });
}

async function cleanupAssistantBrowserFixture() {
  if (!fixture) return;
  if (fixture.token) await revokeLocalSessionToken(fixture.token);
  await prisma.assistantTodayItemHide.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantConversationMessage.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantConversation.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantActionRequest.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.crmChangeProposal.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.aiPreference.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.activity.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.note.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.quote.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.deal.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.lead.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.person.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.organization.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.pipelineStage.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.pipeline.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.workspace.deleteMany({ where: { id: fixture.workspaceId } });
  await prisma.session.deleteMany({ where: { userId: fixture.userId } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

async function authenticateAssistantBrowserContext(context: BrowserContext) {
  await context.addCookies([
    {
      expires: Math.floor(fixture.expiresAt.getTime() / 1000),
      httpOnly: true,
      name: localSessionCookieName,
      sameSite: "Lax",
      url: browserBaseUrl,
      value: fixture.sessionCookieValue
    },
    {
      expires: Math.floor(fixture.expiresAt.getTime() / 1000),
      name: activeWorkspaceCookieName,
      sameSite: "Lax",
      url: browserBaseUrl,
      value: fixture.workspaceId
    }
  ]);
}

async function expectAssistantPageReady(page: Page) {
  await page.goto("/assistant");
  await expect(page.locator("#main-content")).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Assistant" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chat with Stella" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
}

async function draftCommand(page: Page, command: string) {
  await expectAssistantPageReady(page);
  await commandInput(page).fill(command);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "Draft action for review" })).toBeVisible();
}

function commandInput(page: Page) {
  return page.getByRole("textbox", { name: /^Message\b/ });
}

function reviewRequest(page: Page, text: string) {
  return page.locator(".assistant-review-request").filter({ hasText: text }).first();
}

function reviewQueue(page: Page) {
  return page.locator("#assistant-review-queue");
}

function watchBrowserErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return { current: () => errors };
}
