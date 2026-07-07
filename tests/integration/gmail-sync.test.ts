import { JobStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/responses";
import { decryptEmailToken, encryptEmailToken } from "@/lib/email/token-encryption";
import {
  disconnectEmailConnection,
  diagnoseGmailConnection,
  enqueueGmailInboxSyncJob,
  gmailInboxSyncJobType,
  listEmailInboxThreads,
  listEmailConnectionProviderCards,
  processGmailInboxSyncJob,
  refreshGmailInboxThread,
  resolveGoogleOAuthGrantedScopes,
  runGmailInboxSyncNow,
  sendGmailReplyFromEmailLog,
  storeGoogleOAuthConnection,
  syncGmailInboxMessages,
  syncOlderGmailInboxMessages,
  syncRecentGmailMessages
} from "@/lib/services/email-connection-service";
import { createIntegrationFixture } from "./fixtures";

const env = {
  EMAIL_TOKEN_ENCRYPTION_KEY: "gmail-sync-test-key-32-bytes-min",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://crm.example.test/api/email-connections/google/callback"
};
const gmailFullInboxScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send"
];

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
          scopes: gmailFullInboxScopes,
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
          scope: gmailFullInboxScopes.join(" ")
        }
      });
      const secret = await fixture.prisma.emailConnectionSecret.findUniqueOrThrow({
        where: { connectionId: connection.id }
      });

      expect(connection.accountEmail).toBe("alex@example.test");
      expect(secret.accountEmail).toBe("alex@example.test");
      expect(secret.accessTokenExpiresAt).toBeNull();
      expect(secret.scopes).toEqual(gmailFullInboxScopes);
      expect(secret.encryptedAccessToken).not.toContain("gmail-access-token");
      expect(secret.encryptedRefreshToken).not.toContain("gmail-refresh-token");
      expect(decryptEmailToken(secret.encryptedAccessToken, env)).toBe("gmail-access-token");
      expect(decryptEmailToken(secret.encryptedRefreshToken as string, env)).toBe("gmail-refresh-token");
      const syncJob = await fixture.prisma.job.findFirstOrThrow({
        where: { type: gmailInboxSyncJobType, workspaceId: fixture.workspaceA.id }
      });
      expect(syncJob.payload).toEqual({
        connectionId: connection.id,
        workspaceId: fixture.workspaceA.id
      });
      expect(JSON.stringify(syncJob.payload)).not.toContain("gmail-access-token");
      expect(JSON.stringify(syncJob.payload)).not.toContain("gmail-refresh-token");
    } finally {
      await fixture.cleanup();
    }
  });

  it("stores only Google-returned scopes and does not mark metadata-only reconnects Full Inbox ready", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await storeGoogleOAuthConnection({
        actor: fixture.actorA,
        env,
        profile: {
          email: "alex@example.test",
          name: "Alex Gmail"
        },
        tokenResponse: {
          access_token: "gmail-metadata-only-access-token",
          expires_in: 3600,
          refresh_token: "gmail-metadata-only-refresh-token",
          scope: "openid email https://www.googleapis.com/auth/gmail.metadata"
        }
      });
      const [secret, providerCard, jobs] = await Promise.all([
        fixture.prisma.emailConnectionSecret.findUniqueOrThrow({ where: { connectionId: connection.id } }),
        listEmailConnectionProviderCards(fixture.actorA, env).then((cards) =>
          cards.find((provider) => provider.provider === "GOOGLE_WORKSPACE")
        ),
        fixture.prisma.job.findMany({ where: { type: gmailInboxSyncJobType, workspaceId: fixture.workspaceA.id } })
      ]);

      expect(connection.scopes).toEqual(["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"]);
      expect(secret.scopes).toEqual(["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"]);
      expect(providerCard).toMatchObject({
        accountEmail: "alex@example.test",
        lastError:
          "EMAIL_OAUTH_GMAIL_SCOPES_MISSING: Google did not grant Gmail read/send permissions. Granted scope categories: sign-in, email, Gmail metadata. Missing: Gmail read, Gmail send. Check the Google OAuth consent screen/scopes and reconnect Gmail again.",
        status: "Reconnect required",
        syncAvailable: false
      });
      expect(jobs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("verifies omitted Google token-response scopes through tokeninfo and marks Full Inbox ready", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const scopeResolution = await resolveGoogleOAuthGrantedScopes({
        accessToken: "gmail-verified-access-token",
        fetchImpl: async (input) => {
          const url = new URL(String(input));
          expect(url.origin + url.pathname).toBe("https://oauth2.googleapis.com/tokeninfo");
          expect(url.searchParams.get("access_token")).toBe("gmail-verified-access-token");
          return Response.json({ scope: gmailFullInboxScopes.join(" ") });
        },
        tokenResponse: {
          access_token: "gmail-verified-access-token",
          expires_in: 3600,
          refresh_token: "gmail-verified-refresh-token"
        }
      });
      expect(scopeResolution).toMatchObject({
        missingRequiredScopes: [],
        scopes: gmailFullInboxScopes,
        source: "tokeninfo",
        tokenResponseScopes: []
      });

      const connection = await storeGoogleOAuthConnection({
        actor: fixture.actorA,
        env,
        grantedScopes: scopeResolution.scopes,
        profile: {
          email: "alex@example.test",
          name: "Alex Gmail"
        },
        scopeResolution,
        tokenResponse: {
          access_token: "gmail-verified-access-token",
          expires_in: 3600,
          refresh_token: "gmail-verified-refresh-token"
        }
      });
      const [secret, providerCard, jobs] = await Promise.all([
        fixture.prisma.emailConnectionSecret.findUniqueOrThrow({ where: { connectionId: connection.id } }),
        listEmailConnectionProviderCards(fixture.actorA, env).then((cards) =>
          cards.find((provider) => provider.provider === "GOOGLE_WORKSPACE")
        ),
        fixture.prisma.job.findMany({ where: { type: gmailInboxSyncJobType, workspaceId: fixture.workspaceA.id } })
      ]);

      expect(connection.scopes).toEqual(gmailFullInboxScopes);
      expect(secret.scopes).toEqual(gmailFullInboxScopes);
      expect(providerCard).toMatchObject({
        accountEmail: "alex@example.test",
        lastError: null,
        status: "Connected",
        syncAvailable: true
      });
      expect(jobs).toHaveLength(1);
      expect(JSON.stringify(jobs[0].payload)).not.toContain("gmail-verified-access-token");
      expect(JSON.stringify(jobs[0].payload)).not.toContain("gmail-verified-refresh-token");
    } finally {
      await fixture.cleanup();
    }
  });

  it("shows safe missing-scope categories when tokeninfo verifies partial Gmail grants", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const scopeResolution = await resolveGoogleOAuthGrantedScopes({
        accessToken: "gmail-partial-access-token",
        fetchImpl: async () => Response.json({ scope: "openid email https://www.googleapis.com/auth/gmail.metadata" }),
        tokenResponse: {
          access_token: "gmail-partial-access-token",
          expires_in: 3600,
          refresh_token: "gmail-partial-refresh-token"
        }
      });
      const connection = await storeGoogleOAuthConnection({
        actor: fixture.actorA,
        env,
        grantedScopes: scopeResolution.scopes,
        profile: {
          email: "alex@example.test",
          name: "Alex Gmail"
        },
        scopeResolution,
        tokenResponse: {
          access_token: "gmail-partial-access-token",
          expires_in: 3600,
          refresh_token: "gmail-partial-refresh-token"
        }
      });
      const [providerCard, jobs] = await Promise.all([
        listEmailConnectionProviderCards(fixture.actorA, env).then((cards) =>
          cards.find((provider) => provider.provider === "GOOGLE_WORKSPACE")
        ),
        fixture.prisma.job.findMany({ where: { type: gmailInboxSyncJobType, workspaceId: fixture.workspaceA.id } })
      ]);

      expect(scopeResolution).toMatchObject({
        missingRequiredScopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
        scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
        source: "tokeninfo"
      });
      expect(connection.lastError).toContain("EMAIL_OAUTH_GMAIL_SCOPES_MISSING");
      expect(connection.lastError).toContain("Granted scope categories: sign-in, email, Gmail metadata.");
      expect(connection.lastError).toContain("Missing: Gmail read, Gmail send.");
      expect(connection.lastError).not.toContain("gmail-partial-access-token");
      expect(providerCard).toMatchObject({
        accountEmail: "alex@example.test",
        lastError: connection.lastError,
        status: "Reconnect required",
        syncAvailable: false
      });
      expect(jobs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats Gmail reconnect as ready when current scopes and encrypted credentials are refreshed", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const legacyConnection = await fixture.prisma.emailConnection.create({
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
          connectionId: legacyConnection.id,
          encryptedAccessToken: encryptEmailToken("legacy-access-token", env),
          encryptedRefreshToken: encryptEmailToken("legacy-refresh-token", env),
          provider: "GOOGLE_WORKSPACE",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
          userId: fixture.userA.id,
          workspaceId: fixture.workspaceA.id
        }
      });

      const beforeReconnect = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(beforeReconnect).toMatchObject({
        status: "Reconnect required",
        syncAvailable: false
      });

      const reconnected = await storeGoogleOAuthConnection({
        actor: fixture.actorA,
        env,
        profile: {
          email: "alex@example.test",
          name: "Alex Gmail"
        },
        tokenResponse: {
          access_token: "gmail-reconnect-access-token",
          expires_in: 3600,
          refresh_token: "gmail-reconnect-refresh-token",
          scope: gmailFullInboxScopes.join(" ")
        }
      });
      expect(reconnected.id).toBe(legacyConnection.id);
      expect(reconnected.scopes).toEqual(gmailFullInboxScopes);

      const secret = await fixture.prisma.emailConnectionSecret.findUniqueOrThrow({
        where: { connectionId: reconnected.id }
      });
      expect(secret.scopes).toEqual(gmailFullInboxScopes);
      expect(decryptEmailToken(secret.encryptedAccessToken, env)).toBe("gmail-reconnect-access-token");
      expect(decryptEmailToken(secret.encryptedRefreshToken as string, env)).toBe("gmail-reconnect-refresh-token");

      const afterReconnect = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(afterReconnect).toMatchObject({
        accountEmail: "alex@example.test",
        status: "Connected",
        syncAvailable: true
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("upgrades a stale Gmail row when reconnect omits scope but tokeninfo verifies Full Inbox grants", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const legacyConnection = await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "alex@example.test",
          createdById: fixture.userA.id,
          lastError: "Previous scope warning",
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
          connectionId: legacyConnection.id,
          encryptedAccessToken: encryptEmailToken("legacy-access-token", env),
          encryptedRefreshToken: encryptEmailToken("legacy-refresh-token", env),
          provider: "GOOGLE_WORKSPACE",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
          userId: fixture.userA.id,
          workspaceId: fixture.workspaceA.id
        }
      });

      const scopeResolution = await resolveGoogleOAuthGrantedScopes({
        accessToken: "gmail-verified-reconnect-access-token",
        fetchImpl: async () => Response.json({ scope: gmailFullInboxScopes.join(" ") }),
        tokenResponse: {
          access_token: "gmail-verified-reconnect-access-token",
          expires_in: 3600,
          refresh_token: "gmail-verified-reconnect-refresh-token"
        }
      });
      const reconnected = await storeGoogleOAuthConnection({
        actor: fixture.actorA,
        env,
        grantedScopes: scopeResolution.scopes,
        profile: {
          email: "alex@example.test",
          name: "Alex Gmail"
        },
        scopeResolution,
        tokenResponse: {
          access_token: "gmail-verified-reconnect-access-token",
          expires_in: 3600,
          refresh_token: "gmail-verified-reconnect-refresh-token"
        }
      });
      expect(reconnected.id).toBe(legacyConnection.id);
      expect(reconnected.scopes).toEqual(gmailFullInboxScopes);
      expect(reconnected.lastError).toBeNull();

      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(providerCard).toMatchObject({
        accountEmail: "alex@example.test",
        lastError: null,
        status: "Connected",
        syncAvailable: true
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("repairs stale Gmail scope summaries when encrypted reconnect credentials are current", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const staleConnection = await fixture.prisma.emailConnection.create({
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
          connectionId: staleConnection.id,
          encryptedAccessToken: encryptEmailToken("reconnected-access-token", env),
          encryptedRefreshToken: encryptEmailToken("reconnected-refresh-token", env),
          provider: "GOOGLE_WORKSPACE",
          scopes: gmailFullInboxScopes,
          userId: fixture.userA.id,
          workspaceId: fixture.workspaceA.id
        }
      });

      const afterReconnect = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(afterReconnect).toMatchObject({
        accountEmail: "alex@example.test",
        status: "Connected",
        syncAvailable: true
      });

      const repairedConnection = await fixture.prisma.emailConnection.findUniqueOrThrow({
        where: { id: staleConnection.id }
      });
      expect(repairedConnection.scopes).toEqual(gmailFullInboxScopes);
    } finally {
      await fixture.cleanup();
    }
  });

  it("prefers a scope-ready Gmail account over a newer stale connected row", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const readyConnection = await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "ready@example.test",
          createdById: fixture.userA.id,
          provider: "GOOGLE_WORKSPACE",
          scopes: gmailFullInboxScopes,
          status: "CONNECTED",
          workspaceId: fixture.workspaceA.id
        }
      });
      await fixture.prisma.emailConnectionSecret.create({
        data: {
          accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          accountEmail: "ready@example.test",
          connectionId: readyConnection.id,
          encryptedAccessToken: encryptEmailToken("ready-access-token", env),
          encryptedRefreshToken: encryptEmailToken("ready-refresh-token", env),
          provider: "GOOGLE_WORKSPACE",
          scopes: gmailFullInboxScopes,
          userId: fixture.userA.id,
          workspaceId: fixture.workspaceA.id
        }
      });

      await fixture.prisma.emailConnection.create({
        data: {
          accountEmail: "stale-newer@example.test",
          createdById: fixture.userA.id,
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
        accountEmail: "ready@example.test",
        status: "Connected",
        syncAvailable: true
      });
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
        status: "Reconnect required"
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

  it("stores recent Gmail inbox messages with full bodies, provider labels, and thread summaries", async () => {
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
            bodyText: "Full NDA follow-up body for CRM review.",
            headers: {
              Date: "Fri, 26 Jun 2026 13:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Full inbox NDA follow-up",
              To: "Alex <alex@example.test>"
            },
            id: "gmail-full-match-1",
            labelIds: ["INBOX", "UNREAD"],
            snippet: "Full NDA follow-up body"
          },
          {
            bodyText: "Unmatched buyer body still belongs in Full Inbox.",
            headers: {
              Date: "Fri, 26 Jun 2026 13:05:00 -0400",
              From: "New Buyer <new-buyer@example.test>",
              Subject: "Full inbox new buyer",
              To: "Alex <alex@example.test>"
            },
            id: "gmail-full-unmatched-1",
            labelIds: ["INBOX"],
            snippet: "Unmatched buyer body"
          }
        ]
      });

      const result = await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl });
      expect(result).toMatchObject({ created: 2, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 2 });
      expect(result.unmatchedPreviews).toEqual([]);

      const logs = await fixture.prisma.emailLog.findMany({
        where: { workspaceId: fixture.workspaceA.id, provider: "GOOGLE_WORKSPACE" },
        orderBy: { occurredAt: "asc" }
      });
      expect(logs).toHaveLength(2);
      expect(logs[0]).toMatchObject({
        body: "Full NDA follow-up body for CRM review.",
        personId: fixture.recordsA.person.id,
        providerLabels: ["INBOX", "UNREAD"],
        providerMessageId: "gmail-full-match-1",
        providerSnippet: "Full NDA follow-up body"
      });
      expect(logs[1]).toMatchObject({
        body: "Unmatched buyer body still belongs in Full Inbox.",
        personId: null,
        providerLabels: ["INBOX"],
        providerMessageId: "gmail-full-unmatched-1"
      });

      const threads = await listEmailInboxThreads(fixture.actorA);
      expect(threads.map((thread) => thread.subject)).toEqual(["Full inbox new buyer", "Full inbox NDA follow-up"]);
      expect(threads.find((thread) => thread.subject === "Full inbox NDA follow-up")).toMatchObject({
        isUnread: true,
        linkedRecordLabel: "Deal: Alpha Needle Deal",
        messageCount: 1
      });
      expect(threads.find((thread) => thread.subject === "Full inbox new buyer")).toMatchObject({
        isUnread: false,
        linkedRecordLabel: null,
        messageCount: 1
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("stores normal Gmail inbox messages from unknown senders without requiring a CRM match", async () => {
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
            bodyText: "This is a normal Gmail inbox message from someone not yet in CRM.",
            headers: {
              Date: "Fri, 26 Jun 2026 13:15:00 -0400",
              From: "Unknown Sender <unknown-sender@example.test>",
              Subject: "Normal Gmail inbox message",
              To: "Alex <alex@example.test>"
            },
            id: "gmail-normal-unknown-sender-1",
            labelIds: ["INBOX", "UNREAD"],
            snippet: "This is a normal Gmail inbox message"
          }
        ]
      });

      const result = await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl });

      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, skippedUnmatched: 0, totalFetched: 1 });
      expect(result.unmatchedPreviews).toEqual([]);
      const [log, threads] = await Promise.all([
        fixture.prisma.emailLog.findFirstOrThrow({
          where: {
            providerMessageId: "gmail-normal-unknown-sender-1",
            workspaceId: fixture.workspaceA.id
          }
        }),
        listEmailInboxThreads(fixture.actorA)
      ]);
      expect(log).toMatchObject({
        body: "This is a normal Gmail inbox message from someone not yet in CRM.",
        dealId: null,
        leadId: null,
        organizationId: null,
        personId: null,
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["INBOX", "UNREAD"],
        subject: "Normal Gmail inbox message"
      });
      expect(threads.find((thread) => thread.subject === "Normal Gmail inbox message")).toMatchObject({
        isUnread: true,
        linkedRecordLabel: null,
        messageCount: 1
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("loads older Gmail inbox messages without duplicates or global cursor changes", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const initialFetch = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyText: "Current inbox body.",
            headers: {
              Date: "Fri, 26 Jun 2026 13:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Current inbox",
              To: "Alex <alex@example.test>"
            },
            historyId: "3001",
            id: "gmail-current-inbox-1",
            snippet: "Current inbox body"
          }
        ]
      });
      await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl: initialFetch });
      await expect(fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({
        lastSyncCursor: "historyId:3001"
      });

      const olderFetch = gmailFetchMock({
        accessToken: "access-token",
        expectedGmailQuery: "before:2026/06/26",
        expectedMaxResults: "25",
        messages: [
          {
            bodyText: "Current inbox body refreshed.",
            headers: {
              Date: "Fri, 26 Jun 2026 13:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Current inbox",
              To: "Alex <alex@example.test>"
            },
            historyId: "3001",
            id: "gmail-current-inbox-1",
            snippet: "Current inbox body refreshed"
          },
          {
            bodyText: "Older inbox body.",
            headers: {
              Date: "Thu, 25 Jun 2026 09:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Older inbox",
              To: "Alex <alex@example.test>"
            },
            historyId: "2501",
            id: "gmail-older-inbox-1",
            snippet: "Older inbox body"
          }
        ]
      });

      const result = await syncOlderGmailInboxMessages({
        actor: fixture.actorA,
        before: "2026-06-26T13:00:00.000Z",
        env,
        fetchImpl: olderFetch
      });
      expect(result).toMatchObject({ created: 1, skippedDuplicates: 1, syncMode: "older", totalFetched: 2 });

      const [logs, reloadedConnection] = await Promise.all([
        fixture.prisma.emailLog.findMany({
          where: { provider: "GOOGLE_WORKSPACE", workspaceId: fixture.workspaceA.id },
          orderBy: { occurredAt: "asc" }
        }),
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })
      ]);
      expect(logs.map((log) => log.providerMessageId)).toEqual(["gmail-older-inbox-1", "gmail-current-inbox-1"]);
      expect(reloadedConnection.lastSyncCursor).toBe("historyId:3001");
    } finally {
      await fixture.cleanup();
    }
  });

  it("queues Gmail background sync jobs with scoped metadata payloads and processes them safely", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const job = await enqueueGmailInboxSyncJob(fixture.actorA);
      const duplicate = await enqueueGmailInboxSyncJob(fixture.actorA);

      expect(duplicate.id).toBe(job.id);
      expect(job).toMatchObject({
        dedupeKey: `gmail-inbox-sync:${connection.id}`,
        status: "PENDING",
        type: gmailInboxSyncJobType,
        workspaceId: fixture.workspaceA.id
      });
      expect(job.payload).toEqual({
        connectionId: connection.id,
        workspaceId: fixture.workspaceA.id
      });
      expect(JSON.stringify(job.payload)).not.toContain("access-token");
      expect(JSON.stringify(job.payload)).not.toContain("refresh-token");

      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "25",
        messages: [
          {
            bodyText: "Background sync body for CRM review.",
            headers: {
              Date: "Fri, 26 Jun 2026 15:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Background sync",
              To: "Alex <alex@example.test>"
            },
            historyId: "1001",
            id: "gmail-background-sync-1",
            labelIds: ["INBOX", "UNREAD"],
            snippet: "Background sync body"
          }
        ]
      });

      await processGmailInboxSyncJob(job.payload, { env, fetchImpl });

      const [log, reloadedConnection] = await Promise.all([
        fixture.prisma.emailLog.findFirstOrThrow({
          where: {
            providerMessageId: "gmail-background-sync-1",
            workspaceId: fixture.workspaceA.id
          }
        }),
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })
      ]);
      expect(log).toMatchObject({
        body: "Background sync body for CRM review.",
        providerLabels: ["INBOX", "UNREAD"],
        providerSnippet: "Background sync body",
        subject: "Background sync"
      });
      expect(reloadedConnection).toMatchObject({
        lastError: null,
        lastSyncCursor: "historyId:1001"
      });

      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(providerCard).toMatchObject({
        syncAvailable: true,
        syncStatusLabel: "Sync queued",
        syncStatusUpdatedAt: expect.any(Date)
      });
      expect(JSON.stringify(providerCard)).not.toContain("access-token");
      expect(JSON.stringify(providerCard)).not.toContain("refresh-token");
    } finally {
      await fixture.cleanup();
    }
  });

  it("runs an explicit Gmail sync through the queued job record and marks it complete", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const queuedJob = await enqueueGmailInboxSyncJob(fixture.actorA);
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "25",
        messages: [
          {
            bodyText: "Immediate sync body for CRM review.",
            headers: {
              Date: "Fri, 26 Jun 2026 15:30:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Immediate sync",
              To: "Alex <alex@example.test>"
            },
            historyId: "1101",
            id: "gmail-immediate-sync-1",
            labelIds: ["INBOX"],
            snippet: "Immediate sync body"
          }
        ]
      });

      const result = await runGmailInboxSyncNow(fixture.actorA, {
        env,
        fetchImpl,
        now: new Date("2030-07-01T12:00:00.000Z"),
        workerId: "test-email-page-sync"
      });

      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, syncMode: "recent", totalFetched: 1 });
      const [job, log, providerCard] = await Promise.all([
        fixture.prisma.job.findUniqueOrThrow({ where: { id: queuedJob.id } }),
        fixture.prisma.emailLog.findFirstOrThrow({
          where: {
            providerMessageId: "gmail-immediate-sync-1",
            workspaceId: fixture.workspaceA.id
          }
        }),
        listEmailConnectionProviderCards(fixture.actorA, env).then((cards) =>
          cards.find((provider) => provider.provider === "GOOGLE_WORKSPACE")
        )
      ]);

      expect(job).toMatchObject({
        attempts: 1,
        dedupeKey: `gmail-inbox-sync:${connection.id}`,
        lockedAt: null,
        lockedBy: null,
        status: "SUCCEEDED",
        type: gmailInboxSyncJobType,
        workspaceId: fixture.workspaceA.id
      });
      expect(JSON.stringify(job.payload)).not.toContain("access-token");
      expect(JSON.stringify(job.payload)).not.toContain("refresh-token");
      expect(log).toMatchObject({
        body: "Immediate sync body for CRM review.",
        providerLabels: ["INBOX"],
        providerSnippet: "Immediate sync body",
        subject: "Immediate sync"
      });
      expect(providerCard).toMatchObject({
        syncAvailable: true,
        syncStatusLabel: "Sync complete",
        syncStatusUpdatedAt: expect.any(Date)
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips one unloadable Gmail Full Inbox message and completes explicit sync with warnings", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const queuedJob = await enqueueGmailInboxSyncJob(fixture.actorA);
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "25",
        failedMessageIds: { "gmail-skipped-load-1": 404 },
        messages: [
          {
            bodyText: "The good message should still import.",
            headers: {
              Date: "Fri, 26 Jun 2026 15:30:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Import despite neighbor failure",
              To: "Alex <alex@example.test>"
            },
            historyId: "1201",
            id: "gmail-partial-success-1",
            labelIds: ["INBOX"],
            snippet: "The good message should still import."
          },
          {
            headers: {
              Date: "Fri, 26 Jun 2026 15:31:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Unavailable Gmail message",
              To: "Alex <alex@example.test>"
            },
            historyId: "1202",
            id: "gmail-skipped-load-1",
            labelIds: ["INBOX"],
            snippet: "This provider message cannot be loaded."
          }
        ]
      });

      const result = await runGmailInboxSyncNow(fixture.actorA, {
        env,
        fetchImpl,
        now: new Date("2030-07-01T12:10:00.000Z"),
        workerId: "test-email-page-sync"
      });

      expect(result).toMatchObject({
        created: 1,
        skippedDuplicates: 0,
        skippedMessageFailures: 1,
        syncMode: "recent",
        syncWarning: "Gmail sync completed with warnings: 1 Gmail message could not be loaded and was skipped.",
        totalFetched: 2
      });
      const [job, importedLogs, reloadedConnection, auditLogs, providerCard] = await Promise.all([
        fixture.prisma.job.findUniqueOrThrow({ where: { id: queuedJob.id } }),
        fixture.prisma.emailLog.findMany({
          where: { provider: "GOOGLE_WORKSPACE", workspaceId: fixture.workspaceA.id },
          orderBy: { providerMessageId: "asc" }
        }),
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.auditLog.findMany({
          where: { action: "email_connection.inbox_synced", workspaceId: fixture.workspaceA.id }
        }),
        listEmailConnectionProviderCards(fixture.actorA, env).then((cards) =>
          cards.find((provider) => provider.provider === "GOOGLE_WORKSPACE")
        )
      ]);

      expect(job).toMatchObject({ status: "SUCCEEDED", type: gmailInboxSyncJobType });
      expect(importedLogs).toHaveLength(1);
      expect(importedLogs[0]).toMatchObject({
        providerMessageId: "gmail-partial-success-1",
        subject: "Import despite neighbor failure"
      });
      expect(reloadedConnection.lastError).toBe(
        "Gmail sync completed with warnings: 1 Gmail message could not be loaded and was skipped."
      );
      expect(reloadedConnection.lastError).not.toContain("access-token");
      expect(reloadedConnection.lastError).not.toContain("provider-body-secret-token");
      expect(providerCard).toMatchObject({
        lastError: reloadedConnection.lastError,
        status: "Connected with warnings",
        syncStatusLabel: "Sync complete"
      });
      expect(JSON.stringify(auditLogs[0]?.metadata)).toContain('"skippedMessageFailures":1');
      expect(JSON.stringify(auditLogs[0]?.metadata)).toContain('"message_load_not_found":1');
      expect(JSON.stringify(auditLogs[0]?.metadata)).not.toContain("provider-body-secret-token");
      expect(JSON.stringify(auditLogs[0]?.metadata)).not.toContain("Unavailable Gmail message");
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails clearly when every listed Gmail Full Inbox message cannot be loaded", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const queuedJob = await enqueueGmailInboxSyncJob(fixture.actorA);
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "25",
        failedMessageIds: { "gmail-all-failed-1": 404, "gmail-all-failed-2": 404 },
        messages: [
          {
            headers: {
              Date: "Fri, 26 Jun 2026 15:40:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Unavailable one",
              To: "Alex <alex@example.test>"
            },
            id: "gmail-all-failed-1",
            labelIds: ["INBOX"],
            snippet: "Cannot load one"
          },
          {
            headers: {
              Date: "Fri, 26 Jun 2026 15:41:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Unavailable two",
              To: "Alex <alex@example.test>"
            },
            id: "gmail-all-failed-2",
            labelIds: ["INBOX"],
            snippet: "Cannot load two"
          }
        ]
      });

      await expect(
        runGmailInboxSyncNow(fixture.actorA, {
          env,
          fetchImpl,
          now: new Date("2030-07-01T12:20:00.000Z"),
          workerId: "test-email-page-sync"
        })
      ).rejects.toMatchObject({
        code: "EMAIL_GMAIL_MESSAGES_ALL_FAILED",
        message: expect.stringContaining(
          "Gmail listed 2 inbox messages, but none could be loaded. Attempted 2; skipped 2. Reason categories: message_load_not_found=2."
        )
      });

      const [job, reloadedConnection, reloadedSecret, providerCard, logs] = await Promise.all([
        fixture.prisma.job.findUniqueOrThrow({ where: { id: queuedJob.id } }),
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.emailConnectionSecret.findUniqueOrThrow({ where: { connectionId: connection.id } }),
        listEmailConnectionProviderCards(fixture.actorA, env).then((cards) =>
          cards.find((provider) => provider.provider === "GOOGLE_WORKSPACE")
        ),
        fixture.prisma.emailLog.findMany({
          where: { provider: "GOOGLE_WORKSPACE", workspaceId: fixture.workspaceA.id }
        })
      ]);
      expect(job).toMatchObject({
        lastError: expect.stringContaining(
          "Gmail listed 2 inbox messages, but none could be loaded. Attempted 2; skipped 2. Reason categories: message_load_not_found=2."
        ),
        status: "PENDING",
        type: gmailInboxSyncJobType
      });
      expect(reloadedConnection.lastError).toEqual(
        expect.stringContaining(
          "EMAIL_GMAIL_MESSAGES_ALL_FAILED: Gmail listed 2 inbox messages, but none could be loaded. Attempted 2; skipped 2. Reason categories: message_load_not_found=2."
        )
      );
      expect(reloadedConnection.lastError).not.toContain("access-token");
      expect(reloadedConnection.lastError).not.toContain("provider-body-secret-token");
      expect(providerCard).toMatchObject({
        accountEmail: "alex@example.test",
        status: "Sync issue",
        syncAvailable: true,
        syncStatusLabel: "Sync retry scheduled"
      });
      expect(providerCard?.syncStatusDetail).toContain(
        "Gmail listed 2 inbox messages, but none could be loaded. Attempted 2; skipped 2. Reason categories: message_load_not_found=2."
      );
      expect(providerCard?.syncStatusDetail).toContain(`job ${queuedJob.id.slice(-8)}`);
      expect(providerCard?.syncStatusDetail).toContain(`connection ${connection.id.slice(-8)}`);
      expect(providerCard?.syncStatusDetail).toContain("attempts 1");
      expect(providerCard?.syncStatusDetail).toContain("Retry scheduled");
      expect(providerCard?.syncStatusDetail).not.toContain("access-token");
      expect(providerCard?.syncStatusDetail).not.toContain("provider-body-secret-token");
      expect(logs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("treats full-message auth or scope rejection as a reconnect-required Gmail load failure", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const queuedJob = await enqueueGmailInboxSyncJob(fixture.actorA);
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "25",
        failedMessageIds: { "gmail-full-auth-rejected-1": 403 },
        messages: [
          {
            headers: {
              Date: "Fri, 26 Jun 2026 15:45:00 -0400",
              From: "Unknown Sender <unknown-sender@example.test>",
              Subject: "Normal Gmail message needing full scope",
              To: "Alex <alex@example.test>"
            },
            id: "gmail-full-auth-rejected-1",
            labelIds: ["INBOX"],
            snippet: "This should ask for reconnect, not CRM matching."
          }
        ]
      });

      await expect(
        runGmailInboxSyncNow(fixture.actorA, {
          env,
          fetchImpl,
          now: new Date("2030-07-01T12:25:00.000Z"),
          workerId: "test-email-page-sync"
        })
      ).rejects.toMatchObject({
        code: "EMAIL_GMAIL_MESSAGE_AUTH_FAILED",
        message:
          "Google granted Gmail access, but Gmail rejected full-message reads (Google status 403; category insufficient_permissions). Run diagnostics or check Google Cloud OAuth/Gmail API configuration, then retry sync."
      });

      const [job, reloadedConnection, reloadedSecret, providerCard, logs] = await Promise.all([
        fixture.prisma.job.findUniqueOrThrow({ where: { id: queuedJob.id } }),
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.emailConnectionSecret.findUniqueOrThrow({ where: { connectionId: connection.id } }),
        listEmailConnectionProviderCards(fixture.actorA, env).then((cards) =>
          cards.find((provider) => provider.provider === "GOOGLE_WORKSPACE")
        ),
        fixture.prisma.emailLog.findMany({
          where: { provider: "GOOGLE_WORKSPACE", workspaceId: fixture.workspaceA.id }
        })
      ]);
      expect(job).toMatchObject({
        lastError:
          "Google granted Gmail access, but Gmail rejected full-message reads (Google status 403; category insufficient_permissions). Run diagnostics or check Google Cloud OAuth/Gmail API configuration, then retry sync.",
        status: "PENDING",
        type: gmailInboxSyncJobType
      });
      expect(reloadedConnection.lastError).toBe(
        "EMAIL_GMAIL_MESSAGE_AUTH_FAILED: Google granted Gmail access, but Gmail rejected full-message reads (Google status 403; category insufficient_permissions). Run diagnostics or check Google Cloud OAuth/Gmail API configuration, then retry sync."
      );
      expect(reloadedConnection.scopes).toEqual(gmailFullInboxScopes);
      expect(reloadedSecret.scopes).toEqual(gmailFullInboxScopes);
      expect(providerCard).toMatchObject({
        accountEmail: "alex@example.test",
        status: "Sync issue",
        syncAvailable: true
      });
      expect(reloadedConnection.lastError).not.toContain("access-token");
      expect(reloadedConnection.lastError).not.toContain("provider-body-secret-token");
      expect(logs).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("diagnoses the selected Gmail connection with tokeninfo, refresh, list, and full-get categories without leaking secrets", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "expired-diagnostic-access-token",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        refreshToken: "diagnostic-refresh-token"
      });
      const diagnosticJob = await enqueueGmailInboxSyncJob(fixture.actorA);
      await fixture.prisma.emailConnection.update({
        where: { id: connection.id },
        data: {
          lastError: "Previous stale scope warning",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"]
        }
      });
      await fixture.prisma.emailConnectionSecret.update({
        where: { connectionId: connection.id },
        data: { scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"] }
      });
      let refreshCallCount = 0;
      const diagnosticTokenInfoScopes = [...gmailFullInboxScopes, "https://www.googleapis.com/auth/gmail.metadata"];
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        if (url === "https://oauth2.googleapis.com/token") {
          refreshCallCount += 1;
          const body = init?.body as URLSearchParams;
          expect(body.get("refresh_token")).toBe("diagnostic-refresh-token");
          return Response.json({ access_token: "diagnostic-refreshed-access-token", expires_in: 3600 });
        }
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
          const requestUrl = new URL(url);
          expect(requestUrl.searchParams.get("access_token")).toBe("diagnostic-refreshed-access-token");
          return Response.json({
            email: "alex@example.test",
            scope: diagnosticTokenInfoScopes.join(" ")
          });
        }
        expect(authorization).toBe("Bearer diagnostic-refreshed-access-token");
        if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
          return Response.json({ messages: [{ id: "diagnostic-message-1", threadId: "diagnostic-thread-1" }] });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
          return Response.json({ emailAddress: "alex@example.test", messagesTotal: 10, threadsTotal: 4 });
        }
        if (url.includes("/messages/diagnostic-message-1?")) {
          const requestUrl = new URL(url);
          const format = requestUrl.searchParams.get("format");
          if (format === "minimal" || format === "metadata") {
            return Response.json({
              id: "diagnostic-message-1",
              labelIds: ["INBOX"],
              payload: { headers: [] },
              threadId: "diagnostic-thread-1"
            });
          }
          return Response.json(
            {
              error: {
                code: 403,
                errors: [
                  {
                    domain: "global",
                    message: `Insufficient Permission for provider-body-secret-token-${format}`,
                    reason: "insufficientPermissions"
                  }
                ],
                message: `Request had insufficient authentication scopes for provider-body-secret-token-${format}`,
                status: "PERMISSION_DENIED"
              }
            },
            { status: 403 }
          );
        }
        throw new Error(`Unexpected diagnostic fetch URL ${url}`);
      };

      const diagnostic = await diagnoseGmailConnection(fixture.actorA, {
        connectionRef: connection.id.slice(-8),
        env,
        fetchImpl,
        jobRef: diagnosticJob.id.slice(-8),
        maxResults: 1
      });
      const serialized = JSON.stringify(diagnostic);

      expect(diagnostic).toMatchObject({
        accountEmail: "alex@example.test",
        connectionRef: connection.id.slice(-8),
        fullMessageGet: {
          category: "insufficient_permissions",
          messageRef: "message:...essage-1",
          providerReason: "insufficientPermissions",
          providerStatus: 403,
          success: false
        },
        hasEncryptedSecret: true,
        list: {
          category: "success",
          messageCount: 1,
          providerStatus: 200,
          success: true
        },
        job: {
          connectionMatchesSelected: true,
          found: true,
          jobRef: diagnosticJob.id.slice(-8),
          payloadConnectionRef: connection.id.slice(-8),
          payloadWorkspaceMatches: true,
          requestedJobRef: diagnosticJob.id.slice(-8),
          status: "PENDING",
          typeMatches: true
        },
        oauth: {
          includeGrantedScopes: true,
          promptConsent: true,
          redirectUriConfigured: true,
          requestedScopeCategories: ["email", "Gmail read", "Gmail send", "sign-in"],
          responseTypeCode: true,
          usesOfflineAccess: true
        },
        selectedConnectionId: connection.id,
        secretAccountMatchesConnection: true,
        tokenRefresh: {
          category: "success",
          success: true
        },
        tokeninfo: {
          accountEmail: "alex@example.test",
          accountMatchesConnection: true,
          category: "success",
          connectionRef: connection.id.slice(-8),
          gmailReadSatisfiedBy: "https://www.googleapis.com/auth/gmail.readonly",
          gmailSendSatisfiedBy: "https://www.googleapis.com/auth/gmail.send",
          missingRequiredScopeCategories: [],
          scopeUrls: diagnosticTokenInfoScopes,
          success: true
        },
        tokenResolution: {
          category: "success",
          success: true
        }
      });
      expect(diagnostic.storedScopeCategories).toEqual(["email", "Gmail metadata", "sign-in"]);
      expect(diagnostic.tokeninfo.scopeCategories).toEqual(expect.arrayContaining(["email", "Gmail metadata", "Gmail read", "Gmail send", "sign-in"]));
      expect(diagnostic.storedMetadataRepair).toEqual({ repaired: true, staleRelativeToTokeninfo: true });
      expect(diagnostic.tokeninfo.tokenRef).toMatch(/^tok_[a-f0-9]{12}$/);
      expect(diagnostic.list.tokenRef).toBe(diagnostic.tokeninfo.tokenRef);
      expect(diagnostic.fullMessageGet.tokenRef).toBe(diagnostic.tokeninfo.tokenRef);
      expect(diagnostic.permissionProbes).toMatchObject({
        classification: "full_body_permission_rejected",
        gmailMetadataScopeNote:
          "Google tokeninfo includes both gmail.metadata and gmail.readonly. Northstar treats gmail.readonly as the read-body grant and does not count gmail.metadata as read access.",
        messageCount: 1,
        tokenRefsMatch: true,
        profile: {
          category: "success",
          connectionRef: connection.id.slice(-8),
          providerStatus: 200,
          success: true,
          tokenRef: diagnostic.tokeninfo.tokenRef
        }
      });
      expect(diagnostic.permissionProbes.messages[0]?.probes.minimal).toMatchObject({
        category: "success",
        providerStatus: 200,
        success: true,
        tokenRef: diagnostic.tokeninfo.tokenRef
      });
      expect(diagnostic.permissionProbes.messages[0]?.probes.metadata).toMatchObject({
        category: "success",
        providerStatus: 200,
        success: true,
        tokenRef: diagnostic.tokeninfo.tokenRef
      });
      expect(diagnostic.permissionProbes.messages[0]?.probes.full).toMatchObject({
        category: "insufficient_permissions",
        providerError: {
          errors: [
            {
              domain: "global",
              message: "Insufficient Permission for [redacted]",
              reason: "insufficientPermissions"
            }
          ],
          message: "Request had insufficient authentication scopes for [redacted]",
          status: "PERMISSION_DENIED"
        },
        providerReason: "insufficientPermissions",
        providerStatus: 403,
        success: false,
        tokenRef: diagnostic.tokeninfo.tokenRef
      });
      expect(diagnostic.permissionProbes.messages[0]?.probes.raw).toMatchObject({
        category: "insufficient_permissions",
        providerReason: "insufficientPermissions",
        providerStatus: 403,
        success: false,
        tokenRef: diagnostic.tokeninfo.tokenRef
      });
      expect(diagnostic.list.connectionRef).toBe(connection.id.slice(-8));
      expect(diagnostic.fullMessageGet.connectionRef).toBe(connection.id.slice(-8));
      expect(diagnostic.fullMessageGet.endpoint).toEqual({
        fieldsParamPresent: false,
        format: "full",
        messageRef: "message:...essage-1",
        path: "/gmail/v1/users/me/messages/{messageId}",
        userId: "me"
      });
      expect(refreshCallCount).toBe(1);
      const [repairedConnection, repairedSecret] = await Promise.all([
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        fixture.prisma.emailConnectionSecret.findUniqueOrThrow({ where: { connectionId: connection.id } })
      ]);
      expect(repairedConnection.scopes).toEqual(diagnosticTokenInfoScopes);
      expect(repairedSecret.scopes).toEqual(diagnosticTokenInfoScopes);
      expect(repairedConnection.lastError).toContain("EMAIL_GMAIL_FULL_MESSAGE_PERMISSION_REJECTED");
      expect(repairedConnection.lastError).toContain("Google status 403");
      expect(repairedConnection.lastError).toContain("category insufficient_permissions");
      expect(serialized).not.toContain("diagnostic-refresh-token");
      expect(serialized).not.toContain("diagnostic-refreshed-access-token");
      expect(serialized).not.toContain("provider-body-secret-token");
      expect(serialized).not.toContain("diagnostic-message-1\"");
    } finally {
      await fixture.cleanup();
    }
  });

  it("classifies Gmail diagnostics when every message get format is rejected", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "all-message-get-rejected-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
          return Response.json({ email: "alex@example.test", scope: gmailFullInboxScopes.join(" ") });
        }
        expect(authorization).toBe("Bearer all-message-get-rejected-access-token");
        if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
          return Response.json({ messages: [{ id: "all-get-rejected-message", threadId: "all-get-rejected-thread" }] });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
          return Response.json({ emailAddress: "alex@example.test" });
        }
        if (url.includes("/messages/all-get-rejected-message?")) {
          return Response.json(
            {
              error: {
                code: 403,
                errors: [{ domain: "global", message: "Request had insufficient authentication scopes.", reason: "insufficientPermissions" }],
                message: "Request had insufficient authentication scopes.",
                status: "PERMISSION_DENIED"
              }
            },
            { status: 403 }
          );
        }
        throw new Error(`Unexpected all-get diagnostic fetch URL ${url}`);
      };

      const diagnostic = await diagnoseGmailConnection(fixture.actorA, {
        connectionRef: connection.id.slice(-8),
        env,
        fetchImpl,
        maxResults: 1
      });

      expect(diagnostic.permissionProbes).toMatchObject({
        classification: "message_get_permission_rejected",
        messageCount: 1,
        tokenRefsMatch: true
      });
      expect(Object.values(diagnostic.permissionProbes.messages[0]?.probes ?? {})).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "insufficient_permissions",
            providerError: expect.objectContaining({
              message: "Request had insufficient authentication scopes.",
              status: "PERMISSION_DENIED"
            }),
            providerReason: "insufficientPermissions",
            providerStatus: 403,
            success: false,
            tokenRef: diagnostic.tokeninfo.tokenRef
          })
        ])
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("probes up to two Gmail messages to identify a message-specific rejection", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "message-specific-diagnostic-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
          return Response.json({ email: "alex@example.test", scope: gmailFullInboxScopes.join(" ") });
        }
        expect(authorization).toBe("Bearer message-specific-diagnostic-access-token");
        if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
          return Response.json({
            messages: [
              { id: "probe-message-readable01", threadId: "probe-readable-thread" },
              { id: "probe-message-restricted02", threadId: "probe-restricted-thread" },
              { id: "probe-message-third03", threadId: "probe-third-thread" }
            ]
          });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
          return Response.json({ emailAddress: "alex@example.test" });
        }
        if (url.includes("/messages/probe-message-readable01?")) {
          return Response.json({ id: "probe-message-readable01", threadId: "probe-readable-thread" });
        }
        if (url.includes("/messages/probe-message-restricted02?")) {
          const format = new URL(url).searchParams.get("format");
          if (format === "minimal" || format === "metadata") {
            return Response.json({ id: "probe-message-restricted02", threadId: "probe-restricted-thread" });
          }
          return Response.json(
            {
              error: {
                code: 404,
                errors: [{ domain: "global", message: "Requested entity was not found.", reason: "notFound" }],
                message: "Requested entity was not found.",
                status: "NOT_FOUND"
              }
            },
            { status: 404 }
          );
        }
        throw new Error(`Unexpected message-specific diagnostic fetch URL ${url}`);
      };

      const diagnostic = await diagnoseGmailConnection(fixture.actorA, {
        connectionRef: connection.id.slice(-8),
        env,
        fetchImpl
      });

      expect(diagnostic.permissionProbes).toMatchObject({
        classification: "message_specific_rejection",
        messageCount: 2,
        tokenRefsMatch: true
      });
      expect(diagnostic.permissionProbes.messages.map((message) => message.messageRef)).toEqual([
        "message:...adable01",
        "message:...ricted02"
      ]);
      expect(JSON.stringify(diagnostic)).not.toContain("probe-message-third03");
    } finally {
      await fixture.cleanup();
    }
  });

  it("classifies Gmail API or token rejection when the profile probe fails", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "profile-rejected-diagnostic-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
          return Response.json({ email: "alex@example.test", scope: gmailFullInboxScopes.join(" ") });
        }
        expect(authorization).toBe("Bearer profile-rejected-diagnostic-access-token");
        if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
          return Response.json({ messages: [{ id: "profile-rejected-message", threadId: "profile-rejected-thread" }] });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
          return Response.json(
            {
              error: {
                code: 401,
                errors: [{ domain: "global", message: "Invalid Credentials", reason: "authError" }],
                message: "Invalid Credentials",
                status: "UNAUTHENTICATED"
              }
            },
            { status: 401 }
          );
        }
        if (url.includes("/messages/profile-rejected-message?")) {
          return Response.json({ id: "profile-rejected-message", threadId: "profile-rejected-thread" });
        }
        throw new Error(`Unexpected profile-rejected diagnostic fetch URL ${url}`);
      };

      const diagnostic = await diagnoseGmailConnection(fixture.actorA, {
        connectionRef: connection.id.slice(-8),
        env,
        fetchImpl,
        maxResults: 1
      });

      expect(diagnostic.permissionProbes).toMatchObject({
        classification: "gmail_api_or_token_rejected",
        messageCount: 1,
        profile: {
          category: "invalid_token",
          providerError: {
            errors: [{ domain: "global", message: "Invalid Credentials", reason: "authError" }],
            message: "Invalid Credentials",
            status: "UNAUTHENTICATED"
          },
          providerReason: "authError",
          providerStatus: 401,
          success: false
        },
        tokenRefsMatch: true
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("diagnoses when the supplied Gmail sync job does not match the selected connection", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const selectedConnection = await createConnectedGmailSecret(fixture, {
        accountEmail: "selected-job-diagnostic@example.test",
        accessToken: "selected-job-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const otherConnection = await createConnectedGmailSecret(fixture, {
        accountEmail: "other-job-diagnostic@example.test",
        accessToken: "other-job-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await fixture.prisma.emailConnection.update({
        where: { id: selectedConnection.id },
        data: { updatedAt: new Date("2030-07-01T12:45:00.000Z") }
      });
      await fixture.prisma.emailConnection.update({
        where: { id: otherConnection.id },
        data: { updatedAt: new Date("2030-07-01T12:44:00.000Z") }
      });
      const mismatchedJob = await fixture.prisma.job.create({
        data: {
          dedupeKey: `gmail-inbox-sync:${otherConnection.id}`,
          payload: {
            connectionId: otherConnection.id,
            workspaceId: fixture.workspaceA.id
          },
          status: JobStatus.PENDING,
          type: gmailInboxSyncJobType,
          workspaceId: fixture.workspaceA.id
        }
      });
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
          return Response.json({
            email: "selected-job-diagnostic@example.test",
            scope: gmailFullInboxScopes.join(" ")
          });
        }
        expect(authorization).toBe("Bearer selected-job-access-token");
        if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
          return Response.json({ messages: [] });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
          return Response.json({ emailAddress: "selected-job-diagnostic@example.test" });
        }
        throw new Error(`Unexpected mismatched job diagnostic fetch URL ${url}`);
      };

      const diagnostic = await diagnoseGmailConnection(fixture.actorA, {
        connectionRef: selectedConnection.id.slice(-8),
        env,
        fetchImpl,
        jobRef: mismatchedJob.id.slice(-8),
        maxResults: 1
      });

      expect(diagnostic.job).toMatchObject({
        connectionMatchesSelected: false,
        found: true,
        jobRef: mismatchedJob.id.slice(-8),
        payloadConnectionRef: otherConnection.id.slice(-8),
        payloadWorkspaceMatches: true,
        requestedJobRef: mismatchedJob.id.slice(-8),
        status: "PENDING",
        typeMatches: true
      });
      expect(diagnostic.selectedConnectionId).toBe(selectedConnection.id);
      expect(diagnostic.permissionProbes).toMatchObject({
        classification: "no_probe_message_available",
        messageCount: 0,
        tokenRefsMatch: true
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("diagnoses expired-token refresh failures with safe provider categories", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "expired-refresh-diagnostic-access-token",
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        refreshToken: "diagnostic-invalid-refresh-token"
      });
      let refreshCallCount = 0;
      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://oauth2.googleapis.com/token");
        refreshCallCount += 1;
        const body = init?.body as URLSearchParams;
        expect(body.get("refresh_token")).toBe("diagnostic-invalid-refresh-token");
        return Response.json(
          {
            error: "invalid_grant",
            error_description: "refresh-token-secret-description"
          },
          { status: 400 }
        );
      };

      const diagnostic = await diagnoseGmailConnection(fixture.actorA, {
        connectionRef: connection.id.slice(-8),
        env,
        fetchImpl
      });
      const serialized = JSON.stringify(diagnostic);

      expect(diagnostic).toMatchObject({
        connectionRef: connection.id.slice(-8),
        fullMessageGet: {
          category: "not_attempted",
          success: false
        },
        list: {
          category: "not_attempted",
          success: false
        },
        selectedConnectionId: connection.id,
        tokenRefresh: {
          category: "invalid_token",
          providerReason: "invalid_grant",
          providerStatus: 400,
          success: false
        },
        tokenResolution: {
          category: "invalid_token",
          providerReason: "invalid_grant",
          providerStatus: 400,
          success: false
        },
        tokeninfo: {
          category: "not_attempted",
          success: false
        }
      });
      expect(refreshCallCount).toBe(1);
      expect(serialized).not.toContain("diagnostic-invalid-refresh-token");
      expect(serialized).not.toContain("expired-refresh-diagnostic-access-token");
      expect(serialized).not.toContain("refresh-token-secret-description");
    } finally {
      await fixture.cleanup();
    }
  });

  it("diagnoses the requested Gmail connection instead of a newer stale row", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const selectedConnection = await createConnectedGmailSecret(fixture, {
        accountEmail: "selected-diagnostic@example.test",
        accessToken: "selected-diagnostic-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        refreshToken: "selected-diagnostic-refresh-token"
      });
      const newerConnection = await createConnectedGmailSecret(fixture, {
        accountEmail: "newer-stale-diagnostic@example.test",
        accessToken: "newer-stale-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        refreshToken: "newer-stale-refresh-token"
      });
      await fixture.prisma.emailConnection.update({
        where: { id: newerConnection.id },
        data: {
          scopes: ["openid", "email"],
          updatedAt: new Date("2030-07-01T12:40:00.000Z")
        }
      });
      await fixture.prisma.emailConnectionSecret.update({
        where: { connectionId: newerConnection.id },
        data: { scopes: ["openid", "email"] }
      });

      const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const authorization = new Headers(init?.headers).get("authorization");
        if (url === "https://oauth2.googleapis.com/token") {
          const body = init?.body as URLSearchParams;
          expect(body.get("refresh_token")).toBe("selected-diagnostic-refresh-token");
          return Response.json({ access_token: "selected-refreshed-access-token", expires_in: 3600 });
        }
        if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
          const requestUrl = new URL(url);
          expect(requestUrl.searchParams.get("access_token")).toBe("selected-diagnostic-access-token");
          return Response.json({
            email: "selected-diagnostic@example.test",
            scope: gmailFullInboxScopes.join(" ")
          });
        }
        expect(authorization).toBe("Bearer selected-diagnostic-access-token");
        if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
          return Response.json({ messages: [{ id: "selected-diagnostic-message", threadId: "selected-diagnostic-thread" }] });
        }
        if (url === "https://gmail.googleapis.com/gmail/v1/users/me/profile") {
          return Response.json({ emailAddress: "selected-diagnostic@example.test" });
        }
        if (url.includes("/messages/selected-diagnostic-message?")) {
          return Response.json({
            id: "selected-diagnostic-message",
            labelIds: ["INBOX"],
            payload: { headers: [] },
            threadId: "selected-diagnostic-thread"
          });
        }
        throw new Error(`Unexpected selected diagnostic fetch URL ${url}`);
      };

      const diagnostic = await diagnoseGmailConnection(fixture.actorA, {
        connectionRef: selectedConnection.id.slice(-8),
        env,
        fetchImpl,
        maxResults: 1
      });

      expect(diagnostic).toMatchObject({
        accountEmail: "selected-diagnostic@example.test",
        fullMessageGet: {
          category: "success",
          messageRef: "message:...-message",
          providerStatus: 200,
          success: true
        },
        list: {
          category: "success",
          messageCount: 1,
          success: true
        },
        selectedConnectionId: selectedConnection.id,
        tokenRefresh: {
          category: "not_attempted",
          success: null
        },
        tokeninfo: {
          accountEmail: "selected-diagnostic@example.test",
          accountMatchesConnection: true,
          category: "success",
          success: true
        }
      });
      expect(diagnostic.selectedConnectionId).not.toBe(newerConnection.id);
      expect(diagnostic.permissionProbes).toMatchObject({
        classification: "success",
        messageCount: 1,
        tokenRefsMatch: true
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("skips malformed Gmail full-message JSON and continues syncing readable messages", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        nonJsonMessageIds: ["gmail-malformed-json-1"],
        messages: [
          {
            bodyText: "Readable neighbor body.",
            headers: {
              Date: "Fri, 26 Jun 2026 15:50:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Readable neighbor",
              To: "Alex <alex@example.test>"
            },
            historyId: "1301",
            id: "gmail-readable-neighbor-1",
            labelIds: ["INBOX"],
            snippet: "Readable neighbor"
          },
          {
            headers: {
              Date: "Fri, 26 Jun 2026 15:51:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Malformed provider payload",
              To: "Alex <alex@example.test>"
            },
            historyId: "1302",
            id: "gmail-malformed-json-1",
            labelIds: ["INBOX"],
            snippet: "Malformed provider payload"
          }
        ]
      });

      const result = await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl });

      expect(result).toMatchObject({
        created: 1,
        skippedMessageFailures: 1,
        syncWarning: "Gmail sync completed with warnings: 1 Gmail message could not be loaded and was skipped.",
        totalFetched: 2
      });
      const [log, reloadedConnection] = await Promise.all([
        fixture.prisma.emailLog.findFirstOrThrow({
          where: { providerMessageId: "gmail-readable-neighbor-1", workspaceId: fixture.workspaceA.id }
        }),
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })
      ]);
      expect(log.subject).toBe("Readable neighbor");
      expect(reloadedConnection.lastError).toBe(result.syncWarning);
      expect(reloadedConnection.lastError).not.toContain("provider-body-secret-token");
    } finally {
      await fixture.cleanup();
    }
  });

  it("does not let an existing stale pending Gmail job trap explicit sync clicks forever", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const queuedJob = await enqueueGmailInboxSyncJob(fixture.actorA);
      await fixture.prisma.job.update({
        where: { id: queuedJob.id },
        data: {
          createdAt: new Date("2030-07-01T11:00:00.000Z"),
          runAt: new Date("2030-07-01T11:00:00.000Z"),
          updatedAt: new Date("2030-07-01T11:00:00.000Z")
        }
      });
      const duplicate = await enqueueGmailInboxSyncJob(fixture.actorA);
      expect(duplicate.id).toBe(queuedJob.id);

      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "25",
        messages: [
          {
            bodyText: "Stale pending sync body.",
            headers: {
              Date: "Fri, 26 Jun 2026 15:45:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Stale pending sync",
              To: "Alex <alex@example.test>"
            },
            historyId: "1111",
            id: "gmail-stale-pending-sync-1",
            snippet: "Stale pending sync body"
          }
        ]
      });

      const result = await runGmailInboxSyncNow(fixture.actorA, {
        env,
        fetchImpl,
        now: new Date("2030-07-01T12:05:00.000Z"),
        workerId: "test-email-page-sync"
      });

      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, syncMode: "recent", totalFetched: 1 });
      await expect(fixture.prisma.job.findUniqueOrThrow({ where: { id: queuedJob.id } })).resolves.toMatchObject({
        attempts: 1,
        lockedAt: null,
        lockedBy: null,
        status: JobStatus.SUCCEEDED
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("recovers a stale running Gmail job for an explicit user retry without concurrent duplicate syncs", async () => {
    const fixture = await createIntegrationFixture();
    try {
      await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const queuedJob = await enqueueGmailInboxSyncJob(fixture.actorA);
      await fixture.prisma.job.update({
        where: { id: queuedJob.id },
        data: {
          attempts: 1,
          lockedAt: new Date("2030-07-01T11:00:00.000Z"),
          lockedBy: "dead-worker",
          status: JobStatus.RUNNING,
          updatedAt: new Date("2030-07-01T11:00:00.000Z")
        }
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        expectedMaxResults: "25",
        messages: [
          {
            bodyText: "Recovered running sync body.",
            headers: {
              Date: "Fri, 26 Jun 2026 15:50:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Recovered running sync",
              To: "Alex <alex@example.test>"
            },
            historyId: "1121",
            id: "gmail-stale-running-sync-1",
            snippet: "Recovered running sync body"
          }
        ]
      });

      const result = await runGmailInboxSyncNow(fixture.actorA, {
        env,
        fetchImpl,
        now: new Date("2030-07-01T11:20:01.000Z"),
        workerId: "test-email-page-sync"
      });

      expect(result).toMatchObject({ created: 1, skippedDuplicates: 0, syncMode: "recent", totalFetched: 1 });
      await expect(fixture.prisma.job.findUniqueOrThrow({ where: { id: queuedJob.id } })).resolves.toMatchObject({
        attempts: 2,
        lockedAt: null,
        lockedBy: null,
        status: JobStatus.SUCCEEDED
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("shows Gmail sync job status only for the selected connected Gmail row", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const olderConnection = await createConnectedGmailSecret(fixture, {
        accountEmail: "older@example.test",
        accessToken: "older-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const selectedConnection = await createConnectedGmailSecret(fixture, {
        accountEmail: "selected@example.test",
        accessToken: "selected-access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      await fixture.prisma.emailConnection.update({
        where: { id: selectedConnection.id },
        data: { updatedAt: new Date("2030-07-01T12:10:00.000Z") }
      });
      await fixture.prisma.job.create({
        data: {
          dedupeKey: `gmail-inbox-sync:${olderConnection.id}`,
          payload: {
            connectionId: olderConnection.id,
            workspaceId: fixture.workspaceA.id
          },
          status: JobStatus.PENDING,
          type: gmailInboxSyncJobType,
          workspaceId: fixture.workspaceA.id
        }
      });

      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );

      expect(providerCard).toMatchObject({
        accountEmail: "selected@example.test",
        syncAvailable: true,
        syncStatusDetail: null,
        syncStatusLabel: null
      });
      expect(providerCard?.syncJobRef).toBeNull();
      expect(selectedConnection.id).not.toBe(olderConnection.id);
    } finally {
      await fixture.cleanup();
    }
  });

  it("uses Gmail history cursors for incremental inbox sync and falls back to recent sync when history expires", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const initialFetch = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyText: "Initial full inbox body.",
            headers: {
              Date: "Fri, 26 Jun 2026 16:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Initial full inbox",
              To: "Alex <alex@example.test>"
            },
            historyId: "2001",
            id: "gmail-incremental-initial-1",
            snippet: "Initial full inbox body"
          }
        ]
      });

      const initial = await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl: initialFetch });
      expect(initial).toMatchObject({ created: 1, skippedDuplicates: 0, syncMode: "recent", totalFetched: 1 });
      await expect(fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({
        lastSyncCursor: "historyId:2001"
      });

      const historyFetch = gmailFetchMock({
        accessToken: "access-token",
        expectedHistoryStartId: "2001",
        historyId: "2005",
        historyMessages: [{ id: "gmail-incremental-history-1", threadId: "thread-gmail-incremental-history-1" }],
        messages: [
          {
            bodyText: "Incremental history body.",
            headers: {
              Date: "Fri, 26 Jun 2026 16:10:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Incremental history",
              To: "Alex <alex@example.test>"
            },
            historyId: "2005",
            id: "gmail-incremental-history-1",
            snippet: "Incremental history body"
          }
        ]
      });

      const incremental = await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl: historyFetch });
      expect(incremental).toMatchObject({ created: 1, skippedDuplicates: 0, syncMode: "history", totalFetched: 1 });
      await expect(fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({
        lastSyncCursor: "historyId:2005"
      });

      const fallbackFetch = gmailFetchMock({
        accessToken: "access-token",
        expectedHistoryStartId: "2005",
        historyStatus: 404,
        messages: [
          {
            bodyText: "History fallback body.",
            headers: {
              Date: "Fri, 26 Jun 2026 16:20:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "History fallback",
              To: "Alex <alex@example.test>"
            },
            historyId: "2010",
            id: "gmail-history-fallback-1",
            snippet: "History fallback body"
          }
        ]
      });

      const fallback = await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl: fallbackFetch });
      expect(fallback).toMatchObject({ created: 1, skippedDuplicates: 0, syncMode: "recent", totalFetched: 1 });
      await expect(fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } })).resolves.toMatchObject({
        lastSyncCursor: "historyId:2010"
      });

      await expect(
        fixture.prisma.emailLog.findMany({
          where: { provider: "GOOGLE_WORKSPACE", workspaceId: fixture.workspaceA.id }
        })
      ).resolves.toHaveLength(3);
    } finally {
      await fixture.cleanup();
    }
  });

  it("sends an explicit Gmail reply and logs the sent message on the provider thread", async () => {
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
            bodyText: "Can you send next steps?",
            headers: {
              Date: "Fri, 26 Jun 2026 14:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Next steps",
              To: "Alex <alex@example.test>"
            },
            id: "gmail-reply-source-1",
            snippet: "Can you send next steps?"
          }
        ],
        sentMessageId: "gmail-sent-explicit-reply-1"
      });
      await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl });
      const sourceEmail = await fixture.prisma.emailLog.findFirstOrThrow({
        where: { providerMessageId: "gmail-reply-source-1", workspaceId: fixture.workspaceA.id }
      });

      const result = await sendGmailReplyFromEmailLog({
        actor: fixture.actorA,
        body: "Thanks, I will send next steps today.",
        emailLogId: sourceEmail.id,
        env,
        fetchImpl
      });

      expect(result).toMatchObject({
        providerMessageId: "gmail-sent-explicit-reply-1",
        providerThreadId: "thread-gmail-reply-source-1"
      });
      const sentLog = await fixture.prisma.emailLog.findFirstOrThrow({
        where: { providerMessageId: "gmail-sent-explicit-reply-1", workspaceId: fixture.workspaceA.id }
      });
      expect(sentLog).toMatchObject({
        body: "Thanks, I will send next steps today.",
        direction: "OUTBOUND",
        personId: fixture.recordsA.person.id,
        providerLabels: ["SENT"],
        subject: "Re: Next steps",
        toText: "alpha@example.test"
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("refreshes a selected Gmail thread without changing the global sync cursor or losing sent replies", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      });
      const fetchImpl = gmailFetchMock({
        accessToken: "access-token",
        messages: [
          {
            bodyText: "Can you send next steps?",
            headers: {
              Date: "Fri, 26 Jun 2026 14:00:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Next steps",
              To: "Alex <alex@example.test>"
            },
            historyId: "4001",
            id: "gmail-thread-refresh-source-1",
            snippet: "Can you send next steps?",
            threadId: "thread-shared-refresh-1"
          },
          {
            bodyText: "Thanks, I will send next steps today.",
            headers: {
              Date: "Fri, 26 Jun 2026 14:05:00 -0400",
              From: "Alex <alex@example.test>",
              Subject: "Re: Next steps",
              To: "alpha@example.test"
            },
            historyId: "4002",
            id: "gmail-thread-refresh-sent-1",
            labelIds: ["SENT"],
            snippet: "Thanks, I will send next steps today.",
            threadId: "thread-shared-refresh-1"
          },
          {
            bodyText: "Following up with a new answer.",
            headers: {
              Date: "Fri, 26 Jun 2026 14:15:00 -0400",
              From: "Alpha Contact <alpha@example.test>",
              Subject: "Re: Next steps",
              To: "Alex <alex@example.test>"
            },
            historyId: "4003",
            id: "gmail-thread-refresh-new-1",
            snippet: "Following up with a new answer.",
            threadId: "thread-shared-refresh-1"
          }
        ],
        listedMessageIds: ["gmail-thread-refresh-source-1"],
        sentMessageId: "gmail-thread-refresh-sent-1",
        threadMessagesById: {
          "thread-shared-refresh-1": ["gmail-thread-refresh-source-1", "gmail-thread-refresh-sent-1", "gmail-thread-refresh-new-1"]
        }
      });
      await syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl });
      const sourceEmail = await fixture.prisma.emailLog.findFirstOrThrow({
        where: { providerMessageId: "gmail-thread-refresh-source-1", workspaceId: fixture.workspaceA.id }
      });
      await sendGmailReplyFromEmailLog({
        actor: fixture.actorA,
        body: "Thanks, I will send next steps today.",
        emailLogId: sourceEmail.id,
        env,
        fetchImpl
      });
      const cursorBeforeThreadRefresh = (await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }))
        .lastSyncCursor;
      expect(cursorBeforeThreadRefresh).toBe("historyId:4001");

      const result = await refreshGmailInboxThread({
        actor: fixture.actorA,
        env,
        fetchImpl,
        threadId: "GOOGLE_WORKSPACE:thread-shared-refresh-1"
      });
      expect(result).toMatchObject({ created: 1, skippedDuplicates: 2, syncMode: "thread", totalFetched: 3 });

      const [logs, reloadedConnection, threads] = await Promise.all([
        fixture.prisma.emailLog.findMany({
          where: { providerThreadId: "thread-shared-refresh-1", workspaceId: fixture.workspaceA.id },
          orderBy: { occurredAt: "asc" }
        }),
        fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } }),
        listEmailInboxThreads(fixture.actorA)
      ]);
      expect(logs.map((log) => log.providerMessageId)).toEqual(
        expect.arrayContaining([
          "gmail-thread-refresh-source-1",
          "gmail-thread-refresh-sent-1",
          "gmail-thread-refresh-new-1"
        ])
      );
      expect(logs).toHaveLength(3);
      expect(logs.find((log) => log.providerMessageId === "gmail-thread-refresh-sent-1")).toMatchObject({
        body: "Thanks, I will send next steps today.",
        direction: "OUTBOUND",
        providerLabels: ["SENT"]
      });
      expect(reloadedConnection.lastSyncCursor).toBe(cursorBeforeThreadRefresh);
      expect(threads.find((thread) => thread.id === "GOOGLE_WORKSPACE:thread-shared-refresh-1")).toMatchObject({
        messageCount: 3
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("disconnects Gmail by removing encrypted tokens and allows reconnecting the same account", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const connection = await createConnectedGmailSecret(fixture, {
        accessToken: "access-token-before-disconnect",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        refreshToken: "refresh-token-before-disconnect"
      });

      const result = await disconnectEmailConnection(fixture.actorA, "GOOGLE_WORKSPACE");
      expect(result).toEqual({
        accountEmail: "alex@example.test",
        provider: "GOOGLE_WORKSPACE"
      });

      const disconnected = await fixture.prisma.emailConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(disconnected).toMatchObject({
        lastError: null,
        status: "DISCONNECTED"
      });
      expect(disconnected.deletedAt).toBeInstanceOf(Date);
      await expect(
        fixture.prisma.emailConnectionSecret.findUnique({ where: { connectionId: connection.id } })
      ).resolves.toBeNull();

      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(providerCard).toMatchObject({
        accountEmail: undefined,
        disconnectAvailable: false,
        status: "Ready to connect",
        syncAvailable: false
      });

      const fetchImpl = (async () => {
        throw new Error("Gmail should not be called after disconnect.");
      }) as typeof fetch;
      await expect(syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_CONNECTION_NOT_FOUND"
      });

      const reconnected = await storeGoogleOAuthConnection({
        actor: fixture.actorA,
        env,
        profile: {
          email: "alex@example.test",
          name: "Alex Gmail"
        },
        tokenResponse: {
          access_token: "access-token-after-reconnect",
          refresh_token: "refresh-token-after-reconnect",
          scope: gmailFullInboxScopes.join(" ")
        }
      });
      expect(reconnected.id).toBe(connection.id);
      expect(reconnected.deletedAt).toBeNull();
      expect(reconnected.status).toBe("CONNECTED");
      const secret = await fixture.prisma.emailConnectionSecret.findUniqueOrThrow({
        where: { connectionId: connection.id }
      });
      expect(decryptEmailToken(secret.encryptedAccessToken, env)).toBe("access-token-after-reconnect");
      expect(decryptEmailToken(secret.encryptedRefreshToken as string, env)).toBe("refresh-token-after-reconnect");
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires expanded Gmail scopes for Full Inbox sync and preserves workspace scoping for replies", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const legacyConnection = await fixture.prisma.emailConnection.create({
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
          connectionId: legacyConnection.id,
          encryptedAccessToken: encryptEmailToken("legacy-access-token", env),
          encryptedRefreshToken: null,
          provider: "GOOGLE_WORKSPACE",
          scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"],
          userId: fixture.userA.id,
          workspaceId: fixture.workspaceA.id
        }
      });
      const fetchImpl = (async () => {
        throw new Error("Full Inbox should not call Gmail when scopes are insufficient.");
      }) as typeof fetch;

      await expect(syncGmailInboxMessages({ actor: fixture.actorA, env, fetchImpl })).rejects.toMatchObject({
        code: "EMAIL_PROVIDER_SCOPES_INSUFFICIENT"
      });
      const providerCard = (await listEmailConnectionProviderCards(fixture.actorA, env)).find(
        (provider) => provider.provider === "GOOGLE_WORKSPACE"
      );
      expect(providerCard).toMatchObject({
        status: "Reconnect required",
        syncAvailable: false
      });
      await expect(enqueueGmailInboxSyncJob(fixture.actorA)).rejects.toMatchObject({
        code: "EMAIL_PROVIDER_SCOPES_INSUFFICIENT"
      });
      await expect(
        fixture.prisma.job.findMany({
          where: { type: gmailInboxSyncJobType, workspaceId: fixture.workspaceA.id }
        })
      ).resolves.toHaveLength(0);

      const otherWorkspaceEmail = await fixture.prisma.emailLog.create({
        data: {
          body: "Other workspace email",
          direction: "INBOUND",
          fromText: "Other <other@example.test>",
          occurredAt: new Date("2026-06-26T15:00:00.000Z"),
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: "gmail-other-workspace-1",
          providerThreadId: "thread-other-workspace",
          subject: "Other workspace",
          toText: "Alex <alex@example.test>",
          workspaceId: fixture.workspaceB.id,
          createdById: fixture.userB.id
        }
      });
      await expect(
        sendGmailReplyFromEmailLog({
          actor: fixture.actorA,
          body: "Should not send",
          emailLogId: otherWorkspaceEmail.id,
          env,
          fetchImpl
        })
      ).rejects.toMatchObject({
        code: "EMAIL_LOG_NOT_FOUND"
      });
    } finally {
      await fixture.cleanup();
    }
  });
});

