import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { MembershipRole, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { createLocalSession, revokeLocalSessionToken } from "@/lib/auth/local-auth";
import { localSessionCookieName, serializeLocalSessionCookieValue } from "@/lib/auth/session";

const prisma = new PrismaClient();
const browserBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const activeWorkspaceCookieName = "northstar_workspace";

type EmailAiReplyBrowserFixture = {
  currentEmailId: string;
  emptyProviderEmailId: string;
  expiresAt: Date;
  noReplyEmailId: string;
  otherUserId: string;
  otherWorkspaceId: string;
  sessionCookieValue: string;
  token: string;
  userId: string;
  workspaceId: string;
};

let fixture: EmailAiReplyBrowserFixture;

test.describe("Email AI Reply Assistant browser flow", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    fixture = await createEmailAiReplyBrowserFixture();
  });

  test.beforeEach(async ({ context }) => {
    await authenticateEmailAiReplyBrowserContext(context);
  });

  test.afterAll(async () => {
    await cleanupEmailAiReplyBrowserFixture();
    await prisma.$disconnect();
  });

  test("generates and displays an editable draft from a stored Inbox thread", async ({ page }) => {
    const countsBefore = await readMutationGuardCounts();
    const errors = watchBrowserErrors(page);

    await openEmailThread(page, "Browser AI Reply Main");

    const panel = page.locator("#email-ai-reply-panel");
    await panel.getByText("Draft with AI").click();
    await panel.getByRole("button", { name: "Generate reply" }).click();

    await expect(panel.getByText("AI draft generated. Review and edit before using it.")).toBeVisible();
    await expect(panel.getByRole("textbox", { name: /Subject suggestion/ })).toHaveValue("Re: Browser AI Reply Main");
    const draft = panel.getByRole("textbox", { name: /Draft reply/ });
    await expect(draft).toHaveValue(/Hi Browser Buyer,/);
    await expect(draft).toHaveValue(/Thread context order: First stored thread context for browser -> Second stored thread context for browser\./);
    await expect(draft).toHaveValue(/Primary reply target: Current browser customer asks for next steps\./);
    await expect(draft).not.toHaveValue(/cross-workspace|unrelated-thread/i);
    await draft.fill("Edited browser AI reply draft.");
    await expect(draft).toHaveValue("Edited browser AI reply draft.");
    await expect(panel.getByText("Suggested next action: Review this draft before using it.")).toBeVisible();
    await expect(panel.getByText("Deterministic browser test draft. Northstar still does not send automatically.")).toBeVisible();
    await expect(readMutationGuardCounts()).resolves.toEqual(countsBefore);
    expect(actionableBrowserErrors(errors.current())).toEqual([]);
  });

  test("shows a sanitized UI error when the provider returns no draft", async ({ page }) => {
    const errors = watchBrowserErrors(page);

    await openEmailThread(page, "Browser AI Empty Provider");

    const panel = page.locator("#email-ai-reply-panel");
    await panel.getByText("Draft with AI").click();
    await panel.getByRole("button", { name: "Generate reply" }).click();

    await expect(panel.getByText("AI email reply provider returned no draft.")).toBeVisible();
    await expect(panel.getByRole("textbox", { name: /Draft reply/ })).toHaveCount(0);
    await expect(panel).not.toContainText(/raw-secret-token|authorization|stack|provider payload/i);
    expect(actionableBrowserErrors(errors.current())).toEqual([]);
  });

  test("keeps no-reply messages in the current explicit draft-only state", async ({ page }) => {
    await openEmailThread(page, "Browser AI No Reply Eligibility");

    const panel = page.locator("#email-ai-reply-panel");
    await panel.getByText("Draft with AI").click();

    await expect(panel.getByText("Review-first only.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Generate reply" })).toBeVisible();
  });
});

async function openEmailThread(page: Page, subject: string) {
  await page.goto("/email");
  await expect(page.locator("#main-content")).toBeVisible();
  await page.getByRole("link", { name: new RegExp(`Open inbox thread ${escapeRegExp(subject)}`) }).click();
  await expect(page.locator(".email-inbox-thread-detail")).toContainText(subject);
}

