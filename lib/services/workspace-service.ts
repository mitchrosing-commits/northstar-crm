import { MembershipRole, Prisma, WorkspaceInvitationStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import {
  canTransferWorkspaceOwnership,
  canManageWorkspaceSettings,
  compareWorkspaceRoles,
  isWorkspaceOwner,
  workspaceOwnerRole,
  workspaceRoleLabel
} from "@/lib/workspace-roles";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { ensureDefaultPipelineForWorkspace } from "./pipeline-service";
import { userDisplaySelect } from "./user-select";

export async function listWorkspaces(actorUserId: string) {
  return prisma.workspace.findMany({
    where: {
      deletedAt: null,
      memberships: { some: { userId: actorUserId } }
    },
    orderBy: { name: "asc" }
  });
}

export async function listWorkspaceMembershipOptions(actorUserId: string) {
  const memberships = await prisma.workspaceMembership.findMany({
    where: {
      userId: actorUserId,
      workspace: { deletedAt: null }
    },
    select: {
      id: true,
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    },
    orderBy: [
      { workspace: { name: "asc" } },
      { workspaceId: "asc" }
    ]
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    workspaceId: membership.workspace.id,
    name: membership.workspace.name,
    slug: membership.workspace.slug,
    role: membership.role,
    roleLabel: workspaceRoleLabel(membership.role),
    canManageWorkspaceSettings: canManageWorkspaceSettings(membership.role)
  }));
}

export async function createWorkspace(actorUserId: string, data: Prisma.WorkspaceCreateInput) {
  const workspace = await prisma.workspace.create({
    data: {
      ...data,
      memberships: {
        create: {
          userId: actorUserId,
          role: workspaceOwnerRole
        }
      }
    }
  });
  await writeAuditLog(
    { workspaceId: workspace.id, actorUserId },
    "workspace.created",
    "Workspace",
    workspace.id,
    { name: workspace.name }
  );
  await ensureDefaultPipelineForWorkspace(workspace.id);
  return workspace;
}

export async function createWorkspaceFromName(actorUserId: string, name: string) {
  const normalizedName = normalizeWorkspaceName(name);

  if (!normalizedName) {
    throw new ApiError("VALIDATION_ERROR", "Workspace name is required.", 422);
  }

  return createWorkspace(actorUserId, {
    name: normalizedName,
    slug: await generateUniqueWorkspaceSlug(normalizedName)
  });
}

export async function getWorkspace(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  const workspace = await prisma.workspace.findFirst({
    where: { id: actor.workspaceId, deletedAt: null },
    include: { memberships: { include: { user: { select: userDisplaySelect } } } }
  });
  if (!workspace) throw new ApiError("NOT_FOUND", "Workspace was not found.", 404);
  return workspace;
}

export async function getWorkspaceMembershipSummary(actor: WorkspaceActor) {
  const currentMembership = await ensureWorkspaceAccess(actor);
  const workspace = await prisma.workspace.findFirst({
    where: { id: actor.workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      memberships: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: userDisplaySelect }
        }
      }
    }
  });

  if (!workspace) throw new ApiError("NOT_FOUND", "Workspace was not found.", 404);

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug
    },
    currentMembership: {
      id: currentMembership.id,
      role: currentMembership.role,
      roleLabel: workspaceRoleLabel(currentMembership.role),
      canManageWorkspaceSettings: canManageWorkspaceSettings(currentMembership.role)
    },
    members: workspace.memberships
      .map((membership) => ({
        id: membership.id,
        userId: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role,
        roleLabel: workspaceRoleLabel(membership.role),
        canManageWorkspaceSettings: canManageWorkspaceSettings(membership.role),
        joinedAt: membership.createdAt
      }))
      .sort((a, b) => {
        const roleOrder = compareWorkspaceRoles(a.role, b.role);
        if (roleOrder !== 0) return roleOrder;
        return a.email.localeCompare(b.email);
      })
  };
}

export async function listPendingWorkspaceInvitations(actor: WorkspaceActor) {
  await ensureWorkspaceSettingsAdmin(actor);

  const invitations = await prisma.workspaceInvitation.findMany({
    where: {
      workspaceId: actor.workspaceId,
      status: WorkspaceInvitationStatus.PENDING
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      invitedBy: { select: userDisplaySelect }
    },
    orderBy: [
      { createdAt: "desc" },
      { email: "asc" }
    ]
  });

  return invitations.map((invitation) => ({
    ...invitation,
    roleLabel: workspaceRoleLabel(invitation.role)
  }));
}

