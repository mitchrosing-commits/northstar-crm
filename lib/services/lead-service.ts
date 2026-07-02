import { Prisma, type LeadStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { startOfDay } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { listCustomFieldFilteredEntityIds, type CustomFieldListFilters } from "./custom-field-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import {
  activityAttachmentRelationsWhere,
  assertDealPipelineAndStage,
  assertRecordInWorkspace,
  assertUserInWorkspace,
  emailLogAttachmentRelationsWhere,
  noteAttachmentRelationsWhere
} from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { userDisplaySelect } from "./user-select";

type CreateLeadInput = {
  ownerId?: unknown;
  personId?: unknown;
  organizationId?: unknown;
  title: unknown;
  source?: unknown;
  status?: unknown;
};
type UpdateLeadInput = Partial<CreateLeadInput>;
export type LeadListFilters = CustomFieldListFilters & {
  q?: string;
  status?: "NEW" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED";
  source?: string;
  ownerId?: string;
  followUp?: "missing" | "overdue" | "today" | "upcoming" | "unscheduled";
  sortBy?: "createdAt" | "updatedAt" | "title";
  sortDirection?: "asc" | "desc";
};
type ConvertLeadInput = {
  pipelineId: unknown;
  stageId: unknown;
  title?: unknown;
};

export async function listLeads(actor: WorkspaceActor, filters: LeadListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "LEAD", filters);
  const where = leadWhere(actor.workspaceId, filters, customFieldEntityIds);

  const leads = await prisma.lead.findMany({
    where,
    include: leadInclude(actor.workspaceId),
    orderBy: leadOrderBy(filters)
  });

  return leads.map((lead) => scopeLeadRelations(actor.workspaceId, lead));
}

export async function listLeadsPage(actor: WorkspaceActor, filters: LeadListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "LEAD", filters);
  const where = leadWhere(actor.workspaceId, filters, customFieldEntityIds);
  const total = await prisma.lead.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.lead.findMany({
    where,
    include: leadInclude(actor.workspaceId),
    orderBy: leadOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items: items.map((lead) => scopeLeadRelations(actor.workspaceId, lead)) };
}

const leadInclude = (workspaceId: string) => ({
  person: true,
  organization: true,
  owner: { select: userDisplaySelect },
  activities: {
    where: { workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(workspaceId), completedAt: null },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 1
  }
}) satisfies Prisma.LeadInclude;

function leadWhere(
  workspaceId: string,
  filters: LeadListFilters,
  customFieldEntityIds?: string[]
): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { workspaceId, ...activeWhere };
  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: "insensitive" } },
      { source: { contains: filters.q, mode: "insensitive" } },
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
  if (filters.status) where.status = normalizeLeadListStatus(filters.status);
  if (filters.source) where.source = filters.source;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  applyLeadFollowUpFilter(where, workspaceId, filters.followUp);
  if (customFieldEntityIds) where.id = { in: customFieldEntityIds };
  return where;
}

function normalizeLeadListStatus(value: unknown): NonNullable<LeadListFilters["status"]> {
  if (value === "NEW" || value === "QUALIFIED" || value === "DISQUALIFIED" || value === "CONVERTED") return value;
  throw new ApiError("VALIDATION_ERROR", "Lead status filter must be NEW, QUALIFIED, DISQUALIFIED, or CONVERTED.", 422);
}

function applyLeadFollowUpFilter(
  where: Prisma.LeadWhereInput,
  workspaceId: string,
  followUp: LeadListFilters["followUp"]
) {
  if (!followUp) return;
  const normalizedFollowUp = normalizeLeadFollowUpFilter(followUp);

  where.status = { in: ["NEW", "QUALIFIED"] };
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

function normalizeLeadFollowUpFilter(value: unknown): NonNullable<LeadListFilters["followUp"]> {
  if (value === "missing" || value === "overdue" || value === "today" || value === "upcoming" || value === "unscheduled") {
    return value;
  }
  throw new ApiError("VALIDATION_ERROR", "Lead follow-up filter must be missing, overdue, today, upcoming, or unscheduled.", 422);
}

function leadOrderBy(filters: LeadListFilters): Prisma.LeadOrderByWithRelationInput {
  const direction = normalizeLeadSortDirection(filters.sortDirection);
  const sortBy = normalizeLeadSortBy(filters.sortBy);
  if (sortBy === "createdAt") return { createdAt: direction };
  if (sortBy === "title") return { title: direction };
  return { updatedAt: direction };
}

function normalizeLeadSortBy(value: unknown): NonNullable<LeadListFilters["sortBy"]> {
  if (value === undefined) return "updatedAt";
  if (value === "createdAt" || value === "updatedAt" || value === "title") return value;
  throw new ApiError("VALIDATION_ERROR", "Lead sort field must be createdAt, updatedAt, or title.", 422);
}

function normalizeLeadSortDirection(value: unknown): NonNullable<LeadListFilters["sortDirection"]> {
  if (value === undefined) return "desc";
  if (value === "asc" || value === "desc") return value;
  throw new ApiError("VALIDATION_ERROR", "Lead sort direction must be asc or desc.", 422);
}

function activityDueFilter(followUp: Exclude<LeadListFilters["followUp"], undefined | "missing">) {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (followUp === "overdue") return { lt: today };
  if (followUp === "today") return { gte: today, lt: tomorrow };
  if (followUp === "upcoming") return { gte: tomorrow };
  return null;
}

export async function getLead(actor: WorkspaceActor, leadId: string) {
  await ensureWorkspaceAccess(actor);
  const [lead, auditLogs] = await prisma.$transaction([
    prisma.lead.findFirst({
      where: { id: leadId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        person: true,
        organization: true,
        owner: { select: userDisplaySelect },
        activities: {
          where: { workspaceId: actor.workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(actor.workspaceId) },
          include: { owner: { select: userDisplaySelect }, deal: true, person: true, organization: true },
          orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }]
        },
        notes: {
          where: { workspaceId: actor.workspaceId, ...activeWhere, ...noteAttachmentRelationsWhere(actor.workspaceId) },
          include: { author: { select: userDisplaySelect } },
          orderBy: { createdAt: "desc" }
        }
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: "Lead", entityId: leadId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 25
    })
  ]);
  if (!lead) throw new ApiError("NOT_FOUND", "Lead was not found.", 404);
  const scopedLead = scopeLeadRelations(actor.workspaceId, lead);
  return {
    ...scopedLead,
    activities: scopedLead.activities.map((activity) => scopeLeadActivityRelations(actor.workspaceId, activity)),
    auditLogs
  };
}

