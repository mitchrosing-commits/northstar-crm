import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canUseEmailTokenEncryptionKey,
  decryptEmailToken,
  EmailTokenDecryptionError,
  EmailTokenEncryptionKeyError,
  encryptEmailToken
} from "@/lib/email/token-encryption";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260626020000_email_connection_encrypted_tokens/migration.sql"),
  "utf8"
);
const service = readFileSync(join(process.cwd(), "lib/services/email-connection-service.ts"), "utf8");
const connectRoute = readFileSync(join(process.cwd(), "app/api/email-connections/google/connect/route.ts"), "utf8");
const callbackRoute = readFileSync(join(process.cwd(), "app/api/email-connections/google/callback/route.ts"), "utf8");

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
    expect(() => encryptEmailToken("gmail-token", {})).toThrow(EmailTokenEncryptionKeyError);
    expect(canUseEmailTokenEncryptionKey({ EMAIL_TOKEN_ENCRYPTION_KEY: "short" })).toBe(false);
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
    expect(service).toContain("https://www.googleapis.com/auth/gmail.metadata");
    expect(service).toContain("export function assertGoogleOAuthReady");
    expect(service).toContain("export function buildGoogleAuthorizationUrl");
    expect(service).toContain("export async function exchangeGoogleAuthorizationCode");
    expect(service).toContain("export async function fetchGoogleUserProfile");
    expect(service).toContain("export async function storeGoogleOAuthConnection");
    expect(service).toContain("encryptedAccessToken: encryptEmailToken(tokenResponse.access_token");
    expect(service).toContain("encryptedRefreshToken");
    expect(service).toContain("actionLabel: connection?.status === \"CONNECTED\" ? \"Reconnect Gmail\" : \"Connect Gmail\"");
    expect(service).toContain("disabled: false");
    expect(service).not.toContain("console.log");
    expect(service).not.toContain("console.error");
  });

  it("adds safe Gmail connect and callback routes without mailbox sync", () => {
    expect(connectRoute).toContain("assertGoogleOAuthReady");
    expect(connectRoute).toContain("createEmailOAuthState");
    expect(connectRoute).toContain("buildGoogleAuthorizationUrl");
    expect(callbackRoute).toContain("verifyEmailOAuthState");
    expect(callbackRoute).toContain("exchangeGoogleAuthorizationCode");
    expect(callbackRoute).toContain("fetchGoogleUserProfile");
    expect(callbackRoute).toContain("storeGoogleOAuthConnection");
    expect(callbackRoute).toContain("gmail-connected");
    expect(callbackRoute).not.toContain("emailLog.create");
    expect(callbackRoute).not.toContain("messages.list");
  });
});
