import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createEmailOAuthState, verifyEmailOAuthState } from "@/lib/email/oauth-state";
import {
  canUseEmailTokenEncryptionKey,
  decryptEmailToken,
  EmailTokenDecryptionError,
  EmailTokenEncryptionKeyError,
  encryptEmailToken
} from "@/lib/email/token-encryption";
import {
  exchangeGoogleAuthorizationCode,
  exchangeMicrosoftAuthorizationCode,
  fetchGoogleUserProfile,
  fetchMicrosoftUserProfile
} from "@/lib/services/email-connection-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260626020000_email_connection_encrypted_tokens/migration.sql"),
  "utf8"
);
const service = readFileSync(join(process.cwd(), "lib/services/email-connection-service.ts"), "utf8");
const gmailDiagnoseScript = readFileSync(join(process.cwd(), "scripts/gmail-diagnose.ts"), "utf8");
const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const connectRoute = readFileSync(join(process.cwd(), "app/api/email-connections/google/connect/route.ts"), "utf8");
const callbackRoute = readFileSync(join(process.cwd(), "app/api/email-connections/google/callback/route.ts"), "utf8");
const microsoftConnectRoute = readFileSync(join(process.cwd(), "app/api/email-connections/microsoft/connect/route.ts"), "utf8");
const microsoftCallbackRoute = readFileSync(join(process.cwd(), "app/api/email-connections/microsoft/callback/route.ts"), "utf8");
const oauthState = readFileSync(join(process.cwd(), "lib/email/oauth-state.ts"), "utf8");

