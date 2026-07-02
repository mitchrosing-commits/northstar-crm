import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiError, formatApiErrorForLog, handleApiError } from "@/lib/api/responses";

describe("API response helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps unknown API error responses generic while redacting sensitive log text", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = handleApiError(
      new Error(
        "Provider failed with Bearer secret-token for recipient@example.test at https://crm.example.test/reset-password?token=raw-reset-token&client_secret=provider-secret"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong."
      }
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const logged = String(consoleError.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("Bearer [redacted]");
    expect(logged).toContain("[redacted reset url]");
    expect(logged).toContain("[redacted email]");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("raw-reset-token");
    expect(logged).not.toContain("provider-secret");
    expect(logged).not.toContain("recipient@example.test");
  });

  it("redacts sensitive fields from string and object-shaped internal API errors", () => {
    const stringLog = formatApiErrorForLog(
      [
        'Webhook failed /reset-password?token=inline-token with reset token labeled-token and plain token=plain-token and access_token=oauth-token clientSecret=camel-secret accessToken=camel-access Authorization: Basic basic-secret X-API-Key: header-api-key JSON {"apiKey":123456,"sessionToken":true,"resetToken":null,"safe":42}',
        "Provider callback failed at https://preview:credential-secret@crm.example.test/oauth/callback",
        "OAuth callback https://crm.example.test/api/email-connections/google/callback?code=oauth-code&state=oauth-state&error_description=provider-secret",
        "Public quote failed at https://crm.example.test/q/abcdefghijklmnopqrstuvwxyzABCDEF1234567890 and /q/ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210",
        "Cookie: crm_session=session-secret; theme=light",
        "Set-Cookie: reset=reset-cookie-secret; HttpOnly",
        "Env AUTH_SESSION_SECRET=session-secret-value RESEND_API_KEY=resend-api-key EMAIL_TOKEN_ENCRYPTION_KEY=email-token-key AUTH_EMAIL_WEBHOOK_TOKEN=webhook-token DATABASE_URL=postgresql://crm:database-password@localhost:5432/crm_mvp",
        "Config databaseUrl=postgresql://crm:camel-database-password@localhost:5432/crm_mvp sessionSecret=camel-session-secret encryptionKey=camel-encryption-key privateKey=camel-private-key webhookUrl=https://hooks.example.test/auth-reset?token=webhook-query-token",
        "DB postgresql://crm:other-database-password@localhost:5432/crm_mvp"
      ].join("\n")
    );

    expect(stringLog).toBe(
      [
        'Webhook failed [redacted reset url] with reset token [redacted] and plain token=[redacted] and access_token=[redacted] clientSecret=[redacted] accessToken=[redacted] Authorization: [redacted] X-API-Key: [redacted] JSON {"apiKey":"[redacted]","sessionToken":"[redacted]","resetToken":"[redacted]","safe":42}',
        "Provider callback failed at https://[redacted]@crm.example.test/oauth/callback",
        "OAuth callback https://crm.example.test/api/email-connections/google/callback?code=[redacted]&state=[redacted]&error_description=[redacted]",
        "Public quote failed at https://crm.example.test/q/[redacted] and /q/[redacted]",
        "Cookie: [redacted]",
        "Set-Cookie: [redacted]",
        "Env AUTH_SESSION_SECRET=[redacted] RESEND_API_KEY=[redacted] EMAIL_TOKEN_ENCRYPTION_KEY=[redacted] AUTH_EMAIL_WEBHOOK_TOKEN=[redacted] DATABASE_URL=[redacted]",
        "Config databaseUrl=[redacted] sessionSecret=[redacted] encryptionKey=[redacted] privateKey=[redacted] webhookUrl=[redacted]",
        "DB postgresql://[redacted]@localhost:5432/crm_mvp"
      ].join("\n")
    );
    const objectLog = formatApiErrorForLog({
      accessToken: "object-access-token",
      cookie: "crm_session=object-cookie-secret",
      detail: "client_secret=client-secret&refresh_token=refresh-secret&api_key=provider-key",
      email: "founder@example.test",
      EMAIL_TOKEN_ENCRYPTION_KEY: "object-email-token-key",
      databaseUrl: "postgresql://crm:object-database-password@localhost:5432/crm_mvp",
      encryptionKey: "object-encryption-key",
      nested: { authorization: "Bearer nested-secret-token", clientSecret: "nested-client-secret" },
      privateKey: "object-private-key",
      RESEND_API_KEY: "object-resend-api-key",
      resetUrl: "https://crm.example.test/reset-password?token=object-reset-token",
      secret: "object-secret",
      sessionSecret: "object-session-secret",
      sessionToken: "object-session-token",
      setCookie: "crm_session=object-set-cookie-secret",
      token: "object-token",
      webhookUrl: "https://hooks.example.test/reset?token=object-webhook-token"
    });

    expect(objectLog).toContain(
      '"detail":"client_secret=[redacted]&refresh_token=[redacted]&api_key=[redacted]"'
    );
    expect(objectLog).toContain('"accessToken":"[redacted]"');
    expect(objectLog).toContain('"cookie":"[redacted]"');
    expect(objectLog).toContain('"authorization":"[redacted]"');
    expect(objectLog).toContain('"clientSecret":"[redacted]"');
    expect(objectLog).toContain('"EMAIL_TOKEN_ENCRYPTION_KEY":"[redacted]"');
    expect(objectLog).toContain('"RESEND_API_KEY":"[redacted]"');
    expect(objectLog).toContain('"databaseUrl":"[redacted]"');
    expect(objectLog).toContain('"encryptionKey":"[redacted]"');
    expect(objectLog).toContain('"privateKey":"[redacted]"');
    expect(objectLog).toContain('"resetUrl":"[redacted]"');
    expect(objectLog).toContain('"secret":"[redacted]"');
    expect(objectLog).toContain('"sessionSecret":"[redacted]"');
    expect(objectLog).toContain('"sessionToken":"[redacted]"');
    expect(objectLog).toContain('"setCookie":"[redacted]"');
    expect(objectLog).toContain('"token":"[redacted]"');
    expect(objectLog).toContain('"webhookUrl":"[redacted]"');
    expect(objectLog).not.toContain("provider-key");
    expect(objectLog).not.toContain("client-secret");
    expect(objectLog).not.toContain("refresh-secret");
    expect(objectLog).not.toContain("nested-secret-token");
    expect(objectLog).not.toContain("nested-client-secret");
    expect(objectLog).not.toContain("object-access-token");
    expect(stringLog).not.toContain("123456");
    expect(stringLog).not.toContain("plain-token");
    expect(stringLog).not.toContain("credential-secret");
    expect(stringLog).not.toContain("oauth-code");
    expect(stringLog).not.toContain("oauth-state");
    expect(stringLog).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEF1234567890");
    expect(stringLog).not.toContain("ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210");
    expect(stringLog).not.toContain("session-secret-value");
    expect(stringLog).not.toContain("resend-api-key");
    expect(stringLog).not.toContain("email-token-key");
    expect(stringLog).not.toContain("webhook-token");
    expect(stringLog).not.toContain("database-password");
    expect(stringLog).not.toContain("camel-database-password");
    expect(stringLog).not.toContain("camel-session-secret");
    expect(stringLog).not.toContain("camel-encryption-key");
    expect(stringLog).not.toContain("camel-private-key");
    expect(stringLog).not.toContain("webhook-query-token");
    expect(stringLog).not.toContain("other-database-password");
    expect(objectLog).not.toContain("basic-secret");
    expect(objectLog).not.toContain("header-api-key");
    expect(objectLog).not.toContain("object-cookie-secret");
    expect(objectLog).not.toContain("object-email-token-key");
    expect(objectLog).not.toContain("object-resend-api-key");
    expect(objectLog).not.toContain("object-database-password");
    expect(objectLog).not.toContain("object-encryption-key");
    expect(objectLog).not.toContain("object-private-key");
    expect(objectLog).not.toContain("object-reset-token");
    expect(objectLog).not.toContain("object-secret");
    expect(objectLog).not.toContain("object-session-secret");
    expect(objectLog).not.toContain("object-session-token");
    expect(objectLog).not.toContain("object-set-cookie-secret");
    expect(objectLog).not.toContain("object-token");
    expect(objectLog).not.toContain("object-webhook-token");
    expect(objectLog).not.toContain("founder@example.test");
  });

  it("redacts non-string and cyclic object-shaped internal API error secrets", () => {
    const cyclicError: Record<string, unknown> = {
      detail: "safe detail",
      nested: {
        apiKey: 123456,
        sessionToken: ["session-token-array"],
        token: { raw: "nested-object-token" }
      },
      resetToken: 987654
    };
    cyclicError.self = cyclicError;
    const objectLog = formatApiErrorForLog(cyclicError);

    expect(objectLog).toContain('"detail":"safe detail"');
    expect(objectLog).toContain('"apiKey":"[redacted]"');
    expect(objectLog).toContain('"sessionToken":"[redacted]"');
    expect(objectLog).toContain('"token":"[redacted]"');
    expect(objectLog).toContain('"resetToken":"[redacted]"');
    expect(objectLog).toContain('"self":"[redacted]"');
    expect(objectLog).not.toContain("123456");
    expect(objectLog).not.toContain("session-token-array");
    expect(objectLog).not.toContain("nested-object-token");
    expect(objectLog).not.toContain("987654");
  });

  it("redacts sensitive typed API error messages and details before returning them", async () => {
    const response = handleApiError(
      new ApiError(
        "PROVIDER_FAILED",
        "Provider failed for founder@example.test with reset token message-token.",
        400,
        {
          accessToken: "object-access-token",
          cookie: "crm_session=object-cookie-secret",
          detail: "client_secret=client-secret&refresh_token=refresh-secret",
          nested: { authorization: "Bearer nested-secret-token", clientSecret: "nested-client-secret" },
          resetUrl: "https://crm.example.test/reset-password?token=object-reset-token",
          safeField: "safe diagnostic",
          sessionToken: "object-session-token",
          setCookie: "crm_session=object-set-cookie-secret",
          token: "object-token"
        }
      )
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "PROVIDER_FAILED",
        details: {
          accessToken: "[redacted]",
          cookie: "[redacted]",
          detail: "client_secret=[redacted]&refresh_token=[redacted]",
          nested: { authorization: "[redacted]", clientSecret: "[redacted]" },
          resetUrl: "[redacted]",
          safeField: "safe diagnostic",
          sessionToken: "[redacted]",
          setCookie: "[redacted]",
          token: "[redacted]"
        },
        message: "Provider failed for [redacted email] with reset token [redacted]"
      }
    });
    expect(serialized).not.toContain("client-secret");
    expect(serialized).not.toContain("refresh-secret");
    expect(serialized).not.toContain("nested-secret-token");
    expect(serialized).not.toContain("nested-client-secret");
    expect(serialized).not.toContain("object-access-token");
    expect(serialized).not.toContain("object-cookie-secret");
    expect(serialized).not.toContain("object-reset-token");
    expect(serialized).not.toContain("object-session-token");
    expect(serialized).not.toContain("object-set-cookie-secret");
    expect(serialized).not.toContain("object-token");
    expect(serialized).not.toContain("founder@example.test");
    expect(serialized).not.toContain("message-token");
  });

  it("redacts sensitive Zod validation details before returning them", async () => {
    const parsed = z
      .object({
        token: z.string().min(64, "token reset-token-for-founder@example.test is too short"),
        title: z.string().min(3, "title is too short for founder@example.test")
      })
      .safeParse({
        token: "short-token",
        title: "x"
      });

    expect(parsed.success).toBe(false);

    if (parsed.success) throw new Error("Expected validation to fail.");

    const response = handleApiError(parsed.error);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(422);
    expect(body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fieldErrors: {
            title: ["title is too short for [redacted email]"],
            token: "[redacted]"
          }
        },
        message: "The request payload is invalid."
      }
    });
    expect(serialized).not.toContain("short-token");
    expect(serialized).not.toContain("reset-token-for-founder");
    expect(serialized).not.toContain("founder@example.test");
  });
});
