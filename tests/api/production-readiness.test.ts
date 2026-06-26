import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { requireRuntimeEnv, validateRuntimeEnv } from "@/lib/env";

const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const packageManifest = JSON.parse(packageJson) as Record<string, unknown>;
const prismaConfig = readFileSync(join(process.cwd(), "prisma.config.ts"), "utf8");
const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
const readinessDoc = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const prismaClient = readFileSync(join(process.cwd(), "lib/db/prisma.ts"), "utf8");
const healthRoute = readFileSync(join(process.cwd(), "app/api/health/route.ts"), "utf8");

describe("production readiness foundation", () => {
  it("validates runtime environment without exposing secret values", () => {
    expect(validateRuntimeEnv({}).ok).toBe(false);
    expect(validateRuntimeEnv({ DATABASE_URL: "mysql://example.invalid/db" })).toEqual({
      ok: false,
      errors: ["DATABASE_URL must use one of: postgresql:, postgres:."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        APP_BASE_URL: "not-a-url"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must be a valid URL."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_MODE: " "
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_MODE must not be empty when set."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_MODE: "trusted-header"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_USER_ID_HEADER is required when AUTH_MODE is trusted-header."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: true,
      warnings: [
        "AUTH_MODE is not set; production runtime defaults to trusted-header and should set AUTH_USER_ID_HEADER explicitly.",
        "AUTH_EMAIL_WEBHOOK_URL is not set; password reset email delivery is disabled."
      ],
      env: {
        databaseUrl: "postgresql://crm:crm@localhost:5432/crm_mvp",
        appBaseUrl: undefined,
        authEmailFrom: undefined,
        authEmailWebhookToken: undefined,
        authEmailWebhookUrl: undefined,
        devActorEmail: undefined,
        devWorkspaceSlug: undefined,
        authMode: undefined,
        authUserIdHeader: undefined,
        authSessionSecret: undefined,
        emailTokenEncryptionKey: undefined,
        googleOauthClientId: undefined,
        googleOauthClientSecret: undefined,
        googleOauthRedirectUri: undefined,
        microsoftOauthClientId: undefined,
        microsoftOauthClientSecret: undefined,
        microsoftOauthRedirectUri: undefined,
        microsoftOauthTenantId: undefined
      }
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_EMAIL_WEBHOOK_URL: "not-a-url"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_EMAIL_WEBHOOK_URL must be a valid URL."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_EMAIL_WEBHOOK_URL: "http://mail.example.test/auth-email",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: [
        "APP_BASE_URL is required when AUTH_EMAIL_WEBHOOK_URL is set.",
        "AUTH_EMAIL_WEBHOOK_URL must use https: in production."
      ]
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
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_MODE: "trusted-header",
        AUTH_USER_ID_HEADER: "authorization"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_USER_ID_HEADER must be a safe HTTP header name for a trusted user id."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        DEV_ACTOR_EMAIL: "   ",
        DEV_WORKSPACE_SLUG: "",
        AUTH_MODE: "oauth",
        AUTH_USER_ID_HEADER: " "
      })
    ).toEqual({
      ok: false,
      errors: [
        "DEV_ACTOR_EMAIL must not be empty when set.",
        "DEV_WORKSPACE_SLUG must not be empty when set.",
        "AUTH_MODE must be one of: demo, trusted-header, local.",
        "AUTH_USER_ID_HEADER must not be empty when set."
      ]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_MODE: "local"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_SESSION_SECRET is required when AUTH_MODE is local."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        AUTH_MODE: "local",
        AUTH_SESSION_SECRET: "too-short"
      })
    ).toEqual({
      ok: false,
      errors: ["AUTH_SESSION_SECRET must be at least 32 characters."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgres://crm:crm@localhost:5432/crm_mvp",
        APP_BASE_URL: "https://crm.example.test",
        AUTH_MODE: "trusted-header",
        AUTH_USER_ID_HEADER: "x-northstar-user-id"
      })
    ).toMatchObject({ ok: true, warnings: [] });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgres://crm:crm@localhost:5432/crm_mvp",
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        AUTH_MODE: "demo",
        AUTH_USER_ID_HEADER: "x-user-id",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: true,
      warnings: ["AUTH_MODE=demo is intended only for local/demo use and should not be used for production traffic."],
      env: {
        databaseUrl: "postgres://crm:crm@localhost:5432/crm_mvp",
        authMode: "demo",
        authUserIdHeader: "x-user-id",
        authSessionSecret: undefined,
        appBaseUrl: "https://crm.example.test",
        authEmailFrom: undefined,
        authEmailWebhookToken: undefined,
        authEmailWebhookUrl: "https://mail.example.test/auth-email",
        devActorEmail: undefined,
        devWorkspaceSlug: undefined,
        emailTokenEncryptionKey: undefined,
        googleOauthClientId: undefined,
        googleOauthClientSecret: undefined,
        googleOauthRedirectUri: undefined,
        microsoftOauthClientId: undefined,
        microsoftOauthClientSecret: undefined,
        microsoftOauthRedirectUri: undefined,
        microsoftOauthTenantId: undefined
      }
    });
    expect(() => requireRuntimeEnv({})).toThrow("Invalid runtime environment");
  });

  it("wires env validation and a non-sensitive health route", () => {
    expect(prismaClient).toContain("requireRuntimeEnv()");
    expect(healthRoute).toContain("validateRuntimeEnv()");
    expect(healthRoute).toContain("await import(\"@/lib/db/prisma\")");
    expect(healthRoute).toContain("SELECT 1");
    expect(healthRoute).toContain("service: \"northstar-crm\"");
    expect(healthRoute).not.toContain("DATABASE_URL");
    expect(routeMap).toContain("GET /api/health");
    expect(routeMap).toContain("Does not expose environment values");
  });

  it("documents deployment flow and exposes a production migration script", () => {
    expect(packageJson).toContain("\"prisma:deploy\": \"prisma migrate deploy\"");
    expect(packageManifest).not.toHaveProperty("prisma");
    expect(prismaConfig).toContain("defineConfig");
    expect(prismaConfig).toContain("migrations");
    expect(prismaConfig).toContain("seed: \"tsx prisma/seed.ts\"");
    expect(envExample).toContain("DATABASE_URL=");
    expect(envExample).toContain("APP_BASE_URL=");
    expect(envExample).toContain("AUTH_MODE=");
    expect(envExample).toContain("AUTH_USER_ID_HEADER=");
    expect(envExample).toContain("AUTH_SESSION_SECRET=");
    expect(envExample).toContain("AUTH_EMAIL_WEBHOOK_URL=");
    expect(envExample).toContain("AUTH_EMAIL_WEBHOOK_TOKEN=");
    expect(envExample).toContain("AUTH_EMAIL_FROM=");
    expect(envExample).toContain("GOOGLE_OAUTH_CLIENT_ID=");
    expect(envExample).toContain("MICROSOFT_OAUTH_CLIENT_ID=");
    expect(envExample).toContain("EMAIL_TOKEN_ENCRYPTION_KEY=");
    expect(readinessDoc).toContain("Required Environment");
    expect(readinessDoc).toContain("Production Local-Auth Checklist");
    expect(readinessDoc).toContain("Set `NODE_ENV=production`.");
    expect(readinessDoc).toContain("Set `AUTH_MODE=local`.");
    expect(readinessDoc).toContain("Set `AUTH_EMAIL_WEBHOOK_URL` to a provider-neutral `https` webhook endpoint");
    expect(readinessDoc).toContain("queues a password-reset-only email job");
    expect(readinessDoc).toContain("npm run jobs:run-once");
    expect(readinessDoc).toContain("npm run prisma:deploy");
    expect(readinessDoc).toContain("npm run build");
    expect(readinessDoc).toContain("GET /api/health");
    expect(readinessDoc).toContain("Prisma configuration lives in `prisma.config.ts`");
    expect(readinessDoc).toContain("Do not commit real secrets");
    expect(currentStatus).toContain("Runtime environment validation");
    expect(architecture).toContain("lib/env.ts");
  });
});
