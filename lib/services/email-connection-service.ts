import { EmailConnectionProvider, EmailConnectionStatus, Prisma, type EmailDirection } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { canUseEmailTokenEncryptionKey, decryptEmailToken, encryptEmailToken } from "@/lib/email/token-encryption";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

type ProviderConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

type EmailConnectionEnv = Record<string, string | undefined>;
type GmailFetch = typeof fetch;
type MicrosoftFetch = typeof fetch;

export type EmailProviderCard = {
  accountEmail?: string | null;
  actionLabel: string;
  detail: string;
  disabled: boolean;
  href?: string;
  lastSyncAt?: Date | null;
  name: string;
  provider: EmailConnectionProvider;
  scopes: string[];
  syncAvailable?: boolean;
  syncLabel?: string;
  status: string;
};

export type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export type GoogleUserProfile = {
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export type MicrosoftTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export type MicrosoftUserProfile = {
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
};

type GmailListResponse = {
  messages?: { id?: string; threadId?: string }[];
  nextPageToken?: string;
};

type GmailMessageResponse = {
  id?: string;
  internalDate?: string;
  payload?: {
    headers?: { name?: string; value?: string }[];
  };
  snippet?: string;
  threadId?: string;
};

type MicrosoftMessageResponse = {
  bodyPreview?: string | null;
  ccRecipients?: MicrosoftRecipient[];
  conversationId?: string | null;
  from?: MicrosoftRecipient | null;
  id?: string;
  receivedDateTime?: string | null;
  sentDateTime?: string | null;
  subject?: string | null;
  toRecipients?: MicrosoftRecipient[];
};

type MicrosoftRecipient = {
  emailAddress?: {
    address?: string | null;
    name?: string | null;
  } | null;
};

type MicrosoftMessagesResponse = {
  value?: MicrosoftMessageResponse[];
};

export type GmailSyncResult = {
  created: number;
  skippedDuplicates: number;
  skippedUnmatched: number;
  totalFetched: number;
  unmatchedPreviews: EmailSyncPreview[];
};

export type MicrosoftSyncResult = GmailSyncResult;

export type EmailSyncPreview = {
  direction: "INBOUND" | "OUTBOUND";
  email: string | null;
  fromText: string | null;
  occurredAt: string;
  provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365";
  providerMessageId: string;
  snippet: string | null;
  subject: string;
  toText: string | null;
};

export const gmailOAuthScopes = ["openid", "email", "https://www.googleapis.com/auth/gmail.metadata"] as const;
export const microsoftOAuthScopes = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Read"] as const;

const providerLabels: Record<EmailConnectionProvider, string> = {
  GOOGLE_WORKSPACE: "Gmail / Google Workspace",
  MICROSOFT_365: "Microsoft 365 / Outlook",
  IMAP_SMTP: "IMAP / SMTP"
};

export async function listEmailConnectionProviderCards(
  actor: WorkspaceActor,
  env: EmailConnectionEnv = process.env
): Promise<EmailProviderCard[]> {
  await ensureWorkspaceAccess(actor);
  const connections = await prisma.emailConnection.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    orderBy: [{ provider: "asc" }, { updatedAt: "desc" }]
  });
  const latestConnectionByProvider = new Map<(typeof connections)[number]["provider"], (typeof connections)[number]>();
  for (const connection of connections) {
    if (!latestConnectionByProvider.has(connection.provider)) {
      latestConnectionByProvider.set(connection.provider, connection);
    }
  }
  const tokenEncryptionReady = isTokenEncryptionConfigured(env);

  return [
    googleProviderCard({
      connection: latestConnectionByProvider.get("GOOGLE_WORKSPACE"),
      config: resolveGoogleOAuthConfig(env),
      provider: "GOOGLE_WORKSPACE",
      tokenEncryptionReady
    }),
    microsoftProviderCard({
      connection: latestConnectionByProvider.get("MICROSOFT_365"),
      connectionStatus: latestConnectionByProvider.get("MICROSOFT_365")?.status,
      config: resolveMicrosoftOAuthConfig(env),
      tokenEncryptionReady
    }),
    {
      actionLabel: "Planned",
      detail:
        "Planned fallback for Yahoo Mail, Zoho Mail, Fastmail, iCloud, custom domains, and hosting-provider email. Manual email logging is available now.",
      disabled: true,
      name: providerLabels.IMAP_SMTP,
      provider: "IMAP_SMTP",
      scopes: [],
      status: latestConnectionByProvider.get("IMAP_SMTP")?.status ?? "Planned"
    }
  ];
}

export function isTokenEncryptionConfigured(env: EmailConnectionEnv = process.env) {
  return canUseEmailTokenEncryptionKey(env);
}

export function resolveGoogleOAuthConfig(env: EmailConnectionEnv = process.env): ProviderConfig {
  return {
    clientId: readNonEmpty(env.GOOGLE_OAUTH_CLIENT_ID) ?? readNonEmpty(env.GOOGLE_CLIENT_ID),
    clientSecret: readNonEmpty(env.GOOGLE_OAUTH_CLIENT_SECRET) ?? readNonEmpty(env.GOOGLE_CLIENT_SECRET),
    redirectUri: readNonEmpty(env.GOOGLE_OAUTH_REDIRECT_URI) ?? readNonEmpty(env.GOOGLE_REDIRECT_URI)
  };
}

