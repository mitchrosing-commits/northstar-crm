import Link from "next/link";
import type { Route } from "next";

import { ActivityList } from "@/components/activity-list";
import { AppShell } from "@/components/app-shell";
import { FilterPanel } from "@/components/filter-panel";
import { PaginationControls } from "@/components/pagination-controls";
import { classifyActivityDue } from "@/lib/activity-due";
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
  const agenda = buildActivityAgenda(allActivities);

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

      <ActivityAgendaPanel agenda={agenda} workspaceId={workspace.id} />

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
type ActivityAgenda = {
  overdue: ActivityWithLinks[];
  dueToday: ActivityWithLinks[];
  upcoming: ActivityWithLinks[];
  completed: ActivityWithLinks[];
};
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

function buildActivityAgenda(activities: ActivityWithLinks[]): ActivityAgenda {
  return {
    overdue: activities.filter((activity) => !activity.completedAt && classifyActivityDue(activity) === "overdue").slice(0, 5),
    dueToday: activities.filter((activity) => !activity.completedAt && classifyActivityDue(activity) === "today").slice(0, 5),
    upcoming: activities.filter((activity) => !activity.completedAt && classifyActivityDue(activity) === "upcoming").slice(0, 5),
    completed: activities.filter((activity) => activity.completedAt).slice(0, 5)
  };
}

function ActivityAgendaPanel({ agenda, workspaceId }: { agenda: ActivityAgenda; workspaceId: string }) {
  const sections = [
    { activities: agenda.overdue, title: "Overdue", empty: "No overdue activities." },
    { activities: agenda.dueToday, title: "Due today", empty: "Nothing due today." },
    { activities: agenda.upcoming, title: "Upcoming", empty: "No upcoming activities scheduled." },
    { activities: agenda.completed, title: "Recently completed", empty: "Completed activities will appear here." }
  ] as const;

  return (
    <section className="panel activity-agenda-panel" aria-labelledby="activity-agenda-title">
      <div className="panel-title-row">
        <div>
          <h2 className="panel-title" id="activity-agenda-title">
            My Day Agenda
          </h2>
          <p className="form-hint">A quick look at what needs action before using filters below.</p>
        </div>
        <Link className="button-secondary button-compact" href="/activities/new">
          Add activity
        </Link>
      </div>
      <div className="activity-agenda-grid">
        {sections.map((section) => (
          <div className="activity-agenda-section" key={section.title}>
            <div className="panel-title-row">
              <h3 className="compact-title">{section.title}</h3>
              <span className="badge">{section.activities.length}</span>
            </div>
            {section.activities.length > 0 ? (
              <ActivityList activities={section.activities} showCompleteAction workspaceId={workspaceId} />
            ) : (
              <p className="empty-copy">{section.empty}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
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
