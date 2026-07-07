import { EmailConnectionProvider, EmailConnectionStatus, JobStatus, Prisma, type EmailDirection } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { canUseEmailTokenEncryptionKey, decryptEmailToken, encryptEmailToken } from "@/lib/email/token-encryption";
import { redactSensitiveText } from "@/lib/security/redaction";
import { defaultStaleJobAfterMs, enqueueJob, markJobFailedForRetry, markJobSucceeded } from "./job-service";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

type ProviderConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
};

type EmailConnectionEnv = Record<string, string | undefined>;
type GmailFetch = typeof fetch;
type MicrosoftFetch = typeof fetch;

const defaultRecentEmailSyncMaxResults = 10;
const maxRecentEmailSyncMaxResults = 25;

export type EmailProviderCard = {
  accountEmail?: string | null;
  actionLabel: string;
  detail: string;
  disabled: boolean;
  disconnectAvailable?: boolean;
  href?: string;
  lastError?: string | null;
  lastSyncAt?: Date | null;
  name: string;
  provider: EmailConnectionProvider;
  scopes: string[];
  syncAvailable?: boolean;
  syncStatusUpdatedAt?: Date | null;
  syncLabel?: string;
  syncStatusDetail?: string | null;
  syncStatusLabel?: string | null;
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

type GmailThreadResponse = {
  historyId?: string;
  id?: string;
  messages?: GmailMessageResponse[];
};

type GmailHistoryListResponse = {
  history?: Array<{
    messages?: { id?: string; threadId?: string }[];
    messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
};

type GmailSendResponse = {
  id?: string;
  labelIds?: string[];
  threadId?: string;
};

type GmailMessageResponse = {
  historyId?: string;
  id?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    body?: { data?: string };
    headers?: { name?: string; value?: string }[];
    mimeType?: string;
    parts?: GmailMessagePart[];
  };
  snippet?: string;
  threadId?: string;
};

type GmailMessagePart = {
  body?: { data?: string };
  filename?: string;
  headers?: { name?: string; value?: string }[];
  mimeType?: string;
  parts?: GmailMessagePart[];
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

const emailInboxLogInclude = {
  createdBy: { select: userDisplaySelect },
  deal: true,
  lead: true,
  person: true,
  organization: true
} satisfies Prisma.EmailLogInclude;

export type GmailSyncResult = {
  created: number;
  syncMode?: "history" | "older" | "recent" | "thread";
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

export type EmailInboxMessageSummary = Prisma.EmailLogGetPayload<{ include: typeof emailInboxLogInclude }>;

export type EmailInboxThreadSummary = {
  id: string;
  isUnread: boolean;
  latestAt: Date;
  latestMessage: EmailInboxMessageSummary;
  linkedRecordLabel: string | null;
  messageCount: number;
  messages: EmailInboxMessageSummary[];
  provider: EmailConnectionProvider | null;
  subject: string;
};

export type EmailReplySendResult = {
  emailLogId: string;
  providerMessageId: string | null;
  providerThreadId: string | null;
};

export type GmailInboxSyncJobPayload = {
  connectionId: string;
  workspaceId: string;
};

export const gmailOAuthScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send"
] as const;
export const microsoftOAuthScopes = ["openid", "email", "profile", "offline_access", "User.Read", "Mail.Read"] as const;

export const gmailInboxSyncJobType = "email.gmail_sync";
const gmailHistoryCursorPrefix = "historyId:";

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
    include: { secret: { select: { scopes: true } } },
    orderBy: [{ provider: "asc" }, { updatedAt: "desc" }]
  });
  const gmailSyncJobs = await prisma.job.findMany({
    where: {
      workspaceId: actor.workspaceId,
      type: gmailInboxSyncJobType
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 5
  });
  const latestConnectionByProvider = new Map<(typeof connections)[number]["provider"], (typeof connections)[number]>();
  for (const sourceConnection of connections) {
    let connection = sourceConnection;
    if (
      connection.provider === "GOOGLE_WORKSPACE" &&
      connection.status === "CONNECTED" &&
      hasProviderScopes(connection.secret?.scopes, gmailOAuthScopes) &&
      !hasProviderScopes(connection.scopes, gmailOAuthScopes)
    ) {
      const scopes = mergeProviderScopes(connection.secret?.scopes, gmailOAuthScopes);
      await prisma.emailConnection.update({
        where: { id: connection.id },
        data: { lastError: null, scopes }
      });
      connection = { ...connection, lastError: null, scopes };
    }

    const existingConnection = latestConnectionByProvider.get(connection.provider);
    if (
      !existingConnection ||
      providerConnectionCardPriority(connection) > providerConnectionCardPriority(existingConnection)
    ) {
      latestConnectionByProvider.set(connection.provider, connection);
    }
  }
  const tokenEncryptionReady = isTokenEncryptionConfigured(env);

  return [
    googleProviderCard({
      connection: latestConnectionByProvider.get("GOOGLE_WORKSPACE"),
      config: resolveGoogleOAuthConfig(env),
      provider: "GOOGLE_WORKSPACE",
      syncJob: gmailSyncJobs[0] ?? null,
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

  const tokenResponse = await readEmailProviderJson<GoogleTokenResponse>(response, {
    code: "EMAIL_OAUTH_TOKEN_EXCHANGE_FAILED",
    message: "Gmail authorization could not be completed."
  });
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

  const tokenResponse = await readEmailProviderJson<MicrosoftTokenResponse>(response, {
    code: "EMAIL_OAUTH_TOKEN_EXCHANGE_FAILED",
    message: "Microsoft authorization could not be completed."
  });
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

  const profile = await readEmailProviderJson<GoogleUserProfile>(response, {
    code: "EMAIL_OAUTH_PROFILE_FAILED",
    message: "Gmail account profile could not be loaded."
  });
  const accountEmail = normalizeProviderAccountEmail(profile.email, "Gmail");

  return { ...profile, email: accountEmail };
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

  const profile = await readEmailProviderJson<MicrosoftUserProfile>(response, {
    code: "EMAIL_OAUTH_PROFILE_FAILED",
    message: "Microsoft account profile could not be loaded."
  });
  const accountEmail = normalizeProviderAccountEmail(profile.mail ?? profile.userPrincipalName, "Microsoft");

  return profile.mail ? { ...profile, mail: accountEmail } : { ...profile, userPrincipalName: accountEmail };
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

  const scopes = normalizeGoogleOAuthScopes(tokenResponse.scope);
  const accountEmail = normalizeProviderAccountEmail(profile.email, "Gmail");
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
      deletedAt: null,
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
  const accessTokenExpiresAt = normalizeAccessTokenExpiresAt(tokenResponse.expires_in);

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
  if (hasProviderScopes(scopes, gmailOAuthScopes)) {
    await enqueueGmailInboxSyncJobForConnection(actor, connection.id);
  }

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
  const accountEmail = normalizeProviderAccountEmail(profile.mail ?? profile.userPrincipalName, "Microsoft");
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
      deletedAt: null,
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
  const accessTokenExpiresAt = normalizeAccessTokenExpiresAt(tokenResponse.expires_in);

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

export async function disconnectEmailConnection(
  actor: WorkspaceActor,
  providerInput: unknown
): Promise<{ accountEmail: string | null; provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365" }> {
  await ensureWorkspaceAccess(actor);
  const provider = normalizeDisconnectProvider(providerInput);
  const providerLabel = provider === "GOOGLE_WORKSPACE" ? "Gmail" : "Microsoft";
  const connection = await prisma.emailConnection.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      provider,
      status: "CONNECTED",
      deletedAt: null
    },
    orderBy: { updatedAt: "desc" }
  });

  if (!connection) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", `No connected ${providerLabel} account was found to disconnect.`, 404);
  }

  await prisma.emailConnectionSecret.deleteMany({
    where: {
      connectionId: connection.id,
      provider,
      workspaceId: actor.workspaceId
    }
  });
  await prisma.emailConnection.update({
    where: { id: connection.id },
    data: {
      deletedAt: new Date(),
      lastError: null,
      status: "DISCONNECTED"
    }
  });
  await writeAuditLog(actor, "email_connection.disconnected", "EmailConnection", connection.id, {
    accountEmail: connection.accountEmail,
    provider
  });

  return { accountEmail: connection.accountEmail, provider };
}

