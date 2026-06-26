import Link from "next/link";
import type { Route } from "next";

import { ActivityList } from "@/components/activity-list";
import { AppShell } from "@/components/app-shell";
import { FilterPanel } from "@/components/filter-panel";
import { PaginationControls } from "@/components/pagination-controls";
import { buildActivityQuickLinks, type ActivityQuickLink } from "@/lib/activity-quick-links";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { enumSearchParam, getSearchParam, hasActiveListFilters, parsePagination, type ListSearchParams } from "@/lib/list-page-query";
import { getActivityWorkQueueSummary, getWorkspace, listActivities, listActivitiesPage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

const activityStatuses = ["open", "completed"] as const;
const dueBuckets = ["overdue", "today", "upcoming"] as const;
const activitySorts = ["dueAt", "createdAt", "updatedAt", "title"] as const;
const sortDirections = ["asc", "desc"] as const;

export default async function ActivitiesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const related = parseRelated(getSearchParam(params, "related"));
  const pagination = parsePagination(params);
  const [activityPage, allActivities, workspaceRecord, workQueueSummary] = await Promise.all([
    listActivitiesPage(actor, {
      status: enumSearchParam(params, "status", activityStatuses),
      ownerId: getSearchParam(params, "ownerId") || undefined,
      relatedType: related?.type,
      relatedId: related?.id,
      due: enumSearchParam(params, "due", dueBuckets),
      sortBy: enumSearchParam(params, "sortBy", activitySorts),
      sortDirection: enumSearchParam(params, "sortDirection", sortDirections)
    }, pagination),
    listActivities(actor),
    getWorkspace(actor),
    getActivityWorkQueueSummary(actor)
  ]);
  const activities = activityPage.items;
  const relatedOptions = buildRelatedOptions(allActivities);
  const hasActiveFilters = hasActiveListFilters(params, ["status", "ownerId", "related", "due"]);
  const quickLinks = buildActivityQuickLinks(actorUserId);

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Work queue</p>
          <h1 className="page-title">Activities</h1>
        </div>
        <Link className="button-primary" href="/activities/new">
          New activity
        </Link>
      </header>

      <section className="stat-grid">
        <MetricCard label="Overdue" value={workQueueSummary.overdue} />
        <MetricCard label="Due today" value={workQueueSummary.dueToday} />
        <MetricCard label="Upcoming" value={workQueueSummary.upcoming} />
        <MetricCard label="Open total" value={workQueueSummary.openTotal} />
      </section>

      <ActivityQuickLinks links={quickLinks} />

      <FilterPanel action="/activities" resetHref="/activities">
          <label className="form-field">
            <span>Status</span>
            <select name="status" defaultValue={getSearchParam(params, "status")}>
              <option value="">All statuses</option>
              <option value="open">Open activities</option>
              <option value="completed">Completed activities</option>
            </select>
          </label>
          <label className="form-field">
            <span>Due</span>
            <select name="due" defaultValue={getSearchParam(params, "due")}>
              <option value="">Any due date</option>
              <option value="overdue">Open overdue</option>
              <option value="today">Open due today</option>
              <option value="upcoming">Open upcoming</option>
            </select>
            <small className="form-hint">Due filters show open activities only.</small>
          </label>
          <label className="form-field">
            <span>Owner</span>
            <select name="ownerId" defaultValue={getSearchParam(params, "ownerId")}>
              <option value="">All owners</option>
              {workspaceRecord.memberships.map((membership) => (
                <option value={membership.user.id} key={membership.user.id}>
                  {membership.user.name ?? membership.user.email}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Related record</span>
            <select name="related" defaultValue={getSearchParam(params, "related")}>
              <option value="">Any related record</option>
              {relatedOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <SortControls params={params} />
      </FilterPanel>
      <section className="panel">
        {activities.length > 0 ? (
          <>
            <ActivityList activities={activities} showCompleteAction workspaceId={workspace.id} />
            <PaginationControls basePath="/activities" pageInfo={activityPage} searchParams={params} />
          </>
        ) : (
          <div className="empty-state empty-state-compact">
            <p>
              {hasActiveFilters
                ? "No activities match these filters. Clear filters to return to the full work queue."
                : "No activities yet. Create a follow-up to plan the next call, email, meeting, or task."}
            </p>
            {!hasActiveFilters ? (
              <Link className="text-link" href="/activities/new">
                Create activity
              </Link>
            ) : null}
          </div>
        )}
      </section>
    </AppShell>
  );
}

type ActivityWithLinks = Awaited<ReturnType<typeof listActivities>>[number];
type RelatedFilter = {
  type: "deal" | "lead" | "person" | "organization";
  id: string;
};

function parseRelated(value: string): RelatedFilter | undefined {
  const [type, id] = value.split(":");
  if (!id) return undefined;
  if (type === "deal" || type === "lead" || type === "person" || type === "organization") {
    return { type, id };
  }
  return undefined;
}

function buildRelatedOptions(activities: ActivityWithLinks[]) {
  const options = new Map<string, string>();
  for (const activity of activities) {
    if (activity.deal) options.set(`deal:${activity.deal.id}`, `Deal: ${activity.deal.title}`);
    if (activity.lead) options.set(`lead:${activity.lead.id}`, `Lead: ${activity.lead.title}`);
    if (activity.person) options.set(`person:${activity.person.id}`, `Contact: ${formatPersonName(activity.person)}`);
    if (activity.organization) options.set(`organization:${activity.organization.id}`, `Organization: ${activity.organization.name}`);
  }
  return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function SortControls({ params }: { params: ListSearchParams }) {
  return (
    <>
      <label className="form-field">
        <span>Sort by</span>
        <select name="sortBy" defaultValue={getSearchParam(params, "sortBy") || "dueAt"}>
          <option value="dueAt">Due date</option>
          <option value="createdAt">Created date</option>
          <option value="updatedAt">Updated date</option>
          <option value="title">Title</option>
        </select>
      </label>
      <label className="form-field">
        <span>Direction</span>
        <select name="sortDirection" defaultValue={getSearchParam(params, "sortDirection") || "asc"}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
    </>
  );
}

function ActivityQuickLinks({ links }: { links: ActivityQuickLink[] }) {
  return (
    <section className="panel saved-views-panel" aria-labelledby="activity-quick-links-title">
      <div className="saved-views-header">
        <div>
          <h2 className="panel-title" id="activity-quick-links-title">
            Quick activity links
          </h2>
          <p className="form-hint">Due quick links show open activities only.</p>
        </div>
      </div>
      <ul className="saved-view-list" aria-label="Activity quick links">
        {links.map((link) => (
          <li className="saved-view-item" key={link.href}>
            <Link className="inline-link" href={link.href as Route}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
    </div>
  );
}