export function resolveMicrosoftOAuthConfig(env: EmailConnectionEnv = process.env): ProviderConfig {
  return {
    clientId: readNonEmpty(env.MICROSOFT_OAUTH_CLIENT_ID) ?? readNonEmpty(env.MICROSOFT_CLIENT_ID),
    clientSecret: readNonEmpty(env.MICROSOFT_OAUTH_CLIENT_SECRET) ?? readNonEmpty(env.MICROSOFT_CLIENT_SECRET),
    redirectUri: readNonEmpty(env.MICROSOFT_OAUTH_REDIRECT_URI) ?? readNonEmpty(env.MICROSOFT_REDIRECT_URI)
  };
}

export function assertGoogleOAuthReady(env: EmailConnectionEnv = process.env) {
  const config = resolveGoogleOAuthConfig(env);
  if (!isProviderConfigured(config)) {
    throw new ApiError("EMAIL_PROVIDER_NOT_CONFIGURED", "Gmail OAuth is not configured.", 400);
  }
  if (!isTokenEncryptionConfigured(env)) {
    throw new ApiError("EMAIL_TOKEN_ENCRYPTION_NOT_CONFIGURED", "Email token encryption is not configured.", 400);
  }
  return config as Required<ProviderConfig>;
}

export function assertMicrosoftOAuthReady(env: EmailConnectionEnv = process.env) {
  const config = resolveMicrosoftOAuthConfig(env);
  if (!isProviderConfigured(config)) {
    throw new ApiError("EMAIL_PROVIDER_NOT_CONFIGURED", "Microsoft OAuth is not configured.", 400);
  }
  if (!isTokenEncryptionConfigured(env)) {
    throw new ApiError("EMAIL_TOKEN_ENCRYPTION_NOT_CONFIGURED", "Email token encryption is not configured.", 400);
  }
  return config as Required<ProviderConfig>;
}

export function buildGoogleAuthorizationUrl({
  config,
  state
}: {
  config: Required<ProviderConfig>;
  state: string;
}) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", gmailOAuthScopes.join(" "));
  url.searchParams.set("state", state);
  return url;
}

export function buildMicrosoftAuthorizationUrl({
  config,
  env = process.env,
  state
}: {
  config: Required<ProviderConfig>;
  env?: EmailConnectionEnv;
  state: string;
}) {
  const url = new URL(`https://login.microsoftonline.com/${resolveMicrosoftTenant(env)}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", microsoftOAuthScopes.join(" "));
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeGoogleAuthorizationCode({
  code,
  config,
  fetchImpl = fetch
}: {
  code: string;
  config: Required<ProviderConfig>;
  fetchImpl?: typeof fetch;
}): Promise<GoogleTokenResponse> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    })
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_OAUTH_TOKEN_EXCHANGE_FAILED", "Gmail authorization could not be completed.", 400);
  }

  const tokenResponse = (await response.json()) as GoogleTokenResponse;
  if (!tokenResponse.access_token) {
    throw new ApiError("EMAIL_OAUTH_TOKEN_MISSING", "Gmail did not return an access token.", 400);
  }

  return tokenResponse;
}

export async function exchangeMicrosoftAuthorizationCode({
  code,
  config,
  env = process.env,
  fetchImpl = fetch
}: {
  code: string;
  config: Required<ProviderConfig>;
  env?: EmailConnectionEnv;
  fetchImpl?: MicrosoftFetch;
}): Promise<MicrosoftTokenResponse> {
  const response = await fetchImpl(`https://login.microsoftonline.com/${resolveMicrosoftTenant(env)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri
    })
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_OAUTH_TOKEN_EXCHANGE_FAILED", "Microsoft authorization could not be completed.", 400);
  }

  const tokenResponse = (await response.json()) as MicrosoftTokenResponse;
  if (!tokenResponse.access_token) {
    throw new ApiError("EMAIL_OAUTH_TOKEN_MISSING", "Microsoft did not return an access token.", 400);
  }

  return tokenResponse;
}

export async function fetchGoogleUserProfile({
  accessToken,
  fetchImpl = fetch
}: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleUserProfile> {
  const response = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_OAUTH_PROFILE_FAILED", "Gmail account profile could not be loaded.", 400);
  }

  const profile = (await response.json()) as GoogleUserProfile;
  if (!profile.email) {
    throw new ApiError("EMAIL_OAUTH_PROFILE_MISSING_EMAIL", "Gmail did not return an account email address.", 400);
  }

  return profile;
}

export async function fetchMicrosoftUserProfile({
  accessToken,
  fetchImpl = fetch
}: {
  accessToken: string;
  fetchImpl?: MicrosoftFetch;
}): Promise<MicrosoftUserProfile> {
  const response = await fetchImpl("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_OAUTH_PROFILE_FAILED", "Microsoft account profile could not be loaded.", 400);
  }

  const profile = (await response.json()) as MicrosoftUserProfile;
  if (!profile.mail && !profile.userPrincipalName) {
    throw new ApiError("EMAIL_OAUTH_PROFILE_MISSING_EMAIL", "Microsoft did not return an account email address.", 400);
  }

  return profile;
}

