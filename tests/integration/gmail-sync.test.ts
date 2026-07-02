import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/responses";
import { decryptEmailToken, encryptEmailToken } from "@/lib/email/token-encryption";
import {
  listEmailConnectionProviderCards,
  storeGoogleOAuthConnection,
  syncRecentGmailMessages
} from "@/lib/services/email-connection-service";
import { createIntegrationFixture } from "./fixtures";

const env = {
  EMAIL_TOKEN_ENCRYPTION_KEY: "gmail-sync-test-key-32-bytes-min",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://crm.example.test/api/email-connections/google/callback"
};

describe("Gmail metadata sync", () => {
  it("keeps provider readiness cards scoped and honest across configuration states", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "other-workspace-google@example.test",
          createdById: fixture.userB.id,
          lastError: "Other workspace failure with Bearer other-workspace-token for founder@example.test",
          provider: "GOOGLE_WORKSPACE",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
          status: "CONNECTED",
          workspaceId: fixture.workspaceB.id
        }
      });

      const notConfiguredCards = await listEmailConnectionProviderCards(fixture.actorA, {});
      const notConfiguredGmail = notConfiguredCards.find((provider) => provider.provider === "GOOGLE_WORKSPACE");
      expect(notConfiguredGmail).toMatchObject({
        actionLabel: "Configure OAuth",
        disabled: true,
        status: "Not configured"
      });
      expect(notConfiguredGmail?.accountEmail).toBeUndefined();
      expect(notConfiguredGmail?.lastError).toBeUndefined();

      const encryptionRequiredCards = await listEmailConnectionProviderCards(fixture.actorA, {
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://crm.example.test/api/email-connections/google/callback"
      });
      const encryptionRequiredGmail = encryptionRequiredCards.find((provider) => provider.provider === "GOOGLE_WORKSPACE");
      expect(encryptionRequiredGmail).toMatchObject({
        actionLabel: "Encryption required",
        disabled: true,
        status: "Token encryption required"
      });
      expect(encryptionRequiredGmail?.accountEmail).toBeUndefined();
      expect(encryptionRequiredGmail?.lastError).toBeUndefined();

      const readyCards = await listEmailConnectionProviderCards(fixture.actorA, env);
      const readyGmail = readyCards.find((provider) => provider.provider === "GOOGLE_WORKSPACE");
      expect(readyGmail).toMatchObject({
        actionLabel: "Connect Gmail",
        disabled: false,
        href: "/api/email-connections/google/connect",
        status: "Ready to connect",
        syncAvailable: false
      });
      expect(readyGmail?.accountEmail).toBeUndefined();
      expect(readyGmail?.lastError).toBeNull();
      expect(JSON.stringify(readyCards)).not.toContain("other-workspace-google@example.test");
      expect(JSON.stringify(readyCards)).not.toContain("other-workspace-token");
    } finally {
      await fixture.cleanup();
    }
  });

  it("stores Gmail OAuth tokens encrypted and rejects malformed profile email", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connectionCountBeforeMalformedProfile = await fixture.prisma.emailConnection.count({
        where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
      });

      await expect(
        storeGoogleOAuthConnection({
          actor: fixture.actorA,
          env,
          profile: {
            email: { address: "alex@example.test" } as unknown as string
          },
          tokenResponse: {
            access_token: "gmail-malformed-access-token",
            refresh_token: "gmail-malformed-refresh-token",
            scope: "openid email"
          }
        })
      ).rejects.toMatchObject({
        code: "EMAIL_OAUTH_PROFILE_MISSING_EMAIL",
        message: "Gmail did not return an account email address.",
        status: 400
      });
      expect(await fixture.prisma.emailConnection.count({ where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" } })).toBe(
        connectionCountBeforeMalformedProfile
      );

      const connection = await storeGoogleOAuthConnection({
        actor: fixture.actorA,
        env,
        profile: {
          email: " ALEX@EXAMPLE.TEST ",
          name: "Alex Gmail"
        },
        tokenResponse: {
          access_token: "gmail-access-token",
          expires_in: { seconds: 3600 } as unknown as number,
          refresh_token: "gmail-refresh-token",
          scope: { value: "openid email https://www.googleapis.com/auth/gmail.metadata" } as unknown as string
        }
      });
      const secret = await fixture.prisma.emailConnectionSecret.findUniqueOrThrow({
        where: { connectionId: connection.id }
      });

      expect(connection.accountEmail).toBe("alex@example.test");
      expect(secret.accountEmail).toBe("alex@example.test");
      expect(secret.accessTokenExpiresAt).toBeNull();
      expect(secret.scopes).toEqual(["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"]);
      expect(secret.encryptedAccessToken).not.toContain("gmail-access-token");
      expect(secret.encryptedRefreshToken).not.toContain("gmail-refresh-token");
      expect(decryptEmailToken(secret.encryptedAccessToken, env)).toBe("gmail-access-token");
      expect(decryptEmailToken(secret.encryptedRefreshToken as string, env)).toBe("gmail-refresh-token");
    } finally {
      await fixture.cleanup();
    }
  });

  it("imports only matched recent Gmail metadata and deduplicates provider message ids", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            id: "gmail-match-1",
            headers: {
              Date: "Fri, 26 Jun 2026 10:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "NDA follow-up",
              To: "Alex <alex@example.test>"
            },
            snippet: "Following up on the NDA."
          },
          {
            id: "gmail-noise-1",
            headers: {
              Date: "Fri, 26 Jun 2026 10:05:00 -0400",
              From: "Vendor <vendor@example.test>",
              Subject: "Unmatched vendor note",
              To: "Alex <alex@example.test>"
            },
            snippet: "This should not enter CRM history."
          }
        ]
      });

      const first = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(first).toMatchObject({ created: 1, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 2 });
      expect(first.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: "vendor@example.test",
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: "gmail-noise-1",
          snippet: "This should not enter CRM history.",
          subject: "Unmatched vendor note"
        })
      ]);

      const logs = await fixture.prisma.emailLog.findMany({
        where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        body: "Gmail snippet: Following up on the NDA.",
        dealId: fixture.recordsA.deal.id,
        direction: "INBOUND",
        personId: fixture.recordsA.person.id,
        providerMessageId: "gmail-match-1",
        providerThreadId: "thread-gmail-match-1",
        subject: "NDA follow-up"
      });

      const second = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(second).toMatchObject({ created: 0, skippedDuplicates: 1, skippedUnmatched: 1, totalFetched: 2 });
      expect(second.unmatchedPreviews).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refreshes an expired Gmail access token without storing plaintext", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "expired-access",
        expiresAt: new Date(Date.now() - 60_000),
        refreshToken: "refresh-token"
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "fresh-access",
        refreshToken: "refresh-token",
        refreshedAccessToken: "fresh-access",
        messages: []
      });

      const result = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 0 });
      expect(result.unmatchedPreviews).toEqual([]);

      const secret = await fixture.prisma.emailConnectionSecret.findUniqueOrThrow({
        where: { connectionId: connection.id }
      });
      expect(secret.encryptedAccessToken).not.toContain("fresh-access");
      expect(decryptEmailToken(secret.encryptedAccessToken, env)).toBe("fresh-access");
    } finally {
      await fixture.cleanup();
    }
  });

  it("records redacted Gmail refresh failures without replacing the stored access token", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "expired-access-before-refresh-failure",
        expiresAt: new Date(Date.now() - 60_000),
        refreshToken: "gmail-refresh-secret-token"
      });
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://oauth2.googleapis.com/token");
        const body = init?.body as URLSearchParams;
        expect(body.get("refresh_token")).toBe("gmail-refresh-secret-token");
        return Response.json({ error: "provider-refresh-body-secret-token" }, { status: 401 });
      }) as typeof fetch;

      await expect(syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_REFRESH_TOKEN_FAILED",
        message: "Gmail access token could not be refreshed."
      });

      const [reloadedConnection, reloadedSecret, logs] = await Promise.all([
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.emailConnectionSecret.findUniqueOrThrow({ where: { connectionId: connection.id } }),
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
        })
      ]);
      expect(reloadedConnection.lastError).toBe("EMAIL_REFRESH_TOKEN_FAILED: Gmail access token could not be refreshed.");
      expect(reloadedConnection.lastError).not.toContain("gmail-refresh-secret-token");
      expect(reloadedConnection.lastError).not.toContain("provider-refresh-body-secret-token");
      expect(decryptEmailToken(reloadedSecret.encryptedAccessToken, env)).toBe("expired-access-before-refresh-failure");
      expect(logs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a reconnect-safe Gmail failure when an expired token has no refresh token", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "expired-access-without-refresh",
        expiresAt: new Date(Date.now() - 60_000)
      });
      const fetchImpl = (async () => {
        throw new Error("Gmail provider calls should not run without a refresh token.");
      }) as typeof fetch;

      await expect(syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_REFRESH_TOKEN_MISSING",
        message: "Reconnect Gmail before syncing; the access token expired."
      });

      const reloaded = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(reloaded.lastError).toBe("EMAIL_REFRESH_TOKEN_MISSING: Reconnect Gmail before syncing; the access token expired.");
      expect(reloaded.lastError).not.toContain("expired-access-without-refresh");
      await expect(
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects Gmail sync when stored credentials do not belong to the connection workspace", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "alex@example.test",
          createdById: fixture.userA.id,
          provider: "GOOGLE_WORKSPACE",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
          status: "CONNECTED",
          workspaceId: fixture.workspaceA.id
        }
      });
      await fixture.prisma.emailConnectionSecret.create({
        data: {
          accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          accountEmail: "alex@example.test",
          connectionId: connection.id,
          encryptedAccessToken: encryptEmailToken("cross-workspace-gmail-access-token", env),
          encryptedRefreshToken: null,
          provider: "GOOGLE_WORKSPACE",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
          userId: fixture.userB.id,
          workspaceId: fixture.workspaceB.id
        }
      });
      const fetchImpl = (async () => {
        throw new Error("Google should not be called with a mismatched stored credential.");
      }) as typeof fetch;

      await expect(syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_CONNECTION_SECRET_MISMATCH",
        message: "Reconnect Gmail before syncing; stored credentials do not match this workspace."
      });

      const [reloadedConnection, logs] = await Promise.all([
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
        })
      ]);
      expect(reloadedConnection.lastError).toBe(
        "EMAIL_CONNECTION_SECRET_MISMATCH: Reconnect Gmail before syncing; stored credentials do not match this workspace."
      );
      expect(reloadedConnection.lastError).not.toContain("cross-workspace-gmail-access-token");
      expect(logs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a redacted Gmail sync failure without importing logs", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");

        expect(authorization).toBe("Bearer access-token");
        expect(url).toContain("https://gmail.googleapis.com/gmail/v1/users/me/messages?");
        return Response.json({ error: "provider-body-secret-token" }, { status: 503 });
      };

      await expect(syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_GMAIL_LIST_FAILED"
      });

      const reloaded = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(reloaded.lastError).toBe("EMAIL_GMAIL_LIST_FAILED: Recent Gmail messages could not be listed.");
      expect(reloaded.lastError).not.toContain("access-token");
      expect(reloaded.lastError).not.toContain("provider-body-secret-token");
      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(providerCard).toMatchObject({
        lastError: "EMAIL_GMAIL_LIST_FAILED: Recent Gmail messages could not be listed.",
        status: "Sync issue",
        syncAvailable: true
      });
      await expect(
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("redacts sensitive typed Gmail sync diagnostics before displaying provider status", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = (async () => {
        throw new ApiError(
          "EMAIL_PROVIDER_VERBOSE_FAILURE",
          "Provider failed with Bearer raw-access-token at https://crm.example.test/reset-password?token=raw-reset-token for founder@example.test apiKey=provider-api-key databaseUrl=postgresql://crm:provider-database-password@localhost:5432/crm sessionSecret=provider-session-secret RESEND_API_KEY=provider-resend-key",
          503
        );
      }) as typeof fetch;

      await expect(syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_PROVIDER_VERBOSE_FAILURE"
      });

      const reloaded = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(reloaded.lastError).toBe(
        "EMAIL_PROVIDER_VERBOSE_FAILURE: Provider failed with Bearer [redacted] at [redacted reset url] for [redacted email] apiKey=[redacted] databaseUrl=[redacted] sessionSecret=[redacted] RESEND_API_KEY=[redacted]"
      );
      expect(reloaded.lastError).not.toContain("raw-access-token");
      expect(reloaded.lastError).not.toContain("raw-reset-token");
      expect(reloaded.lastError).not.toContain("founder@example.test");
      expect(reloaded.lastError).not.toContain("provider-api-key");
      expect(reloaded.lastError).not.toContain("provider-database-password");
      expect(reloaded.lastError).not.toContain("provider-session-secret");
      expect(reloaded.lastError).not.toContain("provider-resend-key");

      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(providerCard).toMatchObject({
        lastError: reloaded.lastError,
        status: "Sync issue"
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("redacts legacy Gmail sync diagnostics before displaying provider status", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "alex@example.test",
          createdById: fixture.userA.id,
          lastError:
            "Legacy failure with Bearer legacy-gmail-access-token at https://preview:secret@crm.example.test/reset-password?token=legacy-reset-token for founder@example.test apiKey=legacy-provider-api-key",
          provider: "GOOGLE_WORKSPACE",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
          status: "CONNECTED",
          workspaceId: fixture.workspaceA.id
        }
      });

      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );

      expect(providerCard).toMatchObject({
        lastError:
          "Legacy failure with Bearer [redacted] at [redacted reset url] for [redacted email] apiKey=[redacted]",
        status: "Sync issue"
      });
      expect(providerCard?.lastError).not.toContain("legacy-gmail-access-token");
      expect(providerCard?.lastError).not.toContain("legacy-reset-token");
      expect(providerCard?.lastError).not.toContain("founder@example.test");
      expect(providerCard?.lastError).not.toContain("legacy-provider-api-key");
      expect(providerCard?.lastError).not.toContain("preview:secret");
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a provider-specific Gmail sync failure when a successful provider response is not JSON", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");

        expect(authorization).toBe("Bearer access-token");
        expect(url).toContain("https://gmail.googleapis.com/gmail/v1/users/me/messages?");
        return new Response("<html>provider-body-secret-token</html>", {
          headers: { "content-type": "text/html" },
          status: 200
        });
      };

      await expect(syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_GMAIL_LIST_FAILED",
        message: "Recent Gmail messages could not be listed."
      });

      const reloaded = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(reloaded.lastError).toBe("EMAIL_GMAIL_LIST_FAILED: Recent Gmail messages could not be listed.");
      expect(reloaded.lastError).not.toContain("access-token");
      expect(reloaded.lastError).not.toContain("provider-body-secret-token");
      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(providerCard).toMatchObject({
        lastError: "EMAIL_GMAIL_LIST_FAILED: Recent Gmail messages could not be listed.",
        status: "Sync issue",
        syncAvailable: true
      });
      await expect(
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not attach synced Gmail logs to cross-workspace deal or organization links", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await createCrossWorkspaceAttachmentTrap(fixture);
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            id: "gmail-cross-workspace-1",
            headers: {
              Date: "Fri, 26 Jun 2026 12:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Workspace-safe Gmail sync",
              To: "Alex <alex@example.test>"
            },
            snippet: "This should stay on the matched person only."
          }
        ]
      });

      const result = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 1 });

      const log = await fixture.prisma.emailLog.findFirstOrThrow({
        where: {
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: "gmail-cross-workspace-1",
          workspaceId: fixture.workspaceA.id
        }
      });
      expect(log).toMatchObject({
        dealId: null,
        organizationId: null,
        personId: fixture.recordsA.person.id,
        workspaceId: fixture.workspaceA.id
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not attach synced Gmail logs to soft-deleted organizations", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await fixture.prisma.organization.update({
        where: { id: fixture.recordsA.organization.id },
        data: { deletedAt: new Date("2026-06-26T16:00:00.000Z") }
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            id: "gmail-soft-deleted-org-1",
            headers: {
              Date: "Fri, 26 Jun 2026 12:30:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Soft-deleted organization Gmail sync",
              To: "Alex <alex@example.test>"
            },
            snippet: "This should attach to the contact without the deleted organization."
          }
        ]
      });

      const result = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 1 });

      const log = await fixture.prisma.emailLog.findFirstOrThrow({
        where: {
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: "gmail-soft-deleted-org-1",
          workspaceId: fixture.workspaceA.id
        }
      });
      expect(log).toMatchObject({
        dealId: fixture.recordsA.deal.id,
        organizationId: null,
        personId: fixture.recordsA.person.id,
        workspaceId: fixture.workspaceA.id
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not match synced Gmail messages to soft-deleted contacts", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await fixture.prisma.person.update({
        where: { id: fixture.recordsA.person.id },
        data: { deletedAt: new Date("2026-06-26T16:45:00.000Z") }
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            id: "gmail-soft-deleted-contact-1",
            headers: {
              Date: "Fri, 26 Jun 2026 12:45:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Soft-deleted contact Gmail sync",
              To: "Alex <alex@example.test>"
            },
            snippet: "This should stay unmatched because the CRM contact is deleted."
          }
        ]
      });

      const result = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });

      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 1 });
      expect(result.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: "alpha@example.test",
          providerMessageId: "gmail-soft-deleted-contact-1",
          subject: "Soft-deleted contact Gmail sync"
        })
      ]);
      await expect(
        fixture.prisma.emailLog.findMany({
          where: {
            provider: "GOOGLE_WORKSPACE",
            providerMessageId: "gmail-soft-deleted-contact-1",
            workspaceId: fixture.workspaceA.id
          }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips Gmail messages when the matching contact email is ambiguous in the workspace", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await fixture.prisma.person.create({
        data: {
          workspaceId: fixture.workspaceA.id,
          firstName: "Duplicate",
          lastName: "Alpha",
          email: fixture.recordsA.person.email
        }
      });
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            id: "gmail-ambiguous-contact-1",
            headers: {
              Date: "Fri, 26 Jun 2026 12:30:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Ambiguous contact match",
              To: "Alex <alex@example.test>"
            },
            snippet: "This should not attach to one duplicate contact arbitrarily."
          }
        ]
      });

      const result = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });

      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 1 });
      expect(result.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: "alpha@example.test",
          providerMessageId: "gmail-ambiguous-contact-1",
          subject: "Ambiguous contact match"
        })
      ]);
      await expect(
        fixture.prisma.emailLog.findMany({
          where: {
            provider: "GOOGLE_WORKSPACE",
            providerMessageId: "gmail-ambiguous-contact-1",
            workspaceId: fixture.workspaceA.id
          }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("normalizes malformed Gmail sync limits before calling Google", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "10",
        messages: []
      });

      const result = await syncRecentGmailMessages({
        actor: fixture.actorA,
        env,
        fetchImpl,
        maxResults: Number.NaN
      });

      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 0 });
    } finally {
      await fixture.cleanup();
    }
  });

  it("returns unmatched previews when no workspace contacts can match synced messages", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await fixture.prisma.person.updateMany({
        where: { workspaceId: fixture.workspaceA.id },
        data: { email: null }
      });
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            id: "gmail-new-contact-1",
            headers: {
              Date: "Fri, 26 Jun 2026 11:00:00 -0400",
              From: "New Buyer <new-buyer@example.test>",
              Subject: "Interested in Northstar",
              To: "Alex <alex@example.test>"
            },
            snippet: "Could we talk next week?"
          }
        ]
      });

      const result = await syncRecentGmailMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 1 });
      expect(result.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: "new-buyer@example.test",
          providerMessageId: "gmail-new-contact-1",
          subject: "Interested in Northstar"
        })
      ]);
      const logs = await fixture.prisma.emailLog.findMany({
        where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" }
      });
      expect(logs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createConnectedGmailSecret(
  fixture: Awaited<ReturnType<typeof createIntegrationFixture>>,
  options: {
    accessToken: string;
    expiresAt: Date;
    refreshToken?: string;
  }
) {
  const connection = await fixture.prisma.emailConnection.create({
    data: {
      accountEmail: "alex@example.test",
      createdById: fixture.userA.id,
      provider: "GOOGLE_WORKSPACE",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
      status: "CONNECTED",
      workspaceId: fixture.workspaceA.id
    }
  });
  await fixture.prisma.emailConnectionSecret.create({
    data: {
      accessTokenExpiresAt: options.expiresAt,
      accountEmail: "alex@example.test",
      connectionId: connection.id,
      encryptedAccessToken: encryptEmailToken(options.accessToken, env),
      encryptedRefreshToken: options.refreshToken ? encryptEmailToken(options.refreshToken, env) : null,
      provider: "GOOGLE_WORKSPACE",
      scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
      userId: fixture.userA.id,
      workspaceId: fixture.workspaceA.id
    }
  });
  return connection;
}

async function createCrossWorkspaceAttachmentTrap(fixture: Awaited<ReturnType<typeof createIntegrationFixture>>) {
  await fixture.prisma.deal.update({
    where: { id: fixture.recordsA.deal.id },
    data: { status: "WON", wonAt: new Date("2026-06-26T16:00:00.000Z") }
  });
  await fixture.prisma.person.update({
    where: { id: fixture.recordsA.person.id },
    data: { organizationId: fixture.recordsB.organization.id }
  });
  return fixture.prisma.deal.create({
    data: {
      currency: "USD",
      organizationId: fixture.recordsB.organization.id,
      ownerId: fixture.userB.id,
      personId: fixture.recordsA.person.id,
      pipelineId: fixture.recordsB.pipeline.id,
      stageId: fixture.recordsB.stageOne.id,
      title: "Cross-workspace Gmail attachment trap",
      valueCents: 1000,
      workspaceId: fixture.workspaceB.id
    }
  });
}

function gmailFetchMock({
  accessToken,
  expectedMaxResults = "10",
  messages,
  refreshedAccessToken,
  refreshToken
}: {
  accessToken: string;
  expectedMaxResults?: string;
  messages: { headers: Record<string, string>; id: string; snippet: string }[];
  refreshedAccessToken?: string;
  refreshToken?: string;
}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization");

    if (url === "https://oauth2.googleapis.com/token") {
      const body = init?.body as URLSearchParams;
      expect(body.get("refresh_token")).toBe(refreshToken);
      return Response.json({ access_token: refreshedAccessToken, expires_in: 3600 });
    }

    expect(authorization).toBe(`Bearer ${accessToken}`);

    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
      const requestUrl = new URL(url);
      expect(requestUrl.searchParams.get("maxResults")).toBe(expectedMaxResults);
      expect(requestUrl.searchParams.has("q")).toBe(false);
      return Response.json({
        messages: messages.map((message) => ({ id: message.id, threadId: `thread-${message.id}` }))
      });
    }

    const message = messages.find((item) => url.includes(`/messages/${item.id}?`));
    if (!message) return new Response(null, { status: 404 });

    return Response.json({
      id: message.id,
      internalDate: String(Date.parse(message.headers.Date)),
      payload: {
        headers: Object.entries(message.headers).map(([name, value]) => ({ name, value }))
      },
      snippet: message.snippet,
      threadId: `thread-${message.id}`
    });
  }) as typeof fetch;
}
