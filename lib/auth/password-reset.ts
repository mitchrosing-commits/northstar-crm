import { createHash, randomBytes } from "node:crypto";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { enqueuePasswordResetEmailJob } from "@/lib/jobs/handlers";
import { hashPassword } from "./password";

export const passwordResetTokenTtlMs = 1000 * 60 * 30;
export const passwordResetGenericMessage =
  "If an account exists for that email and password reset is configured, you will receive a reset link.";
export const invalidPasswordResetTokenMessage = "This password reset link is invalid or expired.";
export const minimumResetPasswordLength = 8;
const minimumPasswordResetTokenLength = 32;

export type PasswordResetRequestResult = {
  expiresAt?: Date;
  message: string;
  resetToken?: string;
};

type EnvInput = Record<string, string | undefined>;

export async function requestPasswordReset(
  email: string,
  options: { env?: EnvInput; now?: Date } = {}
): Promise<PasswordResetRequestResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const now = options.now ?? new Date();

  if (!normalizedEmail) {
    return { message: passwordResetGenericMessage };
  }

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: "insensitive" },
      deletedAt: null
    },
    select: { email: true, id: true }
  });

  if (!user) {
    return { message: passwordResetGenericMessage };
  }

  const resetToken = generatePasswordResetToken();
  const expiresAt = new Date(now.getTime() + passwordResetTokenTtlMs);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        consumedAt: null,
        expiresAt: { gt: now }
      },
      data: { consumedAt: now }
    });
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashPasswordResetToken(resetToken),
        expiresAt
      }
    });
  });

  await queuePasswordResetEmail({
    env: options.env,
    expiresAt,
    resetToken,
    to: user.email
  });

  if (!canExposeDevelopmentResetToken(options.env)) {
    return { message: passwordResetGenericMessage };
  }

  return {
    expiresAt,
    message: passwordResetGenericMessage,
    resetToken
  };
}

export async function getPasswordResetTokenStatus(token: string, now = new Date()) {
  const normalizedToken = token.trim();
  if (normalizedToken.length < minimumPasswordResetTokenLength) return "invalid" as const;

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashPasswordResetToken(normalizedToken) },
    select: {
      consumedAt: true,
      expiresAt: true,
      user: { select: { deletedAt: true } }
    }
  });

  if (!resetToken || resetToken.consumedAt || resetToken.expiresAt <= now || resetToken.user.deletedAt) {
    return "invalid" as const;
  }

  return "valid" as const;
}

export async function resetPasswordWithToken(token: string, password: string, now = new Date()) {
  const normalizedToken = token.trim();
  validateResetPassword(password);

  if (normalizedToken.length < minimumPasswordResetTokenLength) {
    throw invalidPasswordResetToken();
  }

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashPasswordResetToken(normalizedToken) },
    select: {
      id: true,
      userId: true,
      consumedAt: true,
      expiresAt: true,
      user: { select: { deletedAt: true } }
    }
  });

  if (!resetToken || resetToken.consumedAt || resetToken.expiresAt <= now || resetToken.user.deletedAt) {
    throw invalidPasswordResetToken();
  }

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({
      where: {
        id: resetToken.id,
        consumedAt: null,
        expiresAt: { gt: now }
      },
      data: { consumedAt: now }
    });

    if (consumed.count !== 1) {
      throw invalidPasswordResetToken();
    }

    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash: hashPassword(password) }
    });
  });
}

export function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function canExposeDevelopmentResetToken(env: EnvInput = process.env) {
  return env.NODE_ENV !== "production";
}

export function buildPasswordResetUrl(resetToken: string, env: EnvInput = process.env) {
  const appBaseUrl = env.APP_BASE_URL?.trim();
  if (!appBaseUrl) return null;

  try {
    return new URL(`/reset-password?token=${encodeURIComponent(resetToken)}`, appBaseUrl).toString();
  } catch {
    return null;
  }
}

async function queuePasswordResetEmail({
  env = process.env,
  expiresAt,
  resetToken,
  to
}: {
  env?: EnvInput;
  expiresAt: Date;
  resetToken: string;
  to: string;
}) {
  const resetUrl = buildPasswordResetUrl(resetToken, env);
  if (!resetUrl) return;

  try {
    await enqueuePasswordResetEmailJob({ expiresAt, resetUrl, to });
  } catch {
    return;
  }
}

function generatePasswordResetToken() {
  return randomBytes(32).toString("base64url");
}

function validateResetPassword(password: string) {
  if (password.length < minimumResetPasswordLength) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Password must be at least ${minimumResetPasswordLength} characters.`,
      422
    );
  }
}

function invalidPasswordResetToken() {
  return new ApiError("INVALID_RESET_TOKEN", invalidPasswordResetTokenMessage, 400);
}
