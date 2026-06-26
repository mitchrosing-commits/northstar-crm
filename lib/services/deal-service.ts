import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { listCustomFieldFilteredEntityIds, type CustomFieldListFilters } from "./custom-field-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertDealPipelineAndStage, assertRecordInWorkspace } from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreateDealInput = Omit<Prisma.DealUncheckedCreateInput, "workspaceId">;
export type DealListFilters = CustomFieldListFilters & {
  q?: string;
  status?: "OPEN" | "WON" | "LOST";
  stageId?: string;
  ownerId?: string;
  personId?: string;
  organizationId?: string;
  sortBy?: "createdAt" | "updatedAt" | "title" | "valueCents" | "expectedCloseAt";
  sortDirection?: "asc" | "desc";
};
type CloseDealInput = {
  status: "WON" | "LOST";
  lostReason?: string | null;
};

export async function listDeals(actor: WorkspaceActor, filters: DealListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "DEAL", filters);
  const where = dealWhere(actor.workspaceId, filters, customFieldEntityIds);

  return prisma.deal.findMany({
    where,
    include: dealInclude,
    orderBy: dealOrderBy(filters)
  });
}

export async function listDealsPage(actor: WorkspaceActor, filters: DealListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "DEAL", filters);
  const where = dealWhere(actor.workspaceId, filters, customFieldEntityIds);
  const total = await prisma.deal.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.deal.findMany({
    where,
    include: dealInclude,
    orderBy: dealOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items };
}

const dealInclude = {
  stage: true,
  pipeline: true,
  person: true,
  organization: true,
  owner: { select: userDisplaySelect },
  activities: {
    where: { ...activeWhere, completedAt: null },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 1
  }
} satisfies Prisma.DealInclude;

function dealWhere(
  workspaceId: string,
  filters: DealListFilters,
  customFieldEntityIds?: string[]
): Prisma.DealWhereInput {
  const where: Prisma.DealWhereInput = { workspaceId, ...activeWhere };
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { person: { is: { firstName: { contains: filters.q, mode: "insensitive" } } } },
      { person: { is: { lastName: { contains: filters.q, mode: "insensitive" } } } },
      { person: { is: { email: { contains: filters.q, mode: "insensitive" } } } },
      { organization: { is: { name: { contains: filters.q, mode: "insensitive" } } } }
    ];
  }
  if (filters.status) where.status = filters.status;
  if (filters.stageId) where.stageId = filters.stageId;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.personId) where.personId = filters.personId;
  if (filters.organizationId) where.organizationId = filters.organizationId;
  if (customFieldEntityIds) where.id = { in: customFieldEntityIds };
  return where;
}

function dealOrderBy(filters: DealListFilters): Prisma.DealOrderByWithRelationInput {
  const direction = filters.sortDirection ?? "desc";
  if (filters.sortBy === "createdAt") return { createdAt: direction };
  if (filters.sortBy === "title") return { title: direction };
  if (filters.sortBy === "valueCents") return { valueCents: direction };
  if (filters.sortBy === "expectedCloseAt") return { expectedCloseAt: direction };
  return { updatedAt: direction };
}

export async function getDeal(actor: WorkspaceActor, dealId: string) {
  await ensureWorkspaceAccess(actor);
  const [deal, auditLogs] = await prisma.$transaction([
    prisma.deal.findFirst({
      where: { id: dealId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        stage: true,
        pipeline: true,
        person: true,
        organization: true,
        owner: { select: userDisplaySelect },
        activities: {
          where: activeWhere,
          include: { owner: { select: userDisplaySelect }, lead: true, person: true, organization: true },
          orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }]
        },
        lineItems: {
          include: { product: true },
          orderBy: [{ createdAt: "asc" }, { productName: "asc" }]
        },
        quotes: {
          include: {
            items: {
              orderBy: [{ createdAt: "asc" }, { name: "asc" }]
            }
          },
          orderBy: { createdAt: "desc" }
        },
        notes: { where: activeWhere, include: { author: { select: userDisplaySelect } }, orderBy: { createdAt: "desc" } }
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: "Deal", entityId: dealId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 25
    })
  ]);
  if (!deal) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  return { ...deal, auditLogs };
}

