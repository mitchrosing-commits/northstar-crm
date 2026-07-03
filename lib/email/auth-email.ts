import { isPublicHttpsUrl } from "@/lib/public-host";

type EnvInput = Record<string, string | undefined>;

export type PasswordResetEmailInput = {
  expiresAt: Date;
  resetUrl: string;
  to: string;
};

export type PasswordResetEmailSender = (input: PasswordResetEmailInput) => Promise<void>;

export type WorkspaceInvitationEmailInput = {
  invitationUrl: string;
  invitedRoleLabel: string;
  inviterEmail?: string;
  inviterName?: string;
  to: string;
  workspaceName: string;
};

type FetchLike = typeof fetch;

export function passwordResetEmailReadiness(env: EnvInput = process.env) {
  const appBaseUrl = readNonEmpty(env.APP_BASE_URL);
  const authEmailWebhookUrl = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL);
  const hasUsableAppBaseUrl = isUsablePasswordResetAppBaseUrl(appBaseUrl, env);
  const hasResendApiKey = Boolean(readNonEmpty(env.RESEND_API_KEY));
  const hasAuthEmailFrom = Boolean(readNonEmpty(env.AUTH_EMAIL_FROM));
  const resendConfigured = hasResendApiKey && hasAuthEmailFrom;
  const webhookConfigured = Boolean(authEmailWebhookUrl);
  const webhookUsable = isUsableAuthEmailWebhookUrl(authEmailWebhookUrl, env);
  const hasDeliveryBackend = resendConfigured || webhookUsable;
  const configured = hasUsableAppBaseUrl && hasDeliveryBackend;
  const missingEnvNames = [];

  if (!hasUsableAppBaseUrl) missingEnvNames.push("APP_BASE_URL");
  if (!hasDeliveryBackend) {
    if (hasResendApiKey && !hasAuthEmailFrom) {
      missingEnvNames.push("AUTH_EMAIL_FROM");
    } else if (webhookConfigured && !webhookUsable) {
      missingEnvNames.push("AUTH_EMAIL_WEBHOOK_URL");
    } else {
      missingEnvNames.push("RESEND_API_KEY", "AUTH_EMAIL_FROM", "AUTH_EMAIL_WEBHOOK_URL");
    }
  }

  return {
    configured,
    deliveryMethod: resendConfigured ? "resend" : webhookConfigured ? "webhook" : "none",
    missingEnvNames: configured ? [] : missingEnvNames,
    optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
    workerRequired: true
  };
}

export function isPasswordResetEmailConfigured(env: EnvInput = process.env) {
  return passwordResetEmailReadiness(env).configured;
}

export function workspaceInvitationEmailReadiness(env: EnvInput = process.env) {
  return passwordResetEmailReadiness(env);
}

export function isWorkspaceInvitationEmailConfigured(env: EnvInput = process.env) {
  return workspaceInvitationEmailReadiness(env).configured;
}

export async function sendPasswordResetEmail(
  input: unknown,
  options: { env?: EnvInput; fetchImpl?: FetchLike } = {}
) {
  const emailInput = normalizePasswordResetEmailInput(input);
  const env = options.env ?? process.env;
  const resendApiKey = readNonEmpty(env.RESEND_API_KEY);
  const from = readNonEmpty(env.AUTH_EMAIL_FROM);
  const webhookUrl = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL);
  const fetchImpl = options.fetchImpl ?? fetch;

  if (resendApiKey && from) {
    await sendPasswordResetEmailWithResend(emailInput, { fetchImpl, from, resendApiKey });
    return;
  }

  if (!webhookUrl) return;
  if (!isUsableAuthEmailWebhookUrl(webhookUrl, env)) {
    throw new Error("Password reset email webhook URL is invalid.");
  }

  const token = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_TOKEN);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "password_reset",
      to: emailInput.to,
      from,
      resetUrl: emailInput.resetUrl,
      expiresAt: emailInput.expiresAt.toISOString()
    })
  });

  if (!response.ok) {
    throw new Error("Password reset email webhook failed.");
  }
}

