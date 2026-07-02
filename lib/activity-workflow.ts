import { classifyActivityDue, startOfDay, type ActivityDueBucket } from "@/lib/activity-due";
import { formatPersonName } from "@/lib/person-name";

export type ActivityWorkflowRecordType = "deal" | "lead" | "person" | "organization";

export type ActivityWorkflowActivity = {
  id: string;
  title: string;
  dueAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type ActivityTimingSummary = {
  bucket: ActivityDueBucket;
  label: string;
  isOpen: boolean;
  isActionable: boolean;
};

export type ActivityAgenda<TActivity> = {
  overdue: TActivity[];
  dueToday: TActivity[];
  upcoming: TActivity[];
  unscheduled: TActivity[];
  completedRecently: TActivity[];
};

export const recentlyCompletedDays = 7;

export function getActivityDueBucket(
  activity: { dueAt?: Date | string | null; completedAt?: Date | string | null },
  now = new Date()
) {
  return classifyActivityDue(activity, now);
}

export function getActivityStatusLabel(bucket: ActivityDueBucket) {
  if (bucket === "completed") return "Completed";
  if (bucket === "overdue") return "Overdue";
  if (bucket === "today") return "Due today";
  if (bucket === "upcoming") return "Upcoming";
  return "No due date";
}

export function summarizeActivityTiming(
  activity: { dueAt?: Date | string | null; completedAt?: Date | string | null },
  now = new Date()
): ActivityTimingSummary {
  const bucket = getActivityDueBucket(activity, now);
  return {
    bucket,
    label: getActivityStatusLabel(bucket),
    isOpen: bucket !== "completed",
    isActionable: bucket === "overdue" || bucket === "today" || bucket === "unscheduled"
  };
}

export function getNextActivityForRecord<TActivity extends ActivityWorkflowActivity>(
  activities: TActivity[],
  now = new Date()
) {
  return [...activities].filter((activity) => !activity.completedAt).sort((left, right) => compareActivitiesForNextStep(left, right, now))[0] ?? null;
}

export function compareActivitiesForNextStep(
  left: ActivityWorkflowActivity,
  right: ActivityWorkflowActivity,
  now = new Date()
) {
  const leftRank = dueBucketRank(getActivityDueBucket(left, now));
  const rightRank = dueBucketRank(getActivityDueBucket(right, now));
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftDue = toTime(left.dueAt);
  const rightDue = toTime(right.dueAt);
  if (leftDue !== rightDue) return leftDue - rightDue;

  const leftCreated = toTime(left.createdAt);
  const rightCreated = toTime(right.createdAt);
  if (leftCreated !== rightCreated) return leftCreated - rightCreated;

  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

export function buildActivityAgenda<TActivity extends ActivityWorkflowActivity>(
  activities: TActivity[],
  now = new Date(),
  limit = 5
): ActivityAgenda<TActivity> {
  const sorted = [...activities].sort((left, right) => compareActivitiesForNextStep(left, right, now));
  return {
    overdue: sorted.filter((activity) => getActivityDueBucket(activity, now) === "overdue").slice(0, limit),
    dueToday: sorted.filter((activity) => getActivityDueBucket(activity, now) === "today").slice(0, limit),
    upcoming: sorted.filter((activity) => getActivityDueBucket(activity, now) === "upcoming").slice(0, limit),
    unscheduled: sorted.filter((activity) => getActivityDueBucket(activity, now) === "unscheduled").slice(0, limit),
    completedRecently: sortCompletedRecently(activities, now).slice(0, limit)
  };
}

export function isCompletedRecently(
  activity: { completedAt?: Date | string | null },
  now = new Date(),
  days = recentlyCompletedDays
) {
  const completedAt = toDate(activity.completedAt);
  if (!completedAt) return false;
  return completedAt.getTime() >= addDays(startOfDay(now), -days).getTime();
}

export function sortCompletedRecently<TActivity extends { completedAt?: Date | string | null; createdAt?: Date | string | null }>(
  activities: TActivity[],
  now = new Date()
) {
  return [...activities]
    .filter((activity) => isCompletedRecently(activity, now))
    .sort((left, right) => toTime(right.completedAt) - toTime(left.completedAt) || toTime(right.createdAt) - toTime(left.createdAt));
}

export function activityRecordContext(activity: {
  deal?: { id: string; title: string } | null;
  lead?: { id: string; title: string } | null;
  person?: { id: string; firstName: string; lastName: string | null } | null;
  organization?: { id: string; name: string } | null;
}) {
  if (activity.deal) return { type: "deal" as const, id: activity.deal.id, href: `/deals/${activity.deal.id}`, label: activity.deal.title };
  if (activity.lead) return { type: "lead" as const, id: activity.lead.id, href: `/leads/${activity.lead.id}`, label: activity.lead.title };
  if (activity.person) {
    return {
      type: "person" as const,
      id: activity.person.id,
      href: `/contacts/${activity.person.id}`,
      label: formatPersonName(activity.person) ?? "Unnamed contact"
    };
  }
  if (activity.organization) {
    return {
      type: "organization" as const,
      id: activity.organization.id,
      href: `/organizations/${activity.organization.id}`,
      label: activity.organization.name
    };
  }
  return null;
}

function dueBucketRank(bucket: ActivityDueBucket) {
  if (bucket === "overdue") return 1;
  if (bucket === "today") return 2;
  if (bucket === "upcoming") return 3;
  if (bucket === "unscheduled") return 4;
  return 5;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toTime(value: Date | string | null | undefined) {
  return toDate(value)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}
