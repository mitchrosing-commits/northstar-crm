import { expect, type BrowserContext, test } from "@playwright/test";
import {
  ActivityType,
  EmailDirection,
  EmailConnectionProvider,
  JobStatus,
  MembershipRole,
  PrismaClient,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  createLocalSession,
  revokeLocalSessionToken,
} from "@/lib/auth/local-auth";
import {
  localSessionCookieName,
  serializeLocalSessionCookieValue,
} from "@/lib/auth/session";
import { gmailInboxSyncJobType } from "@/lib/services/email-connection-service";

const prisma = new PrismaClient();
const browserBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const activeWorkspaceCookieName = "northstar_workspace";

type EmailSyncHealthBrowserFixture = {
  completedConnectionId: string;
  expiresAt: Date;
  queuedConnectionId: string;
  sessionCookieValue: string;
  syncNowConnectionId: string;
  token: string;
  userId: string;
  workspaceId: string;
};

let fixture: EmailSyncHealthBrowserFixture;

test.describe("Email sync health browser flow", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    fixture = await createEmailSyncHealthBrowserFixture();
  });

  test.beforeEach(async ({ context }) => {
    await authenticateEmailSyncHealthBrowserContext(context);
  });

  test.afterAll(async () => {
    await cleanupEmailSyncHealthBrowserFixture();
    await prisma.$disconnect();
  });

  test("renders Gmail sync health, queues manual sync, and preserves Email review workflows", async ({
    page,
  }) => {
    await page.goto("/email");
    await expect(page.locator("#main-content")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByRole("link", { name: "queued-sync@example.test" })).toBeVisible();
    await expect(page.getByRole("link", { name: "running-sync@example.test" })).toBeVisible();
    await expect(page.getByRole("link", { name: "completed-sync@example.test" })).toBeVisible();
    await expect(page.getByRole("link", { name: "reconnect-sync@example.test" })).toBeVisible();
    await page.getByText("Advanced diagnostics and legacy email tools").click();

    const queuedRow = page.locator(".connected-inbox-row", {
      hasText: "queued-sync@example.test",
    });
    await expect(queuedRow).toBeVisible();
    await expect(
      queuedRow.locator(".filter-actions .badge").filter({ hasText: "Sync queued" }),
    ).toBeVisible();
    await queuedRow.getByText("Sync history and health").click();
    await expect(queuedRow.getByText(/Queued · Manual/)).toBeVisible();

    const runningRow = page.locator(".connected-inbox-row", {
      hasText: "running-sync@example.test",
    });
    await expect(
      runningRow.locator(".filter-actions .badge").filter({ hasText: "Sync running" }),
    ).toBeVisible();
    await expect(runningRow.getByRole("button", { name: /Sync running/i })).toBeDisabled();

    const completedRow = page.locator(".connected-inbox-row", {
      hasText: "completed-sync@example.test",
    });
    await expect(completedRow.getByText("Last sync result: imported 3, duplicates 2, skipped 2 from 7 fetched.")).toBeVisible();
    await completedRow.getByText("Sync history and health").click();
    await expect(completedRow.getByText(/Completed · Automatic/)).toBeVisible();
    await expect(
      completedRow.locator(".gmail-sync-health-counts .badge").filter({ hasText: "Fetched 7" }),
    ).toBeVisible();
    await expect(
      completedRow.locator(".gmail-sync-health-counts .badge").filter({ hasText: "Imported 3" }),
    ).toBeVisible();

    const reconnectRow = page.locator(".connected-inbox-row", {
      hasText: "reconnect-sync@example.test",
    });
    await expect(reconnectRow.getByRole("link", { name: "Reconnect", exact: true })).toBeVisible();
    await reconnectRow.getByText("Sync history and health").click();
    await expect(
      reconnectRow.locator(".filter-actions .badge").filter({ hasText: "Reconnect required" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("raw-token");
    await expect(page.locator("body")).not.toContainText("provider-body-secret");

    await page.goto("/email?account=all");
    await expect(
      page.getByRole("link", { name: /Open inbox thread Browser Unlinked Opportunity/i }),
    ).toBeVisible();
    await expect(page.getByText("Veridian Buyer").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Open inbox thread Browser Linked Follow-up/i }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Open inbox thread Browser Linked Follow-up/i }).click();
    await expect(page.getByText("Open follow-up").first()).toBeVisible();

    await page.goto("/email?account=all");
    await page.getByText("Advanced diagnostics and legacy email tools").click();
    const syncNowRow = page.locator(".connected-inbox-row", {
      hasText: "sync-now@example.test",
    });
    await syncNowRow.getByRole("button", { name: "Sync this inbox" }).click();
    await expect(page).toHaveURL(/emailConnection=gmail-sync-queued/);
    await expect(page.getByText("Gmail Full Inbox sync finished")).toHaveCount(0);
    await expect(
      prisma.job.count({
        where: {
          dedupeKey: `gmail-inbox-sync:${fixture.syncNowConnectionId}`,
          status: JobStatus.PENDING,
          type: gmailInboxSyncJobType,
          workspaceId: fixture.workspaceId,
        },
      }),
    ).resolves.toBe(1);

    await page.goto("/settings#email-connections");
    await expect(page.getByRole("heading", { name: "Gmail Sync Health" })).toBeVisible();
    const settingsCompletedRow = page.locator(".email-connection-health-row", {
      hasText: "completed-sync@example.test",
    });
    await expect(settingsCompletedRow).toBeVisible();
    await settingsCompletedRow.getByText("Sync history and health").click();
    await expect(
      settingsCompletedRow.locator(".gmail-sync-health-counts .badge").filter({ hasText: "Fetched 7" }),
    ).toBeVisible();
    const settingsReconnectRow = page.locator(".email-connection-health-row", {
      hasText: "reconnect-sync@example.test",
    });
    await expect(settingsReconnectRow).toBeVisible();
    await expect(settingsReconnectRow.getByRole("link", { name: "Reconnect Gmail" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("raw-token");
    await expect(page.locator("body")).not.toContainText("provider-body-secret");

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/email");
    await expect(page.locator("#main-content")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      )
      .toMatchObject({ innerWidth: 390, scrollWidth: expect.any(Number) });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});

async function createEmailSyncHealthBrowserFixture(): Promise<EmailSyncHealthBrowserFixture> {
  const suffix = randomUUID();
  const nameSuffix = suffix.slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `email-sync-health-browser-${suffix}@example.test`,
      name: "Email Sync Health Browser",
    },
  });
  const workspace = await prisma.workspace.create({
    data: {
      memberships: { create: { role: MembershipRole.OWNER, userId: user.id } },
      name: `Email Sync Health Browser ${nameSuffix}`,
      slug: `email-sync-health-browser-${suffix}`,
    },
  });
  const person = await prisma.person.create({
    data: {
      email: "buyer@veridian.info",
      firstName: "Veridian",
      lastName: "Buyer",
      ownerId: user.id,
      workspaceId: workspace.id,
    },
  });

  const syncNow = await createGmailConnection(workspace.id, user.id, "sync-now@example.test");
  const queued = await createGmailConnection(workspace.id, user.id, "queued-sync@example.test");
  const running = await createGmailConnection(workspace.id, user.id, "running-sync@example.test");
  const completed = await createGmailConnection(workspace.id, user.id, "completed-sync@example.test", {
    lastSyncAt: new Date("2026-07-13T14:00:00.000Z"),
    lastSyncAttemptedAt: new Date("2026-07-13T14:00:00.000Z"),
    lastSyncDuplicateCount: 2,
    lastSyncImportedCount: 3,
    lastSyncMessageSkipCount: 1,
    lastSyncMode: "recent",
    lastSyncSkippedCount: 1,
    lastSyncTotalFetched: 7,
  });
  const reconnect = await createGmailConnection(workspace.id, user.id, "reconnect-sync@example.test", {
    lastError: "invalid_grant [redacted]",
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
  });

  await prisma.job.createMany({
    data: [
      gmailJob(workspace.id, queued.id, JobStatus.PENDING, {
        runAt: new Date("2026-07-13T15:00:00.000Z"),
      }),
      gmailJob(workspace.id, running.id, JobStatus.RUNNING, {
        attempts: 1,
        lockedAt: new Date("2026-07-13T15:00:00.000Z"),
        lockedBy: "browser-worker",
        runAt: new Date("2026-07-13T15:00:00.000Z"),
      }),
      gmailJob(workspace.id, completed.id, JobStatus.SUCCEEDED, {
        attempts: 1,
        processedAt: new Date("2026-07-13T14:01:00.000Z"),
        runAt: new Date("2026-07-13T14:00:00.000Z"),
        source: "automatic",
      }),
    ],
  });

  const unlinkedEmail = await prisma.emailLog.create({
    data: {
      body: "Can we review pricing this week?",
      direction: EmailDirection.INBOUND,
      emailConnectionId: completed.id,
      fromText: "Veridian Buyer <buyer@veridian.info>",
      occurredAt: new Date("2026-07-13T13:00:00.000Z"),
      provider: EmailConnectionProvider.GOOGLE_WORKSPACE,
      providerMessageId: `browser-unlinked-${suffix}`,
      providerThreadId: `browser-unlinked-thread-${suffix}`,
      subject: "Browser Unlinked Opportunity",
      toText: "Sales <completed-sync@example.test>",
      workspaceId: workspace.id,
    },
  });
  const linkedEmail = await prisma.emailLog.create({
    data: {
      body: "Follow-up context should remain linked.",
      direction: EmailDirection.INBOUND,
      emailConnectionId: completed.id,
      fromText: "Veridian Buyer <buyer@veridian.info>",
      occurredAt: new Date("2026-07-13T13:10:00.000Z"),
      personId: person.id,
      provider: EmailConnectionProvider.GOOGLE_WORKSPACE,
      providerMessageId: `browser-linked-${suffix}`,
      providerThreadId: `browser-linked-thread-${suffix}`,
      subject: "Browser Linked Follow-up",
      toText: "Sales <completed-sync@example.test>",
      workspaceId: workspace.id,
    },
  });
  await prisma.activity.create({
    data: {
      dueAt: new Date("2026-07-14T15:00:00.000Z"),
      emailLogLinks: {
        create: {
          emailLogId: linkedEmail.id,
          workspaceId: workspace.id,
        },
      },
      ownerId: user.id,
      personId: person.id,
      title: "Review linked email follow-up",
      type: ActivityType.TASK,
      workspaceId: workspace.id,
    },
  });

  const { expiresAt, token } = await createLocalSession(user.id);

  return {
    completedConnectionId: completed.id,
    expiresAt,
    queuedConnectionId: queued.id,
    sessionCookieValue: serializeLocalSessionCookieValue(token),
    syncNowConnectionId: syncNow.id,
    token,
    userId: user.id,
    workspaceId: workspace.id,
  };
}

async function createGmailConnection(
  workspaceId: string,
  userId: string,
  accountEmail: string,
  overrides: Partial<{
    lastError: string | null;
    lastSyncAt: Date | null;
    lastSyncAttemptedAt: Date | null;
    lastSyncDuplicateCount: number | null;
    lastSyncImportedCount: number | null;
    lastSyncMessageSkipCount: number | null;
    lastSyncMode: string | null;
    lastSyncSkippedCount: number | null;
    lastSyncTotalFetched: number | null;
    scopes: string[];
  }> = {},
) {
  return prisma.emailConnection.create({
    data: {
      accountEmail,
      createdById: userId,
      lastError: overrides.lastError,
      lastSyncAt: overrides.lastSyncAt,
      lastSyncAttemptedAt: overrides.lastSyncAttemptedAt,
      lastSyncDuplicateCount: overrides.lastSyncDuplicateCount,
      lastSyncImportedCount: overrides.lastSyncImportedCount,
      lastSyncMessageSkipCount: overrides.lastSyncMessageSkipCount,
      lastSyncMode: overrides.lastSyncMode,
      lastSyncSkippedCount: overrides.lastSyncSkippedCount,
      lastSyncTotalFetched: overrides.lastSyncTotalFetched,
      provider: EmailConnectionProvider.GOOGLE_WORKSPACE,
      scopes: overrides.scopes ?? [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      status: "CONNECTED",
      workspaceId,
    },
  });
}

function gmailJob(
  workspaceId: string,
  connectionId: string,
  status: JobStatus,
  overrides: Partial<{
    attempts: number;
    lockedAt: Date | null;
    lockedBy: string | null;
    processedAt: Date | null;
    runAt: Date;
    source: "automatic" | "manual";
  }> = {},
) {
  return {
    attempts: overrides.attempts ?? 0,
    dedupeKey: `gmail-inbox-sync:${connectionId}`,
    lockedAt: overrides.lockedAt,
    lockedBy: overrides.lockedBy,
    payload: {
      connectionId,
      source: overrides.source ?? "manual",
      workspaceId,
    },
    processedAt: overrides.processedAt,
    runAt: overrides.runAt ?? new Date("2026-07-13T15:00:00.000Z"),
    status,
    type: gmailInboxSyncJobType,
    workspaceId,
  };
}

async function authenticateEmailSyncHealthBrowserContext(context: BrowserContext) {
  await context.addCookies([
    {
      expires: Math.floor(fixture.expiresAt.getTime() / 1000),
      httpOnly: true,
      name: localSessionCookieName,
      sameSite: "Lax",
      url: browserBaseUrl,
      value: fixture.sessionCookieValue,
    },
    {
      expires: Math.floor(fixture.expiresAt.getTime() / 1000),
      name: activeWorkspaceCookieName,
      sameSite: "Lax",
      url: browserBaseUrl,
      value: fixture.workspaceId,
    },
  ]);
}

async function cleanupEmailSyncHealthBrowserFixture() {
  if (!fixture) return;
  if (fixture.token) await revokeLocalSessionToken(fixture.token);
  await prisma.job.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.emailLogActivityLink.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.activity.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.emailLog.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.emailConnectionSecret.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.emailConnection.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.person.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await prisma.workspace.deleteMany({ where: { id: fixture.workspaceId } });
  await prisma.session.deleteMany({ where: { userId: fixture.userId } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}