export async function createWorkspaceInvitation(
  actor: WorkspaceActor,
  input: { email: string; role?: MembershipRole }
) {
  await ensureWorkspaceSettingsAdmin(actor);

  const email = normalizeInvitationEmail(input.email);
  const role = input.role ?? "MEMBER";

  if (!email) {
    throw new ApiError("VALIDATION_ERROR", "Invitee email is required.", 422);
  }

  if (!isValidInvitationEmail(email)) {
    throw new ApiError("VALIDATION_ERROR", "Invitee email must be valid.", 422);
  }

  if (role === "OWNER") {
    throw new ApiError("VALIDATION_ERROR", "Workspace invitations cannot grant owner access.", 422);
  }

  const invitedUser = await prisma.user.findFirst({
    where: {
      email: { equals: email, mode: "insensitive" },
      deletedAt: null
    },
    select: { id: true, email: true }
  });

  if (!invitedUser) {
    throw new ApiError("VALIDATION_ERROR", "Invitations can only be created for existing users.", 422);
  }

  const existingMembership = await prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspaceId,
        userId: invitedUser.id
      }
    },
    select: { id: true }
  });

  if (existingMembership) {
    throw new ApiError("VALIDATION_ERROR", "This user is already a workspace member.", 422);
  }

  const existingPendingInvitation = await prisma.workspaceInvitation.findUnique({
    where: {
      workspaceId_email_status: {
        workspaceId: actor.workspaceId,
        email,
        status: WorkspaceInvitationStatus.PENDING
      }
    },
    select: { id: true }
  });

  if (existingPendingInvitation) {
    throw new ApiError("VALIDATION_ERROR", "A pending invitation already exists for this email.", 422);
  }

  const invitation = await prisma.workspaceInvitation.create({
    data: {
      workspaceId: actor.workspaceId,
      email,
      role,
      invitedById: actor.actorUserId
    }
  });

  await writeAuditLog(
    actor,
    "workspace_invitation.created",
    "WorkspaceInvitation",
    invitation.id,
    { email: invitation.email, role: invitation.role }
  );

  return {
    ...invitation,
    roleLabel: workspaceRoleLabel(invitation.role)
  };
}

export async function revokeWorkspaceInvitation(actor: WorkspaceActor, invitationId: string) {
  await ensureWorkspaceSettingsAdmin(actor);

  const invitation = await prisma.workspaceInvitation.findFirst({
    where: {
      id: invitationId,
      workspaceId: actor.workspaceId,
      status: WorkspaceInvitationStatus.PENDING
    }
  });

  if (!invitation) {
    throw new ApiError("NOT_FOUND", "Workspace invitation was not found.", 404);
  }

  const revoked = await prisma.workspaceInvitation.update({
    where: { id: invitation.id },
    data: { status: WorkspaceInvitationStatus.REVOKED }
  });

  await writeAuditLog(
    actor,
    "workspace_invitation.revoked",
    "WorkspaceInvitation",
    revoked.id,
    { email: revoked.email, role: revoked.role }
  );

  return revoked;
}

export async function removeWorkspaceMember(actor: WorkspaceActor, membershipId: string) {
  const actorMembership = await ensureWorkspaceSettingsAdmin(actor);

  const membership = await prisma.workspaceMembership.findFirst({
    where: {
      id: membershipId,
      workspaceId: actor.workspaceId
    },
    include: {
      user: { select: userDisplaySelect }
    }
  });

  if (!membership) {
    throw new ApiError("NOT_FOUND", "Workspace member was not found.", 404);
  }

  if (membership.role === "OWNER") {
    throw new ApiError("VALIDATION_ERROR", "Owner removal is not available yet.", 422);
  }

  if (canManageWorkspaceSettings(membership.role)) {
    const adminCount = await prisma.workspaceMembership.count({
      where: {
        workspaceId: actor.workspaceId,
        role: { in: ["OWNER", "ADMIN"] }
      }
    });

    if (adminCount <= 1 && membership.userId === actor.actorUserId) {
      throw new ApiError("VALIDATION_ERROR", "You cannot remove yourself as the last workspace admin.", 422);
    }

    if (adminCount <= 1) {
      throw new ApiError("VALIDATION_ERROR", "Cannot remove the last workspace admin.", 422);
    }
  }

  if (!isWorkspaceOwner(actorMembership.role) && membership.role === "ADMIN") {
    throw new ApiError("FORBIDDEN", "Only the workspace owner can remove admins.", 403);
  }

  await prisma.workspaceMembership.delete({
    where: { id: membership.id }
  });

  await writeAuditLog(actor, "workspace_member.removed", "WorkspaceMembership", membership.id, {
    removedUserId: membership.userId,
    email: membership.user.email,
    role: membership.role
  });

  return {
    id: membership.id,
    userId: membership.userId,
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role,
    roleLabel: workspaceRoleLabel(membership.role)
  };
}