export async function syncRecentGmailMessages({
  actor,
  env = process.env,
  fetchImpl = fetch,
  maxResults = defaultRecentEmailSyncMaxResults
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

  try {
  assertEmailConnectionSecretIntegrity(connection, "Gmail");
  const accessToken = await resolveUsableGoogleAccessToken({ config, connection, env, fetchImpl });
  const contacts = await prisma.person.findMany({
    where: {
      workspaceId: actor.workspaceId,
      deletedAt: null,
      email: { not: null }
    },
    select: {
      deals: {
        where: { deletedAt: null, status: "OPEN", workspaceId: actor.workspaceId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
        take: 1
      },
      email: true,
      id: true,
      organization: { select: { deletedAt: true, id: true, workspaceId: true } }
    }
  });
  const contactByEmail = buildContactEmailMap(contacts);

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
          organizationId: workspaceScopedOrganizationId(match, actor.workspaceId),
          occurredAt: normalized.occurredAt,
          personId: match.id,
          provider: "GOOGLE_WORKSPACE",
          providerLabels: metadata.labelIds ?? [],
          providerMessageId: message.id,
          providerSnippet: normalized.snippet,
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
  } catch (error) {
    await recordEmailConnectionSyncFailure(connection.id, "Gmail", error);
    throw error;
  }
}

export async function syncRecentMicrosoftMessages({
  actor,
  env = process.env,
  fetchImpl = fetch,
  maxResults = defaultRecentEmailSyncMaxResults
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

  try {
  assertEmailConnectionSecretIntegrity(connection, "Microsoft");
  const accessToken = await resolveUsableMicrosoftAccessToken({ config, connection, env, fetchImpl });
  const contacts = await prisma.person.findMany({
    where: {
      workspaceId: actor.workspaceId,
      deletedAt: null,
      email: { not: null }
    },
    select: {
      deals: {
        where: { deletedAt: null, status: "OPEN", workspaceId: actor.workspaceId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
        take: 1
      },
      email: true,
      id: true,
      organization: { select: { deletedAt: true, id: true, workspaceId: true } }
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
          organizationId: workspaceScopedOrganizationId(match, actor.workspaceId),
          occurredAt: normalized.occurredAt,
          personId: match.id,
          provider: "MICROSOFT_365",
          providerMessageId: message.id,
          providerSnippet: normalized.snippet,
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
  } catch (error) {
    await recordEmailConnectionSyncFailure(connection.id, "Microsoft", error);
    throw error;
  }
}

export async function syncGmailInboxMessages({
  actor,
  connectionId,
  env = process.env,
  fetchImpl = fetch,
  maxResults = defaultRecentEmailSyncMaxResults,
  preferHistory = true
}: {
  actor: WorkspaceActor;
  connectionId?: string;
  env?: EmailConnectionEnv;
  fetchImpl?: GmailFetch;
  maxResults?: number;
  preferHistory?: boolean;
}): Promise<GmailSyncResult> {
  await ensureWorkspaceAccess(actor);
  const config = assertGoogleOAuthReady(env);
  const connection = await findConnectedEmailConnection(actor.workspaceId, "GOOGLE_WORKSPACE", connectionId);

  if (!connection?.secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before syncing inbox messages.", 400);
  }

  try {
    assertEmailConnectionSecretIntegrity(connection, "Gmail");
    assertConnectionProviderScopes(connection, gmailOAuthScopes, "Reconnect Gmail to enable Full Inbox sync and replies.");
    const accessToken = await resolveUsableGoogleAccessToken({ config, connection, env, fetchImpl });
    const contactByEmail = await buildWorkspaceContactEmailMap(actor.workspaceId);
    const cursor = parseGmailHistoryCursor(connection.lastSyncCursor);
    const syncResult =
      preferHistory && cursor
        ? await syncGmailInboxHistoryOrFallback({
            accessToken,
            actor,
            connection,
            contactByEmail,
            cursor,
            fetchImpl,
            maxResults
          })
        : await syncRecentGmailInboxMessagesForConnection({
            accessToken,
            actor,
            connection,
            contactByEmail,
            fetchImpl,
            maxResults
          });

    await prisma.emailConnection.update({
      where: { id: connection.id },
      data: {
        lastError: null,
        lastSyncAt: new Date(),
        lastSyncCursor: syncResult.historyId ? formatGmailHistoryCursor(syncResult.historyId) : connection.lastSyncCursor
      }
    });
    await writeAuditLog(actor, "email_connection.inbox_synced", "EmailConnection", connection.id, {
      created: syncResult.created,
      provider: "GOOGLE_WORKSPACE",
      skippedDuplicates: syncResult.skippedDuplicates,
      syncMode: syncResult.syncMode,
      totalFetched: syncResult.totalFetched
    });

    return {
      created: syncResult.created,
      skippedDuplicates: syncResult.skippedDuplicates,
      skippedUnmatched: 0,
      syncMode: syncResult.syncMode,
      totalFetched: syncResult.totalFetched,
      unmatchedPreviews: []
    };
  } catch (error) {
    await recordEmailConnectionSyncFailure(connection.id, "Gmail", error);
    throw error;
  }
}

export async function syncOlderGmailInboxMessages({
  actor,
  before,
  env = process.env,
  fetchImpl = fetch,
  maxResults = maxRecentEmailSyncMaxResults
}: {
  actor: WorkspaceActor;
  before: unknown;
  env?: EmailConnectionEnv;
  fetchImpl?: GmailFetch;
  maxResults?: number;
}): Promise<GmailSyncResult> {
  await ensureWorkspaceAccess(actor);
  const config = assertGoogleOAuthReady(env);
  const connection = await findConnectedEmailConnection(actor.workspaceId, "GOOGLE_WORKSPACE");

  if (!connection?.secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before loading older inbox messages.", 400);
  }

  try {
    assertEmailConnectionSecretIntegrity(connection, "Gmail");
    assertConnectionProviderScopes(connection, gmailOAuthScopes, "Reconnect Gmail to enable Full Inbox sync and replies.");
    const beforeDate = normalizeGmailBeforeDate(before);
    const accessToken = await resolveUsableGoogleAccessToken({ config, connection, env, fetchImpl });
    const contactByEmail = await buildWorkspaceContactEmailMap(actor.workspaceId);
    const messages = await listOlderGmailInboxMessages({
      accessToken,
      before: beforeDate,
      fetchImpl,
      maxResults
    });
    const fullMessages = await getGmailFullMessages({ accessToken, fetchImpl, messages });
    const persisted = await persistGmailInboxMessages({ actor, connection, contactByEmail, fullMessages });

    await prisma.emailConnection.update({
      where: { id: connection.id },
      data: {
        lastError: null,
        lastSyncAt: new Date()
      }
    });
    await writeAuditLog(actor, "email_connection.inbox_older_loaded", "EmailConnection", connection.id, {
      before: beforeDate.toISOString(),
      created: persisted.created,
      provider: "GOOGLE_WORKSPACE",
      skippedDuplicates: persisted.skippedDuplicates,
      totalFetched: messages.length
    });

    return {
      created: persisted.created,
      skippedDuplicates: persisted.skippedDuplicates,
      skippedUnmatched: 0,
      syncMode: "older",
      totalFetched: messages.length,
      unmatchedPreviews: []
    };
  } catch (error) {
    await recordEmailConnectionSyncFailure(connection.id, "Gmail", error);
    throw error;
  }
}

export async function refreshGmailInboxThread({
  actor,
  env = process.env,
  fetchImpl = fetch,
  threadId
}: {
  actor: WorkspaceActor;
  env?: EmailConnectionEnv;
  fetchImpl?: GmailFetch;
  threadId: unknown;
}): Promise<GmailSyncResult & { threadId: string }> {
  await ensureWorkspaceAccess(actor);
  const providerThreadId = normalizeGmailInboxThreadId(threadId);
  const config = assertGoogleOAuthReady(env);
  const connection = await findConnectedEmailConnection(actor.workspaceId, "GOOGLE_WORKSPACE");

  if (!connection?.secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before refreshing this thread.", 400);
  }

  const existingThreadMessage = await prisma.emailLog.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      provider: "GOOGLE_WORKSPACE",
      OR: [{ providerThreadId }, { providerMessageId: providerThreadId }]
    },
    select: { id: true }
  });
  if (!existingThreadMessage) {
    throw new ApiError("EMAIL_THREAD_NOT_FOUND", "Choose a synced Gmail thread before refreshing it.", 404);
  }

  try {
    assertEmailConnectionSecretIntegrity(connection, "Gmail");
    assertConnectionProviderScopes(connection, gmailOAuthScopes, "Reconnect Gmail to enable Full Inbox sync and replies.");
    const accessToken = await resolveUsableGoogleAccessToken({ config, connection, env, fetchImpl });
    const contactByEmail = await buildWorkspaceContactEmailMap(actor.workspaceId);
    const thread = await getGmailThreadFull({ accessToken, fetchImpl, threadId: providerThreadId });
    const fullMessages = (thread.messages ?? []).map((message) => ({
      listedThreadId: thread.id ?? providerThreadId,
      message
    }));
    const persisted = await persistGmailInboxMessages({ actor, connection, contactByEmail, fullMessages });

    await prisma.emailConnection.update({
      where: { id: connection.id },
      data: {
        lastError: null,
        lastSyncAt: new Date()
      }
    });
    await writeAuditLog(actor, "email_connection.thread_refreshed", "EmailConnection", connection.id, {
      created: persisted.created,
      provider: "GOOGLE_WORKSPACE",
      providerThreadId,
      skippedDuplicates: persisted.skippedDuplicates,
      totalFetched: fullMessages.length
    });

    return {
      created: persisted.created,
      skippedDuplicates: persisted.skippedDuplicates,
      skippedUnmatched: 0,
      syncMode: "thread",
      threadId: providerThreadId,
      totalFetched: fullMessages.length,
      unmatchedPreviews: []
    };
  } catch (error) {
    await recordEmailConnectionSyncFailure(connection.id, "Gmail", error);
    throw error;
  }
}

export async function enqueueGmailInboxSyncJob(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  const connection = await findConnectedEmailConnection(actor.workspaceId, "GOOGLE_WORKSPACE");
  if (!connection) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before syncing inbox messages.", 400);
  }
  assertConnectionProviderScopes(connection, gmailOAuthScopes, "Reconnect Gmail to enable Full Inbox sync and replies.");
  return enqueueGmailInboxSyncJobForConnection(actor, connection.id);
}

export async function runGmailInboxSyncNow(
  actor: WorkspaceActor,
  options: { env?: EmailConnectionEnv; fetchImpl?: GmailFetch; now?: Date; workerId?: string } = {}
): Promise<GmailSyncResult> {
  await ensureWorkspaceAccess(actor);
  const now = options.now ?? new Date();
  const connection = await findConnectedEmailConnection(actor.workspaceId, "GOOGLE_WORKSPACE");
  if (!connection) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before syncing inbox messages.", 400);
  }
  assertConnectionProviderScopes(connection, gmailOAuthScopes, "Reconnect Gmail to enable Full Inbox sync and replies.");

  const job = await enqueueGmailInboxSyncJobForConnection(actor, connection.id);
  const claimedJob = await claimGmailInboxSyncJobForImmediateRun({
    jobId: job.id,
    now,
    workerId: options.workerId ?? "email-page-gmail-sync",
    workspaceId: actor.workspaceId
  });

  if (!claimedJob) {
    throw new ApiError(
      "EMAIL_SYNC_ALREADY_RUNNING",
      "Gmail sync is already running. Refresh status in a moment.",
      409
    );
  }

  try {
    const result = await processGmailInboxSyncJob(claimedJob.payload, {
      env: options.env,
      fetchImpl: options.fetchImpl
    });
    await markJobSucceeded(claimedJob.id, new Date());
    return result;
  } catch (error) {
    await markJobFailedForRetry(claimedJob.id, error, { now: new Date() });
    throw error;
  }
}

export async function processGmailInboxSyncJob(
  payload: unknown,
  options: { env?: EmailConnectionEnv; fetchImpl?: GmailFetch } = {}
): Promise<GmailSyncResult> {
  const input = parseGmailInboxSyncJobPayload(payload);
  const connection = await prisma.emailConnection.findFirst({
    where: {
      id: input.connectionId,
      workspaceId: input.workspaceId,
      provider: "GOOGLE_WORKSPACE",
      deletedAt: null
    },
    include: { secret: true }
  });
  if (!connection?.secret) {
    throw new Error("Gmail sync job connection is no longer available.");
  }
  const actorUserId = connection.createdById ?? connection.secret.userId;
  const actor = { actorUserId, workspaceId: connection.workspaceId };
  return syncGmailInboxMessages({
    actor,
    connectionId: connection.id,
    env: options.env,
    fetchImpl: options.fetchImpl,
    maxResults: maxRecentEmailSyncMaxResults
  });
}

export function parseGmailInboxSyncJobPayload(payload: unknown): GmailInboxSyncJobPayload {
  if (!isRecord(payload)) {
    throw new Error("Invalid Gmail sync job payload.");
  }
  const connectionId = readNonEmptyValue(payload.connectionId);
  const workspaceId = readNonEmptyValue(payload.workspaceId);
  if (!connectionId || !workspaceId) {
    throw new Error("Invalid Gmail sync job payload.");
  }
  return { connectionId, workspaceId };
}

async function enqueueGmailInboxSyncJobForConnection(actor: WorkspaceActor, connectionId: string) {
  return enqueueJob({
    type: gmailInboxSyncJobType,
    workspaceId: actor.workspaceId,
    dedupeKey: gmailInboxSyncJobDedupeKey(connectionId),
    payload: {
      connectionId,
      workspaceId: actor.workspaceId
    }
  });
}

async function claimGmailInboxSyncJobForImmediateRun({
  jobId,
  now,
  workerId,
  workspaceId
}: {
  jobId: string;
  now: Date;
  workerId: string;
  workspaceId: string;
}) {
  const staleCutoff = new Date(now.getTime() - defaultStaleJobAfterMs);
  const staleRunningJob = await prisma.job.findFirst({
    where: {
      id: jobId,
      lockedAt: { lt: staleCutoff },
      status: JobStatus.RUNNING,
      type: gmailInboxSyncJobType,
      workspaceId
    },
    select: {
      attempts: true,
      maxAttempts: true
    }
  });

  if (staleRunningJob && staleRunningJob.attempts < staleRunningJob.maxAttempts) {
    await prisma.job.updateMany({
      where: {
        id: jobId,
        lockedAt: { lt: staleCutoff },
        status: JobStatus.RUNNING,
        type: gmailInboxSyncJobType,
        workspaceId
      },
      data: {
        lockedAt: null,
        lockedBy: null,
        runAt: now,
        status: JobStatus.PENDING
      }
    });
  }

  const updated = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: { in: [JobStatus.PENDING, JobStatus.FAILED] },
      type: gmailInboxSyncJobType,
      workspaceId
    },
    data: {
      attempts: { increment: 1 },
      failedAt: null,
      lockedAt: now,
      lockedBy: workerId,
      runAt: now,
      status: JobStatus.RUNNING
    }
  });

  if (updated.count !== 1) return null;
  return prisma.job.findUniqueOrThrow({ where: { id: jobId } });
}

