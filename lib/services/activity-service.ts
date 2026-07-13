import { ActivityType, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { startOfDay } from "@/lib/activity-due";
import { recentlyCompletedDays } from "@/lib/activity-workflow";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import {
  actionableActivityRelationsWhere,
  activityAttachmentRelationsWhere,
  assertActivityAttachmentNotChanged,
  assertActivityLinks
} from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { userDisplaySelect } from "./user-select";

type CreateActivityInput = {
  ownerId?: unknown;
  dealId?: unknown;
  leadId?: unknown;
  personId?: unknown;
  organizationId?: unknown;
  type: unknown;
  title: unknown;
  description?: unknown;
  dueAt?: unknown;
  completedAt?: unknown;
};

type UpdateActivityInput = Partial<CreateActivityInput>;
const defaultMissingNextActivityTake = 10;
const maxMissingNextActivityTake = 50;

export type ActivityListFilters = {
  q?: string;
  status?: "open" | "completed";
  completed?: "recent";
  ownerId?: string;
  relatedType?: "deal" | "lead" | "person" | "organization";
  relatedId?: string;
  due?: "overdue" | "today" | "upcoming" | "unscheduled";
  sortBy?: "createdAt" | "updatedAt" | "title" | "dueAt" | "completedAt";
  sortDirection?: "asc" | "desc";
};

export async function listActivities(actor: WorkspaceActor, filters: ActivityListFilters = {}) {
  await ensureWorkspaceAccess(actor);
  const where = activityWhere(actor.workspaceId, filters);

  const activities = await prisma.activity.findMany({
    where,
    include: activityInclude,
    orderBy: activityOrderBy(filters)
  });

  return activities.map((activity) => scopeActivityRelations(actor.workspaceId, activity));
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

  return { ...pageInfo, items: items.map((activity) => scopeActivityRelations(actor.workspaceId, activity)) };
}

export async function getActivityWorkQueueSummary(actor: WorkspaceActor, now = new Date()) {
  await ensureWorkspaceAccess(actor);
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const recentlyCompletedAfter = addDays(today, -recentlyCompletedDays);
  const scopedActivityWhere = {
    workspaceId: actor.workspaceId,
    ...activityAttachmentRelationsWhere(actor.workspaceId),
    ...activeWhere
  } satisfies Prisma.ActivityWhereInput;
  const actionableActivityWhere = {
    workspaceId: actor.workspaceId,
    ...actionableActivityRelationsWhere(actor.workspaceId),
    ...activeWhere
  } satisfies Prisma.ActivityWhereInput;

  const [overdue, dueToday, upcoming, unscheduled, completed, completedRecently] = await Promise.all([
    prisma.activity.count({
      where: { ...actionableActivityWhere, completedAt: null, dueAt: { lt: today } }
    }),
    prisma.activity.count({
      where: { ...actionableActivityWhere, completedAt: null, dueAt: { gte: today, lt: tomorrow } }
    }),
    prisma.activity.count({
      where: { ...actionableActivityWhere, completedAt: null, dueAt: { gte: tomorrow } }
    }),
    prisma.activity.count({
      where: { ...actionableActivityWhere, completedAt: null, dueAt: null }
    }),
    prisma.activity.count({
      where: { ...scopedActivityWhere, completedAt: { not: null } }
    }),
    prisma.activity.count({
      where: { ...scopedActivityWhere, completedAt: { gte: recentlyCompletedAfter } }
    })
  ]);

  return {
    overdue,
    dueToday,
    upcoming,
    unscheduled,
    completed,
    completedRecently,
    openTotal: overdue + dueToday + upcoming + unscheduled
  };
}

export async function getFollowUpHealthSummary(actor: WorkspaceActor, now = new Date()) {
  await ensureWorkspaceAccess(actor);
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const recentlyCompletedAfter = addDays(today, -recentlyCompletedDays);
  const scopedActivityWhere = {
    workspaceId: actor.workspaceId,
    ...activityAttachmentRelationsWhere(actor.workspaceId),
    ...activeWhere
  } satisfies Prisma.ActivityWhereInput;
  const actionableActivityWhere = {
    workspaceId: actor.workspaceId,
    ...actionableActivityRelationsWhere(actor.workspaceId),
    ...activeWhere
  } satisfies Prisma.ActivityWhereInput;

  const [
    openActivitiesOverdue,
    openActivitiesDueToday,
    openDealsMissingNextActivity,
    activeLeadsMissingNextActivity,
    recentlyCompletedActivities
  ] = await Promise.all([
    prisma.activity.count({
      where: { ...actionableActivityWhere, completedAt: null, dueAt: { lt: today } }
    }),
    prisma.activity.count({
      where: { ...actionableActivityWhere, completedAt: null, dueAt: { gte: today, lt: tomorrow } }
    }),
    prisma.deal.count({
      where: {
        workspaceId: actor.workspaceId,
        status: "OPEN",
        activities: { none: { ...scopedActivityWhere, completedAt: null } },
        ...activeWhere
      }
    }),
    prisma.lead.count({
      where: {
        workspaceId: actor.workspaceId,
        status: { in: ["NEW", "QUALIFIED"] },
        activities: { none: { ...scopedActivityWhere, completedAt: null } },
        ...activeWhere
      }
    }),
    prisma.activity.count({
      where: { ...scopedActivityWhere, completedAt: { gte: recentlyCompletedAfter } }
    })
  ]);

  return {
    activeLeadsMissingNextActivity,
    openActivitiesDueToday,
    openActivitiesOverdue,
    openDealsMissingNextActivity,
    recentlyCompletedActivities
  };
}

export async function listRecordsMissingNextActivity(
  actor: WorkspaceActor,
  recordType: "deal" | "lead",
  { take = defaultMissingNextActivityTake }: { take?: number } = {}
) {
  await ensureWorkspaceAccess(actor);
  const normalizedTake = normalizeMissingNextActivityTake(take);
  const normalizedRecordType = normalizeMissingNextActivityRecordType(recordType);

  if (normalizedRecordType === "deal") {
    const deals = await prisma.deal.findMany({
      where: {
        workspaceId: actor.workspaceId,
        status: "OPEN",
        activities: {
          none: {
            workspaceId: actor.workspaceId,
            completedAt: null,
            ...activityAttachmentRelationsWhere(actor.workspaceId),
            ...activeWhere
          }
        },
        ...activeWhere
      },
      include: {
        owner: { select: userDisplaySelect },
        organization: true,
        person: true,
        stage: true
      },
      orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
      take: normalizedTake
    });

    return deals.map((deal) => ({
      id: deal.id,
      type: "deal" as const,
      title: deal.title,
      href: `/deals/${deal.id}`,
      ownerName: deal.owner?.name ?? deal.owner?.email ?? "Unassigned",
      relatedLabel: relatedDealLabel(actor.workspaceId, deal)
    }));
  }

  const leads = await prisma.lead.findMany({
    where: {
      workspaceId: actor.workspaceId,
      status: { in: ["NEW", "QUALIFIED"] },
      activities: {
        none: {
          workspaceId: actor.workspaceId,
          completedAt: null,
          ...activityAttachmentRelationsWhere(actor.workspaceId),
          ...activeWhere
        }
      },
      ...activeWhere
    },
    include: {
      owner: { select: userDisplaySelect },
      organization: true,
      person: true
    },
    orderBy: [{ updatedAt: "asc" }, { createdAt: "asc" }],
    take: normalizedTake
  });

  return leads.map((lead) => ({
    id: lead.id,
    type: "lead" as const,
    title: lead.title,
    href: `/leads/${lead.id}`,
    ownerName: lead.owner?.name ?? lead.owner?.email ?? "Unassigned",
    relatedLabel: relatedLeadLabel(actor.workspaceId, lead)
  }));
}

const activityInclude = {
  owner: { select: userDisplaySelect },
  deal: true,
  lead: true,
  person: true,
  organization: true,
  schedulerBookings: {
    orderBy: { requestedAt: "desc" },
    select: {
      id: true,
      schedulerLink: {
        select: {
          name: true
        }
      }
    },
    take: 1
  }
} satisfies Prisma.ActivityInclude;

function activityWhere(workspaceId: string, filters: ActivityListFilters): Prisma.ActivityWhereInput {
  const where: Prisma.ActivityWhereInput = { workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(workspaceId) };
  applyActivitySearchFilter(where, workspaceId, filters.q);
  applyActivityStatusFilter(where, filters.status);
  if (filters.ownerId) where.ownerId = filters.ownerId;
  if (filters.relatedType && filters.relatedId) {
    const relatedType = normalizeActivityRelatedType(filters.relatedType);
    where[relatedField(relatedType)] = filters.relatedId;
  }
  applyDueFilter(where, filters.due);
  applyCompletedFilter(where, filters.completed);
  return where;
}

function applyActivityStatusFilter(where: Prisma.ActivityWhereInput, status: ActivityListFilters["status"]) {
  if (!status) return;
  const normalizedStatus = normalizeActivityStatusFilter(status);
  if (normalizedStatus === "open") where.completedAt = null;
  if (normalizedStatus === "completed") where.completedAt = { not: null };
}

function normalizeActivityStatusFilter(value: unknown): NonNullable<ActivityListFilters["status"]> {
  if (value === "open" || value === "completed") return value;
  throw new ApiError("VALIDATION_ERROR", "Activity status filter must be open or completed.", 422);
}

function applyActivitySearchFilter(where: Prisma.ActivityWhereInput, workspaceId: string, query: string | undefined) {
  if (!query) return;
  const searchFilter: Prisma.ActivityWhereInput = {
    OR: [
      { title: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
      { deal: { is: { workspaceId, ...activeWhere, title: { contains: query, mode: "insensitive" } } } },
      { lead: { is: { workspaceId, ...activeWhere, title: { contains: query, mode: "insensitive" } } } },
      {
        person: {
          is: {
            workspaceId,
            ...activeWhere,
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { email: { contains: query, mode: "insensitive" } }
            ]
          }
        }
      },
      { organization: { is: { workspaceId, ...activeWhere, name: { contains: query, mode: "insensitive" } } } }
    ]
  };
  const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  where.AND = [...existingAnd, searchFilter];
}

function relatedField(type: NonNullable<ActivityListFilters["relatedType"]>) {
  if (type === "deal") return "dealId";
  if (type === "lead") return "leadId";
  if (type === "person") return "personId";
  return "organizationId";
}

function normalizeActivityRelatedType(value: unknown): NonNullable<ActivityListFilters["relatedType"]> {
  if (value === "deal" || value === "lead" || value === "person" || value === "organization") return value;
  throw new ApiError("VALIDATION_ERROR", "Activity related type must be deal, lead, person, or organization.", 422);
}

function normalizeMissingNextActivityRecordType(value: unknown): "deal" | "lead" {
  if (value === "deal" || value === "lead") return value;
  throw new ApiError("VALIDATION_ERROR", "Missing-next-activity record type must be deal or lead.", 422);
}

function applyDueFilter(where: Prisma.ActivityWhereInput, due: ActivityListFilters["due"]) {
  if (!due) return;
  const normalizedDue = normalizeActivityDueFilter(due);
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (normalizedDue === "overdue") {
    where.completedAt = null;
    where.dueAt = { lt: today };
  }
  if (normalizedDue === "today") {
    where.completedAt = null;
    where.dueAt = { gte: today, lt: tomorrow };
  }
  if (normalizedDue === "upcoming") {
    where.completedAt = null;
    where.dueAt = { gte: tomorrow };
  }
  if (normalizedDue === "unscheduled") {
    where.completedAt = null;
    where.dueAt = null;
  }
}

function normalizeActivityDueFilter(value: unknown): NonNullable<ActivityListFilters["due"]> {
  if (value === "overdue" || value === "today" || value === "upcoming" || value === "unscheduled") return value;
  throw new ApiError("VALIDATION_ERROR", "Activity due filter must be overdue, today, upcoming, or unscheduled.", 422);
}

function applyCompletedFilter(where: Prisma.ActivityWhereInput, completed: ActivityListFilters["completed"]) {
  if (!completed) return;
  const normalizedCompleted = normalizeActivityCompletedFilter(completed);
  if (normalizedCompleted !== "recent") return;
  where.completedAt = { gte: addDays(startOfDay(new Date()), -recentlyCompletedDays) };
}

function normalizeActivityCompletedFilter(value: unknown): NonNullable<ActivityListFilters["completed"]> {
  if (value === "recent") return value;
  throw new ApiError("VALIDATION_ERROR", "Activity completed filter must be recent.", 422);
}

function activityOrderBy(filters: ActivityListFilters): Prisma.ActivityOrderByWithRelationInput[] {
  const direction = normalizeActivitySortDirection(filters.sortDirection);
  const sortBy = normalizeActivitySortBy(filters.sortBy);
  if (sortBy === "createdAt") return [{ createdAt: direction }];
  if (sortBy === "updatedAt") return [{ updatedAt: direction }];
  if (sortBy === "title") return [{ title: direction }];
  if (sortBy === "completedAt" || filters.completed === "recent") return [{ completedAt: direction === "asc" ? "asc" : "desc" }];
  return [{ completedAt: "asc" }, { dueAt: direction }];
}

function normalizeActivitySortBy(value: unknown): NonNullable<ActivityListFilters["sortBy"]> {
  if (value === undefined) return "dueAt";
  if (
    value === "createdAt" ||
    value === "updatedAt" ||
    value === "title" ||
    value === "dueAt" ||
    value === "completedAt"
  ) {
    return value;
  }
  throw new ApiError(
    "VALIDATION_ERROR",
    "Activity sort field must be createdAt, updatedAt, title, dueAt, or completedAt.",
    422
  );
}

function normalizeActivitySortDirection(value: unknown): NonNullable<ActivityListFilters["sortDirection"]> {
  if (value === undefined) return "asc";
  if (value === "asc" || value === "desc") return value;
  throw new ApiError("VALIDATION_ERROR", "Activity sort direction must be asc or desc.", 422);
}

export async function getActivity(actor: WorkspaceActor, activityId: string) {
  await ensureWorkspaceAccess(actor);
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, workspaceId: actor.workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(actor.workspaceId) },
    include: activityInclude
  });

  if (!activity) throw new ApiError("NOT_FOUND", "Activity was not found.", 404);
  return scopeActivityRelations(actor.workspaceId, activity);
}

