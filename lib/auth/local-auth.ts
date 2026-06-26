import { createHash, randomBytes } from "node:crypto";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { hashPassword, verifyPassword } from "./password";

export const localSessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const invalidLoginMessage = "Invalid email or password.";
const fakePasswordHash = hashPassword("northstar-invalid-password-placeholder");
const minimumSignupPasswordLength = 8;

export type LocalLoginResult = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  session: {
    token: string;
    expiresAt: Date;
  };
};

export type LocalSignupResult = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
  session: {
    token: string;
    expiresAt: Date;
  };
};

export async function loginWithEmailAndPassword(email: string, password: string): Promise<LocalLoginResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new ApiError("INVALID_CREDENTIALS", invalidLoginMessage, 401);
  }

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: "insensitive" },
      deletedAt: null
    },
    select: { id: true, email: true, name: true, passwordHash: true }
  });

  const passwordHash = user?.passwordHash ?? fakePasswordHash;
  if (!user || !user.passwordHash || !verifyPassword(password, passwordHash)) {
    throw new ApiError("INVALID_CREDENTIALS", invalidLoginMessage, 401);
  }

  await deleteExpiredLocalSessions();
  const session = await createLocalSession(user.id);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    },
    session
  };
}

export async function signupWithEmailAndPassword(input: {
  email: string;
  name?: string | null;
  password: string;
}): Promise<LocalSignupResult> {
  const email = normalizeSignupEmail(input.email);
  const name = normalizeSignupName(input.name);

  if (!email) {
    throw new ApiError("VALIDATION_ERROR", "Email is required.", 422);
  }
  if (!isValidSignupEmail(email)) {
    throw new ApiError("VALIDATION_ERROR", "Enter a valid email address.", 422);
  }
  if (input.password.length < minimumSignupPasswordLength) {
    throw new ApiError("VALIDATION_ERROR", "Password must be at least 8 characters.", 422);
  }

  const existing = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      deletedAt: null
    },
    select: { id: true }
  });

  if (existing) {
    throw new ApiError("USER_EXISTS", "An account with this email already exists. Sign in instead.", 409);
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash: hashPassword(input.password)
    },
    select: { id: true, email: true, name: true }
  });

  await deleteExpiredLocalSessions();
  const session = await createLocalSession(user.id);
  return { user, session };
}

export async function createLocalSession(userId: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + localSessionTtlMs);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt
    }
  });

  return { token, expiresAt };
}

export async function revokeLocalSessionToken(token: string) {
  await prisma.session.updateMany({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null
    },
    data: { revokedAt: new Date() }
  });
}

export async function deleteExpiredLocalSessions(now = new Date()) {
  await prisma.session.deleteMany({
    where: {
      expiresAt: { lte: now }
    }
  });
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeSignupEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeSignupName(name: string | null | undefined) {
  const normalized = name?.trim().replace(/\s+/g, " ");
  return normalized || null;
}

function isValidSignupEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
