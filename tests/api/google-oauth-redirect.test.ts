import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildAppUrl } from "@/lib/public-url";
import {
  buildGoogleAuthorizationUrl,
  buildMicrosoftAuthorizationUrl,
  resolveGoogleOAuthConfig,
  resolveMicrosoftOAuthConfig
} from "@/lib/services/email-connection-service";

const googleCallbackRoute = readFileSync(
  join(process.cwd(), "app/api/email-connections/google/callback/route.ts"),
  "utf8"
);
const microsoftCallbackRoute = readFileSync(
  join(process.cwd(), "app/api/email-connections/microsoft/callback/route.ts"),
  "utf8"
);
const deploymentReadiness = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");

afterEach(() => {
  vi.doUnmock("@/lib/auth/request-context");
  vi.doUnmock("@/lib/email/oauth-state");
  vi.doUnmock("@/lib/services/crm");
  vi.resetModules();
  vi.clearAllMocks();
});

describe("hosted email OAuth redirects", () => {
  it("uses GOOGLE_OAUTH_REDIRECT_URI exactly when building the Google authorization URL", () => {
    const config = resolveGoogleOAuthConfig({
      GOOGLE_CLIENT_ID: "legacy-client",
      GOOGLE_CLIENT_SECRET: "legacy-secret",
      GOOGLE_OAUTH_CLIENT_ID: "hosted-client",
      GOOGLE_OAUTH_CLIENT_SECRET: "hosted-secret",
      GOOGLE_OAUTH_REDIRECT_URI: "https://northstar.example.test/api/email-connections/google/callback",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/api/email-connections/google/callback"
    });

    expect(config).toEqual({
      clientId: "hosted-client",
      clientSecret: "hosted-secret",
      redirectUri: "https://northstar.example.test/api/email-connections/google/callback"
    });

    const url = buildGoogleAuthorizationUrl({
      config: config as Required<typeof config>,
      state: "signed-state"
    });

    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://northstar.example.test/api/email-connections/google/callback"
    );
    expect(url.searchParams.get("redirect_uri")).not.toContain("localhost");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.send");
  });

  it("keeps legacy local dev redirect behavior when only legacy env is configured", () => {
    const config = resolveGoogleOAuthConfig({
      GOOGLE_CLIENT_ID: "local-client",
      GOOGLE_CLIENT_SECRET: "local-secret",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/api/email-connections/google/callback"
    });

    expect(config).toMatchObject({
      clientId: "local-client",
      clientSecret: "local-secret",
      redirectUri: "http://localhost:3000/api/email-connections/google/callback"
    });
  });

  it("uses MICROSOFT_OAUTH_REDIRECT_URI exactly when building the Microsoft authorization URL", () => {
    const config = resolveMicrosoftOAuthConfig({
      MICROSOFT_CLIENT_ID: "legacy-client",
      MICROSOFT_CLIENT_SECRET: "legacy-secret",
      MICROSOFT_OAUTH_CLIENT_ID: "hosted-client",
      MICROSOFT_OAUTH_CLIENT_SECRET: "hosted-secret",
      MICROSOFT_OAUTH_REDIRECT_URI: "https://northstar.example.test/api/email-connections/microsoft/callback",
      MICROSOFT_REDIRECT_URI: "http://localhost:3000/api/email-connections/microsoft/callback"
    });

    expect(config).toEqual({
      clientId: "hosted-client",
      clientSecret: "hosted-secret",
      redirectUri: "https://northstar.example.test/api/email-connections/microsoft/callback"
    });

    const url = buildMicrosoftAuthorizationUrl({
      config: config as Required<typeof config>,
      state: "signed-state"
    });

    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://northstar.example.test/api/email-connections/microsoft/callback"
    );
    expect(url.searchParams.get("redirect_uri")).not.toContain("localhost");
    expect(url.hostname).toBe("login.microsoftonline.com");
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
  });

  it("builds callback redirects from APP_BASE_URL instead of an internal localhost request URL", () => {
    expect(
      buildAppUrl("/settings", {
        appBaseUrl: "https://northstar.example.test",
        requestUrl: "http://localhost:3000/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("https://northstar.example.test/settings");
    expect(
      buildAppUrl("/settings", {
        appBaseUrl: "https://preview:secret@northstar.example.test",
        requestUrl: "http://localhost:3000/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("https://northstar.example.test/settings");

    expect(
      buildAppUrl("/settings", {
        appBaseUrl: "",
        requestUrl: "http://localhost:3000/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("http://localhost:3000/settings");
    expect(
      buildAppUrl("/settings", {
        appBaseUrl: "",
        requestUrl: "https://internal:secret@northstar.example.test/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("https://northstar.example.test/settings");
    expect(
      buildAppUrl("//evil.example.test/settings", {
        appBaseUrl: "https://northstar.example.test",
        requestUrl: "http://localhost:3000/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("https://northstar.example.test/evil.example.test/settings");
    expect(
      buildAppUrl({ path: "/settings" }, {
        appBaseUrl: "https://northstar.example.test",
        requestUrl: "http://localhost:3000/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("https://northstar.example.test/");
  });

  it("routes email OAuth callbacks through the hosted app URL helper", () => {
    expect(googleCallbackRoute).toContain("buildAppUrl");
    expect(googleCallbackRoute).toContain("new URL(buildAppUrl(\"/settings\", { requestUrl: request.url }))");
    expect(microsoftCallbackRoute).toContain("buildAppUrl");
    expect(microsoftCallbackRoute).toContain("new URL(buildAppUrl(\"/settings\", { requestUrl: request.url }))");
  });

  it("keeps OAuth callback handling free of query-bearing error logs", () => {
    expect(googleCallbackRoute).not.toContain("console.");
    expect(googleCallbackRoute).not.toContain("error.message");
    expect(microsoftCallbackRoute).not.toContain("console.");
    expect(microsoftCallbackRoute).not.toContain("error.message");
  });

  it("redirects Google provider errors without preserving provider query details", async () => {
    mockGoogleCallbackDependencies();
    const { GET } = await import("@/app/api/email-connections/google/callback/route");

    const response = await GET(
      oauthCallbackRequest(
        "https://northstar.example.test/api/email-connections/google/callback?error=access_denied&error_description=provider-secret&state=signed-state"
      )
    );
    const location = response.headers.get("location");

    expect(location).toBe("https://northstar.example.test/settings?emailConnection=gmail-error");
    expect(location).not.toContain("access_denied");
    expect(location).not.toContain("provider-secret");
  });

  it("rejects Google callback states minted for another provider before exchanging tokens", async () => {
    const { exchangeGoogleAuthorizationCode, getRequestContext } = mockGoogleCallbackDependencies({
      state: {
        actorUserId: "user_123",
        expiresAt: Date.parse("2030-01-01T12:10:00.000Z"),
        provider: "MICROSOFT_365",
        workspaceId: "workspace_123"
      }
    });
    const { GET } = await import("@/app/api/email-connections/google/callback/route");

    const response = await GET(
      oauthCallbackRequest(
        "https://northstar.example.test/api/email-connections/google/callback?code=one-time-code&state=signed-state"
      )
    );

    expect(response.headers.get("location")).toBe("https://northstar.example.test/settings?emailConnection=gmail-error");
    expect(getRequestContext).not.toHaveBeenCalled();
    expect(exchangeGoogleAuthorizationCode).not.toHaveBeenCalled();
  });

  it("redirects Microsoft provider errors without preserving provider query details", async () => {
    mockMicrosoftCallbackDependencies();
    const { GET } = await import("@/app/api/email-connections/microsoft/callback/route");

    const response = await GET(
      oauthCallbackRequest(
        "https://northstar.example.test/api/email-connections/microsoft/callback?error=access_denied&error_description=provider-secret&state=signed-state"
      )
    );
    const location = response.headers.get("location");

    expect(location).toBe("https://northstar.example.test/settings?emailConnection=microsoft-error");
    expect(location).not.toContain("access_denied");
    expect(location).not.toContain("provider-secret");
  });

  it("rejects Microsoft callback states minted for another provider before exchanging tokens", async () => {
    const { exchangeMicrosoftAuthorizationCode, getRequestContext } = mockMicrosoftCallbackDependencies({
      state: {
        actorUserId: "user_123",
        expiresAt: Date.parse("2030-01-01T12:10:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        workspaceId: "workspace_123"
      }
    });
    const { GET } = await import("@/app/api/email-connections/microsoft/callback/route");

    const response = await GET(
      oauthCallbackRequest(
        "https://northstar.example.test/api/email-connections/microsoft/callback?code=one-time-code&state=signed-state"
      )
    );

    expect(response.headers.get("location")).toBe("https://northstar.example.test/settings?emailConnection=microsoft-error");
    expect(getRequestContext).not.toHaveBeenCalled();
    expect(exchangeMicrosoftAuthorizationCode).not.toHaveBeenCalled();
  });

  it("documents Google env precedence and OAuth callback query redaction", () => {
    expect(deploymentReadiness).toContain("GOOGLE_OAUTH_CLIENT_ID");
    expect(deploymentReadiness).toContain("GOOGLE_OAUTH_REDIRECT_URI");
    expect(deploymentReadiness).toContain("take precedence over the shorter Google aliases");
    expect(deploymentReadiness).toContain("/api/email-connections/google/callback");
    expect(deploymentReadiness).toContain("/api/email-connections/microsoft/callback");
    expect(deploymentReadiness).toContain("redact query strings");
  });
});

function oauthCallbackRequest(url: string) {
  return {
    nextUrl: new URL(url),
    url
  } as Parameters<typeof import("@/app/api/email-connections/google/callback/route").GET>[0];
}

function mockGoogleCallbackDependencies({
  state = {
    actorUserId: "user_123",
    expiresAt: Date.parse("2030-01-01T12:10:00.000Z"),
    provider: "GOOGLE_WORKSPACE",
    workspaceId: "workspace_123"
  }
}: {
  state?: {
    actorUserId: string;
    expiresAt: number;
    provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365";
    workspaceId: string;
  };
} = {}) {
  const getRequestContext = vi.fn(async () => ({
    actorUserId: "user_123",
    user: { id: "user_123" }
  }));
  const resolveCurrentWorkspaceContext = vi.fn(async () => ({
    actor: { actorUserId: "user_123", workspaceId: "workspace_123" }
  }));
  const exchangeGoogleAuthorizationCode = vi.fn(async () => ({ access_token: "access-token" }));

  vi.doMock("@/lib/auth/request-context", () => ({
    getRequestContext,
    resolveCurrentWorkspaceContext
  }));
  vi.doMock("@/lib/email/oauth-state", () => ({
    verifyEmailOAuthState: vi.fn(() => state)
  }));
  vi.doMock("@/lib/services/crm", () => ({
    assertGoogleOAuthReady: vi.fn(() => ({
      clientId: "google-client",
      clientSecret: "google-secret",
      redirectUri: "https://northstar.example.test/api/email-connections/google/callback"
    })),
    exchangeGoogleAuthorizationCode,
    fetchGoogleUserProfile: vi.fn(async () => ({
      email: "alex@example.test",
      name: "Alex"
    })),
    storeGoogleOAuthConnection: vi.fn()
  }));

  return { exchangeGoogleAuthorizationCode, getRequestContext, resolveCurrentWorkspaceContext };
}

function mockMicrosoftCallbackDependencies({
  state = {
    actorUserId: "user_123",
    expiresAt: Date.parse("2030-01-01T12:10:00.000Z"),
    provider: "MICROSOFT_365",
    workspaceId: "workspace_123"
  }
}: {
  state?: {
    actorUserId: string;
    expiresAt: number;
    provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365";
    workspaceId: string;
  };
} = {}) {
  const getRequestContext = vi.fn(async () => ({
    actorUserId: "user_123",
    user: { id: "user_123" }
  }));
  const resolveCurrentWorkspaceContext = vi.fn(async () => ({
    actor: { actorUserId: "user_123", workspaceId: "workspace_123" }
  }));
  const exchangeMicrosoftAuthorizationCode = vi.fn(async () => ({ access_token: "access-token" }));

  vi.doMock("@/lib/auth/request-context", () => ({
    getRequestContext,
    resolveCurrentWorkspaceContext
  }));
  vi.doMock("@/lib/email/oauth-state", () => ({
    verifyEmailOAuthState: vi.fn(() => state)
  }));
  vi.doMock("@/lib/services/crm", () => ({
    assertMicrosoftOAuthReady: vi.fn(() => ({
      clientId: "microsoft-client",
      clientSecret: "microsoft-secret",
      redirectUri: "https://northstar.example.test/api/email-connections/microsoft/callback"
    })),
    exchangeMicrosoftAuthorizationCode,
    fetchMicrosoftUserProfile: vi.fn(async () => ({
      displayName: "Alex",
      mail: "alex@example.test",
      userPrincipalName: "alex@example.test"
    })),
    storeMicrosoftOAuthConnection: vi.fn()
  }));

  return { exchangeMicrosoftAuthorizationCode, getRequestContext, resolveCurrentWorkspaceContext };
}
