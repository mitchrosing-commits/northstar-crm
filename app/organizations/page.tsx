import { AppShell } from "@/components/app-shell";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { OrganizationSavedViewsPanel } from "@/components/saved-views-panel";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel } from "@/components/filter-panel";
import { FormFieldLabel } from "@/components/form-field-label";
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
import { TableScroll } from "@/components/table-scroll";
import { TableOwnerCell } from "@/components/table-owner-cell";
import { TableOptionalValueCell } from "@/components/table-optional-value-cell";
import { TablePrimaryRecordCell } from "@/components/table-primary-record-cell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { hasActiveListViewFilters, listPageHref, parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { listResourceSearchPlaceholder } from "@/lib/list-resource-labels";
import { organizationListStateOptions } from "@/lib/organization-list-state";
import { prefillCreateHref } from "@/lib/search-create-actions";
import { getWorkspace, listCustomFields, listCustomFieldSummaries, listOrganizationSavedViews, listOrganizationsPage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

const organizationSortOptions = [
  { value: "name", label: "Name" },
  { value: "createdAt", label: "Created date" },
  { value: "updatedAt", label: "Updated date" }
] as const;

export default async function OrganizationsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const listState = parseListViewState(params, organizationListStateOptions);
  const [organizationPage, workspaceRecord, customFieldDefinitions, savedViews] = await Promise.all([
    listOrganizationsPage(actor, {
      q: listState.q,
      ownerId: listState.filters.ownerId,
      customFieldId: listState.filters.customFieldId,
      customFieldOperator: listState.filters.customFieldOperator,
      customFieldValue: listState.filters.customFieldValue,
      sortBy: listState.sortBy,
      sortDirection: listState.sortDirection
    }, listState.pagination),
    getWorkspace(actor),
    listCustomFields(actor, { entityType: "ORGANIZATION" }),
    listOrganizationSavedViews(actor)
  ]);
  const organizations = organizationPage.items;
  const customFieldSummaries = await listCustomFieldSummaries(
    actor,
    "ORGANIZATION",
    organizations.map((organization) => organization.id)
  );
  const hasActiveFilters = hasActiveListViewFilters(listState);
  const createFromQueryHref = listState.q ? prefillCreateHref("/organizations/new", "name", listState.q) : undefined;

  return (
    <AppShell globalSearchDefaultValue={listState.q} workspace={workspace}>
      <PageHeader
        actions={
          <ListPageHeaderActions
            createHref="/organizations/new"
            createLabel="New organization"
            importHref="/settings/import-export#organizations-import"
            matchingCount={organizationPage.total}
            resource="organizations"
            searchParams={params}
            workspaceId={workspace.id}
          />
        }
        eyebrow="Companies"
        subtitle="Accounts that group people, deals, activities, notes, and history."
        title="Organizations"
      >
        <ListViewStatusForState
          label="Filtered organizations view active"
          listState={listState}
          resetHref="/organizations"
          searchParams={params}
          savedViews={savedViews}
        />
      </PageHeader>
      <OrganizationSavedViewsPanel listState={listState} savedViews={savedViews} />
      <OrganizationQuickFilters actorUserId={actorUserId} searchParams={params} />

      <FilterPanel action="/organizations" legend="Organization filters" pageSize={listState.pagination.pageSize} resetHref="/organizations">
          <label className="form-field">
            <FormFieldLabel>Search</FormFieldLabel>
            <input name="q" placeholder={listResourceSearchPlaceholder("organizations")} defaultValue={listState.q ?? ""} />
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
          <CustomFieldFilterControls fields={customFieldDefinitions} params={params} />
          <ListSortControls
            direction={listState.sortDirection}
            directionOptions={["asc", "desc"]}
            options={[...organizationSortOptions]}
            sortBy={listState.sortBy}
          />
      </FilterPanel>
      {organizations.length > 0 ? (
        <section className="panel">
          <ListResultsSummary activeFilters={hasActiveFilters} label="organizations" pageInfo={organizationPage} />
          <TableScroll aria-label="Organizations list table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Domain</th>
                  <th>People</th>
                  <th>Deals</th>
                  <th>Owner</th>
                  <th>Next activity</th>
                  <th>Custom fields</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {organizations.map((organization) => (
                  <tr key={organization.id}>
                    <td data-label="Name">
                      <TablePrimaryRecordCell
                        href={`/organizations/${organization.id}`}
                        linkLabel={`Open organization ${organization.name}`}
                        secondary={organization.domain ?? "No domain recorded"}
                        title={organization.name}
                      />
                    </td>
                    <td data-label="Domain">
                      <TableOptionalValueCell emptyLabel="No domain" value={organization.domain} />
                    </td>
                    <td data-label="People">{organization._count.people}</td>
                    <td data-label="Deals">{organization._count.deals}</td>
                    <td data-label="Owner">
                      <TableOwnerCell owner={organization.owner} />
                    </td>
                    <td data-label="Next activity">
                      <ListNextActivitySummary activity={organization.activities[0]} emptyLabel="No organization follow-up" />
                    </td>
                    <td data-label="Custom fields">
                      <CustomFieldSummaryCell
                        emptyConfiguredLabel="No organization fields"
                        emptyFilledLabel="No organization values"
                        fields={customFieldSummaries.get(organization.id) ?? []}
                      />
                    </td>
                    <td className="table-actions-cell" data-label="Actions">
                      <ListRowActions
                        aria-label={`${organization.name} organization row actions`}
                        actions={[
                          { href: `/organizations/${organization.id}`, label: "Open account", ariaLabel: `Open organization ${organization.name}` },
                          {
                            href: buildActivityFollowUpHref({
                              related: { type: "organization", id: organization.id },
                              returnTo: listPageHref("/organizations", params),
                              title: `Follow up: ${organization.name}`
                            }),
                            label: "Add activity",
                            ariaLabel: `Add activity for organization ${organization.name}`
                          },
                          { href: `/organizations/${organization.id}/edit`, label: "Edit", ariaLabel: `Edit organization ${organization.name}` }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <PaginationControls basePath="/organizations" pageInfo={organizationPage} searchParams={params} />
        </section>
      ) : (
        <EmptyState
          actions={
            <ListEmptyStateActions
              clearHref="/organizations"
              createFromQueryHref={createFromQueryHref}
              createFromQueryLabel="Create organization from search"
              createHref="/organizations/new"
              createLabel="Create organization"
              hasActiveFilters={hasActiveFilters}
              resultLabel="organizations"
            />
          }
          as="section"
          titleId="organizations-empty-title"
          description={
            hasActiveFilters
              ? "Adjust or reset the active filters to see more organizations."
              : "Create a company or account to group contacts, deals, activities, and notes."
          }
          title={hasActiveFilters ? "No organizations match these filters" : "No organizations yet"}
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function OrganizationQuickFilters({ actorUserId, searchParams }: { actorUserId: string; searchParams: ListSearchParams }) {
  const links = [
    { href: `/organizations?ownerId=${actorUserId}`, label: "My organizations" },
    { href: "/organizations?sortBy=updatedAt&sortDirection=desc", label: "Recently updated" },
    { href: "/organizations?sortBy=createdAt&sortDirection=desc", label: "Recently created" },
    { href: "/organizations?sortBy=name&sortDirection=asc", label: "A-Z organizations" }
  ] as const;

  return (
    <ListQuickLinksPanel
      ariaLabel="Organization quick filters"
      currentPath="/organizations"
      headingId="organization-quick-filters-title"
      hint="Jump to common account ownership and recency views without building a saved view first."
      links={links}
      searchParams={searchParams}
      title="Quick organization filters"
    />
  );
}
