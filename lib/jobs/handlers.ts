import { createHash } from "node:crypto";

import type { Job } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  isPasswordResetEmailConfigured,
  isWorkspaceInvitationEmailConfigured,
  sendPasswordResetEmail,
  sendWorkspaceInvitationEmail
} from "@/lib/email/auth-email";
import { meetingMediaExtractionJobType } from "@/lib/meeting-intelligence/media-providers";
import { enqueueJob } from "@/lib/services/job-service";
import { processMeetingIntakeMediaExtractionJob } from "@/lib/services/meeting-intelligence-service";
import { gmailInboxSyncJobType, processGmailInboxSyncJob } from "@/lib/services/email-connection-service";

export const internalNoopJobType = "internal.noop";
export const passwordResetEmailJobType = "auth.password_reset_email";
export const workspaceInvitationEmailJobType = "workspace.invitation_email";
export { gmailInboxSyncJobType, meetingMediaExtractionJobType };

export type JobHandlerInput = {
  job: Pick<Job, "attempts" | "id" | "maxAttempts" | "type" | "workspaceId">;
  now: Date;
  payload: Job["payload"];
};

export type JobHandler = (input: JobHandlerInput) => Promise<void>;
export type JobHandlerRegistry = Record<string, JobHandler>;

export const jobHandlers = {
  [internalNoopJobType]: handleInternalNoopJob,
  [gmailInboxSyncJobType]: handleGmailInboxSyncJob,
  [meetingMediaExtractionJobType]: handleMeetingMediaExtractionJob,
  [passwordResetEmailJobType]: handlePasswordResetEmailJob,
  [workspaceInvitationEmailJobType]: handleWorkspaceInvitationEmailJob
} satisfies JobHandlerRegistry;

export type PasswordResetEmailJobPayload = {
  expiresAt: string;
  resetUrl: string;
  to: string;
};

