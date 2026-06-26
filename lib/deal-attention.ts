import { classifyActivityDue } from "@/lib/activity-due";

export type DealAttentionBucket = "overdue" | "today" | "upcoming" | "unscheduled" | "none";

export type DealAttentionInput = {
  activities?: Array<{
    dueAt?: Date | string | null;
    completedAt?: Date | string | null;
  }>;
};

export function classifyDealAttention(deal: DealAttentionInput, now = new Date()): DealAttentionBucket {
  const nextActivity = deal.activities?.[0];
  if (!nextActivity) return "none";

  const dueBucket = classifyActivityDue(nextActivity, now);
  if (dueBucket === "overdue" || dueBucket === "today" || dueBucket === "upcoming") return dueBucket;
  return "unscheduled";
}

export function dealAttentionLabel(bucket: DealAttentionBucket) {
  if (bucket === "overdue") return "Overdue activity";
  if (bucket === "today") return "Due today";
  if (bucket === "upcoming") return "Next activity set";
  if (bucket === "unscheduled") return "Next unscheduled";
  return "No next activity";
}
