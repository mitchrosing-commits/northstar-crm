import { JobStatus } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getPasswordResetTokenStatus,
  hashPasswordResetToken,
  invalidPasswordResetTokenMessage,
  passwordResetGenericMessage,
  requestPasswordReset,
  resetPasswordWithToken
} from "@/lib/auth/password-reset";
import { loginWithEmailAndPassword } from "@/lib/auth/local-auth";
import { hashPassword } from "@/lib/auth/password";
import { passwordResetEmailJobType } from "@/lib/jobs/handlers";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("password reset token lifecycle", () => {
  it("creates a hashed token for an active user without storing the raw token", async () => {
    const fx = currentFixture();
    const result = await requestPasswordReset(fx.userA.email.toUpperCase(), {
      env: { NODE_ENV: "test" },
      now: new Date("2030-01-01T00:00:00.000Z")
    });

    expect(result.message).toBe(passwordResetGenericMessage);
    expect(result.resetToken).toBeTruthy();

    const stored = await fx.prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: fx.userA.id }
    });

    expect(stored.tokenHash).toBe(hashPasswordResetToken(result.resetToken ?? ""));
    expect(stored.tokenHash).not.toBe(result.resetToken);
    expect(stored.consumedAt).toBeNull();
  });

  it("returns the same generic response for unknown emails without creating a token", async () => {
    const fx = currentFixture();
    const result = await requestPasswordReset("unknown@example.test", {
      env: { NODE_ENV: "test" },
      now: new Date("2030-01-01T00:00:00.000Z")
    });
    const malformedEmailResult = await requestPasswordReset({ email: fx.userA.email } as unknown as string, {
      env: { NODE_ENV: "test" },
      now: new Date("2030-01-01T00:01:00.000Z")
    });

    expect(result).toEqual({ message: passwordResetGenericMessage });
    expect(malformedEmailResult).toEqual({ message: passwordResetGenericMessage });
    await expect(fx.prisma.passwordResetToken.count({ where: { userId: fx.userA.id } })).resolves.toBe(0);
    await expect(fx.prisma.job.count({ where: { type: passwordResetEmailJobType } })).resolves.toBe(0);
  });

  it("returns the same generic response for inactive users without creating a token or job", async () => {
    const fx = currentFixture();
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { deletedAt: new Date("2030-01-01T00:00:00.000Z") }
    });

    const result = await requestPasswordReset(fx.userA.email.toUpperCase(), {
      env: {
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:00:00.000Z")
    });

    expect(result).toEqual({ message: passwordResetGenericMessage });
    await expect(fx.prisma.passwordResetToken.count({ where: { userId: fx.userA.id } })).resolves.toBe(0);
    await expect(fx.prisma.job.count({ where: { type: passwordResetEmailJobType } })).resolves.toBe(0);
  });

  it("queues a production password reset email job without exposing the token response", async () => {
    const fx = currentFixture();
    const result = await requestPasswordReset(fx.userA.email.toUpperCase(), {
      env: {
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:00:00.000Z")
    });
    const queuedJob = await fx.prisma.job.findFirstOrThrow({
      where: { type: passwordResetEmailJobType }
    });
    const payload = queuedJob.payload as { expiresAt: string; resetUrl: string; to: string };
    const token = new URL(payload.resetUrl).searchParams.get("token");
    const stored = await fx.prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: fx.userA.id }
    });

    expect(result).toEqual({ message: passwordResetGenericMessage });
    expect(queuedJob).toMatchObject({
      status: JobStatus.PENDING,
      type: passwordResetEmailJobType,
      workspaceId: null
    });
    expect(payload).toMatchObject({
      expiresAt: "2030-01-01T00:30:00.000Z",
      to: fx.userA.email
    });
    expect(payload.resetUrl).toMatch(/^https:\/\/crm\.example\.test\/reset-password\?token=/);
    expect(JSON.stringify(payload)).not.toContain("passwordHash");
    expect(JSON.stringify(payload)).not.toContain(fx.userA.id);
    expect(stored.tokenHash).toBe(hashPasswordResetToken(token ?? ""));
  });

  it("keeps production responses generic when email config is missing", async () => {
    const fx = currentFixture();
    const missingAppBaseUrl = await requestPasswordReset(fx.userA.email, {
      env: {
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:00:00.000Z")
    });
    const missingWebhook = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://crm.example.test",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:01:00.000Z")
    });

    expect(missingAppBaseUrl).toEqual({ message: passwordResetGenericMessage });
    expect(missingWebhook).toEqual({ message: passwordResetGenericMessage });
    await expect(fx.prisma.job.count({ where: { type: passwordResetEmailJobType } })).resolves.toBe(1);
  });

  it("does not queue production reset email jobs with unsafe app base URLs", async () => {
    const fx = currentFixture();
    const localhost = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "http://localhost:3000",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:00:00.000Z")
    });
    const insecurePublicUrl = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "http://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:01:00.000Z")
    });
    const privateNetworkUrl = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://192.168.1.10",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:02:00.000Z")
    });
    const uniqueLocalIpv6Url = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://[fd00::1]",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:03:00.000Z")
    });
    const mappedPrivateIpv6Url = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://[::ffff:192.168.1.10]",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:04:00.000Z")
    });
    const compatiblePrivateIpv6Url = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://[::192.168.1.10]",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:05:00.000Z")
    });
    const nat64PrivateIpv6Url = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://[64:ff9b::192.168.1.10]",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:06:00.000Z")
    });
    const credentialedPublicUrl = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://preview:secret@crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "production"
      },
      now: new Date("2030-01-01T00:07:00.000Z")
    });

    expect(localhost).toEqual({ message: passwordResetGenericMessage });
    expect(insecurePublicUrl).toEqual({ message: passwordResetGenericMessage });
    expect(privateNetworkUrl).toEqual({ message: passwordResetGenericMessage });
    expect(uniqueLocalIpv6Url).toEqual({ message: passwordResetGenericMessage });
    expect(mappedPrivateIpv6Url).toEqual({ message: passwordResetGenericMessage });
    expect(compatiblePrivateIpv6Url).toEqual({ message: passwordResetGenericMessage });
    expect(nat64PrivateIpv6Url).toEqual({ message: passwordResetGenericMessage });
    expect(credentialedPublicUrl).toEqual({ message: passwordResetGenericMessage });
    await expect(fx.prisma.job.count({ where: { type: passwordResetEmailJobType } })).resolves.toBe(0);
    await expect(fx.prisma.passwordResetToken.count({ where: { userId: fx.userA.id } })).resolves.toBe(8);
  });

  it("does not expose account existence or reset links in production responses", async () => {
    const fx = currentFixture();
    const known = await requestPasswordReset(fx.userA.email, {
      env: { NODE_ENV: "production" },
      now: new Date("2030-01-01T00:00:00.000Z")
    });
    const unknown = await requestPasswordReset("unknown@example.test", {
      env: { NODE_ENV: "production" },
      now: new Date("2030-01-01T00:00:00.000Z")
    });

    expect(known).toEqual({ message: passwordResetGenericMessage });
    expect(unknown).toEqual({ message: passwordResetGenericMessage });
    expect(known).not.toHaveProperty("resetToken");
    expect(known).not.toHaveProperty("resetUrl");
    expect(known).not.toHaveProperty("expiresAt");
    await expect(fx.prisma.passwordResetToken.count({ where: { userId: fx.userA.id } })).resolves.toBe(1);
  });

  it("re-requesting invalidates the prior usable token and leaves only the latest usable", async () => {
    const fx = currentFixture();
    const first = await requestPasswordReset(fx.userA.email, {
      env: { NODE_ENV: "test" },
      now: new Date("2030-01-01T00:00:00.000Z")
    });
    const second = await requestPasswordReset(fx.userA.email, {
      env: { NODE_ENV: "test" },
      now: new Date("2030-01-01T00:01:00.000Z")
    });

    await expect(resetPasswordWithToken(first.resetToken ?? "", "new-password-1")).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
      message: invalidPasswordResetTokenMessage,
      status: 400
    });

    await resetPasswordWithToken(second.resetToken ?? "", "new-password-2", new Date("2030-01-01T00:02:00.000Z"));

    const tokens = await fx.prisma.passwordResetToken.findMany({
      where: { userId: fx.userA.id },
      orderBy: { createdAt: "asc" }
    });

    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.consumedAt)).toBe(true);
  });

  it("re-requesting with queued email creates separate jobs, and the stale queued reset link cannot reset", async () => {
    const fx = currentFixture();
    const first = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "test"
      },
      now: new Date("2030-01-01T00:00:00.000Z")
    });
    const second = await requestPasswordReset(fx.userA.email, {
      env: {
        APP_BASE_URL: "https://crm.example.test",
        AUTH_EMAIL_WEBHOOK_URL: "https://mail.example.test/auth-email",
        NODE_ENV: "test"
      },
      now: new Date("2030-01-01T00:01:00.000Z")
    });

    const jobs = await fx.prisma.job.findMany({
      where: { type: passwordResetEmailJobType },
      orderBy: { createdAt: "asc" }
    });

    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.dedupeKey === null)).toBe(true);
    await expect(resetPasswordWithToken(first.resetToken ?? "", "new-password-1")).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
      message: invalidPasswordResetTokenMessage,
      status: 400
    });

    await resetPasswordWithToken(second.resetToken ?? "", "new-password-2", new Date("2030-01-01T00:02:00.000Z"));
  });

  it("uses a valid token once to update the password and allow login with the new password", async () => {
    const fx = currentFixture();
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { passwordHash: hashPassword("old-password") }
    });
    const result = await requestPasswordReset(fx.userA.email, { env: { NODE_ENV: "test" } });

    await resetPasswordWithToken(result.resetToken ?? "", "new-password");

    await expect(loginWithEmailAndPassword(fx.userA.email, "old-password")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS"
    });
    await expect(loginWithEmailAndPassword(fx.userA.email, "new-password")).resolves.toMatchObject({
      user: { email: fx.userA.email }
    });

    await expect(resetPasswordWithToken(result.resetToken ?? "", "another-password")).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
      message: invalidPasswordResetTokenMessage,
      status: 400
    });
  });

  it("invalidates outstanding reset tokens when a user is deactivated", async () => {
    const fx = currentFixture();
    const oldPasswordHash = hashPassword("old-password");
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { passwordHash: oldPasswordHash }
    });
    const result = await requestPasswordReset(fx.userA.email, {
      env: { NODE_ENV: "test" },
      now: new Date("2030-01-01T00:00:00.000Z")
    });

    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { deletedAt: new Date("2030-01-01T00:05:00.000Z") }
    });

    await expect(getPasswordResetTokenStatus(result.resetToken ?? "", new Date("2030-01-01T00:06:00.000Z"))).resolves.toBe(
      "invalid"
    );
    await expect(
      resetPasswordWithToken(result.resetToken ?? "", "new-password", new Date("2030-01-01T00:06:00.000Z"))
    ).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
      message: invalidPasswordResetTokenMessage,
      status: 400
    });
    await expect(fx.prisma.user.findUniqueOrThrow({ where: { id: fx.userA.id } })).resolves.toMatchObject({
      passwordHash: oldPasswordHash
    });
  });

  it("fails safely for consumed, expired, invalid, and short-password attempts", async () => {
    const fx = currentFixture();
    const expiredToken = "expired-token";
    await fx.prisma.passwordResetToken.create({
      data: {
        userId: fx.userA.id,
        tokenHash: hashPasswordResetToken(expiredToken),
        expiresAt: new Date("2000-01-01T00:00:00.000Z")
      }
    });

    await expect(getPasswordResetTokenStatus({ token: expiredToken } as unknown as string)).resolves.toBe("invalid");
    await expect(
      resetPasswordWithToken({ token: expiredToken } as unknown as string, "new-password")
    ).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
      message: invalidPasswordResetTokenMessage,
      status: 400
    });
    await expect(resetPasswordWithToken(expiredToken, { password: "new-password" } as unknown as string)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Password must be at least 8 characters.",
      status: 422
    });
    await expect(resetPasswordWithToken("not-a-token", "new-password")).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
      message: invalidPasswordResetTokenMessage,
      status: 400
    });
    await expect(resetPasswordWithToken(expiredToken, "new-password")).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
      message: invalidPasswordResetTokenMessage,
      status: 400
    });
    await expect(resetPasswordWithToken(expiredToken, "short")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
