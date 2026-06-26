import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildAppUrl } from "@/lib/public-url";
import { buildGoogleAuthorizationUrl, resolveGoogleOAuthConfig } from "@/lib/services/email-connection-service";

const googleCallbackRoute = readFileSync(
  join(process.cwd(), "app/api/email-connections/google/callback/route.ts"),
  "utf8"
);
const microsoftCallbackRoute = readFileSync(
  join(process.cwd(), "app/api/email-connections/microsoft/callback/route.ts"),
  "utf8"
);
const deploymentReadiness = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");

describe("hosted Google OAuth redirects", () => {
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

  it("builds callback redirects from APP_BASE_URL instead of an internal localhost request URL", () => {
    expect(
      buildAppUrl("/settings", {
        appBaseUrl: "https://northstar.example.test",
        requestUrl: "http://localhost:3000/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("https://northstar.example.test/settings");

    expect(
      buildAppUrl("/settings", {
        appBaseUrl: "",
        requestUrl: "http://localhost:3000/api/email-connections/google/callback?code=one-time-code"
      })
    ).toBe("http://localhost:3000/settings");
  });

  it("routes email OAuth callbacks through the hosted app URL helper", () => {
    expect(googleCallbackRoute).toContain("buildAppUrl");
    expect(googleCallbackRoute).toContain("new URL(buildAppUrl(\"/settings\", { requestUrl: request.url }))");
    expect(microsoftCallbackRoute).toContain("buildAppUrl");
    expect(microsoftCallbackRoute).toContain("new URL(buildAppUrl(\"/settings\", { requestUrl: request.url }))");
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
