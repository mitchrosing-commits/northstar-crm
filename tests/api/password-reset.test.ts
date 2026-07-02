import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPasswordResetUrl } from "@/lib/auth/password-reset";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260625030000_password_reset_tokens/migration.sql"),
  "utf8"
);
const passwordReset = readFileSync(join(process.cwd(), "lib/auth/password-reset.ts"), "utf8");
const authEmail = readFileSync(join(process.cwd(), "lib/email/auth-email.ts"), "utf8");
const jobHandlers = readFileSync(join(process.cwd(), "lib/jobs/handlers.ts"), "utf8");
const forgotPage = readFileSync(join(process.cwd(), "app/forgot-password/page.tsx"), "utf8");
const forgotForm = readFileSync(join(process.cwd(), "app/forgot-password/forgot-password-form.tsx"), "utf8");
const forgotActions = readFileSync(join(process.cwd(), "app/forgot-password/actions.ts"), "utf8");
const resetPage = readFileSync(join(process.cwd(), "app/reset-password/page.tsx"), "utf8");
const resetForm = readFileSync(join(process.cwd(), "app/reset-password/reset-password-form.tsx"), "utf8");
const resetActions = readFileSync(join(process.cwd(), "app/reset-password/actions.ts"), "utf8");
const authSubmitButton = readFileSync(join(process.cwd(), "components/auth-submit-button.tsx"), "utf8");
const authTextField = readFileSync(join(process.cwd(), "components/auth-text-field.tsx"), "utf8");
const authPanel = readFileSync(join(process.cwd(), "components/auth-panel.tsx"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("password reset MVP", () => {
  it("adds a hashed password reset token model and migration", () => {
    expect(schema).toContain("model PasswordResetToken");
    expect(schema).toMatch(/passwordResetTokens\s+PasswordResetToken\[\]/);
    expect(schema).toMatch(/tokenHash\s+String\s+@unique/);
    expect(schema).toContain("consumedAt DateTime?");
    expect(schema).toContain("@@index([expiresAt])");
    expect(migration).toContain("CREATE TABLE \"PasswordResetToken\"");
    expect(migration).toContain("CREATE UNIQUE INDEX \"PasswordResetToken_tokenHash_key\"");
    expect(migration).toContain("ON DELETE CASCADE");
  });

  it("keeps raw reset tokens out of storage and exposes links only outside production", () => {
    expect(passwordReset).toContain("hashPasswordResetToken(resetToken)");
    expect(passwordReset).toContain("randomBytes(32).toString(\"base64url\")");
    expect(passwordReset).toContain("canExposeDevelopmentResetToken");
    expect(passwordReset).toContain("env.NODE_ENV !== \"production\"");
    expect(passwordReset).toContain("enqueuePasswordResetEmailJob");
    expect(passwordReset).toContain("buildPasswordResetUrl(resetToken, env)");
    expect(passwordReset).toContain("isPublicHttpsUrl(resetUrl)");
    expect(passwordReset).toContain("normalizePasswordResetEmail(email)");
    expect(passwordReset).toContain("normalizePasswordResetToken(token)");
    expect(passwordReset).toContain("validateResetPassword(password)");
    expect(passwordReset).toContain("isPublicHttpsUrl(resetUrl)");
    expect(passwordReset).not.toContain("data: { resetToken");
    expect(passwordReset).not.toContain("token: resetToken");
    expect(passwordReset).not.toContain("writeAuditLog");
    expect(passwordReset).not.toContain("auditLog");
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://0.0.0.0:3000",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://192.168.1.10",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://10.0.0.5",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://192.0.2.10",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://[fd00::1]",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://[::ffff:192.168.1.10]",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://[::192.168.1.10]",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://[64:ff9b::192.168.1.10]",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://[2001:db8::1]",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://2130706433",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://0x7f.0.0.1",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://0300.0250.0001.0012",
        NODE_ENV: "production"
      })
    ).toBeNull();
    expect(
      buildPasswordResetUrl("reset-token", {
        APP_BASE_URL: "https://crm.example.test",
        NODE_ENV: "production"
      })
    ).toBe("https://crm.example.test/reset-password?token=reset-token");
    expect(
      buildPasswordResetUrl("abc/../settings?x=1", {
        APP_BASE_URL: "https://crm.example.test",
        NODE_ENV: "production"
      })
    ).toBe("https://crm.example.test/reset-password?token=abc%2F..%2Fsettings%3Fx%3D1");
  });

  it("adds a narrow auth email boundary for password reset only", () => {
    expect(authEmail).toContain("sendPasswordResetEmail");
    expect(authEmail).toContain("RESEND_API_KEY");
    expect(authEmail).toContain("https://api.resend.com/emails");
    expect(authEmail).toContain("AUTH_EMAIL_WEBHOOK_URL");
    expect(passwordReset).toContain("APP_BASE_URL");
    expect(authEmail).toContain("type: \"password_reset\"");
    expect(authEmail).toContain("fetchImpl");
    expect(authEmail).not.toContain("EmailLog");
    expect(authEmail).not.toContain("gmail");
    expect(authEmail).not.toContain("outlook");
  });

  it("registers password reset email delivery as an explicit job handler", () => {
    expect(jobHandlers).toContain("auth.password_reset_email");
    expect(jobHandlers).toContain("passwordResetEmailJobType");
    expect(jobHandlers).toContain("sendPasswordResetEmail");
    expect(jobHandlers).toContain("parsePasswordResetEmailJobPayload");
    expect(jobHandlers).not.toContain("payload.type");
    expect(jobHandlers).not.toContain("import(");
  });

  it("wires forgot and reset password pages through server actions", () => {
    expect(passwordReset).toContain("password reset is configured");
    expect(authPanel).toContain("export function AuthPanel");
    expect(forgotPage).toContain("import { AuthPanel } from \"@/components/auth-panel\"");
    expect(forgotPage).toContain("<AuthPanel");
    expect(forgotPage).toContain("Reset password");
    expect(forgotPage).toContain("same whether or not an account exists");
    expect(forgotPage).not.toContain("<main className=\"login-page\">");
    expect(forgotForm).toContain("name=\"email\"");
    expect(forgotForm).toContain("import { FormSuccessMessage }");
    expect(forgotForm).toContain("{state.message ? <FormSuccessMessage>{state.message}</FormSuccessMessage> : null}");
    expect(forgotForm).not.toContain("<p className=\"form-success\">{state.message}</p>");
    expect(forgotForm).toContain("import { AuthSubmitButton }");
    expect(forgotForm).toContain("<AuthSubmitButton pendingLabel=\"Preparing...\" submitLabel=\"Request reset\" />");
    expect(forgotForm).not.toContain("function ForgotPasswordSubmitButton");
    expect(forgotForm).toContain("import { AuthTextField }");
    expect(forgotForm).toContain("label=\"Email\"");
    expect(forgotForm).not.toContain("className=\"form-label\"");
    expect(forgotActions).toContain("requestPasswordReset(email)");
    expect(forgotActions).toContain("result.resetToken ? `/reset-password?token=${encodeURIComponent(result.resetToken)}` : undefined");
    expect(resetPage).toContain("import { AuthPanel } from \"@/components/auth-panel\"");
    expect(resetPage).toContain("import { FormErrorMessage }");
    expect(resetPage).toContain("<AuthPanel title=\"Set new password\">");
    expect(resetPage).toContain("getPasswordResetTokenStatus(token)");
    expect(resetPage).toContain("invalidPasswordResetTokenMessage");
    expect(resetPage).toContain("<FormErrorMessage>{invalidPasswordResetTokenMessage}</FormErrorMessage>");
    expect(resetPage).not.toContain("<p className=\"form-error\">{invalidPasswordResetTokenMessage}</p>");
    expect(resetPage).not.toContain("<section className=\"login-panel\">");
    expect(resetForm).toContain("name=\"token\"");
    expect(resetForm).toContain("autoComplete=\"new-password\"");
    expect(resetForm).toContain("import { FormErrorMessage }");
    expect(resetForm).toContain("import { FormSuccessMessage }");
    expect(resetForm).toContain("<FormSuccessMessage>Password reset. You can sign in with your new password.</FormSuccessMessage>");
    expect(resetForm).toContain("{state.error ? <FormErrorMessage>{state.error}</FormErrorMessage> : null}");
    expect(resetForm).not.toContain("<p className=\"form-success\">Password reset. You can sign in with your new password.</p>");
    expect(resetForm).not.toContain("<p className=\"form-error\">{state.error}</p>");
    expect(resetForm).toContain("import { AuthSubmitButton }");
    expect(resetForm).toContain("<AuthSubmitButton pendingLabel=\"Resetting...\" submitLabel=\"Reset password\" />");
    expect(resetForm).not.toContain("function ResetPasswordSubmitButton");
    expect(authSubmitButton).toContain("actionLabel?: string");
    expect(authSubmitButton).toContain("const resolvedActionLabel = actionLabel ?? submitLabel");
    expect(authSubmitButton).toContain("aria-label={resolvedActionLabel}");
    expect(authSubmitButton).toContain("title={resolvedActionLabel}");
    expect(authSubmitButton).toContain("pending ? pendingLabel : submitLabel");
    expect(resetForm).toContain("import { AuthTextField }");
    expect(resetForm).toContain("label=\"New password\"");
    expect(resetForm).toContain("label=\"Confirm new password\"");
    expect(resetForm).not.toContain("className=\"form-label\"");
    expect(authTextField).toContain("export function AuthTextField");
    expect(resetActions).toContain("resetPasswordWithToken(token, password)");
    expect(resetActions).toContain("Passwords must match.");
  });

  it("documents password reset as local-only with a password-reset-only email boundary", () => {
    expect(routeMap).toContain("GET /forgot-password");
    expect(routeMap).toContain("GET /reset-password?token=...");
    expect(routeMap).toContain("queues password-reset email jobs when `APP_BASE_URL` can build an absolute reset URL");
    expect(currentStatus).toContain("Password Reset MVP");
    expect(currentStatus).toContain("queued password-reset-only Resend or webhook email delivery");
  });
});