export async function storeGoogleOAuthConnection({
  actor,
  profile,
  tokenResponse,
  env = process.env
}: {
  actor: WorkspaceActor;
  profile: Required<Pick<GoogleUserProfile, "email">> & GoogleUserProfile;
  tokenResponse: GoogleTokenResponse;
  env?: EmailConnectionEnv;
}) {
  await ensureWorkspaceAccess(actor);
  if (!tokenResponse.access_token) {
    throw new ApiError("EMAIL_OAUTH_TOKEN_MISSING", "Gmail did not return an access token.", 400);
  }

  const scopes = normalizeScopes(tokenResponse.scope);
  const accountEmail = profile.email.toLowerCase();
  const connection = await prisma.emailConnection.upsert({
    where: {
      workspaceId_provider_accountEmail: {
        workspaceId: actor.workspaceId,
        provider: "GOOGLE_WORKSPACE",
        accountEmail
      }
    },
    create: {
      accountEmail,
      createdById: actor.actorUserId,
      displayName: profile.name,
      provider: "GOOGLE_WORKSPACE",
      scopes,
      status: "CONNECTED",
      workspaceId: actor.workspaceId
    },
    update: {
      displayName: profile.name,
      lastError: null,
      scopes,
      status: "CONNECTED"
    }
  });

  const existingSecret = await prisma.emailConnectionSecret.findUnique({
    where: { connectionId: connection.id },
    select: { encryptedRefreshToken: true }
  });
  const encryptedRefreshToken = tokenResponse.refresh_token
    ? encryptEmailToken(tokenResponse.refresh_token, env)
    : existingSecret?.encryptedRefreshToken;
  const accessTokenExpiresAt = tokenResponse.expires_in ? new Date(Date.now() + tokenResponse.expires_in * 1000) : null;

  await prisma.emailConnectionSecret.upsert({
    where: { connectionId: connection.id },
    create: {
      accessTokenExpiresAt,
      accountEmail,
      connectionId: connection.id,
      encryptedAccessToken: encryptEmailToken(tokenResponse.access_token, env),
      encryptedRefreshToken,
      provider: "GOOGLE_WORKSPACE",
      scopes,
      userId: actor.actorUserId,
      workspaceId: actor.workspaceId
    },
    update: {
      accessTokenExpiresAt,
      accountEmail,
      encryptedAccessToken: encryptEmailToken(tokenResponse.access_token, env),
      encryptedRefreshToken,
      scopes,
      userId: actor.actorUserId
    }
  });

  await writeAuditLog(actor, "email_connection.connected", "EmailConnection", connection.id, {
    accountEmail,
    provider: "GOOGLE_WORKSPACE",
    scopes
  });

  return connection;
}

export async function storeMicrosoftOAuthConnection({
  actor,
  profile,
  tokenResponse,
  env = process.env
}: {
  actor: WorkspaceActor;
  profile: Required<Pick<MicrosoftUserProfile, "mail" | "userPrincipalName">> & MicrosoftUserProfile;
  tokenResponse: MicrosoftTokenResponse;
  env?: EmailConnectionEnv;
}) {
  await ensureWorkspaceAccess(actor);
  if (!tokenResponse.access_token) {
    throw new ApiError("EMAIL_OAUTH_TOKEN_MISSING", "Microsoft did not return an access token.", 400);
  }

  const scopes = normalizeScopes(tokenResponse.scope, microsoftOAuthScopes);
  const profileEmail = profile.mail ?? profile.userPrincipalName;
  if (!profileEmail) {
    throw new ApiError("EMAIL_OAUTH_PROFILE_MISSING_EMAIL", "Microsoft did not return an account email address.", 400);
  }
  const accountEmail = profileEmail.toLowerCase();
  const connection = await prisma.emailConnection.upsert({
    where: {
      workspaceId_provider_accountEmail: {
        workspaceId: actor.workspaceId,
        provider: "MICROSOFT_365",
        accountEmail
      }
    },
    create: {
      accountEmail,
      createdById: actor.actorUserId,
      displayName: profile.displayName,
      provider: "MICROSOFT_365",
      scopes,
      status: "CONNECTED",
      workspaceId: actor.workspaceId
    },
    update: {
      displayName: profile.displayName,
      lastError: null,
      scopes,
      status: "CONNECTED"
    }
  });

  const existingSecret = await prisma.emailConnectionSecret.findUnique({
    where: { connectionId: connection.id },
    select: { encryptedRefreshToken: true }
  });
  const encryptedRefreshToken = tokenResponse.refresh_token
    ? encryptEmailToken(tokenResponse.refresh_token, env)
    : existingSecret?.encryptedRefreshToken;
  const accessTokenExpiresAt = tokenResponse.expires_in ? new Date(Date.now() + tokenResponse.expires_in * 1000) : null;

  await prisma.emailConnectionSecret.upsert({
    where: { connectionId: connection.id },
    create: {
      accessTokenExpiresAt,
      accountEmail,
      connectionId: connection.id,
      encryptedAccessToken: encryptEmailToken(tokenResponse.access_token, env),
      encryptedRefreshToken,
      provider: "MICROSOFT_365",
      scopes,
      userId: actor.actorUserId,
      workspaceId: actor.workspaceId
    },
    update: {
      accessTokenExpiresAt,
      accountEmail,
      encryptedAccessToken: encryptEmailToken(tokenResponse.access_token, env),
      encryptedRefreshToken,
      scopes,
      userId: actor.actorUserId
    }
  });

  await writeAuditLog(actor, "email_connection.connected", "EmailConnection", connection.id, {
    accountEmail,
    provider: "MICROSOFT_365",
    scopes
  });

  return connection;
}