function scopeLeadRelations<T extends { person: WorkspaceScopedRelation; organization: WorkspaceScopedRelation }>(
  workspaceId: string,
  lead: T
) {
  return {
    ...lead,
    person: scopeWorkspaceRelation(workspaceId, lead.person),
    organization: scopeWorkspaceRelation(workspaceId, lead.organization)
  };
}

function scopeLeadActivityRelations<
  T extends {
    deal: WorkspaceScopedRelation;
    person: WorkspaceScopedRelation;
    organization: WorkspaceScopedRelation;
  }
>(workspaceId: string, activity: T) {
  return {
    ...activity,
    deal: scopeWorkspaceRelation(workspaceId, activity.deal),
    person: scopeWorkspaceRelation(workspaceId, activity.person),
    organization: scopeWorkspaceRelation(workspaceId, activity.organization)
  };
}

export async function createLead(actor: WorkspaceActor, data: CreateLeadInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeCreateLeadInput(data);
  if (normalized.ownerId) await assertUserInWorkspace(actor.workspaceId, normalized.ownerId);
  if (normalized.personId) await assertRecordInWorkspace("person", actor.workspaceId, normalized.personId);
  if (normalized.organizationId) await assertRecordInWorkspace("organization", actor.workspaceId, normalized.organizationId);
  const lead = await prisma.lead.create({ data: { ...normalized, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "lead.created", "Lead", lead.id, { title: lead.title });
  return lead;
}

export async function updateLead(actor: WorkspaceActor, leadId: string, data: UpdateLeadInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeUpdateLeadInput(data);
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId: actor.workspaceId, deletedAt: null }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Lead was not found.", 404);
  if (existing.status === "CONVERTED") {
    throw new ApiError("LEAD_LOCKED", "Converted leads cannot be edited.", 409);
  }
  if (normalized.ownerId) await assertUserInWorkspace(actor.workspaceId, normalized.ownerId);
  if (normalized.personId) await assertRecordInWorkspace("person", actor.workspaceId, normalized.personId);
  if (normalized.organizationId) await assertRecordInWorkspace("organization", actor.workspaceId, normalized.organizationId);
  if (Object.keys(normalized).length === 0 || !leadUpdateChanges(normalized, existing)) {
    return existing;
  }

  const lead = await prisma.lead.update({ where: { id: leadId }, data: normalized });
  await writeAuditLog(actor, "lead.updated", "Lead", lead.id);
  return lead;
}

function normalizeCreateLeadInput(data: unknown) {
  const input = objectInput(data);
  return omitUndefined({
    ownerId: normalizeOptionalLeadId(input.ownerId),
    personId: normalizeOptionalLeadId(input.personId),
    organizationId: normalizeOptionalLeadId(input.organizationId),
    title: normalizeRequiredLeadText(input.title, "Lead title is required."),
    source: normalizeOptionalLeadText(input.source, "Lead source must be text."),
    status: hasInputKey(input, "status") ? normalizeEditableLeadStatus(input.status) : undefined
  });
}

function normalizeUpdateLeadInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Lead update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    ownerId: hasInputKey(input, "ownerId") ? normalizeOptionalLeadId(input.ownerId) : undefined,
    personId: hasInputKey(input, "personId") ? normalizeOptionalLeadId(input.personId) : undefined,
    organizationId: hasInputKey(input, "organizationId") ? normalizeOptionalLeadId(input.organizationId) : undefined,
    title: hasInputKey(input, "title") ? normalizeRequiredLeadText(input.title, "Lead title is required.") : undefined,
    source: hasInputKey(input, "source") ? normalizeOptionalLeadText(input.source, "Lead source must be text.") : undefined,
    status: hasInputKey(input, "status") ? normalizeEditableLeadStatus(input.status) : undefined
  });
}

