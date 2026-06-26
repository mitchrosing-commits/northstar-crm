import Link from "next/link";
import { notFound } from "next/navigation";

import { formatDate, formatMoney, formatQuoteAdjustment } from "@/components/format";
import { PrintButton } from "@/components/print-button";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getQuote } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ dealId: string; quoteId: string }>;
};

export default async function QuotePrintPage({ params }: PageProps) {
  const { dealId, quoteId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const quote = await getQuote(actor, dealId, quoteId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <main className="quote-print-page">
      <div className="quote-print-actions no-print">
        <Link className="button-secondary button-compact" href={`/deals/${dealId}/quotes/${quoteId}`}>
          Back to quote
        </Link>
        <Link className="button-secondary button-compact" href={`/deals/${dealId}/quotes/${quoteId}/pdf`}>
          Download PDF
        </Link>
        <PrintButton label="Print quote" />
      </div>

      <section className="quote-print-sheet">
        <header className="quote-print-header">
          <div>
            <p className="page-kicker">Internal quote</p>
            <h1 className="page-title">{quote.number}</h1>
            <p className="empty-copy">Authenticated internal print view. This is not a public quote link, stored PDF, signature, or payment document.</p>
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
              <tr key={item.id}>
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
      </section>
    </main>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
