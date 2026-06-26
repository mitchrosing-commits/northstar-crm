import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
    expect(passwordReset).not.toContain("data: { resetToken");
    expect(passwordReset).not.toContain("token: resetToken");
    expect(passwordReset).not.toContain("writeAuditLog");
    expect(passwordReset).not.toContain("auditLog");
  });

  it("adds a provider-neutral auth email boundary for password reset only", () => {
    expect(authEmail).toContain("sendPasswordResetEmail");
    expect(authEmail).toContain("AUTH_EMAIL_WEBHOOK_URL");
    expect(authEmail).toContain("APP_BASE_URL");
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
    expect(forgotPage).toContain("Reset password");
    expect(forgotPage).toContain("same whether or not an account exists");
    expect(forgotForm).toContain("name=\"email\"");
    expect(forgotActions).toContain("requestPasswordReset(email)");
    expect(forgotActions).toContain("/reset-password?token=");
    expect(resetPage).toContain("getPasswordResetTokenStatus(token)");
    expect(resetPage).toContain("invalidPasswordResetTokenMessage");
    expect(resetForm).toContain("name=\"token\"");
    expect(resetForm).toContain("autoComplete=\"new-password\"");
    expect(resetActions).toContain("resetPasswordWithToken(token, password)");
    expect(resetActions).toContain("Passwords must match.");
  });

  it("documents password reset as local-only with a password-reset-only email boundary", () => {
    expect(routeMap).toContain("GET /forgot-password");
    expect(routeMap).toContain("GET /reset-password?token=...");
    expect(currentStatus).toContain("Password Reset MVP");
    expect(currentStatus).toContain("queued password-reset-only webhook email delivery");
  });
});
