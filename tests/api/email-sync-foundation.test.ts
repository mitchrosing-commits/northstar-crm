import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isTokenEncryptionConfigured } from "@/lib/services/email-connection-service";
import { validateRuntimeEnv } from "@/lib/env";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260626010000_email_connections_foundation/migration.sql"),
  "utf8"
);
const emailConnectionService = readFileSync(join(process.cwd(), "lib/services/email-connection-service.ts"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
const seed = readFileSync(join(process.cwd(), "prisma/seed.ts"), "utf8");
const fixture = readFileSync(join(process.cwd(), "tests/integration/fixtures.ts"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const deploymentReadiness = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");

describe("email sync provider foundation", () => {
  it("adds non-sensitive EmailConnection metadata without OAuth token storage", () => {
    expect(schema).toContain("model EmailConnection");
    expect(schema).toContain("enum EmailConnectionProvider");
    expect(schema).toContain("GOOGLE_WORKSPACE");
    expect(schema).toContain("MICROSOFT_365");
    expect(schema).toContain("IMAP_SMTP");
    expect(schema).toContain("enum EmailConnectionStatus");
    expect(schema).toContain("lastSyncAt");
    expect(schema).toContain("lastSyncCursor");
    expect(schema).toContain("lastError");
    expect(schema).not.toMatch(/\n\s+accessToken\s+String/);
    expect(schema).not.toMatch(/\n\s+refreshToken\s+String/);
    expect(schema).not.toContain("clientSecret");
    expect(migration).toContain("OAuth access and refresh tokens are intentionally not stored");
    expect(migration).not.toContain("accessToken");
    expect(migration).not.toContain("refreshToken");
  });

  it("surfaces provider readiness while keeping actions disabled", () => {
    expect(emailConnectionService).toContain("export async function listEmailConnectionProviderCards");
    expect(emailConnectionService).toContain("ensureWorkspaceAccess(actor)");
    expect(emailConnectionService).toContain("prisma.emailConnection.findMany");
    expect(emailConnectionService).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(emailConnectionService).toContain("MICROSOFT_OAUTH_CLIENT_ID");
    expect(emailConnectionService).toContain("isTokenEncryptionConfigured");
    expect(emailConnectionService).toContain("Not configured");
    expect(emailConnectionService).toContain("Token encryption required");
    expect(emailConnectionService).toContain("lastError: safeProviderLastError(connection?.lastError)");
    expect(emailConnectionService).toContain("function safeProviderLastError");
    expect(emailConnectionService).toContain("redactSensitiveText(value ?? undefined)");
    expect(emailConnectionService).toContain("Reconnect required");
    expect(emailConnectionService).toContain("include: { secret: { select: { scopes: true } } }");
    expect(emailConnectionService).toContain("hasConnectionProviderScopes(connection, gmailOAuthScopes)");
    expect(emailConnectionService).toContain("normalizeStoredScopes(connection?.secret?.scopes)");
    expect(emailConnectionService).toContain("normalizeGoogleOAuthScopes(tokenResponse.scope)");
    expect(emailConnectionService).toContain("microsoftProviderCard");
    expect(emailConnectionService).toContain("Connect Microsoft");
    expect(emailConnectionService).toContain("href: \"/api/email-connections/microsoft/connect\"");
    expect(emailConnectionService).toContain("Sync recent Microsoft mail");
    expect(emailConnectionService).toContain("Connect Gmail");
    expect(emailConnectionService).toContain("disabled: true");
    expect(settingsPage).toContain("listEmailConnectionProviderCards(actor)");
    expect(settingsPage).toContain("provider.actionLabel");
    expect(settingsPage).not.toContain("Connect Gmail");
    expect(settingsPage).not.toContain("Connect Outlook");
  });

  it("validates OAuth env configuration without enabling plaintext token storage", () => {
    expect(envExample).toContain("GOOGLE_OAUTH_CLIENT_ID=");
    expect(envExample).toContain("MICROSOFT_OAUTH_CLIENT_ID=");
    expect(envExample).toContain("EMAIL_TOKEN_ENCRYPTION_KEY=");
    expect(isTokenEncryptionConfigured({ EMAIL_TOKEN_ENCRYPTION_KEY: "x".repeat(32) })).toBe(true);
    expect(isTokenEncryptionConfigured({ EMAIL_TOKEN_ENCRYPTION_KEY: "short" })).toBe(false);

    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        GOOGLE_OAUTH_CLIENT_ID: "google-client"
      })
    ).toEqual({
      ok: false,
      errors: ["Google OAuth requires client id, client secret, and redirect URI when any provider env var is set."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        EMAIL_TOKEN_ENCRYPTION_KEY: "short"
      })
    ).toEqual({
      ok: false,
      errors: ["EMAIL_TOKEN_ENCRYPTION_KEY must decode to at least 32 bytes when set."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        MICROSOFT_OAUTH_TENANT_ID: "common/oauth2/v2.0",
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
        MICROSOFT_OAUTH_REDIRECT_URI: "https://crm.example.test/api/email/microsoft/callback"
      })
    ).toEqual({
      ok: false,
      errors: ["MICROSOFT_OAUTH_TENANT_ID must be a tenant id, domain, or one of: common, organizations, consumers."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://crm.example.test/api/email/google/callback"
      })
    ).toMatchObject({
      ok: true,
      warnings: ["Email OAuth env is configured, but EMAIL_TOKEN_ENCRYPTION_KEY is not set; provider connection buttons stay disabled."]
    });
    expect(deploymentReadiness).toContain("MICROSOFT_OAUTH_TENANT_ID");
    expect(deploymentReadiness).toContain("not a path-like value");
  });

  it("keeps Settings admin readiness aligned with the real token encryption validator", () => {
    expect(settingsPage).toContain("isTokenEncryptionConfigured");
    expect(settingsPage).toContain("const hasEmailEncryption = isTokenEncryptionConfigured(process.env)");
    expect(settingsPage).not.toContain("const hasEmailEncryption = Boolean(process.env.EMAIL_TOKEN_ENCRYPTION_KEY?.trim())");
  });

  it("keeps seed and integration cleanup explicit without fake connected providers", () => {
    expect(seed).toContain("emailConnection.deleteMany");
    expect(seed).toContain("emailConnectionSecret.deleteMany");
    expect(seed).not.toContain("emailConnection.create");
    expect(seed).not.toContain("EmailConnectionStatus.CONNECTED");
    expect(seed).not.toContain("emailConnectionSecret.create");
    expect(fixture).toContain("emailConnection.deleteMany");
    expect(fixture).toContain("emailConnectionSecret.deleteMany");
    expect(currentStatus).toContain("Email connection status foundation");
    expect(currentStatus).toContain("OAuth access and refresh tokens are stored only in encrypted");
  });

  it("adds Full Inbox provider metadata, Gmail read/send scopes, and explicit reply UI", () => {
    const fullInboxMigration = readFileSync(
      join(process.cwd(), "prisma/migrations/20260706130000_email_full_inbox_metadata/migration.sql"),
      "utf8"
    );
    const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
    const emailActions = readFileSync(join(process.cwd(), "app/email/actions.ts"), "utf8");

    expect(schema).toContain("providerLabels        Json?");
    expect(schema).toContain("providerSnippet       String?");
    expect(fullInboxMigration).toContain("ADD COLUMN \"providerLabels\" JSONB");
    expect(fullInboxMigration).toContain("ADD COLUMN \"providerSnippet\" TEXT");
    expect(emailConnectionService).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(emailConnectionService).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(emailConnectionService).toContain("export async function syncGmailInboxMessages");
    expect(emailConnectionService).toContain('export const gmailInboxSyncJobType = "email.gmail_sync"');
    expect(emailConnectionService).toContain("export async function enqueueGmailInboxSyncJob");
    expect(emailConnectionService).toContain("export async function runGmailInboxSyncNow");
    expect(emailConnectionService).toContain("export async function processGmailInboxSyncJob");
    expect(emailConnectionService).toContain("markJobSucceeded(claimedJob.id");
    expect(emailConnectionService).toContain("markJobFailedForRetry(claimedJob.id");
    expect(emailConnectionService).toContain("EMAIL_SYNC_STALE_RETRY_LIMIT");
    expect(emailConnectionService).toContain("dedupeKey: gmailInboxSyncJobDedupeKey(gmailConnection.id)");
    expect(emailConnectionService).toContain("shortJobRef(job.id)");
    expect(emailConnectionService).toContain("export async function syncOlderGmailInboxMessages");
    expect(emailConnectionService).toContain("export async function refreshGmailInboxThread");
    expect(emailConnectionService).toContain("parseGmailHistoryCursor(connection.lastSyncCursor)");
    expect(emailConnectionService).toContain("formatGmailHistoryCursor(syncResult.historyId)");
    expect(emailConnectionService).toContain("listGmailInboxHistoryMessages");
    expect(emailConnectionService).toContain("listOlderGmailInboxMessages");
    expect(emailConnectionService).toContain("getGmailThreadFull");
    expect(emailConnectionService).toContain("EMAIL_GMAIL_HISTORY_EXPIRED");
    expect(emailConnectionService).toContain("syncRecentGmailInboxMessagesForConnection");
    expect(emailConnectionService).toContain("enqueueGmailInboxSyncJobForConnection(actor, connection.id)");
    expect(emailConnectionService).toContain("export async function listEmailInboxThreads");
    expect(emailConnectionService).toContain("export async function sendGmailReplyFromEmailLog");
    expect(emailConnectionService).toContain("export async function disconnectEmailConnection");
    expect(emailConnectionService).toContain("emailConnectionSecret.deleteMany");
    expect(emailConnectionService).toContain("deletedAt: null");
    expect(emailConnectionService).toContain("messages/send");
    expect(emailPage).toContain("title=\"Work Inbox\"");
    expect(emailPage).toContain("WorkInboxThreadList");
    expect(emailPage).toContain("work-prioritized view of synced Gmail messages");
    expect(emailPage).toContain("GmailSyncProgressPanel");
    expect(emailPage).toContain("Sync status: {provider.syncStatusLabel}");
    expect(emailPage).toContain("gmail-sync-queued");
    expect(emailPage).toContain("Send Gmail reply");
    expect(emailPage).toContain("Disconnect");
    expect(emailActions).toContain("syncGmailInboxFromEmailPageAction");
    expect(emailActions).toContain("runGmailInboxSyncNow(actor)");
    expect(emailActions).toContain("sendGmailReplyFromEmailPageAction");
    expect(emailActions).toContain("disconnectEmailProviderFromEmailPageAction");
    expect(emailActions).not.toContain("sendGmailReplyFromEmailPageAction()");
  });
});
