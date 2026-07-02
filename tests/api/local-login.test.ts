import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sanitizeAuthNextPath } from "@/lib/auth/next-path";

const loginPage = readFileSync(join(process.cwd(), "app/login/page.tsx"), "utf8");
const loginForm = readFileSync(join(process.cwd(), "app/login/login-form.tsx"), "utf8");
const loginActions = readFileSync(join(process.cwd(), "app/login/actions.ts"), "utf8");
const signupPage = readFileSync(join(process.cwd(), "app/signup/page.tsx"), "utf8");
const signupForm = readFileSync(join(process.cwd(), "app/signup/signup-form.tsx"), "utf8");
const signupActions = readFileSync(join(process.cwd(), "app/signup/actions.ts"), "utf8");
const authSubmitButton = readFileSync(join(process.cwd(), "components/auth-submit-button.tsx"), "utf8");
const authTextField = readFileSync(join(process.cwd(), "components/auth-text-field.tsx"), "utf8");
const logoutActions = readFileSync(join(process.cwd(), "app/logout/actions.ts"), "utf8");
const workspaceActions = readFileSync(join(process.cwd(), "app/workspaces/actions.ts"), "utf8");
const createWorkspaceForm = readFileSync(join(process.cwd(), "app/settings/create-workspace-form.tsx"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
const localAuth = readFileSync(join(process.cwd(), "lib/auth/local-auth.ts"), "utf8");
const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const workspaceValidation = readFileSync(join(process.cwd(), "lib/workspace-validation.ts"), "utf8");
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const authPanel = readFileSync(join(process.cwd(), "components/auth-panel.tsx"), "utf8");
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const deploymentReadiness = readFileSync(join(process.cwd(), "docs/deployment-readiness.md"), "utf8");

describe("local login MVP", () => {
  it("renders a narrow login page and server-action form", () => {
    expect(authPanel).toContain("export function AuthPanel");
    expect(authPanel).toContain("className=\"login-page\"");
    expect(authPanel).toContain("className=\"login-panel\"");
    expect(authPanel).toContain("className=\"page-kicker\"");
    expect(authPanel).toContain("className=\"page-title\"");
    expect(authPanel).toContain("className=\"empty-copy\"");
    expect(loginPage).toContain("import { AuthPanel } from \"@/components/auth-panel\"");
    expect(loginPage).toContain("<AuthPanel");
    expect(loginPage).toContain("Sign in");
    expect(loginPage).toContain("Please sign in to continue.");
    expect(loginPage).toContain("SSO and external email delivery are not part of this MVP.");
    expect(loginPage).not.toContain("<main className=\"login-page\">");
    expect(loginPage).not.toContain("<section className=\"login-panel\">");
    expect(loginPage).toContain("sanitizeAuthNextPath(next)");
    expect(loginPage).toContain("const isContinuation = nextPath !== \"/dashboard\"");
    expect(loginPage).toContain("if (isAuthenticated) redirect(nextPath as Route)");
    expect(loginPage).toContain("<LoginForm nextPath={nextPath}");
    expect(loginPage).toContain("resolveAuthMode() !== \"local\"");
    expect(loginForm).toContain("name=\"email\"");
    expect(loginForm).toContain("name=\"password\"");
    expect(loginForm).toContain("type=\"password\"");
    expect(loginForm).toContain("import { FormErrorMessage }");
    expect(loginForm).toContain("{state.error ? <FormErrorMessage>{state.error}</FormErrorMessage> : null}");
    expect(loginForm).not.toContain("<p className=\"form-error\">{state.error}</p>");
    expect(loginForm).toContain("import { AuthSubmitButton }");
    expect(loginForm).toContain("<AuthSubmitButton pendingLabel=\"Signing in...\" submitLabel=\"Sign in\" />");
    expect(loginForm).not.toContain("function LoginSubmitButton");
    expect(loginForm).toContain("import { AuthTextField }");
    expect(loginForm).toContain("label=\"Email\"");
    expect(loginForm).toContain("label=\"Password\"");
    expect(loginForm).not.toContain("className=\"form-label\"");
    expect(loginForm).toContain("href=\"/forgot-password\"");
    expect(loginForm).toContain("Forgot your password?");
    expect(loginForm).toContain("const signupHref = nextPath && nextPath !== \"/dashboard\"");
    expect(loginForm).toContain("href={signupHref as Route}");
    expect(loginForm).toContain("Create an account");
    expect(loginForm).toContain("Sign in");
  });

  it("creates a local signup path that signs in and selects a usable workspace", () => {
    expect(signupPage).toContain("import { AuthPanel } from \"@/components/auth-panel\"");
    expect(signupPage).toContain("<AuthPanel");
    expect(signupPage).toContain("Create account");
    expect(signupPage).toContain("sanitizeAuthNextPath(next)");
    expect(signupPage).toContain("<SignupForm nextPath={nextPath}");
    expect(signupForm).toContain("name=\"email\"");
    expect(signupForm).toContain("name=\"password\"");
    expect(signupForm).toContain("name=\"next\"");
    expect(signupForm).toContain("name=\"workspaceName\"");
    expect(signupForm).toContain("maxLength={workspaceNameMaxLength}");
    expect(signupForm).toContain("minLength={8}");
    expect(signupForm).toContain("import { FormErrorMessage }");
    expect(signupForm).toContain("{state.error ? <FormErrorMessage>{state.error}</FormErrorMessage> : null}");
    expect(signupForm).not.toContain("<p className=\"form-error\">{state.error}</p>");
    expect(signupForm).toContain("import { AuthSubmitButton }");
    expect(signupForm).toContain("<AuthSubmitButton pendingLabel=\"Creating account...\" submitLabel=\"Create account\" />");
    expect(signupForm).not.toContain("function SignupSubmitButton");
    expect(signupForm).toContain("import { AuthTextField }");
    expect(signupForm).toContain("label=\"Workspace name\"");
    expect(signupForm).not.toContain("className=\"form-label\"");
    expect(signupActions).toContain("validateWorkspaceName(workspaceName)");
    expect(signupActions).toContain("resolveAuthMode() !== \"local\"");
    expect(signupActions).toContain("signupWithEmailAndPassword({ email, name, password })");
    expect(signupActions).toContain("createWorkspaceFromName(result.user.id, normalizedWorkspaceName)");
    expect(signupActions.indexOf("validateWorkspaceName(workspaceName)")).toBeLessThan(
      signupActions.indexOf("signupWithEmailAndPassword({ email, name, password })")
    );
    expect(signupActions).toContain("cookieStore.set(localSessionCookieName");
    expect(signupActions).toContain("cookieStore.set(activeWorkspaceCookieName, workspaceId");
    expect(signupActions).toContain("const nextPath = sanitizeAuthNextPath");
    expect(signupActions).toContain("redirect(nextPath as Route)");
    expect(workspaceService).toContain("ensureDefaultPipelineForWorkspace(workspace.id)");
    expect(localAuth).toContain("signupWithEmailAndPassword");
    expect(localAuth).toContain("An account with this email already exists. Sign in instead.");
    expect(localAuth).toContain("Password must be at least 8 characters.");
    expect(localAuth).toContain("normalizeLocalAuthEmail(input.email)");
    expect(localAuth).toContain("normalizeLocalAuthPassword(input.password)");
  });

  it("shares the auth submit button pending-state pattern", () => {
    expect(authSubmitButton).toContain("\"use client\"");
    expect(authSubmitButton).toContain("useFormStatus");
    expect(authSubmitButton).toContain("pendingLabel");
    expect(authSubmitButton).toContain("submitLabel");
    expect(authSubmitButton).toContain("actionLabel?: string");
    expect(authSubmitButton).toContain("const resolvedActionLabel = actionLabel ?? submitLabel");
    expect(authSubmitButton).toContain("aria-label={resolvedActionLabel}");
    expect(authSubmitButton).toContain("title={resolvedActionLabel}");
    expect(authSubmitButton).toContain("className=\"button-primary\"");
    expect(authSubmitButton).toContain("disabled={pending}");
    expect(authSubmitButton).toContain("pending ? pendingLabel : submitLabel");
    expect(authTextField).toContain("export function AuthTextField");
    expect(authTextField).toContain("className=\"form-label\"");
    expect(authTextField).toContain("classNames = [\"text-input\", className]");
    expect(authTextField).toContain("<input className={classNames} id={id} name={name} {...inputProps} />");
  });

  it("creates and clears signed local sessions through the auth seam", () => {
    expect(schema).toContain("model Session");
    expect(schema).toContain("passwordHash");
    expect(loginActions).toContain("\"use server\"");
    expect(loginActions).toContain("resolveAuthMode() !== \"local\"");
    expect(loginActions).toContain("loginWithEmailAndPassword(email, password)");
    expect(loginActions).toContain("const nextPath = sanitizeAuthNextPath");
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
    expect(localAuth).toContain("normalizeLocalAuthEmail(email)");
    expect(localAuth).toContain("normalizeLocalAuthPassword(password)");
    expect(appShell).toContain("Sign out");
  });

  it("sanitizes auth continuation paths before redirects and form handoffs", () => {
    expect(sanitizeAuthNextPath("/workspaces/invitations/inv_123")).toBe("/workspaces/invitations/inv_123");
    expect(sanitizeAuthNextPath("/dashboard?tab=today#agenda")).toBe("/dashboard?tab=today#agenda");
    expect(sanitizeAuthNextPath(["/settings"])).toBe("/dashboard");
    expect(sanitizeAuthNextPath({ next: "/settings" })).toBe("/dashboard");
    expect(sanitizeAuthNextPath(undefined)).toBe("/dashboard");
    expect(sanitizeAuthNextPath("https://evil.example.test/dashboard")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("https://northstar.local/workspaces/invitations/inv_123")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("//evil.example.test/dashboard")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("/\\evil.example.test/dashboard")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("/\tevil.example.test/dashboard")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("/login?next=/settings")).toBe("/dashboard");
    expect(sanitizeAuthNextPath("/signup?next=/settings")).toBe("/dashboard");
    expect(loginPage).toContain("import { sanitizeAuthNextPath } from \"@/lib/auth/next-path\"");
    expect(loginActions).toContain("import { sanitizeAuthNextPath } from \"@/lib/auth/next-path\"");
    expect(signupPage).toContain("import { sanitizeAuthNextPath } from \"@/lib/auth/next-path\"");
    expect(signupActions).toContain("import { sanitizeAuthNextPath } from \"@/lib/auth/next-path\"");
    expect(loginPage).not.toContain("function sanitizeNextPath");
    expect(loginActions).not.toContain("function sanitizeNextPath");
    expect(signupPage).not.toContain("function sanitizeNextPath");
    expect(signupActions).not.toContain("function sanitizeNextPath");
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
    expect(workspaceService).toContain("validateWorkspaceName(data.name)");
    expect(workspaceService).toContain("validateWorkspaceName(name)");
    expect(workspaceValidation).toContain("Workspace name is required.");
    expect(workspaceValidation).toContain("workspaceNameMaxLength = 120");
    expect(workspaceValidation).toContain("Workspace name must be");
    expect(workspaceService).toContain("generateUniqueWorkspaceSlug");
    expect(workspaceService).toContain("role: workspaceOwnerRole");
    expect(workspaceService).toContain("ensureDefaultPipelineForWorkspace(workspace.id)");
    expect(workspaceActions).toContain("createWorkspaceAction");
    expect(workspaceActions).toContain("createWorkspaceFromName(actorUserId, name)");
    expect(workspaceActions).toContain("cookieStore.set(activeWorkspaceCookieName, workspaceId");
    expect(workspaceActions).toContain("redirect(\"/settings\")");
    expect(createWorkspaceForm).toContain("useActionState(createWorkspaceAction");
    expect(createWorkspaceForm).toContain("maxLength={workspaceNameMaxLength}");
    expect(createWorkspaceForm).toContain("Create workspace");
    expect(settingsPage).toContain("<CreateWorkspaceForm");
    expect(settingsPage).toContain("duplicate names are allowed");
  });

  it("keeps local-auth readiness docs aligned with signup and invitation behavior", () => {
    expect(readme).toContain("Local auth also supports signup-created users and clean first workspaces");
    expect(readme).not.toContain("Local login is intentionally limited to existing users; signup");
    expect(deploymentReadiness).toContain("`AUTH_MODE=local` enables `/signup`, `/login`");
    expect(deploymentReadiness).toContain("It includes signup/login");
    expect(deploymentReadiness).not.toContain("It does not include signup");
    expect(currentStatus).toContain("email/password signup/login");
    expect(currentStatus).toContain("new users can sign up into a clean workspace");
    expect(deploymentReadiness).toContain("Invitees without accounts can sign up with the invited email before accepting.");
    expect(architecture).toContain("invited people without accounts can sign up with the invited email before accepting");
    expect(architecture).toContain("enables built-in email/password signup and login");
    expect(architecture).not.toContain("Invites are for existing users only");
  });
});
