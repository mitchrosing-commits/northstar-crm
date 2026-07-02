import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/responses";
import { activeWorkspaceCookieName } from "@/lib/auth/request-context";
import {
  localSessionCookieName,
  readLocalSessionToken
} from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createWorkspaceFromName: vi.fn(),
  loginWithEmailAndPassword: vi.fn(),
  redirect: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPasswordWithToken: vi.fn(),
  signupWithEmailAndPassword: vi.fn()
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/auth/local-auth", () => ({
  loginWithEmailAndPassword: mocks.loginWithEmailAndPassword,
  signupWithEmailAndPassword: mocks.signupWithEmailAndPassword
}));

vi.mock("@/lib/auth/password-reset", () => ({
  requestPasswordReset: mocks.requestPasswordReset,
  resetPasswordWithToken: mocks.resetPasswordWithToken
}));

vi.mock("@/lib/services/crm", () => ({
  createWorkspaceFromName: mocks.createWorkspaceFromName
}));

import { forgotPasswordAction } from "@/app/forgot-password/actions";
import { loginAction } from "@/app/login/actions";
import { resetPasswordAction } from "@/app/reset-password/actions";
import { signupAction } from "@/app/signup/actions";

const sessionSecret = "a-local-session-secret-with-enough-length";
const sessionExpiresAt = new Date("2030-01-01T00:00:00.000Z");

function redirectError(url: string) {
  return Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT", url });
}

