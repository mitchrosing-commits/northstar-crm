import { describe, expect, it } from "vitest";

import { decryptEmailToken, encryptEmailToken } from "@/lib/email/token-encryption";
import {
  buildMicrosoftAuthorizationUrl,
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
  });

  it("stores Microsoft OAuth tokens encrypted", async () => {
    const fixture = await createIntegrationFixture();
    try {
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
          expires_in: 3600,
          refresh_token: "microsoft-refresh-token",
          scope: microsoftOAuthScopes.join(" ")
        }
      });

      const secret = await fixture.prisma.emailConnectionSecret.findUniqueOrThrow({
        where: { connectionId: connection.id }
      });
      expect(secret.provider).toBe("MICROSOFT_365");
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

function microsoftFetchMock({
  accessToken,
  messages,
  refreshedAccessToken,
  refreshToken
}: {
  accessToken: string;
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
      expect(requestUrl.searchParams.get("$top")).toBe("10");
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
