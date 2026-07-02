import { Prisma, type DealStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { startOfDay } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { listCustomFieldFilteredEntityIds, type CustomFieldListFilters } from "./custom-field-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import {
  activityAttachmentRelationsWhere,
  assertDealLinks,
  assertDealPipelineAndStage,
  assertRecordInWorkspace,
  noteAttachmentRelationsWhere
} from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { userDisplaySelect } from "./user-select";

type CreateDealInput = {
  pipelineId: unknown;
  stageId: unknown;
  ownerId?: unknown;
  personId?: unknown;
  organizationId?: unknown;
  title: unknown;
  valueCents?: unknown;
  currency?: unknown;
  status?: unknown;
  expectedCloseAt?: unknown;
  wonAt?: unknown;
  lostAt?: unknown;
};
type UpdateDealInput = Partial<CreateDealInput>;
export type DealListFilters = CustomFieldListFilters & {
  q?: string;
  status?: "OPEN" | "WON" | "LOST";
  stageId?: string;
  ownerId?: string;
  personId?: string;
  organizationId?: string;
  followUp?: "missing" | "overdue" | "today" | "upcoming" | "unscheduled";
  commercial?: "noQuote" | "hasQuote" | "acceptedQuote" | "valueNoLineItems";
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

  const deals = await prisma.deal.findMany({
    where,
    include: dealInclude(actor.workspaceId),
    orderBy: dealOrderBy(filters)
  });

  return deals.map((deal) => scopeDealRelations(actor.workspaceId, deal));
}

export async function listDealsPage(actor: WorkspaceActor, filters: DealListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "DEAL", filters);
  const where = dealWhere(actor.workspaceId, filters, customFieldEntityIds);
  const total = await prisma.deal.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.deal.findMany({
    where,
    include: dealInclude(actor.workspaceId),
    orderBy: dealOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items: items.map((deal) => scopeDealRelations(actor.workspaceId, deal)) };
}

const dealInclude = (workspaceId: string) => ({
  stage: true,
  pipeline: true,
  person: true,
  organization: true,
  owner: { select: userDisplaySelect },
  activities: {
    where: { workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(workspaceId), completedAt: null },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 1
  },
  quotes: {
    where: { workspaceId },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    take: 1
  },
  _count: {
    select: {
      lineItems: { where: { workspaceId } },
      quotes: { where: { workspaceId } }
    }
  }
}) satisfies Prisma.DealInclude;

function dealWhere(
  workspaceId: string,
  filters: DealListFilters,
  customFieldEntityIds?: string[]
): Prisma.DealWhereInput {
  const where: Prisma.DealWhereInput = { workspaceId, ...activeWhere };
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      {
        person: {
          is: {
            workspaceId,
            ...activeWhere,
            OR: [
              { firstName: { contains: filters.q, mode: "insensitive" } },
              { lastName: { contains: filters.q, mode: "insensitive" } },
              { email: { contains: filters.q, mode: "insensitive" } }
            ]
          }
        }
      },
      { organization: { is: { workspaceId, ...activeWhere, name: { contains: filters.q, mode: "insensitive" } } } }
    ];
  }
  if (filters.status) where.status = normalizeDealListStatus(filters.status);
  if (filters.stageId) where.stageId = filters.stageId;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.personId) where.personId = filters.personId;
  if (filters.organizationId) where.organizationId = filters.organizationId;
  applyDealFollowUpFilter(where, workspaceId, filters.followUp);
  applyDealCommercialFilter(where, workspaceId, filters.commercial);
  if (customFieldEntityIds) where.id = { in: customFieldEntityIds };
  return where;
}

function normalizeDealListStatus(value: unknown): NonNullable<DealListFilters["status"]> {
  if (value === "OPEN" || value === "WON" || value === "LOST") return value;
  throw new ApiError("VALIDATION_ERROR", "Deal status filter must be OPEN, WON, or LOST.", 422);
}

function applyDealFollowUpFilter(
  where: Prisma.DealWhereInput,
  workspaceId: string,
  followUp: DealListFilters["followUp"]
) {
  if (!followUp) return;
  const normalizedFollowUp = normalizeDealFollowUpFilter(followUp);

  where.status = "OPEN";
  if (normalizedFollowUp === "missing") {
    where.activities = { none: { workspaceId, completedAt: null, ...activeWhere, ...activityAttachmentRelationsWhere(workspaceId) } };
    return;
  }

  const dueAt = activityDueFilter(normalizedFollowUp);
  where.activities = {
    some: {
      workspaceId,
      completedAt: null,
      dueAt,
      ...activeWhere,
      ...activityAttachmentRelationsWhere(workspaceId)
    }
  };
}

