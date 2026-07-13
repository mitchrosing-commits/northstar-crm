import { createHash, randomBytes } from "node:crypto";

import { ActivityType, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

type AvailabilityWindow = {
  weekday: number;
  start: string;
  end: string;
};

type SchedulerLinkInput = {
  name?: unknown;
  meetingTitle?: unknown;
  description?: unknown;
  durationMinutes?: unknown;
  timezone?: unknown;
  minimumNoticeMinutes?: unknown;
  availability?: unknown;
};

type SchedulerLinkUpdateInput = Partial<SchedulerLinkInput> & {
  isEnabled?: unknown;
};

type PublicBookingInput = {
  startAt?: unknown;
  attendeeName?: unknown;
  attendeeEmail?: unknown;
  attendeeCompany?: unknown;
  attendeeNote?: unknown;
  website?: unknown;
};
type SchedulerBookingReviewFiltersInput = {
  activity?: unknown;
  from?: unknown;
  link?: unknown;
  q?: unknown;
  to?: unknown;
};
type SchedulerBookingActivityFilter = "completed" | "open" | "unavailable";
type SchedulerBookingReviewFilters = {
  activity: SchedulerBookingActivityFilter | null;
  from: string | null;
  query: string | null;
  schedulerLinkId: string | null;
  to: string | null;
};

type SchedulerChoice = {
  startAt: Date;
  endAt: Date;
  value: string;
  label: string;
};

const SCHEDULER_TOKEN_ATTEMPTS = 3;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
const PUBLIC_CHOICE_DAYS = 14;
const PUBLIC_CHOICE_LIMIT = 24;
const RECENT_BOOKING_LIMIT = 10;
const BOOKING_REVIEW_LIMIT = 25;
const BOOKING_ACTIVITY_FILTERS = new Set<string>(["completed", "open", "unavailable"]);
const DEFAULT_AVAILABILITY: AvailabilityWindow[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: "09:00",
  end: "17:00"
}));
const schedulerBookingReviewSelect = {
  id: true,
  attendeeName: true,
  attendeeEmail: true,
  attendeeCompany: true,
  attendeeNote: true,
  startAt: true,
  endAt: true,
  timezone: true,
  requestedAt: true,
  activity: {
    select: {
      id: true,
      title: true,
      completedAt: true,
      deletedAt: true
    }
  },
  schedulerLink: {
    select: {
      id: true,
      name: true,
      meetingTitle: true,
      isEnabled: true,
      deletedAt: true
    }
  }
} satisfies Prisma.SchedulerBookingSelect;

