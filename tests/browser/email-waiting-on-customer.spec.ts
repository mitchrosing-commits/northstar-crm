import { expect, type BrowserContext, type Page, test } from "@playwright/test";
import { MembershipRole, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
  createLocalSession,
  revokeLocalSessionToken,
} from "@/lib/auth/local-auth";
import {
  localSessionCookieName,
  serializeLocalSessionCookieValue,
} from "@/lib/auth/session";

const prisma = new PrismaClient();
const browserBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const activeWorkspaceCookieName = "northstar_workspace";

type EmailWaitingBrowserFixture = {
  expiresAt: Date;
  sessionCookieValue: string;
  token: string;
  userId: string;
  workspaceId: string;
};

let fixture: EmailWaitingBrowserFixture;

test.describe("Email waiting-on-customer browser flow", () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    fixture = await createEmailWaitingBrowserFixture();
  });

  test.beforeEach(async ({ context }) => {
    await authenticateEmailWaitingBrowserContext(context);
  });

  test.afterAll(async () => {
    await cleanupEmailWaitingBrowserFixture();
    await prisma.$disconnect();
  });

  test("filters waiting customer threads and keeps draft action explicit", async ({
    page,
  }) => {
    const countsBefore = await readMutationGuardCounts();
    const errors = watchBrowserErrors(page);

    await page.goto("/email");
    await expect(page.locator("#main-content")).toBeVisible();
    await page
      .getByRole("link", { name: /Waiting on customer \(1\)/i })
      .first()
      .click();
    await expect(page).toHaveURL(/inbox=waiting-on-customer/);

    const waitingRow = page.getByRole("link", {
      name: /Open inbox thread Browser Waiting Customer/i,
    });
    await expect(waitingRow).toBeVisible();
    await expect(waitingRow).toContainText("Waiting on customer");
    await expect(waitingRow).toContainText(/Waiting \d+ days/);
    await expect(page.locator(".inbox-thread-list")).not.toContainText(
      "Browser Customer Responded",
    );

    await waitingRow.click();
    await expect(page.locator(".email-inbox-thread-detail")).toContainText(
      "Browser Waiting Customer",
    );
    await expect(
      page.getByLabel("Waiting on customer details"),
    ).toContainText("Latest outbound");
    await page.getByRole("link", { name: "Draft follow-up" }).click();
    await expect(page.locator("#email-ai-reply-panel")).toBeVisible();
    await expect(
      page.locator("#email-ai-reply-panel").getByText("Draft with AI"),
    ).toBeVisible();

    await page.goto("/email?inbox=waiting-on-customer&q=no-such-customer");
    await expect(page).toHaveURL(/inbox=waiting-on-customer/);
    await expect(page.getByText("No waiting customer responses")).toBeVisible();
    await expect(page.getByText("Waiting on Customer is for stored threads")).toBeVisible();
    await expect(readMutationGuardCounts()).resolves.toEqual(countsBefore);
    expect(actionableBrowserErrors(errors.current())).toEqual([]);
  });
});

async function createEmailWaitingBrowserFixture(): Promise<EmailWaitingBrowserFixture> {
  const suffix = randomUUID();
  const nameSuffix = suffix.slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `email-waiting-browser-${suffix}@example.test`,
      name: "Email Waiting Browser",
    },
  });
  const workspace = await prisma.workspace.create({
    data: {
      memberships: { create: { role: MembershipRole.OWNER, userId: user.id } },
      name: `Email Waiting Browser ${nameSuffix}`,
      slug: `email-waiting-browser-${suffix}`,
    },
  });
  const connection = await prisma.emailConnection.create({
    data: {
      accountEmail: `sales-${suffix}@example.test`,
      createdById: user.id,
      lastSyncAt: new Date("2026-07-06T12:00:00.000Z"),
      provider: "GOOGLE_WORKSPACE",
      scopes: [
        "openid",
        "email",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      status: "CONNECTED",
      workspaceId: workspace.id,
    },
  });

  await prisma.emailLog.createMany({
    data: [
      {
        body: "Can you send the rollout dates?",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: "Browser Buyer <buyer@example.test>",
        occurredAt: new Date("2026-07-01T09:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX"],
        providerMessageId: `email-waiting-inbound-${suffix}`,
        providerSnippet: "Can you send the rollout dates?",
        providerThreadId: `email-waiting-thread-${suffix}`,
        subject: "Browser Waiting Customer",
        toText: `sales-${suffix}@example.test`,
        workspaceId: workspace.id,
      },
      {
        body: "We sent rollout dates and are waiting for your approval.",
        direction: "OUTBOUND",
        emailConnectionId: connection.id,
        fromText: `sales-${suffix}@example.test`,
        occurredAt: new Date("2026-07-02T09:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["SENT"],
        providerMessageId: `email-waiting-outbound-${suffix}`,
        providerSnippet: "We sent rollout dates",
        providerThreadId: `email-waiting-thread-${suffix}`,
        subject: "Browser Waiting Customer",
        toText: "Browser Buyer <buyer@example.test>",
        workspaceId: workspace.id,
      },
      {
        body: "We already reviewed this and will respond later.",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: "Browser Buyer <buyer@example.test>",
        occurredAt: new Date("2026-07-03T09:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX"],
        providerMessageId: `email-responded-inbound-${suffix}`,
        providerSnippet: "We already reviewed this",
        providerThreadId: `email-responded-thread-${suffix}`,
        subject: "Browser Customer Responded",
        toText: `sales-${suffix}@example.test`,
        workspaceId: workspace.id,
      },
    ],
  });

  const session = await createLocalSession(user.id);
  return {
    expiresAt: session.expiresAt,
    sessionCookieValue: serializeLocalSessionCookieValue(session.token),
    token: session.token,
    userId: user.id,
    workspaceId: workspace.id,
  };
}

async function authenticateEmailWaitingBrowserContext(context: BrowserContext) {
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

async function cleanupEmailWaitingBrowserFixture() {
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
}

async function readMutationGuardCounts() {
  const where = { workspaceId: fixture.workspaceId };
  const [emailLogs, activities, notes, people, organizations, leads, deals] =
    await Promise.all([
      prisma.emailLog.count({ where }),
      prisma.activity.count({ where }),
      prisma.note.count({ where }),
      prisma.person.count({ where }),
      prisma.organization.count({ where }),
      prisma.lead.count({ where }),
      prisma.deal.count({ where }),
    ]);
  return { activities, deals, emailLogs, leads, notes, organizations, people };
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
      !error.includes("Failed to load resource: net::ERR_FAILED"),
  );
}
