import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/responses";

const mocks = vi.hoisted(() => ({
  acceptWorkspaceInvitation: vi.fn(),
  createWorkspaceFromName: vi.fn(),
  createWorkspaceInvitation: vi.fn(),
  getCurrentWorkspaceContext: vi.fn(),
  getRequestContext: vi.fn(),
  redirect: vi.fn(),
  removeWorkspaceMember: vi.fn(),
  revalidatePath: vi.fn(),
  revokeWorkspaceInvitation: vi.fn(),
  transferWorkspaceOwnership: vi.fn(),
  updateWorkspaceMemberRole: vi.fn(),
  cookieDelete: vi.fn(),
  cookieSet: vi.fn(),
  workspaceMembershipFindFirst: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    delete: mocks.cookieDelete,
    set: mocks.cookieSet
  }))
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/auth/request-context", () => ({
  activeWorkspaceCookieName: "activeWorkspaceId",
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext,
  getRequestContext: mocks.getRequestContext
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    workspaceMembership: {
      findFirst: mocks.workspaceMembershipFindFirst
    }
  }
}));

vi.mock("@/lib/services/workspace-service", () => ({
  acceptWorkspaceInvitation: mocks.acceptWorkspaceInvitation,
  createWorkspaceFromName: mocks.createWorkspaceFromName,
  createWorkspaceInvitation: mocks.createWorkspaceInvitation,
  removeWorkspaceMember: mocks.removeWorkspaceMember,
  revokeWorkspaceInvitation: mocks.revokeWorkspaceInvitation,
  transferWorkspaceOwnership: mocks.transferWorkspaceOwnership,
  updateWorkspaceMemberRole: mocks.updateWorkspaceMemberRole
}));

import {
  acceptWorkspaceInvitationAction,
  createWorkspaceAction,
  createWorkspaceInvitationAction,
  removeWorkspaceMemberAction,
  revokeWorkspaceInvitationAction,
  switchWorkspaceAction,
  transferWorkspaceOwnershipAction,
  updateWorkspaceMemberRoleAction
} from "@/app/workspaces/actions";

const actor = { workspaceId: "workspace_1", actorUserId: "user_1" };

function workspaceForm(input: {
  email?: string;
  invitationId?: string;
  membershipId?: string;
  name?: string;
  role?: string;
  workspaceId?: string;
}) {
  const data = new FormData();
  if (input.email !== undefined) data.set("email", input.email);
  if (input.invitationId !== undefined) data.set("invitationId", input.invitationId);
  if (input.membershipId !== undefined) data.set("membershipId", input.membershipId);
  if (input.name !== undefined) data.set("name", input.name);
  if (input.role !== undefined) data.set("role", input.role);
  if (input.workspaceId !== undefined) data.set("workspaceId", input.workspaceId);
  return data;
}

function redirectError(url: string) {
  return Object.assign(new Error("redirect"), { digest: "NEXT_REDIRECT", url });
}

