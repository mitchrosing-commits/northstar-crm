import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { ContactSavedViewsPanel } from "@/components/deal-saved-views-panel";
import { FilterPanel } from "@/components/filter-panel";
import { PaginationControls } from "@/components/pagination-controls";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { contactListStateOptions, type ContactListSort } from "@/lib/contact-list-state";
import { hasActiveListViewFilters, parseListViewState, type ListSearchParams, type ListViewState } from "@/lib/list-page-query";
import { getWorkspace, listContactSavedViews, listCustomFields, listCustomFieldSummaries, listOrganizations, listPeoplePage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

export default async function ContactsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const listState = parseListViewState(params, contactListStateOptions);
  const [peoplePage, organizations, workspaceRecord, customFieldDefinitions, savedViews] = await Promise.all([
    listPeoplePage(actor, {
      q: listState.q,
      organizationId: listState.filters.organizationId,
      ownerId: listState.filters.ownerId,
      customFieldId: listState.filters.customFieldId,
      customFieldOperator: listState.filters.customFieldOperator,
      customFieldValue: listState.filters.customFieldValue,
      sortBy: listState.sortBy,
      sortDirection: listState.sortDirection
    }, listState.pagination),
    listOrganizations(actor),
    getWorkspace(actor),
    listCustomFields(actor, { entityType: "PERSON" }),
    listContactSavedViews(actor)
  ]);
  const people = peoplePage.items;
  const customFieldSummaries = await listCustomFieldSummaries(actor, "PERSON", people.map((person) => person.id));
  const hasActiveFilters = hasActiveListViewFilters(listState);

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">People</p>
          <h1 className="page-title">Contacts</h1>
        </div>
        <Link className="button-primary" href="/contacts/new">
          New contact
        </Link>
      </header>
      <ContactSavedViewsPanel listState={listState} savedViews={savedViews} />

      <FilterPanel action="/contacts" pageSize={listState.pagination.pageSize} resetHref="/contacts">
          <label className="form-field">
            <span>Search</span>
            <input name="q" placeholder="Search contacts" defaultValue={listState.q ?? ""} />
          </label>
          <label className="form-field">
            <span>Organization</span>
            <select name="organizationId" defaultValue={listState.filters.organizationId ?? ""}>
              <option value="">All organizations</option>
              {organizations.map((organization) => (
                <option value={organization.id} key={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
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
      {people.length > 0 ? (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Organization</th>
                <th>Owner</th>
                <th>Custom fields</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>
                    <Link className="inline-link" href={`/contacts/${person.id}`}>
                      {person.firstName} {person.lastName}
                    </Link>
                  </td>
                  <td>{person.email ?? "None"}</td>
                  <td>{person.phone ?? "None"}</td>
                  <td>
                    {person.organization ? (
                      <Link className="inline-link" href={`/organizations/${person.organization.id}`}>
                        {person.organization.name}
                      </Link>
                    ) : (
                      "None"
                    )}
                  </td>
                  <td>{person.owner?.name ?? "Unassigned"}</td>
                  <td>
                    <CustomFieldSummaryCell fields={customFieldSummaries.get(person.id) ?? []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls basePath="/contacts" pageInfo={peoplePage} searchParams={params} />
        </section>
      ) : (
        <section className="empty-state">
          <h2>{hasActiveFilters ? "No contacts match these filters" : "No contacts yet"}</h2>
          <p>{hasActiveFilters ? "Adjust or reset the active filters to see more contacts." : "Create a contact to start linking people to deals, activities, and organizations."}</p>
          <Link className="text-link" href="/contacts/new">
            Create contact
          </Link>
        </section>
      )}
    </AppShell>
  );
}

function SortControls({ listState }: { listState: ListViewState<ContactListSort> }) {
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