describe("encrypted email token storage", () => {
  it("encrypts and decrypts email provider tokens with AES-GCM payloads", () => {
    const env = { EMAIL_TOKEN_ENCRYPTION_KEY: "x".repeat(32) };
    const encrypted = encryptEmailToken("gmail-access-token", env);

    expect(encrypted).not.toContain("gmail-access-token");
    expect(encrypted.startsWith("v1.")).toBe(true);
    expect(decryptEmailToken(encrypted, env)).toBe("gmail-access-token");
  });

  it("rejects wrong keys, malformed payloads, and missing keys", () => {
    const encrypted = encryptEmailToken("gmail-refresh-token", { EMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(32) });

    expect(() => decryptEmailToken(encrypted, { EMAIL_TOKEN_ENCRYPTION_KEY: "b".repeat(32) })).toThrow(EmailTokenDecryptionError);
    expect(() => decryptEmailToken("not-a-token", { EMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(32) })).toThrow(EmailTokenDecryptionError);
    expect(() => decryptEmailToken({ payload: encrypted }, { EMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(32) })).toThrow(
      EmailTokenDecryptionError
    );
    expect(() => encryptEmailToken("gmail-token", {})).toThrow(EmailTokenEncryptionKeyError);
    expect(() => encryptEmailToken({ token: "gmail-token" }, { EMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(32) })).toThrow(
      "Cannot encrypt an empty email token."
    );
    expect(canUseEmailTokenEncryptionKey({ EMAIL_TOKEN_ENCRYPTION_KEY: "short" })).toBe(false);
  });

  it("rejects tampered encrypted email token payload components", () => {
    const env = { EMAIL_TOKEN_ENCRYPTION_KEY: "a".repeat(32) };
    const encrypted = encryptEmailToken("gmail-refresh-token", env);

    expect(() => decryptEmailToken(tamperTokenPart(encrypted, 1), env)).toThrow(EmailTokenDecryptionError);
    expect(() => decryptEmailToken(tamperTokenPart(encrypted, 2), env)).toThrow(EmailTokenDecryptionError);
    expect(() => decryptEmailToken(tamperTokenPart(encrypted, 3), env)).toThrow(EmailTokenDecryptionError);
    expect(() => decryptEmailToken(encrypted.replace(/^v1\./, "v2."), env)).toThrow(EmailTokenDecryptionError);
  });

  it("stores only encrypted token fields in a separate secret table", () => {
    expect(schema).toContain("model EmailConnectionSecret");
    expect(schema).toContain("encryptedAccessToken");
    expect(schema).toContain("encryptedRefreshToken");
    expect(schema).toContain("accessTokenExpiresAt");
    expect(schema).toMatch(/connection\s+EmailConnection/);
    expect(schema).toContain("providerMessageId");
    expect(schema).toContain("@@unique([workspaceId, provider, providerMessageId])");
    expect(migration).toContain("Only encrypted token payloads are stored");
    expect(migration).toContain("\"encryptedAccessToken\" TEXT NOT NULL");
    expect(migration).toContain("\"encryptedRefreshToken\" TEXT");
    expect(schema).not.toMatch(/\n\s+accessToken\s+String/);
    expect(schema).not.toMatch(/\n\s+refreshToken\s+String/);
  });

  it("connects Gmail only through configured OAuth and encrypted persistence", () => {
    expect(service).toContain("gmailOAuthScopes");
    expect(service).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(service).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(service).toContain("export function assertGoogleOAuthReady");
    expect(service).toContain("export function buildGoogleAuthorizationUrl");
    expect(service).toContain("export async function exchangeGoogleAuthorizationCode");
    expect(service).toContain("export async function resolveGoogleOAuthGrantedScopes");
    expect(service).toContain("export async function fetchGoogleUserProfile");
    expect(service).toContain("export async function storeGoogleOAuthConnection");
    expect(service).toContain("normalizeProviderAccountEmail(profile.email, \"Gmail\")");
    expect(service).toContain("normalizeAccessTokenExpiresAt(tokenResponse.expires_in)");
    expect(service).toContain("function normalizeScopes(scope: unknown");
    expect(service).toContain("return normalizeScopes(scope, [])");
    expect(service).toContain("https://oauth2.googleapis.com/tokeninfo");
    expect(service).toContain("EMAIL_OAUTH_GMAIL_SCOPES_MISSING");
    expect(service).toContain("encryptedAccessToken: encryptEmailToken(tokenResponse.access_token");
    expect(service).toContain("encryptedRefreshToken");
    expect(service).toContain("actionLabel: connection?.status === \"CONNECTED\" ? \"Reconnect Gmail\" : \"Connect Gmail\"");
    expect(service).toContain("disabled: false");
    expect(service).not.toContain("console.log");
    expect(service).not.toContain("console.error");
  });

  it("adds a safe Gmail full-message diagnostic path without exposing provider secrets", () => {
    expect(service).toContain("export async function diagnoseGmailConnection");
    expect(service).toContain("findGmailConnectionForDiagnostic(actor.workspaceId, options.connectionRef)");
    expect(service).toContain("resolveUsableGoogleAccessToken({ config, connection, env, fetchImpl })");
    expect(service).toContain("resolveUsableGoogleAccessTokenForDiagnostic");
    expect(service).toContain("diagnoseGoogleTokenInfo");
    expect(service).toContain("diagnoseGmailInboxList");
    expect(service).toContain("diagnoseGmailFullMessageGet");
    expect(service).toContain("diagnoseGmailSyncJob");
    expect(service).toContain("diagnoseGoogleOAuthAuthorizationRequest");
    expect(service).toContain("findGmailSyncJobForDiagnostic");
    expect(service).toContain("readGmailProviderErrorInfo");
    expect(service).toContain("providerErrorCategory");
    expect(service).toContain("providerReason");
    expect(service).toContain("providerStatus");
    expect(service).not.toContain("provider-body-secret-token");

    expect(packageJson).toContain("\"gmail:diagnose\": \"tsx scripts/gmail-diagnose.ts\"");
    expect(gmailDiagnoseScript).toContain("diagnoseGmailConnection");
    expect(gmailDiagnoseScript).toContain("GMAIL_DIAGNOSTIC_CONNECTION_REF");
    expect(gmailDiagnoseScript).toContain("GMAIL_DIAGNOSTIC_JOB_REF");
    expect(gmailDiagnoseScript).toContain("GMAIL_DIAGNOSTIC_WORKSPACE");
    expect(gmailDiagnoseScript).toContain("--connection-ref");
    expect(gmailDiagnoseScript).toContain("--job-ref");
    expect(gmailDiagnoseScript).toContain("safeDiagnosticRequest");
    expect(gmailDiagnoseScript).toContain("console.log(JSON.stringify");
    expect(gmailDiagnoseScript).toContain("Gmail diagnostic failed.");
    expect(gmailDiagnoseScript).not.toContain("console.error(error");
    expect(gmailDiagnoseScript).not.toContain("error.stack");
    expect(gmailDiagnoseScript).not.toContain("encryptedAccessToken");
    expect(gmailDiagnoseScript).not.toContain("encryptedRefreshToken");
  });

  it("adds safe Gmail connect and callback routes without mailbox sync", () => {
    expect(connectRoute).toContain("assertGoogleOAuthReady");
    expect(connectRoute).toContain("createEmailOAuthState");
    expect(connectRoute).toContain("buildGoogleAuthorizationUrl");
    expect(callbackRoute).toContain("verifyEmailOAuthState");
    expect(callbackRoute).toContain("state.provider !== \"GOOGLE_WORKSPACE\"");
    expect(callbackRoute).toContain("exchangeGoogleAuthorizationCode");
    expect(callbackRoute).toContain("fetchGoogleUserProfile");
    expect(callbackRoute).toContain("storeGoogleOAuthConnection");
    expect(callbackRoute).toContain("gmail-connected");
    expect(callbackRoute).not.toContain("emailLog.create");
    expect(callbackRoute).not.toContain("messages.list");
  });

  it("adds safe Microsoft connect and callback routes without mailbox sync", () => {
    expect(service).toContain("microsoftOAuthScopes");
    expect(service).toContain("Mail.Read");
    expect(service).toContain("offline_access");
    expect(service).toContain("export function assertMicrosoftOAuthReady");
    expect(service).toContain("export function buildMicrosoftAuthorizationUrl");
    expect(service).toContain("export async function exchangeMicrosoftAuthorizationCode");
    expect(service).toContain("export async function fetchMicrosoftUserProfile");
    expect(service).toContain("export async function storeMicrosoftOAuthConnection");
    expect(service).toContain("export async function syncRecentMicrosoftMessages");
    expect(service).toContain("normalizeProviderAccountEmail(profile.mail ?? profile.userPrincipalName, \"Microsoft\")");
    expect(service).toContain("encryptedAccessToken: encryptEmailToken(tokenResponse.access_token");
    expect(service).not.toContain("Mail.Send");
    expect(service).not.toContain("Mail.ReadWrite");
    expect(microsoftConnectRoute).toContain("assertMicrosoftOAuthReady");
    expect(microsoftConnectRoute).toContain("createEmailOAuthState");
    expect(microsoftConnectRoute).toContain("buildMicrosoftAuthorizationUrl");
    expect(microsoftCallbackRoute).toContain("verifyEmailOAuthState");
    expect(microsoftCallbackRoute).toContain("state.provider !== \"MICROSOFT_365\"");
    expect(microsoftCallbackRoute).toContain("exchangeMicrosoftAuthorizationCode");
    expect(microsoftCallbackRoute).toContain("fetchMicrosoftUserProfile");
    expect(microsoftCallbackRoute).toContain("storeMicrosoftOAuthConnection");
    expect(microsoftCallbackRoute).toContain("microsoft-connected");
    expect(microsoftCallbackRoute).not.toContain("emailLog.create");
    expect(microsoftCallbackRoute).not.toContain("messages");
    expect(oauthState).toContain("\"GOOGLE_WORKSPACE\" | \"MICROSOFT_365\"");
  });

  it("returns stable redacted OAuth errors when providers return non-JSON success responses", async () => {
    const googleConfig = {
      clientId: "google-client",
      clientSecret: "google-secret",
      redirectUri: "https://crm.example.test/api/email-connections/google/callback"
    };
    const microsoftConfig = {
      clientId: "microsoft-client",
      clientSecret: "microsoft-secret",
      redirectUri: "https://crm.example.test/api/email-connections/microsoft/callback"
    };

    await expectRedactedProviderError(
      exchangeGoogleAuthorizationCode({
        code: "google-code",
        config: googleConfig,
        fetchImpl: nonJsonProviderFetch
      }),
      {
        code: "EMAIL_OAUTH_TOKEN_EXCHANGE_FAILED",
        message: "Gmail authorization could not be completed.",
        status: 400
      }
    );
    await expectRedactedProviderError(
      exchangeMicrosoftAuthorizationCode({
        code: "microsoft-code",
        config: microsoftConfig,
        fetchImpl: nonJsonProviderFetch
      }),
      {
        code: "EMAIL_OAUTH_TOKEN_EXCHANGE_FAILED",
        message: "Microsoft authorization could not be completed.",
        status: 400
      }
    );
    await expectRedactedProviderError(
      fetchGoogleUserProfile({
        accessToken: "google-access-token",
        fetchImpl: nonJsonProviderFetch
      }),
      {
        code: "EMAIL_OAUTH_PROFILE_FAILED",
        message: "Gmail account profile could not be loaded.",
        status: 400
      }
    );
    await expectRedactedProviderError(
      fetchMicrosoftUserProfile({
        accessToken: "microsoft-access-token",
        fetchImpl: nonJsonProviderFetch
      }),
      {
        code: "EMAIL_OAUTH_PROFILE_FAILED",
        message: "Microsoft account profile could not be loaded.",
        status: 400
      }
    );
  });

  it("rejects signed email OAuth states with malformed payload fields", () => {
    const env = { EMAIL_TOKEN_ENCRYPTION_KEY: "x".repeat(32) };
    const now = Date.parse("2030-01-01T12:00:00.000Z");
    const validState = createEmailOAuthState(
      {
        actorUserId: "user_123",
        provider: "GOOGLE_WORKSPACE",
        workspaceId: "workspace_123"
      },
      env,
      now
    );

    expect(verifyEmailOAuthState(validState, env, now)).toMatchObject({
      actorUserId: "user_123",
      provider: "GOOGLE_WORKSPACE",
      workspaceId: "workspace_123"
    });
    expect(() =>
      verifyEmailOAuthState(
        signedState(
          {
            actorUserId: { id: "user_123" },
            expiresAt: now + 60_000,
            provider: "GOOGLE_WORKSPACE",
            workspaceId: "workspace_123"
          },
          env
        ),
        env,
        now
      )
    ).toThrow("Email connection state is invalid.");
    expect(() =>
      verifyEmailOAuthState(
        signedState(
          {
            actorUserId: "user_123",
            expiresAt: String(now + 60_000),
            provider: "GOOGLE_WORKSPACE",
            workspaceId: "workspace_123"
          },
          env
        ),
        env,
        now
      )
    ).toThrow("Email connection state is invalid.");
    expect(() =>
      verifyEmailOAuthState(
        signedState(
          {
            actorUserId: "user_123",
            expiresAt: now + 60_000,
            provider: "GOOGLE_WORKSPACE",
            workspaceId: ""
          },
          env
        ),
        env,
        now
      )
    ).toThrow("Email connection state is invalid.");
  });

  it("rejects tampered, expired, and unsigned email OAuth states", () => {
    const env = { EMAIL_TOKEN_ENCRYPTION_KEY: "x".repeat(32) };
    const now = Date.parse("2030-01-01T12:00:00.000Z");
    const validState = createEmailOAuthState(
      {
        actorUserId: "user_123",
        provider: "GOOGLE_WORKSPACE",
        workspaceId: "workspace_123"
      },
      env,
      now
    );
    const [encodedPayload, signature] = validState.split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    const tamperedPayload = Buffer.from(JSON.stringify({ ...payload, workspaceId: "workspace_other" }), "utf8").toString(
      "base64url"
    );

    expect(() => verifyEmailOAuthState(`${tamperedPayload}.${signature}`, env, now)).toThrow("Email connection state is invalid.");
    expect(() => verifyEmailOAuthState(`${encodedPayload}.${tamperBase64Url(signature)}`, env, now)).toThrow(
      "Email connection state is invalid."
    );
    expect(() => verifyEmailOAuthState(`${encodedPayload}.${signature}.extra`, env, now)).toThrow(
      "Email connection state is invalid."
    );
    expect(() => verifyEmailOAuthState(null, env, now)).toThrow("Email connection state is required.");
    expect(() =>
      verifyEmailOAuthState(
        createEmailOAuthState(
          {
            actorUserId: "user_123",
            provider: "GOOGLE_WORKSPACE",
            workspaceId: "workspace_123"
          },
          env,
          now - 11 * 60 * 1000
        ),
        env,
        now
      )
    ).toThrow("Email connection state expired. Start the connection again.");
  });
});

async function expectRedactedProviderError(
  promise: Promise<unknown>,
  expected: { code: string; message: string; status: number }
) {
  try {
    await promise;
    throw new Error("Expected provider call to fail.");
  } catch (error) {
    expect(error).toMatchObject(expected);
    expect(String(error)).not.toContain("provider-body-secret-token");
  }
}

async function nonJsonProviderFetch() {
  return new Response("<html>provider-body-secret-token</html>", {
    headers: { "content-type": "text/html" },
    status: 200
  });
}

function signedState(payload: unknown, env: { EMAIL_TOKEN_ENCRYPTION_KEY: string }) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", env.EMAIL_TOKEN_ENCRYPTION_KEY).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function tamperTokenPart(payload: string, partIndex: number) {
  const parts = payload.split(".");
  parts[partIndex] = tamperBase64Url(parts[partIndex]);
  return parts.join(".");
}

function tamperBase64Url(value: string) {
  if (!value) return "A";
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}