export async function syncRecentGmailMessages({
  actor,
  env = process.env,
  fetchImpl = fetch,
  maxResults = 10
}: {
  actor: WorkspaceActor;
  env?: EmailConnectionEnv;
  fetchImpl?: GmailFetch;
  maxResults?: number;
}): Promise<GmailSyncResult> {
  await ensureWorkspaceAccess(actor);
  const config = assertGoogleOAuthReady(env);
  const connection = await prisma.emailConnection.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      provider: "GOOGLE_WORKSPACE",
      status: "CONNECTED",
      deletedAt: null
    },
    include: { secret: true },
    orderBy: { updatedAt: "desc" }
  });

  if (!connection?.secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before syncing recent messages.", 400);
  }

  const accessToken = await resolveUsableGoogleAccessToken({ config, connection, env, fetchImpl });
  const contacts = await prisma.person.findMany({
    where: {
      workspaceId: actor.workspaceId,
      deletedAt: null,
      email: { not: null }
    },
    select: {
      deals: {
        where: { deletedAt: null, status: "OPEN" },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
        take: 1
      },
      email: true,
      id: true,
      organizationId: true
    }
  });
  const contactByEmail = new Map(
    contacts
      .map((contact) => [normalizeEmailAddress(contact.email), contact] as const)
      .filter((item): item is readonly [string, (typeof contacts)[number]] => Boolean(item[0]))
  );

  const messages = await listRecentGmailMessages({ accessToken, fetchImpl, maxResults });
  const ids = messages.map((message) => message.id).filter((id): id is string => Boolean(id));
  const existingLogs = ids.length
    ? await prisma.emailLog.findMany({
        where: {
          workspaceId: actor.workspaceId,
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: { in: ids }
        },
        select: { providerMessageId: true }
      })
    : [];
  const existingIds = new Set(existingLogs.map((log) => log.providerMessageId).filter(Boolean));
  let created = 0;
  let skippedDuplicates = 0;
  let skippedUnmatched = 0;
  const unmatchedPreviews: EmailSyncPreview[] = [];

  for (const message of messages) {
    if (!message.id) continue;
    if (existingIds.has(message.id)) {
      skippedDuplicates += 1;
      continue;
    }

    const metadata = await getGmailMessageMetadata({ accessToken, fetchImpl, messageId: message.id });
    const normalized = normalizeGmailMessage(metadata, connection.accountEmail ?? connection.secret.accountEmail);
    const match = matchGmailMessageToContact(normalized, contactByEmail);
    if (!match) {
      skippedUnmatched += 1;
      addUnmatchedPreview(unmatchedPreviews, "GOOGLE_WORKSPACE", message.id, normalized);
      continue;
    }

    try {
      await prisma.emailLog.create({
        data: {
          body: normalized.snippet ? `Gmail snippet: ${normalized.snippet}` : "Gmail metadata imported without message body.",
          dealId: match.deals[0]?.id ?? null,
          direction: normalized.direction as EmailDirection,
          fromText: normalized.fromText,
          organizationId: match.organizationId,
          occurredAt: normalized.occurredAt,
          personId: match.id,
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: message.id,
          providerThreadId: metadata.threadId ?? message.threadId ?? null,
          subject: normalized.subject,
          toText: normalized.toText,
          workspaceId: actor.workspaceId,
          createdById: actor.actorUserId
        }
      });
      existingIds.add(message.id);
      created += 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        skippedDuplicates += 1;
        continue;
      }
      throw error;
    }
  }

  await prisma.emailConnection.update({
    where: { id: connection.id },
    data: {
      lastError: null,
      lastSyncAt: new Date(),
      lastSyncCursor: messages[0]?.id ?? connection.lastSyncCursor
    }
  });
  await writeAuditLog(actor, "email_connection.synced", "EmailConnection", connection.id, {
    created,
    provider: "GOOGLE_WORKSPACE",
    skippedDuplicates,
    skippedUnmatched,
    totalFetched: messages.length
  });

  return { created, skippedDuplicates, skippedUnmatched, totalFetched: messages.length, unmatchedPreviews };
}

