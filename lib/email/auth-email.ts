type EnvInput = Record<string, string | undefined>;

export type PasswordResetEmailInput = {
  expiresAt: Date;
  resetUrl: string;
  to: string;
};

export type PasswordResetEmailSender = (input: PasswordResetEmailInput) => Promise<void>;

type FetchLike = typeof fetch;

export function passwordResetEmailReadiness(env: EnvInput = process.env) {
  const resendConfigured = Boolean(readNonEmpty(env.RESEND_API_KEY) && readNonEmpty(env.AUTH_EMAIL_FROM));
  const webhookConfigured = Boolean(readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL));
  const configured = resendConfigured || webhookConfigured;

  return {
    configured,
    deliveryMethod: resendConfigured ? "resend" : webhookConfigured ? "webhook" : "none",
    missingEnvNames: configured ? [] : ["RESEND_API_KEY", "AUTH_EMAIL_FROM", "AUTH_EMAIL_WEBHOOK_URL"],
    optionalEnvNames: ["AUTH_EMAIL_WEBHOOK_TOKEN"],
    workerRequired: true
  };
}

export function isPasswordResetEmailConfigured(env: EnvInput = process.env) {
  return passwordResetEmailReadiness(env).configured;
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
  options: { env?: EnvInput; fetchImpl?: FetchLike } = {}
) {
  const env = options.env ?? process.env;
  const resendApiKey = readNonEmpty(env.RESEND_API_KEY);
  const from = readNonEmpty(env.AUTH_EMAIL_FROM);
  const webhookUrl = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL);
  const fetchImpl = options.fetchImpl ?? fetch;

  if (resendApiKey && from) {
    await sendPasswordResetEmailWithResend(input, { fetchImpl, from, resendApiKey });
    return;
  }

  if (!webhookUrl) return;

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
      to: input.to,
      from,
      resetUrl: input.resetUrl,
      expiresAt: input.expiresAt.toISOString()
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

function readNonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
