import type { MembershipRole } from "@prisma/client";

export const workspaceOwnerRole = "OWNER" satisfies MembershipRole;

const workspaceRoleLabels = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member"
} satisfies Record<MembershipRole, string>;

const workspaceRoleSortOrder = {
  OWNER: 0,
  ADMIN: 1,
  MEMBER: 2
} satisfies Record<MembershipRole, number>;

export function workspaceRoleLabel(role: MembershipRole) {
  return workspaceRoleLabels[role];
}

export function isWorkspaceMember(role: MembershipRole | null | undefined) {
  return role === "OWNER" || role === "ADMIN" || role === "MEMBER";
}

export function isWorkspaceAdmin(role: MembershipRole | null | undefined) {
  return role === "OWNER" || role === "ADMIN";
}

export function isWorkspaceOwner(role: MembershipRole | null | undefined) {
  return role === "OWNER";
}

export function canManageWorkspaceSettings(role: MembershipRole | null | undefined) {
  return isWorkspaceAdmin(role);
}

export function canTransferWorkspaceOwnership(role: MembershipRole | null | undefined) {
  return isWorkspaceOwner(role);
}

export function compareWorkspaceRoles(a: MembershipRole, b: MembershipRole) {
  return workspaceRoleSortOrder[a] - workspaceRoleSortOrder[b];
}
