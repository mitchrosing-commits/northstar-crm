import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { listCustomFieldFilteredEntityIds, type CustomFieldListFilters } from "./custom-field-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import {
  activityAttachmentRelationsWhere,
  assertRecordInWorkspace,
  assertUserInWorkspace,
  noteAttachmentRelationsWhere
} from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreateOrganizationInput = {
  ownerId?: unknown;
  name: unknown;
  domain?: unknown;
};
type UpdateOrganizationInput = Partial<CreateOrganizationInput>;
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
    include: organizationInclude(actor.workspaceId),
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
    include: organizationInclude(actor.workspaceId),
    orderBy: organizationOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items };
}

const organizationInclude = (workspaceId: string) => ({
  owner: { select: userDisplaySelect },
  activities: {
    where: { workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(workspaceId), completedAt: null },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 1
  },
  _count: {
    select: {
      people: { where: { workspaceId, ...activeWhere } },
      deals: { where: { workspaceId, ...activeWhere } }
    }
  }
}) satisfies Prisma.OrganizationInclude;

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
  const direction = normalizeOrganizationSortDirection(filters.sortDirection);
  const sortBy = normalizeOrganizationSortBy(filters.sortBy);
  if (sortBy === "createdAt") return { createdAt: direction };
  if (sortBy === "updatedAt") return { updatedAt: direction };
  return { name: direction };
}

function normalizeOrganizationSortBy(value: unknown): NonNullable<OrganizationListFilters["sortBy"]> {
  if (value === undefined) return "name";
  if (value === "createdAt" || value === "updatedAt" || value === "name") return value;
  throw new ApiError("VALIDATION_ERROR", "Organization sort field must be createdAt, updatedAt, or name.", 422);
}

function normalizeOrganizationSortDirection(value: unknown): NonNullable<OrganizationListFilters["sortDirection"]> {
  if (value === undefined) return "asc";
  if (value === "asc" || value === "desc") return value;
  throw new ApiError("VALIDATION_ERROR", "Organization sort direction must be asc or desc.", 422);
}

export async function getOrganization(actor: WorkspaceActor, organizationId: string) {
  await ensureWorkspaceAccess(actor);
  const [organization, auditLogs] = await prisma.$transaction([
    prisma.organization.findFirst({
      where: { id: organizationId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        owner: { select: userDisplaySelect },
        people: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
        deals: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: { updatedAt: "desc" } },
        activities: {
          where: { workspaceId: actor.workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(actor.workspaceId) },
          orderBy: { dueAt: "asc" }
        },
        notes: {
          where: { workspaceId: actor.workspaceId, ...activeWhere, ...noteAttachmentRelationsWhere(actor.workspaceId) },
          include: { author: { select: userDisplaySelect } },
          orderBy: { createdAt: "desc" }
        }
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

export async function createOrganization(actor: WorkspaceActor, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeCreateOrganizationInput(data);
  if (normalized.ownerId) await assertUserInWorkspace(actor.workspaceId, normalized.ownerId);
  const organization = await prisma.organization.create({ data: { ...normalized, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "organization.created", "Organization", organization.id, { name: organization.name });
  return organization;
}

export async function updateOrganization(actor: WorkspaceActor, organizationId: string, data: unknown) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("organization", actor.workspaceId, organizationId);
  const normalized = normalizeUpdateOrganizationInput(data);
  if (normalized.ownerId) await assertUserInWorkspace(actor.workspaceId, normalized.ownerId);
  const existing = await prisma.organization.findFirstOrThrow({
    where: { id: organizationId, workspaceId: actor.workspaceId, ...activeWhere }
  });
  if (Object.keys(normalized).length === 0 || !organizationUpdateChanges(normalized, existing)) {
    return existing;
  }

  const organization = await prisma.organization.update({ where: { id: organizationId }, data: normalized });
  await writeAuditLog(actor, "organization.updated", "Organization", organization.id);
  return organization;
}

export async function softDeleteOrganization(actor: WorkspaceActor, organizationId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("organization", actor.workspaceId, organizationId);
  await prisma.organization.update({ where: { id: organizationId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "organization.deleted", "Organization", organizationId);
}

function normalizeCreateOrganizationInput(data: unknown) {
  const input = objectInput(data);
  return omitUndefined({
    ownerId: normalizeOptionalOrganizationId(input.ownerId),
    name: normalizeRequiredOrganizationText(input.name, "Organization name is required."),
    domain: normalizeOptionalOrganizationText(input.domain, "Organization domain must be text.")
  });
}

function normalizeUpdateOrganizationInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Organization update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    ownerId: hasInputKey(input, "ownerId") ? normalizeOptionalOrganizationId(input.ownerId) : undefined,
    name: hasInputKey(input, "name") ? normalizeRequiredOrganizationText(input.name, "Organization name is required.") : undefined,
    domain: hasInputKey(input, "domain") ? normalizeOptionalOrganizationText(input.domain, "Organization domain must be text.") : undefined
  });
}

function normalizeOptionalOrganizationId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Organization relation ids must be text.", 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRequiredOrganizationText(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalOrganizationText(value: unknown, message: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function organizationUpdateChanges(
  input: ReturnType<typeof normalizeUpdateOrganizationInput>,
  existing: { ownerId: string | null; name: string; domain: string | null }
) {
  if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) return true;
  if (input.name !== undefined && input.name !== existing.name) return true;
  if (input.domain !== undefined && input.domain !== existing.domain) return true;
  return false;
}

function hasInputKey(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
  };
}
