import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { listCustomFieldFilteredEntityIds, type CustomFieldListFilters } from "./custom-field-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertRecordInWorkspace, assertUserInWorkspace } from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreatePersonInput = Omit<Prisma.PersonUncheckedCreateInput, "workspaceId">;
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

  return prisma.person.findMany({
    where,
    include: personInclude,
    orderBy: personOrderBy(filters)
  });
}

export async function listPeoplePage(actor: WorkspaceActor, filters: PersonListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const customFieldEntityIds = await listCustomFieldFilteredEntityIds(actor.workspaceId, "PERSON", filters);
  const where = personWhere(actor.workspaceId, filters, customFieldEntityIds);
  const total = await prisma.person.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.person.findMany({
    where,
    include: personInclude,
    orderBy: personOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items };
}

const personInclude = { organization: true, owner: { select: userDisplaySelect } } satisfies Prisma.PersonInclude;

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
      { organization: { is: { name: { contains: filters.q, mode: "insensitive" } } } }
    ];
  }
  if (filters.organizationId) where.organizationId = filters.organizationId;
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (customFieldEntityIds) where.id = { in: customFieldEntityIds };
  return where;
}

function personOrderBy(filters: PersonListFilters): Prisma.PersonOrderByWithRelationInput[] {
  const direction = filters.sortDirection ?? "asc";
  if (filters.sortBy === "createdAt") return [{ createdAt: direction }];
  if (filters.sortBy === "updatedAt") return [{ updatedAt: direction }];
  return [{ lastName: direction }, { firstName: direction }];
}

export async function getPerson(actor: WorkspaceActor, personId: string) {
  await ensureWorkspaceAccess(actor);
  const [person, auditLogs] = await prisma.$transaction([
    prisma.person.findFirst({
      where: { id: personId, workspaceId: actor.workspaceId, ...activeWhere },
      include: {
        organization: true,
        owner: { select: userDisplaySelect },
        deals: { where: activeWhere, orderBy: { updatedAt: "desc" } },
        activities: { where: activeWhere, orderBy: { dueAt: "asc" } },
        notes: { where: activeWhere, include: { author: { select: userDisplaySelect } }, orderBy: { createdAt: "desc" } }
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
  return { ...person, auditLogs };
}

export async function createPerson(actor: WorkspaceActor, data: CreatePersonInput) {
  await ensureWorkspaceAccess(actor);
  if (data.organizationId) await assertRecordInWorkspace("organization", actor.workspaceId, data.organizationId);
  if (data.ownerId) await assertUserInWorkspace(actor.workspaceId, data.ownerId);
  const person = await prisma.person.create({ data: { ...data, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "person.created", "Person", person.id, { email: person.email });
  return person;
}

export async function updatePerson(actor: WorkspaceActor, personId: string, data: Prisma.PersonUncheckedUpdateInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("person", actor.workspaceId, personId);
  if (typeof data.organizationId === "string") await assertRecordInWorkspace("organization", actor.workspaceId, data.organizationId);
  if (typeof data.ownerId === "string") await assertUserInWorkspace(actor.workspaceId, data.ownerId);
  const person = await prisma.person.update({ where: { id: personId }, data });
  await writeAuditLog(actor, "person.updated", "Person", person.id);
  return person;
}

export async function softDeletePerson(actor: WorkspaceActor, personId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("person", actor.workspaceId, personId);
  await prisma.person.update({ where: { id: personId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "person.deleted", "Person", personId);
}