export async function listSchedulerLinks(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  return prisma.schedulerLink.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    include: {
      _count: { select: { bookings: true } },
      bookings: {
        orderBy: { requestedAt: "desc" },
        select: { requestedAt: true },
        take: 1
      }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function getSchedulerLinkReview(actor: WorkspaceActor, schedulerLinkId: string) {
  await ensureWorkspaceAccess(actor);
  const schedulerLink = await prisma.schedulerLink.findFirst({
    where: { id: schedulerLinkId, workspaceId: actor.workspaceId, deletedAt: null },
    select: {
      id: true,
      name: true,
      meetingTitle: true,
      description: true,
      token: true,
      isEnabled: true,
      durationMinutes: true,
      timezone: true,
      minimumNoticeMinutes: true,
      availability: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { bookings: true } }
    }
  });

  if (!schedulerLink) throw new ApiError("NOT_FOUND", "Scheduling link was not found.", 404);

  const [latestBooking, bookings] = await prisma.$transaction([
    prisma.schedulerBooking.findFirst({
      where: { workspaceId: actor.workspaceId, schedulerLinkId: schedulerLink.id },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      select: { requestedAt: true }
    }),
    prisma.schedulerBooking.findMany({
      where: { workspaceId: actor.workspaceId, schedulerLinkId: schedulerLink.id },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: RECENT_BOOKING_LIMIT,
      select: {
        id: true,
        attendeeName: true,
        attendeeEmail: true,
        attendeeCompany: true,
        attendeeNote: true,
        startAt: true,
        endAt: true,
        timezone: true,
        requestedAt: true,
        activity: {
          select: {
            id: true,
            title: true,
            deletedAt: true
          }
        },
        schedulerLink: {
          select: {
            id: true,
            name: true
          }
        }
      }
    })
  ]);

  return {
    ...schedulerLink,
    availability: normalizeAvailability(schedulerLink.availability),
    latestBookingAt: latestBooking?.requestedAt ?? null,
    bookingLimit: RECENT_BOOKING_LIMIT,
    bookings
  };
}

export async function getSchedulerBookingReview(actor: WorkspaceActor, filtersInput: SchedulerBookingReviewFiltersInput = {}) {
  await ensureWorkspaceAccess(actor);
  const schedulerLinks = await prisma.schedulerLink.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    orderBy: [{ name: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true
    }
  });
  const filters = normalizeSchedulerBookingReviewFilters(filtersInput, {
    allowedSchedulerLinkIds: new Set(schedulerLinks.map((schedulerLink) => schedulerLink.id))
  });
  const allAcceptedWhere = buildSchedulerBookingReviewWhere(actor.workspaceId, {
    activity: null,
    from: null,
    query: null,
    schedulerLinkId: null,
    to: null
  });
  const filteredWhere = buildSchedulerBookingReviewWhere(actor.workspaceId, filters);
  const [acceptedBookingCount, filteredBookingCount, bookings] = await prisma.$transaction([
    prisma.schedulerBooking.count({ where: allAcceptedWhere }),
    prisma.schedulerBooking.count({ where: filteredWhere }),
    prisma.schedulerBooking.findMany({
      where: filteredWhere,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      take: BOOKING_REVIEW_LIMIT,
      select: schedulerBookingReviewSelect
    })
  ]);

  return {
    acceptedBookingCount,
    bookingLimit: BOOKING_REVIEW_LIMIT,
    bookings,
    filteredBookingCount,
    filters,
    hasActiveFilters: hasActiveSchedulerBookingFilters(filters),
    schedulerLinks
  };
}

export async function getSchedulerBookingDetail(actor: WorkspaceActor, bookingId: string) {
  await ensureWorkspaceAccess(actor);
  const booking = await prisma.schedulerBooking.findFirst({
    where: { id: bookingId, workspaceId: actor.workspaceId },
    select: {
      id: true,
      attendeeName: true,
      attendeeEmail: true,
      attendeeCompany: true,
      attendeeNote: true,
      startAt: true,
      endAt: true,
      timezone: true,
      requestedAt: true,
      activity: {
        select: {
          id: true,
          title: true,
          type: true,
          completedAt: true,
          deletedAt: true
        }
      },
      schedulerLink: {
        select: {
          id: true,
          name: true,
          meetingTitle: true,
          durationMinutes: true,
          timezone: true,
          minimumNoticeMinutes: true,
          isEnabled: true,
          deletedAt: true
        }
      }
    }
  });

  if (!booking) throw new ApiError("NOT_FOUND", "Scheduler booking was not found.", 404);
  return booking;
}

export async function createSchedulerLink(actor: WorkspaceActor, data: SchedulerLinkInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeSchedulerLinkInput(data);
  const schedulerLink = await createUniqueSchedulerLink({
    ...normalized,
    workspaceId: actor.workspaceId,
    createdById: actor.actorUserId
  });

  await writeAuditLog(actor, "scheduler_link.created", "SchedulerLink", schedulerLink.id, {
    name: schedulerLink.name,
    isEnabled: schedulerLink.isEnabled,
    durationMinutes: schedulerLink.durationMinutes,
    timezone: schedulerLink.timezone
  });

  return schedulerLink;
}

