import { createHmac, timingSafeEqual } from "node:crypto";

import { ApiError } from "@/lib/api/responses";
import { canUseEmailTokenEncryptionKey } from "@/lib/email/token-encryption";

type EnvInput = Record<string, string | undefined>;
type EmailOAuthProvider = "GOOGLE_WORKSPACE" | "MICROSOFT_365";

type EmailOAuthStatePayload = {
  actorUserId: string;
  expiresAt: number;
  provider: EmailOAuthProvider;
  workspaceId: string;
};

export function createEmailOAuthState(
  payload: Omit<EmailOAuthStatePayload, "expiresAt">,
  env: EnvInput = process.env,
  now = Date.now()
) {
  const statePayload: EmailOAuthStatePayload = {
    ...payload,
    expiresAt: now + 10 * 60 * 1000
  };
  const encodedPayload = Buffer.from(JSON.stringify(statePayload), "utf8").toString("base64url");
  return `${encodedPayload}.${signState(encodedPayload, env)}`;
}

export function verifyEmailOAuthState(state: string | null | undefined, env: EnvInput = process.env, now = Date.now()) {
  if (!state) {
    throw new ApiError("EMAIL_OAUTH_STATE_REQUIRED", "Email connection state is required.", 400);
  }

  const [encodedPayload, signature, extra] = state.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    throw new ApiError("EMAIL_OAUTH_STATE_INVALID", "Email connection state is invalid.", 400);
  }

  const expectedSignature = signState(encodedPayload, env);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new ApiError("EMAIL_OAUTH_STATE_INVALID", "Email connection state is invalid.", 400);
  }

  let payload: EmailOAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as EmailOAuthStatePayload;
  } catch {
    throw new ApiError("EMAIL_OAUTH_STATE_INVALID", "Email connection state is invalid.", 400);
  }

  if (
    !isEmailOAuthProvider(payload.provider) ||
    !isNonEmptyString(payload.workspaceId) ||
    !isNonEmptyString(payload.actorUserId) ||
    typeof payload.expiresAt !== "number" ||
    !Number.isFinite(payload.expiresAt)
  ) {
    throw new ApiError("EMAIL_OAUTH_STATE_INVALID", "Email connection state is invalid.", 400);
  }

  if (payload.expiresAt < now) {
    throw new ApiError("EMAIL_OAUTH_STATE_EXPIRED", "Email connection state expired. Start the connection again.", 400);
  }

  return payload;
}

function isEmailOAuthProvider(provider: unknown): provider is EmailOAuthProvider {
  return provider === "GOOGLE_WORKSPACE" || provider === "MICROSOFT_365";
}

function isNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function signState(encodedPayload: string, env: EnvInput) {
  const key = env.EMAIL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!key || !canUseEmailTokenEncryptionKey(env)) {
    throw new ApiError("EMAIL_TOKEN_ENCRYPTION_NOT_CONFIGURED", "Email token encryption must be configured before connecting email.", 400);
  }

  return createHmac("sha256", key).update(encodedPayload).digest("base64url");
}