async function syncGmailInboxHistoryOrFallback({
  accessToken,
  actor,
  connection,
  contactByEmail,
  cursor,
  fetchImpl,
  maxResults
}: {
  accessToken: string;
  actor: WorkspaceActor;
  connection: NonNullable<Awaited<ReturnType<typeof findConnectedEmailConnection>>>;
  contactByEmail: Map<string, EmailSyncContactMatch>;
  cursor: string;
  fetchImpl: GmailFetch;
  maxResults: number;
}) {
  try {
    const history = await listGmailInboxHistoryMessages({ accessToken, fetchImpl, startHistoryId: cursor });
    const fullMessages = await getGmailFullMessages({ accessToken, fetchImpl, messages: history.messages });
    const persisted = await persistGmailInboxMessages({ actor, connection, contactByEmail, fullMessages });
    return {
      ...persisted,
      historyId: history.historyId ?? newestGmailHistoryId(fullMessages),
      syncMode: "history" as const,
      totalFetched: history.messages.length
    };
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "EMAIL_GMAIL_HISTORY_EXPIRED") {
      throw error;
    }
    return syncRecentGmailInboxMessagesForConnection({
      accessToken,
      actor,
      connection,
      contactByEmail,
      fetchImpl,
      maxResults
    });
  }
}