export async function updateSchedulerLink(actor: WorkspaceActor, schedulerLinkId: string, data: SchedulerLinkUpdateInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeSchedulerLinkUpdateInput(data);
  const existing = await prisma.schedulerLink.findFirst({
    where: { id: schedulerLinkId, workspaceId: actor.workspaceId, deletedAt: null }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Scheduling link was not found.", 404);
  if (Object.keys(normalized).length === 0 || !schedulerLinkChanges(normalized, existing)) return existing;

  const schedulerLink = await prisma.schedulerLink.update({
    where: { id: existing.id },
    data: normalized
  });
  await writeAuditLog(actor, "scheduler_link.updated", "SchedulerLink", schedulerLink.id, {
    name: schedulerLink.name,
    isEnabled: schedulerLink.isEnabled,
    durationMinutes: schedulerLink.durationMinutes,
    timezone: schedulerLink.timezone
  });
  return schedulerLink;
}

export async function getPublicSchedulerLinkByToken(token: string, options: { now?: Date } = {}) {
  if (!isPublicSchedulerTokenShape(token)) {
    throw new ApiError("NOT_FOUND", "Scheduling link was not found.", 404);
  }

  const schedulerLink = await prisma.schedulerLink.findFirst({
    where: {
      token,
      isEnabled: true,
      deletedAt: null,
      workspace: { deletedAt: null }
    },
    select: {
      meetingTitle: true,
      description: true,
      durationMinutes: true,
      timezone: true,
      minimumNoticeMinutes: true,
      availability: true
    }
  });

  if (!schedulerLink) throw new ApiError("NOT_FOUND", "Scheduling link was not found.", 404);
  const availability = normalizeAvailability(schedulerLink.availability);
  return {
    meetingTitle: schedulerLink.meetingTitle,
    description: schedulerLink.description,
    durationMinutes: schedulerLink.durationMinutes,
    timezone: schedulerLink.timezone,
    minimumNoticeMinutes: schedulerLink.minimumNoticeMinutes,
    availabilityLabel: availabilityLabel(availability),
    choices: buildSchedulerChoices(
      {
        durationMinutes: schedulerLink.durationMinutes,
        timezone: schedulerLink.timezone,
        minimumNoticeMinutes: schedulerLink.minimumNoticeMinutes,
        availability
      },
      options.now
    ).map((choice) => ({
      value: choice.value,
      label: choice.label
    }))
  };
}

export async function submitPublicSchedulerBooking(
  token: string,
  data: PublicBookingInput,
  options: { now?: Date } = {}
) {
  if (!isPublicSchedulerTokenShape(token)) {
    throw new ApiError("NOT_FOUND", "Scheduling link was not found.", 404);
  }

  const schedulerLink = await prisma.schedulerLink.findFirst({
    where: {
      token,
      isEnabled: true,
      deletedAt: null,
      workspace: { deletedAt: null }
    },
    select: {
      id: true,
      workspaceId: true,
      createdById: true,
      name: true,
      meetingTitle: true,
      description: true,
      durationMinutes: true,
      timezone: true,
      minimumNoticeMinutes: true,
      availability: true
    }
  });

  if (!schedulerLink) throw new ApiError("NOT_FOUND", "Scheduling link was not found.", 404);

  const normalized = normalizePublicBookingInput(data);
  if (normalized.honeypotFilled) {
    return { blocked: true, created: false, duplicate: false, bookingId: null, activityId: null };
  }

  const availability = normalizeAvailability(schedulerLink.availability);
  const choices = buildSchedulerChoices(
    {
      durationMinutes: schedulerLink.durationMinutes,
      timezone: schedulerLink.timezone,
      minimumNoticeMinutes: schedulerLink.minimumNoticeMinutes,
      availability
    },
    options.now
  );
  const choice = choices.find((candidate) => candidate.value === normalized.startAt);
  if (!choice) {
    throw new ApiError("VALIDATION_ERROR", "Choose an available Northstar-configured time.", 422);
  }

  const fingerprint = bookingFingerprint(schedulerLink.id, normalized, choice.value);
  const duplicateAfter = new Date((options.now ?? new Date()).getTime() - DUPLICATE_WINDOW_MS);
  const duplicate = await prisma.schedulerBooking.findFirst({
    where: {
      workspaceId: schedulerLink.workspaceId,
      schedulerLinkId: schedulerLink.id,
      fingerprint,
      requestedAt: { gte: duplicateAfter }
    },
    select: { id: true, activityId: true }
  });

  if (duplicate) {
    return {
      blocked: false,
      created: false,
      duplicate: true,
      bookingId: duplicate.id,
      activityId: duplicate.activityId
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const matchedContact = await findExactContactByEmail(tx, schedulerLink.workspaceId, normalized.attendeeEmail);
    const activity = await tx.activity.create({
      data: {
        workspaceId: schedulerLink.workspaceId,
        ownerId: schedulerLink.createdById,
        personId: matchedContact?.id ?? null,
        organizationId: matchedContact?.organizationId ?? null,
        type: ActivityType.MEETING,
        title: buildMeetingActivityTitle(schedulerLink.meetingTitle, normalized.attendeeName),
        description: buildMeetingActivityDescription(schedulerLink, normalized, choice, Boolean(matchedContact)),
        dueAt: choice.startAt
      }
    });

    const booking = await tx.schedulerBooking.create({
      data: {
        workspaceId: schedulerLink.workspaceId,
        schedulerLinkId: schedulerLink.id,
        activityId: activity.id,
        fingerprint,
        attendeeName: normalized.attendeeName,
        attendeeEmail: normalized.attendeeEmail,
        attendeeCompany: normalized.attendeeCompany,
        attendeeNote: normalized.attendeeNote,
        startAt: choice.startAt,
        endAt: choice.endAt,
        timezone: schedulerLink.timezone
      }
    });

    await tx.auditLog.createMany({
      data: [
        {
          workspaceId: schedulerLink.workspaceId,
          action: "activity.created_from_scheduler",
          entityType: "Activity",
          entityId: activity.id,
          metadata: serializePublicAuditMetadata({
            schedulerLinkId: schedulerLink.id,
            schedulerLinkName: schedulerLink.name
          })
        },
        {
          workspaceId: schedulerLink.workspaceId,
          action: "scheduler.booking_received",
          entityType: "SchedulerLink",
          entityId: schedulerLink.id,
          metadata: serializePublicAuditMetadata({
            activityId: activity.id,
            schedulerBookingId: booking.id
          })
        }
      ]
    });

    return { booking, activity };
  });

  return {
    blocked: false,
    created: true,
    duplicate: false,
    bookingId: result.booking.id,
    activityId: result.activity.id
  };
}

export function generatePublicSchedulerToken() {
  return randomBytes(32).toString("base64url");
}

export function isPublicSchedulerTokenShape(token: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function defaultSchedulerAvailability() {
  return DEFAULT_AVAILABILITY.map((window) => ({ ...window }));
}

function normalizeSchedulerLinkInput(data: unknown) {
  const input = objectInput(data);
  const name = normalizeRequiredSingleLine(input.name, "Scheduling link name is required.", 120);
  return {
    name,
    meetingTitle: normalizeRequiredSingleLine(input.meetingTitle, "Meeting title is required.", 160),
    description: normalizeOptionalMultiline(input.description, "Description must be text.", 800),
    durationMinutes: normalizeDurationMinutes(input.durationMinutes),
    timezone: normalizeTimeZone(input.timezone),
    minimumNoticeMinutes: normalizeMinimumNoticeMinutes(input.minimumNoticeMinutes),
    availability: normalizeAvailabilityInput(input.availability)
  };
}

function normalizeSchedulerLinkUpdateInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Scheduling link update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    name: hasInputKey(input, "name") ? normalizeRequiredSingleLine(input.name, "Scheduling link name is required.", 120) : undefined,
    meetingTitle: hasInputKey(input, "meetingTitle")
      ? normalizeRequiredSingleLine(input.meetingTitle, "Meeting title is required.", 160)
      : undefined,
    description: hasInputKey(input, "description")
      ? normalizeOptionalMultiline(input.description, "Description must be text.", 800)
      : undefined,
    durationMinutes: hasInputKey(input, "durationMinutes") ? normalizeDurationMinutes(input.durationMinutes) : undefined,
    timezone: hasInputKey(input, "timezone") ? normalizeTimeZone(input.timezone) : undefined,
    minimumNoticeMinutes: hasInputKey(input, "minimumNoticeMinutes")
      ? normalizeMinimumNoticeMinutes(input.minimumNoticeMinutes)
      : undefined,
    availability: hasInputKey(input, "availability") ? normalizeAvailabilityInput(input.availability) : undefined,
    isEnabled: hasInputKey(input, "isEnabled") ? normalizeBoolean(input.isEnabled) : undefined
  });
}

