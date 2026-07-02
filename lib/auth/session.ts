import { createHmac, timingSafeEqual } from "node:crypto";

export const authModes = ["demo", "trusted-header", "local"] as const;
export const defaultAuthUserIdHeader = "x-user-id";
export const defaultDemoActorEmail = "alex@example.test";
export const localSessionCookieName = "northstar_session";
export const unsafeAuthUserIdHeaders = [
  "authorization",
  "cookie",
  "host",
  "proxy-authorization",
  "set-cookie",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto"
] as const;

export type AuthMode = (typeof authModes)[number];

export type SessionIdentity =
  | {
      kind: "user";
      source: "trusted-header";
      userId: string;
    }
  | {
      kind: "session";
      source: "local-session";
      token: string;
    }
  | {
      kind: "demo";
      source: "demo";
      email: string;
    }
  | {
      kind: "missing";
      mode: AuthMode;
    };

type EnvInput = Record<string, string | undefined>;

export function resolveSessionIdentity(
  headers: Pick<Headers, "get">,
  env: EnvInput = process.env
): SessionIdentity {
  const mode = resolveAuthMode(env);
  const headerUserId = headers.get(resolveAuthUserIdHeader(env))?.trim();

  if (mode === "trusted-header" && headerUserId) {
    return {
      kind: "user",
      source: "trusted-header",
      userId: headerUserId
    };
  }

  if (mode === "local") {
    const token = readLocalSessionToken(headers.get("cookie"), env);
    if (token) {
      return {
        kind: "session",
        source: "local-session",
        token
      };
    }

    return { kind: "missing", mode };
  }

  if (mode === "demo") {
    return {
      kind: "demo",
      source: "demo",
      email: env.DEV_ACTOR_EMAIL?.trim() || defaultDemoActorEmail
    };
  }

  return { kind: "missing", mode };
}

export function resolveAuthMode(env: EnvInput = process.env): AuthMode {
  const mode = env.AUTH_MODE?.trim();
  if (mode === "demo" || mode === "trusted-header" || mode === "local") return mode;
  return env.NODE_ENV === "production" ? "trusted-header" : "demo";
}

export function resolveAuthUserIdHeader(env: EnvInput = process.env) {
  return env.AUTH_USER_ID_HEADER?.trim().toLowerCase() || defaultAuthUserIdHeader;
}

export function isSafeAuthUserIdHeaderName(headerName: string) {
  if (typeof headerName !== "string") return false;
  const normalized = headerName.trim().toLowerCase();
  return isValidHeaderName(normalized) && !unsafeAuthUserIdHeaders.includes(normalized as (typeof unsafeAuthUserIdHeaders)[number]);
}

function isValidHeaderName(headerName: string) {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(headerName);
}

export function serializeLocalSessionCookieValue(token: string, env: EnvInput = process.env) {
  const normalizedToken = normalizeLocalSessionToken(token);
  return `${normalizedToken}.${signLocalSessionToken(normalizedToken, env)}`;
}

export function readLocalSessionToken(cookieHeader: string | null | undefined, env: EnvInput = process.env) {
  const cookieValue = parseCookieHeader(cookieHeader).get(localSessionCookieName);
  if (!cookieValue) return null;

  const parts = cookieValue.split(".");
  if (parts.length !== 2) return null;

  const [token, signature] = parts;
  if (!token || !signature) return null;

  const expectedSignature = signLocalSessionToken(token, env);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) return null;

  return timingSafeEqual(signatureBuffer, expectedBuffer) ? token : null;
}

function signLocalSessionToken(token: string, env: EnvInput = process.env) {
  if (typeof token !== "string" || !token) return "";
  const secret = env.AUTH_SESSION_SECRET?.trim();
  if (!secret) return "";
  return createHmac("sha256", secret).update(token).digest("base64url");
}

function normalizeLocalSessionToken(token: unknown) {
  return typeof token === "string" ? token : "";
}

function parseCookieHeader(cookieHeader: unknown) {
  const cookies = new Map<string, string>();
  const parts = typeof cookieHeader === "string" ? cookieHeader.split(";") : [];
  for (const part of parts) {
    const [rawName, ...rawValue] = part.split("=");
    const name = rawName?.trim();
    if (!name) continue;
    cookies.set(name, rawValue.join("=").trim());
  }
  return cookies;
}
