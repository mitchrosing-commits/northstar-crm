import { classifyActivityDue, type ActivityDueBucket } from "@/lib/activity-due";
import { formatDate } from "@/components/format";

type ActivityDueBadgeProps = {
  activity: {
    dueAt?: Date | string | null;
    completedAt?: Date | string | null;
  };
};

export function ActivityDueBadge({ activity }: ActivityDueBadgeProps) {
  const bucket = classifyActivityDue(activity);

  return <span className={`activity-due activity-due-${bucket}`}>{activityDueText(bucket, activity)}</span>;
}

function activityDueText(
  bucket: ActivityDueBucket,
  activity: { dueAt?: Date | string | null; completedAt?: Date | string | null }
) {
  if (bucket === "completed") return `Completed ${formatDate(activity.completedAt)}`;
  if (bucket === "overdue") return `Overdue ${formatDate(activity.dueAt)}`;
  if (bucket === "today") return "Due today";
  if (bucket === "upcoming") return `Due ${formatDate(activity.dueAt)}`;
  return "No due date";
}