function normalizeDealFollowUpFilter(value: unknown): NonNullable<DealListFilters["followUp"]> {
  if (value === "missing" || value === "overdue" || value === "today" || value === "upcoming" || value === "unscheduled") {
    return value;
  }
  throw new ApiError("VALIDATION_ERROR", "Deal follow-up filter must be missing, overdue, today, upcoming, or unscheduled.", 422);
}

function applyDealCommercialFilter(
  where: Prisma.DealWhereInput,
  workspaceId: string,
  commercial: DealListFilters["commercial"]
) {
  if (!commercial) return;
  const normalizedCommercial = normalizeDealCommercialFilter(commercial);

  if (normalizedCommercial === "noQuote") {
    where.status = "OPEN";
    where.quotes = { none: { workspaceId } };
    return;
  }
  if (normalizedCommercial === "hasQuote") {
    where.quotes = { some: { workspaceId } };
    return;
  }
  if (normalizedCommercial === "acceptedQuote") {
    where.quotes = { some: { workspaceId, status: "ACCEPTED" } };
    return;
  }
  if (normalizedCommercial === "valueNoLineItems") {
    where.status = "OPEN";
    where.valueCents = { gt: 0 };
    where.lineItems = { none: { workspaceId } };
  }
}

function normalizeDealCommercialFilter(value: unknown): NonNullable<DealListFilters["commercial"]> {
  if (value === "noQuote" || value === "hasQuote" || value === "acceptedQuote" || value === "valueNoLineItems") {
    return value;
  }
  throw new ApiError(
    "VALIDATION_ERROR",
    "Deal commercial filter must be noQuote, hasQuote, acceptedQuote, or valueNoLineItems.",
    422
  );
}

function dealOrderBy(filters: DealListFilters): Prisma.DealOrderByWithRelationInput {
  const direction = normalizeDealSortDirection(filters.sortDirection);
  const sortBy = normalizeDealSortBy(filters.sortBy);
  if (sortBy === "createdAt") return { createdAt: direction };
  if (sortBy === "title") return { title: direction };
  if (sortBy === "valueCents") return { valueCents: direction };
  if (sortBy === "expectedCloseAt") return { expectedCloseAt: direction };
  return { updatedAt: direction };
}

function normalizeDealSortBy(value: unknown): NonNullable<DealListFilters["sortBy"]> {
  if (value === undefined) return "updatedAt";
  if (
    value === "createdAt" ||
    value === "updatedAt" ||
    value === "title" ||
    value === "valueCents" ||
    value === "expectedCloseAt"
  ) {
    return value;
  }
  throw new ApiError(
    "VALIDATION_ERROR",
    "Deal sort field must be createdAt, updatedAt, title, valueCents, or expectedCloseAt.",
    422
  );
}

function normalizeDealSortDirection(value: unknown): NonNullable<DealListFilters["sortDirection"]> {
  if (value === undefined) return "desc";
  if (value === "asc" || value === "desc") return value;
  throw new ApiError("VALIDATION_ERROR", "Deal sort direction must be asc or desc.", 422);
}

function activityDueFilter(followUp: Exclude<DealListFilters["followUp"], undefined | "missing">) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (followUp === "overdue") return { lt: today };
  if (followUp === "today") return { gte: today, lt: tomorrow };
  if (followUp === "upcoming") return { gte: tomorrow };
  return null;
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
          where: { workspaceId: actor.workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(actor.workspaceId) },
          include: { owner: { select: userDisplaySelect }, lead: true, person: true, organization: true },
          orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }]
        },
        lineItems: {
          where: { workspaceId: actor.workspaceId },
          include: { product: true },
          orderBy: [{ createdAt: "asc" }, { productName: "asc" }]
        },
        quotes: {
          where: { workspaceId: actor.workspaceId },
          include: {
            items: {
              where: { workspaceId: actor.workspaceId },
              orderBy: [{ createdAt: "asc" }, { name: "asc" }]
            }
          },
          orderBy: { createdAt: "desc" }
        },
        notes: {
          where: { workspaceId: actor.workspaceId, ...activeWhere, ...noteAttachmentRelationsWhere(actor.workspaceId) },
          include: { author: { select: userDisplaySelect } },
          orderBy: { createdAt: "desc" }
        }
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
  const scopedDeal = scopeDealRelations(actor.workspaceId, deal);
  return {
    ...scopedDeal,
    activities: scopedDeal.activities.map((activity) => scopeDealActivityRelations(actor.workspaceId, activity)),
    auditLogs
  };
}

