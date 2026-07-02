import { useId, type ReactNode } from "react";

import { EmptyState } from "@/components/empty-state";
import { formatDate, formatMoney } from "@/components/format";
import { ListRowActions } from "@/components/list-row-actions";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatusBadge } from "@/components/status-badge";
import { TableOptionalValueCell } from "@/components/table-optional-value-cell";
import { TablePrimaryRecordCell } from "@/components/table-primary-record-cell";
import { TableScroll } from "@/components/table-scroll";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { formatPersonName } from "@/lib/person-name";

type RelatedDeal = {
  currency: string;
  expectedCloseAt: Date | string | null;
  id: string;
  status: string;
  title: string;
  valueCents: number | null;
};

type RelatedPerson = {
  email: string | null;
  firstName: string;
  id: string;
  lastName: string | null;
  phone: string | null;
};

type RelatedDealsTableProps = {
  deals: RelatedDeal[];
  emptyAction?: ReactNode;
  emptyMessage: string;
};

type RelatedPeopleTableProps = {
  emptyAction?: ReactNode;
  emptyMessage: string;
  people: RelatedPerson[];
};

type RelatedRecordsPanelProps = {
  children: ReactNode;
  count?: number;
  id?: string;
  title: string;
};

export function RelatedRecordsPanel({ children, count, id, title }: RelatedRecordsPanelProps) {
  const generatedTitleId = useId();
  const titleId = id ? `${id}-title` : `${generatedTitleId}-related-records-title`;
  const countLabel =
    typeof count === "number" ? `${title} related record count: ${count}` : undefined;

  return (
    <section aria-labelledby={titleId} className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={
          typeof count === "number" ? (
            <span aria-label={countLabel} className="count-badge" title={countLabel}>
              {count}
            </span>
          ) : null
        }
        actionsLabel={`${title} related record count`}
        title={title}
        titleId={titleId}
      />
      {children}
    </section>
  );
}

export function RelatedDealsTable({ deals, emptyAction, emptyMessage }: RelatedDealsTableProps) {
  if (deals.length === 0) {
    return <EmptyState actions={emptyAction} className="empty-state-compact empty-state-panel" title={emptyMessage} />;
  }

  return (
    <TableScroll aria-label="Related deals table">
      <table className="table crm-list-table">
        <thead>
          <tr>
            <th>Deal</th>
            <th>Value</th>
            <th>Status</th>
            <th>Expected close</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const openDealLabel = `Open related deal ${deal.title}`;
            return (
              <tr key={deal.id}>
                <td data-label="Deal">
                  <TablePrimaryRecordCell
                    href={`/deals/${deal.id}`}
                    linkLabel={openDealLabel}
                    secondary={deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : "No expected close"}
                    title={deal.title}
                  />
                </td>
                <td data-label="Value">{formatMoney(deal.valueCents, deal.currency)}</td>
                <td data-label="Status">
                  <StatusBadge status={deal.status} />
                </td>
                <td data-label="Expected close">
                  <TableOptionalValueCell
                    emptyLabel="No expected close"
                    value={deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : null}
                  />
                </td>
                <td className="table-actions-cell" data-label="Actions">
                  <ListRowActions
                    aria-label={`${deal.title} related deal actions`}
                    actions={[
                      { href: `/deals/${deal.id}`, label: "Open deal", ariaLabel: `Open deal ${deal.title}` },
                      {
                        href: buildActivityFollowUpHref({
                          related: { type: "deal", id: deal.id },
                          returnTo: `/deals/${deal.id}`,
                          title: `Follow up: ${deal.title}`
                        }),
                        label: "Add activity",
                        ariaLabel: `Add activity for deal ${deal.title}`
                      }
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

export function RelatedPeopleTable({ emptyAction, emptyMessage, people }: RelatedPeopleTableProps) {
  if (people.length === 0) {
    return <EmptyState actions={emptyAction} className="empty-state-compact empty-state-panel" title={emptyMessage} />;
  }

  return (
    <TableScroll aria-label="Related people table">
      <table className="table crm-list-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person) => {
            const personName = formatPersonName(person) ?? "Unnamed contact";
            const openContactLabel = `Open related contact ${personName}`;
            return (
              <tr key={person.id}>
                <td data-label="Name">
                  <TablePrimaryRecordCell
                    href={`/contacts/${person.id}`}
                    linkLabel={openContactLabel}
                    secondary={person.email ?? "No email recorded"}
                    title={personName}
                  />
                </td>
                <td data-label="Email">
                  <TableOptionalValueCell emptyLabel="No email" value={person.email} />
                </td>
                <td data-label="Phone">
                  <TableOptionalValueCell emptyLabel="No phone" value={person.phone} />
                </td>
                <td className="table-actions-cell" data-label="Actions">
                  <ListRowActions
                    aria-label={`${personName} related contact actions`}
                    actions={[
                      { href: `/contacts/${person.id}`, label: "Open contact", ariaLabel: `Open contact ${personName}` },
                      {
                        href: buildActivityFollowUpHref({
                          related: { type: "person", id: person.id },
                          returnTo: `/contacts/${person.id}`,
                          title: `Follow up: ${personName}`
                        }),
                        label: "Add activity",
                        ariaLabel: `Add activity for contact ${personName}`
                      }
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}
