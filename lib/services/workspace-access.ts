import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";

export type WorkspaceActor = {
  workspaceId: string;
  actorUserId: string;
};

export const activeWhere = {
  deletedAt: null
};

export async function ensureWorkspaceAccess({ workspaceId, actorUserId }: WorkspaceActor) {
  const membership = await prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId: actorUserId
      }
    },
    select: { id: true, role: true }
  });

  if (!membership) {
    throw new ApiError("FORBIDDEN", "You do not have access to this workspace.", 403);
  }

  return membership;
}

export async function writeAuditLog(
  actor: WorkspaceActor,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: unknown
) {
  await prisma.auditLog.create({
    data: {
      workspaceId: actor.workspaceId,
      actorId: actor.actorUserId,
      action,
      entityType,
      entityId,
      metadata: metadata === undefined ? undefined : JSON.parse(JSON.stringify(metadata))
    }
  });
}
