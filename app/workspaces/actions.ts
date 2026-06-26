"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api/responses";
import { activeWorkspaceCookieName, getCurrentWorkspaceContext, getRequestContext } from "@/lib/auth/request-context";
import { prisma } from "@/lib/db/prisma";
import {
  acceptWorkspaceInvitation,
  createWorkspaceFromName,
  createWorkspaceInvitation,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
  transferWorkspaceOwnership,
  updateWorkspaceMemberRole
} from "@/lib/services/crm";

export type CreateWorkspaceActionState = {
  name: string;
  error?: string;
};

export type CreateWorkspaceInvitationActionState = {
  email: string;
  role: "MEMBER" | "ADMIN";
  error?: string;
  message?: string;
};

const activeWorkspaceCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30
} as const;

export async function switchWorkspaceAction(formData: FormData) {
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();
  const { actorUserId } = await getRequestContext();
  const cookieStore = await cookies();

  if (!workspaceId) {
    cookieStore.delete(activeWorkspaceCookieName);
    redirect("/dashboard");
  }

  const membership = await prisma.workspaceMembership.findFirst({
    where: {
      userId: actorUserId,
      workspaceId,
      workspace: { deletedAt: null }
    },
    select: { id: true }
  });

  if (membership) {
    cookieStore.set(activeWorkspaceCookieName, workspaceId, activeWorkspaceCookieOptions);
  } else {
    cookieStore.delete(activeWorkspaceCookieName);
  }

  redirect("/dashboard");
}

export async function createWorkspaceAction(
  _previousState: CreateWorkspaceActionState,
  formData: FormData
): Promise<CreateWorkspaceActionState> {
  const name = String(formData.get("name") ?? "");
  let workspaceId: string;

  try {
    const { actorUserId } = await getRequestContext();
    const workspace = await createWorkspaceFromName(actorUserId, name);
    workspaceId = workspace.id;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { name, error: "A signed-in user is required to create a workspace." };
    }

    if (error instanceof ApiError) {
      return { name, error: error.message };
    }

    return { name, error: "Workspace could not be created." };
  }

  const cookieStore = await cookies();
  cookieStore.set(activeWorkspaceCookieName, workspaceId, activeWorkspaceCookieOptions);
  revalidatePath("/settings");
  redirect("/settings");
}

export async function createWorkspaceInvitationAction(
  _previousState: CreateWorkspaceInvitationActionState,
  formData: FormData
): Promise<CreateWorkspaceInvitationActionState> {
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "MEMBER") === "ADMIN" ? "ADMIN" : "MEMBER";

  try {
    const { actor } = await getCurrentWorkspaceContext();
    const invitation = await createWorkspaceInvitation(actor, { email, role });
    revalidatePath("/settings");
    return {
      email: "",
      role: "MEMBER",
      message: `Invitation created for ${invitation.email}.`
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { email, role, error: "A signed-in user is required to invite workspace members." };
    }

    if (error instanceof ApiError) {
      return { email, role, error: error.message };
    }

    return { email, role, error: "Workspace invitation could not be created." };
  }
}

export async function revokeWorkspaceInvitationAction(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  const { actor } = await getCurrentWorkspaceContext();

  if (invitationId) {
    await revokeWorkspaceInvitation(actor, invitationId);
  }

  revalidatePath("/settings");
  redirect("/settings");
}

export async function removeWorkspaceMemberAction(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const { actor } = await getCurrentWorkspaceContext();

  if (membershipId) {
    await removeWorkspaceMember(actor, membershipId);
  }

  revalidatePath("/settings");
  redirect("/settings");
}

export async function updateWorkspaceMemberRoleAction(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const { actor } = await getCurrentWorkspaceContext();

  if (membershipId && (role === "ADMIN" || role === "MEMBER")) {
    await updateWorkspaceMemberRole(actor, membershipId, role);
  }

  revalidatePath("/settings");
  redirect("/settings");
}

export async function transferWorkspaceOwnershipAction(formData: FormData) {
  const membershipId = String(formData.get("membershipId") ?? "").trim();
  const { actor } = await getCurrentWorkspaceContext();

  if (membershipId) {
    await transferWorkspaceOwnership(actor, membershipId);
  }

  revalidatePath("/settings");
  redirect("/settings");
}

export async function acceptWorkspaceInvitationAction(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  const { actorUserId } = await getRequestContext();
  const workspace = await acceptWorkspaceInvitation(actorUserId, invitationId);
  const cookieStore = await cookies();

  cookieStore.set(activeWorkspaceCookieName, workspace.id, activeWorkspaceCookieOptions);
  revalidatePath("/settings");
  redirect("/settings");
}