type OrganizationLabelRelation = { workspaceId: string; name: string } | null;
type PersonLabelRelation = { workspaceId: string; firstName: string | null; lastName: string | null } | null;

function relatedDealLabel<T extends { organization: OrganizationLabelRelation; person: PersonLabelRelation; stage: { name: string } }>(
  workspaceId: string,
  deal: T
) {
  const organization = scopeWorkspaceRelation(workspaceId, deal.organization);
  const person = scopeWorkspaceRelation(workspaceId, deal.person);
  return organization?.name ?? (person ? [person.firstName, person.lastName].filter(Boolean).join(" ") : deal.stage.name);
}

function relatedLeadLabel<T extends { organization: OrganizationLabelRelation; person: PersonLabelRelation; source: string | null }>(
  workspaceId: string,
  lead: T
) {
  const organization = scopeWorkspaceRelation(workspaceId, lead.organization);
  const person = scopeWorkspaceRelation(workspaceId, lead.person);
  return organization?.name ?? (person ? [person.firstName, person.lastName].filter(Boolean).join(" ") : lead.source ?? "No source");
}

function scopeActivityRelations<
  T extends {
    deal: WorkspaceScopedRelation;
    lead: WorkspaceScopedRelation;
    person: WorkspaceScopedRelation;
    organization: WorkspaceScopedRelation;
  }
