import Link from "next/link";

import { AttentionBadge } from "@/components/attention-badge";
import { AppShell } from "@/components/app-shell";
import { DealCommercialListSummary } from "@/components/commercial-workflow-panel";
import { CustomFieldFilterControls, CustomFieldSummaryCell } from "@/components/custom-field-list-summary";
import { DealSavedViewsPanel } from "@/components/saved-views-panel";
import { ContractWorkflowSummary } from "@/components/contract-workflow-panel";
import { FilterPanel } from "@/components/filter-panel";
import { EmptyState } from "@/components/empty-state";
import { FormFieldLabel } from "@/components/form-field-label";
import { formatDate, formatMoney } from "@/components/format";
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
import { TableOptionalValueCell } from "@/components/table-optional-value-cell";
import { TableOwnerCell } from "@/components/table-owner-cell";
import { TablePrimaryRecordCell } from "@/components/table-primary-record-cell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { classifyDealAttention, dealAttentionLabel, type DealAttentionBucket } from "@/lib/deal-attention";
import { dealCommercialFilters, dealListStateOptions, dealStatuses } from "@/lib/deal-list-state";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { enumListViewFilter, hasActiveListViewFilters, listPageHref, parseListViewState, type ListSearchParams } from "@/lib/list-page-query";
import { listResourceSearchPlaceholder } from "@/lib/list-resource-labels";
import { formatPersonName } from "@/lib/person-name";
import { prefillCreateHref } from "@/lib/search-create-actions";
import { getWorkspace, listCustomFields, listCustomFieldSummaries, listDealContractStepsForDeals, listDealsPage, listDealSavedViews, listOrganizations, listPeople, listPipelines } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

