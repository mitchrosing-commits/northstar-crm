import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { listCustomFieldFilteredEntityIds, type CustomFieldListFilters } from "./custom-field-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertRecordInWorkspace, assertUserInWorkspace } from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreateOrganizationInput = Omit<Prisma.OrganizationUncheckedCreateInput, "workspaceId">;
export type OrganizationListFilters = CustomFieldListFilters & {
  q?: string;
  ownerId?: string;
  sortBy?: "createdAt" | "updatedAt" | "name";
  sortDirection?: "asc" | "desc";
};

export async function listOrganizations(actor: WorkspaceActor, filters: OrganizationListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "ORGANIZATION", filters);
  const where = organizationWhere(actor.workspaceId, filters, customFieldEntityIds);

  return prisma.organization.findMany({
    where,
    include: organizationInclude,
    orderBy: organizationOrderBy(filters)
  });
}

export async function listOrganizationsPage(actor: WorkspaceActor, filters: OrganizationListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "ORGANIZATION", filters);
  const where = organizationWhere(actor.workspaceId, filters, customFieldEntityIds);
  const total = await prisma.organization.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.organization.findMany({
    where,
    include: organizationInclude,
    orderBy: organizationOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items };
}

const organizationInclude = {
  owner: { select: userDisplaySelect },
  _count: { select: { people: true, deals: true } }
} satisfies Prisma.OrganizationInclude;

function organizationWhere(
  workspaceId: string,
  filters: OrganizationListFilters,
  customFieldEntityIds?: string[]
): Prisma.OrganizationWhereInput {
  const where: Prisma.OrganizationWhereInput = { workspaceId, ...activeWhere };
  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { domain: { contains: filters.q, mode: "insensitive" } }
    ];
  }
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (customFieldEntityIds) where.id = { in: customFieldEntityIds };
  return where;
}

function organizationOrderBy(filters: OrganizationListFilters): Prisma.OrganizationOrderByWithRelationInput {
  const direction = filters.sortDirection ?? "asc";
  if (filters.sortBy === "createdAt") return { createdAt: direction };
  if (filters.sortBy === "updatedAt") return { updatedAt: direction };
  return { name: direction };
}

export async function getOrganization(actor: WorkspaceActor, organizationId: string) {
  await ensureWorkspaceAccess(actor);
  const [organization, auditLogs] = await prisma.$transaction([
    prisma.organization.findFirst({
      where: { id: organizationId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        owner: { select: userDisplaySelect },
        people: { where: activeWhere, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
        deals: { where: activeWhere, orderBy: { updatedAt: "desc" } },
        activities: { where: activeWhere, orderBy: { dueAt: "asc" } },
        notes: { where: activeWhere, include: { author: { select: userDisplaySelect } }, orderBy: { createdAt: "desc" } }
      }
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: "Organization", entityId: organizationId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 25
    })
  ]);
  if (!organization) throw new ApiError("NOT_FOUND", "Organization was not found.", 404);
  return { ...organization, auditLogs };
}

export async function createOrganization(actor: WorkspaceActor, data: CreateOrganizationInput) {
  await ensureWorkspaceAccess(actor);
  if (data.ownerId) await assertUserInWorkspace(actor.workspaceId, data.ownerId);
  const organization = await prisma.organization.create({ data: { ...data, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "organization.created", "Organization", organization.id, { name: organization.name });
  return organization;
}

export async function updateOrganization(actor: WorkspaceActor, organizationId: string, data: Prisma.OrganizationUncheckedUpdateInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("organization", actor.workspaceId, organizationId);
  if (typeof data.ownerId === "string") await assertUserInWorkspace(actor.workspaceId, data.ownerId);
  const organization = await prisma.organization.update({ where: { id: organizationId }, data });
  await writeAuditLog(actor, "organization.updated", "Organization", organization.id);
  return organization;
}

export async function softDeleteOrganization(actor: WorkspaceActor, organizationId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("organization", actor.workspaceId, organizationId);
  await prisma.organization.update({ where: { id: organizationId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "organization.deleted", "Organization", organizationId);
}
