import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { QuoteReadinessPanel } from "@/components/commercial-workflow-panel";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { formatDate, formatMoney, formatQuoteAdjustment } from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { QuoteAdjustmentsForm } from "@/components/quote-adjustments-form";
import { QuoteDealValueSyncAction } from "@/components/quote-deal-value-sync-action";
import { QuotePublicLinkControls } from "@/components/quote-public-link-controls";
import { QuoteStatusActions } from "@/components/quote-status-actions";
import { StatusBadge } from "@/components/status-badge";
import { TableScroll } from "@/components/table-scroll";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { summarizeQuoteReadiness } from "@/lib/commercial-workflow";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";
import { formatPersonName } from "@/lib/person-name";
import { buildPublicQuoteUrl } from "@/lib/public-url";
import { getQuote } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string; quoteId: string }>;
};

export default async function QuoteDetailPage({ params }: PageProps) {
  const { dealId, quoteId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const quote = await getQuote(actor, dealId, quoteId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const publicLink = quote.publicLinks[0] ?? null;
  const publicUrl = publicLink ? buildPublicQuoteUrl(publicLink.token) : null;
  const readiness = summarizeQuoteReadiness({ quote, deal: quote.deal });
  const quoteFollowUpActionLabel = `Add follow-up for quote ${quote.number}`;
  const quotePrintActionLabel = `Open print view for quote ${quote.number}`;
  const quotePdfActionLabel = `Download PDF for quote ${quote.number}`;
  const backToDealActionLabel = `Back to deal ${quote.deal.title}`;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <>
            <StatusBadge status={quote.status} />
            {quote.status === "SENT" ? (
              <Link
                aria-label={quoteFollowUpActionLabel}
                className="button-secondary"
                href={buildActivityFollowUpHref({
                  dueInDays: 3,
                  related: { type: "deal", id: quote.dealId },
                  returnTo: `/deals/${quote.dealId}/quotes/${quote.id}`,
                  title: `Follow up on ${quote.number}`,
                  type: "TASK"
                })}
                title={quoteFollowUpActionLabel}
              >
                Add follow-up
              </Link>
            ) : null}
            <Link
              aria-label={quotePrintActionLabel}
              className="button-secondary"
              href={`/deals/${quote.dealId}/quotes/${quote.id}/print`}
              title={quotePrintActionLabel}
            >
              Print view
            </Link>
            <Link
              aria-label={quotePdfActionLabel}
              className="button-secondary"
              href={`/deals/${quote.dealId}/quotes/${quote.id}/pdf`}
              title={quotePdfActionLabel}
            >
              Download PDF
            </Link>
            <Link aria-label={backToDealActionLabel} className="button-secondary" href={`/deals/${quote.dealId}`} title={backToDealActionLabel}>
              Back to deal
            </Link>
          </>
        }
        eyebrow="Internal quote"
        title={quote.number}
      />

      <section className="detail-grid">
        <DetailFieldGrid
          fields={[
            {
              label: "Deal",
              value: (
                <Link className="inline-link" href={`/deals/${quote.dealId}`}>
                  {quote.deal.title}
                </Link>
              )
            },
            {
              emptyLabel: "No organization",
              label: "Organization",
              value: quote.deal.organization ? (
                <Link className="inline-link" href={`/organizations/${quote.deal.organization.id}`}>
                  {quote.deal.organization.name}
                </Link>
              ) : (
                null
              )
            },
            {
              emptyLabel: "No contact",
              label: "Contact",
              value: quote.deal.person ? (
                <Link className="inline-link" href={`/contacts/${quote.deal.person.id}`}>
                  {formatPersonName(quote.deal.person) ?? "Unnamed contact"}
                </Link>
              ) : (
                null
              )
            },
            { label: "Created", value: formatDate(quote.createdAt) }
          ]}
          title="Quote Context"
        />
        <DetailFieldGrid
          fields={[
            { label: "Status", value: quote.status },
            { label: "Currency", value: quote.currency },
            { label: "Subtotal", value: formatMoney(quote.subtotalCents, quote.currency) },
            {
              label: "Quote-level discount",
              value: formatQuoteAdjustment(quote.discountType, quote.discountValue, quote.discountCents, quote.currency)
            },
            {
              label: "Quote-level tax",
              value: formatQuoteAdjustment(quote.taxType, quote.taxValue, quote.taxCents, quote.currency)
            },
            { label: "Total", value: formatMoney(quote.totalCents, quote.currency) }
          ]}
          title="Quote Totals"
        />
      </section>

      <QuoteReadinessPanel summary={readiness} />

      {quote.status === "DRAFT" && quote.deal.status === "OPEN" ? (
        <QuoteAdjustmentsForm
          discountType={quote.discountType}
          discountValue={quote.discountValue}
          quoteId={quote.id}
          taxType={quote.taxType}
          taxValue={quote.taxValue}
          workspaceId={workspace.id}
        />
      ) : null}

      <QuoteStatusActions
        canTransition={quote.deal.status === "OPEN"}
        quoteId={quote.id}
        quoteNumber={quote.number}
        status={quote.status}
        workspaceId={workspace.id}
      />

      <QuotePublicLinkControls
        canGenerate={quote.status === "SENT" && quote.deal.status === "OPEN"}
        publicUrl={publicUrl}
        quoteId={quote.id}
        quoteNumber={quote.number}
        workspaceId={workspace.id}
      />

      {quote.status === "ACCEPTED" ? (
        <QuoteDealValueSyncAction
          dealCurrency={quote.deal.currency}
          dealValueCents={quote.deal.valueCents}
          quoteCurrency={quote.currency}
          quoteId={quote.id}
          quoteTotalCents={quote.totalCents}
          workspaceId={workspace.id}
        />
      ) : null}

      <section className="data-card section-spaced">
        <PanelTitleRow
          actions={<span className="badge">Internal tracking only</span>}
          description="These items are snapshots from the deal line items at the moment the draft was created."
          title="Quote Items"
        />
        <TableScroll aria-label={`${quote.number} quote detail items table`}>
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.items.map((item) => (
                <tr key={item.id}>
                  <td data-label="Item">
                    <div className="table-primary-cell">
                      <strong>{item.name}</strong>
                      {item.description ? <span className="table-secondary-text">{item.description}</span> : null}
                    </div>
                  </td>
                  <td data-label="Qty">{item.quantity}</td>
                  <td data-label="Unit price">
                    {formatMoney(item.unitPriceCents, item.currency)}
                  </td>
                  <td data-label="Total">
                    {formatMoney(item.lineTotalCents, item.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </section>
    </AppShell>
  );
}
