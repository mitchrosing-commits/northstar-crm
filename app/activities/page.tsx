import Link from "next/link";

import { ActivityList } from "@/components/activity-list";
import { AppShell } from "@/components/app-shell";
import { CompactTitleRow } from "@/components/compact-title-row";
import { CountBadge } from "@/components/count-badge";
import { CrmAiInsightCard } from "@/components/crm-ai-insight-card";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel } from "@/components/filter-panel";
import { FormFieldLabel } from "@/components/form-field-label";
import { ListEmptyStateActions } from "@/components/list-empty-state-actions";
import { ListPageHeaderActions } from "@/components/list-page-header-actions";
import { ListQuickLinksPanel } from "@/components/list-quick-links-panel";
import { ListResultsSummary } from "@/components/list-results-summary";
import { ListSortControls } from "@/components/list-sort-controls";
import { ListViewStatus } from "@/components/list-view-status";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { PaginationControls } from "@/components/pagination-controls";
import { StatCard } from "@/components/stat-card";
import { activityQuickLinkHref, buildActivityQuickLinks, type ActivityQuickLink } from "@/lib/activity-quick-links";
import { buildActivityAgenda } from "@/lib/activity-workflow";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { enumSearchParam, getSearchParam, hasActiveListFilters, parsePagination, type ListSearchParams } from "@/lib/list-page-query";
import { listResourceSearchPlaceholder } from "@/lib/list-resource-labels";
import { formatPersonName } from "@/lib/person-name";
import { prefillCreateHref } from "@/lib/search-create-actions";
import { buildActivityQueueAiInsight } from "@/lib/services/crm-ai-insight-service";
import { getActivityWorkQueueSummary, listActivities, listActivitiesPage } from "@/lib/services/activity-service";
import { getWorkspace } from "@/lib/services/workspace-service";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

const activityStatuses = ["open", "completed"] as const;
const dueBuckets = ["overdue", "today", "upcoming", "unscheduled"] as const;
const completedFilters = ["recent"] as const;
const activitySorts = ["dueAt", "createdAt", "updatedAt", "title", "completedAt"] as const;
const sortDirections = ["asc", "desc"] as const;
const activitySortOptions = [
  { value: "dueAt", label: "Due date" },
  { value: "completedAt", label: "Completed date" },
  { value: "createdAt", label: "Created date" },
  { value: "updatedAt", label: "Updated date" },
  { value: "title", label: "Title" }
] as const;