function scopeDealRelations<T extends { person: WorkspaceScopedRelation; organization: WorkspaceScopedRelation }>(
  workspaceId: string,
  deal: T
) {
  return {
    ...deal,
    person: scopeWorkspaceRelation(workspaceId, deal.person),
    organization: scopeWorkspaceRelation(workspaceId, deal.organization)
  };
}

function scopeDealActivityRelations<
  T extends {
    lead: WorkspaceScopedRelation;
    person: WorkspaceScopedRelation;
    organization: WorkspaceScopedRelation;
  }
>(workspaceId: string, activity: T) {
  return {
    ...activity,
    lead: scopeWorkspaceRelation(workspaceId, activity.lead),
    person: scopeWorkspaceRelation(workspaceId, activity.person),
    organization: scopeWorkspaceRelation(workspaceId, activity.organization)
  };
}

export async function createDeal(actor: WorkspaceActor, data: CreateDealInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeCreateDealInput(data);
  await assertDealPipelineAndStage(actor.workspaceId, normalized.pipelineId, normalized.stageId);
  await assertDealLinks(actor.workspaceId, normalized);
  const deal = await prisma.deal.create({ data: { ...normalized, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "deal.created", "Deal", deal.id, { title: deal.title });
  return deal;
}

export async function updateDeal(actor: WorkspaceActor, dealId: string, data: UpdateDealInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("deal", actor.workspaceId, dealId);
  const normalized = normalizeUpdateDealInput(data);
  const existing = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { stage: true }
  });

  if (existing.status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }

  if (typeof normalized.status === "string" && normalized.status !== "OPEN") {
    throw new ApiError("USE_DEAL_CLOSE_FLOW", "Use the close deal action to mark a deal won or lost.", 422);
  }

  if (typeof normalized.pipelineId === "string" || typeof normalized.stageId === "string") {
    const nextPipelineId = typeof normalized.pipelineId === "string" ? normalized.pipelineId : existing.pipelineId;
    const nextStageId = typeof normalized.stageId === "string" ? normalized.stageId : existing.stageId;

    if (nextPipelineId !== existing.pipelineId) {
      throw new ApiError("INVALID_PIPELINE_MOVE", "Move the deal within its current pipeline.", 422);
    }

    await assertDealPipelineAndStage(
      actor.workspaceId,
      existing.pipelineId,
      nextStageId
    );
  }
  await assertDealLinks(actor.workspaceId, normalized);
  if (Object.keys(normalized).length === 0 || !dealUpdateChanges(normalized, existing)) {
    return existing;
  }

  const deal = await prisma.deal.update({ where: { id: dealId }, data: normalized });
  const stageChanged = typeof normalized.stageId === "string" && normalized.stageId !== existing.stageId;
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
  const status = normalizeCloseDealStatus(data.status);
  const lostReason = normalizeCloseDealLostReason(data.lostReason, status);

  const outcomeAt = new Date();
  const deal = await prisma.deal.update({
    where: { id: dealId },
    data:
      status === "WON"
        ? { status, wonAt: outcomeAt, lostAt: null }
        : { status, wonAt: null, lostAt: outcomeAt }
  });
  await writeAuditLog(actor, status === "WON" ? "deal.won" : "deal.lost", "Deal", deal.id, {
    previousStatus: existing.status,
    nextStatus: deal.status,
    pipelineId: existing.pipelineId,
    stageId: existing.stageId,
    lostReason
  });
  return deal;
}

function normalizeCloseDealStatus(value: unknown): CloseDealInput["status"] {
  if (value === "WON" || value === "LOST") return value;
  throw new ApiError("VALIDATION_ERROR", "Deal close status must be WON or LOST.", 422);
}

function dealUpdateChanges(
  input: ReturnType<typeof normalizeUpdateDealInput>,
  existing: {
    pipelineId: string;
    stageId: string;
    ownerId: string | null;
    personId: string | null;
    organizationId: string | null;
    title: string;
    valueCents: number | null;
    currency: string;
    status: DealStatus;
    expectedCloseAt: Date | null;
  }
) {
  if (input.pipelineId !== undefined && input.pipelineId !== existing.pipelineId) return true;
  if (input.stageId !== undefined && input.stageId !== existing.stageId) return true;
  if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) return true;
  if (input.personId !== undefined && input.personId !== existing.personId) return true;
  if (input.organizationId !== undefined && input.organizationId !== existing.organizationId) return true;
  if (input.title !== undefined && input.title !== existing.title) return true;
  if (input.valueCents !== undefined && input.valueCents !== existing.valueCents) return true;
  if (input.currency !== undefined && input.currency !== existing.currency) return true;
  if (input.status !== undefined && input.status !== existing.status) return true;
  if (input.expectedCloseAt !== undefined && input.expectedCloseAt?.getTime() !== existing.expectedCloseAt?.getTime()) {
    return true;
  }
  return false;
}

