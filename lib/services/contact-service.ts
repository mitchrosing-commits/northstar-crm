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
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { userDisplaySelect } from "./user-select";

type CreatePersonInput = {
  ownerId?: unknown;
  organizationId?: unknown;
  firstName: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
};
type UpdatePersonInput = Partial<CreatePersonInput>;
export type PersonListFilters = CustomFieldListFilters & {
  q?: string;
  organizationId?: string;
  ownerId?: string;
  sortBy?: "createdAt" | "updatedAt" | "name";
  sortDirection?: "asc" | "desc";
};

export async function listPeople(actor: WorkspaceActor, filters: PersonListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "PERSON", filters);
  const where = personWhere(actor.workspaceId, filters, customFieldEntityIds);

  const people = await prisma.person.findMany({
    where,
    include: personInclude(actor.workspaceId),
    orderBy: personOrderBy(filters)
  });

  return people.map((person) => scopePersonRelations(actor.workspaceId, person));
}

export async function listPeoplePage(actor: WorkspaceActor, filters: PersonListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "PERSON", filters);
  const where = personWhere(actor.workspaceId, filters, customFieldEntityIds);
  const total = await prisma.person.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.person.findMany({
    where,
    include: personInclude(actor.workspaceId),
    orderBy: personOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items: items.map((person) => scopePersonRelations(actor.workspaceId, person)) };
}

const personInclude = (workspaceId: string) => ({
  organization: true,
  owner: { select: userDisplaySelect },
  activities: {
    where: { workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(workspaceId), completedAt: null },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 1
  }
}) satisfies Prisma.PersonInclude;

function personWhere(
  workspaceId: string,
  filters: PersonListFilters,
  customFieldEntityIds?: string[]
): Prisma.PersonWhereInput {
  const where: Prisma.PersonWhereInput = { workspaceId, ...activeWhere };
  if (filters.q) {
    where.OR = [
      { firstName: { contains: filters.q, mode: "insensitive" } },
      { lastName: { contains: filters.q, mode: "insensitive" } },
      { email: { contains: filters.q, mode: "insensitive" } },
      { phone: { contains: filters.q, mode: "insensitive" } },
      { organization: { is: { workspaceId, ...activeWhere, name: { contains: filters.q, mode: "insensitive" } } } }
    ];
  }
  if (filters.organizationId) where.organizationId = filters.organizationId;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (customFieldEntityIds) where.id = { in: customFieldEntityIds };
  return where;
}

function personOrderBy(filters: PersonListFilters): Prisma.PersonOrderByWithRelationInput[] {
  const direction = normalizePersonSortDirection(filters.sortDirection);
  const sortBy = normalizePersonSortBy(filters.sortBy);
  if (sortBy === "createdAt") return [{ createdAt: direction }];
  if (sortBy === "updatedAt") return [{ updatedAt: direction }];
  return [{ lastName: direction }, { firstName: direction }];
}

function normalizePersonSortBy(value: unknown): NonNullable<PersonListFilters["sortBy"]> {
  if (value === undefined) return "name";
  if (value === "createdAt" || value === "updatedAt" || value === "name") return value;
  throw new ApiError("VALIDATION_ERROR", "Contact sort field must be createdAt, updatedAt, or name.", 422);
}

function normalizePersonSortDirection(value: unknown): NonNullable<PersonListFilters["sortDirection"]> {
  if (value === undefined) return "asc";
  if (value === "asc" || value === "desc") return value;
  throw new ApiError("VALIDATION_ERROR", "Contact sort direction must be asc or desc.", 422);
}

