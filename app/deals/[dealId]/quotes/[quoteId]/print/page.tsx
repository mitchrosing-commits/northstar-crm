import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionGroup } from "@/components/action-group";
import {
  formatDate,
  formatMoney,
  formatQuoteAdjustment,
} from "@/components/format";
import { PrintButton } from "@/components/print-button";
import { QuotePrintNotice } from "@/components/quote-print-notice";
import { TableScroll } from "@/components/table-scroll";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { formatPersonName } from "@/lib/person-name";
import { getQuote } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string; quoteId: string }>;
};

export default async function QuotePrintPage({ params }: PageProps) {
  const { dealId, quoteId } = await params;
  const printActionsLabel = "Quote print actions";
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const quote = await getQuote(actor, dealId, quoteId).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
      throw error;
    },
  );
  const backToQuoteActionLabel = `Back to quote ${quote.number}`;
  const quotePdfActionLabel = `Download PDF for quote ${quote.number}`;
  const printQuoteActionLabel = `Print quote ${quote.number}`;

  return (
    <main className="quote-print-page">
      <ActionGroup
        className="quote-print-actions no-print"
        label={printActionsLabel}
      >
        <Link
          aria-label={backToQuoteActionLabel}
          className="button-secondary button-compact"
          href={`/deals/${dealId}/quotes/${quoteId}`}
          title={backToQuoteActionLabel}
        >
          Back to quote
        </Link>
        <Link
          aria-label={quotePdfActionLabel}
          className="button-secondary button-compact"
          href={`/deals/${dealId}/quotes/${quoteId}/pdf`}
          title={quotePdfActionLabel}
        >
          Download PDF
        </Link>
        <PrintButton actionLabel={printQuoteActionLabel} label="Print quote" />
      </ActionGroup>

      <section className="quote-print-sheet">
        <header className="quote-print-header">
          <div>
            <p className="page-kicker">Internal quote</p>
            <h1 className="page-title">{quote.number}</h1>
            <QuotePrintNotice title="Internal view">
              Authenticated internal print view. This is not a public quote
              link, stored PDF, signature, or payment document.
            </QuotePrintNotice>
          </div>
          <div className="quote-print-company">
            <strong>{workspace.name}</strong>
            <span>{quote.status}</span>
            <span>{formatDate(quote.createdAt)}</span>
          </div>
        </header>

        <section className="quote-print-context">
          <div>
            <h2 className="compact-title">Deal</h2>
            <p>{quote.deal.title}</p>
          </div>
          <div>
            <h2 className="compact-title">Customer</h2>
            <p>{quote.deal.organization?.name ?? "No organization"}</p>
            <p>
              {quote.deal.person
                ? formatPersonName(quote.deal.person) ?? "Unnamed contact"
                : "No contact"}
            </p>
          </div>
        </section>

        <TableScroll
          aria-label={`${quote.number} internal printable quote items table`}
        >
          <table className="table quote-print-table">
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
                    <span className="table-primary-cell">
                      <strong>{item.name}</strong>
                      {item.description ? (
                        <span className="table-secondary-text">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td data-label="Qty">{item.quantity}</td>
                  <td data-label="Unit price">{formatMoney(item.unitPriceCents, item.currency)}</td>
                  <td data-label="Total">{formatMoney(item.lineTotalCents, item.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>

        <section className="quote-print-totals">
          <div>
            <span>Subtotal</span>
            <strong>{formatMoney(quote.subtotalCents, quote.currency)}</strong>
          </div>
          <div>
            <span>Quote-level discount</span>
            <strong>
              {formatQuoteAdjustment(
                quote.discountType,
                quote.discountValue,
                quote.discountCents,
                quote.currency,
              )}
            </strong>
          </div>
          <div>
            <span>Quote-level tax</span>
            <strong>
              {formatQuoteAdjustment(
                quote.taxType,
                quote.taxValue,
                quote.taxCents,
                quote.currency,
              )}
            </strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatMoney(quote.totalCents, quote.currency)}</strong>
          </div>
        </section>
      </section>
    </main>
  );
}