async function syncRecentGmailInboxMessagesForConnection({
  accessToken,
  actor,
  connection,
  contactByEmail,
  fetchImpl,
  maxResults
}: {
  accessToken: string;
  actor: WorkspaceActor;
  connection: NonNullable<Awaited<ReturnType<typeof findConnectedEmailConnection>>>;
  contactByEmail: Map<string, EmailSyncContactMatch>;
  fetchImpl: GmailFetch;
  maxResults: number;
}) {
  const messages = await listRecentGmailInboxMessages({ accessToken, fetchImpl, maxResults });
  const fullMessages = await getGmailFullMessages({ accessToken, fetchImpl, messages });
  const persisted = await persistGmailInboxMessages({ actor, connection, contactByEmail, fullMessages });
  return {
    ...persisted,
    historyId: newestGmailHistoryId(fullMessages),
    syncMode: "recent" as const,
    totalFetched: messages.length
  };
}

async function listOlderGmailInboxMessages({
  accessToken,
  before,
  fetchImpl,
  maxResults
}: {
  accessToken: string;
  before: Date;
  fetchImpl: GmailFetch;
  maxResults: number;
}) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("labelIds", "INBOX");
  url.searchParams.set("maxResults", String(normalizeRecentEmailSyncMaxResults(maxResults)));
  url.searchParams.set("q", `before:${formatGmailSearchDate(before)}`);
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_LIST_FAILED", "Older Gmail inbox messages could not be listed.", 400);
  }

  const body = await readEmailProviderJson<GmailListResponse>(response, {
    code: "EMAIL_GMAIL_LIST_FAILED",
    message: "Older Gmail inbox messages could not be listed."
  });
  return body.messages?.filter((message) => message.id) ?? [];
}

async function getGmailFullMessages({
  accessToken,
  fetchImpl,
  messages
}: {
  accessToken: string;
  fetchImpl: GmailFetch;
  messages: { id?: string; threadId?: string }[];
}) {
  const fullMessages: Array<{ listedThreadId?: string; message: GmailMessageResponse }> = [];
  for (const listedMessage of messages) {
    if (!listedMessage.id) continue;
    fullMessages.push({
      listedThreadId: listedMessage.threadId,
      message: await getGmailMessageFull({ accessToken, fetchImpl, messageId: listedMessage.id })
    });
  }
  return fullMessages;
}

async function persistGmailInboxMessages({
  actor,
  connection,
  contactByEmail,
  fullMessages
}: {
  actor: WorkspaceActor;
  connection: NonNullable<Awaited<ReturnType<typeof findConnectedEmailConnection>>>;
  contactByEmail: Map<string, EmailSyncContactMatch>;
  fullMessages: Array<{ listedThreadId?: string; message: GmailMessageResponse }>;
}) {
  const ids = fullMessages.map((item) => item.message.id).filter((id): id is string => Boolean(id));
  const existingLogs = ids.length
    ? await prisma.emailLog.findMany({
        where: {
          workspaceId: actor.workspaceId,
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: { in: ids }
        },
        select: { body: true, id: true, providerLabels: true, providerMessageId: true, providerSnippet: true }
      })
    : [];
  const existingByProviderId = new Map(existingLogs.map((log) => [log.providerMessageId, log]));
  let created = 0;
  let skippedDuplicates = 0;

  for (const { listedThreadId, message } of fullMessages) {
    if (!message.id) continue;
    const normalized = normalizeGmailMessage(message, connection.accountEmail ?? connection.secret?.accountEmail ?? "");
    const match = matchGmailMessageToContact(normalized, contactByEmail);
    const body = normalizeGmailMessageBody(message) ?? normalized.snippet ?? "Gmail message imported without readable body.";
    const providerLabels = message.labelIds ?? [];
    const existing = existingByProviderId.get(message.id);

    if (existing) {
      skippedDuplicates += 1;
      await prisma.emailLog.update({
        where: { id: existing.id },
        data: {
          ...(shouldRefreshExistingGmailInboxLog(existing) ? { body } : {}),
          providerLabels,
          providerSnippet: normalized.snippet,
          providerThreadId: message.threadId ?? listedThreadId ?? null
        }
      });
      continue;
    }

    try {
      await prisma.emailLog.create({
        data: {
          body,
          dealId: match?.deals[0]?.id ?? null,
          direction: normalized.direction as EmailDirection,
          fromText: normalized.fromText,
          organizationId: match ? workspaceScopedOrganizationId(match, actor.workspaceId) : null,
          occurredAt: normalized.occurredAt,
          personId: match?.id ?? null,
          provider: "GOOGLE_WORKSPACE",
          providerLabels,
          providerMessageId: message.id,
          providerSnippet: normalized.snippet,
          providerThreadId: message.threadId ?? listedThreadId ?? null,
          subject: normalized.subject,
          toText: normalized.toText,
          workspaceId: actor.workspaceId,
          createdById: actor.actorUserId
        }
      });
      created += 1;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        skippedDuplicates += 1;
        continue;
      }
      throw error;
    }
  }

  return { created, skippedDuplicates };
}

async function buildWorkspaceContactEmailMap(workspaceId: string) {
  const contacts = await prisma.person.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      email: { not: null }
    },
    select: {
      deals: {
        where: { deletedAt: null, status: "OPEN", workspaceId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
        take: 1
      },
      email: true,
      id: true,
      organization: { select: { deletedAt: true, id: true, workspaceId: true } }
    }
  });
  return buildContactEmailMap(contacts);
}

