import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/responses";
import { decryptEmailToken, encryptEmailToken } from "@/lib/email/token-encryption";
import {
  buildMicrosoftAuthorizationUrl,
  listEmailConnectionProviderCards,
  microsoftOAuthScopes,
  storeMicrosoftOAuthConnection,
  syncRecentMicrosoftMessages
} from "@/lib/services/email-connection-service";
import { createIntegrationFixture } from "./fixtures";

const env = {
  EMAIL_TOKEN_ENCRYPTION_KEY: "microsoft-sync-test-key-32-bytes",
  MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
  MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
  MICROSOFT_OAUTH_REDIRECT_URI: "https://crm.example.test/api/email-connections/microsoft/callback"
};

describe("Microsoft Graph metadata sync", () => {
  it("builds a minimal Microsoft authorization URL without write scopes", () => {
    const url = buildMicrosoftAuthorizationUrl({
      config: {
        clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
        clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
        redirectUri: env.MICROSOFT_OAUTH_REDIRECT_URI
      },
      env,
      state: "signed-state"
    });

    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe(microsoftOAuthScopes.join(" "));
    expect(url.searchParams.get("scope")).toContain("Mail.Read");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).not.toContain("Mail.Send");
    expect(url.searchParams.get("scope")).not.toContain("Mail.ReadWrite");

    const tenantUrl = buildMicrosoftAuthorizationUrl({
      config: {
        clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
        clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
        redirectUri: env.MICROSOFT_OAUTH_REDIRECT_URI
      },
      env: { ...env, MICROSOFT_OAUTH_TENANT_ID: "contoso.onmicrosoft.com" },
      state: "signed-state"
    });
    const malformedTenantUrl = buildMicrosoftAuthorizationUrl({
      config: {
        clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
        clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
        redirectUri: env.MICROSOFT_OAUTH_REDIRECT_URI
      },
      env: { ...env, MICROSOFT_OAUTH_TENANT_ID: "common/oauth2/v2.0" },
      state: "signed-state"
    });

    expect(tenantUrl.pathname).toBe("/contoso.onmicrosoft.com/oauth2/v2.0/authorize");
    expect(malformedTenantUrl.pathname).toBe("/common/oauth2/v2.0/authorize");
  });

  it("stores Microsoft OAuth tokens encrypted", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connectionCountBeforeMalformedProfile = await fixture.prisma.emailConnection.count({
        where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" }
      });

      await expect(
        storeMicrosoftOAuthConnection({
          actor: fixture.actorA,
          env,
          profile: {
            displayName: "Alex Microsoft",
            mail: { address: "alex@example.test" } as unknown as string,
            userPrincipalName: null as unknown as string
          },
          tokenResponse: {
            access_token: "microsoft-malformed-access-token",
            refresh_token: "microsoft-malformed-refresh-token",
            scope: microsoftOAuthScopes.join(" ")
          }
        })
      ).rejects.toMatchObject({
        code: "EMAIL_OAUTH_PROFILE_MISSING_EMAIL",
        message: "Microsoft did not return an account email address.",
        status: 400
      });
      expect(await fixture.prisma.emailConnection.count({ where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" } })).toBe(
        connectionCountBeforeMalformedProfile
      );

      const connection = await storeMicrosoftOAuthConnection({
        actor: fixture.actorA,
        env,
        profile: {
          displayName: "Alex Microsoft",
          mail: "alex@example.test",
          userPrincipalName: "alex@example.test"
        },
        tokenResponse: {
          access_token: "microsoft-access-token",
          expires_in: { seconds: 3600 } as unknown as number,
          refresh_token: "microsoft-refresh-token",
          scope: { value: microsoftOAuthScopes.join(" ") } as unknown as string
        }
      });

      const secret = await fixture.prisma.emailConnectionSecret.findUniqueOrThrow({
        where: { connectionId: connection.id }
      });
      expect(secret.provider).toBe("MICROSOFT_365");
      expect(secret.accessTokenExpiresAt).toBeNull();
      expect(secret.scopes).toEqual([...microsoftOAuthScopes]);
      expect(secret.encryptedAccessToken).not.toContain("microsoft-access-token");
      expect(secret.encryptedRefreshToken).not.toContain("microsoft-refresh-token");
      expect(decryptEmailToken(secret.encryptedAccessToken, env)).toBe("microsoft-access-token");
      expect(decryptEmailToken(secret.encryptedRefreshToken as string, env)).toBe("microsoft-refresh-token");
    } finally {
      await fixture.cleanup();
    }
  });

  it("imports only matched recent Microsoft metadata and deduplicates provider message ids", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = microsoftFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyPreview: "Following up on the MSA.",
            from: "alpha@example.test",
            id: "ms-match-1",
            receivedDateTime: "2026-06-26T14:00:00.000Z",
            subject: "MSA follow-up",
            to: "alex@example.test"
          },
          {
            bodyPreview: "This should not enter CRM history.",
            from: "vendor@example.test",
            id: "ms-noise-1",
            receivedDateTime: "2026-06-26T14:05:00.000Z",
            subject: "Unmatched vendor note",
            to: "alex@example.test"
          }
        ]
      });

      const first = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(first).toMatchObject({ created: 1, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 2 });
      expect(first.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: "vendor@example.test",
          provider: "MICROSOFT_365",
          providerMessageId: "ms-noise-1",
          snippet: "This should not enter CRM history.",
          subject: "Unmatched vendor note"
        })
      ]);

      const logs = await fixture.prisma.emailLog.findMany({
        where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" }
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        body: "Microsoft snippet: Following up on the MSA.",
        dealId: fixture.recordsA.deal.id,
        direction: "INBOUND",
        personId: fixture.recordsA.person.id,
        providerMessageId: "ms-match-1",
        providerThreadId: "conversation-ms-match-1",
        subject: "MSA follow-up"
      });
      expect(logs[0].body).not.toContain("fullBody");
      expect(logs[0].body).not.toContain("attachment");

      const second = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(second).toMatchObject({ created: 0, skippedDuplicates: 1, skippedUnmatched: 1, totalFetched: 2 });
      expect(second.unmatchedPreviews).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refreshes an expired Microsoft access token without storing plaintext", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedMicrosoftSecret(fixture, {
        accessToken: "expired-access",
        expiresAt: new Date(Date.now() - 60_000),
        refreshToken: "refresh-token"
      });
      const fetchImpl = microsoftFetchMock({
        accessToken: "fresh-access",
        messages: [],
        refreshedAccessToken: "fresh-access",
        refreshToken: "refresh-token"
      });

      const result = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });
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

  it("records redacted Microsoft refresh failures without replacing the stored access token", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedMicrosoftSecret(fixture, {
        accessToken: "expired-microsoft-access-before-refresh-failure",
        expiresAt: new Date(Date.now() - 60_000),
        refreshToken: "microsoft-refresh-secret-token"
      });
      const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
        const body = init?.body as URLSearchParams;
        expect(body.get("refresh_token")).toBe("microsoft-refresh-secret-token");
        return Response.json({ error: "provider-refresh-body-secret-token" }, { status: 401 });
      }) as typeof fetch;

      await expect(syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_REFRESH_TOKEN_FAILED",
        message: "Microsoft access token could not be refreshed."
      });

      const [reloadedConnection, reloadedSecret, logs] = await Promise.all([
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.emailConnectionSecret.findUniqueOrThrow({ where: { connectionId: connection.id } }),
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" }
        })
      ]);
      expect(reloadedConnection.lastError).toBe("EMAIL_REFRESH_TOKEN_FAILED: Microsoft access token could not be refreshed.");
      expect(reloadedConnection.lastError).not.toContain("microsoft-refresh-secret-token");
      expect(reloadedConnection.lastError).not.toContain("provider-refresh-body-secret-token");
      expect(decryptEmailToken(reloadedSecret.encryptedAccessToken, env)).toBe(
        "expired-microsoft-access-before-refresh-failure"
      );
      expect(logs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a reconnect-safe Microsoft failure when an expired token has no refresh token", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedMicrosoftSecret(fixture, {
        accessToken: "expired-access-without-refresh",
        expiresAt: new Date(Date.now() - 60_000)
      });
      const fetchImpl = (async () => {
        throw new Error("Microsoft provider calls should not run without a refresh token.");
      }) as typeof fetch;

      await expect(syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_REFRESH_TOKEN_MISSING",
        message: "Reconnect Microsoft before syncing; the access token expired."
      });

      const reloaded = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(reloaded.lastError).toBe("EMAIL_REFRESH_TOKEN_MISSING: Reconnect Microsoft before syncing; the access token expired.");
      expect(reloaded.lastError).not.toContain("expired-access-without-refresh");
      await expect(
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects Microsoft sync when stored credentials do not belong to the connection workspace", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "alex@example.test",
          createdById: fixture.userA.id,
          provider: "MICROSOFT_365",
          scopes: [...microsoftOAuthScopes],
          status: "CONNECTED",
          workspaceId: fixture.workspaceA.id
        }
      });
      await fixture.prisma.emailConnectionSecret.create({
        data: {
          accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          accountEmail: "alex@example.test",
          connectionId: connection.id,
          encryptedAccessToken: encryptEmailToken("cross-workspace-microsoft-access-token", env),
          encryptedRefreshToken: null,
          provider: "MICROSOFT_365",
          scopes: [...microsoftOAuthScopes],
          userId: fixture.userB.id,
          workspaceId: fixture.workspaceB.id
        }
      });
      const fetchImpl = (async () => {
        throw new Error("Microsoft Graph should not be called with a mismatched stored credential.");
      }) as typeof fetch;

      await expect(syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_CONNECTION_SECRET_MISMATCH",
        message: "Reconnect Microsoft before syncing; stored credentials do not match this workspace."
      });

      const [reloadedConnection, logs] = await Promise.all([
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" }
        })
      ]);
      expect(reloadedConnection.lastError).toBe(
        "EMAIL_CONNECTION_SECRET_MISMATCH: Reconnect Microsoft before syncing; stored credentials do not match this workspace."
      );
      expect(reloadedConnection.lastError).not.toContain("cross-workspace-microsoft-access-token");
      expect(logs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a redacted Microsoft sync failure without importing logs", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");

        expect(authorization).toBe("Bearer access-token");
        expect(url).toContain("https://graph.microsoft.com/v1.0/me/messages?");
        return Response.json({ error: "provider-body-secret-token" }, { status: 503 });
      };

      await expect(syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_MICROSOFT_LIST_FAILED"
      });

      const reloaded = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(reloaded.lastError).toBe("EMAIL_MICROSOFT_LIST_FAILED: Recent Microsoft mail could not be listed.");
      expect(reloaded.lastError).not.toContain("access-token");
      expect(reloaded.lastError).not.toContain("provider-body-secret-token");
      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "MICROSOFT_365"
      );
      expect(providerCard).toMatchObject({
        lastError: "EMAIL_MICROSOFT_LIST_FAILED: Recent Microsoft mail could not be listed.",
        status: "Sync issue",
        syncAvailable: true
      });
      await expect(
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("records a provider-specific Microsoft sync failure when a successful provider response is not JSON", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");

        expect(authorization).toBe("Bearer access-token");
        expect(url).toContain("https://graph.microsoft.com/v1.0/me/messages?");
        return new Response("<html>provider-body-secret-token</html>", {
          headers: { "content-type": "text/html" },
          status: 200
        });
      };

      await expect(syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_MICROSOFT_LIST_FAILED",
        message: "Recent Microsoft mail could not be listed."
      });

      const reloaded = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(reloaded.lastError).toBe("EMAIL_MICROSOFT_LIST_FAILED: Recent Microsoft mail could not be listed.");
      expect(reloaded.lastError).not.toContain("access-token");
      expect(reloaded.lastError).not.toContain("provider-body-secret-token");
      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "MICROSOFT_365"
      );
      expect(providerCard).toMatchObject({
        lastError: "EMAIL_MICROSOFT_LIST_FAILED: Recent Microsoft mail could not be listed.",
        status: "Sync issue",
        syncAvailable: true
      });
      await expect(
        fixture.prisma.emailLog.findMany({
          where: { workspaceId: fixture.workspaceA.id, provider: "MICROSOFT_365" }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("redacts sensitive typed Microsoft sync diagnostics before displaying provider status", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedMicrosoftSecret(fixture, {
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

      await expect(syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
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
        (provider) => provider.provider === "MICROSOFT_365"
      );
      expect(providerCard).toMatchObject({
        lastError: reloaded.lastError,
        status: "Sync issue"
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("redacts legacy Microsoft sync diagnostics before displaying provider status", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "alex@example.test",
          createdById: fixture.userA.id,
          lastError:
            "Legacy failure with Bearer legacy-microsoft-access-token at https://preview:secret@crm.example.test/reset-password?token=legacy-reset-token for founder@example.test clientSecret=legacy-client-secret",
          provider: "MICROSOFT_365",
          scopes: [...microsoftOAuthScopes],
          status: "CONNECTED",
          workspaceId: fixture.workspaceA.id
        }
      });

      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "MICROSOFT_365"
      );

      expect(providerCard).toMatchObject({
        lastError:
          "Legacy failure with Bearer [redacted] at [redacted reset url] for [redacted email] clientSecret=[redacted]",
        status: "Sync issue"
      });
      expect(providerCard?.lastError).not.toContain("legacy-microsoft-access-token");
      expect(providerCard?.lastError).not.toContain("legacy-reset-token");
      expect(providerCard?.lastError).not.toContain("founder@example.test");
      expect(providerCard?.lastError).not.toContain("legacy-client-secret");
      expect(providerCard?.lastError).not.toContain("preview:secret");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not attach synced Microsoft logs to cross-workspace deal or organization links", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await createCrossWorkspaceAttachmentTrap(fixture);
      const fetchImpl = microsoftFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyPreview: "This should stay on the matched person only.",
            from: "alpha@example.test",
            id: "ms-cross-workspace-1",
            receivedDateTime: "2026-06-26T16:00:00.000Z",
            subject: "Workspace-safe Microsoft sync",
            to: "alex@example.test"
          }
        ]
      });

      const result = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 1 });

      const log = await fixture.prisma.emailLog.findFirstOrThrow({
        where: {
          provider: "MICROSOFT_365",
          providerMessageId: "ms-cross-workspace-1",
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

  it("does not attach synced Microsoft logs to soft-deleted organizations", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await fixture.prisma.organization.update({
        where: { id: fixture.recordsA.organization.id },
        data: { deletedAt: new Date("2026-06-26T16:00:00.000Z") }
      });
      const fetchImpl = microsoftFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyPreview: "This should attach to the contact without the deleted organization.",
            from: "alpha@example.test",
            id: "ms-soft-deleted-org-1",
            receivedDateTime: "2026-06-26T16:30:00.000Z",
            subject: "Soft-deleted organization Microsoft sync",
            to: "alex@example.test"
          }
        ]
      });

      const result = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 1 });

      const log = await fixture.prisma.emailLog.findFirstOrThrow({
        where: {
          provider: "MICROSOFT_365",
          providerMessageId: "ms-soft-deleted-org-1",
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

  it("does not match synced Microsoft messages to soft-deleted contacts", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await fixture.prisma.person.update({
        where: { id: fixture.recordsA.person.id },
        data: { deletedAt: new Date("2026-06-26T16:45:00.000Z") }
      });
      const fetchImpl = microsoftFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyPreview: "This should stay unmatched because the CRM contact is deleted.",
            from: "alpha@example.test",
            id: "ms-soft-deleted-contact-1",
            receivedDateTime: "2026-06-26T16:45:00.000Z",
            subject: "Soft-deleted contact Microsoft sync",
            to: "alex@example.test"
          }
        ]
      });

      const result = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });

      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 1 });
      expect(result.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: "alpha@example.test",
          providerMessageId: "ms-soft-deleted-contact-1",
          subject: "Soft-deleted contact Microsoft sync"
        })
      ]);
      await expect(
        fixture.prisma.emailLog.findMany({
          where: {
            provider: "MICROSOFT_365",
            providerMessageId: "ms-soft-deleted-contact-1",
            workspaceId: fixture.workspaceA.id
          }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips Microsoft messages when the matching contact email is ambiguous in the workspace", async () => {
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
      await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = microsoftFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyPreview: "This should not attach to one duplicate contact arbitrarily.",
            from: "alpha@example.test",
            id: "ms-ambiguous-contact-1",
            receivedDateTime: "2026-06-26T16:30:00.000Z",
            subject: "Ambiguous Microsoft contact match",
            to: "alex@example.test"
          }
        ]
      });

      const result = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });

      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 1 });
      expect(result.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: "alpha@example.test",
          providerMessageId: "ms-ambiguous-contact-1",
          subject: "Ambiguous Microsoft contact match"
        })
      ]);
      await expect(
        fixture.prisma.emailLog.findMany({
          where: {
            provider: "MICROSOFT_365",
            providerMessageId: "ms-ambiguous-contact-1",
            workspaceId: fixture.workspaceA.id
          }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not match Microsoft messages to contacts from another workspace", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = microsoftFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyPreview: "This belongs to the other workspace contact only.",
            from: fixture.recordsB.person.email ?? "beta@example.test",
            id: "ms-cross-workspace-contact-only-1",
            receivedDateTime: "2026-06-26T17:00:00.000Z",
            subject: "Other workspace contact",
            to: "alex@example.test"
          }
        ]
      });

      const result = await syncRecentMicrosoftMessages({ actor: fixture.actorA, env, fetchImpl });

      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 1, totalFetched: 1 });
      expect(result.unmatchedPreviews).toEqual([
        expect.objectContaining({
          email: fixture.recordsB.person.email,
          provider: "MICROSOFT_365",
          providerMessageId: "ms-cross-workspace-contact-only-1",
          subject: "Other workspace contact"
        })
      ]);
      await expect(
        fixture.prisma.emailLog.findMany({
          where: {
            provider: "MICROSOFT_365",
            providerMessageId: "ms-cross-workspace-contact-only-1"
          }
        })
      ).resolves.toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("normalizes malformed Microsoft sync limits before calling Graph", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedMicrosoftSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = microsoftFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "10",
        messages: []
      });

      const result = await syncRecentMicrosoftMessages({
        actor: fixture.actorA,
        env,
        fetchImpl,
        maxResults: Number.POSITIVE_INFINITY
      });

      expect(result).toMatchObject({ created: 0, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 0 });
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createConnectedMicrosoftSecret(
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
      provider: "MICROSOFT_365",
      scopes: [...microsoftOAuthScopes],
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
      provider: "MICROSOFT_365",
      scopes: [...microsoftOAuthScopes],
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
      title: "Cross-workspace Microsoft attachment trap",
      valueCents: 1000,
      workspaceId: fixture.workspaceB.id
    }
  });
}

