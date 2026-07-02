import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

export type WorkspaceActor = {
  workspaceId: string;
  actorUserId: string;
};

export const activeWhere = {
  deletedAt: null
};

export async function ensureWorkspaceAccess({ workspaceId, actorUserId }: WorkspaceActor) {
  const membership = await prisma.workspaceMembership.findFirst({
    where: {
      workspaceId,
      userId: actorUserId,
      user: { deletedAt: null },
      workspace: { deletedAt: null }
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
      metadata: serializeAuditMetadata(metadata)
    }
  });
}

function serializeAuditMetadata(metadata: unknown): Prisma.InputJsonValue | undefined {
  if (metadata === undefined) return undefined;

  const seen = new WeakSet<object>();

  try {
    const serialized = JSON.stringify(metadata, (_key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (typeof value === "function" || typeof value === "symbol") return undefined;
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });

    return serialized === undefined ? undefined : (JSON.parse(serialized) as Prisma.InputJsonValue);
  } catch {
    return { serializationError: "Audit metadata could not be serialized." };
  }
}