async function createConnectedGmailSecret(
  fixture: Awaited<ReturnType<typeof createIntegrationFixture>>,
  options: {
    accountEmail?: string;
    accessToken: string;
    expiresAt: Date;
    refreshToken?: string;
  }
) {
  const accountEmail = options.accountEmail ?? "alex@example.test";
  const connection = await fixture.prisma.emailConnection.create({
    data: {
      accountEmail,
      createdById: fixture.userA.id,
      provider: "GOOGLE_WORKSPACE",
      scopes: gmailFullInboxScopes,
      status: "CONNECTED",
      workspaceId: fixture.workspaceA.id
    }
  });
  await fixture.prisma.emailConnectionSecret.create({
    data: {
      accessTokenExpiresAt: options.expiresAt,
      accountEmail,
      connectionId: connection.id,
      encryptedAccessToken: encryptEmailToken(options.accessToken, env),
      encryptedRefreshToken: options.refreshToken ? encryptEmailToken(options.refreshToken, env) : null,
      provider: "GOOGLE_WORKSPACE",
      scopes: gmailFullInboxScopes,
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
  expectedGmailQuery,
  expectedMaxResults = "10",
  failedMessageIds,
  expectedHistoryStartId,
  historyId,
  historyMessages,
  historyStatus,
  listedMessageIds,
  messages,
  nonJsonMessageIds,
  refreshedAccessToken,
  refreshToken,
  sentMessageId,
  threadMessagesById
}: {
  accessToken: string;
  expectedGmailQuery?: string;
  expectedMaxResults?: string;
  failedMessageIds?: Record<string, number>;
  expectedHistoryStartId?: string;
  historyId?: string;
  historyMessages?: { id: string; threadId?: string }[];
  historyStatus?: number;
  listedMessageIds?: string[];
  messages: {
    bodyText?: string;
    headers: Record<string, string>;
    historyId?: string;
    id: string;
    labelIds?: string[];
    snippet: string;
    threadId?: string;
  }[];
  nonJsonMessageIds?: string[];
  refreshedAccessToken?: string;
  refreshToken?: string;
  sentMessageId?: string;
  threadMessagesById?: Record<string, string[]>;
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

    if (url === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
      expect(init?.method).toBe("POST");
      const body = JSON.parse(String(init?.body));
      expect(body.raw).toEqual(expect.any(String));
      expect(body.raw).not.toContain(accessToken);
      return Response.json({ id: sentMessageId ?? "gmail-sent-reply-1", threadId: body.threadId ?? "sent-thread-1" });
    }

    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/messages?")) {
      const requestUrl = new URL(url);
      expect(requestUrl.searchParams.get("maxResults")).toBe(expectedMaxResults);
      if (expectedGmailQuery) {
        expect(requestUrl.searchParams.get("q")).toBe(expectedGmailQuery);
      } else {
        expect(requestUrl.searchParams.has("q")).toBe(false);
      }
      return Response.json({
        messages: (listedMessageIds ? messages.filter((message) => listedMessageIds.includes(message.id)) : messages).map((message) => ({
          id: message.id,
          threadId: message.threadId ?? `thread-${message.id}`
        }))
      });
    }

    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/history?")) {
      const requestUrl = new URL(url);
      if (expectedHistoryStartId) {
        expect(requestUrl.searchParams.get("startHistoryId")).toBe(expectedHistoryStartId);
      }
      expect(requestUrl.searchParams.get("historyTypes")).toBe("messageAdded");
      expect(requestUrl.searchParams.get("labelId")).toBe("INBOX");
      if (historyStatus) return Response.json({ error: "history expired" }, { status: historyStatus });
      return Response.json({
        history: [
          {
            messagesAdded: (historyMessages ?? messages).map((message) => ({
              message: { id: message.id, threadId: message.threadId ?? `thread-${message.id}` }
            }))
          }
        ],
        historyId
      });
    }

    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/threads/")) {
      const threadId = decodeURIComponent(url.split("/threads/")[1]?.split("?")[0] ?? "");
      const threadMessageIds = threadMessagesById?.[threadId] ?? [];
      const threadMessages = threadMessageIds
        .map((id) => messages.find((message) => message.id === id))
        .filter((message): message is (typeof messages)[number] => Boolean(message));
      return Response.json({
        id: threadId,
        messages: threadMessages.map((message) => ({
          id: message.id,
          historyId: message.historyId,
          internalDate: String(Date.parse(message.headers.Date)),
          labelIds: message.labelIds ?? ["INBOX"],
          payload: {
            ...(message.bodyText
              ? {
                  parts: [
                    {
                      body: { data: gmailTestBodyData(message.bodyText) },
                      mimeType: "text/plain"
                    }
                  ]
                }
              : {}),
            headers: Object.entries(message.headers).map(([name, value]) => ({ name, value }))
          },
          snippet: message.snippet,
          threadId
        }))
      });
    }

    const message = messages.find((item) => url.includes(`/messages/${item.id}?`));
    if (!message) return new Response(null, { status: 404 });
    const failedMessageStatus = failedMessageIds?.[message.id];
    if (failedMessageStatus) {
      return Response.json({ error: "provider-body-secret-token" }, { status: failedMessageStatus });
    }
    if (nonJsonMessageIds?.includes(message.id)) {
      return new Response("<html>provider-body-secret-token</html>", {
        headers: { "content-type": "text/html" },
        status: 200
      });
    }

    return Response.json({
      id: message.id,
      historyId: message.historyId,
      internalDate: String(Date.parse(message.headers.Date)),
      labelIds: message.labelIds ?? ["INBOX"],
      payload: {
        ...(message.bodyText
          ? {
              parts: [
                {
                  body: { data: gmailTestBodyData(message.bodyText) },
                  mimeType: "text/plain"
                }
              ]
            }
          : {}),
        headers: Object.entries(message.headers).map(([name, value]) => ({ name, value }))
      },
      snippet: message.snippet,
      threadId: message.threadId ?? `thread-${message.id}`
    });
  }) as typeof fetch;
}

function gmailTestBodyData(value: string) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