function microsoftFetchMock({
  accessToken,
  expectedMaxResults = "10",
  messages,
  refreshedAccessToken,
  refreshToken
}: {
  accessToken: string;
  expectedMaxResults?: string;
  messages: { bodyPreview: string; from: string; id: string; receivedDateTime: string; subject: string; to: string }[];
  refreshedAccessToken?: string;
  refreshToken?: string;
}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization");

    if (url === "https://login.microsoftonline.com/common/oauth2/v2.0/token") {
      const body = init?.body as URLSearchParams;
      expect(body.get("refresh_token")).toBe(refreshToken);
      return Response.json({ access_token: refreshedAccessToken, expires_in: 3600 });
    }

    expect(authorization).toBe(`Bearer ${accessToken}`);

    if (url.startsWith("https://graph.microsoft.com/v1.0/me/messages?")) {
      const requestUrl = new URL(url);
      expect(requestUrl.searchParams.get("$top")).toBe(expectedMaxResults);
      expect(requestUrl.searchParams.get("$select")).toBe(
        "id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview"
      );
      expect(requestUrl.searchParams.get("$select")).not.toContain("body,");
      expect(requestUrl.searchParams.get("$select")).not.toContain("attachments");
      return Response.json({
        value: messages.map((message) => ({
          bodyPreview: message.bodyPreview,
          conversationId: `conversation-${message.id}`,
          from: { emailAddress: { address: message.from, name: message.from } },
          id: message.id,
          receivedDateTime: message.receivedDateTime,
          subject: message.subject,
          toRecipients: [{ emailAddress: { address: message.to, name: message.to } }]
        }))
      });
    }

    return new Response(null, { status: 404 });
  }) as typeof fetch;
}