export async function sendWorkspaceInvitationEmail(
  input: unknown,
  options: { env?: EnvInput; fetchImpl?: FetchLike } = {}
) {
  const emailInput = normalizeWorkspaceInvitationEmailInput(input);
  const env = options.env ?? process.env;
  const resendApiKey = readNonEmpty(env.RESEND_API_KEY);
  const from = readNonEmpty(env.AUTH_EMAIL_FROM);
  const webhookUrl = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL);
  const fetchImpl = options.fetchImpl ?? fetch;

  if (resendApiKey && from) {
    await sendWorkspaceInvitationEmailWithResend(emailInput, { fetchImpl, from, resendApiKey });
    return;
  }

  if (!webhookUrl) return;
  if (!isUsableAuthEmailWebhookUrl(webhookUrl, env)) {
    throw new Error("Workspace invitation email webhook URL is invalid.");
  }

  const token = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_TOKEN);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };

  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "workspace_invitation",
      to: emailInput.to,
      from,
      workspaceName: emailInput.workspaceName,
      invitedRoleLabel: emailInput.invitedRoleLabel,
      inviterName: emailInput.inviterName,
      inviterEmail: emailInput.inviterEmail,
      invitationUrl: emailInput.invitationUrl
    })
  });

  if (!response.ok) {
    throw new Error("Workspace invitation email webhook failed.");
  }
}

async function sendPasswordResetEmailWithResend(
  input: PasswordResetEmailInput,
  {
    fetchImpl,
    from,
    resendApiKey
  }: {
    fetchImpl: FetchLike;
    from: string;
    resendApiKey: string;
  }
) {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${resendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: "Reset your Northstar CRM password",
      text: buildPasswordResetEmailText(input),
      html: buildPasswordResetEmailHtml(input)
    })
  });

  if (!response.ok) {
    throw new Error("Password reset email Resend delivery failed.");
  }
}

async function sendWorkspaceInvitationEmailWithResend(
  input: WorkspaceInvitationEmailInput,
  {
    fetchImpl,
    from,
    resendApiKey
  }: {
    fetchImpl: FetchLike;
    from: string;
    resendApiKey: string;
  }
) {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${resendApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: `You're invited to ${input.workspaceName} on Northstar CRM`,
      text: buildWorkspaceInvitationEmailText(input),
      html: buildWorkspaceInvitationEmailHtml(input)
    })
  });

  if (!response.ok) {
    throw new Error("Workspace invitation email Resend delivery failed.");
  }
}

function buildPasswordResetEmailText(input: PasswordResetEmailInput) {
  return [
    "We received a request to reset your Northstar CRM password.",
    "",
    "Use this link to reset your password:",
    input.resetUrl,
    "",
    `This link expires at ${input.expiresAt.toISOString()}.`,
    "If you did not request this, you can ignore this email."
  ].join("\n");
}

function buildPasswordResetEmailHtml(input: PasswordResetEmailInput) {
  const resetUrl = escapeHtml(input.resetUrl);
  const expiresAt = escapeHtml(input.expiresAt.toISOString());

  return [
    "<p>We received a request to reset your Northstar CRM password.</p>",
    `<p><a href="${resetUrl}">Reset your password</a></p>`,
    `<p>This link expires at ${expiresAt}.</p>`,
    "<p>If you did not request this, you can ignore this email.</p>"
  ].join("");
}

function buildWorkspaceInvitationEmailText(input: WorkspaceInvitationEmailInput) {
  const inviter = workspaceInvitationInviterLine(input);
  return [
    inviter
      ? `${inviter} invited you to join ${input.workspaceName} in Northstar CRM.`
      : `You have been invited to join ${input.workspaceName} in Northstar CRM.`,
    "",
    `Invited role: ${input.invitedRoleLabel}.`,
    "",
    "Use this link to accept the invitation:",
    input.invitationUrl,
    "",
    "Sign in or create an account with this invited email address, then accept the invitation. This invitation can be used once and may be revoked by a workspace admin before it is accepted.",
    "If you were not expecting this invitation, you can ignore this email."
  ].join("\n");
}

