import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MembershipRole } from "@prisma/client";

import {
  resolveCurrentUserContext,
  resolveCurrentWorkspaceContext,
  resolveCurrentWorkspaceSelectionContext
} from "@/lib/auth/request-context";
import {
  deleteExpiredLocalSessions,
  hashSessionToken,
  loginWithEmailAndPassword,
  revokeLocalSessionToken
} from "@/lib/auth/local-auth";
import { hashPassword } from "@/lib/auth/password";
import {
  localSessionCookieName,
  resolveSessionIdentity,
  serializeLocalSessionCookieValue
} from "@/lib/auth/session";
import {
  acceptWorkspaceInvitation,
  createWorkspaceInvitation,
  getWorkspaceInvitationForAcceptance,
  getDealReport,
  createWorkspaceFromName,
  listPendingWorkspaceInvitations,
  listWorkspaceMembershipOptions,
  listActivities,
  listCustomFields,
  listDealSavedViews,
  listDeals,
  listNotes,
  getWorkspaceMembershipSummary,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  updateWorkspaceMemberRole
} from "@/lib/services/crm";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("current auth and workspace context", () => {
  it("resolves a concrete user, workspace, and membership for the current actor", async () => {
    const fx = currentFixture();

    const userContext = await resolveCurrentUserContext(
      resolveSessionIdentity(new Headers({ "x-user-id": fx.userA.id }), { AUTH_MODE: "trusted-header" })
    );
    const workspaceContext = await resolveCurrentWorkspaceContext({
      actorUserId: userContext.actorUserId,
      user: userContext.user,
      workspaceSlug: fx.workspaceA.slug
    });

    expect(userContext.user.email).toBe(fx.userA.email);
    expect(workspaceContext.actor).toEqual({
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id
    });
    expect(workspaceContext.workspace).toMatchObject({
      id: fx.workspaceA.id,
      slug: fx.workspaceA.slug
    });
    expect(workspaceContext.membership.role).toBe("OWNER");
  });

  it("returns clear errors when user or workspace context is missing", async () => {
    const fx = currentFixture();

    await expect(
      resolveCurrentUserContext(
        resolveSessionIdentity(new Headers({ "x-user-id": "missing-user-id" }), { AUTH_MODE: "trusted-header" })
      )
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401
    });
    await expect(
      resolveCurrentUserContext(resolveSessionIdentity(new Headers(), { AUTH_MODE: "trusted-header" }))
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401
    });
    await expect(
      resolveCurrentWorkspaceContext({
        actorUserId: fx.userA.id,
        workspaceId: "missing-workspace-id"
      })
    ).rejects.toMatchObject({ code: "WORKSPACE_NOT_FOUND", status: 404 });
    await expect(
      resolveCurrentWorkspaceContext({
        actorUserId: fx.userA.id
      })
    ).rejects.toMatchObject({ code: "WORKSPACE_CONTEXT_REQUIRED", status: 400 });
  });

  it("resolves and revokes a real local session", async () => {
    const fx = currentFixture();
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { passwordHash: hashPassword("correct-password") }
    });
    const login = await loginWithEmailAndPassword(fx.userA.email.toUpperCase(), "correct-password");
    const cookieValue = serializeLocalSessionCookieValue(login.session.token, {
      AUTH_SESSION_SECRET: "integration-local-session-secret-123"
    });

    expect(login.user.email).toBe(fx.userA.email);
    await expect(fx.prisma.session.count({ where: { userId: fx.userA.id, revokedAt: null } })).resolves.toBe(1);
    const storedSession = await fx.prisma.session.findFirstOrThrow({
      where: { userId: fx.userA.id },
      select: { tokenHash: true }
    });

    expect(storedSession.tokenHash).toBe(hashSessionToken(login.session.token));
    expect(storedSession.tokenHash).not.toBe(login.session.token);

    const userContext = await resolveCurrentUserContext(
      resolveSessionIdentity(new Headers({ cookie: `${localSessionCookieName}=${cookieValue}` }), {
        AUTH_MODE: "local",
        AUTH_SESSION_SECRET: "integration-local-session-secret-123"
      })
    );

    expect(userContext.user.email).toBe(fx.userA.email);

    await revokeLocalSessionToken(login.session.token);
    await revokeLocalSessionToken(login.session.token);
    await expect(fx.prisma.session.count({ where: { userId: fx.userA.id, revokedAt: null } })).resolves.toBe(0);

    await expect(
      resolveCurrentUserContext(
        resolveSessionIdentity(new Headers({ cookie: `${localSessionCookieName}=${cookieValue}` }), {
          AUTH_MODE: "local",
          AUTH_SESSION_SECRET: "integration-local-session-secret-123"
        })
      )
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401
    });
  });

  it("rejects expired local sessions and prunes them during login", async () => {
    const fx = currentFixture();
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { passwordHash: hashPassword("correct-password") }
    });
    const expiredToken = "expired-session-token";
    await fx.prisma.session.create({
      data: {
        userId: fx.userA.id,
        tokenHash: hashSessionToken(expiredToken),
        expiresAt: new Date("2000-01-01T00:00:00.000Z")
      }
    });
    const expiredCookieValue = serializeLocalSessionCookieValue(expiredToken, {
      AUTH_SESSION_SECRET: "integration-local-session-secret-123"
    });

    await expect(
      resolveCurrentUserContext(
        resolveSessionIdentity(new Headers({ cookie: `${localSessionCookieName}=${expiredCookieValue}` }), {
          AUTH_MODE: "local",
          AUTH_SESSION_SECRET: "integration-local-session-secret-123"
        })
      )
    ).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401
    });

    await expect(fx.prisma.session.count({ where: { userId: fx.userA.id } })).resolves.toBe(1);
    await loginWithEmailAndPassword(fx.userA.email, "correct-password");
    await expect(
      fx.prisma.session.count({
        where: {
          userId: fx.userA.id,
          expiresAt: { lte: new Date() }
        }
      })
    ).resolves.toBe(0);

    await deleteExpiredLocalSessions();
  });

  it("uses generic invalid-login errors for missing users, wrong passwords, and missing password hashes", async () => {
    const fx = currentFixture();
    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { passwordHash: hashPassword("correct-password") }
    });

    await expect(loginWithEmailAndPassword("missing@example.test", "correct-password")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
      status: 401
    });
    await expect(loginWithEmailAndPassword(fx.userA.email, "wrong-password")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
      status: 401
    });

    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { passwordHash: null }
    });

    await expect(loginWithEmailAndPassword(fx.userA.email, "correct-password")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password.",
      status: 401
    });
  });

  it("rejects workspace context when the actor is not a member", async () => {
    const fx = currentFixture();

    await expect(
      resolveCurrentWorkspaceContext({
        actorUserId: fx.userA.id,
        workspaceId: fx.workspaceB.id
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("lists and resolves only member workspaces for workspace switching", async () => {
    const fx = currentFixture();
    await fx.prisma.workspaceMembership.create({
      data: {
        workspaceId: fx.workspaceB.id,
        userId: fx.userA.id,
        role: MembershipRole.ADMIN
      }
    });
    const userContext = {
      actorUserId: fx.userA.id,
      user: {
        id: fx.userA.id,
        email: fx.userA.email,
        name: fx.userA.name,
        avatarUrl: fx.userA.avatarUrl
      }
    };

    const options = await listWorkspaceMembershipOptions(fx.userA.id);
    const selectedWorkspaceContext = await resolveCurrentWorkspaceSelectionContext({
      ...userContext,
      selectedWorkspaceId: fx.workspaceB.id,
      fallbackWorkspaceSlug: fx.workspaceA.slug
    });
    const selectedDeals = await listDeals(selectedWorkspaceContext.actor);
    const nonMemberSelectionContext = await resolveCurrentWorkspaceSelectionContext({
      ...userContext,
      selectedWorkspaceId: "not-a-member-workspace",
      fallbackWorkspaceSlug: fx.workspaceA.slug
    });
    await fx.prisma.workspaceMembership.delete({
      where: {
        workspaceId_userId: {
          workspaceId: fx.workspaceB.id,
          userId: fx.userA.id
        }
      }
    });
    const staleSelectionContext = await resolveCurrentWorkspaceSelectionContext({
      ...userContext,
      selectedWorkspaceId: fx.workspaceB.id,
      fallbackWorkspaceSlug: fx.workspaceA.slug
    });

    expect(options.map((option) => option.workspaceId).sort()).toEqual([fx.workspaceA.id, fx.workspaceB.id].sort());
    expect(options.find((option) => option.workspaceId === fx.workspaceB.id)).toMatchObject({
      role: "ADMIN",
      roleLabel: "Admin"
    });
    expect(selectedWorkspaceContext.workspace.id).toBe(fx.workspaceB.id);
    expect(selectedWorkspaceContext.membership.role).toBe("ADMIN");
    expect(selectedDeals.map((deal) => deal.id)).toEqual([fx.recordsB.deal.id]);
    expect(nonMemberSelectionContext.workspace.id).toBe(fx.workspaceA.id);
    expect(staleSelectionContext.workspace.id).toBe(fx.workspaceA.id);
  });

  it("creates owned workspaces and makes them available for active workspace selection", async () => {
    const fx = currentFixture();
    const createdWorkspaceIds: string[] = [];
    const name = `Workspace Creation ${fx.workspaceA.id.slice(-6)}`;
    const expectedSlugPattern = /^workspace-creation-[a-z0-9]+(?:-\d+)?$/;

    try {
      const created = await createWorkspaceFromName(fx.userA.id, `  ${name}  `);
      createdWorkspaceIds.push(created.id);
      const duplicateName = await createWorkspaceFromName(fx.userA.id, name);
      createdWorkspaceIds.push(duplicateName.id);
      const membership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: created.id,
            userId: fx.userA.id
          }
        }
      });
      const selectedWorkspaceContext = await resolveCurrentWorkspaceSelectionContext({
        actorUserId: fx.userA.id,
        user: {
          id: fx.userA.id,
          email: fx.userA.email,
          name: fx.userA.name,
          avatarUrl: fx.userA.avatarUrl
        },
        selectedWorkspaceId: created.id,
        fallbackWorkspaceSlug: fx.workspaceA.slug
      });
      const options = await listWorkspaceMembershipOptions(fx.userA.id);

      expect(created.name).toBe(name);
      expect(duplicateName.name).toBe(name);
      expect(created.slug).toMatch(expectedSlugPattern);
      expect(duplicateName.slug).toMatch(expectedSlugPattern);
      expect(duplicateName.slug).not.toBe(created.slug);
      expect(membership.role).toBe("OWNER");
      expect(selectedWorkspaceContext.workspace.id).toBe(created.id);
      expect(selectedWorkspaceContext.membership.role).toBe("OWNER");
      expect(options.map((option) => option.workspaceId)).toEqual(
        expect.arrayContaining([fx.workspaceA.id, created.id, duplicateName.id])
      );
      await expect(listDeals(selectedWorkspaceContext.actor)).resolves.toEqual([]);
      await expect(createWorkspaceFromName(fx.userA.id, "   ")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422
      });
    } finally {
      await fx.prisma.auditLog.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.pipeline.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
    }
  });

  it("manages workspace invitations for existing users and accepts them safely", async () => {
    const fx = currentFixture();
    const userC = await fx.prisma.user.create({
      data: { email: `integration-c-${fx.workspaceA.id}@example.test`, name: "Integration C" }
    });
    const futureUserEmail = `future-invite-${fx.workspaceA.id}@example.test`;
    const createdWorkspaceIds: string[] = [];
    let futureUserId: string | undefined;

    try {
      const invitation = await createWorkspaceInvitation(fx.actorA, {
        email: fx.userB.email.toUpperCase(),
        role: "MEMBER"
      });
      const pending = await listPendingWorkspaceInvitations(fx.actorA);

      expect(invitation.email).toBe(fx.userB.email.toLowerCase());
      expect(invitation.role).toBe("MEMBER");
      expect(pending.map((item) => item.id)).toContain(invitation.id);
      await expect(
        createWorkspaceInvitation(fx.actorA, {
          email: fx.userB.email,
          role: "MEMBER"
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "A pending invitation already exists for this email.",
        status: 422
      });

      const futureUserInvitation = await createWorkspaceInvitation(fx.actorA, {
        email: futureUserEmail,
        role: "MEMBER"
      });
      const pendingAfterFutureInvite = await listPendingWorkspaceInvitations(fx.actorA);
      const futureUser = await fx.prisma.user.create({
        data: { email: futureUserEmail, name: "Future Invitee" }
      });
      futureUserId = futureUser.id;
      const futureAcceptedWorkspace = await acceptWorkspaceInvitation(futureUser.id, futureUserInvitation.id);
      const futureMembership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: fx.workspaceA.id,
            userId: futureUser.id
          }
        }
      });

      const userCInvitation = await createWorkspaceInvitation(fx.actorA, {
        email: userC.email,
        role: "ADMIN"
      });
      await expect(getWorkspaceInvitationForAcceptance(fx.userB.id, userCInvitation.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
      await revokeWorkspaceInvitation(fx.actorA, userCInvitation.id);
      await expect(getWorkspaceInvitationForAcceptance(userC.id, userCInvitation.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      await expect(acceptWorkspaceInvitation(userC.id, userCInvitation.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      const adminOnlyWorkspace = await fx.prisma.workspace.create({
        data: {
          name: `Admin Only ${fx.workspaceA.id}`,
          slug: `admin-only-${fx.workspaceA.id}`,
          memberships: {
            create: {
              userId: userC.id,
              role: "ADMIN"
            }
          }
        }
      });
      createdWorkspaceIds.push(adminOnlyWorkspace.id);
      const lastAdminMembership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: adminOnlyWorkspace.id,
            userId: userC.id
          }
        }
      });
      await expect(
        removeWorkspaceMember(
          { workspaceId: adminOnlyWorkspace.id, actorUserId: userC.id },
          lastAdminMembership.id
        )
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "You cannot remove yourself as the last workspace admin.",
        status: 422
      });

      const acceptedWorkspace = await acceptWorkspaceInvitation(fx.userB.id, invitation.id);
      const membership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: fx.workspaceA.id,
            userId: fx.userB.id
          }
        }
      });
      const acceptedInvitation = await fx.prisma.workspaceInvitation.findUniqueOrThrow({
        where: { id: invitation.id }
      });
      const acceptedAgainWorkspace = await acceptWorkspaceInvitation(fx.userB.id, invitation.id);
      const acceptedMemberships = await fx.prisma.workspaceMembership.findMany({
        where: {
          workspaceId: fx.workspaceA.id,
          userId: fx.userB.id
        }
      });
      await expect(
        removeWorkspaceMember(
          { workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id },
          membership.id
        )
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
      await expect(revokeWorkspaceInvitation(fx.actorA, invitation.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      const removedMember = await removeWorkspaceMember(fx.actorA, membership.id);
      const removedMembershipCount = await fx.prisma.workspaceMembership.count({
        where: {
          workspaceId: fx.workspaceA.id,
          userId: fx.userB.id
        }
      });
      await expect(acceptWorkspaceInvitation(fx.userB.id, invitation.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Workspace invitation was already accepted and is no longer available.",
        status: 404
      });
      await expect(getWorkspaceInvitationForAcceptance(fx.userB.id, invitation.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      const removedMembershipCountAfterAcceptedLinkReuse = await fx.prisma.workspaceMembership.count({
        where: {
          workspaceId: fx.workspaceA.id,
          userId: fx.userB.id
        }
      });
      await expect(
        resolveCurrentWorkspaceContext({
          actorUserId: fx.userB.id,
          workspaceId: fx.workspaceA.id
        })
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
      await expect(listDeals({ workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
      const fallbackAfterRemoval = await resolveCurrentWorkspaceSelectionContext({
        actorUserId: fx.userB.id,
        selectedWorkspaceId: fx.workspaceA.id,
        fallbackWorkspaceSlug: fx.workspaceB.slug
      });
      const ownerMembership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: fx.workspaceA.id,
            userId: fx.userA.id
          }
        }
      });
      await expect(removeWorkspaceMember(fx.actorA, ownerMembership.id)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Owner removal is not available yet.",
        status: 422
      });
      const invitationAuditLogs = await fx.prisma.auditLog.findMany({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "WorkspaceInvitation",
          entityId: invitation.id
        },
        orderBy: { createdAt: "asc" }
      });
      const memberRemovalAuditLog = await fx.prisma.auditLog.findFirst({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "WorkspaceMembership",
          entityId: membership.id,
          action: "workspace_member.removed"
        }
      });

      expect(acceptedWorkspace.id).toBe(fx.workspaceA.id);
      expect(acceptedAgainWorkspace.id).toBe(fx.workspaceA.id);
      expect(pendingAfterFutureInvite.map((item) => item.id)).toContain(futureUserInvitation.id);
      expect(futureAcceptedWorkspace.id).toBe(fx.workspaceA.id);
      expect(futureMembership.role).toBe("MEMBER");
      expect(membership.role).toBe("MEMBER");
      expect(acceptedInvitation.status).toBe("ACCEPTED");
      expect(acceptedMemberships).toHaveLength(1);
      expect(removedMember.email).toBe(fx.userB.email);
      expect(removedMembershipCount).toBe(0);
      expect(removedMembershipCountAfterAcceptedLinkReuse).toBe(0);
      expect(fallbackAfterRemoval.workspace.id).toBe(fx.workspaceB.id);
      expect(invitationAuditLogs.map((log) => log.action)).toEqual([
        "workspace_invitation.created",
        "workspace_invitation.accepted"
      ]);
      expect(memberRemovalAuditLog?.metadata).toMatchObject({
        email: fx.userB.email,
        role: "MEMBER"
      });
      await expect(
        createWorkspaceInvitation(
          { workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id },
          { email: userC.email, role: "MEMBER" }
        )
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403
      });
    } finally {
      await fx.prisma.auditLog.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.workspaceInvitation.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.pipelineStage.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.pipeline.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: createdWorkspaceIds } } });
      await fx.prisma.workspaceMembership.deleteMany({ where: { userId: futureUserId } });
      await fx.prisma.workspace.deleteMany({ where: { id: { in: createdWorkspaceIds } } });
      await fx.prisma.user.deleteMany({
        where: { id: { in: [userC.id, futureUserId].filter((id): id is string => Boolean(id)) } }
      });
    }
  });

  it("exposes workspace membership role capability without opening member-only settings management", async () => {
    const fx = currentFixture();
    await fx.prisma.workspaceMembership.create({
      data: {
        workspaceId: fx.workspaceA.id,
        userId: fx.userB.id,
        role: MembershipRole.MEMBER
      }
    });

    const memberSummary = await getWorkspaceMembershipSummary({
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userB.id
    });

    expect(memberSummary.currentMembership.role).toBe("MEMBER");
    expect(memberSummary.currentMembership.canManageWorkspaceSettings).toBe(false);
    expect(memberSummary.members.map((member) => member.email)).toEqual([fx.userA.email, fx.userB.email]);

    await fx.prisma.workspaceMembership.update({
      where: {
        workspaceId_userId: {
          workspaceId: fx.workspaceA.id,
          userId: fx.userB.id
        }
      },
      data: { role: MembershipRole.ADMIN }
    });

    const adminSummary = await getWorkspaceMembershipSummary({
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userB.id
    });

    expect(adminSummary.currentMembership.role).toBe("ADMIN");
    expect(adminSummary.currentMembership.canManageWorkspaceSettings).toBe(true);
    expect(adminSummary.members.map((member) => member.role)).toEqual(["OWNER", "ADMIN"]);
  });

  it("edits workspace roles and transfers ownership through owner-scoped member management", async () => {
    const fx = currentFixture();
    const userC = await fx.prisma.user.create({
      data: { email: `role-edit-c-${fx.workspaceA.id}@example.test`, name: "Role Edit C" }
    });
    const userD = await fx.prisma.user.create({
      data: { email: `role-edit-d-${fx.workspaceA.id}@example.test`, name: "Role Edit D" }
    });

    try {
      const memberMembership = await fx.prisma.workspaceMembership.create({
        data: {
          workspaceId: fx.workspaceA.id,
          userId: fx.userB.id,
          role: MembershipRole.MEMBER
        }
      });
      const adminMembership = await fx.prisma.workspaceMembership.create({
        data: {
          workspaceId: fx.workspaceA.id,
          userId: userC.id,
          role: MembershipRole.ADMIN
        }
      });
      const removableMemberMembership = await fx.prisma.workspaceMembership.create({
        data: {
          workspaceId: fx.workspaceA.id,
          userId: userD.id,
          role: MembershipRole.MEMBER
        }
      });
      const ownerMembership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: fx.workspaceA.id,
            userId: fx.userA.id
          }
        }
      });
      const workspaceBOwnerMembership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: fx.workspaceB.id,
            userId: fx.userB.id
          }
        }
      });

      await expect(
        removeWorkspaceMember({ workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id }, removableMemberMembership.id)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Workspace admin access is required.",
        status: 403
      });
      await expect(
        updateWorkspaceMemberRole({ workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id }, adminMembership.id, "MEMBER")
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Workspace admin access is required.",
        status: 403
      });
      await expect(
        transferWorkspaceOwnership({ workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id }, memberMembership.id)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Workspace admin access is required.",
        status: 403
      });
      await expect(removeWorkspaceMember(fx.actorA, workspaceBOwnerMembership.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      await expect(updateWorkspaceMemberRole(fx.actorA, workspaceBOwnerMembership.id, "MEMBER")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      await expect(transferWorkspaceOwnership(fx.actorA, workspaceBOwnerMembership.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      const promoted = await updateWorkspaceMemberRole(fx.actorA, memberMembership.id, "ADMIN");
      const demoted = await updateWorkspaceMemberRole(fx.actorA, memberMembership.id, "MEMBER");

      await expect(
        updateWorkspaceMemberRole({ workspaceId: fx.workspaceA.id, actorUserId: userC.id }, memberMembership.id, "ADMIN")
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only the workspace owner can promote or demote admins.",
        status: 403
      });
      await expect(
        updateWorkspaceMemberRole({ workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id }, adminMembership.id, "MEMBER")
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      await expect(
        removeWorkspaceMember({ workspaceId: fx.workspaceA.id, actorUserId: userC.id }, adminMembership.id)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only the workspace owner can remove admins.",
        status: 403
      });
      const adminRemovedMember = await removeWorkspaceMember(
        { workspaceId: fx.workspaceA.id, actorUserId: userC.id },
        removableMemberMembership.id
      );
      const removedMemberCount = await fx.prisma.workspaceMembership.count({
        where: { id: removableMemberMembership.id }
      });
      await expect(updateWorkspaceMemberRole(fx.actorA, ownerMembership.id, "MEMBER")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Use ownership transfer to change the workspace owner.",
        status: 422
      });
      await expect(updateWorkspaceMemberRole(fx.actorA, memberMembership.id, "OWNER")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Role can only be changed to Admin or Member.",
        status: 422
      });
      await expect(updateWorkspaceMemberRole(fx.actorA, fx.recordsB.deal.id, "MEMBER")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      await expect(
        transferWorkspaceOwnership({ workspaceId: fx.workspaceA.id, actorUserId: userC.id }, memberMembership.id)
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "Only the workspace owner can transfer ownership.",
        status: 403
      });
      await expect(transferWorkspaceOwnership(fx.actorA, ownerMembership.id)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Choose another workspace member to receive ownership.",
        status: 422
      });
      await expect(transferWorkspaceOwnership(fx.actorA, removableMemberMembership.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });
      await expect(transferWorkspaceOwnership(fx.actorA, "missing-membership-id")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404
      });

      const newOwner = await transferWorkspaceOwnership(fx.actorA, memberMembership.id);
      const previousOwnerMembership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: { id: ownerMembership.id }
      });
      const newOwnerMembership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
        where: { id: memberMembership.id }
      });
      const transferSummary = await getWorkspaceMembershipSummary({
        workspaceId: fx.workspaceA.id,
        actorUserId: fx.userB.id
      });
      const roleAuditLog = await fx.prisma.auditLog.findFirst({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "WorkspaceMembership",
          entityId: memberMembership.id,
          action: "workspace_member.role_updated"
        },
        orderBy: { createdAt: "asc" }
      });
      const transferAuditLog = await fx.prisma.auditLog.findFirst({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "WorkspaceMembership",
          entityId: memberMembership.id,
          action: "workspace_member.ownership_transferred"
        }
      });

      expect(promoted.role).toBe("ADMIN");
      expect(demoted.role).toBe("MEMBER");
      expect(adminRemovedMember.email).toBe(userD.email);
      expect(removedMemberCount).toBe(0);
      expect(newOwner).toMatchObject({
        userId: fx.userB.id,
        role: "OWNER",
        roleLabel: "Owner"
      });
      expect(previousOwnerMembership.role).toBe("ADMIN");
      expect(newOwnerMembership.role).toBe("OWNER");
      expect(transferSummary.currentMembership.role).toBe("OWNER");
      expect(transferSummary.members.map((member) => member.role)).toEqual(["OWNER", "ADMIN", "ADMIN"]);
      expect(roleAuditLog?.metadata).toMatchObject({
        memberUserId: fx.userB.id,
        email: fx.userB.email,
        previousRole: "MEMBER",
        newRole: "ADMIN"
      });
      expect(transferAuditLog?.metadata).toMatchObject({
        previousOwnerUserId: fx.userA.id,
        previousOwnerEmail: fx.userA.email,
        newOwnerUserId: fx.userB.id,
        newOwnerEmail: fx.userB.email,
        previousOwnerNewRole: "ADMIN"
      });
      await expect(removeWorkspaceMember({ workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id }, memberMembership.id)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Owner removal is not available yet.",
        status: 422
      });
    } finally {
      await fx.prisma.workspaceMembership.deleteMany({
        where: {
          workspaceId: fx.workspaceA.id,
          userId: { in: [fx.userB.id, userC.id, userD.id] }
        }
      });
      await fx.prisma.workspaceMembership.updateMany({
        where: {
          workspaceId: fx.workspaceA.id,
          userId: fx.userA.id
        },
        data: { role: MembershipRole.OWNER }
      });
      await fx.prisma.user.deleteMany({ where: { id: { in: [userC.id, userD.id] } } });
    }
  });

  it("keeps core CRM entry points workspace-scoped after context resolution", async () => {
    const fx = currentFixture();
    const crossWorkspaceActor = { workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id };

    for (const request of [
      () => listDeals(crossWorkspaceActor),
      () => listActivities(crossWorkspaceActor),
      () => listNotes(crossWorkspaceActor),
      () => getDealReport(crossWorkspaceActor),
      () => listDealSavedViews(crossWorkspaceActor),
      () => listCustomFields(crossWorkspaceActor)
    ]) {
      await expect(request()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
