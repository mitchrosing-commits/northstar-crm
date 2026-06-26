"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatDate, formatMoney } from "@/components/format";

type QuoteItem = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unitPriceCents: number;
  currency: string;
  lineTotalCents: number;
};

type QuoteDraft = {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalCents: number;
  createdAt: Date | string;
  items: QuoteItem[];
};

type QuoteDraftsPanelProps = {
  workspaceId: string;
  dealId: string;
  quotes: QuoteDraft[];
  canCreate: boolean;
};

export function QuoteDraftsPanel({ workspaceId, dealId, quotes, canCreate }: QuoteDraftsPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function createDraftQuote() {
    setError(null);
    setIsSaving(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deals/${dealId}/quotes`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not create this quote draft.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  return (
    <section className="data-card" style={{ marginTop: 14 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Quotes</h2>
        <button
          className="button-primary button-compact"
          disabled={isSaving || !canCreate}
          onClick={createDraftQuote}
          type="button"
        >
          {isSaving ? "Creating..." : "Create draft quote"}
        </button>
      </div>
      <p className="empty-copy" style={{ marginBottom: 14 }}>
        Quotes are internal snapshots of current line items. Status changes are internal tracking only; public links, PDFs, and customer acceptance are managed from quote detail without email delivery, signatures, or payment collection.
      </p>
      {!canCreate ? (
        <p className="empty-copy" style={{ marginBottom: 14 }}>
          Add at least one deal line item to enable draft quote creation.
        </p>
      ) : null}
      {error ? <div className="form-error">{error}</div> : null}
      {quotes.length > 0 ? (
        <div className="quote-draft-list">
          {quotes.map((quote) => (
            <article className="quote-draft-item" key={quote.id}>
              <div className="panel-title-row">
                <div>
                  <h3 className="compact-title">{quote.number}</h3>
                  <p className="empty-copy">
                    {quote.status} · {formatDate(quote.createdAt)}
                  </p>
                </div>
                <span className="badge">{formatMoney(quote.totalCents, quote.currency)}</span>
              </div>
              <Link className="button-secondary button-compact" href={`/deals/${dealId}/quotes/${quote.id}`}>
                View quote
              </Link>
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
            </article>
          ))}
        </div>
      ) : (
        <p className="empty-copy">
          No internal quote drafts yet. Create one after the deal has line items to review a frozen snapshot.
        </p>
      )}
    </section>
  );
}