const followUpFilters = ["missing", "overdue", "today", "upcoming", "unscheduled"] as const;
const dealSortOptions = [
  { value: "updatedAt", label: "Updated date" },
  { value: "createdAt", label: "Created date" },
  { value: "title", label: "Title" },
  { value: "valueCents", label: "Value" },
  { value: "expectedCloseAt", label: "Expected close" }
] as const;

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
      followUp: enumListViewFilter(listState, "followUp", followUpFilters),
      commercial: enumListViewFilter(listState, "commercial", dealCommercialFilters),
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
  const dealIds = deals.map((deal) => deal.id);
  const [customFieldSummaries, contractStepSummaries] = await Promise.all([
    listCustomFieldSummaries(actor, "DEAL", dealIds),
    listDealContractStepsForDeals(actor, dealIds)
  ]);
  const stages = pipelines.flatMap((pipeline) =>
    pipeline.stages.map((stage) => ({ id: stage.id, name: `${pipeline.name} / ${stage.name}` }))
  );
  const hasActiveFilters = hasActiveListViewFilters(listState);
  const createFromQueryHref = listState.q && stages.length > 0
    ? prefillCreateHref("/deals/new", "title", listState.q)
    : undefined;

  return (
    <AppShell globalSearchDefaultValue={listState.q} workspace={workspace}>
      <PageHeader
        actions={
          <ListPageHeaderActions
            createHref="/deals/new"
            createLabel="New deal"
            importHref="/settings/import-export#deals-import"
            matchingCount={dealPage.total}
            resource="deals"
            searchParams={params}
            workspaceId={workspace.id}
          />
        }
        eyebrow="Opportunities"
        subtitle="Track pipeline value, next activity, ownership, and customer relationships in one list."
        title="Deals"
      >
        <ListViewStatusForState
          label="Filtered deals view active"
          listState={listState}
          resetHref="/deals"
          searchParams={params}
          savedViews={savedViews}
        />
      </PageHeader>

      <DealSavedViewsPanel listState={listState} savedViews={savedViews} />
      <DealQuickFilters actorUserId={actorUserId} searchParams={params} />

      <FilterPanel action="/deals" legend="Deal filters" pageSize={listState.pagination.pageSize} resetHref="/deals">
          <label className="form-field">
            <FormFieldLabel>Search</FormFieldLabel>
            <input name="q" placeholder={listResourceSearchPlaceholder("deals")} defaultValue={listState.q ?? ""} />
          </label>
          <label className="form-field">
            <FormFieldLabel>Status</FormFieldLabel>
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
            <FormFieldLabel>Stage</FormFieldLabel>
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
            <FormFieldLabel>Person</FormFieldLabel>
            <select name="personId" defaultValue={listState.filters.personId ?? ""}>
              <option value="">All people</option>
              {people.map((person) => (
                <option value={person.id} key={person.id}>
                  {formatPersonName(person) ?? person.email ?? "Unnamed contact"}
                </option>
              ))}
            </select>
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
            <FormFieldLabel>Follow-up</FormFieldLabel>
            <select name="followUp" defaultValue={listState.filters.followUp ?? ""}>
              <option value="">Any follow-up state</option>
              <option value="missing">Open deals missing next activity</option>
              <option value="overdue">Open deals with overdue activity</option>
              <option value="today">Open deals due today</option>
              <option value="upcoming">Open deals upcoming</option>
              <option value="unscheduled">Open deals with no due date</option>
            </select>
          </label>
          <label className="form-field">
            <FormFieldLabel>Commercial</FormFieldLabel>
            <select name="commercial" defaultValue={listState.filters.commercial ?? ""}>
              <option value="">Any commercial state</option>
              <option value="noQuote">Open deals without quotes</option>
              <option value="hasQuote">Deals with quotes</option>
              <option value="acceptedQuote">Deals with accepted quote</option>
              <option value="valueNoLineItems">Open value without line items</option>
            </select>
          </label>
          <CustomFieldFilterControls fields={customFieldDefinitions} params={params} />
          <ListSortControls direction={listState.sortDirection} options={[...dealSortOptions]} sortBy={listState.sortBy} />
      </FilterPanel>

      {deals.length > 0 ? (
        <section className="panel">
          <ListResultsSummary activeFilters={hasActiveFilters} label="deals" pageInfo={dealPage} />
          <TableScroll aria-label="Deals list table">
            <table className="table crm-list-table">
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
                  <th>Commercial</th>
                  <th>Next activity</th>
                  <th>Contracts</th>
                  <th>Custom fields</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id}>
                    <td data-label="Deal">
                      <TablePrimaryRecordCell
                        href={`/deals/${deal.id}`}
                        linkLabel={`Open deal ${deal.title}`}
                        secondary={deal.stage.name}
                        title={deal.title}
                      />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={deal.status} />
                    </td>
                    <td data-label="Value">{formatMoney(deal.valueCents, deal.currency)}</td>
                    <td data-label="Stage">{deal.stage.name}</td>
                    <td data-label="Owner">
                      <TableOwnerCell owner={deal.owner} />
                    </td>
                    <td data-label="Person">
                      <TableLinkedRecordCell
                        emptyLabel="No contact"
                        href={deal.person ? `/contacts/${deal.person.id}` : undefined}
                        linkLabel={deal.person ? `Open contact ${formatPersonName(deal.person) ?? "Unnamed contact"}` : undefined}
                      >
                        {formatPersonName(deal.person)}
                      </TableLinkedRecordCell>
                    </td>
                    <td data-label="Organization">
                      <TableLinkedRecordCell
                        emptyLabel="No organization"
                        href={deal.organization ? `/organizations/${deal.organization.id}` : undefined}
                        linkLabel={deal.organization ? `Open organization ${deal.organization.name}` : undefined}
                      >
                        {deal.organization?.name}
                      </TableLinkedRecordCell>
                    </td>
                    <td data-label="Expected close">
                      <TableOptionalValueCell
                        emptyLabel="No expected close"
                        value={deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : null}
                      />
                    </td>
                    <td data-label="Attention">
                      <DealAttentionBadge bucket={classifyDealAttention(deal)} />
                    </td>
                    <td data-label="Commercial">
                      <DealCommercialListSummary
                        latestQuote={deal.quotes[0]}
                        lineItemCount={deal._count.lineItems}
                        quoteCount={deal._count.quotes}
                      />
                    </td>
                    <td data-label="Next activity">
                      <ListNextActivitySummary activity={deal.activities[0]} emptyLabel="No deal follow-up" />
                    </td>
                    <td data-label="Contracts">
                      <ContractWorkflowSummary
                        fields={customFieldSummaries.get(deal.id) ?? []}
                        steps={contractStepSummaries.get(deal.id) ?? []}
                      />
                    </td>
                    <td data-label="Custom fields">
                      <CustomFieldSummaryCell
                        emptyConfiguredLabel="No deal fields"
                        emptyFilledLabel="No deal values"
                        fields={customFieldSummaries.get(deal.id) ?? []}
                      />
                    </td>
                    <td className="table-actions-cell" data-label="Actions">
                      <ListRowActions
                        aria-label={`${deal.title} deal row actions`}
                        actions={[
                          { href: `/deals/${deal.id}`, label: "Open deal", ariaLabel: `Open deal ${deal.title}` },
                          ...(deal.status === "OPEN"
                            ? [
                                {
                                  href: buildActivityFollowUpHref({
                                    related: { type: "deal", id: deal.id },
                                    returnTo: listPageHref("/deals", params),
                                    title: `Follow up: ${deal.title}`
                                  }),
                                  label: "Add activity",
                                  ariaLabel: `Add activity for deal ${deal.title}`
                                }
                              ]
                            : []),
                          { href: `/deals/${deal.id}/edit`, label: "Edit", ariaLabel: `Edit deal ${deal.title}` }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <PaginationControls basePath="/deals" pageInfo={dealPage} searchParams={params} />
        </section>
      ) : (
        <EmptyState
          actions={
            stages.length > 0 ? (
              <ListEmptyStateActions
                clearHref="/deals"
                createFromQueryHref={createFromQueryHref}
                createFromQueryLabel="Create deal from search"
                createHref="/deals/new"
                createLabel="Create deal"
                hasActiveFilters={hasActiveFilters}
                resultLabel="deals"
              />
            ) : (
              <Link className="button-secondary" href="/pipeline">
                View pipeline
              </Link>
            )
          }
          as="section"
          titleId="deals-empty-title"
          description={
            hasActiveFilters
              ? "Adjust or reset the active filters to see more deals."
              : stages.length === 0
                ? "New workspaces include default stages. Add or restore pipeline stages before creating deals."
                : "Create a deal or convert a lead to start tracking opportunities."
          }
          title={hasActiveFilters ? "No deals match these filters" : stages.length === 0 ? "No pipeline stages yet" : "No deals yet"}
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function DealAttentionBadge({ bucket }: { bucket: DealAttentionBucket }) {
  return (
    <AttentionBadge classNamePrefix="deal-attention" tone={bucket}>
      {dealAttentionLabel(bucket)}
    </AttentionBadge>
  );
}

function DealQuickFilters({ actorUserId, searchParams }: { actorUserId: string; searchParams: ListSearchParams }) {
  const links = [
    { href: `/deals?status=OPEN&ownerId=${actorUserId}`, label: "My open deals" },
    { href: "/deals?followUp=missing", label: "No next activity" },
    { href: "/deals?followUp=overdue", label: "Overdue follow-ups" },
    { href: "/deals?followUp=today", label: "Due today" },
    { href: "/deals?commercial=noQuote", label: "No quote" },
    { href: "/deals?commercial=valueNoLineItems", label: "Value without line items" },
    { href: "/deals?status=OPEN&sortBy=expectedCloseAt&sortDirection=asc", label: "Closing soon" },
    { href: "/deals?status=OPEN&sortBy=valueCents&sortDirection=desc", label: "High value" },
    { href: "/dashboard", label: "Needs attention" },
    { href: "/deals?status=WON", label: "Won" },
    { href: "/deals?status=LOST", label: "Lost" }
  ] as const;

  return (
    <ListQuickLinksPanel
      ariaLabel="Deal quick filters"
      currentPath="/deals"
      headingId="deal-quick-filters-title"
      hint="Jump to common deal views using existing filters and sort order."
      links={links}
      searchParams={searchParams}
      title="Quick deal filters"
    />
  );
}
