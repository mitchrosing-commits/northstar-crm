import { isSafeAuthUserIdHeaderName } from "@/lib/auth/session";
import { canUseEmailTokenEncryptionKey } from "@/lib/email/token-encryption";

const databaseProtocols = ["postgresql:", "postgres:"] as const;
const authModes = ["demo", "trusted-header", "local"] as const;

export type ValidRuntimeEnv = {
  databaseUrl: string;
  appBaseUrl?: string;
  authEmailFrom?: string;
  authEmailWebhookToken?: string;
  authEmailWebhookUrl?: string;
  devActorEmail?: string;
  devWorkspaceSlug?: string;
  authMode?: string;
  authUserIdHeader?: string;
  authSessionSecret?: string;
  emailTokenEncryptionKey?: string;
  googleOauthClientId?: string;
  googleOauthClientSecret?: string;
  googleOauthRedirectUri?: string;
  microsoftOauthClientId?: string;
  microsoftOauthClientSecret?: string;
  microsoftOauthRedirectUri?: string;
  microsoftOauthTenantId?: string;
};

export type EnvValidationResult =
  | { ok: true; env: ValidRuntimeEnv; warnings: string[] }
  | { ok: false; errors: string[] };

type EnvInput = Record<string, string | undefined>;

export function validateRuntimeEnv(env: EnvInput = process.env): EnvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const databaseUrl = readNonEmpty(env.DATABASE_URL);
  const appBaseUrl = readNonEmpty(env.APP_BASE_URL);
  const authEmailFrom = readNonEmpty(env.AUTH_EMAIL_FROM);
  const authEmailWebhookToken = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_TOKEN);
  const authEmailWebhookUrl = readNonEmpty(env.AUTH_EMAIL_WEBHOOK_URL);
  const devActorEmail = readNonEmpty(env.DEV_ACTOR_EMAIL);
  const devWorkspaceSlug = readNonEmpty(env.DEV_WORKSPACE_SLUG);
  const authMode = readNonEmpty(env.AUTH_MODE);
  const authUserIdHeader = readNonEmpty(env.AUTH_USER_ID_HEADER);
  const authSessionSecret = readNonEmpty(env.AUTH_SESSION_SECRET);
  const emailTokenEncryptionKey = readNonEmpty(env.EMAIL_TOKEN_ENCRYPTION_KEY);
  const googleOauthClientId = readNonEmpty(env.GOOGLE_OAUTH_CLIENT_ID) ?? readNonEmpty(env.GOOGLE_CLIENT_ID);
  const googleOauthClientSecret = readNonEmpty(env.GOOGLE_OAUTH_CLIENT_SECRET) ?? readNonEmpty(env.GOOGLE_CLIENT_SECRET);
  const googleOauthRedirectUri = readNonEmpty(env.GOOGLE_OAUTH_REDIRECT_URI) ?? readNonEmpty(env.GOOGLE_REDIRECT_URI);
  const microsoftOauthClientId = readNonEmpty(env.MICROSOFT_OAUTH_CLIENT_ID) ?? readNonEmpty(env.MICROSOFT_CLIENT_ID);
  const microsoftOauthClientSecret = readNonEmpty(env.MICROSOFT_OAUTH_CLIENT_SECRET) ?? readNonEmpty(env.MICROSOFT_CLIENT_SECRET);
  const microsoftOauthRedirectUri = readNonEmpty(env.MICROSOFT_OAUTH_REDIRECT_URI) ?? readNonEmpty(env.MICROSOFT_REDIRECT_URI);
  const microsoftOauthTenantId = readNonEmpty(env.MICROSOFT_OAUTH_TENANT_ID);

  if (!databaseUrl) {
    errors.push("DATABASE_URL is required.");
  } else {
    validateUrl({
      value: databaseUrl,
      name: "DATABASE_URL",
      protocols: databaseProtocols,
      errors
    });
  }

  if (appBaseUrl) {
    validateUrl({
      value: appBaseUrl,
      name: "APP_BASE_URL",
      protocols: ["http:", "https:"],
      errors
    });
  }

  if (authEmailWebhookUrl) {
    const authEmailWebhookUrlIsParseable = isParseableUrl(authEmailWebhookUrl);

    validateUrl({
      value: authEmailWebhookUrl,
      name: "AUTH_EMAIL_WEBHOOK_URL",
      protocols: ["http:", "https:"],
      errors
    });

    if (authEmailWebhookUrlIsParseable && !appBaseUrl) {
      errors.push("APP_BASE_URL is required when AUTH_EMAIL_WEBHOOK_URL is set.");
    }

    if (
      env.NODE_ENV === "production" &&
      appBaseUrl &&
      isParseableUrl(appBaseUrl) &&
      new URL(appBaseUrl).protocol !== "https:"
    ) {
      errors.push("APP_BASE_URL must use https: in production when AUTH_EMAIL_WEBHOOK_URL is set.");
    }

    if (env.NODE_ENV === "production" && authEmailWebhookUrlIsParseable && new URL(authEmailWebhookUrl).protocol !== "https:") {
      errors.push("AUTH_EMAIL_WEBHOOK_URL must use https: in production.");
    }
  }

  if (env.DEV_ACTOR_EMAIL !== undefined && !devActorEmail) {
    errors.push("DEV_ACTOR_EMAIL must not be empty when set.");
  }

  if (env.DEV_WORKSPACE_SLUG !== undefined && !devWorkspaceSlug) {
    errors.push("DEV_WORKSPACE_SLUG must not be empty when set.");
  }

  if (env.AUTH_MODE !== undefined && !authMode) {
    errors.push("AUTH_MODE must not be empty when set.");
  } else if (authMode && !authModes.includes(authMode as (typeof authModes)[number])) {
    errors.push(`AUTH_MODE must be one of: ${authModes.join(", ")}.`);
  }

  if (env.AUTH_USER_ID_HEADER !== undefined && !authUserIdHeader) {
    errors.push("AUTH_USER_ID_HEADER must not be empty when set.");
  } else if (authUserIdHeader && !isSafeAuthUserIdHeaderName(authUserIdHeader)) {
    errors.push("AUTH_USER_ID_HEADER must be a safe HTTP header name for a trusted user id.");
  }

  if (authMode === "trusted-header" && !authUserIdHeader) {
    errors.push("AUTH_USER_ID_HEADER is required when AUTH_MODE is trusted-header.");
  }

  if (env.AUTH_SESSION_SECRET !== undefined && !authSessionSecret) {
    errors.push("AUTH_SESSION_SECRET must not be empty when set.");
  }

  if (authMode === "local" && !authSessionSecret) {
    errors.push("AUTH_SESSION_SECRET is required when AUTH_MODE is local.");
  }

  if (authSessionSecret && authSessionSecret.length < 32) {
    errors.push("AUTH_SESSION_SECRET must be at least 32 characters.");
  }

  validateOauthProviderEnv({
    clientId: googleOauthClientId,
    clientSecret: googleOauthClientSecret,
    errors,
    label: "Google OAuth",
    redirectUri: googleOauthRedirectUri,
    redirectUriName: "GOOGLE_OAUTH_REDIRECT_URI"
  });
  validateOauthProviderEnv({
    clientId: microsoftOauthClientId,
    clientSecret: microsoftOauthClientSecret,
    errors,
    label: "Microsoft OAuth",
    redirectUri: microsoftOauthRedirectUri,
    redirectUriName: "MICROSOFT_OAUTH_REDIRECT_URI"
  });

  if (emailTokenEncryptionKey && !canUseEmailTokenEncryptionKey(env)) {
    errors.push("EMAIL_TOKEN_ENCRYPTION_KEY must decode to at least 32 bytes when set.");
  }

  const emailOauthConfigured = Boolean(
    (googleOauthClientId && googleOauthClientSecret && googleOauthRedirectUri) ||
      (microsoftOauthClientId && microsoftOauthClientSecret && microsoftOauthRedirectUri)
  );
  if (emailOauthConfigured && !emailTokenEncryptionKey) {
    warnings.push("Email OAuth env is configured, but EMAIL_TOKEN_ENCRYPTION_KEY is not set; provider connection buttons stay disabled.");
  }

  if (!authMode && env.NODE_ENV === "production") {
    warnings.push("AUTH_MODE is not set; production runtime defaults to trusted-header and should set AUTH_USER_ID_HEADER explicitly.");
  }

  if (authMode === "demo" && env.NODE_ENV === "production") {
    warnings.push("AUTH_MODE=demo is intended only for local/demo use and should not be used for production traffic.");
  }

  if (env.NODE_ENV === "production" && !authEmailWebhookUrl) {
    warnings.push("AUTH_EMAIL_WEBHOOK_URL is not set; password reset email delivery is disabled.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    warnings,
    env: {
      databaseUrl: databaseUrl as string,
      appBaseUrl,
      authEmailFrom,
      authEmailWebhookToken,
      authEmailWebhookUrl,
      devActorEmail,
      devWorkspaceSlug,
      authMode,
      authUserIdHeader,
      authSessionSecret,
      emailTokenEncryptionKey,
      googleOauthClientId,
      googleOauthClientSecret,
      googleOauthRedirectUri,
      microsoftOauthClientId,
      microsoftOauthClientSecret,
      microsoftOauthRedirectUri,
      microsoftOauthTenantId
    }
  };
}

