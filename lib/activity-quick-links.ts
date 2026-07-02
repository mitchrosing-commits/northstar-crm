export type ActivityQuickLinkFilter = {
  completed?: "recent";
  due?: "overdue" | "today" | "upcoming" | "unscheduled";
  ownerId?: string;
  status?: "open" | "completed";
};

export type ActivityQuickLink = {
  href: string;
  label: string;
};

export function activityQuickLinkHref(filters: ActivityQuickLinkFilter) {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.completed) params.set("completed", filters.completed);
  if (filters.due) params.set("due", filters.due);
  if (filters.ownerId) params.set("ownerId", filters.ownerId);

  const query = params.toString();
  return query ? `/activities?${query}` : "/activities";
}

export function buildActivityQuickLinks(actorUserId: string): ActivityQuickLink[] {
  return [
    { label: "My open", href: activityQuickLinkHref({ status: "open", ownerId: actorUserId }) },
    { label: "Overdue", href: activityQuickLinkHref({ status: "open", due: "overdue" }) },
    { label: "Due today", href: activityQuickLinkHref({ status: "open", due: "today" }) },
    { label: "Upcoming", href: activityQuickLinkHref({ status: "open", due: "upcoming" }) },
    { label: "No due date", href: activityQuickLinkHref({ status: "open", due: "unscheduled" }) },
    { label: "Completed recently", href: activityQuickLinkHref({ status: "completed", completed: "recent" }) }
  ];
}
