import { describe, expect, it } from "vitest";

import { decryptEmailToken, encryptEmailToken } from "@/lib/email/token-encryption";
import { syncRecentGmailMessages } from "@/lib/services/email-connection-service";
import { createIntegrationFixture } from "./fixtures";

const env = {
  EMAIL_TOKEN_ENCRYPTION_KEY: "gmail-sync-test-key-32-bytes-min",
  GOOGLE_OAUTH_CLIENT_ID: "google-client",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
  GOOGLE_OAUTH_REDIRECT_URI: "https://crm.example.test/api/email-connections/google/callback"
};

describe("Gmail metadata sync", () => {
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

function gmailFetchMock({
  accessToken,
  messages,
  refreshedAccessToken,
  refreshToken
}: {
  accessToken: string;
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
      expect(requestUrl.searchParams.get("maxResults")).toBe("10");
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
