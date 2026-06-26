import { describe, expect, it } from "vitest";

import { isPasswordResetEmailConfigured, sendPasswordResetEmail } from "@/lib/email/auth-email";
import { validateRuntimeEnv } from "@/lib/env";

describe("auth email sender boundary", () => {
  it("treats password reset email as configured only with webhook URL and app base URL", () => {
    expect(isPasswordResetEmailConfigured({ NODE_ENV: "production" })).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email"
      })
    ).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email"
      })
    ).toBe(true);
  });

  it("rejects unsafe production reset-email URL configuration through runtime readiness", () => {
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL is required when AUTH_EMAIL_WEBHOOK_URL is set."]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "http://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must use https: in production when AUTH_EMAIL_WEBHOOK_URL is set."]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "http://mail.example.test/auth-email",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_EMAIL_WEBHOOK_URL must use https: in production."]
    });
  });

  it("posts only password-reset auth email payloads to the configured webhook", async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
    await sendPasswordResetEmail(
      {
        expiresAt: new Date("2030-01-01T00:30:00.000Z"),
        resetUrl: "https://crm.example.test/reset-password?token=reset-token",
        to: "alex@example.test"
      },
      {
        env: {
          AUTH_EMAIL_FROM: "Northstar CRM <no-reply@example.test>",
          AUTH_EMAIL_WEBHOOK_TOKEN: "webhook-token",
          AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email"
        },
        fetchImpl: (async (url, init) => {
          requests.push({
            body: JSON.parse(String(init?.body)),
            headers: new Headers(init?.headers),
            url: String(url)
          });
          return new Response(null, { status: 202 });
        }) as typeof fetch
      }
    );

    expect(requests).toEqual([
      {
        body: {
          type: "password_reset",
          to: "alex@example.test",
          from: "Northstar CRM <no-reply@example.test>",
          resetUrl: "https://crm.example.test/reset-password?token=reset-token",
          expiresAt: "2030-01-01T00:30:00.000Z"
        },
        headers: expect.any(Headers),
        url: "https://mail.example.test/auth-email"
      }
    ]);
    expect(requests[0].headers.get("authorization")).toBe("Bearer webhook-token");
    expect(requests[0].headers.get("content-type")).toBe("application/json");
  });
});