export async function syncRecentMicrosoftMessages({
  actor,
  env = process.env,
  fetchImpl = fetch,
  maxResults = 10
}: {
  actor: WorkspaceActor;
  env?: EmailConnectionEnv;
  fetchImpl?: MicrosoftFetch;
  maxResults?: number;
}): Promise<MicrosoftSyncResult> {
  await ensureWorkspaceAccess(actor);
  const config = assertMicrosoftOAuthReady(env);
  const connection = await prisma.emailConnection.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      provider: "MICROSOFT_365",
      status: "CONNECTED",
      deletedAt: null
    },
    include: { secret: true },
    orderBy: { updatedAt: "desc" }
  });

  if (!connection?.secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Microsoft 365 or Outlook before syncing recent messages.", 400);
  }

  const accessToken = await resolveUsableMicrosoftAccessToken({ config, connection, env, fetchImpl });
  const contacts = await prisma.person.findMany({
    where: {
      workspaceId: actor.workspaceId,
      deletedAt: null,
      email: { not: null }
    },
    select: {
      deals: {
        where: { deletedAt: null, status: "OPEN" },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
        take: 1
      },
      email: true,
      id: true,
      organizationId: true
    }
  });
  const contactByEmail = buildContactEmailMap(contacts);

  const messages = await listRecentMicrosoftMessages({ accessToken, fetchImpl, maxResults });
  const ids = messages.map((message) => message.id).filter((id): id is string => Boolean(id));
  const existingLogs = ids.length
    ? await prisma.emailLog.findMany({
        where: {
          workspaceId: actor.workspaceId,
          provider: "MICROSOFT_365",
          providerMessageId: { in: ids }
        },
        select: { providerMessageId: true }
      })
    : [];
  const existingIds = new Set(existingLogs.map((log) => log.providerMessageId).filter(Boolean));
  let created = 0;
  let skippedDuplicates = 0;
  let skippedUnmatched = 0;
  const unmatchedPreviews: EmailSyncPreview[] = [];

  for (const message of messages) {
    if (!message.id) continue;
    if (existingIds.has(message.id)) {
      skippedDuplicates += 1;
      continue;
    }

    const normalized = normalizeMicrosoftMessage(message, connection.accountEmail ?? connection.secret.accountEmail);
    const match = matchEmailMessageToContact(normalized, contactByEmail);
    if (!match) {
      skippedUnmatched += 1;
      addUnmatchedPreview(unmatchedPreviews, "MICROSOFT_365", message.id, normalized);
      continue;
    }

    try {
      await prisma.emailLog.create({
        data: {
          body: normalized.snippet ? `Microsoft snippet: ${normalized.snippet}` : "Microsoft metadata imported without message body.",
          dealId: match.deals[0]?.id ?? null,
          direction: normalized.direction as EmailDirection,
          fromText: normalized.fromText,
          organizationId: match.organizationId,
          occurredAt: normalized.occurredAt,
          personId: match.id,
          provider: "MICROSOFT_365",
          providerMessageId: message.id,
          providerThreadId: message.conversationId ?? null,
          subject: normalized.subject,
          toText: normalized.toText,
          workspaceId: actor.workspaceId,
          createdById: actor.actorUserId
        }
      });
      existingIds.add(message.id);
      created += 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        skippedDuplicates += 1;
        continue;
      }
      throw error;
    }
  }

  await prisma.emailConnection.update({
    where: { id: connection.id },
    data: {
      lastError: null,
      lastSyncAt: new Date(),
      lastSyncCursor: messages[0]?.id ?? connection.lastSyncCursor
    }
  });
  await writeAuditLog(actor, "email_connection.synced", "EmailConnection", connection.id, {
    created,
    provider: "MICROSOFT_365",
    skippedDuplicates,
    skippedUnmatched,
    totalFetched: messages.length
  });

  return { created, skippedDuplicates, skippedUnmatched, totalFetched: messages.length, unmatchedPreviews };
}

async function resolveUsableGoogleAccessToken({
  config,
  connection,
  env,
  fetchImpl
}: {
  config: Required<ProviderConfig>;
  connection: NonNullable<Awaited<ReturnType<typeof prisma.emailConnection.findFirst<{ include: { secret: true } }>>>>;
  env: EmailConnectionEnv;
  fetchImpl: GmailFetch;
}) {
  const secret = connection.secret;
  if (!secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before syncing recent messages.", 400);
  }

  if (!secret.accessTokenExpiresAt || secret.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptEmailToken(secret.encryptedAccessToken, env);
  }

  if (!secret.encryptedRefreshToken) {
    throw new ApiError("EMAIL_REFRESH_TOKEN_MISSING", "Reconnect Gmail before syncing; the access token expired.", 400);
  }

  const refreshed = await refreshGoogleAccessToken({
    config,
    fetchImpl,
    refreshToken: decryptEmailToken(secret.encryptedRefreshToken, env)
  });
  const accessTokenExpiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null;

  await prisma.emailConnectionSecret.update({
    where: { connectionId: connection.id },
    data: {
      accessTokenExpiresAt,
      encryptedAccessToken: encryptEmailToken(refreshed.access_token as string, env)
    }
  });

  return refreshed.access_token as string;
}

