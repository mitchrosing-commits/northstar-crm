import Link from "next/link";
import type { Route } from "next";

import { ActivityDueBadge } from "@/components/activity-due-badge";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";

export type ListNextActivity = {
  id?: string;
  title: string;
  dueAt: Date | string | null;
  completedAt?: Date | string | null;
};

type ListNextActivitySummaryProps = {
  activity?: ListNextActivity | null;
  emptyLabel?: string;
};

export function ListNextActivitySummary({
  activity,
  emptyLabel = "No open activity"
}: ListNextActivitySummaryProps) {
  if (!activity) return <InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>;
  const activityLabel = `Open next activity ${activity.title}`;
  const activityTitle = <strong>{activity.title}</strong>;

  return (
    <div className="next-activity-summary">
      {activity.id ? (
        <Link
          aria-label={activityLabel}
          className="inline-link next-activity-summary-link"
          href={`/activities/${activity.id}/edit` as Route}
          title={activityLabel}
        >
          {activityTitle}
        </Link>
      ) : (
        activityTitle
      )}
      <ActivityDueBadge activity={activity} />
    </div>
  );
}