function buildWorkspaceInvitationEmailHtml(input: WorkspaceInvitationEmailInput) {
  const workspaceName = escapeHtml(input.workspaceName);
  const roleLabel = escapeHtml(input.invitedRoleLabel);
  const invitationUrl = escapeHtml(input.invitationUrl);
  const inviter = workspaceInvitationInviterLine(input);

  return [
    `<p>${inviter ? `${escapeHtml(inviter)} invited you` : "You have been invited"} to join ${workspaceName} in Northstar CRM.</p>`,
    `<p>Invited role: ${roleLabel}.</p>`,
    `<p><a href="${invitationUrl}">Accept workspace invitation</a></p>`,
    "<p>Sign in or create an account with this invited email address, then accept the invitation. This invitation can be used once and may be revoked by a workspace admin before it is accepted.</p>",
    "<p>If you were not expecting this invitation, you can ignore this email.</p>"
  ].join("");
}

function workspaceInvitationInviterLine(input: WorkspaceInvitationEmailInput) {
  if (input.inviterName && input.inviterEmail) return `${input.inviterName} (${input.inviterEmail})`;
  return input.inviterName ?? input.inviterEmail;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function normalizePasswordResetEmailInput(input: unknown): PasswordResetEmailInput {
  if (!isRecord(input)) throw invalidPasswordResetEmailInput();

  const to = readNonEmpty(input.to);
  const resetUrl = readNonEmpty(input.resetUrl);
  const expiresAt = input.expiresAt instanceof Date ? input.expiresAt : null;

  if (!to || !isValidRecipientEmail(to) || !resetUrl || !isValidResetUrl(resetUrl) || !expiresAt || Number.isNaN(expiresAt.getTime())) {
    throw invalidPasswordResetEmailInput();
  }

  return { expiresAt, resetUrl, to };
}

function normalizeWorkspaceInvitationEmailInput(input: unknown): WorkspaceInvitationEmailInput {
  if (!isRecord(input)) throw invalidWorkspaceInvitationEmailInput();

  const to = readNonEmpty(input.to);
  const invitationUrl = readNonEmpty(input.invitationUrl);
  const workspaceName = readNonEmpty(input.workspaceName);
  const invitedRoleLabel = readNonEmpty(input.invitedRoleLabel);
  const inviterName = readNonEmpty(input.inviterName);
  const inviterEmail = readNonEmpty(input.inviterEmail);

  if (
    !to ||
    !isValidRecipientEmail(to) ||
    !invitationUrl ||
    !isValidWorkspaceInvitationUrl(invitationUrl) ||
    !workspaceName ||
    !invitedRoleLabel ||
    (inviterEmail && !isValidRecipientEmail(inviterEmail))
  ) {
    throw invalidWorkspaceInvitationEmailInput();
  }

  return { invitationUrl, invitedRoleLabel, inviterEmail, inviterName, to, workspaceName };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidRecipientEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidResetUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password &&
      url.pathname === "/reset-password" &&
      Boolean(readNonEmpty(url.searchParams.get("token")))
    );
  } catch {
    return false;
  }
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

function isUsablePasswordResetAppBaseUrl(value: string | undefined, env: EnvInput) {
  if (!value) return false;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (env.NODE_ENV !== "production") return true;
    return isPublicHttpsUrl(url);
  } catch {
    return false;
  }
}

function isUsableAuthEmailWebhookUrl(value: string | undefined, env: EnvInput) {
  if (!value) return false;

  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (env.NODE_ENV === "production" && url.protocol !== "https:") return false;
    return true;
  } catch {
    return false;
  }
}

function invalidPasswordResetEmailInput() {
  return new Error("Invalid password reset email input.");
}

function invalidWorkspaceInvitationEmailInput() {
  return new Error("Invalid workspace invitation email input.");
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
