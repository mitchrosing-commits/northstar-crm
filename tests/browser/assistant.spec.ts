import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { MembershipRole, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { createLocalSession, revokeLocalSessionToken } from "@/lib/auth/local-auth";
import { localSessionCookieName, serializeLocalSessionCookieValue } from "@/lib/auth/session";

const prisma = new PrismaClient();
const browserBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const activeWorkspaceCookieName = "northstar_workspace";

type AssistantBrowserFixture = {
  ambiguousContactName: string;
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
    await expect(permissionSummary).toContainText("confirmed activity or note apply");
    await expect(permissionSummary).toContainText("Review-only for now");
    await expect(permissionSummary).toContainText("email send, sync, and autonomous actions");

    const suggestions = page.getByLabel("Suggested Assistant prompts");
    await expect(suggestions).toContainText("Tell me what I have to do today.");
    await expect(suggestions).toContainText("Show me the highest-risk deals this week.");
    await expect(suggestions).toContainText("Check whether Mike Fox replied to my recent email.");
    await expect(suggestions).toContainText("Remind me to follow up with Jane Doe next Tuesday.");
    await expect(suggestions).toContainText("Add a note for Jane Doe: she prefers concise email updates.");
    await expect(suggestions).not.toContainText(/create (?:a )?(?:deal|quote|organization)/i);
    await expect(suggestions).not.toContainText(/send|sync|convert|delete|autonomous/i);

    await commandInput(page).fill("Tell me what I have to do today.");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByRole("heading", { name: "Today's Assistant agenda" })).toBeVisible();
    await expect(page.getByLabel("Assistant answer")).toContainText("Context-only");
    await expect(page.getByLabel("Assistant answer")).toContainText("Draft only");

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
    await expect(activityRequest).toContainText("Review-first activity creation");
    await expect(activityRequest).toContainText("Apply will create one activity after this explicit review step.");
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
    await expect(noteRequest).toContainText("Review-first note creation");
    await expect(noteRequest).toContainText("Apply will create one note after this explicit review step.");
    await expect(noteRequest.getByRole("button", { name: "Apply note" })).toBeVisible();
    await noteRequest.getByRole("button", { name: "Apply note" }).click();
    await expect(noteRequest).toContainText("APPLIED");
    await expect(noteRequest).toContainText("This request has already been applied and cannot be applied again.");
    await expect(noteRequest).toHaveClass(/assistant-review-request-applied/);
    await expect(noteRequest.getByRole("button", { name: /Apply note/i })).toHaveCount(0);

    expect(errors.current()).toEqual([]);
  });

  test("blocks unsupported and ambiguous drafts from applying in the UI", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await draftCommand(page, "Make email replies more casual and concise.");
    const preferenceDraft = page.getByLabel("Assistant draft actions").locator(".assistant-draft-card").filter({ hasText: "Draft AI preference change" });
    await expect(preferenceDraft).toContainText("Review-only for now");
    await preferenceDraft.getByRole("button", { name: "Save to review queue" }).click();

    const preferenceRequest = reviewRequest(page, "Draft AI preference change");
    await expect(preferenceRequest).toContainText("AI preference changes are review-only for now");
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
    await expect(ambiguousRequest).toContainText("Apply is blocked until one clear target record is selected.");
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
  await prisma.assistantTodayItemHide.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantActionRequest.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.activity.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.note.deleteMany({ where: { workspaceId: fixture.workspaceId } });
}

async function cleanupAssistantBrowserFixture() {
  if (!fixture) return;
  if (fixture.token) await revokeLocalSessionToken(fixture.token);
  await prisma.assistantTodayItemHide.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.assistantActionRequest.deleteMany({ where: { workspaceId: fixture.workspaceId } });
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
  await expect(page.getByRole("heading", { name: "Ask Northstar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
}

async function draftCommand(page: Page, command: string) {
  await expectAssistantPageReady(page);
  await commandInput(page).fill(command);
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByRole("heading", { name: "Draft action for review" })).toBeVisible();
}

function commandInput(page: Page) {
  return page.getByRole("textbox", { name: /^Command\b/ });
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