function normalizePublicBookingInput(data: unknown) {
  const input = objectInput(data);
  const normalized = {
    startAt: normalizeRequiredSingleLine(input.startAt, "Choose an available time.", 80),
    attendeeName: normalizeRequiredSingleLine(input.attendeeName, "Name is required.", 120),
    attendeeEmail: normalizeRequiredEmail(input.attendeeEmail),
    attendeeCompany: normalizeOptionalSingleLine(input.attendeeCompany, "Company must be text.", 120),
    attendeeNote: normalizeOptionalMultiline(input.attendeeNote, "Note must be text.", 1200),
    honeypotFilled: Boolean(normalizeOptionalSingleLine(input.website, "Website must be text.", 200))
  };

  return normalized;
}

function normalizeSchedulerBookingReviewFilters(
  input: SchedulerBookingReviewFiltersInput,
  options: { allowedSchedulerLinkIds?: Set<string> } = {}
): SchedulerBookingReviewFilters {
  const query = normalizeReviewQuery(input.q);
  const from = normalizeDateFilter(input.from);
  const schedulerLinkId = normalizeSchedulerLinkFilter(input.link, options.allowedSchedulerLinkIds);
  const to = normalizeDateFilter(input.to);
  const activity = normalizeBookingActivityFilter(input.activity);

  if (from && to && dateFilterStart(from).getTime() > dateFilterEnd(to).getTime()) {
    return { activity, from: null, query, schedulerLinkId, to: null };
  }

  return { activity, from, query, schedulerLinkId, to };
}