export async function listEmailInboxThreads(actor: WorkspaceActor, options: { limit?: number } = {}) {
  await ensureWorkspaceAccess(actor);
  const take = normalizeEmailInboxListLimit(options.limit ?? 100);
  const emailLogs = await prisma.emailLog.findMany({
    where: {
      workspaceId: actor.workspaceId,
      provider: { not: null }
    },
    include: emailInboxLogInclude,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take
  });
  const threadMap = new Map<string, EmailInboxMessageSummary[]>();

  for (const emailLog of emailLogs) {
    const threadId = emailInboxThreadId(emailLog);
    threadMap.set(threadId, [...(threadMap.get(threadId) ?? []), emailLog]);
  }

  return [...threadMap.entries()]
    .map(([id, messages]) => buildEmailInboxThreadSummary(id, messages))
    .sort((a, b) => b.latestAt.getTime() - a.latestAt.getTime());
}

export async function sendGmailReplyFromEmailLog({
  actor,
  body,
  emailLogId,
  env = process.env,
  fetchImpl = fetch
}: {
  actor: WorkspaceActor;
  body: unknown;
  emailLogId: unknown;
  env?: EmailConnectionEnv;
  fetchImpl?: GmailFetch;
}): Promise<EmailReplySendResult> {
  await ensureWorkspaceAccess(actor);
  const normalizedEmailLogId = normalizeEmailReplyId(emailLogId);
  const replyBody = normalizeEmailReplyBody(body);
  const sourceEmail = await prisma.emailLog.findFirst({
    where: {
      id: normalizedEmailLogId,
      workspaceId: actor.workspaceId,
      provider: "GOOGLE_WORKSPACE",
      providerMessageId: { not: null }
    },
    include: emailInboxLogInclude
  });

  if (!sourceEmail) {
    throw new ApiError("EMAIL_LOG_NOT_FOUND", "Choose a synced Gmail message before sending a reply.", 404);
  }

  const recipient = sourceEmail.direction === "INBOUND" ? sourceEmail.fromText : sourceEmail.toText;
  const recipientEmail = extractEmailAddresses(recipient).find(Boolean);
  if (!recipientEmail) {
    throw new ApiError("EMAIL_REPLY_RECIPIENT_MISSING", "This email does not have a reply recipient.", 422);
  }

  const config = assertGoogleOAuthReady(env);
  const connection = await findConnectedEmailConnection(actor.workspaceId, "GOOGLE_WORKSPACE");
  if (!connection?.secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", "Connect Gmail before sending replies.", 400);
  }

  assertEmailConnectionSecretIntegrity(connection, "Gmail");
  assertConnectionProviderScopes(connection, gmailOAuthScopes, "Reconnect Gmail to enable explicit replies.");
  const accessToken = await resolveUsableGoogleAccessToken({ config, connection, env, fetchImpl });
  const subject = replySubject(sourceEmail.subject);
  const sentMessage = await sendGmailRawMessage({
    accessToken,
    body: replyBody,
    fetchImpl,
    from: connection.accountEmail ?? connection.secret.accountEmail,
    subject,
    threadId: sourceEmail.providerThreadId,
    to: recipientEmail
  });

  const sentLog = await createOrFindSentGmailReplyLog({
    actor,
    connectionAccountEmail: connection.accountEmail ?? connection.secret.accountEmail,
    recipientEmail,
    replyBody,
    sentMessage,
    sourceEmail,
    subject
  });

  await writeAuditLog(actor, "email_connection.reply_sent", "EmailLog", sentLog.id, {
    provider: "GOOGLE_WORKSPACE",
    sourceEmailLogId: sourceEmail.id
  });

  return {
    emailLogId: sentLog.id,
    providerMessageId: sentLog.providerMessageId,
    providerThreadId: sentLog.providerThreadId
  };
}

async function createOrFindSentGmailReplyLog({
  actor,
  connectionAccountEmail,
  recipientEmail,
  replyBody,
  sentMessage,
  sourceEmail,
  subject
}: {
  actor: WorkspaceActor;
  connectionAccountEmail: string;
  recipientEmail: string;
  replyBody: string;
  sentMessage: GmailSendResponse;
  sourceEmail: EmailInboxMessageSummary;
  subject: string;
}) {
  const providerMessageId = sentMessage.id ?? null;
  const existingSentLog = providerMessageId
    ? await prisma.emailLog.findFirst({
        where: {
          provider: "GOOGLE_WORKSPACE",
          providerMessageId,
          workspaceId: actor.workspaceId
        }
      })
    : null;
  if (existingSentLog) return existingSentLog;

  try {
    return await prisma.emailLog.create({
      data: {
        body: replyBody,
        ccText: null,
        dealId: sourceEmail.dealId,
        direction: "OUTBOUND",
        fromText: connectionAccountEmail,
        leadId: sourceEmail.leadId,
        occurredAt: new Date(),
        organizationId: sourceEmail.organizationId,
        personId: sourceEmail.personId,
        provider: "GOOGLE_WORKSPACE",
        providerLabels: ["SENT"],
        providerMessageId,
        providerSnippet: truncateEmailPreviewText(replyBody, 240),
        providerThreadId: sentMessage.threadId ?? sourceEmail.providerThreadId,
        subject,
        toText: recipientEmail,
        workspaceId: actor.workspaceId,
        createdById: actor.actorUserId
      }
    });
  } catch (error) {
    if (providerMessageId && isUniqueConstraintError(error)) {
      const reloadedSentLog = await prisma.emailLog.findFirst({
        where: {
          provider: "GOOGLE_WORKSPACE",
          providerMessageId,
          workspaceId: actor.workspaceId
        }
      });
      if (reloadedSentLog) return reloadedSentLog;
    }
    throw error;
  }
}

async function recordEmailConnectionSyncFailure(connectionId: string, providerLabel: "Gmail" | "Microsoft", error: unknown) {
  try {
    await prisma.emailConnection.update({
      where: { id: connectionId },
      data: { lastError: formatEmailConnectionSyncError(providerLabel, error) }
    });
  } catch {
    // Preserve the original sync failure if recording the diagnostic fails.
  }
}

function assertEmailConnectionSecretIntegrity(
  connection: {
    accountEmail: string | null;
    provider: EmailConnectionProvider;
    secret: {
      accountEmail: string;
      provider: EmailConnectionProvider;
      workspaceId: string;
    } | null;
    workspaceId: string;
  },
  providerLabel: "Gmail" | "Microsoft"
) {
  const secret = connection.secret;
  if (!secret) {
    throw new ApiError("EMAIL_CONNECTION_NOT_FOUND", `Connect ${providerLabel} before syncing recent messages.`, 400);
  }

  const connectionEmail = normalizeEmailAddress(connection.accountEmail);
  const secretEmail = normalizeEmailAddress(secret.accountEmail);
  if (
    secret.workspaceId !== connection.workspaceId ||
    secret.provider !== connection.provider ||
    (connectionEmail && connectionEmail !== secretEmail)
  ) {
    throw new ApiError(
      "EMAIL_CONNECTION_SECRET_MISMATCH",
      `Reconnect ${providerLabel} before syncing; stored credentials do not match this workspace.`,
      400
    );
  }
}

function formatEmailConnectionSyncError(providerLabel: "Gmail" | "Microsoft", error: unknown) {
  if (error instanceof ApiError) {
    return truncateEmailPreviewText(redactSensitiveText(`${error.code}: ${error.message}`), 500) ?? `${providerLabel} sync failed.`;
  }

  return `${providerLabel} sync failed. Try again or reconnect the account.`;
}

