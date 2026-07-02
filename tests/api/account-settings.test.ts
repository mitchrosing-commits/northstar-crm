import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const accountHelper = readFileSync(join(process.cwd(), "lib/auth/account.ts"), "utf8");
const accountActions = readFileSync(join(process.cwd(), "app/settings/account-actions.ts"), "utf8");
const accountForm = readFileSync(join(process.cwd(), "app/settings/account-settings-form.tsx"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("account settings MVP", () => {
  it("renders a current-user account panel on the authenticated settings page", () => {
    expect(settingsPage).toContain("getCurrentWorkspaceContext()");
    expect(settingsPage).toContain("className=\"panel section-separated\"");
    expect(settingsPage).toContain("<AccountSettingsForm");
    expect(settingsPage).toContain("currentName={user.name}");
    expect(settingsPage).toContain("email={user.email}");
    expect(settingsPage).toContain("roleLabel={summary.currentMembership.roleLabel}");
    expect(accountForm).toContain("import { FormFieldLabel }");
    expect(accountForm).toContain("import { FormSuccessMessage }");
    expect(accountForm).toContain("<FormFieldLabel required>Display name</FormFieldLabel>");
    expect(accountForm).toContain("Display name");
    expect(accountForm).toContain("Email");
    expect(accountForm).toContain("Current workspace");
    expect(accountForm).toContain("Workspace role");
    expect(accountForm).toContain("className=\"field-grid account-context-grid\"");
    expect(accountForm).toContain("<dt className=\"field-label\">Current workspace</dt>");
    expect(accountForm).toContain("<dd className=\"field-value\">{workspaceName}</dd>");
    expect(accountForm).toContain("<dt className=\"field-label\">Workspace role</dt>");
    expect(accountForm).toContain("<dd className=\"field-value\">{roleLabel}</dd>");
    expect(globalStyles).toContain(".section-separated");
    expect(globalStyles).toContain(".account-context-grid");
    expect(accountForm).toContain("{state.message ? <FormSuccessMessage>{state.message}</FormSuccessMessage> : null}");
    expect(accountForm).not.toContain("<p className=\"form-success\">{state.message}</p>");
  });

  it("submits only display name and keeps email read-only", () => {
    expect(accountForm).toContain("name=\"name\"");
    expect(accountForm).toContain("maxLength={120}");
    expect(accountForm).toContain("readOnly");
    expect(accountForm).toContain("type=\"email\"");
    expect(accountForm).not.toContain("name=\"email\"");
    expect(accountActions).toContain("String(formData.get(\"name\") ?? \"\")");
    expect(accountActions).not.toContain("formData.get(\"email\")");
    expect(accountActions).not.toContain("formData.get(\"userId\")");
    expect(accountActions).not.toContain("formData.get(\"targetUserId\")");
  });

  it("updates only the current authenticated user display name", () => {
    expect(accountActions).toContain("getRequestContext()");
    expect(accountActions).toContain("updateCurrentUserDisplayName(actorUserId, name)");
    expect(accountActions).toContain("revalidatePath(\"/settings\")");
    expect(accountHelper).toContain("normalizeAccountDisplayName");
    expect(accountHelper).toContain("typeof value === \"string\"");
    expect(accountHelper).toContain("Display name is required.");
    expect(accountHelper).toContain("accountDisplayNameMaxLength = 120");
    expect(accountHelper).toContain("prisma.$transaction");
    expect(accountHelper).toContain("where: { id: actorUserId, deletedAt: null }");
    expect(accountHelper).toContain("The current user could not be resolved.");
    expect(accountHelper).toContain("data: { name: normalizedName }");
    expect(accountHelper).not.toContain("passwordHash");
    expect(accountHelper).not.toContain("writeAuditLog");
    expect(accountHelper).not.toContain("auditLog");
  });

  it("documents the account settings boundary", () => {
    expect(routeMap).toContain("display-name account settings");
    expect(currentStatus).toContain("Account Settings MVP");
    expect(currentStatus).toContain("display-name updates only");
  });
});
