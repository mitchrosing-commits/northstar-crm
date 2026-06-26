import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { DetailFieldGrid } from "@/components/detail-field-grid";
import { formatDate, formatMoney, formatQuoteAdjustment } from "@/components/format";
import { QuoteAdjustmentsForm } from "@/components/quote-adjustments-form";
import { QuoteDealValueSyncAction } from "@/components/quote-deal-value-sync-action";
import { QuotePublicLinkControls } from "@/components/quote-public-link-controls";
import { QuoteStatusActions } from "@/components/quote-status-actions";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
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

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Internal quote</p>
          <h1 className="page-title">{quote.number}</h1>
        </div>
        <div className="header-actions">
          <span className="badge">{quote.status}</span>
          <Link className="button-secondary" href={`/deals/${quote.dealId}/quotes/${quote.id}/print`}>
            Print view
          </Link>
          <Link className="button-secondary" href={`/deals/${quote.dealId}/quotes/${quote.id}/pdf`}>
            Download PDF
          </Link>
          <Link className="button-secondary" href={`/deals/${quote.dealId}`}>
            Back to deal
          </Link>
        </div>
      </header>

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
              label: "Organization",
              value: quote.deal.organization ? (
                <Link className="inline-link" href={`/organizations/${quote.deal.organization.id}`}>
                  {quote.deal.organization.name}
                </Link>
              ) : (
                "None"
              )
            },
            {
              label: "Contact",
              value: quote.deal.person ? (
                <Link className="inline-link" href={`/contacts/${quote.deal.person.id}`}>
                  {formatPersonName(quote.deal.person)}
                </Link>
              ) : (
                "None"
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

      {quote.status === "DRAFT" ? (
        <QuoteAdjustmentsForm
          discountType={quote.discountType}
          discountValue={quote.discountValue}
          quoteId={quote.id}
          taxType={quote.taxType}
          taxValue={quote.taxValue}
          workspaceId={workspace.id}
        />
      ) : null}

      <QuoteStatusActions quoteId={quote.id} status={quote.status} workspaceId={workspace.id} />

      <QuotePublicLinkControls publicUrl={publicUrl} quoteId={quote.id} workspaceId={workspace.id} />

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

      <section className="data-card" style={{ marginTop: 14 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Quote Items</h2>
          <span className="badge">Internal tracking only</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 14 }}>
          These items are snapshots from the deal line items at the moment the draft was created.
        </p>
        <table className="table">
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
      </section>
    </AppShell>
  );
}

function formatPersonName(person: { firstName: string; lastName: string | null }) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}
