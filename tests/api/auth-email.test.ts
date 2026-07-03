import { describe, expect, it } from "vitest";

import {
  isPasswordResetEmailConfigured,
  passwordResetEmailReadiness,
  sendPasswordResetEmail,
  sendWorkspaceInvitationEmail,
  workspaceInvitationEmailReadiness
} from "@/lib/email/auth-email";
import { validateRuntimeEnv } from "@/lib/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const authEmailSource = readFileSync(join(process.cwd(), "lib/email/auth-email.ts"), "utf8");

describe("auth email sender boundary", () => {
  it("treats password reset email as configured with Resend or webhook delivery", () => {
    expect(isPasswordResetEmailConfigured({ NODE_ENV: "production" })).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "https://crm.example.test",
        RESEND_API_KEY: "resend-key"
      })
    ).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
        RESEND_API_KEY: "resend-key"
      })
    ).toBe(true);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email"
      })
    ).toBe(true);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://preview:secret@mail.example.test/auth-email"
      })
    ).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email"
      })
    ).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "http://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "https://localhost:3000",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toBe(false);
    expect(
      isPasswordResetEmailConfigured({
        APP_BASE_URL: "http://localhost:3000",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "test"
      })
    ).toBe(true);
  });

  it("reports password reset readiness with env names only and an explicit worker requirement", () => {
    expect(passwordResetEmailReadiness({ NODE_ENV: "production" })).toEqual({
      configured: false,
      deliveryMethod: "none",
      missingEnvNames: ["APP_BASE_URL", "RESEND_API_KEY", "AUTH_EMAIL_FROM", "AUTH_EMAIL_WEBHOOK_URL"],
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
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email"
      })
    ).toEqual({
      configured: true,
      deliveryMethod: "webhook",
      missingEnvNames: [],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(passwordResetEmailReadiness({ AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email" })).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://preview:secret@mail.example.test/auth-email"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["AUTH_EMAIL_WEBHOOK_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://0.0.0.0:3000",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://192.168.1.10",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://[::ffff:192.168.1.10]",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    for (const appBaseUrl of ["https://[::192.168.1.10]", "https://[64:ff9b::192.168.1.10]"]) {
      expect(
        passwordResetEmailReadiness({
          APP_BASE_URL: appBaseUrl,
          AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
          NODE_ENV: "production"
        })
      ).toEqual({
        configured: false,
        deliveryMethod: "webhook",
        missingEnvNames: ["APP_BASE_URL"],
        optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
        workerRequired: true
      });
    }
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://preview:secret@crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://2130706433",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://0x7f.0.0.1",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(
      passwordResetEmailReadiness({
        APP_BASE_URL: "https://0300.0250.0001.0012",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      configured: false,
      deliveryMethod: "webhook",
      missingEnvNames: ["APP_BASE_URL"],
      optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
      workerRequired: true
    });
    expect(passwordResetEmailReadiness({ RESEND_API_KEY: "resend-key" })).toEqual({
      configured: false,
      deliveryMethod: "none",
      missingEnvNames: ["APP_BASE_URL", "AUTH_EMAIL_FROM"],
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
      errors: [
        "APP_BASE_URL must use https: in production when AUTH_EMAIL_WEBHOOK_URL is set.",
        "APP_BASE_URL must be a public https URL in production when auth email delivery is configured."
      ]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "https://localhost:3000",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must be a public https URL in production when auth email delivery is configured."]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "https://0.0.0.0:3000",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must be a public https URL in production when auth email delivery is configured."]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "https://10.0.0.5",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must be a public https URL in production when auth email delivery is configured."]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "https://preview:secret@crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must not include username or password credentials."]
    });
    for (const appBaseUrl of [
      "https://[::192.168.1.10]",
      "https://[64:ff9b::192.168.1.10]",
      "https://2130706433",
      "https://0x7f.0.0.1",
      "https://0300.0250.0001.0012"
    ]) {
      expect(
        validateRuntimeEnv({
          APP_BASE_URL: appBaseUrl,
          AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
          DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
          NODE_ENV: "production"
        })
      ).toEqual({
        ok: false,
        errors: ["APP_BASE_URL must be a public https URL in production when auth email delivery is configured."]
      });
    }
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
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://preview:secret@mail.example.test/auth-email",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_EMAIL_WEBHOOK_URL must not include username or password credentials."]
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
      errors: [
        "APP_BASE_URL must use https: in production when RESEND_API_KEY is set.",
        "APP_BASE_URL must be a public https URL in production when auth email delivery is configured."
      ]
    });
    expect(
      validateRuntimeEnv({
        APP_BASE_URL: "https://127.0.0.1:3000",
        AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production",
        RESEND_API_KEY: "resend-key"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must be a public https URL in production when auth email delivery is configured."]
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

  it("sends workspace invitation emails directly through Resend when configured", async () => {
    expect(
      workspaceInvitationEmailReadiness({
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
        RESEND_API_KEY: "resend-key"
      }).configured
    ).toBe(true);
    const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
    await sendWorkspaceInvitationEmail(
      {
        invitationUrl: "https://crm.example.test/workspaces/invitations/invitation_1",
        invitedRoleLabel: "Admin",
        inviterEmail: "owner@example.test",
        inviterName: "Owner User",
        to: "teammate@example.test",
        workspaceName: "Acme Workspace"
      },
      {
        env: {
          AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
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
          to: "teammate@example.test",
          subject: "You're invited to Acme Workspace on Northstar CRM",
          text: expect.stringContaining("https://crm.example.test/workspaces/invitations/invitation_1"),
          html: expect.stringContaining("https://crm.example.test/workspaces/invitations/invitation_1")
        },
        headers: expect.any(Headers),
        url: "https://api.resend.com/emails"
      }
    ]);
    const body = requests[0].body as { html: string; text: string };
    expect(body.text).toContain("Owner User (owner@example.test) invited you");
    expect(body.text).toContain("Invited role: Admin.");
    expect(body.html).toContain("Accept workspace invitation");
    expect(requests[0].headers.get("authorization")).toBe("Bearer resend-key");
  });

  it("posts password-reset auth email payloads to the configured webhook", async () => {
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

  it("posts workspace invitation payloads to the configured webhook", async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
    await sendWorkspaceInvitationEmail(
      {
        invitationUrl: "https://crm.example.test/workspaces/invitations/invitation_1",
        invitedRoleLabel: "Member",
        inviterEmail: "owner@example.test",
        to: "teammate@example.test",
        workspaceName: "Acme Workspace"
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
          type: "workspace_invitation",
          to: "teammate@example.test",
          from: "Northstar CRM <no-reply@example.test>",
          workspaceName: "Acme Workspace",
          invitedRoleLabel: "Member",
          inviterEmail: "owner@example.test",
          invitationUrl: "https://crm.example.test/workspaces/invitations/invitation_1"
        },
        headers: expect.any(Headers),
        url: "https://mail.example.test/auth-email"
      }
    ]);
    expect(requests[0].headers.get("authorization")).toBe("Bearer webhook-token");
  });

  it("rejects password-reset webhook URLs with embedded credentials before delivery", async () => {
    const requests: unknown[] = [];
    await expect(
      sendPasswordResetEmail(
        {
          expiresAt: new Date("2030-01-01T00:30:00.000Z"),
          resetUrl: "https://crm.example.test/reset-password?token=reset-token",
          to: "alex@example.test"
        },
        {
          env: {
            AUTH_EMAIL_WEBHOOK_URL: "https://preview:secret@mail.example.test/auth-email"
          },
          fetchImpl: (async (...args) => {
            requests.push(args);
            return new Response(null, { status: 202 });
          }) as typeof fetch
        }
      )
    ).rejects.toThrow("Password reset email webhook URL is invalid.");

    expect(requests).toEqual([]);
  });

  it("rejects malformed direct password-reset email inputs before provider delivery", async () => {
    const requests: unknown[] = [];
    const fetchImpl = (async (...args) => {
      requests.push(args);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const env = {
      AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
      RESEND_API_KEY: "resend-key"
    };

    await expect(
      sendPasswordResetEmail(
        {
          expiresAt: new Date("2030-01-01T00:30:00.000Z"),
          resetUrl: "https://crm.example.test/reset-password?token=reset-token",
          to: { email: "alex@example.test" }
        },
        { env, fetchImpl }
      )
    ).rejects.toThrow("Invalid password reset email input.");
    await expect(
      sendPasswordResetEmail(
        {
          expiresAt: new Date("2030-01-01T00:30:00.000Z"),
          resetUrl: "https://crm.example.test/reset-password",
          to: "alex@example.test"
        },
        { env, fetchImpl }
      )
    ).rejects.toThrow("Invalid password reset email input.");
    await expect(
      sendPasswordResetEmail(
        {
          expiresAt: new Date("2030-01-01T00:30:00.000Z"),
          resetUrl: "https://preview:secret@crm.example.test/reset-password?token=reset-token",
          to: "alex@example.test"
        },
        { env, fetchImpl }
      )
    ).rejects.toThrow("Invalid password reset email input.");
    await expect(
      sendPasswordResetEmail(
        {
          expiresAt: new Date("not-a-date"),
          resetUrl: "https://crm.example.test/reset-password?token=reset-token",
          to: "alex@example.test"
        },
        { env, fetchImpl }
      )
    ).rejects.toThrow("Invalid password reset email input.");

    expect(requests).toEqual([]);
    expect(authEmailSource).toContain("normalizePasswordResetEmailInput(input)");
    expect(authEmailSource).toContain("Invalid password reset email input.");
  });

  it("rejects malformed direct workspace-invitation email inputs before provider delivery", async () => {
    const requests: unknown[] = [];
    const fetchImpl = (async (...args) => {
      requests.push(args);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    const env = {
      AUTH_EMAIL_FROM: "Northstar <onboarding@resend.dev>",
      RESEND_API_KEY: "resend-key"
    };

    await expect(
      sendWorkspaceInvitationEmail(
        {
          invitationUrl: "https://crm.example.test/settings",
          invitedRoleLabel: "Member",
          to: "teammate@example.test",
          workspaceName: "Acme Workspace"
        },
        { env, fetchImpl }
      )
    ).rejects.toThrow("Invalid workspace invitation email input.");
    await expect(
      sendWorkspaceInvitationEmail(
        {
          invitationUrl: "https://preview:secret@crm.example.test/workspaces/invitations/invitation_1",
          invitedRoleLabel: "Member",
          to: "teammate@example.test",
          workspaceName: "Acme Workspace"
        },
        { env, fetchImpl }
      )
    ).rejects.toThrow("Invalid workspace invitation email input.");

    expect(requests).toEqual([]);
  });
});
