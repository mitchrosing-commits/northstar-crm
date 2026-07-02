import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";
import { formatDate, formatMoney, formatQuoteAdjustment } from "@/components/format";
import { PanelTitleRow } from "@/components/panel-title-row";
import { QuotePrintNotice } from "@/components/quote-print-notice";
import { StatusBadge } from "@/components/status-badge";
import { TableScroll } from "@/components/table-scroll";
import { ApiError } from "@/lib/api/responses";
import { formatPersonName } from "@/lib/person-name";
import { getPublicQuoteByToken } from "@/lib/services/crm";
import { acceptPublicQuoteAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Quote view",
  robots: {
    index: false,
    follow: false,
    nocache: true
  }
};

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ acceptance?: string; accepted?: string }>;
};

export default async function PublicQuotePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const query = await searchParams;
  const quote = await getPublicQuoteByToken(token).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canAccept = quote.status === "SENT" && quote.deal.status === "OPEN";
  const showAcceptedConfirmation = quote.status === "ACCEPTED";
  const acceptedRedirectConfirmed = query?.accepted === "1" && showAcceptedConfirmation;
  const responseDescription = canAccept
    ? "Accepting records your approval of this quote total only. It does not collect payment, signature, email delivery, or automatically update internal deal value."
    : undefined;
  const acceptQuoteLabel = `Accept quote ${quote.number}`;

  return (
    <main className="quote-print-page">
      <section className="quote-print-sheet">
        <header className="quote-print-header">
          <div>
            <p className="page-kicker">Customer-facing quote view</p>
            <h1 className="page-title">{quote.number}</h1>
            <QuotePrintNotice title="Quote scope">
              Review this quote snapshot. Acceptance is available only while the quote is sent; signatures, payment, email
              delivery, and internal deal-value updates are not collected on this page.
            </QuotePrintNotice>
          </div>
          <div className="quote-print-company">
            <strong>{quote.workspace.name}</strong>
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
            <p>{quote.deal.person ? formatPersonName(quote.deal.person) ?? "Unnamed contact" : "No contact"}</p>
          </div>
        </section>

        <TableScroll aria-label={`${quote.number} public quote items table`}>
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
              {quote.items.map((item, index) => (
                <tr key={`${item.name}-${item.quantity}-${item.lineTotalCents}-${index}`}>
                  <td data-label="Item">
                    <span className="table-primary-cell">
                      <strong>{item.name}</strong>
                      {item.description ? <span className="table-secondary-text">{item.description}</span> : null}
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
            <strong>{formatQuoteAdjustment(quote.discountType, quote.discountValue, quote.discountCents, quote.currency)}</strong>
          </div>
          <div>
            <span>Quote-level tax</span>
            <strong>{formatQuoteAdjustment(quote.taxType, quote.taxValue, quote.taxCents, quote.currency)}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatMoney(quote.totalCents, quote.currency)}</strong>
          </div>
        </section>

        <section className="data-card section-spaced">
          <PanelTitleRow actions={<StatusBadge status={quote.status} />} description={responseDescription} title="Quote Response" />
          {acceptedRedirectConfirmed ? (
            <FormSuccessMessage className="section-spaced" compact>
              Quote acceptance recorded. The Northstar team can now follow up from the accepted quote.
            </FormSuccessMessage>
          ) : null}
          {showAcceptedConfirmation ? (
            <EmptyState
              className="empty-state-compact empty-state-panel quote-response-state"
              title="Quote accepted"
              description="The Northstar team will follow up; no payment, signature, email delivery, or automatic internal deal-value update was collected."
            />
          ) : canAccept ? (
            <form action={acceptPublicQuoteAction}>
              <input name="token" type="hidden" value={token} />
              <button aria-label={acceptQuoteLabel} className="button-primary button-compact" title={acceptQuoteLabel} type="submit">
                Accept Quote
              </button>
            </form>
          ) : (
            <EmptyState
              className="empty-state-compact empty-state-panel quote-response-state"
              title="Acceptance unavailable"
              description={`This quote is not currently available for public acceptance. Current status: ${quote.status}.`}
            />
          )}
          {query?.acceptance === "unavailable" ? (
            <FormErrorMessage className="panel-actions-row">
              This quote cannot be accepted from the public link in its current status.
            </FormErrorMessage>
          ) : null}
        </section>
      </section>
    </main>
  );
}