async function readEmailProviderJson<T>(
  response: Response,
  error: { code: string; message: string; status?: number }
) {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(error.code, error.message, error.status ?? 400);
  }
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
  const accessTokenExpiresAt = normalizeAccessTokenExpiresAt(refreshed.expires_in);

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
  const accessTokenExpiresAt = normalizeAccessTokenExpiresAt(refreshed.expires_in);

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

  const tokenResponse = await readEmailProviderJson<GoogleTokenResponse>(response, {
    code: "EMAIL_REFRESH_TOKEN_FAILED",
    message: "Gmail access token could not be refreshed."
  });
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

  const tokenResponse = await readEmailProviderJson<MicrosoftTokenResponse>(response, {
    code: "EMAIL_REFRESH_TOKEN_FAILED",
    message: "Microsoft access token could not be refreshed."
  });
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
  url.searchParams.set("maxResults", String(normalizeRecentEmailSyncMaxResults(maxResults)));
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_LIST_FAILED", "Recent Gmail messages could not be listed.", 400);
  }

  const body = await readEmailProviderJson<GmailListResponse>(response, {
    code: "EMAIL_GMAIL_LIST_FAILED",
    message: "Recent Gmail messages could not be listed."
  });
  return body.messages?.filter((message) => message.id) ?? [];
}

async function listRecentGmailInboxMessages({
  accessToken,
  fetchImpl,
  maxResults
}: {
  accessToken: string;
  fetchImpl: GmailFetch;
  maxResults: number;
}) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("labelIds", "INBOX");
  url.searchParams.set("maxResults", String(normalizeRecentEmailSyncMaxResults(maxResults)));
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_LIST_FAILED", "Gmail inbox messages could not be listed.", 400);
  }

  const body = await readEmailProviderJson<GmailListResponse>(response, {
    code: "EMAIL_GMAIL_LIST_FAILED",
    message: "Gmail inbox messages could not be listed."
  });
  return body.messages?.filter((message) => message.id) ?? [];
}

async function listGmailInboxHistoryMessages({
  accessToken,
  fetchImpl,
  startHistoryId
}: {
  accessToken: string;
  fetchImpl: GmailFetch;
  startHistoryId: string;
}) {
  const messages = new Map<string, { id: string; threadId?: string }>();
  let historyId: string | undefined;
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    url.searchParams.set("historyTypes", "messageAdded");
    url.searchParams.set("labelId", "INBOX");
    url.searchParams.set("startHistoryId", startHistoryId);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${accessToken}` }
    });

    if (response.status === 404) {
      throw new ApiError("EMAIL_GMAIL_HISTORY_EXPIRED", "Gmail sync history expired; recent inbox sync is required.", 400);
    }
    if (!response.ok) {
      throw new ApiError("EMAIL_GMAIL_HISTORY_FAILED", "Gmail sync history could not be listed.", 400);
    }

    const body = await readEmailProviderJson<GmailHistoryListResponse>(response, {
      code: "EMAIL_GMAIL_HISTORY_FAILED",
      message: "Gmail sync history could not be listed."
    });
    historyId = body.historyId ?? historyId;
    for (const item of body.history ?? []) {
      for (const added of item.messagesAdded ?? []) {
        const message = added.message;
        if (message?.id) messages.set(message.id, { id: message.id, threadId: message.threadId });
      }
      for (const message of item.messages ?? []) {
        if (message.id) messages.set(message.id, { id: message.id, threadId: message.threadId });
      }
    }
    pageToken = body.nextPageToken;
    pageCount += 1;
  } while (pageToken && pageCount < 5);

  return {
    historyId,
    messages: [...messages.values()]
  };
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

  return readEmailProviderJson<GmailMessageResponse>(response, {
    code: "EMAIL_GMAIL_MESSAGE_FAILED",
    message: "Gmail message metadata could not be loaded."
  });
}

async function getGmailMessageFull({
  accessToken,
  fetchImpl,
  messageId
}: {
  accessToken: string;
  fetchImpl: GmailFetch;
  messageId: string;
}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", "full");
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_MESSAGE_FAILED", "Gmail message could not be loaded.", 400);
  }

  return readEmailProviderJson<GmailMessageResponse>(response, {
    code: "EMAIL_GMAIL_MESSAGE_FAILED",
    message: "Gmail message could not be loaded."
  });
}

async function getGmailThreadFull({
  accessToken,
  fetchImpl,
  threadId
}: {
  accessToken: string;
  fetchImpl: GmailFetch;
  threadId: string;
}) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`);
  url.searchParams.set("format", "full");
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_THREAD_FAILED", "Gmail thread could not be refreshed.", 400);
  }

  return readEmailProviderJson<GmailThreadResponse>(response, {
    code: "EMAIL_GMAIL_THREAD_FAILED",
    message: "Gmail thread could not be refreshed."
  });
}

async function sendGmailRawMessage({
  accessToken,
  body,
  fetchImpl,
  from,
  subject,
  threadId,
  to
}: {
  accessToken: string;
  body: string;
  fetchImpl: GmailFetch;
  from: string;
  subject: string;
  threadId: string | null;
  to: string;
}) {
  const response = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      raw: encodeGmailRawMessage({ body, from, subject, to }),
      ...(threadId ? { threadId } : {})
    })
  });

  if (!response.ok) {
    throw new ApiError("EMAIL_GMAIL_SEND_FAILED", "Gmail reply could not be sent.", 400);
  }

  return readEmailProviderJson<GmailSendResponse>(response, {
    code: "EMAIL_GMAIL_SEND_FAILED",
    message: "Gmail reply could not be sent."
  });
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
  url.searchParams.set("$top", String(normalizeRecentEmailSyncMaxResults(maxResults)));
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

  const body = await readEmailProviderJson<MicrosoftMessagesResponse>(response, {
    code: "EMAIL_MICROSOFT_LIST_FAILED",
    message: "Recent Microsoft mail could not be listed."
  });
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

type EmailSyncContactMatch = {
  deals: { id: string }[];
  email: string | null;
  id: string;
  organization?: { deletedAt: Date | null; id: string; workspaceId: string } | null;
};

function matchGmailMessageToContact(message: ReturnType<typeof normalizeGmailMessage>, contactByEmail: Map<string, EmailSyncContactMatch>) {
  return matchEmailMessageToContact(message, contactByEmail);
}

function matchEmailMessageToContact(
  message: { direction: string; fromEmails: string[]; toEmails: string[] },
  contactByEmail: Map<string, EmailSyncContactMatch>
) {
  const candidates = message.direction === "OUTBOUND" ? message.toEmails : message.fromEmails;
  for (const email of candidates) {
    const contact = contactByEmail.get(email);
    if (contact) return contact;
  }
  return null;
}