>(workspaceId: string, activity: T) {
  return {
    ...activity,
    deal: scopeWorkspaceRelation(workspaceId, activity.deal),
    lead: scopeWorkspaceRelation(workspaceId, activity.lead),
    person: scopeWorkspaceRelation(workspaceId, activity.person),
    organization: scopeWorkspaceRelation(workspaceId, activity.organization)
  };
}

export async function createActivity(actor: WorkspaceActor, data: CreateActivityInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeCreateActivityInput(data);
  await assertActivityLinks(actor.workspaceId, normalized, { requireAttachment: true });
  const activity = await prisma.activity.create({ data: { ...normalized, workspaceId: actor.workspaceId } });
  await writeAuditLog(actor, "activity.created", "Activity", activity.id, {
    title: activity.title,
    completedAt: activity.completedAt ?? undefined
  });
  return activity;
}

export async function updateActivity(actor: WorkspaceActor, activityId: string, data: UpdateActivityInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeUpdateActivityInput(data);
  assertActivityAttachmentNotChanged(data as Prisma.ActivityUncheckedUpdateInput);
  await assertActivityLinks(actor.workspaceId, normalized);
  const existing = await prisma.activity.findFirst({
    where: {
      id: activityId,
      workspaceId: actor.workspaceId,
      ...activeWhere,
      ...activityAttachmentRelationsWhere(actor.workspaceId)
    },
    include: {
      deal: { select: { status: true } },
      lead: { select: { status: true } }
    }
  });
  if (!existing) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
  if (existing.completedAt) {
    throw new ApiError("ACTIVITY_COMPLETED", "Completed activities cannot be edited.", 409);
  }
  assertActivityParentUnlocked(existing, { allowClosedDeal: isActivityCompletionOnlyUpdate(normalized) });
  if (Object.keys(normalized).length === 0 || !activityUpdateChanges(normalized, existing)) {
    return existing;
  }

  const activity = await prisma.activity.update({ where: { id: activityId }, data: normalized });
  const completedNow = !existing.completedAt && Boolean(activity.completedAt);
  await writeAuditLog(actor, completedNow ? "activity.completed" : "activity.updated", "Activity", activity.id, {
    completedAt: completedNow ? activity.completedAt : undefined
  });
  return activity;
}