async function createEmailAiReplyBrowserFixture(): Promise<EmailAiReplyBrowserFixture> {
  const suffix = randomUUID();
  const nameSuffix = suffix.slice(0, 8);
  const user = await prisma.user.create({
    data: { email: `email-ai-reply-browser-${suffix}@example.test`, name: "Email AI Reply Browser" }
  });
  const workspace = await prisma.workspace.create({
    data: {
      memberships: { create: { role: MembershipRole.OWNER, userId: user.id } },
      name: `Email AI Reply Browser ${nameSuffix}`,
      slug: `email-ai-reply-browser-${suffix}`
    }
  });
  const otherUser = await prisma.user.create({
    data: { email: `email-ai-reply-other-${suffix}@example.test`, name: "Email AI Other Browser" }
  });
  const otherWorkspace = await prisma.workspace.create({
    data: {
      memberships: { create: { role: MembershipRole.OWNER, userId: otherUser.id } },
      name: `Email AI Reply Other ${nameSuffix}`,
      slug: `email-ai-reply-other-${suffix}`
    }
  });
  const connection = await prisma.emailConnection.create({
    data: {
      accountEmail: `sales-${suffix}@example.test`,
      createdById: user.id,
      lastSyncAt: new Date("2030-01-04T12:00:00.000Z"),
      provider: "GOOGLE_WORKSPACE",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
      status: "CONNECTED",
      workspaceId: workspace.id
    }
  });
  const otherConnection = await prisma.emailConnection.create({
    data: {
      accountEmail: `other-${suffix}@example.test`,
      createdById: otherUser.id,
      provider: "GOOGLE_WORKSPACE",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
      status: "CONNECTED",
      workspaceId: otherWorkspace.id
    }
  });
  const threadId = `email-ai-reply-thread-${suffix}`;
  await prisma.emailLog.createMany({
    data: [
      {
        body: "First stored thread context for browser",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: "Browser Buyer <buyer@example.test>",
        occurredAt: new Date("2030-01-02T09:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX"],
        providerMessageId: `email-ai-reply-message-1-${suffix}`,
        providerSnippet: "First stored thread context for browser",
        providerThreadId: threadId,
        subject: "Browser AI Reply Main",
        toText: `sales-${suffix}@example.test`,
        workspaceId: workspace.id
      },
      {
        body: "Second stored thread context for browser",
        direction: "OUTBOUND",
        emailConnectionId: connection.id,
        fromText: `sales-${suffix}@example.test`,
        occurredAt: new Date("2030-01-02T10:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["SENT"],
        providerMessageId: `email-ai-reply-message-2-${suffix}`,
        providerSnippet: "Second stored thread context for browser",
        providerThreadId: threadId,
        subject: "Re: Browser AI Reply Main",
        toText: "Browser Buyer <buyer@example.test>",
        workspaceId: workspace.id
      },
      {
        body: "Current browser customer asks for next steps.",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: "Browser Buyer <buyer@example.test>",
        occurredAt: new Date("2030-01-03T09:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX", "UNREAD"],
        providerMessageId: `email-ai-reply-message-3-${suffix}`,
        providerSnippet: "Current browser customer asks for next steps.",
        providerThreadId: threadId,
        subject: "Browser AI Reply Main",
        toText: `sales-${suffix}@example.test`,
        workspaceId: workspace.id
      },
      {
        body: "unrelated-thread should not appear in the AI draft context",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: "Unrelated Sender <unrelated@example.test>",
        occurredAt: new Date("2030-01-03T10:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX"],
        providerMessageId: `email-ai-reply-unrelated-${suffix}`,
        providerSnippet: "unrelated-thread should not appear",
        providerThreadId: `email-ai-reply-unrelated-thread-${suffix}`,
        subject: "Browser AI Unrelated Thread",
        toText: `sales-${suffix}@example.test`,
        workspaceId: workspace.id
      },
      {
        body: "cross-workspace should not appear in the AI draft context",
        direction: "INBOUND",
        emailConnectionId: otherConnection.id,
        fromText: "Other Buyer <other@example.test>",
        occurredAt: new Date("2030-01-03T11:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX"],
        providerMessageId: `email-ai-reply-other-${suffix}`,
        providerSnippet: "cross-workspace should not appear",
        providerThreadId: threadId,
        subject: "Browser AI Reply Main",
        toText: `other-${suffix}@example.test`,
        workspaceId: otherWorkspace.id
      }
    ]
  });
  const [currentEmail, emptyProviderEmail, noReplyEmail] = await prisma.$transaction([
    prisma.emailLog.findFirstOrThrow({
      where: { providerMessageId: `email-ai-reply-message-3-${suffix}`, workspaceId: workspace.id },
      select: { id: true }
    }),
    prisma.emailLog.create({
      data: {
        body: "Trigger an empty provider output for a sanitized UI error.",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: "Browser Buyer <buyer@example.test>",
        occurredAt: new Date("2030-01-04T09:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX"],
        providerMessageId: `email-ai-reply-empty-${suffix}`,
        providerSnippet: "Trigger empty provider output",
        providerThreadId: `email-ai-reply-empty-thread-${suffix}`,
        subject: "Browser AI Empty Provider",
        toText: `sales-${suffix}@example.test`,
        workspaceId: workspace.id
      },
      select: { id: true }
    }),
    prisma.emailLog.create({
      data: {
        body: "Automated status notice.",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: "No Reply <no-reply@vendor.example>",
        occurredAt: new Date("2030-01-04T10:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX"],
        providerMessageId: `email-ai-reply-no-reply-${suffix}`,
        providerSnippet: "Automated status notice.",
        providerThreadId: `email-ai-reply-no-reply-thread-${suffix}`,
        subject: "Browser AI No Reply Eligibility",
        toText: `sales-${suffix}@example.test`,
        workspaceId: workspace.id
      },
      select: { id: true }
    })
  ]);
  const session = await createLocalSession(user.id);
  return {
    currentEmailId: currentEmail.id,
    emptyProviderEmailId: emptyProviderEmail.id,
    expiresAt: session.expiresAt,
    noReplyEmailId: noReplyEmail.id,
    otherUserId: otherUser.id,
    otherWorkspaceId: otherWorkspace.id,
    sessionCookieValue: serializeLocalSessionCookieValue(session.token),
    token: session.token,
    userId: user.id,
    workspaceId: workspace.id
  };
}

async function authenticateEmailAiReplyBrowserContext(context: BrowserContext) {
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

async function cleanupEmailAiReplyBrowserFixture() {
  if (!fixture) return;
  if (fixture.token) await revokeLocalSessionToken(fixture.token);
  await prisma.auditLog.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.emailLog.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.emailConnectionSecret.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.emailConnection.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.workspace.deleteMany({ where: { id: fixture.workspaceId } });
  await prisma.session.deleteMany({ where: { userId: fixture.userId } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
  await prisma.auditLog.deleteMany({ where: { workspaceId: fixture.otherWorkspaceId } });
  await prisma.emailLog.deleteMany({ where: { workspaceId: fixture.otherWorkspaceId } });
  await prisma.emailConnectionSecret.deleteMany({ where: { workspaceId: fixture.otherWorkspaceId } });
  await prisma.emailConnection.deleteMany({ where: { workspaceId: fixture.otherWorkspaceId } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: fixture.otherWorkspaceId } });
  await prisma.workspace.deleteMany({ where: { id: fixture.otherWorkspaceId } });
  await prisma.session.deleteMany({ where: { userId: fixture.otherUserId } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: fixture.otherUserId } });
  await prisma.user.deleteMany({ where: { id: fixture.otherUserId } });
}

async function readMutationGuardCounts() {
  const where = { workspaceId: fixture.workspaceId };
  const [emailLogs, activities, notes, people, organizations, leads, deals, assistantActionRequests] = await Promise.all([
    prisma.emailLog.count({ where }),
    prisma.activity.count({ where }),
    prisma.note.count({ where }),
    prisma.person.count({ where }),
    prisma.organization.count({ where }),
    prisma.lead.count({ where }),
    prisma.deal.count({ where }),
    prisma.assistantActionRequest.count({ where })
  ]);
  return { activities, assistantActionRequests, deals, emailLogs, leads, notes, organizations, people };
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

function actionableBrowserErrors(errors: string[]) {
  return errors.filter(
    (error) =>
      !error.includes("accounts.google.com/o/oauth2") &&
      !error.includes("Failed to fetch RSC payload") &&
      !error.includes("Failed to load resource: net::ERR_FAILED")
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
