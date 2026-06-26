import { prisma } from "@/lib/db/prisma";
import { ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export async function listAuditLogs(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  return prisma.auditLog.findMany({
    where: { workspaceId: actor.workspaceId },
    include: { actor: { select: userDisplaySelect } },
    orderBy: { createdAt: "desc" },
    take: 100
  });
}
