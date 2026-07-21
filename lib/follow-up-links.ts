import type { Route } from "next";

type ActivityType = "CALL" | "EMAIL" | "MEETING" | "TASK";

type FollowUpRelatedRecord = {
  id: string;
  type: "deal" | "lead" | "person" | "organization";
};

export function buildActivityFollowUpHref({
  description,
  dueInDays = 1,
  now,
  related,
  returnTo,
  title = "Follow up",
  type = "TASK"
}: {
  description?: string;
  dueInDays?: number;
  now?: Date | string;
  related: FollowUpRelatedRecord;
  returnTo?: Route | string;
  title?: string;
  type?: ActivityType;
}) {
  const params = new URLSearchParams();
  params.set("related", `${related.type}:${related.id}`);
  params.set("title", title);
  params.set("type", type);
  params.set("due", formatFutureDateParam(dueInDays, now ? new Date(now) : undefined));
  if (description) params.set("description", description);
  if (returnTo) params.set("returnTo", returnTo);
  return `/activities/new?${params.toString()}` as Route;
}

export function formatFutureDateParam(daysFromNow: number, now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}
