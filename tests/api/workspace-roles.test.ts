import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MembershipRole } from "@prisma/client";

import { describe, expect, it } from "vitest";

import {
  canManageWorkspaceSettings,
  canTransferWorkspaceOwnership,
  compareWorkspaceRoles,
  isWorkspaceAdmin,
  isWorkspaceMember,
  isWorkspaceOwner,
  workspaceRoleLabel
} from "@/lib/workspace-roles";

const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("workspace roles and membership visibility", () => {
  it("centralizes role labels and settings-level capability flags", () => {
    expect(workspaceRoleLabel("OWNER")).toBe("Owner");
    expect(workspaceRoleLabel("ADMIN")).toBe("Admin");
    expect(workspaceRoleLabel("MEMBER")).toBe("Member");

    expect(isWorkspaceMember("OWNER")).toBe(true);
    expect(isWorkspaceMember("ADMIN")).toBe(true);
    expect(isWorkspaceMember("MEMBER")).toBe(true);
    expect(isWorkspaceMember(null)).toBe(false);

    expect(isWorkspaceAdmin("OWNER")).toBe(true);
    expect(isWorkspaceAdmin("ADMIN")).toBe(true);
    expect(isWorkspaceAdmin("MEMBER")).toBe(false);
    expect(isWorkspaceOwner("OWNER")).toBe(true);
    expect(isWorkspaceOwner("ADMIN")).toBe(false);
    expect(canManageWorkspaceSettings("OWNER")).toBe(true);
    expect(canManageWorkspaceSettings("ADMIN")).toBe(true);
    expect(canManageWorkspaceSettings("MEMBER")).toBe(false);
    expect(canTransferWorkspaceOwnership("OWNER")).toBe(true);
    expect(canTransferWorkspaceOwnership("ADMIN")).toBe(false);
    const roles: MembershipRole[] = ["MEMBER", "OWNER", "ADMIN"];
    expect(roles.sort(compareWorkspaceRoles)).toEqual(["OWNER", "ADMIN", "MEMBER"]);
  });

  it("uses role policy in workspace membership summary code", () => {
    expect(workspaceService).toContain("getWorkspaceMembershipSummary");
    expect(workspaceService).toContain("canManageWorkspaceSettings(currentMembership.role)");
    expect(workspaceService).toContain("workspaceRoleLabel(membership.role)");
    expect(workspaceService).toContain("compareWorkspaceRoles(a.role, b.role)");
    expect(workspaceService).toContain("role: workspaceOwnerRole");
    expect(workspaceService).toContain("ensureWorkspaceAccess(actor)");
    expect(workspaceService).toContain("updateWorkspaceMemberRole");
    expect(workspaceService).toContain("transferWorkspaceOwnership");
    expect(workspaceService).toContain("Only the workspace owner can promote or demote admins.");
    expect(workspaceService).toContain("Only the workspace owner can remove admins.");
    expect(workspaceService).toContain("Choose another workspace member to receive ownership.");
    expect(workspaceService).toContain("workspace_member.role_updated");
    expect(workspaceService).toContain("workspace_member.ownership_transferred");
  });

  it("renders conservative workspace settings member management controls", () => {
    expect(primaryNav).toContain("href: \"/settings\"");
    expect(primaryNav).toContain("label: \"Settings\"");
    expect(settingsPage).toContain("getWorkspaceMembershipSummary(actor)");
    expect(settingsPage).toContain("Workspace Members");
    expect(settingsPage).toContain("Your role");
    expect(settingsPage).toContain("Settings access");
    expect(settingsPage).toContain("Settings admin");
    expect(settingsPage).toContain("<CreateWorkspaceForm");
    expect(settingsPage).toContain("Workspace Invitations");
    expect(settingsPage).toContain("summary.currentMembership.canManageWorkspaceSettings ? (");
    expect(settingsPage).toContain("Current user");
    expect(settingsPage).toContain("Owner removal blocked");
    expect(settingsPage).toContain("Last admin");
    expect(settingsPage).toContain("Owner action required");
    expect(settingsPage).toContain("Transferring ownership immediately makes that member the owner");
    expect(settingsPage).toContain("updateWorkspaceMemberRoleAction");
    expect(settingsPage).toContain("transferWorkspaceOwnershipAction");
    expect(settingsPage).toContain("Make admin");
    expect(settingsPage).toContain("Make member");
    expect(settingsPage).toContain("Transfer owner");
    expect(settingsPage).not.toContain("Delete");
    expect(currentStatus).toContain("role editing and ownership-transfer controls");
  });
});
