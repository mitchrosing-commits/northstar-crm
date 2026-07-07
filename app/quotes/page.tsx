import type { Route } from "next";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { FilterPanel } from "@/components/filter-panel";
import { FormFieldLabel } from "@/components/form-field-label";
import { formatDate, formatMoney } from "@/components/format";
import { ListResultsSummary } from "@/components/list-results-summary";
import { ListRowActions } from "@/components/list-row-actions";
import { ListSortControls } from "@/components/list-sort-controls";
import { ListViewStatus } from "@/components/list-view-status";
import { PageHeader } from "@/components/page-header";
import { PaginationControls } from "@/components/pagination-controls";
import { StatusBadge } from "@/components/status-badge";
import { TableLinkedRecordCell } from "@/components/table-linked-record-cell";
import { TableOwnerCell } from "@/components/table-owner-cell";
import { TablePrimaryRecordCell } from "@/components/table-primary-record-cell";
import { TableScroll } from "@/components/table-scroll";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import {
  enumSearchParam,
  getSearchParam,
  hasActiveListFilters,
  parsePagination,
  type ListSearchParams
} from "@/lib/list-page-query";
import { formatPersonName } from "@/lib/person-name";
import { listQuotesPage } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<ListSearchParams>;
};

const quoteStatuses = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"] as const;
const quoteSorts = ["updatedAt", "createdAt", "number", "totalCents"] as const;
const sortDirections = ["asc", "desc"] as const;
const quoteSortOptions = [
  { value: "updatedAt", label: "Updated date" },
  { value: "createdAt", label: "Created date" },
  { value: "number", label: "Quote number" },
  { value: "totalCents", label: "Total" }
] as const;

export default async function QuotesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const query = getSearchParam(params, "q");
  const pagination = parsePagination(params);
  const quotePage = await listQuotesPage(
    actor,
    {
      q: query || undefined,
      status: enumSearchParam(params, "status", quoteStatuses),
      sortBy: enumSearchParam(params, "sortBy", quoteSorts),
      sortDirection: enumSearchParam(params, "sortDirection", sortDirections)
    },
    pagination
  );
  const hasActiveFilters = hasActiveListFilters(params, ["q", "status", "sortBy", "sortDirection"]);

  return (
    <AppShell globalSearchDefaultValue={query || undefined} workspace={workspace}>
      <PageHeader
        eyebrow="Commercial"
        subtitle="Review internal quote snapshots, status, totals, and their related deals."
        title="Quotes"
      >
        <ListViewStatus active={hasActiveFilters} label="Filtered quotes view active" resetHref="/quotes" />
      </PageHeader>

      <FilterPanel action="/quotes" legend="Quote filters" pageSize={pagination.pageSize} resetHref="/quotes">
        <label className="form-field">
          <FormFieldLabel>Search</FormFieldLabel>
          <input
            defaultValue={query}
            name="q"
            placeholder="Search quote numbers, deals, contacts, or organizations"
          />
        </label>
        <label className="form-field">
          <FormFieldLabel>Status</FormFieldLabel>
          <select name="status" defaultValue={getSearchParam(params, "status")}>
            <option value="">All statuses</option>
            {quoteStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <ListSortControls
          direction={enumSearchParam(params, "sortDirection", sortDirections) ?? "desc"}
          directionOptions={["asc", "desc"]}
          options={[...quoteSortOptions]}
          sortBy={enumSearchParam(params, "sortBy", quoteSorts) ?? "updatedAt"}
        />
      </FilterPanel>

      {quotePage.items.length > 0 ? (
        <section className="panel">
          <ListResultsSummary activeFilters={hasActiveFilters} label="quotes" pageInfo={quotePage} />
          <TableScroll aria-label="Quotes list table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Quote</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Deal</th>
                  <th>Owner</th>
                  <th>Contact</th>
                  <th>Organization</th>
                  <th>Items</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {quotePage.items.map((quote) => (
                  <tr key={quote.id}>
                    <td data-label="Quote">
                      <TablePrimaryRecordCell
                        href={`/deals/${quote.dealId}/quotes/${quote.id}`}
                        linkLabel={`Open quote ${quote.number}`}
                        secondary={formatDate(quote.createdAt)}
                        title={quote.number}
                      />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={quote.status} />
                    </td>
                    <td data-label="Total">{formatMoney(quote.totalCents, quote.currency)}</td>
                    <td data-label="Deal">
                      <TableLinkedRecordCell href={`/deals/${quote.dealId}`} linkLabel={`Open deal ${quote.deal.title}`}>
                        {quote.deal.title}
                      </TableLinkedRecordCell>
                    </td>
                    <td data-label="Owner">
                      <TableOwnerCell owner={quote.deal.owner} />
                    </td>
                    <td data-label="Contact">
                      <TableLinkedRecordCell
                        emptyLabel="No contact"
                        href={quote.deal.person ? `/contacts/${quote.deal.person.id}` : undefined}
                        linkLabel={quote.deal.person ? `Open contact ${formatPersonName(quote.deal.person) ?? "Unnamed contact"}` : undefined}
                      >
                        {formatPersonName(quote.deal.person)}
                      </TableLinkedRecordCell>
                    </td>
                    <td data-label="Organization">
                      <TableLinkedRecordCell
                        emptyLabel="No organization"
                        href={quote.deal.organization ? `/organizations/${quote.deal.organization.id}` : undefined}
                        linkLabel={quote.deal.organization ? `Open organization ${quote.deal.organization.name}` : undefined}
                      >
                        {quote.deal.organization?.name}
                      </TableLinkedRecordCell>
                    </td>
                    <td data-label="Items">{quote._count.items}</td>
                    <td data-label="Updated">{formatDate(quote.updatedAt)}</td>
                    <td className="table-actions-cell" data-label="Actions">
                      <ListRowActions
                        aria-label={`${quote.number} quote row actions`}
                        actions={[
                          {
                            href: `/deals/${quote.dealId}/quotes/${quote.id}`,
                            label: "Open quote",
                            ariaLabel: `Open quote ${quote.number}`
                          },
                          {
                            href: `/deals/${quote.dealId}`,
                            label: "Open deal",
                            ariaLabel: `Open deal ${quote.deal.title}`
                          }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <PaginationControls basePath="/quotes" pageInfo={quotePage} searchParams={params} />
        </section>
      ) : (
        <EmptyState
          actions={
            <Link className="button-secondary" href={"/deals" as Route}>
              Open deals
            </Link>
          }
          as="section"
          description="Quotes are created from deal line items. Open a deal with line items to create or review its quote drafts."
          title={hasActiveFilters ? "No quotes match these filters" : "No quotes yet"}
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}