export async function createDeal(actor: WorkspaceActor, data: CreateDealInput) {
  await ensureWorkspaceAccess(actor);
  await assertDealPipelineAndStage(actor.workspaceId, data.pipelineId, data.stageId);
  const deal = await prisma.deal.create({ data: { ...data, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "deal.created", "Deal", deal.id, { title: deal.title });
  return deal;
}

export async function updateDeal(actor: WorkspaceActor, dealId: string, data: Prisma.DealUncheckedUpdateInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("deal", actor.workspaceId, dealId);
  const existing = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { stage: true }
  });

  if (existing.status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }

  if (typeof data.status === "string" && data.status !== "OPEN") {
    throw new ApiError("USE_DEAL_CLOSE_FLOW", "Use the close deal action to mark a deal won or lost.", 422);
  }

  if (typeof data.pipelineId === "string" || typeof data.stageId === "string") {
    const nextPipelineId = typeof data.pipelineId === "string" ? data.pipelineId : existing.pipelineId;
    const nextStageId = typeof data.stageId === "string" ? data.stageId : existing.stageId;

    if (nextPipelineId !== existing.pipelineId) {
      throw new ApiError("INVALID_PIPELINE_MOVE", "Move the deal within its current pipeline.", 422);
    }

    await assertDealPipelineAndStage(
      actor.workspaceId,
      existing.pipelineId,
      nextStageId
    );
  }
  const deal = await prisma.deal.update({ where: { id: dealId }, data });
  const stageChanged = typeof data.stageId === "string" && data.stageId !== existing.stageId;
  await writeAuditLog(actor, stageChanged ? "deal.stage_changed" : "deal.updated", "Deal", deal.id, {
    previousStageId: stageChanged ? existing.stageId : undefined,
    nextStageId: stageChanged ? deal.stageId : undefined
  });
  return deal;
}

export async function closeDeal(actor: WorkspaceActor, dealId: string, data: CloseDealInput) {
  await ensureWorkspaceAccess(actor);
  const existing = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId: actor.workspaceId, deletedAt: null },
    select: { id: true, status: true, pipelineId: true, stageId: true }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  if (existing.status !== "OPEN") {
    throw new ApiError("DEAL_ALREADY_CLOSED", "This deal has already been closed.", 409);
  }

  const outcomeAt = new Date();
  const deal = await prisma.deal.update({
    where: { id: dealId },
    data:
      data.status === "WON"
        ? { status: data.status, wonAt: outcomeAt, lostAt: null }
        : { status: data.status, wonAt: null, lostAt: outcomeAt }
  });
  const lostReason = data.status === "LOST" ? data.lostReason?.trim() || null : undefined;
  await writeAuditLog(actor, data.status === "WON" ? "deal.won" : "deal.lost", "Deal", deal.id, {
    previousStatus: existing.status,
    nextStatus: deal.status,
    pipelineId: existing.pipelineId,
    stageId: existing.stageId,
    lostReason
  });
  return deal;
}

export async function reopenDeal(actor: WorkspaceActor, dealId: string) {
  await ensureWorkspaceAccess(actor);
  const existing = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId: actor.workspaceId, deletedAt: null },
    select: { id: true, status: true, pipelineId: true, stageId: true }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  if (existing.status === "OPEN") {
    throw new ApiError("DEAL_ALREADY_OPEN", "Only won or lost deals can be reopened.", 409);
  }

  const deal = await prisma.deal.update({
    where: { id: dealId },
    data: { status: "OPEN", wonAt: null, lostAt: null }
  });
  await writeAuditLog(actor, "deal.reopened", "Deal", deal.id, {
    previousStatus: existing.status,
    nextStatus: deal.status,
    pipelineId: existing.pipelineId,
    stageId: existing.stageId
  });
  return deal;
}

export async function softDeleteDeal(actor: WorkspaceActor, dealId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("deal", actor.workspaceId, dealId);
  await prisma.deal.update({ where: { id: dealId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "deal.deleted", "Deal", dealId);
}
