import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { startOfDay } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertActivityAttachmentNotChanged, assertActivityLinks, assertRecordInWorkspace } from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreateActivityInput = Omit<Prisma.ActivityUncheckedCreateInput, "workspaceId">;
export type ActivityListFilters = {
  status?: "open" | "completed";
  ownerId?: string;
  relatedType?: "deal" | "lead" | "person" | "organization";
  relatedId?: string;
  due?: "overdue" | "today" | "upcoming";
  sortBy?: "createdAt" | "updatedAt" | "title" | "dueAt";
  sortDirection?: "asc" | "desc";
};

export async function listActivities(actor: WorkspaceActor, filters: ActivityListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const where = activityWhere(actor.workspaceId, filters);

  return prisma.activity.findMany({
    where,
    include: activityInclude,
    orderBy: activityOrderBy(filters)
  });
}

export async function listActivitiesPage(actor: WorkspaceActor, filters: ActivityListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const where = activityWhere(actor.workspaceId, filters);
  const total = await prisma.activity.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.activity.findMany({
    where,
    include: activityInclude,
    orderBy: activityOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items };
}

export async function getActivityWorkQueueSummary(actor: WorkspaceActor, now = new Date()) {
  await ensureWorkspaceAccess(actor);
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [overdue, dueToday, upcoming, unscheduled, completed] = await Promise.all([
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: null, dueAt: { lt: today }, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: null, dueAt: { gte: today, lt: tomorrow }, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: null, dueAt: { gte: tomorrow }, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: null, dueAt: null, ...activeWhere }
    }),
    prisma.activity.count({
      where: { workspaceId: actor.workspaceId, completedAt: { not: null }, ...activeWhere }
    })
  ]);

  return {
    overdue,
    dueToday,
    upcoming,
    unscheduled,
    completed,
    openTotal: overdue + dueToday + upcoming + unscheduled
  };
}

const activityInclude = {
  owner: { select: userDisplaySelect },
  deal: true,
  lead: true,
  person: true,
  organization: true
} satisfies Prisma.ActivityInclude;

function activityWhere(workspaceId: string, filters: ActivityListFilters): Prisma.ActivityWhereInput {
  const where: Prisma.ActivityWhereInput = { workspaceId, ...activeWhere };
  if (filters.status === "open") where.completedAt = null;
  if (filters.status === "completed") where.completedAt = { not: null };
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.relatedType && filters.relatedId) {
    where[relatedField(filters.relatedType)] = filters.relatedId;
  }
  applyDueFilter(where, filters.due);
  return where;
}

function relatedField(type: NonNullable<ActivityListFilters["relatedType"]>) {
  if (type === "deal") return "dealId";
  if (type === "lead") return "leadId";
  if (type === "person") return "personId";
  return "organizationId";
}

function applyDueFilter(where: Prisma.ActivityWhereInput, due: ActivityListFilters["due"]) {
  if (!due) return;
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (due === "overdue") {
    where.completedAt = null;
    where.dueAt = { lt: today };
  }
  if (due === "today") {
    where.completedAt = null;
    where.dueAt = { gte: today, lt: tomorrow };
  }
  if (due === "upcoming") {
    where.completedAt = null;
    where.dueAt = { gte: tomorrow };
  }
}

function activityOrderBy(filters: ActivityListFilters): Prisma.ActivityOrderByWithRelationInput[] {
  const direction = filters.sortDirection ?? "asc";
  if (filters.sortBy === "createdAt") return [{ createdAt: direction }];
  if (filters.sortBy === "updatedAt") return [{ updatedAt: direction }];
  if (filters.sortBy === "title") return [{ title: direction }];
  return [{ completedAt: "asc" }, { dueAt: direction }];
}

export async function getActivity(actor: WorkspaceActor, activityId: string) {
  await ensureWorkspaceAccess(actor);
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, workspaceId: actor.workspaceId, ...activeWhere },
    include: activityInclude
  });

  if (!activity) throw new ApiError("NOT_FOUND", "Activity was not found.", 404);
  return activity;
}

export async function createActivity(actor: WorkspaceActor, data: CreateActivityInput) {
  await ensureWorkspaceAccess(actor);
  await assertActivityLinks(actor.workspaceId, data);
  const activity = await prisma.activity.create({ data: { ...data, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "activity.created", "Activity", activity.id, { title: activity.title });
  return activity;
}

export async function updateActivity(actor: WorkspaceActor, activityId: string, data: Prisma.ActivityUncheckedUpdateInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("activity", actor.workspaceId, activityId);
  assertActivityAttachmentNotChanged(data);
  await assertActivityLinks(actor.workspaceId, data);
  const existing = await prisma.activity.findUniqueOrThrow({
    where: { id: activityId },
    select: { completedAt: true }
  });
  if (existing.completedAt) {
    throw new ApiError("ACTIVITY_COMPLETED", "Completed activities cannot be edited.", 409);
  }
  const activity = await prisma.activity.update({ where: { id: activityId }, data });
  const completedNow = !existing.completedAt && Boolean(activity.completedAt);
  await writeAuditLog(actor, completedNow ? "activity.completed" : "activity.updated", "Activity", activity.id, {
    completedAt: completedNow ? activity.completedAt : undefined
  });
  return activity;
}

export async function softDeleteActivity(actor: WorkspaceActor, activityId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("activity", actor.workspaceId, activityId);
  await prisma.activity.update({ where: { id: activityId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "activity.deleted", "Activity", activityId);
}
