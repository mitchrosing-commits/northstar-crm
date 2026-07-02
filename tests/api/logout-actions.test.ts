import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activeWorkspaceCookieName } from "@/lib/auth/request-context";
import {
  localSessionCookieName,
  serializeLocalSessionCookieValue
} from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
  revokeLocalSessionToken: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
  headers: mocks.headers
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/auth/local-auth", () => ({
  revokeLocalSessionToken: mocks.revokeLocalSessionToken
}));

import { logoutAction } from "@/app/logout/actions";

const sessionSecret = "a-local-session-secret-with-enough-length";

function redirectError(url: string) {
  return Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT", url });
}

async function expectLogoutRedirect() {
  await expect(logoutAction()).rejects.toMatchObject({
    digest: "NEXT_REDIRECT",
    url: "/login"
  });
}

describe("logout server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_MODE", "local");
    vi.stubEnv("AUTH_SESSION_SECRET", sessionSecret);
    mocks.cookies.mockResolvedValue({ delete: mocks.cookieDelete });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("revokes signed local sessions and clears both local auth cookies", async () => {
    const cookieValue = serializeLocalSessionCookieValue("session-token-1", {
      AUTH_SESSION_SECRET: sessionSecret
    });
    mocks.headers.mockResolvedValue(
      new Headers({ cookie: `${localSessionCookieName}=${cookieValue}; theme=light` })
    );

    await expectLogoutRedirect();

    expect(mocks.revokeLocalSessionToken).toHaveBeenCalledWith("session-token-1");
    expect(mocks.cookieDelete).toHaveBeenCalledWith(activeWorkspaceCookieName);
    expect(mocks.cookieDelete).toHaveBeenCalledWith(localSessionCookieName);
  });

  it("still clears cookies and redirects when there is no valid local session to revoke", async () => {
    mocks.headers.mockResolvedValue(new Headers());

    await expectLogoutRedirect();

    expect(mocks.revokeLocalSessionToken).not.toHaveBeenCalled();
    expect(mocks.cookieDelete).toHaveBeenNthCalledWith(1, activeWorkspaceCookieName);
    expect(mocks.cookieDelete).toHaveBeenNthCalledWith(2, localSessionCookieName);
  });
});
