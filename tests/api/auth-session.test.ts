import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  defaultAuthUserIdHeader,
  isSafeAuthUserIdHeaderName,
  localSessionCookieName,
  readLocalSessionToken,
  resolveAuthMode,
  resolveAuthUserIdHeader,
  resolveSessionIdentity,
  serializeLocalSessionCookieValue
} from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { shouldRedirectToLoginForMissingAppSession } from "@/lib/auth/request-context";
import { ApiError } from "@/lib/api/responses";

const middlewareSource = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");

describe("auth session abstraction", () => {
  it("resolves a trusted user header without coupling request context to a hardcoded user", () => {
    expect(resolveSessionIdentity(new Headers({ "x-user-id": "user-123" }), { AUTH_MODE: "trusted-header" })).toEqual({
      kind: "user",
      source: "trusted-header",
      userId: "user-123"
    });
  });

  it("supports a configurable trusted user-id header", () => {
    expect(resolveAuthUserIdHeader({ AUTH_USER_ID_HEADER: "X-Northstar-User" })).toBe("x-northstar-user");
    expect(resolveAuthUserIdHeader({})).toBe(defaultAuthUserIdHeader);
    expect(
      resolveSessionIdentity(new Headers({ "x-northstar-user": "user-456" }), {
        AUTH_MODE: "trusted-header",
        AUTH_USER_ID_HEADER: "X-Northstar-User"
      })
    ).toEqual({
      kind: "user",
      source: "trusted-header",
      userId: "user-456"
    });
  });

  it("rejects unsafe trusted header names", () => {
    expect(isSafeAuthUserIdHeaderName("x-northstar-user-id")).toBe(true);
    expect(isSafeAuthUserIdHeaderName("x northstar user")).toBe(false);
    expect(isSafeAuthUserIdHeaderName("authorization")).toBe(false);
    expect(isSafeAuthUserIdHeaderName("cookie")).toBe(false);
    expect(isSafeAuthUserIdHeaderName("x-forwarded-for")).toBe(false);
    expect(isSafeAuthUserIdHeaderName({ header: "x-user-id" } as unknown as string)).toBe(false);
  });

  it("keeps seeded demo fallback gated to demo mode", () => {
    expect(resolveSessionIdentity(new Headers(), { AUTH_MODE: "demo" })).toEqual({
      kind: "demo",
      source: "demo",
      email: "alex@example.test"
    });
    expect(
      resolveSessionIdentity(new Headers(), {
        AUTH_MODE: "demo",
        DEV_ACTOR_EMAIL: "sam@example.test"
      })
    ).toEqual({
      kind: "demo",
      source: "demo",
      email: "sam@example.test"
    });
    expect(
      resolveSessionIdentity(new Headers({ "x-user-id": "spoofed-user-id" }), {
        AUTH_MODE: "demo",
        DEV_ACTOR_EMAIL: "sam@example.test"
      })
    ).toEqual({
      kind: "demo",
      source: "demo",
      email: "sam@example.test"
    });
  });

  it("resolves a signed local session cookie only in local mode", () => {
    const env = {
      AUTH_MODE: "local",
      AUTH_SESSION_SECRET: "a-local-session-secret-with-enough-length"
    };
    const cookieValue = serializeLocalSessionCookieValue("session-token-123", env);

    expect(resolveSessionIdentity(new Headers({ cookie: `${localSessionCookieName}=${cookieValue}` }), env)).toEqual({
      kind: "session",
      source: "local-session",
      token: "session-token-123"
    });
    expect(
      resolveSessionIdentity(new Headers({ cookie: `${localSessionCookieName}=session-token-123.bad-signature` }), env)
    ).toEqual({
      kind: "missing",
      mode: "local"
    });
    expect(
      resolveSessionIdentity(new Headers({ cookie: `${localSessionCookieName}=${cookieValue}.extra` }), env)
    ).toEqual({
      kind: "missing",
      mode: "local"
    });
    expect(
      resolveSessionIdentity(new Headers({ "x-user-id": "user-123", cookie: `${localSessionCookieName}=${cookieValue}` }), env)
    ).toEqual({
      kind: "session",
      source: "local-session",
      token: "session-token-123"
    });
    expect(resolveSessionIdentity(new Headers({ "x-user-id": "user-123" }), env)).toEqual({
      kind: "missing",
      mode: "local"
    });
    expect(readLocalSessionToken({ cookie: `${localSessionCookieName}=${cookieValue}` } as unknown as string, env)).toBeNull();
    expect(serializeLocalSessionCookieValue({ token: "session-token-123" } as unknown as string, env)).toBe(".");
  });

  it("returns missing session outside demo mode", () => {
    expect(resolveSessionIdentity(new Headers(), { AUTH_MODE: "trusted-header" })).toEqual({
      kind: "missing",
      mode: "trusted-header"
    });
    expect(resolveSessionIdentity(new Headers(), { AUTH_MODE: "local" })).toEqual({
      kind: "missing",
      mode: "local"
    });
    expect(resolveSessionIdentity(new Headers(), { AUTH_MODE: "local", DEV_ACTOR_EMAIL: "alex@example.test" })).toEqual({
      kind: "missing",
      mode: "local"
    });
  });

  it("defaults to demo outside production and trusted-header in production", () => {
    expect(resolveAuthMode({ NODE_ENV: "test" })).toBe("demo");
    expect(resolveAuthMode({ NODE_ENV: "development" })).toBe("demo");
    expect(resolveAuthMode({ NODE_ENV: "production" })).toBe("trusted-header");
  });

  it("hashes local login passwords and rejects malformed stored hashes", () => {
    const storedHash = hashPassword("northstar-demo");

    expect(storedHash).not.toContain("northstar-demo");
    expect(verifyPassword("northstar-demo", storedHash)).toBe(true);
    expect(verifyPassword("wrong-password", storedHash)).toBe(false);
    expect(verifyPassword("northstar-demo", "not-a-valid-hash")).toBe(false);
  });

  it("redirects app pages to login only for missing local sessions", () => {
    const unauthenticatedError = new ApiError("UNAUTHENTICATED", "A signed-in user is required.", 401);

    expect(shouldRedirectToLoginForMissingAppSession(unauthenticatedError, { AUTH_MODE: "local" })).toBe(true);
    expect(shouldRedirectToLoginForMissingAppSession(unauthenticatedError, { AUTH_MODE: "trusted-header" })).toBe(false);
    expect(shouldRedirectToLoginForMissingAppSession(new ApiError("FORBIDDEN", "Nope.", 403), { AUTH_MODE: "local" })).toBe(false);
  });

  it("guards protected app pages before local-auth requests fall through to server data loading", () => {
    expect(middlewareSource).toContain("process.env.AUTH_MODE !== \"local\"");
    expect(middlewareSource).toContain("localSessionCookieName = \"northstar_session\"");
    expect(middlewareSource).toContain("NextResponse.redirect(loginUrl)");
    expect(middlewareSource).toContain("loginUrl.pathname = \"/login\"");
    expect(middlewareSource).toContain("loginUrl.searchParams.set(\"next\"");
    expect(middlewareSource).not.toContain("alex@example.test");

    [
      "/dashboard",
      "/pipeline",
      "/deals",
      "/contacts",
      "/organizations",
      "/leads",
      "/activities",
      "/email",
      "/reports",
      "/settings",
      "/products",
      "/custom-fields",
      "/search"
    ].forEach((route) => {
      expect(middlewareSource).toContain(`"${route}"`);
    });

    expect(middlewareSource).toContain("pathname === route || pathname.startsWith(`${route}/`)");
    expect(middlewareSource).toContain("matcher: [\"/((?!api|_next/static|_next/image|favicon.ico|q/).*)\"]");
  });
});