async function resolveUsableMicrosoftAccessToken({
  config,
  connection,
  env,
  fetchImpl
}: {
  config: Required<ProviderConfig>;
  connection: NonNullable<Awaited<ReturnType<typeof prisma.emailConnection.findFirst<{ include: { secret: true } }>>>>;
  env: EmailConnectionEnv;
  fetchImpl: MicrosoftFetch;
}) {
  const secret = connection.secret;
  if (!secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Microsoft 365 or Outlook before syncing recent messages.", 400);
  }

  if (!secret.accessTokenExpiresAt || secret.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptEmailToken(secret.encryptedAccessToken, env);
  }

  if (!secret.encryptedRefreshToken) {
    throw new ApiError("EMAIL_REFRESH_TOKEN_MISSING", "Reconnect Microsoft before syncing; the access token expired.", 400);
  }

  const refreshed = await refreshMicrosoftAccessToken({
    config,
    env,
    fetchImpl,
    refreshToken: decryptEmailToken(secret.encryptedRefreshToken, env)
  });
  const accessTokenExpiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000) : null;

  await prisma.emailConnectionSecret.update({
    where: { connectionId: connection.id },
    data: {
      accessTokenExpiresAt,
      encryptedAccessToken: encryptEmailToken(refreshed.access_token as string, env)
    }
  });

  return refreshed.access_token as string;
}

async function refreshGoogleAccessToken({
  config,
  fetchImpl,
  refreshToken
}: {
  config: Required<ProviderConfig>;
  fetchImpl: GmailFetch;
  refreshToken: string;
}) {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_REFRESH_TOKEN_FAILED", "Gmail access token could not be refreshed.", 400);
  }

  const tokenResponse = (await response.json()) as GoogleTokenResponse;
  if (!tokenResponse.access_token) {
    throw new ApiError("EMAIL_REFRESH_TOKEN_MISSING_ACCESS", "Gmail did not return a refreshed access token.", 400);
  }

  return tokenResponse;
}

