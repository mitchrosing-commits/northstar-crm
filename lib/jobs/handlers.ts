import type { Job } from "@prisma/client";

import { isPasswordResetEmailConfigured, sendPasswordResetEmail } from "@/lib/email/auth-email";
import { enqueueJob } from "@/lib/services/job-service";

export const internalNoopJobType = "internal.noop";
export const passwordResetEmailJobType = "auth.password_reset_email";

export type JobHandlerInput = {
  job: Pick<Job, "attempts" | "id" | "maxAttempts" | "type" | "workspaceId">;
  payload: Job["payload"];
};

export type JobHandler = (input: JobHandlerInput) => Promise<void>;
export type JobHandlerRegistry = Record<string, JobHandler>;

export const jobHandlers = {
  [internalNoopJobType]: handleInternalNoopJob,
  [passwordResetEmailJobType]: handlePasswordResetEmailJob
} satisfies JobHandlerRegistry;

export type PasswordResetEmailJobPayload = {
  expiresAt: string;
  resetUrl: string;
  to: string;
};

export async function enqueuePasswordResetEmailJob(input: { expiresAt: Date; resetUrl: string; to: string }) {
  return enqueueJob({
    type: passwordResetEmailJobType,
    payload: {
      expiresAt: input.expiresAt.toISOString(),
      resetUrl: input.resetUrl,
      to: input.to
    }
  });
}

async function handleInternalNoopJob({ payload }: JobHandlerInput) {
  assertPlainObjectPayload(payload);
}

async function handlePasswordResetEmailJob({ payload }: JobHandlerInput) {
  const input = parsePasswordResetEmailJobPayload(payload);
  if (!isPasswordResetEmailConfigured()) {
    throw new Error("Password reset email webhook is not configured.");
  }
  await sendPasswordResetEmail(input);
}

export function parsePasswordResetEmailJobPayload(payload: Job["payload"]) {
  if (!isRecord(payload)) {
    throw new Error("Invalid password reset email job payload.");
  }

  const to = readNonEmpty(payload.to);
  const resetUrl = readNonEmpty(payload.resetUrl);
  const expiresAtRaw = readNonEmpty(payload.expiresAt);
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;

  if (!to || !resetUrl || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new Error("Invalid password reset email job payload.");
  }

  return { expiresAt, resetUrl, to };
}

function assertPlainObjectPayload(payload: Job["payload"]) {
  if (payload === null) return;
  if (typeof payload === "object" && !Array.isArray(payload)) return;
  throw new Error("Invalid internal noop job payload.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
