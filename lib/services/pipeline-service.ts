import { Prisma, QuoteStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertRecordInWorkspace } from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreatePipelineInput = Omit<Prisma.PipelineUncheckedCreateInput, "workspaceId">;

export const defaultPipelineName = "New Business";
export const defaultPipelineStages = [
  { name: "Qualified", probability: 20 },
  { name: "Discovery", probability: 35 },
  { name: "Proposal", probability: 60 },
  { name: "Negotiation", probability: 80 },
  { name: "Closed", probability: 100 }
] as const;

export async function listPipelines(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  return prisma.pipeline.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: {
      stages: {
        where: activeWhere,
        orderBy: { sortOrder: "asc" },
        include: {
          deals: {
            where: activeWhere,
            include: {
              person: true,
              organization: true,
              owner: { select: userDisplaySelect },
              activities: {
                where: { ...activeWhere, completedAt: null },
                orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
                take: 1
              },
              notes: {
                where: activeWhere,
                orderBy: { createdAt: "desc" },
                take: 1
              },
              emailLogs: {
                orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
                take: 1
              },
              quotes: {
                where: { status: QuoteStatus.SENT },
                orderBy: { updatedAt: "desc" },
                take: 1
              }
            },
            orderBy: { updatedAt: "desc" }
          }
        }
      }
    },
    orderBy: { sortOrder: "asc" }
  });
}

export async function ensureDefaultPipelineForWorkspace(workspaceId: string) {
  const existingPipeline = await prisma.pipeline.findFirst({
    where: { workspaceId, name: defaultPipelineName, ...activeWhere },
    include: {
      stages: {
        where: activeWhere,
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: { sortOrder: "asc" }
  });

  const pipeline =
    existingPipeline ??
    (await prisma.pipeline.create({
      data: {
        workspaceId,
        name: defaultPipelineName,
        description: "Default sales pipeline for new business opportunities.",
        sortOrder: 1
      },
      include: {
        stages: {
          where: activeWhere,
          orderBy: { sortOrder: "asc" }
        }
      }
    }));

  const existingStageNames = new Set(pipeline.stages.map((stage) => stage.name));
  const missingStages = defaultPipelineStages
    .map((stage, index) => ({ ...stage, sortOrder: index + 1 }))
    .filter((stage) => !existingStageNames.has(stage.name));

  if (missingStages.length > 0) {
    await prisma.pipelineStage.createMany({
      data: missingStages.map((stage) => ({
        workspaceId,
        pipelineId: pipeline.id,
        name: stage.name,
        probability: stage.probability,
        sortOrder: stage.sortOrder
      }))
    });
  }

  return prisma.pipeline.findUniqueOrThrow({
    where: { id: pipeline.id },
    include: {
      stages: {
        where: activeWhere,
        orderBy: { sortOrder: "asc" }
      }
    }
  });
}

export async function createPipeline(actor: WorkspaceActor, data: CreatePipelineInput) {
  await ensureWorkspaceAccess(actor);
  const pipeline = await prisma.pipeline.create({
    data: { ...data, workspaceId: actor.workspaceId }
  });
  await writeAuditLog(actor, "pipeline.created", "Pipeline", pipeline.id, { name: pipeline.name });
  return pipeline;
}

export async function updatePipeline(actor: WorkspaceActor, pipelineId: string, data: Prisma.PipelineUpdateInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipeline", actor.workspaceId, pipelineId);
  const pipeline = await prisma.pipeline.update({
    where: { id: pipelineId },
    data
  });
  await writeAuditLog(actor, "pipeline.updated", "Pipeline", pipeline.id);
  return pipeline;
}

export async function softDeletePipeline(actor: WorkspaceActor, pipelineId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipeline", actor.workspaceId, pipelineId);
  await prisma.pipeline.update({ where: { id: pipelineId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "pipeline.deleted", "Pipeline", pipelineId);
}

export async function listStages(actor: WorkspaceActor, pipelineId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipeline", actor.workspaceId, pipelineId);
  return prisma.pipelineStage.findMany({
    where: { workspaceId: actor.workspaceId, pipelineId, ...activeWhere },
    orderBy: { sortOrder: "asc" }
  });
}

export async function createStage(actor: WorkspaceActor, pipelineId: string, data: Omit<Prisma.PipelineStageUncheckedCreateInput, "workspaceId" | "pipelineId">) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipeline", actor.workspaceId, pipelineId);
  const stage = await prisma.pipelineStage.create({
    data: { ...data, workspaceId: actor.workspaceId, pipelineId }
  });
  await writeAuditLog(actor, "stage.created", "PipelineStage", stage.id, { pipelineId });
  return stage;
}

export async function updateStage(actor: WorkspaceActor, stageId: string, data: Prisma.PipelineStageUpdateInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipelineStage", actor.workspaceId, stageId);
  const stage = await prisma.pipelineStage.update({ where: { id: stageId }, data });
  await writeAuditLog(actor, "stage.updated", "PipelineStage", stage.id);
  return stage;
}

export async function softDeleteStage(actor: WorkspaceActor, stageId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipelineStage", actor.workspaceId, stageId);
  await prisma.pipelineStage.update({ where: { id: stageId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "stage.deleted", "PipelineStage", stageId);
}