export async function updateWorkspaceMemberRole(actor: WorkspaceActor, membershipId: string, role: MembershipRole) {
  const actorMembership = await ensureWorkspaceSettingsAdmin(actor);
  const targetRole = normalizeEditableMembershipRole(role);
  const membership = await findWorkspaceMembershipOrThrow(actor.workspaceId, membershipId);

  if (membership.role === "OWNER") {
    throw new ApiError("VALIDATION_ERROR", "Use ownership transfer to change the workspace owner.", 422);
  }

  if (membership.userId === actor.actorUserId) {
    throw new ApiError("VALIDATION_ERROR", "You cannot change your own workspace role.", 422);
  }

  if (!isWorkspaceOwner(actorMembership.role) && (membership.role === "ADMIN" || targetRole === "ADMIN")) {
    throw new ApiError("FORBIDDEN", "Only the workspace owner can promote or demote admins.", 403);
  }

  if (membership.role === targetRole) {
    return {
      ...membership,
      roleLabel: workspaceRoleLabel(membership.role)
    };
  }

  if (canManageWorkspaceSettings(membership.role) && !canManageWorkspaceSettings(targetRole)) {
    await assertWorkspaceKeepsAdmin(actor.workspaceId, membership.userId, "Cannot demote the last workspace admin.");
  }

  const updated = await prisma.workspaceMembership.update({
    where: { id: membership.id },
    data: { role: targetRole },
    include: {
      user: { select: userDisplaySelect }
    }
  });

  await writeAuditLog(actor, "workspace_member.role_updated", "WorkspaceMembership", updated.id, {
    memberUserId: updated.userId,
    email: updated.user.email,
    previousRole: membership.role,
    newRole: updated.role
  });

  return {
    id: updated.id,
    userId: updated.userId,
    email: updated.user.email,
    name: updated.user.name,
    role: updated.role,
    roleLabel: workspaceRoleLabel(updated.role)
  };
}

export async function transferWorkspaceOwnership(actor: WorkspaceActor, targetMembershipId: string) {
  const actorMembership = await ensureWorkspaceSettingsAdmin(actor);

  if (!canTransferWorkspaceOwnership(actorMembership.role)) {
    throw new ApiError("FORBIDDEN", "Only the workspace owner can transfer ownership.", 403);
  }

  const targetMembership = await findWorkspaceMembershipOrThrow(actor.workspaceId, targetMembershipId);

  if (targetMembership.userId === actor.actorUserId) {
    throw new ApiError("VALIDATION_ERROR", "Choose another workspace member to receive ownership.", 422);
  }

  const previousOwner = await prisma.workspaceMembership.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      userId: actor.actorUserId,
      role: "OWNER"
    },
    include: {
      user: { select: userDisplaySelect }
    }
  });

  if (!previousOwner) {
    throw new ApiError("FORBIDDEN", "Only the workspace owner can transfer ownership.", 403);
  }

  const [newOwner] = await prisma.$transaction([
    prisma.workspaceMembership.update({
      where: { id: targetMembership.id },
      data: { role: "OWNER" },
      include: {
        user: { select: userDisplaySelect }
      }
    }),
    prisma.workspaceMembership.update({
      where: { id: previousOwner.id },
      data: { role: "ADMIN" }
    })
  ]);

  await writeAuditLog(actor, "workspace_member.ownership_transferred", "WorkspaceMembership", newOwner.id, {
    previousOwnerUserId: previousOwner.userId,
    previousOwnerEmail: previousOwner.user.email,
    newOwnerUserId: newOwner.userId,
    newOwnerEmail: newOwner.user.email,
    previousOwnerNewRole: "ADMIN"
  });

  return {
    id: newOwner.id,
    userId: newOwner.userId,
    email: newOwner.user.email,
    name: newOwner.user.name,
    role: newOwner.role,
    roleLabel: workspaceRoleLabel(newOwner.role)
  };
}

export async function getWorkspaceInvitationForAcceptance(actorUserId: string, invitationId: string) {
  const user = await getActiveInvitationUser(actorUserId);
  const invitation = await findAcceptableInvitation(invitationId);

  assertInvitationMatchesUser(invitation.email, user.email);
  await assertAcceptedInvitationStillHasMembership(invitation, user.id);

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    roleLabel: workspaceRoleLabel(invitation.role),
    status: invitation.status,
    workspace: invitation.workspace
  };
}

