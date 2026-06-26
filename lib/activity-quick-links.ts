export type ActivityQuickLinkFilter = {
  due?: "overdue" | "today" | "upcoming";
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
  if (filters.due) params.set("due", filters.due);
  if (filters.ownerId) params.set("ownerId", filters.ownerId);

  const query = params.toString();
  return query ? `/activities?${query}` : "/activities";
}

export function buildActivityQuickLinks(actorUserId: string): ActivityQuickLink[] {
  return [
    { label: "My open", href: activityQuickLinkHref({ status: "open", ownerId: actorUserId }) },
    { label: "Overdue", href: activityQuickLinkHref({ due: "overdue" }) },
    { label: "Due today", href: activityQuickLinkHref({ due: "today" }) },
    { label: "Upcoming", href: activityQuickLinkHref({ due: "upcoming" }) },
    { label: "Completed", href: activityQuickLinkHref({ status: "completed" }) }
  ];
}
