import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { listCustomFieldFilteredEntityIds, type CustomFieldListFilters } from "./custom-field-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertDealPipelineAndStage, assertRecordInWorkspace, assertUserInWorkspace } from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreateLeadInput = Omit<Prisma.LeadUncheckedCreateInput, "workspaceId">;
export type LeadListFilters = CustomFieldListFilters & {
  q?: string;
  status?: "NEW" | "QUALIFIED" | "DISQUALIFIED" | "CONVERTED";
  source?: string;
  ownerId?: string;
  sortBy?: "createdAt" | "updatedAt" | "title";
  sortDirection?: "asc" | "desc";
};
type ConvertLeadInput = {
  pipelineId: string;
  stageId: string;
  title?: string | null;
};

export async function listLeads(actor: WorkspaceActor, filters: LeadListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "LEAD", filters);
  const where = leadWhere(actor.workspaceId, filters, customFieldEntityIds);

  return prisma.lead.findMany({
    where,
    include: leadInclude,
    orderBy: leadOrderBy(filters)
  });
}

export async function listLeadsPage(actor: WorkspaceActor, filters: LeadListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "LEAD", filters);
  const where = leadWhere(actor.workspaceId, filters, customFieldEntityIds);
  const total = await prisma.lead.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.lead.findMany({
    where,
    include: leadInclude,
    orderBy: leadOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items };
}

const leadInclude = { person: true, organization: true, owner: { select: userDisplaySelect } } satisfies Prisma.LeadInclude;

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
      { person: { is: { firstName: { contains: filters.q, mode: "insensitive" } } } },
      { person: { is: { lastName: { contains: filters.q, mode: "insensitive" } } } },
      { person: { is: { email: { contains: filters.q, mode: "insensitive" } } } },
      { organization: { is: { name: { contains: filters.q, mode: "insensitive" } } } }
    ];
  }
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (customFieldEntityIds) where.id = { in: customFieldEntityIds };
  return where;
}

function leadOrderBy(filters: LeadListFilters): Prisma.LeadOrderByWithRelationInput {
  const direction = filters.sortDirection ?? "desc";
  if (filters.sortBy === "createdAt") return { createdAt: direction };
  if (filters.sortBy === "title") return { title: direction };
  return { updatedAt: direction };
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
          where: activeWhere,
          include: { owner: { select: userDisplaySelect }, deal: true, person: true, organization: true },
          orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }]
        },
        notes: { where: activeWhere, include: { author: { select: userDisplaySelect } }, orderBy: { createdAt: "desc" } }
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
  return { ...lead, auditLogs };
}

export async function createLead(actor: WorkspaceActor, data: CreateLeadInput) {
  await ensureWorkspaceAccess(actor);
  if (data.status === "CONVERTED") {
    throw new ApiError("INVALID_LEAD_STATUS", "Use lead conversion to mark a lead converted.", 422);
  }
  if (data.ownerId) await assertUserInWorkspace(actor.workspaceId, data.ownerId);
  if (data.personId) await assertRecordInWorkspace("person", actor.workspaceId, data.personId);
  if (data.organizationId) await assertRecordInWorkspace("organization", actor.workspaceId, data.organizationId);
  const lead = await prisma.lead.create({ data: { ...data, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "lead.created", "Lead", lead.id, { title: lead.title });
  return lead;
}

export async function updateLead(actor: WorkspaceActor, leadId: string, data: Prisma.LeadUncheckedUpdateInput) {
  await ensureWorkspaceAccess(actor);
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId: actor.workspaceId, deletedAt: null },
    select: { id: true, status: true }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Lead was not found.", 404);
  if (existing.status === "CONVERTED") {
    throw new ApiError("LEAD_LOCKED", "Converted leads cannot be edited.", 409);
  }
  if (data.status === "CONVERTED") {
    throw new ApiError("INVALID_LEAD_STATUS", "Use lead conversion to mark a lead converted.", 422);
  }
  if (typeof data.ownerId === "string") await assertUserInWorkspace(actor.workspaceId, data.ownerId);
  if (typeof data.personId === "string") await assertRecordInWorkspace("person", actor.workspaceId, data.personId);
  if (typeof data.organizationId === "string") await assertRecordInWorkspace("organization", actor.workspaceId, data.organizationId);

  const lead = await prisma.lead.update({ where: { id: leadId }, data });
  await writeAuditLog(actor, "lead.updated", "Lead", lead.id);
  return lead;
}

export async function convertLeadToDeal(actor: WorkspaceActor, leadId: string, data: ConvertLeadInput) {
  await ensureWorkspaceAccess(actor);
  await assertDealPipelineAndStage(actor.workspaceId, data.pipelineId, data.stageId);

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

    const deal = await tx.deal.create({
      data: {
        workspaceId: actor.workspaceId,
        pipelineId: data.pipelineId,
        stageId: data.stageId,
        ownerId: lead.ownerId,
        personId: lead.personId,
        organizationId: lead.organizationId,
        title: data.title?.trim() || lead.title,
        currency: "USD",
        status: "OPEN"
      }
    });

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: "CONVERTED" }
    });

    const [activities, notes] = await Promise.all([
      tx.activity.updateMany({
        where: { workspaceId: actor.workspaceId, leadId: lead.id, deletedAt: null },
        data: { leadId: null, dealId: deal.id }
      }),
      tx.note.updateMany({
        where: { workspaceId: actor.workspaceId, leadId: lead.id, deletedAt: null },
        data: { leadId: null, dealId: deal.id }
      })
    ]);

    const metadata = {
      leadId: lead.id,
      dealId: deal.id,
      leadSource: lead.source,
      reattachedActivities: activities.count,
      reattachedNotes: notes.count
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