function buildSchedulerBookingReviewWhere(
  workspaceId: string,
  filters: SchedulerBookingReviewFilters
): Prisma.SchedulerBookingWhereInput {
  const and: Prisma.SchedulerBookingWhereInput[] = [];
  if (filters.schedulerLinkId) and.push({ schedulerLinkId: filters.schedulerLinkId });

  if (filters.query) {
    const queryFilter = { contains: filters.query, mode: Prisma.QueryMode.insensitive };
    and.push({
      OR: [
        { attendeeName: queryFilter },
        { attendeeEmail: queryFilter },
        { attendeeCompany: queryFilter },
        { schedulerLink: { is: { workspaceId, name: queryFilter } } },
        { schedulerLink: { is: { workspaceId, meetingTitle: queryFilter } } }
      ]
    });
  }

  const requestedAt: Prisma.DateTimeFilter = {};
  if (filters.from) requestedAt.gte = dateFilterStart(filters.from);
  if (filters.to) requestedAt.lte = dateFilterEnd(filters.to);
  if (requestedAt.gte || requestedAt.lte) and.push({ requestedAt });

  if (filters.activity === "open") and.push({ activity: { is: { workspaceId, deletedAt: null, completedAt: null } } });
  if (filters.activity === "completed") and.push({ activity: { is: { workspaceId, deletedAt: null, completedAt: { not: null } } } });
  if (filters.activity === "unavailable") {
    and.push({
      OR: [
        { activityId: null },
        { activity: { is: { workspaceId, deletedAt: { not: null } } } }
      ]
    });
  }

  return and.length > 0 ? { workspaceId, AND: and } : { workspaceId };
}