export async function getPerson(actor: WorkspaceActor, personId: string) {
  await ensureWorkspaceAccess(actor);
  const [person, auditLogs] = await prisma.$transaction([
    prisma.person.findFirst({
      where: { id: personId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        organization: true,
        owner: { select: userDisplaySelect },
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
      where: { workspaceId: actor.workspaceId, entityType: "Person", entityId: personId },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 25
    })
  ]);
  if (!person) throw new ApiError("NOT_FOUND", "Person was not found.", 404);
  return { ...scopePersonRelations(actor.workspaceId, person), auditLogs };
}

function scopePersonRelations<T extends { organization: WorkspaceScopedRelation }>(workspaceId: string, person: T) {
  return {
    ...person,
    organization: scopeWorkspaceRelation(workspaceId, person.organization)
  };
}

export async function createPerson(actor: WorkspaceActor, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeCreatePersonInput(data);
  if (normalized.organizationId) await assertRecordInWorkspace("organization", actor.workspaceId, normalized.organizationId);
  if (normalized.ownerId) await assertUserInWorkspace(actor.workspaceId, normalized.ownerId);
  const person = await prisma.person.create({ data: { ...normalized, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "person.created", "Person", person.id, { email: person.email });
  return person;
}

export async function updatePerson(actor: WorkspaceActor, personId: string, data: unknown) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("person", actor.workspaceId, personId);
  const normalized = normalizeUpdatePersonInput(data);
  if (normalized.organizationId) await assertRecordInWorkspace("organization", actor.workspaceId, normalized.organizationId);
  if (normalized.ownerId) await assertUserInWorkspace(actor.workspaceId, normalized.ownerId);
  const existing = await prisma.person.findFirstOrThrow({
    where: { id: personId, workspaceId: actor.workspaceId, ...activeWhere }
  });
  if (Object.keys(normalized).length === 0 || !personUpdateChanges(normalized, existing)) {
    return existing;
  }

  const person = await prisma.person.update({ where: { id: personId }, data: normalized });
  await writeAuditLog(actor, "person.updated", "Person", person.id);
  return person;
}

export async function softDeletePerson(actor: WorkspaceActor, personId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("person", actor.workspaceId, personId);
  await prisma.person.update({ where: { id: personId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "person.deleted", "Person", personId);
}

function normalizeCreatePersonInput(data: unknown) {
  const input = objectInput(data);
  return omitUndefined({
    ownerId: normalizeOptionalPersonId(input.ownerId),
    organizationId: normalizeOptionalPersonId(input.organizationId),
    firstName: normalizeRequiredPersonText(input.firstName, "Contact first name is required."),
    lastName: normalizeOptionalPersonText(input.lastName, "Contact last name must be text."),
    email: normalizeOptionalPersonText(input.email, "Contact email must be text."),
    phone: normalizeOptionalPersonText(input.phone, "Contact phone must be text.")
  });
}

function normalizeUpdatePersonInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Contact update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    ownerId: hasInputKey(input, "ownerId") ? normalizeOptionalPersonId(input.ownerId) : undefined,
    organizationId: hasInputKey(input, "organizationId") ? normalizeOptionalPersonId(input.organizationId) : undefined,
    firstName: hasInputKey(input, "firstName")
      ? normalizeRequiredPersonText(input.firstName, "Contact first name is required.")
      : undefined,
    lastName: hasInputKey(input, "lastName") ? normalizeOptionalPersonText(input.lastName, "Contact last name must be text.") : undefined,
    email: hasInputKey(input, "email") ? normalizeOptionalPersonText(input.email, "Contact email must be text.") : undefined,
    phone: hasInputKey(input, "phone") ? normalizeOptionalPersonText(input.phone, "Contact phone must be text.") : undefined
  });
}

function normalizeOptionalPersonId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Contact relation ids must be text.", 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRequiredPersonText(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalPersonText(value: unknown, message: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function personUpdateChanges(
  input: ReturnType<typeof normalizeUpdatePersonInput>,
  existing: {
    ownerId: string | null;
    organizationId: string | null;
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  }
) {
  if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) return true;
  if (input.organizationId !== undefined && input.organizationId !== existing.organizationId) return true;
  if (input.firstName !== undefined && input.firstName !== existing.firstName) return true;
  if (input.lastName !== undefined && input.lastName !== existing.lastName) return true;
  if (input.email !== undefined && input.email !== existing.email) return true;
  if (input.phone !== undefined && input.phone !== existing.phone) return true;
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