export type WorkspaceInvitationEmailJobPayload = {
  invitationId: string;
  invitationUrl: string;
  invitedRoleLabel: string;
  inviterEmail?: string;
  inviterName?: string;
  to: string;
  workspaceId: string;
  workspaceName: string;
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

export async function enqueueWorkspaceInvitationEmailJob(input: WorkspaceInvitationEmailJobPayload) {
  return enqueueJob({
    type: workspaceInvitationEmailJobType,
    workspaceId: input.workspaceId,
    dedupeKey: `workspace-invitation:${input.invitationId}:email`,
    payload: {
      invitationId: input.invitationId,
      invitationUrl: input.invitationUrl,
      invitedRoleLabel: input.invitedRoleLabel,
      ...(input.inviterEmail ? { inviterEmail: input.inviterEmail } : {}),
      ...(input.inviterName ? { inviterName: input.inviterName } : {}),
      to: input.to,
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName
    }
  });
}

async function handleInternalNoopJob({ payload }: JobHandlerInput) {
  assertPlainObjectPayload(payload);
}

async function handleMeetingMediaExtractionJob({ payload }: JobHandlerInput) {
  await processMeetingIntakeMediaExtractionJob(payload);
}

async function handleGmailInboxSyncJob({ payload }: JobHandlerInput) {
  await processGmailInboxSyncJob(payload);
}

async function handlePasswordResetEmailJob({ now, payload }: JobHandlerInput) {
  const input = parsePasswordResetEmailJobPayload(payload);
  if (input.expiresAt <= now) return;
  const resetToken = readPasswordResetTokenFromUrl(input.resetUrl);
  const deliveryConfigured = isPasswordResetEmailConfigured();
  if (deliveryConfigured) {
    assertPasswordResetUrlMatchesAppBaseUrl(input.resetUrl);
  }
  if (!(await isPasswordResetTokenStillUsable(resetToken, now))) return;
  if (!deliveryConfigured) {
    throw new Error("Password reset email delivery is not configured.");
  }
  await sendPasswordResetEmail(input);
}

async function handleWorkspaceInvitationEmailJob({ payload }: JobHandlerInput) {
  const input = parseWorkspaceInvitationEmailJobPayload(payload);
  const deliveryConfigured = isWorkspaceInvitationEmailConfigured();
  if (deliveryConfigured) {
    assertWorkspaceInvitationUrlMatchesAppBaseUrl(input.invitationUrl);
  }
  if (!(await isWorkspaceInvitationStillPending(input))) return;
  if (!deliveryConfigured) {
    throw new Error("Workspace invitation email delivery is not configured.");
  }
  await sendWorkspaceInvitationEmail(input);
}

export function parsePasswordResetEmailJobPayload(payload: Job["payload"]) {
  if (!isRecord(payload)) {
    throw new Error("Invalid password reset email job payload.");
  }

  const to = readNonEmpty(payload.to);
  const resetUrl = readNonEmpty(payload.resetUrl);
  const expiresAtRaw = readNonEmpty(payload.expiresAt);
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;

  if (!to || !isValidRecipientEmail(to) || !resetUrl || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw new Error("Invalid password reset email job payload.");
  }

  return { expiresAt, resetUrl, to };
}

export function parseWorkspaceInvitationEmailJobPayload(payload: Job["payload"]) {
  if (!isRecord(payload)) {
    throw new Error("Invalid workspace invitation email job payload.");
  }

  const invitationId = readNonEmpty(payload.invitationId);
  const invitationUrl = readNonEmpty(payload.invitationUrl);
  const invitedRoleLabel = readNonEmpty(payload.invitedRoleLabel);
  const inviterEmail = readNonEmpty(payload.inviterEmail);
  const inviterName = readNonEmpty(payload.inviterName);
  const to = readNonEmpty(payload.to);
  const workspaceId = readNonEmpty(payload.workspaceId);
  const workspaceName = readNonEmpty(payload.workspaceName);

  if (
    !invitationId ||
    !invitationUrl ||
    !isValidWorkspaceInvitationUrl(invitationUrl) ||
    !invitedRoleLabel ||
    !to ||
    !isValidRecipientEmail(to) ||
    (inviterEmail && !isValidRecipientEmail(inviterEmail)) ||
    !workspaceId ||
    !workspaceName
  ) {
    throw new Error("Invalid workspace invitation email job payload.");
  }

  return { invitationId, invitationUrl, invitedRoleLabel, inviterEmail, inviterName, to, workspaceId, workspaceName };
}

function assertPlainObjectPayload(payload: Job["payload"]) {
  if (payload === null) return;
  if (typeof payload === "object" && !Array.isArray(payload)) return;
  throw new Error("Invalid internal noop job payload.");
}

function assertPasswordResetUrlMatchesAppBaseUrl(resetUrl: string) {
  const appBaseUrl = readNonEmpty(process.env.APP_BASE_URL);

  try {
    if (!appBaseUrl) throw new Error("Missing APP_BASE_URL.");

    const parsedResetUrl = new URL(resetUrl);
    const parsedAppBaseUrl = new URL(appBaseUrl);

    if (
      parsedResetUrl.username ||
      parsedResetUrl.password ||
      parsedResetUrl.origin !== parsedAppBaseUrl.origin ||
      parsedResetUrl.pathname !== "/reset-password" ||
      !readNonEmpty(parsedResetUrl.searchParams.get("token"))
    ) {
      throw new Error("Unexpected password reset URL.");
    }
  } catch {
    throw new Error("Invalid password reset email job payload.");
  }
}

function assertWorkspaceInvitationUrlMatchesAppBaseUrl(invitationUrl: string) {
  const appBaseUrl = readNonEmpty(process.env.APP_BASE_URL);

  try {
    if (!appBaseUrl) throw new Error("Missing APP_BASE_URL.");

    const parsedInvitationUrl = new URL(invitationUrl);
    const parsedAppBaseUrl = new URL(appBaseUrl);

    if (
      parsedInvitationUrl.username ||
      parsedInvitationUrl.password ||
      parsedInvitationUrl.origin !== parsedAppBaseUrl.origin ||
      !isValidWorkspaceInvitationUrl(invitationUrl)
    ) {
      throw new Error("Unexpected workspace invitation URL.");
    }
  } catch {
    throw new Error("Invalid workspace invitation email job payload.");
  }
}

function readPasswordResetTokenFromUrl(resetUrl: string) {
  try {
    const parsedResetUrl = new URL(resetUrl);
    const resetToken = readNonEmpty(parsedResetUrl.searchParams.get("token"));

    if (
      parsedResetUrl.username ||
      parsedResetUrl.password ||
      parsedResetUrl.pathname !== "/reset-password" ||
      !resetToken
    ) {
      throw new Error("Unexpected password reset URL.");
    }

    return resetToken;
  } catch {
    throw new Error("Invalid password reset email job payload.");
  }
}

async function isPasswordResetTokenStillUsable(resetToken: string, now: Date) {
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashPasswordResetToken(resetToken) },
    select: {
      consumedAt: true,
      expiresAt: true,
      user: { select: { deletedAt: true } }
    }
  });

  return Boolean(stored && !stored.consumedAt && stored.expiresAt > now && !stored.user.deletedAt);
}

async function isWorkspaceInvitationStillPending(input: WorkspaceInvitationEmailJobPayload) {
  const invitation = await prisma.workspaceInvitation.findFirst({
    where: {
      id: input.invitationId,
      email: input.to,
      workspaceId: input.workspaceId,
      status: "PENDING",
      workspace: { deletedAt: null }
    },
    select: { id: true }
  });

  return Boolean(invitation);
}

function hashPasswordResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isValidRecipientEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidWorkspaceInvitationUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      /^\/workspaces\/invitations\/[^/]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
