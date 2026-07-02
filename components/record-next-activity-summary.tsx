import Link from "next/link";
import type { Route } from "next";

import { ActivityDueBadge } from "@/components/activity-due-badge";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { getNextActivityForRecord } from "@/lib/activity-workflow";

export type RecordNextActivity = {
  id: string;
  title: string;
  dueAt: Date | string | null;
  completedAt: Date | string | null;
};

type RecordNextActivitySummaryProps = {
  activity?: RecordNextActivity | null;
  emptyLabel?: string;
};

export function RecordNextActivitySummary({
  activity,
  emptyLabel = "No open follow-up"
}: RecordNextActivitySummaryProps) {
  if (!activity) return <InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>;
  const activityLabel = `Open next follow-up ${activity.title}`;

  return (
    <span className="record-summary-stack">
      <Link
        aria-label={activityLabel}
        className="inline-link"
        href={`/activities/${activity.id}/edit` as Route}
        title={activityLabel}
      >
        {activity.title}
      </Link>
      <ActivityDueBadge activity={activity} />
    </span>
  );
}

export function getNextOpenActivity<TActivity extends RecordNextActivity>(activities: TActivity[]) {
  return getNextActivityForRecord(activities);
}
