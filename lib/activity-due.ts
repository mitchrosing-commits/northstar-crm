export type ActivityDueBucket = "completed" | "overdue" | "today" | "upcoming" | "unscheduled";

export function classifyActivityDue(
  activity: { dueAt?: Date | string | null; completedAt?: Date | string | null },
  now = new Date()
): ActivityDueBucket {
  if (activity.completedAt) return "completed";
  if (!activity.dueAt) return "unscheduled";

  const dueAt = new Date(activity.dueAt);
  if (Number.isNaN(dueAt.getTime())) return "unscheduled";

  const today = startOfDay(now);
  if (Number.isNaN(today.getTime())) return "unscheduled";
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (dueAt < today) return "overdue";
  if (dueAt < tomorrow) return "today";
  return "upcoming";
}

export function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}