function hasActiveSchedulerBookingFilters(filters: SchedulerBookingReviewFilters) {
  return Boolean(filters.activity || filters.from || filters.query || filters.schedulerLinkId || filters.to);
}

function normalizeReviewQuery(value: unknown) {
  const raw = firstString(value);
  if (!raw) return null;
  return truncateSingleLine(raw, 120) || null;
}

function normalizeSchedulerLinkFilter(value: unknown, allowedSchedulerLinkIds: Set<string> | undefined) {
  const raw = firstString(value);
  if (!raw) return null;
  const normalized = truncateSingleLine(raw, 120);
  if (!normalized) return null;
  if (allowedSchedulerLinkIds && !allowedSchedulerLinkIds.has(normalized)) return null;
  return normalized;
}

function normalizeBookingActivityFilter(value: unknown): SchedulerBookingActivityFilter | null {
  const raw = firstString(value);
  if (!raw || !BOOKING_ACTIVITY_FILTERS.has(raw)) return null;
  return raw as SchedulerBookingActivityFilter;
}

function normalizeDateFilter(value: unknown) {
  const raw = firstString(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return raw;
}

function dateFilterStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateFilterEnd(value: string) {
  return new Date(`${value}T23:59:59.999Z`);
}

function firstString(value: unknown) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate : null;
}

async function createUniqueSchedulerLink(data: {
  workspaceId: string;
  createdById: string;
  name: string;
  meetingTitle: string;
  description: string | null;
  durationMinutes: number;
  timezone: string;
  minimumNoticeMinutes: number;
  availability: Prisma.InputJsonValue;
}) {
  for (let attempt = 0; attempt < SCHEDULER_TOKEN_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.schedulerLink.create({
        data: {
          ...data,
          token: generatePublicSchedulerToken()
        }
      });
    } catch (error) {
      if (!isUniqueTokenCollision(error) || attempt === SCHEDULER_TOKEN_ATTEMPTS - 1) throw error;
    }
  }

  throw new ApiError("INTERNAL_ERROR", "Could not create a public scheduling link.", 500);
}

function schedulerLinkChanges(
  input: ReturnType<typeof normalizeSchedulerLinkUpdateInput>,
  existing: {
    name: string;
    meetingTitle: string;
    description: string | null;
    durationMinutes: number;
    timezone: string;
    minimumNoticeMinutes: number;
    availability: Prisma.JsonValue;
    isEnabled: boolean;
  }
) {
  if (input.name !== undefined && input.name !== existing.name) return true;
  if (input.meetingTitle !== undefined && input.meetingTitle !== existing.meetingTitle) return true;
  if (input.description !== undefined && input.description !== existing.description) return true;
  if (input.durationMinutes !== undefined && input.durationMinutes !== existing.durationMinutes) return true;
  if (input.timezone !== undefined && input.timezone !== existing.timezone) return true;
  if (input.minimumNoticeMinutes !== undefined && input.minimumNoticeMinutes !== existing.minimumNoticeMinutes) return true;
  if (input.availability !== undefined && JSON.stringify(input.availability) !== JSON.stringify(normalizeAvailability(existing.availability))) {
    return true;
  }
  if (input.isEnabled !== undefined && input.isEnabled !== existing.isEnabled) return true;
  return false;
}

