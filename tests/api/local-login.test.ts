import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const loginPage = readFileSync(join(process.cwd(), "app/login/page.tsx"), "utf8");
const loginForm = readFileSync(join(process.cwd(), "app/login/login-form.tsx"), "utf8");
const loginActions = readFileSync(join(process.cwd(), "app/login/actions.ts"), "utf8");
const signupPage = readFileSync(join(process.cwd(), "app/signup/page.tsx"), "utf8");
const signupForm = readFileSync(join(process.cwd(), "app/signup/signup-form.tsx"), "utf8");
const signupActions = readFileSync(join(process.cwd(), "app/signup/actions.ts"), "utf8");
const logoutActions = readFileSync(join(process.cwd(), "app/logout/actions.ts"), "utf8");
const workspaceActions = readFileSync(join(process.cwd(), "app/workspaces/actions.ts"), "utf8");
const createWorkspaceForm = readFileSync(join(process.cwd(), "app/settings/create-workspace-form.tsx"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
const localAuth = readFileSync(join(process.cwd(), "lib/auth/local-auth.ts"), "utf8");
const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("local login MVP", () => {
  it("renders a narrow login page and server-action form", () => {
    expect(loginPage).toContain("Sign in");
    expect(loginPage).toContain("Please sign in to continue.");
    expect(loginPage).toContain("SSO and external email delivery are not part of this MVP.");
    expect(loginPage).toContain("resolveAuthMode() !== \"local\"");
    expect(loginPage).toContain("<LoginForm");
    expect(loginForm).toContain("name=\"email\"");
    expect(loginForm).toContain("name=\"password\"");
    expect(loginForm).toContain("type=\"password\"");
    expect(loginForm).toContain("href=\"/forgot-password\"");
    expect(loginForm).toContain("Forgot your password?");
    expect(loginForm).toContain("const signupHref = nextPath && nextPath !== \"/dashboard\"");
    expect(loginForm).toContain("href={signupHref as Route}");
    expect(loginForm).toContain("Create an account");
    expect(loginForm).toContain("Sign in");
  });

  it("creates a local signup path that signs in and selects a usable workspace", () => {
    expect(signupPage).toContain("Create account");
    expect(signupPage).toContain("sanitizeNextPath(next)");
    expect(signupPage).toContain("<SignupForm nextPath={nextPath}");
    expect(signupForm).toContain("name=\"email\"");
    expect(signupForm).toContain("name=\"password\"");
    expect(signupForm).toContain("name=\"next\"");
    expect(signupForm).toContain("name=\"workspaceName\"");
    expect(signupForm).toContain("minLength={8}");
    expect(signupActions).toContain("resolveAuthMode() !== \"local\"");
    expect(signupActions).toContain("signupWithEmailAndPassword({ email, name, password })");
    expect(signupActions).toContain("createWorkspaceFromName(result.user.id, workspaceName)");
    expect(signupActions).toContain("cookieStore.set(localSessionCookieName");
    expect(signupActions).toContain("cookieStore.set(activeWorkspaceCookieName, workspaceId");
    expect(signupActions).toContain("const nextPath = sanitizeNextPath");
    expect(signupActions).toContain("redirect(nextPath as Route)");
    expect(workspaceService).toContain("ensureDefaultPipelineForWorkspace(workspace.id)");
    expect(localAuth).toContain("signupWithEmailAndPassword");
    expect(localAuth).toContain("An account with this email already exists. Sign in instead.");
    expect(localAuth).toContain("Password must be at least 8 characters.");
  });

  it("creates and clears signed local sessions through the auth seam", () => {
    expect(schema).toContain("model Session");
    expect(schema).toContain("passwordHash");
    expect(loginActions).toContain("\"use server\"");
    expect(loginActions).toContain("resolveAuthMode() !== \"local\"");
    expect(loginActions).toContain("loginWithEmailAndPassword(email, password)");
    expect(loginActions).toContain("serializeLocalSessionCookieValue(session.token)");
    expect(loginActions).toContain("httpOnly: true");
    expect(loginActions).toContain("sameSite: \"lax\"");
    expect(loginActions).toContain("secure: process.env.NODE_ENV === \"production\"");
    expect(logoutActions).toContain("revokeLocalSessionToken(session.token)");
    expect(logoutActions).toContain("activeWorkspaceCookieName");
    expect(logoutActions).toContain("cookieStore.delete(activeWorkspaceCookieName)");
    expect(logoutActions).toContain("cookieStore.delete(localSessionCookieName)");
    expect(appShell).toContain("logoutAction");
    expect(appShell).toContain("signed-in-user");
    expect(localAuth).toContain("deleteExpiredLocalSessions");
    expect(localAuth).toContain("invalidLoginMessage");
    expect(appShell).toContain("Sign out");
  });

  it("wires a member-only workspace selector through the app shell", () => {
    expect(appShell).toContain("listWorkspaceMembershipOptions(actorUserId)");
    expect(appShell).toContain("switchWorkspaceAction");
    expect(appShell).toContain("workspace-select");
    expect(appShell).toContain("currentWorkspace.roleLabel");
    expect(workspaceActions).toContain("activeWorkspaceCookieName");
    expect(workspaceActions).toContain("getRequestContext()");
    expect(workspaceActions).toContain("workspace: { deletedAt: null }");
    expect(workspaceActions).toContain("cookieStore.set(activeWorkspaceCookieName");
    expect(workspaceActions).toContain("cookieStore.delete(activeWorkspaceCookieName)");
    expect(workspaceActions).toContain("secure: process.env.NODE_ENV === \"production\"");
  });

  it("adds a narrow authenticated workspace creation flow", () => {
    expect(workspaceService).toContain("createWorkspaceFromName");
    expect(workspaceService).toContain("Workspace name is required.");
    expect(workspaceService).toContain("generateUniqueWorkspaceSlug");
    expect(workspaceService).toContain("role: workspaceOwnerRole");
    expect(workspaceService).toContain("ensureDefaultPipelineForWorkspace(workspace.id)");
    expect(workspaceActions).toContain("createWorkspaceAction");
    expect(workspaceActions).toContain("createWorkspaceFromName(actorUserId, name)");
    expect(workspaceActions).toContain("cookieStore.set(activeWorkspaceCookieName, workspaceId");
    expect(workspaceActions).toContain("redirect(\"/settings\")");
    expect(createWorkspaceForm).toContain("useActionState(createWorkspaceAction");
    expect(createWorkspaceForm).toContain("Create workspace");
    expect(settingsPage).toContain("<CreateWorkspaceForm");
    expect(settingsPage).toContain("duplicate names are allowed");
  });
});
