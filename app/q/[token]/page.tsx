import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { formatDate, formatMoney, formatQuoteAdjustment } from "@/components/format";
import { ApiError } from "@/lib/api/responses";
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
  searchParams?: Promise<{ accepted?: string; acceptance?: string }>;
};

export default async function PublicQuotePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const query = await searchParams;
  const quote = await getPublicQuoteByToken(token).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canAccept = quote.status === "SENT";
  const showAcceptedConfirmation = query?.accepted === "1" || quote.status === "ACCEPTED";

  return (
    <main className="quote-print-page">
      <section className="quote-print-sheet">
        <header className="quote-print-header">
          <div>
            <p className="page-kicker">Customer-facing quote view</p>
            <h1 className="page-title">{quote.number}</h1>
            <p className="empty-copy">Review this quote snapshot. Acceptance is available only while the quote is sent; signatures, payment, email delivery, and internal deal-value updates are not collected on this page.</p>
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
            <p>{quote.deal.person ? formatPersonName(quote.deal.person) : "No contact"}</p>
          </div>
        </section>

        <table className="table quote-print-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item) => (
              <tr key={`${item.name}-${item.quantity}-${item.lineTotalCents}`}>
                <td>
                  <strong>{item.name}</strong>
                </td>
                <td>{item.description ?? ""}</td>
                <td>{item.quantity}</td>
                <td>{formatMoney(item.unitPriceCents, item.currency)}</td>
                <td>{formatMoney(item.lineTotalCents, item.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

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

        <section className="data-card" style={{ marginTop: 22 }}>
          <div className="panel-title-row">
            <h2 className="panel-title">Quote Response</h2>
            <span className="badge">{quote.status}</span>
          </div>
          {showAcceptedConfirmation ? (
            <p className="empty-copy">Quote accepted. The Northstar team will follow up; no payment, signature, email delivery, or automatic internal deal-value update was collected.</p>
          ) : canAccept ? (
            <>
              <p className="empty-copy" style={{ marginBottom: 14 }}>
                Accepting records your approval of this quote total only. It does not collect payment, signature, email delivery, or automatically update internal deal value.
              </p>
              <form action={acceptPublicQuoteAction}>
                <input name="token" type="hidden" value={token} />
                <button className="button-primary button-compact" type="submit">
                  Accept Quote
                </button>
              </form>
            </>
          ) : (
            <p className="empty-copy">
              This quote is not currently available for public acceptance. Current status: {quote.status}.
            </p>
          )}
          {query?.acceptance === "unavailable" ? (
            <p className="form-error" style={{ marginTop: 12 }}>
              This quote cannot be accepted from the public link in its current status.
            </p>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