function normalizeCloseDealLostReason(value: unknown, status: CloseDealInput["status"]) {
  if (status !== "LOST") return undefined;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Deal lost reason must be text.", 422);
  }
  return value.trim() || null;
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
  const existing = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId: actor.workspaceId, deletedAt: null },
    select: { id: true, status: true }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  if (existing.status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }

  await prisma.deal.update({ where: { id: dealId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "deal.deleted", "Deal", dealId);
}

function normalizeCreateDealInput(data: unknown) {
  const input = objectInput(data);
  return omitUndefined({
    pipelineId: normalizeRequiredDealId(input.pipelineId, "Deal pipeline is required."),
    stageId: normalizeRequiredDealId(input.stageId, "Deal stage is required."),
    ownerId: normalizeOptionalDealId(input.ownerId),
    personId: normalizeOptionalDealId(input.personId),
    organizationId: normalizeOptionalDealId(input.organizationId),
    title: normalizeRequiredDealText(input.title, "Deal title is required."),
    valueCents: normalizeOptionalDealValue(input.valueCents),
    currency: normalizeOptionalDealCurrency(input.currency),
    status: hasInputKey(input, "status") ? normalizeDealStatus(input.status) : undefined,
    expectedCloseAt: normalizeNullableDateValue(input.expectedCloseAt, "Deal expected close date is invalid."),
    wonAt: normalizeNullableDateValue(input.wonAt, "Deal won date is invalid."),
    lostAt: normalizeNullableDateValue(input.lostAt, "Deal lost date is invalid.")
  });
}

function normalizeUpdateDealInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Deal update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    pipelineId: hasInputKey(input, "pipelineId")
      ? normalizeRequiredDealId(input.pipelineId, "Deal pipeline is required.")
      : undefined,
    stageId: hasInputKey(input, "stageId") ? normalizeRequiredDealId(input.stageId, "Deal stage is required.") : undefined,
    ownerId: hasInputKey(input, "ownerId") ? normalizeOptionalDealId(input.ownerId) : undefined,
    personId: hasInputKey(input, "personId") ? normalizeOptionalDealId(input.personId) : undefined,
    organizationId: hasInputKey(input, "organizationId") ? normalizeOptionalDealId(input.organizationId) : undefined,
    title: hasInputKey(input, "title") ? normalizeRequiredDealText(input.title, "Deal title is required.") : undefined,
    valueCents: hasInputKey(input, "valueCents") ? normalizeOptionalDealValue(input.valueCents) : undefined,
    currency: hasInputKey(input, "currency") ? normalizeOptionalDealCurrency(input.currency) : undefined,
    status: hasInputKey(input, "status") ? normalizeDealStatus(input.status) : undefined,
    expectedCloseAt: hasInputKey(input, "expectedCloseAt")
      ? normalizeNullableDateValue(input.expectedCloseAt, "Deal expected close date is invalid.")
      : undefined
  });
}

function normalizeRequiredDealId(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalDealId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Deal relation ids must be text.", 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRequiredDealText(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalDealValue(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ApiError("VALIDATION_ERROR", "Deal value must be a non-negative integer.", 422);
  }
  return value;
}

function normalizeOptionalDealCurrency(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Deal currency must be a three-letter code.", 422);
  }
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    throw new ApiError("VALIDATION_ERROR", "Deal currency must be a three-letter code.", 422);
  }
  return trimmed;
}

function normalizeDealStatus(value: unknown): DealStatus {
  if (value === "OPEN" || value === "WON" || value === "LOST") return value;
  throw new ApiError("VALIDATION_ERROR", "Deal status must be OPEN, WON, or LOST.", 422);
}

function normalizeNullableDateValue(input: unknown, message: string) {
  const value = extractNullableDateValue(input);
  if (value === undefined || value === null) return value;
  const date = value instanceof Date || typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  return date;
}

function extractNullableDateValue(input: unknown) {
  if (input === undefined || input === null) return input;
  if (typeof input === "object" && "set" in input) {
    return (input as { set?: unknown }).set;
  }
  return input;
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