describe("workspace server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.getRequestContext.mockResolvedValue({ actorUserId: actor.actorUserId });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
  });

  it("creates invitations through the workspace context and revalidates settings", async () => {
    mocks.createWorkspaceInvitation.mockResolvedValue({ email: "teammate@example.test", emailDeliveryStatus: "queued" });

    await expect(
      createWorkspaceInvitationAction(
        { email: "", role: "MEMBER" },
        workspaceForm({ email: " teammate@example.test ", role: "ADMIN" })
      )
    ).resolves.toEqual({
      email: "",
      role: "MEMBER",
      message: "Invitation email queued. The accept link is also available in the pending invitations table. Invitee: teammate@example.test."
    });

    expect(mocks.createWorkspaceInvitation).toHaveBeenCalledWith(actor, {
      email: " teammate@example.test ",
      role: "ADMIN"
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("redacts sensitive invitation create errors and does not revalidate failed submissions", async () => {
    mocks.createWorkspaceInvitation.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Invite failed with reset token raw-reset-token", 422)
    );

    await expect(
      createWorkspaceInvitationAction(
        { email: "", role: "MEMBER" },
        workspaceForm({ email: "invitee@example.test", role: "OWNER" })
      )
    ).resolves.toEqual({
      email: "invitee@example.test",
      role: "MEMBER",
      error: "Invite failed with reset token [redacted]"
    });

    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.createWorkspaceInvitation.mock.calls)).not.toContain("raw-reset-token");
  });

  it("revokes invitations, revalidates settings, and redirects back to settings", async () => {
    await expect(revokeWorkspaceInvitationAction(workspaceForm({ invitationId: " invitation_1 " }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings"
    });

    expect(mocks.revokeWorkspaceInvitation).toHaveBeenCalledWith(actor, "invitation_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("accepts invitations, sets the active workspace cookie, and redirects to settings", async () => {
    mocks.acceptWorkspaceInvitation.mockResolvedValue({ id: "workspace_invited" });

    await expect(acceptWorkspaceInvitationAction(workspaceForm({ invitationId: " invitation_2 " }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings"
    });

    expect(mocks.acceptWorkspaceInvitation).toHaveBeenCalledWith(actor.actorUserId, "invitation_2");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "activeWorkspaceId",
      "workspace_invited",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: false
      })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("switches only to workspaces with an active membership and stores the active workspace cookie", async () => {
    mocks.workspaceMembershipFindFirst.mockResolvedValue({ id: "membership_1" });

    await expect(switchWorkspaceAction(workspaceForm({ workspaceId: " workspace_target " }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/dashboard"
    });

    expect(mocks.workspaceMembershipFindFirst).toHaveBeenCalledWith({
      where: {
        userId: actor.actorUserId,
        workspaceId: "workspace_target",
        workspace: { deletedAt: null }
      },
      select: { id: true }
    });
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "activeWorkspaceId",
      "workspace_target",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: false
      })
    );
    expect(mocks.cookieDelete).not.toHaveBeenCalled();
  });

  it("clears the active workspace cookie instead of switching to inaccessible workspaces", async () => {
    mocks.workspaceMembershipFindFirst.mockResolvedValue(null);

    await expect(switchWorkspaceAction(workspaceForm({ workspaceId: "workspace_other" }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/dashboard"
    });

    expect(mocks.workspaceMembershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: actor.actorUserId,
          workspaceId: "workspace_other",
          workspace: { deletedAt: null }
        })
      })
    );
    expect(mocks.cookieDelete).toHaveBeenCalledWith("activeWorkspaceId");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("creates workspaces, stores the selected workspace, and revalidates settings", async () => {
    mocks.createWorkspaceFromName.mockResolvedValue({ id: "workspace_created" });

    await expect(createWorkspaceAction({ name: "" }, workspaceForm({ name: " New workspace " }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings"
    });

    expect(mocks.createWorkspaceFromName).toHaveBeenCalledWith(actor.actorUserId, " New workspace ");
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "activeWorkspaceId",
      "workspace_created",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: false
      })
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("redacts sensitive workspace create errors and does not set cookies after failure", async () => {
    mocks.createWorkspaceFromName.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Workspace create failed with reset token raw-workspace-token", 422)
    );

    await expect(createWorkspaceAction({ name: "" }, workspaceForm({ name: "Risky workspace" }))).resolves.toEqual({
      name: "Risky workspace",
      error: "Workspace create failed with reset token [redacted]"
    });

    expect(mocks.cookieSet).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("manages workspace members through scoped settings actions", async () => {
    await expect(removeWorkspaceMemberAction(workspaceForm({ membershipId: " member_1 " }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings"
    });
    expect(mocks.removeWorkspaceMember).toHaveBeenCalledWith(actor, "member_1");
    expect(mocks.revalidatePath).toHaveBeenLastCalledWith("/settings");

    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
    await expect(updateWorkspaceMemberRoleAction(workspaceForm({ membershipId: " member_2 ", role: "ADMIN" }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings"
    });
    expect(mocks.updateWorkspaceMemberRole).toHaveBeenCalledWith(actor, "member_2", "ADMIN");
    expect(mocks.revalidatePath).toHaveBeenLastCalledWith("/settings");

    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
    mocks.redirect.mockImplementation((url: string) => {
      throw redirectError(url);
    });
    await expect(transferWorkspaceOwnershipAction(workspaceForm({ membershipId: " member_3 " }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings"
    });
    expect(mocks.transferWorkspaceOwnership).toHaveBeenCalledWith(actor, "member_3");
    expect(mocks.revalidatePath).toHaveBeenLastCalledWith("/settings");
  });

  it("ignores malformed member role submissions without calling role mutation services", async () => {
    await expect(updateWorkspaceMemberRoleAction(workspaceForm({ membershipId: " member_2 ", role: "OWNER" }))).rejects.toMatchObject({
      digest: "NEXT_REDIRECT",
      url: "/settings"
    });

    expect(mocks.updateWorkspaceMemberRole).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });
});
