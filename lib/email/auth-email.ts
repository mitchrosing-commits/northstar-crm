type EnvInput = Record<string, string | undefined>;

export type PasswordResetEmailInput = {
  expiresAt: Date;
  resetUrl: string;
  to: string;
};

export type PasswordResetEmailSender = (input: PasswordResetEmailInput) => Promise<void>;

type FetchLike = typeof fetch;

export function isPasswordResetEmailConfigured(env: EnvInput = process.env) {
  return Boolean(readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL) && readNonEmpty(env.APP_BASE_URL));
}

export async function sendPasswordResetEmail(
  input: PasswordResetEmailInput,
  options: { env?: EnvInput; fetchImpl?: FetchLike } = {}
) {
  const env = options.env ?? process.env;
  const webhookUrl = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL);

  if (!webhookUrl) return;

  const fetchImpl = options.fetchImpl ?? fetch;
  const token = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_TOKEN);
  const from = readNonEmpty(env.AUTH_EMAIL_FROM);
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

function readNonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
