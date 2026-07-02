import { QuoteStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import {
  sortOrderIntColumnMax,
  sortOrderIntColumnMin,
  stageProbabilityMax,
  stageProbabilityMin
} from "@/lib/product-limits";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import {
  activityAttachmentRelationsWhere,
  assertRecordInWorkspace,
  emailLogAttachmentRelationsWhere,
  noteAttachmentRelationsWhere
} from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { userDisplaySelect } from "./user-select";

type CreatePipelineInput = {
  name: unknown;
  description?: unknown;
  sortOrder?: unknown;
};

type UpdatePipelineInput = Partial<CreatePipelineInput>;

type CreateStageInput = {
  name: unknown;
  probability?: unknown;
  sortOrder: unknown;
};

type UpdateStageInput = Partial<CreateStageInput>;

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
  const pipelines = await prisma.pipeline.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: {
      stages: {
        where: { workspaceId: actor.workspaceId, ...activeWhere },
        orderBy: { sortOrder: "asc" },
        include: {
          deals: {
            where: { workspaceId: actor.workspaceId, ...activeWhere },
            include: {
              person: true,
              organization: true,
              owner: { select: userDisplaySelect },
              activities: {
                where: {
                  workspaceId: actor.workspaceId,
                  ...activityAttachmentRelationsWhere(actor.workspaceId),
                  ...activeWhere,
                  completedAt: null
                },
                orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
                take: 1
              },
              notes: {
                where: { workspaceId: actor.workspaceId, ...noteAttachmentRelationsWhere(actor.workspaceId), ...activeWhere },
                orderBy: { createdAt: "desc" },
                take: 1
              },
              emailLogs: {
                where: { workspaceId: actor.workspaceId, ...emailLogAttachmentRelationsWhere(actor.workspaceId) },
                orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
                take: 1
              },
              quotes: {
                where: { workspaceId: actor.workspaceId, status: QuoteStatus.SENT },
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

  return pipelines.map((pipeline) => ({
    ...pipeline,
    stages: pipeline.stages.map((stage) => ({
      ...stage,
      deals: stage.deals.map((deal) => scopePipelineDealRelations(actor.workspaceId, deal))
    }))
  }));
}

export async function ensureDefaultPipelineForWorkspace(workspaceId: string) {
  const existingPipeline = await prisma.pipeline.findFirst({
    where: { workspaceId, name: defaultPipelineName, ...activeWhere },
    include: {
      stages: {
        where: { workspaceId, ...activeWhere },
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
          where: { workspaceId, ...activeWhere },
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
        where: { workspaceId, ...activeWhere },
        orderBy: { sortOrder: "asc" }
      }
    }
  });
}

export async function createPipeline(actor: WorkspaceActor, data: CreatePipelineInput) {
  await ensureWorkspaceAccess(actor);
  const input = normalizePipelineCreateInput(data);
  const pipeline = await prisma.pipeline.create({
    data: { ...input, workspaceId: actor.workspaceId }
  });
  await writeAuditLog(actor, "pipeline.created", "Pipeline", pipeline.id, { name: pipeline.name });
  return pipeline;
}

export async function updatePipeline(actor: WorkspaceActor, pipelineId: string, data: UpdatePipelineInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipeline", actor.workspaceId, pipelineId);
  const input = normalizePipelineUpdateInput(data);
  const existing = await prisma.pipeline.findFirstOrThrow({
    where: { id: pipelineId, workspaceId: actor.workspaceId, ...activeWhere }
  });

  if (Object.keys(input).length === 0 || !pipelineInputChanges(input, existing)) {
    return existing;
  }

  const pipeline = await prisma.pipeline.update({
    where: { id: pipelineId },
    data: input
  });
  await writeAuditLog(actor, "pipeline.updated", "Pipeline", pipeline.id);
  return pipeline;
}

export async function softDeletePipeline(actor: WorkspaceActor, pipelineId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipeline", actor.workspaceId, pipelineId);
  await assertPipelineHasNoActiveDeals(actor.workspaceId, pipelineId);
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

export async function createStage(actor: WorkspaceActor, pipelineId: string, data: CreateStageInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipeline", actor.workspaceId, pipelineId);
  const input = normalizeStageCreateInput(data);
  const stage = await prisma.pipelineStage.create({
    data: { ...input, workspaceId: actor.workspaceId, pipelineId }
  });
  await writeAuditLog(actor, "stage.created", "PipelineStage", stage.id, { pipelineId });
  return stage;
}

export async function updateStage(actor: WorkspaceActor, stageId: string, data: UpdateStageInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipelineStage", actor.workspaceId, stageId);
  const input = normalizeStageUpdateInput(data);
  const existing = await prisma.pipelineStage.findFirstOrThrow({
    where: { id: stageId, workspaceId: actor.workspaceId, ...activeWhere }
  });

  if (Object.keys(input).length === 0 || !stageInputChanges(input, existing)) {
    return existing;
  }

  const stage = await prisma.pipelineStage.update({ where: { id: stageId }, data: input });
  await writeAuditLog(actor, "stage.updated", "PipelineStage", stage.id);
  return stage;
}

export async function softDeleteStage(actor: WorkspaceActor, stageId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("pipelineStage", actor.workspaceId, stageId);
  await assertStageHasNoActiveDeals(actor.workspaceId, stageId);
  await prisma.pipelineStage.update({ where: { id: stageId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "stage.deleted", "PipelineStage", stageId);
}

async function assertPipelineHasNoActiveDeals(workspaceId: string, pipelineId: string) {
  const activeDealCount = await prisma.deal.count({
    where: { workspaceId, pipelineId, ...activeWhere }
  });

  if (activeDealCount > 0) {
    throw new ApiError("PIPELINE_IN_USE", "Move or delete active deals before deleting this pipeline.", 409);
  }
}

async function assertStageHasNoActiveDeals(workspaceId: string, stageId: string) {
  const activeDealCount = await prisma.deal.count({
    where: { workspaceId, stageId, ...activeWhere }
  });

  if (activeDealCount > 0) {
    throw new ApiError("STAGE_IN_USE", "Move or delete active deals before deleting this stage.", 409);
  }
}

function scopePipelineDealRelations<T extends { person: WorkspaceScopedRelation; organization: WorkspaceScopedRelation }>(
  workspaceId: string,
  deal: T
) {
  return {
    ...deal,
    person: scopeWorkspaceRelation(workspaceId, deal.person),
    organization: scopeWorkspaceRelation(workspaceId, deal.organization)
  };
}

function pipelineInputChanges(
  input: ReturnType<typeof normalizePipelineUpdateInput>,
  existing: { name: string; description: string | null; sortOrder: number }
) {
  if (input.name !== undefined && input.name !== existing.name) return true;
  if (input.description !== undefined && input.description !== existing.description) return true;
  if (input.sortOrder !== undefined && input.sortOrder !== existing.sortOrder) return true;
  return false;
}

function stageInputChanges(
  input: ReturnType<typeof normalizeStageUpdateInput>,
  existing: { name: string; probability: number | null; sortOrder: number }
) {
  if (input.name !== undefined && input.name !== existing.name) return true;
  if (input.probability !== undefined && input.probability !== existing.probability) return true;
  if (input.sortOrder !== undefined && input.sortOrder !== existing.sortOrder) return true;
  return false;
}

function normalizePipelineCreateInput(data: unknown) {
  const input = objectInput(data);
  const normalized = {
    name: normalizeRequiredText(input.name, "Pipeline name is required."),
    description: normalizeOptionalText(input.description, "Pipeline description must be text."),
    sortOrder: normalizeSortOrderValue(input.sortOrder)
  };

  return omitUndefined(normalized);
}

function normalizePipelineUpdateInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Pipeline update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    name: hasInputKey(input, "name") ? normalizeRequiredText(input.name, "Pipeline name is required.") : undefined,
    description: hasInputKey(input, "description")
      ? normalizeOptionalText(input.description, "Pipeline description must be text.")
      : undefined,
    sortOrder: hasInputKey(input, "sortOrder") ? normalizeSortOrderValue(input.sortOrder) : undefined
  });
}

function normalizeStageCreateInput(data: unknown) {
  const input = objectInput(data);
  return omitUndefined({
    name: normalizeRequiredText(input.name, "Stage name is required."),
    probability: normalizeStageProbabilityValue(input.probability),
    sortOrder: normalizeSortOrderValue(input.sortOrder, { required: true })
  });
}

function normalizeStageUpdateInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Stage update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    name: hasInputKey(input, "name") ? normalizeRequiredText(input.name, "Stage name is required.") : undefined,
    probability: hasInputKey(input, "probability") ? normalizeStageProbabilityValue(input.probability) : undefined,
    sortOrder: hasInputKey(input, "sortOrder") ? normalizeSortOrderValue(input.sortOrder) : undefined
  });
}

function normalizeRequiredText(input: unknown, message: string) {
  if (typeof input !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }

  const value = input.trim().replace(/\s+/g, " ");
  if (!value) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }

  return value;
}

function normalizeOptionalText(input: unknown, message: string) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (typeof input !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }

  return input.trim().replace(/\s+/g, " ");
}

function normalizeSortOrderValue(input: unknown, options: { required?: boolean } = {}) {
  if (input === undefined && !options.required) return undefined;
  const sortOrder = extractSortOrderNumber(input);
  if (!Number.isInteger(sortOrder)) {
    throw new ApiError("VALIDATION_ERROR", "Sort order must be a whole number.", 422);
  }
  if (sortOrder < sortOrderIntColumnMin) {
    throw new ApiError("VALIDATION_ERROR", "Sort order is too small.", 422);
  }
  if (sortOrder > sortOrderIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", "Sort order is too large.", 422);
  }
  return sortOrder;
}

function extractSortOrderNumber(input: unknown) {
  if (typeof input === "number") return input;
  if (typeof input === "object" && input !== null && "set" in input) {
    const value = (input as { set?: unknown }).set;
    return typeof value === "number" ? value : Number.NaN;
  }
  return Number.NaN;
}

function normalizeStageProbabilityValue(input: unknown) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  const probability = extractNullableNumber(input);
  if (probability === null) return null;
  if (!Number.isInteger(probability)) {
    throw new ApiError("VALIDATION_ERROR", "Stage probability must be a whole number.", 422);
  }
  if (probability < stageProbabilityMin || probability > stageProbabilityMax) {
    throw new ApiError("VALIDATION_ERROR", "Stage probability must be between 0 and 100.", 422);
  }
  return probability;
}

function extractNullableNumber(input: unknown) {
  if (typeof input === "number") return input;
  if (typeof input === "object" && input !== null && "set" in input) {
    const value = (input as { set?: unknown }).set;
    if (value === null) return null;
    return typeof value === "number" ? value : Number.NaN;
  }
  return Number.NaN;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null) return input as Record<string, unknown>;
  return {};
}

function hasInputKey(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
  };
}
