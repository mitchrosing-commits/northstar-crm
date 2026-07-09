import { AppShell } from "@/components/app-shell";
import { CrmAiInsightCard } from "@/components/crm-ai-insight-card";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { LeadSavedViewsPanel } from "@/components/saved-views-panel";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel } from "@/components/filter-panel";
import { FormFieldLabel } from "@/components/form-field-label";
import { formatDate } from "@/components/format";
import { ListEmptyStateActions } from "@/components/list-empty-state-actions";
import { ListNextActivitySummary } from "@/components/list-next-activity-summary";
import { ListPageHeaderActions } from "@/components/list-page-header-actions";
import { ListQuickLinksPanel } from "@/components/list-quick-links-panel";
import { ListResultsSummary } from "@/components/list-results-summary";
import { ListRowActions } from "@/components/list-row-actions";
import { ListSortControls } from "@/components/list-sort-controls";
import { ListViewStatusForState } from "@/components/list-view-status";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusBadge } from "@/components/status-badge";
import { TableScroll } from "@/components/table-scroll";
import { TableLinkedRecordCell } from "@/components/table-linked-record-cell";
import { TableOwnerCell } from "@/components/table-owner-cell";
import { TableOptionalValueCell } from "@/components/table-optional-value-cell";
import { TablePrimaryRecordCell } from "@/components/table-primary-record-cell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { leadListStateOptions, leadStatuses } from "@/lib/lead-list-state";
import { enumListViewFilter, hasActiveListViewFilters, listPageHref, parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { listResourceSearchPlaceholder } from "@/lib/list-resource-labels";
import { formatPersonName } from "@/lib/person-name";
import { prefillCreateHref } from "@/lib/search-create-actions";
import { buildLeadQualificationAiInsight, getWorkspace, listCustomFields, listCustomFieldSummaries, listLeadSavedViews, listLeads, listLeadsPage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

const followUpFilters = ["missing", "overdue", "today", "upcoming", "unscheduled"] as const;
const leadSortOptions = [
  { value: "updatedAt", label: "Updated date" },
  { value: "createdAt", label: "Created date" },
  { value: "title", label: "Title" }
] as const;

export default async function LeadsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const listState = parseListViewState(params, leadListStateOptions);
  const [leadPage, allLeads, workspaceRecord, customFieldDefinitions, savedViews] = await Promise.all([
    listLeadsPage(actor, {
      q: listState.q,
      status: enumListViewFilter(listState, "status", leadStatuses),
      source: listState.filters.source,
      ownerId: listState.filters.ownerId,
      followUp: enumListViewFilter(listState, "followUp", followUpFilters),
      customFieldId: listState.filters.customFieldId,
      customFieldOperator: listState.filters.customFieldOperator,
      customFieldValue: listState.filters.customFieldValue,
      sortBy: listState.sortBy,
      sortDirection: listState.sortDirection
    }, listState.pagination),
    listLeads(actor),
    getWorkspace(actor),
    listCustomFields(actor, { entityType: "LEAD" }),
    listLeadSavedViews(actor)
  ]);
  const leads = leadPage.items;
  const customFieldSummaries = await listCustomFieldSummaries(actor, "LEAD", leads.map((lead) => lead.id));
  const sourceOptions = Array.from(new Set(allLeads.map((lead) => lead.source).filter((source): source is string => Boolean(source)))).sort();
  const hasActiveFilters = hasActiveListViewFilters(listState);
  const createFromQueryHref = listState.q ? prefillCreateHref("/leads/new", "title", listState.q) : undefined;
  const leadAiInsight = buildLeadQualificationAiInsight(allLeads);

  return (
    <AppShell globalSearchDefaultValue={listState.q} workspace={workspace}>
      <PageHeader
        actions={
          <ListPageHeaderActions
            createHref="/leads/new"
            createLabel="New lead"
            importHref="/settings/import-export#leads-import"
            matchingCount={leadPage.total}
            resource="leads"
            searchParams={params}
            workspaceId={workspace.id}
          />
        }
        eyebrow="Prospects"
        subtitle="Early opportunities before they become pipeline deals."
        title="Leads"
      >
        <ListViewStatusForState
          label="Filtered leads view active"
          listState={listState}
          resetHref="/leads"
          searchParams={params}
          savedViews={savedViews}
        />
      </PageHeader>
      <LeadSavedViewsPanel listState={listState} savedViews={savedViews} />
      <LeadQuickFilters searchParams={params} />
      <CrmAiInsightCard insight={leadAiInsight} />

      <FilterPanel action="/leads" legend="Lead filters" pageSize={listState.pagination.pageSize} resetHref="/leads">
          <label className="form-field">
            <FormFieldLabel>Search</FormFieldLabel>
            <input name="q" placeholder={listResourceSearchPlaceholder("leads")} defaultValue={listState.q ?? ""} />
          </label>
          <label className="form-field">
            <FormFieldLabel>Status</FormFieldLabel>
            <select name="status" defaultValue={listState.filters.status ?? ""}>
              <option value="">All statuses</option>
              {leadStatuses.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <FormFieldLabel>Source</FormFieldLabel>
            <select name="source" defaultValue={listState.filters.source ?? ""}>
              <option value="">All sources</option>
              {sourceOptions.map((source) => (
                <option value={source} key={source}>
                  {source}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <FormFieldLabel>Owner</FormFieldLabel>
            <select name="ownerId" defaultValue={listState.filters.ownerId ?? ""}>
              <option value="">All owners</option>
              {workspaceRecord.memberships.map((membership) => (
                <option value={membership.user.id} key={membership.user.id}>
                  {membership.user.name ?? membership.user.email}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <FormFieldLabel>Follow-up</FormFieldLabel>
            <select name="followUp" defaultValue={listState.filters.followUp ?? ""}>
              <option value="">Any follow-up state</option>
              <option value="missing">Active leads missing next activity</option>
              <option value="overdue">Active leads with overdue activity</option>
              <option value="today">Active leads due today</option>
              <option value="upcoming">Active leads upcoming</option>
              <option value="unscheduled">Active leads with no due date</option>
            </select>
          </label>
          <CustomFieldFilterControls fields={customFieldDefinitions} params={params} />
          <ListSortControls direction={listState.sortDirection} options={[...leadSortOptions]} sortBy={listState.sortBy} />
      </FilterPanel>

      {leads.length > 0 ? (
        <section className="panel">
          <ListResultsSummary activeFilters={hasActiveFilters} label="leads" pageInfo={leadPage} />
          <TableScroll aria-label="Leads list table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Person</th>
                  <th>Organization</th>
                  <th>Next activity</th>
                  <th>Created</th>
                  <th>Custom fields</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td data-label="Lead">
                      <TablePrimaryRecordCell
                        href={`/leads/${lead.id}`}
                        linkLabel={`Open lead ${lead.title}`}
                        secondary={lead.source ?? "No source recorded"}
                        title={lead.title}
                      />
                    </td>
                    <td data-label="Source">
                      <TableOptionalValueCell emptyLabel="No source" value={lead.source} />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td data-label="Owner">
                      <TableOwnerCell owner={lead.owner} />
                    </td>
                    <td data-label="Person">
                      <TableLinkedRecordCell
                        emptyLabel="No contact"
                        href={lead.person ? `/contacts/${lead.person.id}` : undefined}
                        linkLabel={lead.person ? `Open contact ${formatPersonName(lead.person) ?? "Unnamed contact"}` : undefined}
                      >
                        {formatPersonName(lead.person)}
                      </TableLinkedRecordCell>
                    </td>
                    <td data-label="Organization">
                      <TableLinkedRecordCell
                        emptyLabel="No organization"
                        href={lead.organization ? `/organizations/${lead.organization.id}` : undefined}
                        linkLabel={lead.organization ? `Open organization ${lead.organization.name}` : undefined}
                      >
                        {lead.organization?.name}
                      </TableLinkedRecordCell>
                    </td>
                    <td data-label="Next activity">
                      <ListNextActivitySummary activity={lead.activities[0]} emptyLabel="No lead follow-up" />
                    </td>
                    <td data-label="Created">{formatDate(lead.createdAt)}</td>
                    <td data-label="Custom fields">
                      <CustomFieldSummaryCell
                        emptyConfiguredLabel="No lead fields"
                        emptyFilledLabel="No lead values"
                        fields={customFieldSummaries.get(lead.id) ?? []}
                      />
                    </td>
                    <td className="table-actions-cell" data-label="Actions">
                      <ListRowActions
                        aria-label={`${lead.title} lead row actions`}
                        actions={[
                          { href: `/leads/${lead.id}`, label: "Open lead", ariaLabel: `Open lead ${lead.title}` },
                          ...(lead.status !== "CONVERTED"
                            ? [
                                {
                                  href: buildActivityFollowUpHref({
                                    related: { type: "lead", id: lead.id },
                                    returnTo: listPageHref("/leads", params),
                                    title: `Follow up: ${lead.title}`
                                  }),
                                  label: "Add activity",
                                  ariaLabel: `Add activity for lead ${lead.title}`
                                }
                              ]
                            : []),
                          { href: `/leads/${lead.id}/edit`, label: "Edit", ariaLabel: `Edit lead ${lead.title}` }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <PaginationControls basePath="/leads" pageInfo={leadPage} searchParams={params} />
        </section>
      ) : (
        <EmptyState
          actions={
            <ListEmptyStateActions
              clearHref="/leads"
              createFromQueryHref={createFromQueryHref}
              createFromQueryLabel="Create lead from search"
              createHref="/leads/new"
              createLabel="Create lead"
              hasActiveFilters={hasActiveFilters}
              resultLabel="leads"
            />
          }
          as="section"
          titleId="leads-empty-title"
          description={
            hasActiveFilters
              ? "Adjust or reset the active filters to see more leads."
              : "Create a lead to start tracking early sales opportunities."
          }
          title={hasActiveFilters ? "No leads match these filters" : "No leads yet"}
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function LeadQuickFilters({ searchParams }: { searchParams: ListSearchParams }) {
  const links = [
    { href: "/leads?status=NEW", label: "New leads" },
    { href: "/leads?status=QUALIFIED", label: "Open qualified" },
    { href: "/leads?followUp=missing", label: "Needs activity" },
    { href: "/leads?followUp=overdue", label: "Overdue follow-ups" },
    { href: "/leads?followUp=today", label: "Due today" },
    { href: "/leads?status=CONVERTED", label: "Converted" },
    { href: "/leads?sortBy=createdAt&sortDirection=desc", label: "Recently created" }
  ] as const;

  return (
    <ListQuickLinksPanel
      ariaLabel="Lead quick filters"
      currentPath="/leads"
      headingId="lead-quick-filters-title"
      hint="Use common lead status shortcuts without building a custom saved view first."
      links={links}
      searchParams={searchParams}
      title="Quick lead filters"
    />
  );
}