function workspaceScopedOrganizationId(contact: EmailSyncContactMatch, workspaceId: string) {
  const organization = contact.organization;
  return organization?.workspaceId === workspaceId && !organization.deletedAt ? organization.id : null;
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

function safeProviderLastError(value: string | null | undefined) {
  return truncateEmailPreviewText(redactSensitiveText(value ?? undefined), 500);
}

function googleProviderCard({
  config,
  connection,
  provider,
  syncJob,
  tokenEncryptionReady
}: {
  config: ProviderConfig;
  connection?: {
    accountEmail: string | null;
    lastError: string | null;
    lastSyncAt: Date | null;
    scopes: Prisma.JsonValue | null;
    secret?: { scopes: Prisma.JsonValue | null } | null;
    status: EmailConnectionStatus;
  };
  provider: "GOOGLE_WORKSPACE";
  syncJob?: {
    createdAt: Date;
    failedAt: Date | null;
    lastError: string | null;
    processedAt: Date | null;
    runAt: Date;
    status: JobStatus;
    updatedAt: Date;
  } | null;
  tokenEncryptionReady: boolean;
}): EmailProviderCard {
  const configured = isProviderConfigured(config);
  const fullInboxScopesReady = connection?.status === "CONNECTED" && hasConnectionProviderScopes(connection, gmailOAuthScopes);
  const syncStatus = gmailSyncJobStatus(syncJob);

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
      connection?.status === "CONNECTED" && connection.accountEmail && fullInboxScopesReady
        ? `Connected to ${connection.accountEmail}. Sync Gmail to store recent inbox messages, read threads, and send explicit replies from Northstar.`
        : connection?.status === "CONNECTED" && connection.accountEmail
          ? `Connected to ${connection.accountEmail}, but Full Inbox needs expanded Gmail read/send scopes. Reconnect Gmail to enable inbox sync and explicit replies.`
          : "Connect Gmail with profile, Gmail read, and Gmail send scopes. Northstar stores encrypted OAuth tokens only; replies are sent only by explicit user action.",
    disabled: false,
    disconnectAvailable: connection?.status === "CONNECTED",
    href: "/api/email-connections/google/connect",
    lastError: safeProviderLastError(connection?.lastError),
    lastSyncAt: connection?.lastSyncAt,
    name: providerLabels[provider],
    provider,
    scopes: [...gmailOAuthScopes],
    syncAvailable: fullInboxScopesReady,
    syncStatusDetail: syncStatus.detail,
    syncStatusLabel: syncStatus.label,
    syncStatusUpdatedAt: syncStatus.updatedAt,
    status:
      connection?.status === "CONNECTED"
        ? fullInboxScopesReady
          ? connection.lastError
            ? "Sync issue"
            : "Connected"
          : "Reconnect required"
        : "Ready to connect"
  };
}

function microsoftProviderCard({
  connection,
  config,
  connectionStatus,
  tokenEncryptionReady
}: {
  connection?: { accountEmail: string | null; lastError: string | null; lastSyncAt: Date | null; status: EmailConnectionStatus };
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
    disconnectAvailable: connection?.status === "CONNECTED",
    detail: connectionStatus
      ? `Connected to ${connection?.accountEmail ?? "Microsoft 365 / Outlook"}. Use manual sync to import recent matched metadata from known contacts.`
      : "Connect Microsoft 365 or Outlook with read-only profile and mail scopes. This stores encrypted OAuth tokens only; manual sync imports matched recent metadata after connection.",
    disabled: false,
    href: "/api/email-connections/microsoft/connect",
    lastError: safeProviderLastError(connection?.lastError),
    lastSyncAt: connection?.lastSyncAt,
    name: providerLabels.MICROSOFT_365,
    provider: "MICROSOFT_365",
    scopes,
    syncAvailable: connection?.status === "CONNECTED",
    syncLabel: "Sync recent Microsoft mail",
    status: connection?.status === "CONNECTED" ? (connection.lastError ? "Sync issue" : "Connected") : "Ready to connect"
  };
}

function isProviderConfigured(config: ProviderConfig) {
  return Boolean(readNonEmpty(config.clientId) && readNonEmpty(config.clientSecret) && readNonEmpty(config.redirectUri));
}

function normalizeScopes(scope: unknown, fallback: readonly string[] = gmailOAuthScopes) {
  const scopes = typeof scope === "string" ? scope.split(/\s+/).map((item) => item.trim()).filter(Boolean) : undefined;
  return scopes && scopes.length > 0 ? scopes : [...fallback];
}

function normalizeGoogleOAuthScopes(scope: unknown) {
  const scopes = new Set(normalizeScopes(scope));
  for (const requiredScope of gmailOAuthScopes) {
    scopes.add(requiredScope);
  }
  return [...scopes];
}

function normalizeStoredScopes(scopes: Prisma.JsonValue | null | undefined) {
  return Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === "string") : [];
}

function mergeProviderScopes(...scopeSources: unknown[]) {
  const scopes = new Set<string>();
  for (const source of scopeSources) {
    for (const scope of normalizeStoredScopes(source as Prisma.JsonValue | null | undefined)) {
      scopes.add(scope);
    }
  }
  return [...scopes];
}

function providerConnectionCardPriority(connection: {
  provider: EmailConnectionProvider;
  scopes: Prisma.JsonValue | null | undefined;
  secret?: { scopes: Prisma.JsonValue | null | undefined } | null;
  status: EmailConnectionStatus;
}) {
  if (connection.status !== "CONNECTED") return 0;
  if (connection.provider === "GOOGLE_WORKSPACE" && hasConnectionProviderScopes(connection, gmailOAuthScopes)) return 2;
  return 1;
}

function gmailInboxSyncJobDedupeKey(connectionId: string) {
  return `gmail-inbox-sync:${connectionId}`;
}

function gmailSyncJobStatus(
  job:
    | {
        createdAt: Date;
        failedAt: Date | null;
        lastError: string | null;
        processedAt: Date | null;
        runAt: Date;
        status: JobStatus;
        updatedAt: Date;
      }
    | null
    | undefined
) {
  if (!job) return { detail: null, label: null };
  if (job.status === JobStatus.PENDING) {
    return { detail: `Queued ${job.createdAt.toISOString()}`, label: "Sync queued", updatedAt: job.updatedAt };
  }
  if (job.status === JobStatus.RUNNING) {
    return { detail: "Gmail inbox sync is currently running.", label: "Sync running", updatedAt: job.updatedAt };
  }
  if (job.status === JobStatus.DEAD) {
    return { detail: safeProviderLastError(job.lastError) ?? "Gmail inbox sync failed.", label: "Sync failed", updatedAt: job.updatedAt };
  }
  if (job.status === JobStatus.FAILED) {
    return {
      detail: safeProviderLastError(job.lastError) ?? `Retry scheduled ${job.runAt.toISOString()}`,
      label: "Sync retry scheduled",
      updatedAt: job.updatedAt
    };
  }
  if (job.status === JobStatus.SUCCEEDED && job.processedAt) {
    return { detail: `Completed ${job.processedAt.toISOString()}`, label: "Sync complete", updatedAt: job.updatedAt };
  }
  return { detail: null, label: null, updatedAt: job.updatedAt };
}

function parseGmailHistoryCursor(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed?.startsWith(gmailHistoryCursorPrefix) ? trimmed.slice(gmailHistoryCursorPrefix.length) || null : null;
}

function formatGmailHistoryCursor(historyId: string) {
  return `${gmailHistoryCursorPrefix}${historyId}`;
}

function newestGmailHistoryId(messages: Array<{ message: GmailMessageResponse }>) {
  const historyIds = messages
    .map((item) => item.message.historyId)
    .filter((historyId): historyId is string => Boolean(historyId));
  if (historyIds.length === 0) return null;
  return historyIds.sort((a, b) => {
    const aNumber = bigIntSafe(a);
    const bNumber = bigIntSafe(b);
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber ? -1 : aNumber < bNumber ? 1 : 0;
    return b.localeCompare(a);
  })[0];
}

function bigIntSafe(value: string) {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDisconnectProvider(provider: unknown): "GOOGLE_WORKSPACE" | "MICROSOFT_365" {
  if (provider === "GOOGLE_WORKSPACE" || provider === "MICROSOFT_365") return provider;
  throw new ApiError("VALIDATION_ERROR", "Choose a connected email provider to disconnect.", 422);
}

function hasProviderScopes(scopes: Prisma.JsonValue | null | undefined, requiredScopes: readonly string[]) {
  const normalized = new Set(normalizeStoredScopes(scopes));
  return requiredScopes.every((scope) => normalized.has(scope));
}

function hasConnectionProviderScopes(
  connection: { scopes: Prisma.JsonValue | null | undefined; secret?: { scopes: Prisma.JsonValue | null | undefined } | null } | null | undefined,
  requiredScopes: readonly string[]
) {
  const normalized = new Set([...normalizeStoredScopes(connection?.scopes), ...normalizeStoredScopes(connection?.secret?.scopes)]);
  return requiredScopes.every((scope) => normalized.has(scope));
}

function assertConnectionProviderScopes(
  connection: { scopes: Prisma.JsonValue | null | undefined; secret?: { scopes: Prisma.JsonValue | null | undefined } | null },
  requiredScopes: readonly string[],
  message: string
) {
  if (!hasConnectionProviderScopes(connection, requiredScopes)) {
    throw new ApiError("EMAIL_PROVIDER_SCOPES_INSUFFICIENT", message, 400);
  }
}

function normalizeAccessTokenExpiresAt(expiresIn: unknown) {
  const seconds =
    typeof expiresIn === "number" ? expiresIn : typeof expiresIn === "string" ? Number.parseFloat(expiresIn) : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000);
}

