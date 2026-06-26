import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { LeadSavedViewsPanel } from "@/components/deal-saved-views-panel";
import { FilterPanel } from "@/components/filter-panel";
import { formatDate } from "@/components/format";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusBadge } from "@/components/status-badge";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { leadListStateOptions, leadStatuses, type LeadListSort } from "@/lib/lead-list-state";
import { enumListViewFilter, hasActiveListViewFilters, parseListViewState, type ListSearchParams, type ListViewState } from "@/lib/list-page-query";
import { getWorkspace, listCustomFields, listCustomFieldSummaries, listLeadSavedViews, listLeads, listLeadsPage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

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

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Prospects</p>
          <h1 className="page-title">Leads</h1>
        </div>
        <Link className="button-primary" href="/leads/new">
          New lead
        </Link>
      </header>
      <LeadSavedViewsPanel listState={listState} savedViews={savedViews} />

      <FilterPanel action="/leads" pageSize={listState.pagination.pageSize} resetHref="/leads">
          <label className="form-field">
            <span>Search</span>
            <input name="q" placeholder="Search leads" defaultValue={listState.q ?? ""} />
          </label>
          <label className="form-field">
            <span>Status</span>
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
            <span>Source</span>
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

      {leads.length > 0 ? (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Source</th>
                <th>Status</th>
                <th>Owner</th>
                <th>Person</th>
                <th>Organization</th>
                <th>Created</th>
                <th>Custom fields</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link className="inline-link" href={`/leads/${lead.id}`}>
                      {lead.title}
                    </Link>
                  </td>
                  <td>{lead.source ?? "None"}</td>
                  <td>
                    <StatusBadge status={lead.status} />
                  </td>
                  <td>{lead.owner?.name ?? lead.owner?.email ?? "Unassigned"}</td>
                  <td>
                    {lead.person ? (
                      <Link className="inline-link" href={`/contacts/${lead.person.id}`}>
                        {formatPersonName(lead.person)}
                      </Link>
                    ) : (
                      "None"
                    )}
                  </td>
                  <td>
                    {lead.organization ? (
                      <Link className="inline-link" href={`/organizations/${lead.organization.id}`}>
                        {lead.organization.name}
                      </Link>
                    ) : (
                      "None"
                    )}
                  </td>
                  <td>{formatDate(lead.createdAt)}</td>
                  <td>
                    <CustomFieldSummaryCell fields={customFieldSummaries.get(lead.id) ?? []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls basePath="/leads" pageInfo={leadPage} searchParams={params} />
        </section>
      ) : (
        <section className="empty-state">
          <h2>{hasActiveFilters ? "No leads match these filters" : "No leads yet"}</h2>
          <p>{hasActiveFilters ? "Adjust or reset the active filters to see more leads." : "Create a lead to start tracking early sales opportunities."}</p>
          <Link className="text-link" href="/leads/new">
            Create lead
          </Link>
        </section>
      )}
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function SortControls({ listState }: { listState: ListViewState<LeadListSort> }) {
  return (
    <>
      <label className="form-field">
        <span>Sort by</span>
        <select name="sortBy" defaultValue={listState.sortBy}>
          <option value="updatedAt">Updated date</option>
          <option value="createdAt">Created date</option>
          <option value="title">Title</option>
        </select>
      </label>
      <label className="form-field">
        <span>Direction</span>
        <select name="sortDirection" defaultValue={listState.sortDirection}>
          <option value="desc">Descending</option>
          <option value="asc">Ascending</option>
        </select>
      </label>
    </>
  );
}