export default async function ActivitiesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const related = parseRelated(getSearchParam(params, "related"));
  const pagination = parsePagination(params);
  const [activityPage, allActivities, workspaceRecord, workQueueSummary] = await Promise.all([
    listActivitiesPage(actor, {
      q: getSearchParam(params, "q") || undefined,
      status: enumSearchParam(params, "status", activityStatuses),
      ownerId: getSearchParam(params, "ownerId") || undefined,
      relatedType: related?.type,
      relatedId: related?.id,
      due: enumSearchParam(params, "due", dueBuckets),
      completed: enumSearchParam(params, "completed", completedFilters),
      sortBy: enumSearchParam(params, "sortBy", activitySorts),
      sortDirection: enumSearchParam(params, "sortDirection", sortDirections)
    }, pagination),
    listActivities(actor),
    getWorkspace(actor),
    getActivityWorkQueueSummary(actor)
  ]);
  const activities = activityPage.items;
  const relatedOptions = buildRelatedOptions(allActivities);
  const hasActiveFilters = hasActiveListFilters(params, ["q", "status", "ownerId", "related", "due", "completed"]);
  const quickLinks = buildActivityQuickLinks(actorUserId);
  const agenda = buildActivityAgenda(allActivities);
  const selectedStatus = selectedActivityStatus(params);
  const activityQuery = getSearchParam(params, "q");
  const createFromQueryHref = activityQuery ? prefillCreateHref("/activities/new", "title", activityQuery) : undefined;
  const activityAiInsight = buildActivityQueueAiInsight({
    hasActiveFilters,
    query: activityQuery || undefined,
    summary: workQueueSummary,
    visibleActivities: activities
  });

  return (
    <AppShell globalSearchDefaultValue={activityQuery || undefined} workspace={workspace}>
      <PageHeader
        actions={
          <ListPageHeaderActions
            createHref="/activities/new"
            createLabel="New activity"
            matchingCount={activityPage.total}
            resource="activities"
            searchParams={params}
            workspaceId={workspace.id}
          />
        }
        eyebrow="Work queue"
        subtitle="Calls, emails, meetings, and tasks that keep CRM records moving."
        title="Activities"
      >
        <ListViewStatus active={hasActiveFilters} label="Filtered activities view active" resetHref="/activities" />
      </PageHeader>

      <section className="stat-grid">
        <MetricCard href={activityQuickLinkHref({ status: "open", due: "overdue" })} label="Overdue" value={workQueueSummary.overdue} />
        <MetricCard href={activityQuickLinkHref({ status: "open", due: "today" })} label="Due today" value={workQueueSummary.dueToday} />
        <MetricCard href={activityQuickLinkHref({ status: "open", due: "upcoming" })} label="Upcoming" value={workQueueSummary.upcoming} />
        <MetricCard href={activityQuickLinkHref({ status: "open", due: "unscheduled" })} label="No due date" value={workQueueSummary.unscheduled} />
        <MetricCard
          href={activityQuickLinkHref({ status: "completed", completed: "recent" })}
          label="Completed recently"
          value={workQueueSummary.completedRecently}
        />
        <MetricCard href={activityQuickLinkHref({ status: "open" })} label="Open total" value={workQueueSummary.openTotal} />
      </section>

      <ActivityQuickLinks links={quickLinks} searchParams={params} />

      <CrmAiInsightCard insight={activityAiInsight} />

      <ActivityAgendaPanel agenda={agenda} workspaceId={workspace.id} />

      <FilterPanel action="/activities" legend="Activity filters" pageSize={pagination.pageSize} resetHref="/activities">
          <label className="form-field">
            <FormFieldLabel>Search</FormFieldLabel>
            <input
              defaultValue={getSearchParam(params, "q")}
              name="q"
              placeholder={listResourceSearchPlaceholder("activities")}
            />
          </label>
          <label className="form-field">
            <FormFieldLabel>Status</FormFieldLabel>
            <select name="status" defaultValue={selectedStatus}>
              <option value="">All statuses</option>
              <option value="open">Open activities</option>
              <option value="completed">Completed activities</option>
            </select>
          </label>
          <label className="form-field">
            <FormFieldLabel>Due</FormFieldLabel>
            <select name="due" defaultValue={getSearchParam(params, "due")}>
              <option value="">Any due date</option>
              <option value="overdue">Open overdue</option>
              <option value="today">Open due today</option>
              <option value="upcoming">Open upcoming</option>
              <option value="unscheduled">Open with no due date</option>
            </select>
            <small className="form-hint">Due filters show open activities only.</small>
          </label>
          <label className="form-field">
            <FormFieldLabel>Completed</FormFieldLabel>
            <select name="completed" defaultValue={getSearchParam(params, "completed")}>
              <option value="">Any completed date</option>
              <option value="recent">Completed in the last 7 days</option>
            </select>
            <small className="form-hint">Recent completion applies to completed activities only.</small>
          </label>
          <label className="form-field">
            <FormFieldLabel>Owner</FormFieldLabel>
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
            <FormFieldLabel>Related record</FormFieldLabel>
            <select name="related" defaultValue={getSearchParam(params, "related")}>
              <option value="">Any related record</option>
              {relatedOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <ListSortControls
            direction={enumSearchParam(params, "sortDirection", sortDirections) ?? "asc"}
            directionOptions={["asc", "desc"]}
            options={[...activitySortOptions]}
            sortBy={enumSearchParam(params, "sortBy", activitySorts) ?? "dueAt"}
          />
      </FilterPanel>
      <section className="panel">
        {activities.length > 0 ? (
          <>
            <ListResultsSummary activeFilters={hasActiveFilters} label="activities" pageInfo={activityPage} />
            <ActivityList activities={activities} showCompleteAction workspaceId={workspace.id} />
            <PaginationControls basePath="/activities" pageInfo={activityPage} searchParams={params} />
          </>
        ) : (
          <EmptyState
            actions={
              <ListEmptyStateActions
                clearHref="/activities"
                createFromQueryHref={createFromQueryHref}
                createFromQueryLabel="Create activity from search"
                createHref="/activities/new"
                createLabel="Create activity"
                hasActiveFilters={hasActiveFilters}
                resultLabel="activities"
              />
            }
            className="empty-state-compact"
            description={
              hasActiveFilters
                ? "No activities match this search or these filters. Clear filters to return to the full work queue."
                : "No activities yet. Create a follow-up to plan the next call, email, meeting, or task."
            }
            title={hasActiveFilters ? "No activities match these filters" : "No activities yet"}
            titleId="activities-empty-title"
          />
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
  unscheduled: ActivityWithLinks[];
  completedRecently: ActivityWithLinks[];
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
    if (activity.person) options.set(`person:${activity.person.id}`, `Contact: ${formatPersonName(activity.person) ?? "Unnamed contact"}`);
    if (activity.organization) options.set(`organization:${activity.organization.id}`, `Organization: ${activity.organization.name}`);
  }
  return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

function selectedActivityStatus(params: ListSearchParams) {
  const explicitStatus = getSearchParam(params, "status");
  if (explicitStatus) return explicitStatus;
  if (getSearchParam(params, "completed")) return "completed";
  return getSearchParam(params, "due") ? "open" : "";
}

function ActivityAgendaPanel({ agenda, workspaceId }: { agenda: ActivityAgenda; workspaceId: string }) {
  const sections = [
    { activities: agenda.overdue, title: "Overdue", empty: "No overdue activities." },
    { activities: agenda.dueToday, title: "Due today", empty: "Nothing due today." },
    { activities: agenda.upcoming, title: "Upcoming", empty: "No upcoming activities scheduled." },
    { activities: agenda.unscheduled, title: "No due date", empty: "All open activities have due dates." },
    { activities: agenda.completedRecently, title: "Completed recently", empty: "Completed activities from the last 7 days will appear here." }
  ] as const;
  const addActivityActionLabel = "Add activity from My Day Agenda";

  return (
    <section className="panel activity-agenda-panel" aria-labelledby="activity-agenda-title">
      <PanelTitleRow
        actions={
          <Link
            aria-label={addActivityActionLabel}
            className="button-secondary button-compact"
            href="/activities/new"
            title={addActivityActionLabel}
          >
            Add activity
          </Link>
        }
        description="A quick look at what needs action before using filters below."
        title="My Day Agenda"
        titleId="activity-agenda-title"
      />
      <div className="activity-agenda-grid">
        {sections.map((section) => {
          const activityCountLabel = `${section.activities.length} ${section.title.toLowerCase()} ${
            section.activities.length === 1 ? "activity" : "activities"
          }`;

          return (
            <div className="activity-agenda-section" key={section.title}>
              <CompactTitleRow
                actions={
                  <CountBadge className="badge" label={activityCountLabel}>
                    {section.activities.length}
                  </CountBadge>
                }
                actionsLabel={`${section.title} activity count`}
                title={section.title}
              />
              {section.activities.length > 0 ? (
                <ActivityList activities={section.activities} showCompleteAction workspaceId={workspaceId} />
              ) : (
                <EmptyState className="empty-state-compact activity-agenda-empty" title={section.empty} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActivityQuickLinks({ links, searchParams }: { links: ActivityQuickLink[]; searchParams: ListSearchParams }) {
  return (
    <ListQuickLinksPanel
      ariaLabel="Activity quick links"
      currentPath="/activities"
      headingId="activity-quick-links-title"
      hint="Due quick links show open activities only."
      links={links}
      searchParams={searchParams}
      title="Quick activity links"
    />
  );
}

function MetricCard({ href, label, value }: { href: string; label: string; value: number }) {
  return <StatCard actionLabel={`View ${label.toLowerCase()} activities`} href={href} label={label} value={value} />;
}
