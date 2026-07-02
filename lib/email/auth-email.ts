import { isPublicHttpsUrl } from "@/lib/public-host";

type EnvInput = Record<string, string | undefined>;

export type PasswordResetEmailInput = {
  expiresAt: Date;
  resetUrl: string;
  to: string;
};

export type PasswordResetEmailSender = (input: PasswordResetEmailInput) => Promise<void>;

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

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