export function requireRuntimeEnv(env: EnvInput = process.env) {
  const result = validateRuntimeEnv(env);
  if (!result.ok) {
    throw new Error(`Invalid runtime environment:\n- ${result.errors.join("\n- ")}`);
  }
  return result.env;
}

function readNonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isParseableUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function validateUrl({
  value,
  name,
  protocols,
  errors
}: {
  value: string;
  name: string;
  protocols: readonly string[];
  errors: string[];
}) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${name} must be a valid URL.`);
    return;
  }

  if (!protocols.includes(parsed.protocol)) {
    errors.push(`${name} must use one of: ${protocols.join(", ")}.`);
  }
}

function validateOauthProviderEnv({
  clientId,
  clientSecret,
  errors,
  label,
  redirectUri,
  redirectUriName
}: {
  clientId?: string;
  clientSecret?: string;
  errors: string[];
  label: string;
  redirectUri?: string;
  redirectUriName: string;
}) {
  const anySet = Boolean(clientId || clientSecret || redirectUri);
  const allSet = Boolean(clientId && clientSecret && redirectUri);
  if (anySet && !allSet) {
    errors.push(`${label} requires client id, client secret, and redirect URI when any provider env var is set.`);
  }
  if (redirectUri) {
    validateUrl({
      value: redirectUri,
      name: redirectUriName,
      protocols: ["http:", "https:"],
      errors
    });
  }
}