export async function acceptWorkspaceInvitation(actorUserId: string, invitationId: string) {
  const user = await getActiveInvitationUser(actorUserId);
  const invitation = await findAcceptableInvitation(invitationId);

  assertInvitationMatchesUser(invitation.email, user.email);
  await assertAcceptedInvitationStillHasMembership(invitation, user.id);

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMembership.upsert({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId: user.id
        }
      },
      update: {},
      create: {
        workspaceId: invitation.workspaceId,
        userId: user.id,
        role: invitation.role
      }
    });

    if (invitation.status === WorkspaceInvitationStatus.PENDING) {
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: WorkspaceInvitationStatus.ACCEPTED }
      });
      await tx.auditLog.create({
        data: {
          workspaceId: invitation.workspaceId,
          actorId: user.id,
          action: "workspace_invitation.accepted",
          entityType: "WorkspaceInvitation",
          entityId: invitation.id,
          metadata: { email: invitation.email, role: invitation.role }
        }
      });
    }
  });

  return invitation.workspace;
}

function normalizeWorkspaceName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeInvitationEmail(email: string) {
  return email.trim().toLowerCase();
}

function isValidInvitationEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function ensureWorkspaceSettingsAdmin(actor: WorkspaceActor) {
  const membership = await ensureWorkspaceAccess(actor);

  if (!canManageWorkspaceSettings(membership.role)) {
    throw new ApiError("FORBIDDEN", "Workspace admin access is required.", 403);
  }

  return membership;
}

async function findWorkspaceMembershipOrThrow(workspaceId: string, membershipId: string) {
  const membership = await prisma.workspaceMembership.findFirst({
    where: {
      id: membershipId,
      workspaceId
    },
    include: {
      user: { select: userDisplaySelect }
    }
  });

  if (!membership) {
    throw new ApiError("NOT_FOUND", "Workspace member was not found.", 404);
  }

  return membership;
}

function normalizeEditableMembershipRole(role: MembershipRole) {
  if (role !== "ADMIN" && role !== "MEMBER") {
    throw new ApiError("VALIDATION_ERROR", "Role can only be changed to Admin or Member.", 422);
  }

  return role;
}

async function assertWorkspaceKeepsAdmin(workspaceId: string, changingUserId: string, message: string) {
  const remainingAdminCount = await prisma.workspaceMembership.count({
    where: {
      workspaceId,
      userId: { not: changingUserId },
      role: { in: ["OWNER", "ADMIN"] }
    }
  });

  if (remainingAdminCount < 1) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
}

async function getActiveInvitationUser(actorUserId: string) {
  const user = await prisma.user.findFirst({
    where: { id: actorUserId, deletedAt: null },
    select: { id: true, email: true }
  });

  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "The current user could not be resolved.", 401);
  }

  return user;
}

async function findAcceptableInvitation(invitationId: string) {
  const invitation = await prisma.workspaceInvitation.findFirst({
    where: {
      id: invitationId,
      status: { in: [WorkspaceInvitationStatus.PENDING, WorkspaceInvitationStatus.ACCEPTED] },
      workspace: { deletedAt: null }
    },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true
        }
      }
    }
  });

  if (!invitation) {
    throw new ApiError("NOT_FOUND", "Workspace invitation was not found.", 404);
  }

  return invitation;
}

function assertInvitationMatchesUser(invitationEmail: string, userEmail: string) {
  if (normalizeInvitationEmail(invitationEmail) !== normalizeInvitationEmail(userEmail)) {
    throw new ApiError("FORBIDDEN", "This invitation does not belong to the signed-in user.", 403);
  }
}

async function assertAcceptedInvitationStillHasMembership(
  invitation: Awaited<ReturnType<typeof findAcceptableInvitation>>,
  userId: string
) {
  if (invitation.status !== WorkspaceInvitationStatus.ACCEPTED) {
    return;
  }

  const membership = await prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: invitation.workspaceId,
        userId
      }
    },
    select: { id: true }
  });

  if (!membership) {
    throw new ApiError("NOT_FOUND", "Workspace invitation was already accepted and is no longer available.", 404);
  }
}

function workspaceSlugBase(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54)
    .replace(/-+$/g, "");

  return slug || "workspace";
}

async function generateUniqueWorkspaceSlug(name: string) {
  const base = workspaceSlugBase(name);
  const existing = await prisma.workspace.findMany({
    where: {
      slug: {
        startsWith: base
      }
    },
    select: { slug: true }
  });
  const existingSlugs = new Set(existing.map((workspace) => workspace.slug));

  if (!existingSlugs.has(base)) return base;

  let suffix = 2;
  while (existingSlugs.has(`${base}-${suffix}`)) {
    suffix += 1;
  }

  return `${base}-${suffix}`;
}