function form(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

function lastCookieValue(name: string) {
  const matchingCall = mocks.cookieSet.mock.calls.find(([cookieName]) => cookieName === name);
  return matchingCall?.[1] as string | undefined;
}

describe("auth server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_MODE", "local");
    vi.stubEnv("AUTH_SESSION_SECRET", sessionSecret);
    vi.stubEnv("NODE_ENV", "test");
    mocks.cookies.mockResolvedValue({ set: mocks.cookieSet });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("logs in local users, sets a signed httpOnly session cookie, and redirects only to a safe next path", async () => {
    mocks.loginWithEmailAndPassword.mockResolvedValue({
      session: { expiresAt: sessionExpiresAt, token: "local-session-token" }
    });

    await expect(
      loginAction(
        { email: "" },
        form({
          email: "founder@example.test",
          next: "/deals?status=open#top",
          password: "northstar-demo"
        })
      )
    ).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/deals?status=open#top"
    });

    expect(mocks.loginWithEmailAndPassword).toHaveBeenCalledWith("founder@example.test", "northstar-demo");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      localSessionCookieName,
      expect.any(String),
      expect.objectContaining({
        expires: sessionExpiresAt,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: false
      })
    );
    expect(
      readLocalSessionToken(`${localSessionCookieName}=${lastCookieValue(localSessionCookieName)}`, {
        AUTH_SESSION_SECRET: sessionSecret
      })
    ).toBe("local-session-token");
  });

  it("keeps login unavailable outside local auth and redacts typed login errors", async () => {
    vi.stubEnv("AUTH_MODE", "trusted-header");

    await expect(
      loginAction({ email: "" }, form({ email: "founder@example.test", password: "secret", next: "/settings" }))
    ).resolves.toEqual({
      email: "founder@example.test",
      error: "Email/password login is available only when AUTH_MODE is local."
    });
    expect(mocks.loginWithEmailAndPassword).not.toHaveBeenCalled();
    expect(mocks.cookieSet).not.toHaveBeenCalled();

    vi.stubEnv("AUTH_MODE", "local");
    mocks.loginWithEmailAndPassword.mockRejectedValue(
      new ApiError("UNAUTHENTICATED", "Login failed for founder@example.test with token=raw-login-token", 401)
    );

    await expect(
      loginAction({ email: "" }, form({ email: "founder@example.test", password: "secret", next: "/settings" }))
    ).resolves.toEqual({
      email: "founder@example.test",
      error: "Login failed for [redacted email] with token=[redacted]"
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("creates a signup workspace, stores session and workspace cookies, and sanitizes unsafe next paths", async () => {
    mocks.signupWithEmailAndPassword.mockResolvedValue({
      session: { expiresAt: sessionExpiresAt, token: "signup-session-token" },
      user: { id: "user_1" }
    });
    mocks.createWorkspaceFromName.mockResolvedValue({ id: "workspace_1" });

    await expect(
      signupAction(
        { email: "", name: "", workspaceName: "" },
        form({
          email: "founder@example.test",
          name: "Founder",
          next: "https://evil.example.test/deals",
          password: "northstar-demo",
          workspaceName: " Founder Workspace "
        })
      )
    ).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/dashboard"
    });

    expect(mocks.signupWithEmailAndPassword).toHaveBeenCalledWith({
      email: "founder@example.test",
      name: "Founder",
      password: "northstar-demo"
    });
    expect(mocks.createWorkspaceFromName).toHaveBeenCalledWith("user_1", "Founder Workspace");
    expect(
      readLocalSessionToken(`${localSessionCookieName}=${lastCookieValue(localSessionCookieName)}`, {
        AUTH_SESSION_SECRET: sessionSecret
      })
    ).toBe("signup-session-token");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      activeWorkspaceCookieName,
      "workspace_1",
      expect.objectContaining({
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
        sameSite: "lax",
        secure: false
      })
    );
  });

  it("rejects malformed signup workspace names before creating accounts and redacts typed signup failures", async () => {
    await expect(
      signupAction(
        { email: "", name: "", workspaceName: "" },
        form({
          email: "founder@example.test",
          name: "Founder",
          password: "northstar-demo",
          workspaceName: " "
        })
      )
    ).resolves.toEqual({
      email: "founder@example.test",
      error: "Workspace name is required.",
      name: "Founder",
      workspaceName: " "
    });
    expect(mocks.signupWithEmailAndPassword).not.toHaveBeenCalled();
    expect(mocks.createWorkspaceFromName).not.toHaveBeenCalled();

    mocks.signupWithEmailAndPassword.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Signup failed for founder@example.test with token=raw-signup-token", 422)
    );

    await expect(
      signupAction(
        { email: "", name: "", workspaceName: "" },
        form({
          email: "founder@example.test",
          name: "Founder",
          password: "northstar-demo",
          workspaceName: "Founder Workspace"
        })
      )
    ).resolves.toEqual({
      email: "founder@example.test",
      error: "Signup failed for [redacted email] with token=[redacted]",
      name: "Founder",
      workspaceName: "Founder Workspace"
    });
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("returns password reset request messages and only exposes development reset URLs when a raw token is returned", async () => {
    mocks.requestPasswordReset.mockResolvedValue({
      message: "If an account exists, a reset link will be sent.",
      resetToken: "reset/token with spaces"
    });

    await expect(
      forgotPasswordAction({ email: "" }, form({ email: "founder@example.test" }))
    ).resolves.toEqual({
      email: "founder@example.test",
      message: "If an account exists, a reset link will be sent.",
      resetUrl: "/reset-password?token=reset%2Ftoken%20with%20spaces"
    });

    expect(mocks.requestPasswordReset).toHaveBeenCalledWith("founder@example.test");

    mocks.requestPasswordReset.mockResolvedValue({
      message: "If an account exists, a reset link will be sent.",
      resetToken: undefined
    });
    await expect(
      forgotPasswordAction({ email: "" }, form({ email: "nobody@example.test" }))
    ).resolves.toEqual({
      email: "nobody@example.test",
      message: "If an account exists, a reset link will be sent.",
      resetUrl: undefined
    });
  });

  it("validates reset password confirmation, redacts typed reset errors, and returns success after token reset", async () => {
    await expect(
      resetPasswordAction(
        {},
        form({
          confirmPassword: "different-password",
          password: "new-password",
          token: "raw-reset-token"
        })
      )
    ).resolves.toEqual({ error: "Passwords must match." });
    expect(mocks.resetPasswordWithToken).not.toHaveBeenCalled();

    mocks.resetPasswordWithToken.mockRejectedValueOnce(
      new ApiError("VALIDATION_ERROR", "Reset failed for founder@example.test with token=raw-reset-token", 422)
    );
    await expect(
      resetPasswordAction(
        {},
        form({
          confirmPassword: "new-password",
          password: "new-password",
          token: "raw-reset-token"
        })
      )
    ).resolves.toEqual({
      error: "Reset failed for [redacted email] with token=[redacted]"
    });

    mocks.resetPasswordWithToken.mockResolvedValueOnce(undefined);
    await expect(
      resetPasswordAction(
        {},
        form({
          confirmPassword: "new-password",
          password: "new-password",
          token: "safe-reset-token"
        })
      )
    ).resolves.toEqual({ success: true });
    expect(mocks.resetPasswordWithToken).toHaveBeenLastCalledWith("safe-reset-token", "new-password");
  });
});