async function refreshMicrosoftAccessToken({
  config,
  env,
  fetchImpl,
  refreshToken
}: {
  config: Required<ProviderConfig>;
  env: EmailConnectionEnv;
  fetchImpl: MicrosoftFetch;
  refreshToken: string;
}) {
  const response = await fetchImpl(`https://login.microsoftonline.com/${resolveMicrosoftTenant(env)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_REFRESH_TOKEN_FAILED", "Microsoft access token could not be refreshed.", 400);
  }

  const tokenResponse = (await response.json()) as MicrosoftTokenResponse;
  if (!tokenResponse.access_token) {
    throw new ApiError("EMAIL_REFRESH_TOKEN_MISSING_ACCESS", "Microsoft did not return a refreshed access token.", 400);
  }

  return tokenResponse;
}

async function listRecentGmailMessages({
  accessToken,
  fetchImpl,
  maxResults
}: {
  accessToken: string;
  fetchImpl: GmailFetch;
  maxResults: number;
}) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("maxResults", String(Math.min(Math.max(maxResults, 1), 25)));
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_LIST_FAILED", "Recent Gmail messages could not be listed.", 400);
  }

  const body = (await response.json()) as GmailListResponse;
  return body.messages?.filter((message) => message.id) ?? [];
}

async function getGmailMessageMetadata({
  accessToken,
  fetchImpl,
  messageId
}: {
  accessToken: string;
  fetchImpl: GmailFetch;
  messageId: string;
}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "metadata");
  for (const header of ["Subject", "From", "To", "Cc", "Date"]) {
    url.searchParams.append("metadataHeaders", header);
  }
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_MESSAGE_FAILED", "Gmail message metadata could not be loaded.", 400);
  }

  return (await response.json()) as GmailMessageResponse;
}

async function listRecentMicrosoftMessages({
  accessToken,
  fetchImpl,
  maxResults
}: {
  accessToken: string;
  fetchImpl: MicrosoftFetch;
  maxResults: number;
}) {
  const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
  url.searchParams.set("$top", String(Math.min(Math.max(maxResults, 1), 25)));
  url.searchParams.set("$orderby", "receivedDateTime desc");
  url.searchParams.set(
    "$select",
    "id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview"
  );
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_MICROSOFT_LIST_FAILED", "Recent Microsoft mail could not be listed.", 400);
  }

  const body = (await response.json()) as MicrosoftMessagesResponse;
  return body.value?.filter((message) => message.id) ?? [];
}

function normalizeGmailMessage(message: GmailMessageResponse, accountEmail: string) {
  const headers = new Map((message.payload?.headers ?? []).map((header) => [header.name?.toLowerCase() ?? "", header.value ?? ""]));
  const fromText = optionalText(headers.get("from"));
  const toText = optionalText(headers.get("to"));
  const ccText = optionalText(headers.get("cc"));
  const account = normalizeEmailAddress(accountEmail);
  const fromEmails = extractEmailAddresses(fromText);
  const toEmails = [...extractEmailAddresses(toText), ...extractEmailAddresses(ccText)];
  const direction = account && fromEmails.includes(account) ? "OUTBOUND" : "INBOUND";
  const occurredAt = parseGmailDate(headers.get("date"), message.internalDate);

  return {
    ccText,
    direction,
    fromEmails,
    fromText,
    occurredAt,
    snippet: optionalText(message.snippet),
    subject: optionalText(headers.get("subject")) ?? "(No subject)",
    toEmails,
    toText
  };
}

function normalizeMicrosoftMessage(message: MicrosoftMessageResponse, accountEmail: string) {
  const fromText = formatMicrosoftRecipient(message.from);
  const toText = formatMicrosoftRecipients(message.toRecipients ?? []);
  const ccText = formatMicrosoftRecipients(message.ccRecipients ?? []);
  const account = normalizeEmailAddress(accountEmail);
  const fromEmails = extractMicrosoftRecipientEmails(message.from ? [message.from] : []);
  const toEmails = [
    ...extractMicrosoftRecipientEmails(message.toRecipients ?? []),
    ...extractMicrosoftRecipientEmails(message.ccRecipients ?? [])
  ];
  const direction = account && fromEmails.includes(account) ? "OUTBOUND" : "INBOUND";
  const occurredAt = parseMicrosoftDate(message.receivedDateTime, message.sentDateTime);

  return {
    ccText,
    direction,
    fromEmails,
    fromText,
    occurredAt,
    snippet: optionalText(message.bodyPreview),
    subject: optionalText(message.subject) ?? "(No subject)",
    toEmails,
    toText
  };
}

function matchGmailMessageToContact(
  message: ReturnType<typeof normalizeGmailMessage>,
  contactByEmail: Map<string, { deals: { id: string }[]; email: string | null; id: string; organizationId: string | null }>
) {
  return matchEmailMessageToContact(message, contactByEmail);
}

function matchEmailMessageToContact(
  message: { direction: string; fromEmails: string[]; toEmails: string[] },
  contactByEmail: Map<string, { deals: { id: string }[]; email: string | null; id: string; organizationId: string | null }>
) {
  const candidates = message.direction === "OUTBOUND" ? message.toEmails : message.fromEmails;
  for (const email of candidates) {
    const contact = contactByEmail.get(email);
    if (contact) return contact;
  }
  return null;
}

function addUnmatchedPreview(
  previews: EmailSyncPreview[],
  provider: EmailSyncPreview["provider"],
  providerMessageId: string,
  message: ReturnType<typeof normalizeGmailMessage> | ReturnType<typeof normalizeMicrosoftMessage>
) {
  if (previews.length >= 5) return;
  previews.push({
    direction: message.direction as EmailSyncPreview["direction"],
    email: primaryExternalEmail(message),
    fromText: truncateEmailPreviewText(message.fromText, 160),
    occurredAt: message.occurredAt.toISOString(),
    provider,
    providerMessageId,
    snippet: truncateEmailPreviewText(message.snippet, 240),
    subject: truncateEmailPreviewText(message.subject, 160) ?? "(No subject)",
    toText: truncateEmailPreviewText(message.toText, 160)
  });
}

function primaryExternalEmail(message: { direction: string; fromEmails: string[]; toEmails: string[] }) {
  const candidates = message.direction === "OUTBOUND" ? message.toEmails : message.fromEmails;
  return candidates[0] ?? null;
}

function truncateEmailPreviewText(value: string | null | undefined, maxLength: number) {
  const trimmed = optionalText(value);
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}...` : trimmed;
}

function googleProviderCard({
  config,
  connection,
  provider,
  tokenEncryptionReady
}: {
  config: ProviderConfig;
  connection?: { accountEmail: string | null; lastSyncAt: Date | null; status: EmailConnectionStatus };
  provider: "GOOGLE_WORKSPACE";
  tokenEncryptionReady: boolean;
}): EmailProviderCard {
  const configured = isProviderConfigured(config);

  if (!configured) {
    return {
      actionLabel: "Configure OAuth",
      detail: "Add the Google OAuth client id, client secret, and redirect URI env vars before Gmail can connect.",
      disabled: true,
      name: providerLabels[provider],
      provider,
      scopes: [...gmailOAuthScopes],
      status: "Not configured"
    };
  }

  if (!tokenEncryptionReady) {
    return {
      actionLabel: "Encryption required",
      detail: "Google OAuth config is present, but token encryption is not configured. Northstar will not store OAuth tokens in plaintext.",
      disabled: true,
      name: providerLabels[provider],
      provider,
      scopes: [...gmailOAuthScopes],
      status: "Token encryption required"
    };
  }

  return {
    accountEmail: connection?.accountEmail,
    actionLabel: connection?.status === "CONNECTED" ? "Reconnect Gmail" : "Connect Gmail",
    detail:
      connection?.status === "CONNECTED" && connection.accountEmail
        ? `Connected to ${connection.accountEmail}. Use manual sync to import recent matched metadata from known contacts.`
        : "Connect Gmail with read-only profile and Gmail metadata scopes. This stores encrypted OAuth tokens only; manual sync imports matched recent metadata after connection.",
    disabled: false,
    href: "/api/email-connections/google/connect",
    lastSyncAt: connection?.lastSyncAt,
    name: providerLabels[provider],
    provider,
    scopes: [...gmailOAuthScopes],
    syncAvailable: connection?.status === "CONNECTED",
    status: connection?.status === "CONNECTED" ? "Connected" : "Ready to connect"
  };
}

function microsoftProviderCard({
  connection,
  config,
  connectionStatus,
  tokenEncryptionReady
}: {
  connection?: { accountEmail: string | null; lastSyncAt: Date | null; status: EmailConnectionStatus };
  config: ProviderConfig;
  connectionStatus?: EmailConnectionStatus;
  tokenEncryptionReady: boolean;
}): EmailProviderCard {
  const configured = isProviderConfigured(config);
  const scopes = ["Mail.Read", "User.Read"];

  if (!configured) {
    return {
      actionLabel: "Configure OAuth",
      detail:
        "Add the Microsoft OAuth client id, client secret, redirect URI, and token encryption key before Microsoft 365 or Outlook can connect.",
      disabled: true,
      name: providerLabels.MICROSOFT_365,
      provider: "MICROSOFT_365",
      scopes,
      status: "Not configured"
    };
  }

  if (!tokenEncryptionReady) {
    return {
      actionLabel: "Encryption required",
      detail: "OAuth config is present, but token encryption is not configured. Northstar will not store OAuth tokens in plaintext.",
      disabled: true,
      name: providerLabels.MICROSOFT_365,
      provider: "MICROSOFT_365",
      scopes,
      status: "Token encryption required"
    };
  }

  return {
    accountEmail: connection?.accountEmail,
    actionLabel: connection?.status === "CONNECTED" ? "Reconnect Microsoft" : "Connect Microsoft",
    detail: connectionStatus
      ? `Connected to ${connection?.accountEmail ?? "Microsoft 365 / Outlook"}. Use manual sync to import recent matched metadata from known contacts.`
      : "Connect Microsoft 365 or Outlook with read-only profile and mail scopes. This stores encrypted OAuth tokens only; manual sync imports matched recent metadata after connection.",
    disabled: false,
    href: "/api/email-connections/microsoft/connect",
    lastSyncAt: connection?.lastSyncAt,
    name: providerLabels.MICROSOFT_365,
    provider: "MICROSOFT_365",
    scopes,
    syncAvailable: connection?.status === "CONNECTED",
    syncLabel: "Sync recent Microsoft mail",
    status: connection?.status === "CONNECTED" ? "Connected" : "Ready to connect"
  };
}

function isProviderConfigured(config: ProviderConfig) {
  return Boolean(readNonEmpty(config.clientId) && readNonEmpty(config.clientSecret) && readNonEmpty(config.redirectUri));
}

function normalizeScopes(scope: string | undefined, fallback: readonly string[] = gmailOAuthScopes) {
  const scopes = scope?.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return scopes && scopes.length > 0 ? scopes : [...fallback];
}

function readNonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseGmailDate(dateHeader: string | undefined, internalDate: string | undefined) {
  const headerDate = dateHeader ? new Date(dateHeader) : null;
  if (headerDate && !Number.isNaN(headerDate.getTime())) return headerDate;
  const internalTimestamp = internalDate ? Number(internalDate) : NaN;
  if (!Number.isNaN(internalTimestamp)) return new Date(internalTimestamp);
  return new Date();
}

function parseMicrosoftDate(receivedDateTime: string | null | undefined, sentDateTime: string | null | undefined) {
  const received = receivedDateTime ? new Date(receivedDateTime) : null;
  if (received && !Number.isNaN(received.getTime())) return received;
  const sent = sentDateTime ? new Date(sentDateTime) : null;
  if (sent && !Number.isNaN(sent.getTime())) return sent;
  return new Date();
}

function extractEmailAddresses(value: string | null) {
  if (!value) return [];
  return [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((match) => match[0].toLowerCase());
}

function normalizeEmailAddress(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function buildContactEmailMap<T extends { email: string | null }>(contacts: T[]) {
  return new Map(
    contacts
      .map((contact) => [normalizeEmailAddress(contact.email), contact] as const)
      .filter((item): item is readonly [string, (typeof contacts)[number]] => Boolean(item[0]))
  );
}

function formatMicrosoftRecipient(recipient: MicrosoftRecipient | null | undefined) {
  const email = recipient?.emailAddress?.address?.trim();
  const name = recipient?.emailAddress?.name?.trim();
  if (name && email) return `${name} <${email}>`;
  return email || name || null;
}

function formatMicrosoftRecipients(recipients: MicrosoftRecipient[]) {
  const formatted = recipients.map(formatMicrosoftRecipient).filter((item): item is string => Boolean(item));
  return formatted.length > 0 ? formatted.join(", ") : null;
}

function extractMicrosoftRecipientEmails(recipients: MicrosoftRecipient[]) {
  return recipients.map((recipient) => normalizeEmailAddress(recipient.emailAddress?.address)).filter(Boolean);
}

function resolveMicrosoftTenant(env: EmailConnectionEnv = process.env) {
  return readNonEmpty(env.MICROSOFT_OAUTH_TENANT_ID) ?? "common";
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
