import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { requireRuntimeEnv, validateRuntimeEnv } from "@/lib/env";

const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const packageManifest = JSON.parse(packageJson) as Record<string, unknown>;
const packageScripts = (packageManifest.scripts ?? {}) as Record<string, string>;
const eslintConfig = readFileSync(join(process.cwd(), "eslint.config.mjs"), "utf8");
const nextConfig = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");
const playwrightConfig = readFileSync(join(process.cwd(), "playwright.config.ts"), "utf8");
const prismaConfig = readFileSync(join(process.cwd(), "prisma.config.ts"), "utf8");
const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
const readinessDoc = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");
const browserSmokeDoc = readFileSync(join(process.cwd(), "docs/browser-smoke-qa.md"), "utf8");
const stakeholderDemoRunbook = readFileSync(join(process.cwd(), "docs/stakeholder-demo-runbook.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const prismaClient = readFileSync(join(process.cwd(), "lib/db/prisma.ts"), "utf8");
const healthRoute = readFileSync(join(process.cwd(), "app/api/health/route.ts"), "utf8");
const accountActions = readFileSync(join(process.cwd(), "app/settings/account-actions.ts"), "utf8");
const workspaceActions = readFileSync(join(process.cwd(), "app/workspaces/actions.ts"), "utf8");
const signupActions = readFileSync(join(process.cwd(), "app/signup/actions.ts"), "utf8");
const loginActions = readFileSync(join(process.cwd(), "app/login/actions.ts"), "utf8");
const resetPasswordActions = readFileSync(join(process.cwd(), "app/reset-password/actions.ts"), "utf8");
const reportsActions = readFileSync(join(process.cwd(), "app/reports/actions.ts"), "utf8");
const workspaceInvitationPage = readFileSync(join(process.cwd(), "app/workspaces/invitations/[invitationId]/page.tsx"), "utf8");

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
        "Auth email delivery is disabled; set RESEND_API_KEY and AUTH_EMAIL_FROM, or AUTH_EMAIL_WEBHOOK_URL."
      ],
      env: {
        databaseUrl: "postgresql://crm:crm@localhost:5432/crm_mvp",
        appBaseUrl: undefined,
        authEmailFrom: undefined,
        authEmailWebhookToken: undefined,
        authEmailWebhookUrl: undefined,
        resendApiKey: undefined,
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
        APP_BASE_URL: "https://preview:secret@crm.example.test",
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp"
      })
    ).toEqual({
      ok: false,
      errors: ["APP_BASE_URL must not include username or password credentials."]
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
        MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND: "s3",
        MEETING_INTELLIGENCE_S3_ENDPOINT: "https://s3.example.test"
      })
    ).toEqual({
      ok: false,
      errors: ["Meeting Intelligence S3 storage requires endpoint, region, bucket, access key id, and secret access key."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND: "local",
        MEETING_INTELLIGENCE_S3_BUCKET: "northstar-mi"
      })
    ).toEqual({
      ok: false,
      errors: ["MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND must be s3 when Meeting Intelligence S3 storage env vars are set."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND: "s3",
        MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID: "access",
        MEETING_INTELLIGENCE_S3_BUCKET: "northstar-mi",
        MEETING_INTELLIGENCE_S3_ENDPOINT: "not-a-url",
        MEETING_INTELLIGENCE_S3_REGION: "auto",
        MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY: "secret"
      })
    ).toEqual({
      ok: false,
      errors: ["MEETING_INTELLIGENCE_S3_ENDPOINT must be a valid URL."]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "http://crm.example.test/api/email-connections/google/callback",
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
        MICROSOFT_OAUTH_REDIRECT_URI: "http://crm.example.test/api/email-connections/microsoft/callback",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: [
        "GOOGLE_OAUTH_REDIRECT_URI must use https: in production.",
        "MICROSOFT_OAUTH_REDIRECT_URI must use https: in production."
      ]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        EMAIL_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://preview:secret@crm.example.test/api/email-connections/google/callback",
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
        MICROSOFT_OAUTH_REDIRECT_URI: "https://preview:secret@crm.example.test/api/email-connections/microsoft/callback"
      })
    ).toEqual({
      ok: false,
      errors: [
        "GOOGLE_OAUTH_REDIRECT_URI must not include username or password credentials.",
        "MICROSOFT_OAUTH_REDIRECT_URI must not include username or password credentials."
      ]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        EMAIL_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "https://localhost:3000/api/email-connections/google/callback",
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
        MICROSOFT_OAUTH_REDIRECT_URI: "https://192.168.1.10/api/email-connections/microsoft/callback",
        NODE_ENV: "production"
      })
    ).toEqual({
      ok: false,
      errors: [
        "GOOGLE_OAUTH_REDIRECT_URI must be a public https URL in production.",
        "MICROSOFT_OAUTH_REDIRECT_URI must be a public https URL in production."
      ]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        EMAIL_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/email-connections/google/callback",
        NODE_ENV: "production"
      })
    ).toMatchObject({
      ok: true,
      warnings: [
        "AUTH_MODE is not set; production runtime defaults to trusted-header and should set AUTH_USER_ID_HEADER explicitly.",
        "Auth email delivery is disabled; set RESEND_API_KEY and AUTH_EMAIL_FROM, or AUTH_EMAIL_WEBHOOK_URL."
      ]
    });
    expect(
      validateRuntimeEnv({
        DATABASE_URL: "postgresql://crm:crm@localhost:5432/crm_mvp",
        EMAIL_TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
        GOOGLE_OAUTH_CLIENT_ID: "google-client",
        GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
        GOOGLE_OAUTH_REDIRECT_URI: "http://localhost:3000/api/email-connections/google/callback",
        MICROSOFT_OAUTH_CLIENT_ID: "microsoft-client",
        MICROSOFT_OAUTH_CLIENT_SECRET: "microsoft-secret",
        MICROSOFT_OAUTH_REDIRECT_URI: "http://localhost:3000/api/email-connections/microsoft/callback",
        NODE_ENV: "development"
      })
    ).toMatchObject({ ok: true, warnings: [] });
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
        resendApiKey: undefined,
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
    expect(healthRoute).toContain("runtime = \"nodejs\"");
    expect(healthRoute).toContain("service: \"northstar-crm\"");
    expect(healthRoute).not.toContain("DATABASE_URL");
    expect(routeMap).toContain("GET /api/health");
    expect(routeMap).toContain("Does not expose environment values");
  });

  it("redacts sensitive ApiError text before returning it to action-driven UI", () => {
    const actionSources = [
      accountActions,
      workspaceActions,
      signupActions,
      loginActions,
      resetPasswordActions,
      reportsActions,
      workspaceInvitationPage
    ];

    for (const source of actionSources) {
      expect(source).toContain("redactSensitiveText");
    }
    expect(accountActions).toContain("error: redactSensitiveText(error.message)");
    expect(workspaceActions).toContain("error: redactSensitiveText(error.message)");
    expect(signupActions).toContain("error: redactSensitiveText(error.message)");
    expect(loginActions).toContain("error instanceof ApiError ? redactSensitiveText(error.message)");
    expect(resetPasswordActions).toContain("error instanceof ApiError ? redactSensitiveText(error.message)");
    expect(reportsActions).toContain("error instanceof ApiError ? redactSensitiveText(error.message)");
    expect(workspaceInvitationPage).toContain("return { error: redactSensitiveText(error.message) }");
  });

  it("documents deployment flow and exposes a production migration script", () => {
    expect(packageJson).toContain("\"prisma:deploy\": \"prisma migrate deploy\"");
    expect(packageJson).toContain("\"typecheck\": \"tsc --noEmit --incremental false\"");
    expect(packageScripts.prisma).toBe("prisma validate");
    expect(packageScripts["prisma:validate"]).toBe("prisma validate");
    expect(packageManifest).not.toHaveProperty("prisma");
    expect(eslintConfig).toContain("\"playwright-report/**\"");
    expect(eslintConfig).toContain("\"test-results/**\"");
    expect(nextConfig).toContain("parallelServerCompiles: false");
    expect(prismaConfig).toContain("defineConfig");
    expect(prismaConfig).toContain("migrations");
    expect(prismaConfig).toContain("seed: \"tsx prisma/seed.ts\"");
    expect(envExample).toContain("DATABASE_URL=");
    expect(envExample).toContain("APP_BASE_URL=");
    expect(envExample).toContain("RAILWAY_SERVICE_ROLE=");
    expect(envExample).toContain("AUTH_MODE=");
    expect(envExample).toContain("AUTH_USER_ID_HEADER=");
    expect(envExample).toContain("AUTH_SESSION_SECRET=");
    expect(envExample).toContain("AUTH_EMAIL_WEBHOOK_URL=");
    expect(envExample).toContain("AUTH_EMAIL_WEBHOOK_TOKEN=");
    expect(envExample).toContain("AUTH_EMAIL_FROM=");
    expect(envExample).toContain("RESEND_API_KEY=");
    expect(envExample).toContain("GOOGLE_OAUTH_CLIENT_ID=");
    expect(envExample).toContain("MICROSOFT_OAUTH_CLIENT_ID=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_MEDIA_PROVIDER=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_S3_ENDPOINT=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_S3_REGION=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_S3_BUCKET=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE=");
    expect(envExample).toContain("OPENAI_API_KEY=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_OPENAI_VISION_MODEL=");
    expect(envExample).toContain("MEETING_INTELLIGENCE_OPENAI_TRANSCRIPTION_MODEL=");
    expect(envExample).toContain("EMAIL_TOKEN_ENCRYPTION_KEY=");
    expect(readinessDoc).toContain("Required Environment");
    expect(readinessDoc).toContain("Production Local-Auth Checklist");
    expect(readinessDoc).toContain("Set `NODE_ENV=production`.");
    expect(readinessDoc).toContain("Set `AUTH_MODE=local`.");
    expect(readinessDoc).toContain("Set `RESEND_API_KEY` and `AUTH_EMAIL_FROM` for direct Resend delivery");
    expect(readinessDoc).toContain("or set `AUTH_EMAIL_WEBHOOK_URL` to a provider-neutral `https` webhook endpoint");
    expect(readinessDoc).toContain("set this to the app's absolute `/api/internal/meeting-intelligence/media-extract` URL");
    expect(readinessDoc).toContain("Set to `openai` to use Northstar's first-party OpenAI media extraction adapter.");
    expect(readinessDoc).toContain("required by the internal OpenAI media extraction route");
    expect(readinessDoc).toContain("Webhook URLs must not include embedded username/password credentials");
    expect(readinessDoc).toContain("OAuth redirect URIs must use public `https` callback hosts in production");
    expect(readinessDoc).toContain("must not include embedded username/password credentials");
    expect(readinessDoc).toContain("If unset or if it includes embedded username/password credentials, the app shows relative `/q/:token` quote links");
    expect(readme).toContain("MICROSOFT_CLIENT_ID");
    expect(readme).toContain("MICROSOFT_CLIENT_SECRET");
    expect(readme).toContain("MICROSOFT_REDIRECT_URI");
    expect(readinessDoc).toContain("Railway Auth Email Worker");
    expect(readinessDoc).toContain("A minimal Railway deployment configuration is included for hosted preview use.");
    expect(readinessDoc).toContain("Other hosting providers still need their own service, database, migration, worker, and secret-management setup.");
    expect(readinessDoc).not.toContain("No hosting-provider-specific deployment configuration is included.");
    expect(readinessDoc).toContain("Set `RAILWAY_SERVICE_ROLE=worker` on the worker service.");
    expect(readinessDoc).toContain("npm run railway:start");
    expect(readinessDoc).toContain("Without a worker or scheduled one-off job run, queued auth email jobs stay queued");
    expect(readinessDoc).toContain("when `APP_BASE_URL` can build an absolute reset URL from a public HTTPS origin");
    expect(readinessDoc).toContain("public HTTPS app URL");
    expect(readinessDoc).toContain("auth email delivery is reported as disabled unless `APP_BASE_URL` is configured");
    expect(readinessDoc).toContain("queues an `auth.password_reset_email` job");
    expect(readinessDoc).toContain("npm run jobs:run-once");
    expect(readinessDoc).toContain("npm run prisma:deploy");
    expect(readinessDoc).toContain("npm run build");
    expect(readinessDoc).toContain("`npm run prisma` is kept as a short alias for `npm run prisma:validate`");
    expect(readinessDoc).toContain("Run `npm run typecheck` and `npm run build` serially.");
    expect(readinessDoc).toContain("next build` can regenerate that directory");
    expect(readinessDoc).toContain("incremental cache disabled");
    expect(browserSmokeDoc).toContain("disables TypeScript incremental cache reads");
    expect(readme).toContain("## Quality Checks");
    const qualityChecksSection = readme.split("## Quality Checks")[1]?.split("## Integration Tests")[0] ?? "";
    expect(qualityChecksSection.match(/```bash/g) ?? []).toHaveLength(1);
    expect(qualityChecksSection.match(/```/g) ?? []).toHaveLength(2);
    for (const command of [
      "npm run prisma:validate",
      "npm run prisma:deploy",
      "npm run typecheck",
      "npm run lint",
      "npm run test",
      "npm run test:integration",
      "npm run build",
      "npm run test:browser",
      "git diff --check"
    ]) {
      expect(readme).toContain(command);
    }
    expect(readme).toContain("`npm run prisma` is kept as a short alias for `npm run prisma:validate`");
    expect(readme).toContain("Run these checks serially when they share the same workspace.");
    expect(readme).toContain("The `test:browser` script starts `next start` on port `3100`");
    expect(readme).toContain("They require:");
    expect(readme).toContain("TEST_DATABASE_URL");
    expect(readme).toContain("The URL must not contain obvious production, staging, or live environment markers.");
    expect(readme).toContain("must not point at the same database/schema as `DATABASE_URL`");
    expect(readme).toContain("resets app tables in that database once at suite startup while preserving `_prisma_migrations`");
    expect(readme).toContain("Never point `TEST_DATABASE_URL` at dev, staging, or production data.");
    expect(readme).toContain("failed or interrupted integration runs cannot leave global jobs");
    expect(readinessDoc).toContain("GET /api/health");
    expect(readinessDoc).toContain("Prisma configuration lives in `prisma.config.ts`");
    expect(readinessDoc).toContain("Do not commit real secrets");
    expect(browserSmokeDoc).toContain("AUTH_MODE=local AUTH_SESSION_SECRET=browser-smoke-session-secret-32-chars-minimum npm run start");
    expect(browserSmokeDoc).toContain("PLAYWRIGHT_REUSE_SERVER=1 npm run test:browser -- --project=chromium");
    expect(browserSmokeDoc).toContain("starts a local `next start` server on port `3100`");
    expect(browserSmokeDoc).toContain("Deals, Contacts, Organizations, Leads, Activities, Products, and Quotes CSV exports");
    expect(browserSmokeDoc).toContain("Authenticated quote detail, quote print, authenticated quote PDF, and public quote routes");
    expect(browserSmokeDoc).toContain("log email context, convert it into a deal");
    expect(browserSmokeDoc).toContain("/settings/developer-api");
    expect(browserSmokeDoc).not.toContain("starts a local Next.js dev server on port `3100`");
    expect(browserSmokeDoc).not.toContain("AUTH_MODE=demo npm run start");
    expect(playwrightConfig).toContain("PLAYWRIGHT_WEB_SERVER_COMMAND");
    expect(playwrightConfig).toContain("\"npm run start -- --hostname 127.0.0.1 --port 3100\"");
    expect(playwrightConfig).toContain("PLAYWRIGHT_REUSE_SERVER");
    expect(playwrightConfig).toContain("PLAYWRIGHT_INCLUDE_ASSISTANT_BROWSER");
    expect(playwrightConfig).toContain("[\"**/assistant.spec.ts\"]");
    expect(currentStatus).toContain("Runtime environment validation");
    expect(currentStatus).toContain("minimal Railway preview configuration");
    expect(architecture).toContain("lib/env.ts");
    expect(architecture).toContain("minimal Railway preview configuration");
  });

  it("documents a production-safe stakeholder demo path without fake UI data", () => {
    for (const phrase of [
      "This runbook is the polished end-to-end path",
      "not production customer data",
      "npm run prisma:deploy",
      "npm run prisma:seed",
      "AUTH_MODE=local",
      "alex@example.test",
      "New lead enters the CRM",
      "Lead converts safely",
      "Meeting transcript is analyzed",
      "Correct one association inline before apply",
      "Contact and organization field changes must remain CRM Change Proposals",
      "Assistant summarizes next actions",
      "Relevant email is reviewed",
      "Quote is created from the deal",
      "Public quote is accepted",
      "Accepted quote updates the deal safely",
      "Follow-up work is visible and completable",
      "Dashboard and reporting reflect the state",
      "RAILWAY_SERVICE_ROLE=worker",
      "Do not seed a real-use production database",
      "Do not present AI inference as confirmed fact",
      "git diff --check"
    ]) {
      expect(stakeholderDemoRunbook).toContain(phrase);
    }
    expect(stakeholderDemoRunbook).not.toContain("fake UI-only data");
    expect(stakeholderDemoRunbook).toContain("The browser smoke lane already covers key pieces of this story");
  });
});
