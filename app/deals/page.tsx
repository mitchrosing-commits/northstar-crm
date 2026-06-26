import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { DealSavedViewsPanel } from "@/components/deal-saved-views-panel";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { FilterPanel } from "@/components/filter-panel";
import { formatDate, formatMoney } from "@/components/format";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusBadge } from "@/components/status-badge";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { classifyDealAttention, dealAttentionLabel, type DealAttentionBucket } from "@/lib/deal-attention";
import { dealListStateOptions, dealStatuses, type DealListSort } from "@/lib/deal-list-state";
import { enumListViewFilter, hasActiveListViewFilters, parseListViewState, type ListSearchParams, type ListViewState } from "@/lib/list-page-query";
import { getWorkspace, listCustomFields, listCustomFieldSummaries, listDealsPage, listDealSavedViews, listOrganizations, listPeople, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

export default async function DealsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const listState = parseListViewState(params, dealListStateOptions);
  const [dealPage, pipelines, people, organizations, workspaceRecord, customFieldDefinitions, savedViews] = await Promise.all([
    listDealsPage(actor, {
      q: listState.q,
      status: enumListViewFilter(listState, "status", dealStatuses),
      stageId: listState.filters.stageId,
      ownerId: listState.filters.ownerId,
      personId: listState.filters.personId,
      organizationId: listState.filters.organizationId,
      customFieldId: listState.filters.customFieldId,
      customFieldOperator: listState.filters.customFieldOperator,
      customFieldValue: listState.filters.customFieldValue,
      sortBy: listState.sortBy,
      sortDirection: listState.sortDirection
    }, listState.pagination),
    listPipelines(actor),
    listPeople(actor),
    listOrganizations(actor),
    getWorkspace(actor),
    listCustomFields(actor, { entityType: "DEAL" }),
    listDealSavedViews(actor)
  ]);
  const deals = dealPage.items;
  const customFieldSummaries = await listCustomFieldSummaries(actor, "DEAL", deals.map((deal) => deal.id));
  const stages = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({ id: stage.id, name: `${pipeline.name} / ${stage.name}` }))
  );
  const hasActiveFilters = hasActiveListViewFilters(listState);

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Opportunities</p>
          <h1 className="page-title">Deals</h1>
        </div>
        <Link className="button-primary" href="/deals/new">
          New deal
        </Link>
      </header>

      <DealSavedViewsPanel listState={listState} savedViews={savedViews} />

      <FilterPanel action="/deals" pageSize={listState.pagination.pageSize} resetHref="/deals">
          <label className="form-field">
            <span>Search</span>
            <input name="q" placeholder="Search deals" defaultValue={listState.q ?? ""} />
          </label>
          <label className="form-field">
            <span>Status</span>
            <select name="status" defaultValue={listState.filters.status ?? ""}>
              <option value="">All statuses</option>
              {dealStatuses.map((status) => (
                <option value={status} key={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Stage</span>
            <select name="stageId" defaultValue={listState.filters.stageId ?? ""}>
              <option value="">All stages</option>
              {stages.map((stage) => (
                <option value={stage.id} key={stage.id}>
                  {stage.name}
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
          <label className="form-field">
            <span>Person</span>
            <select name="personId" defaultValue={listState.filters.personId ?? ""}>
              <option value="">All people</option>
              {people.map((person) => (
                <option value={person.id} key={person.id}>
                  {formatPersonName(person)}
                </option>
              ))}
            </select>
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
          <CustomFieldFilterControls fields={customFieldDefinitions} params={params} />
          <SortControls listState={listState} />
      </FilterPanel>

      {deals.length > 0 ? (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Status</th>
                <th>Value</th>
                <th>Stage</th>
                <th>Owner</th>
                <th>Person</th>
                <th>Organization</th>
                <th>Expected close</th>
                <th>Attention</th>
                <th>Next activity</th>
                <th>Custom fields</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((deal) => (
                <tr key={deal.id}>
                  <td>
                    <Link className="inline-link" href={`/deals/${deal.id}`}>
                      {deal.title}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={deal.status} />
                  </td>
                  <td>{formatMoney(deal.valueCents, deal.currency)}</td>
                  <td>{deal.stage.name}</td>
                  <td>{deal.owner?.name ?? deal.owner?.email ?? "Unassigned"}</td>
                  <td>
                    {deal.person ? (
                      <Link className="inline-link" href={`/contacts/${deal.person.id}`}>
                        {formatPersonName(deal.person)}
                      </Link>
                    ) : (
                      "None"
                    )}
                  </td>
                  <td>
                    {deal.organization ? (
                      <Link className="inline-link" href={`/organizations/${deal.organization.id}`}>
                        {deal.organization.name}
                      </Link>
                    ) : (
                      "None"
                    )}
                  </td>
                  <td>{formatDate(deal.expectedCloseAt)}</td>
                  <td>
                    <DealAttentionBadge bucket={classifyDealAttention(deal)} />
                  </td>
                  <td>
                    <NextActivitySummary activity={deal.activities[0]} />
                  </td>
                  <td>
                    <CustomFieldSummaryCell fields={customFieldSummaries.get(deal.id) ?? []} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationControls basePath="/deals" pageInfo={dealPage} searchParams={params} />
        </section>
      ) : (
        <section className="empty-state">
          <h2>{hasActiveFilters ? "No deals match these filters" : stages.length === 0 ? "No pipeline stages yet" : "No deals yet"}</h2>
          <p>
            {hasActiveFilters
              ? "Adjust or reset the active filters to see more deals."
              : stages.length === 0
                ? "New workspaces include default stages. Add or restore pipeline stages before creating deals."
                : "Create a deal or convert a lead to start tracking opportunities."}
          </p>
          {stages.length > 0 ? (
            <Link className="text-link" href="/deals/new">
              Create deal
            </Link>
          ) : (
            <Link className="text-link" href="/pipeline">
              View pipeline
            </Link>
          )}
        </section>
      )}
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function DealAttentionBadge({ bucket }: { bucket: DealAttentionBucket }) {
  return <span className={`deal-attention deal-attention-${bucket}`}>{dealAttentionLabel(bucket)}</span>;
}

function NextActivitySummary({
  activity
}: {
  activity?: {
    title: string;
    dueAt: Date | string | null;
    completedAt?: Date | string | null;
  };
}) {
  if (!activity) return <span className="muted">No open activity</span>;

  return (
    <div className="next-activity-summary">
      <strong>{activity.title}</strong>
      <ActivityDueBadge activity={activity} />
    </div>
  );
}

function SortControls({ listState }: { listState: ListViewState<DealListSort> }) {
  return (
    <>
      <label className="form-field">
        <span>Sort by</span>
        <select name="sortBy" defaultValue={listState.sortBy}>
          <option value="updatedAt">Updated date</option>
          <option value="createdAt">Created date</option>
          <option value="title">Title</option>
          <option value="valueCents">Value</option>
          <option value="expectedCloseAt">Expected close</option>
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