function buildSchedulerChoices(
  schedulerLink: {
    durationMinutes: number;
    timezone: string;
    minimumNoticeMinutes: number;
    availability: AvailabilityWindow[];
  },
  now = new Date()
): SchedulerChoice[] {
  const earliest = new Date(now.getTime() + schedulerLink.minimumNoticeMinutes * 60 * 1000);
  const startParts = zonedDateParts(now, schedulerLink.timezone);
  const choices: SchedulerChoice[] = [];

  for (let dayOffset = 0; dayOffset < PUBLIC_CHOICE_DAYS && choices.length < PUBLIC_CHOICE_LIMIT; dayOffset += 1) {
    const localDate = new Date(Date.UTC(startParts.year, startParts.month - 1, startParts.day + dayOffset));
    const date = isoLocalDate(localDate);
    const weekday = localDate.getUTCDay();
    const windows = schedulerLink.availability.filter((window) => window.weekday === weekday);

    for (const window of windows) {
      const startMinute = timeToMinutes(window.start);
      const endMinute = timeToMinutes(window.end);
      for (let minute = startMinute; minute + schedulerLink.durationMinutes <= endMinute; minute += schedulerLink.durationMinutes) {
        const startAt = zonedDateTimeToUtc(date, minutesToTime(minute), schedulerLink.timezone);
        const endAt = new Date(startAt.getTime() + schedulerLink.durationMinutes * 60 * 1000);
        if (startAt < earliest) continue;
        choices.push({
          startAt,
          endAt,
          value: startAt.toISOString(),
          label: formatSchedulerChoice(startAt, schedulerLink.timezone)
        });
        if (choices.length >= PUBLIC_CHOICE_LIMIT) break;
      }
      if (choices.length >= PUBLIC_CHOICE_LIMIT) break;
    }
  }

  return choices;
}

function normalizeAvailabilityInput(value: unknown): Prisma.InputJsonValue {
  const windows = normalizeAvailability(value);
  if (windows.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "Add at least one availability window.", 422);
  }
  return windows as unknown as Prisma.InputJsonValue;
}

function normalizeAvailability(value: unknown): AvailabilityWindow[] {
  const source = Array.isArray(value) ? value : DEFAULT_AVAILABILITY;
  const windows = source.map((raw) => {
    const input = objectInput(raw);
    return {
      weekday: normalizeWeekday(input.weekday),
      start: normalizeTimeOfDay(input.start, "Availability start time is invalid."),
      end: normalizeTimeOfDay(input.end, "Availability end time is invalid.")
    };
  });
  const uniqueWeekdays = new Set<number>();
  const normalized: AvailabilityWindow[] = [];

  for (const window of windows) {
    if (uniqueWeekdays.has(window.weekday)) {
      throw new ApiError("VALIDATION_ERROR", "Use one availability window per weekday.", 422);
    }
    if (timeToMinutes(window.end) <= timeToMinutes(window.start)) {
      throw new ApiError("VALIDATION_ERROR", "Availability end time must be after start time.", 422);
    }
    uniqueWeekdays.add(window.weekday);
    normalized.push(window);
  }

  return normalized.sort((a, b) => a.weekday - b.weekday);
}

function normalizeWeekday(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 6) {
    throw new ApiError("VALIDATION_ERROR", "Availability weekday is invalid.", 422);
  }
  return numberValue;
}

function normalizeTimeOfDay(value: unknown, message: string) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const [hour, minute] = value.split(":").map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDurationMinutes(value: unknown) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numberValue) || numberValue < 15 || numberValue > 480 || numberValue % 5 !== 0) {
    throw new ApiError("VALIDATION_ERROR", "Meeting duration must be between 15 and 480 minutes.", 422);
  }
  return numberValue;
}

function normalizeMinimumNoticeMinutes(value: unknown) {
  if (value === undefined || value === null || value === "") return 0;
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 10080) {
    throw new ApiError("VALIDATION_ERROR", "Minimum notice must be between 0 and 10080 minutes.", 422);
  }
  return numberValue;
}

function normalizeTimeZone(value: unknown) {
  const timezone = normalizeRequiredSingleLine(value || "America/New_York", "Timezone is required.", 80);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ApiError("VALIDATION_ERROR", "Timezone is invalid.", 422);
  }
  return timezone;
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(value: number) {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const parts = zonedDateParts(guess, timeZone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess.getTime() - (zonedAsUtc - guess.getTime()));
}

function zonedDateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);

  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute")
  };
}

function isoLocalDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSchedulerChoice(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(value);
}

function availabilityLabel(windows: AvailabilityWindow[]) {
  if (windows.length === 0) return "No configured availability";
  return windows.map((window) => `${weekdayLabel(window.weekday)} ${window.start}-${window.end}`).join(", ");
}

function weekdayLabel(weekday: number) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] ?? "Day";
}

function buildMeetingActivityTitle(meetingTitle: string, attendeeName: string) {
  return truncateSingleLine(`${meetingTitle} with ${attendeeName}`, 180);
}

function buildMeetingActivityDescription(
  schedulerLink: {
    name: string;
    durationMinutes: number;
    timezone: string;
    minimumNoticeMinutes: number;
  },
  input: {
    attendeeName: string;
    attendeeEmail: string;
    attendeeCompany: string | null;
    attendeeNote: string | null;
  },
  choice: SchedulerChoice,
  matchedExistingContact: boolean
) {
  const lines = [
    `Scheduler booking request: ${schedulerLink.name}`,
    "Availability source: Northstar-configured availability only; no external calendar conflict check was performed.",
    "",
    `When: ${formatSchedulerChoice(choice.startAt, schedulerLink.timezone)}`,
    `Duration: ${schedulerLink.durationMinutes} minutes`,
    `Timezone: ${schedulerLink.timezone}`,
    "",
    `Name: ${input.attendeeName}`,
    `Email: ${input.attendeeEmail}`,
    input.attendeeCompany ? `Company: ${input.attendeeCompany}` : null,
    matchedExistingContact ? "Matched existing contact by exact email." : "No existing contact was attached.",
    input.attendeeNote ? "" : null,
    input.attendeeNote ? "Note:" : null,
    input.attendeeNote
  ].filter((line): line is string => line !== null);

  return lines.join("\n").slice(0, 5000);
}

async function findExactContactByEmail(tx: Prisma.TransactionClient, workspaceId: string, email: string) {
  const people = await tx.person.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      email: { equals: email, mode: Prisma.QueryMode.insensitive }
    },
    select: {
      id: true,
      organizationId: true
    },
    take: 2
  });

  return people.length === 1 ? people[0] : null;
}

function bookingFingerprint(
  schedulerLinkId: string,
  input: {
    attendeeName: string;
    attendeeEmail: string;
    attendeeCompany: string | null;
    attendeeNote: string | null;
  },
  startAt: string
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schedulerLinkId,
        startAt,
        attendeeName: normalizeFingerprintValue(input.attendeeName),
        attendeeEmail: normalizeFingerprintValue(input.attendeeEmail),
        attendeeCompany: normalizeFingerprintValue(input.attendeeCompany),
        attendeeNote: normalizeFingerprintValue(input.attendeeNote)
      })
    )
    .digest("hex");
}

function normalizeFingerprintValue(value: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 500);
}

function normalizeRequiredSingleLine(value: unknown, message: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = truncateSingleLine(value, maxLength);
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalSingleLine(value: unknown, message: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  return truncateSingleLine(value, maxLength) || null;
}

function truncateSingleLine(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeOptionalMultiline(value: unknown, message: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
  return trimmed || null;
}

function normalizeRequiredEmail(value: unknown) {
  const email = normalizeRequiredSingleLine(value, "Email is required.", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError("VALIDATION_ERROR", "Enter a valid email address.", 422);
  }
  return email;
}

function normalizeBoolean(value: unknown) {
  if (value === true || value === "true" || value === "on" || value === "1") return true;
  if (value === false || value === undefined || value === null || value === "" || value === "false" || value === "0") {
    return false;
  }
  throw new ApiError("VALIDATION_ERROR", "Boolean fields must be true or false.", 422);
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

function isUniqueTokenCollision(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function serializePublicAuditMetadata(metadata: unknown) {
  return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;
}
