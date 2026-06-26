import { describe, expect, it } from "vitest";

import { isPasswordResetEmailConfigured, passwordResetEmailReadiness, sendPasswordResetEmail } from "@/lib/email/auth-email";
import { validateRuntimeEnv } from "@/lib/env";

describe("auth email sender boundary", () => {
  it("treats password reset email as configured with Resend or webhook delivery", () => {
    expect(isPasswordResetEmailConfigured({ NODE_ENV: "production" })).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        RESEND_API_KEY: "resend-key"
      })
    ).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
        RESEND_API_KEY: "resend-key"
      })
    ).toBe(true);
    expect(
      isPasswordResetEmailConfigured({
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email"
      })
    ).toBe(true);
  });

  it("reports password reset readiness with env names only and an explicit worker requirement", () => {
    expect(passwordResetEmailReadiness({ NODE_ENV: "production" })).toEqual({
      configured: false,
      deliveryMethod: "none",
      missingEnvNames: ["RESEND_API_KEY", "AUTH_EMAIL_FROM", "AUTH_EMAIL_WEBHOOK_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
        RESEND_API_KEY: "resend-key"
      })
    ).toEqual({
      configured: true,
      deliveryMethod: "resend",
      missingEnvNames: [],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(passwordResetEmailReadiness({ AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email" })).toEqual({
      configured: true,
      deliveryMethod: "webhook",
      missingEnvNames: [],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
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
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        RESEND_API_KEY: "resend-key"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_EMAIL_FROM is required when RESEND_API_KEY is set.", "APP_BASE_URL is required when RESEND_API_KEY is set."]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "http://crm.example.test",
        AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production",
        RESEND_API_KEY: "resend-key"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must use https: in production when RESEND_API_KEY is set."]
    });
  });

  it("sends password reset emails directly through Resend when configured", async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
    await sendPasswordResetEmail(
      {
        expiresAt: new Date("2030-01-01T00:30:00.000Z"),
        resetUrl: "https://crm.example.test/reset-password?token=reset-token",
        to: "alex@example.test"
      },
      {
        env: {
          AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
          AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
          RESEND_API_KEY: "resend-key"
        },
        fetchImpl: (async (url, init) => {
          requests.push({
            body: JSON.parse(String(init?.body)),
            headers: new Headers(init?.headers),
            url: String(url)
          });
          return new Response(JSON.stringify({ id: "email-id" }), { status: 200 });
        }) as typeof fetch
      }
    );

    expect(requests).toEqual([
      {
        body: {
          from: "Northstar <onboarding@resend.dev>",
          to: "alex@example.test",
          subject: "Reset your Northstar CRM password",
          text: expect.stringContaining("https://crm.example.test/reset-password?token=reset-token"),
          html: expect.stringContaining("https://crm.example.test/reset-password?token=reset-token")
        },
        headers: expect.any(Headers),
        url: "https://api.resend.com/emails"
      }
    ]);
    expect(requests[0].headers.get("authorization")).toBe("Bearer resend-key");
    expect(requests[0].headers.get("content-type")).toBe("application/json");
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
