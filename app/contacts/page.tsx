import { AppShell } from "@/components/app-shell";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { ContactSavedViewsPanel } from "@/components/saved-views-panel";
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
import { TableLinkedRecordCell } from "@/components/table-linked-record-cell";
import { TableOwnerCell } from "@/components/table-owner-cell";
import { TableOptionalValueCell } from "@/components/table-optional-value-cell";
import { TablePrimaryRecordCell } from "@/components/table-primary-record-cell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { contactListStateOptions } from "@/lib/contact-list-state";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { hasActiveListViewFilters, listPageHref, parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { listResourceSearchPlaceholder } from "@/lib/list-resource-labels";
import { formatPersonName } from "@/lib/person-name";
import { looksLikeEmail, prefillCreateHref } from "@/lib/search-create-actions";
import { getWorkspace, listContactSavedViews, listCustomFields, listCustomFieldSummaries, listOrganizations, listPeoplePage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

const contactSortOptions = [
  { value: "name", label: "Name" },
  { value: "createdAt", label: "Created date" },
  { value: "updatedAt", label: "Updated date" }
] as const;

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
  const createFromQueryHref = listState.q
    ? prefillCreateHref("/contacts/new", looksLikeEmail(listState.q) ? "email" : "name", listState.q)
    : undefined;

  return (
    <AppShell globalSearchDefaultValue={listState.q} workspace={workspace}>
      <PageHeader
        actions={
          <ListPageHeaderActions
            createHref="/contacts/new"
            createLabel="New contact"
            importHref="/settings/import-export#contacts-import"
            matchingCount={peoplePage.total}
            resource="contacts"
            searchParams={params}
            workspaceId={workspace.id}
          />
        }
        eyebrow="People"
        subtitle="People linked to deals, organizations, activities, email, and notes."
        title="Contacts"
      >
        <ListViewStatusForState
          label="Filtered contacts view active"
          listState={listState}
          resetHref="/contacts"
          searchParams={params}
          savedViews={savedViews}
        />
      </PageHeader>
      <ContactSavedViewsPanel listState={listState} savedViews={savedViews} />
      <ContactQuickFilters actorUserId={actorUserId} searchParams={params} />

      <FilterPanel action="/contacts" legend="Contact filters" pageSize={listState.pagination.pageSize} resetHref="/contacts">
          <label className="form-field">
            <FormFieldLabel>Search</FormFieldLabel>
            <input name="q" placeholder={listResourceSearchPlaceholder("contacts")} defaultValue={listState.q ?? ""} />
          </label>
          <label className="form-field">
            <FormFieldLabel>Organization</FormFieldLabel>
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
            options={[...contactSortOptions]}
            sortBy={listState.sortBy}
          />
      </FilterPanel>
      {people.length > 0 ? (
        <section className="panel">
          <ListResultsSummary activeFilters={hasActiveFilters} label="contacts" pageInfo={peoplePage} />
          <TableScroll aria-label="Contacts list table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Organization</th>
                  <th>Owner</th>
                  <th>Next activity</th>
                  <th>Custom fields</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const contactName = formatPersonName(person) ?? person.email ?? "Unnamed contact";

                  return (
                    <tr key={person.id}>
                      <td data-label="Name">
                        <TablePrimaryRecordCell
                          href={`/contacts/${person.id}`}
                          linkLabel={`Open contact ${contactName}`}
                          secondary={person.organization?.name ?? "No organization linked"}
                          title={contactName}
                        />
                      </td>
                      <td data-label="Email">
                        <TableOptionalValueCell emptyLabel="No email" value={person.email} />
                      </td>
                      <td data-label="Phone">
                        <TableOptionalValueCell emptyLabel="No phone" value={person.phone} />
                      </td>
                      <td data-label="Organization">
                        <TableLinkedRecordCell
                          emptyLabel="No organization"
                          href={person.organization ? `/organizations/${person.organization.id}` : undefined}
                          linkLabel={person.organization ? `Open organization ${person.organization.name}` : undefined}
                        >
                          {person.organization?.name}
                        </TableLinkedRecordCell>
                      </td>
                      <td data-label="Owner">
                        <TableOwnerCell owner={person.owner} />
                      </td>
                      <td data-label="Next activity">
                        <ListNextActivitySummary activity={person.activities[0]} emptyLabel="No contact follow-up" />
                      </td>
                      <td data-label="Custom fields">
                        <CustomFieldSummaryCell
                          emptyConfiguredLabel="No contact fields"
                          emptyFilledLabel="No contact values"
                          fields={customFieldSummaries.get(person.id) ?? []}
                        />
                      </td>
                      <td className="table-actions-cell" data-label="Actions">
                        <ListRowActions
                          aria-label={`${contactName} contact row actions`}
                          actions={[
                            { href: `/contacts/${person.id}`, label: "Open contact", ariaLabel: `Open contact ${contactName}` },
                            {
                              href: buildActivityFollowUpHref({
                                related: { type: "person", id: person.id },
                                returnTo: listPageHref("/contacts", params),
                                title: `Follow up: ${contactName}`
                              }),
                              label: "Add activity",
                              ariaLabel: `Add activity for contact ${contactName}`
                            },
                            { href: `/contacts/${person.id}/edit`, label: "Edit", ariaLabel: `Edit contact ${contactName}` }
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <PaginationControls basePath="/contacts" pageInfo={peoplePage} searchParams={params} />
        </section>
      ) : (
        <EmptyState
          actions={
            <ListEmptyStateActions
              clearHref="/contacts"
              createFromQueryHref={createFromQueryHref}
              createFromQueryLabel="Create contact from search"
              createHref="/contacts/new"
              createLabel="Create contact"
              hasActiveFilters={hasActiveFilters}
              resultLabel="contacts"
            />
          }
          as="section"
          titleId="contacts-empty-title"
          description={
            hasActiveFilters
              ? "Adjust or reset the active filters to see more contacts."
              : "Create a contact to start linking people to deals, activities, and organizations."
          }
          title={hasActiveFilters ? "No contacts match these filters" : "No contacts yet"}
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function ContactQuickFilters({ actorUserId, searchParams }: { actorUserId: string; searchParams: ListSearchParams }) {
  const links = [
    { href: `/contacts?ownerId=${actorUserId}`, label: "My contacts" },
    { href: "/contacts?sortBy=updatedAt&sortDirection=desc", label: "Recently updated" },
    { href: "/contacts?sortBy=createdAt&sortDirection=desc", label: "Recently created" },
    { href: "/contacts?sortBy=name&sortDirection=asc", label: "A-Z contacts" }
  ] as const;

  return (
    <ListQuickLinksPanel
      ariaLabel="Contact quick filters"
      currentPath="/contacts"
      headingId="contact-quick-filters-title"
      hint="Jump to common contact ownership and recency views without building a saved view first."
      links={links}
      searchParams={searchParams}
      title="Quick contact filters"
    />
  );
}