export async function softDeleteActivity(actor: WorkspaceActor, activityId: string) {
  await ensureWorkspaceAccess(actor);
  const existing = await prisma.activity.findFirst({
    where: {
      id: activityId,
      workspaceId: actor.workspaceId,
      ...activeWhere,
      ...activityAttachmentRelationsWhere(actor.workspaceId)
    },
    select: {
      completedAt: true,
      deal: { select: { status: true } },
      lead: { select: { status: true } }
    }
  });
  if (!existing) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
  if (existing.completedAt) {
    throw new ApiError("ACTIVITY_COMPLETED", "Completed activities cannot be removed.", 409);
  }
  assertActivityParentUnlocked(existing, { allowClosedDeal: true });
  await prisma.activity.update({ where: { id: activityId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "activity.deleted", "Activity", activityId);
}

function assertActivityParentUnlocked(activity: {
  deal: { status: string } | null;
  lead: { status: string } | null;
}, options: { allowClosedDeal?: boolean } = {}) {
  if (activity.deal?.status !== undefined && activity.deal.status !== "OPEN" && !options.allowClosedDeal) {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }
  if (activity.lead?.status === "CONVERTED") {
    throw new ApiError("LEAD_CONVERTED", "Update follow-up activities on the converted deal.", 409);
  }
}

function isActivityCompletionOnlyUpdate(input: ReturnType<typeof normalizeUpdateActivityInput>) {
  const keys = Object.keys(input);
  return keys.length === 1 && keys[0] === "completedAt" && input.completedAt instanceof Date;
}

function activityUpdateChanges(
  input: ReturnType<typeof normalizeUpdateActivityInput>,
  existing: {
    ownerId: string | null;
    type: ActivityType;
    title: string;
    description: string | null;
    dueAt: Date | null;
    completedAt: Date | null;
  }
) {
  if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) return true;
  if (input.type !== undefined && input.type !== existing.type) return true;
  if (input.title !== undefined && input.title !== existing.title) return true;
  if (input.description !== undefined && input.description !== existing.description) return true;
  if (input.dueAt !== undefined && input.dueAt.getTime() !== existing.dueAt?.getTime()) return true;
  if (input.completedAt !== undefined && input.completedAt.getTime() !== existing.completedAt?.getTime()) return true;
  return false;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function normalizeMissingNextActivityTake(take: number) {
  if (!Number.isFinite(take)) return defaultMissingNextActivityTake;
  const normalized = Math.trunc(take);
  if (normalized < 1) return 1;
  if (normalized > maxMissingNextActivityTake) return maxMissingNextActivityTake;
  return normalized;
}

function normalizeCreateActivityInput(data: unknown) {
  const input = objectInput(data);
  return omitUndefined({
    ownerId: normalizeOptionalActivityId(input.ownerId),
    dealId: normalizeOptionalActivityId(input.dealId),
    leadId: normalizeOptionalActivityId(input.leadId),
    personId: normalizeOptionalActivityId(input.personId),
    organizationId: normalizeOptionalActivityId(input.organizationId),
    type: normalizeActivityType(input.type),
    title: normalizeRequiredActivityText(input.title, "Activity title is required."),
    description: normalizeOptionalActivityText(input.description, "Activity description must be text."),
    dueAt: normalizeNullableDateValue(input.dueAt, "Activity due date is invalid."),
    completedAt: normalizeNullableDateValue(input.completedAt, "Activity completed date is invalid.")
  });
}

function normalizeUpdateActivityInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Activity update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    ownerId: hasInputKey(input, "ownerId") ? normalizeOptionalActivityId(input.ownerId) : undefined,
    type: hasInputKey(input, "type") ? normalizeActivityType(input.type) : undefined,
    title: hasInputKey(input, "title") ? normalizeRequiredActivityText(input.title, "Activity title is required.") : undefined,
    description: hasInputKey(input, "description")
      ? normalizeOptionalActivityText(input.description, "Activity description must be text.")
      : undefined,
    dueAt: hasInputKey(input, "dueAt") ? normalizeNullableDateValue(input.dueAt, "Activity due date is invalid.") : undefined,
    completedAt: hasInputKey(input, "completedAt")
      ? normalizeNullableDateValue(input.completedAt, "Activity completed date is invalid.")
      : undefined
  });
}

function normalizeActivityType(value: unknown): ActivityType {
  if (value === "CALL" || value === "EMAIL" || value === "MEETING" || value === "TASK") return value;
  throw new ApiError("VALIDATION_ERROR", "Activity type must be CALL, EMAIL, MEETING, or TASK.", 422);
}

function normalizeRequiredActivityText(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalActivityText(value: unknown, message: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalActivityId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Activity relation ids must be text.", 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeNullableDateValue(input: unknown, message: string) {
  const value = extractNullableDateValue(input);
  if (value === undefined || value === null) return;
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
