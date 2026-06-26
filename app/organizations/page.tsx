import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { OrganizationSavedViewsPanel } from "@/components/deal-saved-views-panel";
import { FilterPanel } from "@/components/filter-panel";
import { PaginationControls } from "@/components/pagination-controls";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { hasActiveListViewFilters, parseListViewState, type ListSearchParams, type ListViewState } from "@/lib/list-page-query";
import { organizationListStateOptions, type OrganizationListSort } from "@/lib/organization-list-state";
import { getWorkspace, listCustomFields, listCustomFieldSummaries, listOrganizationSavedViews, listOrganizationsPage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

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

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Companies</p>
          <h1 className="page-title">Organizations</h1>
        </div>
        <Link className="button-primary" href="/organizations/new">
          New organization
        </Link>
      </header>
      <OrganizationSavedViewsPanel listState={listState} savedViews={savedViews} />

      <FilterPanel action="/organizations" pageSize={listState.pagination.pageSize} resetHref="/organizations">
          <label className="form-field">
            <span>Search</span>
            <input name="q" placeholder="Search organizations" defaultValue={listState.q ?? ""} />
          </label>
          <label className="form-field">
            <span>Owner</span>
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
          <SortControls listState={listState} />
      </FilterPanel>
      {organizations.length > 0 ? (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Domain</th>
                <th>People</th>
                <th>Deals</th>
                <th>Owner</th>
                <th>Custom fields</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => (
                <tr key={organization.id}>
                  <td>
                    <Link className="inline-link" href={`/organizations/${organization.id}`}>
                      {organization.name}
                    </Link>
                  </td>
                  <td>{organization.domain ?? "None"}</td>
                  <td>{organization._count.people}</td>
                  <td>{organization._count.deals}</td>
                  <td>{organization.owner?.name ?? "Unassigned"}</td>
                  <td>
                    <CustomFieldSummaryCell fields={customFieldSummaries.get(organization.id) ?? []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls basePath="/organizations" pageInfo={organizationPage} searchParams={params} />
        </section>
      ) : (
        <section className="empty-state">
          <h2>{hasActiveFilters ? "No organizations match these filters" : "No organizations yet"}</h2>
          <p>{hasActiveFilters ? "Adjust or reset the active filters to see more organizations." : "Create a company or account to group contacts, deals, activities, and notes."}</p>
          <Link className="text-link" href="/organizations/new">
            Create organization
          </Link>
        </section>
      )}
    </AppShell>
  );
}

function SortControls({ listState }: { listState: ListViewState<OrganizationListSort> }) {
  return (
    <>
      <label className="form-field">
        <span>Sort by</span>
        <select name="sortBy" defaultValue={listState.sortBy}>
          <option value="name">Name</option>
          <option value="createdAt">Created date</option>
          <option value="updatedAt">Updated date</option>
        </select>
      </label>
      <label className="form-field">
        <span>Direction</span>
        <select name="sortDirection" defaultValue={listState.sortDirection}>
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>
    </>
  );
}
