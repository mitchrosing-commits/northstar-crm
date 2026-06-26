import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { MembershipRole } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { hashSessionToken } from "@/lib/auth/local-auth";
import {
  resolveAuthMode,
  resolveSessionIdentity,
  type SessionIdentity
} from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import type { WorkspaceActor } from "@/lib/services/workspace-access";

export const activeWorkspaceCookieName = "northstar_workspace";

export type CurrentUserContext = {
  actorUserId: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  };
};

export type RequestContext = CurrentUserContext;

export type CurrentWorkspaceContext = CurrentUserContext & {
  actor: WorkspaceActor;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    id: string;
    role: MembershipRole;
  };
};

export async function getRequestContext(): Promise<RequestContext> {
  const headerStore = await headers();
  return resolveCurrentUserContext(resolveSessionIdentity(headerStore));
}

export async function resolveCurrentUserContext(session: SessionIdentity): Promise<CurrentUserContext> {
  if (session.kind === "missing") {
    throw new ApiError("UNAUTHENTICATED", "A signed-in user is required.", 401);
  }

  const user = await resolveSessionUser(session);

  if (!user) {
    throw new ApiError(
      "UNAUTHENTICATED",
      session.kind === "user"
        ? "The current user could not be resolved."
        : session.kind === "demo"
          ? `Development actor ${session.email} was not found. Run the seed script or sign in.`
          : "The current session could not be resolved.",
      401
    );
  }

  return { actorUserId: user.id, user };
}

export async function getCurrentWorkspaceContext(): Promise<CurrentWorkspaceContext> {
  try {
    const context = await getRequestContext();
    const cookieStore = await cookies();

    return await resolveCurrentWorkspaceSelectionContext({
      actorUserId: context.actorUserId,
      user: context.user,
      selectedWorkspaceId: cookieStore.get(activeWorkspaceCookieName)?.value,
      fallbackWorkspaceSlug: process.env.DEV_WORKSPACE_SLUG ?? "northstar-revenue"
    });
  } catch (error) {
    redirectToLoginForMissingLocalSession(error);
    throw error;
  }
}

export async function getWorkspaceRequestContext(workspaceId: string): Promise<CurrentWorkspaceContext> {
  const context = await getRequestContext();
  return resolveCurrentWorkspaceContext({
    actorUserId: context.actorUserId,
    user: context.user,
    workspaceId
  });
}

export async function resolveCurrentWorkspaceContext(input: {
  actorUserId: string;
  user?: CurrentUserContext["user"];
  workspaceId?: string;
  workspaceSlug?: string;
}): Promise<CurrentWorkspaceContext> {
  if (!input.workspaceId && !input.workspaceSlug) {
    throw new ApiError("WORKSPACE_CONTEXT_REQUIRED", "A workspace context is required.", 400);
  }

  const workspace = await prisma.workspace.findFirst({
    where: {
      deletedAt: null,
      ...(input.workspaceId ? { id: input.workspaceId } : { slug: input.workspaceSlug })
    },
    select: { id: true, name: true, slug: true }
  });

  if (!workspace) {
    throw new ApiError("WORKSPACE_NOT_FOUND", "Workspace was not found.", 404);
  }

  const membership = await prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: input.actorUserId
      }
    },
    select: { id: true, role: true }
  });

  if (!membership) {
    throw new ApiError("FORBIDDEN", "You do not have access to this workspace.", 403);
  }

  const user =
    input.user ??
    (await prisma.user.findFirst({
      where: { id: input.actorUserId, deletedAt: null },
      select: { id: true, email: true, name: true, avatarUrl: true }
    }));

  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "The current user could not be resolved.", 401);
  }

  return {
    actorUserId: user.id,
    user,
    actor: { workspaceId: workspace.id, actorUserId: user.id },
    workspace,
    membership
  };
}

export async function resolveCurrentWorkspaceSelectionContext(input: {
  actorUserId: string;
  user?: CurrentUserContext["user"];
  selectedWorkspaceId?: string | null;
  fallbackWorkspaceSlug?: string | null;
}): Promise<CurrentWorkspaceContext> {
  const memberships = await prisma.workspaceMembership.findMany({
    where: {
      userId: input.actorUserId,
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

  if (memberships.length === 0) {
    throw new ApiError("FORBIDDEN", "You do not have access to any workspace.", 403);
  }

  const selectedMembership =
    (input.selectedWorkspaceId
      ? memberships.find((membership) => membership.workspace.id === input.selectedWorkspaceId)
      : undefined) ??
    (input.fallbackWorkspaceSlug
      ? memberships.find((membership) => membership.workspace.slug === input.fallbackWorkspaceSlug)
      : undefined) ??
    memberships[0];

  const user =
    input.user ??
    (await prisma.user.findFirst({
      where: { id: input.actorUserId, deletedAt: null },
      select: { id: true, email: true, name: true, avatarUrl: true }
    }));

  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "The current user could not be resolved.", 401);
  }

  return {
    actorUserId: user.id,
    user,
    actor: { workspaceId: selectedMembership.workspace.id, actorUserId: user.id },
    workspace: selectedMembership.workspace,
    membership: {
      id: selectedMembership.id,
      role: selectedMembership.role
    }
  };
}

async function resolveSessionUser(session: Exclude<SessionIdentity, { kind: "missing" }>) {
  const userSelect = { id: true, email: true, name: true, avatarUrl: true } as const;

  if (session.kind === "user") {
    return prisma.user.findFirst({
      where: { id: session.userId, deletedAt: null },
      select: userSelect
    });
  }

  if (session.kind === "session") {
    const localSession = await prisma.session.findFirst({
      where: {
        tokenHash: hashSessionToken(session.token),
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { deletedAt: null }
      },
      select: {
        user: {
          select: userSelect
        }
      }
    });

    return localSession?.user ?? null;
  }

  return prisma.user.findFirst({
    where: { email: session.email, deletedAt: null },
    select: userSelect
  });
}

export function shouldRedirectToLoginForMissingAppSession(error: unknown, env: Record<string, string | undefined> = process.env) {
  return error instanceof ApiError && error.status === 401 && error.code === "UNAUTHENTICATED" && resolveAuthMode(env) === "local";
}

function redirectToLoginForMissingLocalSession(error: unknown) {
  if (shouldRedirectToLoginForMissingAppSession(error)) {
    redirect("/login");
  }
}