function readNonEmpty(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeRecentEmailSyncMaxResults(value: number) {
  if (!Number.isFinite(value)) return defaultRecentEmailSyncMaxResults;
  const normalized = Math.trunc(value);
  if (normalized < 1) return 1;
  if (normalized > maxRecentEmailSyncMaxResults) return maxRecentEmailSyncMaxResults;
  return normalized;
}

function normalizeEmailInboxListLimit(value: number) {
  if (!Number.isFinite(value)) return 100;
  const normalized = Math.trunc(value);
  if (normalized < 1) return 1;
  if (normalized > 100) return 100;
  return normalized;
}

function normalizeGmailBeforeDate(value: unknown) {
  const raw = readNonEmptyValue(value);
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ApiError("VALIDATION_ERROR", "Choose a synced inbox date before loading older Gmail messages.", 422);
  }
  return date;
}

function formatGmailSearchDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function normalizeGmailInboxThreadId(value: unknown) {
  const threadId = readNonEmptyValue(value);
  const prefix = "GOOGLE_WORKSPACE:";
  if (!threadId?.startsWith(prefix)) {
    throw new ApiError("VALIDATION_ERROR", "Choose a synced Gmail thread before refreshing it.", 422);
  }
  const providerThreadId = threadId.slice(prefix.length).trim();
  if (!providerThreadId) {
    throw new ApiError("VALIDATION_ERROR", "Choose a synced Gmail thread before refreshing it.", 422);
  }
  return providerThreadId;
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

function normalizeProviderAccountEmail(value: unknown, providerLabel: "Gmail" | "Microsoft") {
  const email = optionalText(value)?.toLowerCase();
  if (!email) {
    throw new ApiError(
      "EMAIL_OAUTH_PROFILE_MISSING_EMAIL",
      `${providerLabel} did not return an account email address.`,
      400
    );
  }
  return email;
}

function buildContactEmailMap<T extends { email: string | null }>(contacts: T[]) {
  const contactsByEmail = new Map<string, T[]>();

  for (const contact of contacts) {
    const email = normalizeEmailAddress(contact.email);
    if (!email) continue;
    contactsByEmail.set(email, [...(contactsByEmail.get(email) ?? []), contact]);
  }

  return new Map(
    [...contactsByEmail.entries()]
      .filter(([, matches]) => matches.length === 1)
      .map(([email, matches]) => [email, matches[0]] as const)
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
  const tenant = readNonEmpty(env.MICROSOFT_OAUTH_TENANT_ID);
  return tenant && isSafeMicrosoftTenantId(tenant) ? tenant : "common";
}

function isSafeMicrosoftTenantId(value: string) {
  return /^[A-Za-z0-9.-]+$/.test(value);
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeGmailMessageBody(message: GmailMessageResponse) {
  const plainText = findGmailPartBody(message.payload, "text/plain");
  if (plainText) return plainText;
  const html = findGmailPartBody(message.payload, "text/html");
  if (html) return stripHtmlForEmailBody(html);
  return null;
}

function findGmailPartBody(part: GmailMessagePart | GmailMessageResponse["payload"] | undefined, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeGmailBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const body = findGmailPartBody(child, mimeType);
    if (body) return body;
  }
  return null;
}

function decodeGmailBase64Url(value: string) {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8").trim();
}

function stripHtmlForEmailBody(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function shouldRefreshExistingGmailInboxLog(log: {
  body: string;
  providerLabels: Prisma.JsonValue | null;
  providerSnippet: string | null;
}) {
  return /^Gmail snippet:/i.test(log.body) || !log.providerLabels || !log.providerSnippet;
}

function emailInboxThreadId(emailLog: { id: string; provider: EmailConnectionProvider | null; providerMessageId: string | null; providerThreadId: string | null }) {
  const provider = emailLog.provider ?? "MANUAL";
  const providerThreadId = emailLog.providerThreadId ?? emailLog.providerMessageId ?? emailLog.id;
  return `${provider}:${providerThreadId}`;
}

function buildEmailInboxThreadSummary(id: string, messages: EmailInboxMessageSummary[]): EmailInboxThreadSummary {
  const sortedMessages = [...messages].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const latestMessage = sortedMessages[sortedMessages.length - 1] as EmailInboxMessageSummary;
  return {
    id,
    isUnread: sortedMessages.some((message) => emailLogProviderLabels(message).includes("UNREAD")),
    latestAt: latestMessage.occurredAt,
    latestMessage,
    linkedRecordLabel: linkedRecordLabel(latestMessage),
    messageCount: sortedMessages.length,
    messages: sortedMessages,
    provider: latestMessage.provider,
    subject: latestMessage.subject
  };
}

function emailLogProviderLabels(emailLog: { providerLabels: Prisma.JsonValue | null }) {
  return Array.isArray(emailLog.providerLabels)
    ? emailLog.providerLabels.filter((label): label is string => typeof label === "string")
    : [];
}

function linkedRecordLabel(emailLog: EmailInboxMessageSummary) {
  if (emailLog.deal) return `Deal: ${emailLog.deal.title}`;
  if (emailLog.lead) return `Lead: ${emailLog.lead.title}`;
  if (emailLog.person) return `Contact: ${formatInboxPersonName(emailLog.person) ?? emailLog.person.email ?? "Unnamed contact"}`;
  if (emailLog.organization) return `Organization: ${emailLog.organization.name}`;
  return null;
}

function formatInboxPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ").trim() || null;
}

function normalizeEmailReplyId(value: unknown) {
  const id = optionalText(value);
  if (!id) {
    throw new ApiError("VALIDATION_ERROR", "Choose an email before sending a reply.", 422);
  }
  return id;
}

function normalizeEmailReplyBody(value: unknown) {
  const body = optionalText(value);
  if (!body) {
    throw new ApiError("VALIDATION_ERROR", "Reply body is required.", 422);
  }
  if (body.length > 20_000) {
    throw new ApiError("VALIDATION_ERROR", "Reply body must be 20,000 characters or fewer.", 422);
  }
  return body;
}

function replySubject(subject: string) {
  return /^re:/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim() || "(No subject)"}`;
}

function encodeGmailRawMessage({ body, from, subject, to }: { body: string; from: string; subject: string; to: string }) {
  const mime = [
    `From: ${sanitizeEmailHeader(from)}`,
    `To: ${sanitizeEmailHeader(to)}`,
    `Subject: ${sanitizeEmailHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ].join("\r\n");
  return Buffer.from(mime, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sanitizeEmailHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function findConnectedEmailConnection(
  workspaceId: string,
  provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365",
  connectionId?: string
) {
  return prisma.emailConnection.findFirst({
    where: {
      ...(connectionId ? { id: connectionId } : {}),
      workspaceId,
      provider,
      status: "CONNECTED",
      deletedAt: null
    },
    include: { secret: true },
    orderBy: { updatedAt: "desc" }
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