function normalizeEditableLeadStatus(value: unknown): Exclude<LeadStatus, "CONVERTED"> | undefined {
  if (value === undefined) return undefined;
  if (value === "NEW" || value === "QUALIFIED" || value === "DISQUALIFIED") return value;
  if (value === "CONVERTED") {
    throw new ApiError("INVALID_LEAD_STATUS", "Use lead conversion to mark a lead converted.", 422);
  }
  throw new ApiError("VALIDATION_ERROR", "Lead status must be NEW, QUALIFIED, or DISQUALIFIED.", 422);
}

function leadUpdateChanges(
  input: ReturnType<typeof normalizeUpdateLeadInput>,
  existing: {
    ownerId: string | null;
    personId: string | null;
    organizationId: string | null;
    title: string;
    source: string | null;
    status: LeadStatus;
  }
) {
  if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) return true;
  if (input.personId !== undefined && input.personId !== existing.personId) return true;
  if (input.organizationId !== undefined && input.organizationId !== existing.organizationId) return true;
  if (input.title !== undefined && input.title !== existing.title) return true;
  if (input.source !== undefined && input.source !== existing.source) return true;
  if (input.status !== undefined && input.status !== existing.status) return true;
  return false;
}

export async function convertLeadToDeal(actor: WorkspaceActor, leadId: string, data: ConvertLeadInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeConvertLeadInput(data);
  await assertDealPipelineAndStage(actor.workspaceId, normalized.pipelineId, normalized.stageId);

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, workspaceId: actor.workspaceId, deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        personId: true,
        organizationId: true,
        title: true,
        source: true,
        status: true
      }
    });

    if (!lead) throw new ApiError("NOT_FOUND", "Lead was not found.", 404);
    if (lead.status === "CONVERTED") {
      throw new ApiError("LEAD_ALREADY_CONVERTED", "This lead has already been converted.", 409);
    }

    const conversionClaim = await tx.lead.updateMany({
      where: {
        id: lead.id,
        workspaceId: actor.workspaceId,
        deletedAt: null,
        status: { not: "CONVERTED" }
      },
      data: { status: "CONVERTED" }
    });
    if (conversionClaim.count !== 1) {
      throw new ApiError("LEAD_ALREADY_CONVERTED", "This lead has already been converted.", 409);
    }

    const deal = await tx.deal.create({
      data: {
        workspaceId: actor.workspaceId,
        pipelineId: normalized.pipelineId,
        stageId: normalized.stageId,
        ownerId: lead.ownerId,
        personId: lead.personId,
        organizationId: lead.organizationId,
        title: normalized.title || lead.title,
        currency: "USD",
        status: "OPEN"
      }
    });

    const [activities, notes, emailLogs] = await Promise.all([
      tx.activity.updateMany({
        where: {
          workspaceId: actor.workspaceId,
          leadId: lead.id,
          deletedAt: null,
          ...activityAttachmentRelationsWhere(actor.workspaceId)
        },
        data: { leadId: null, dealId: deal.id }
      }),
      tx.note.updateMany({
        where: {
          workspaceId: actor.workspaceId,
          leadId: lead.id,
          deletedAt: null,
          ...noteAttachmentRelationsWhere(actor.workspaceId)
        },
        data: { leadId: null, dealId: deal.id }
      }),
      tx.emailLog.updateMany({
        where: {
          workspaceId: actor.workspaceId,
          leadId: lead.id,
          ...emailLogAttachmentRelationsWhere(actor.workspaceId)
        },
        data: { leadId: null, dealId: deal.id }
      })
    ]);

    const metadata = {
      leadId: lead.id,
      dealId: deal.id,
      leadSource: lead.source,
      reattachedActivities: activities.count,
      reattachedNotes: notes.count,
      reattachedEmailLogs: emailLogs.count
    };

    await tx.auditLog.createMany({
      data: [
        {
          workspaceId: actor.workspaceId,
          actorId: actor.actorUserId,
          action: "lead.converted",
          entityType: "Lead",
          entityId: lead.id,
          metadata
        },
        {
          workspaceId: actor.workspaceId,
          actorId: actor.actorUserId,
          action: "deal.created_from_lead",
          entityType: "Deal",
          entityId: deal.id,
          metadata
        }
      ]
    });

    return deal;
  });
}

function normalizeConvertLeadInput(data: unknown) {
  const input = objectInput(data);
  return omitUndefined({
    pipelineId: normalizeRequiredLeadId(input.pipelineId, "Lead conversion pipeline is required."),
    stageId: normalizeRequiredLeadId(input.stageId, "Lead conversion stage is required."),
    title: normalizeConvertedDealTitle(input.title)
  });
}

function normalizeConvertedDealTitle(title: unknown) {
  if (title === undefined || title === null) return undefined;
  if (typeof title !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Converted deal title must be text.", 422);
  }
  return title.trim() || undefined;
}

function normalizeRequiredLeadId(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalLeadId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Lead relation ids must be text.", 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRequiredLeadText(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalLeadText(value: unknown, message: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
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
