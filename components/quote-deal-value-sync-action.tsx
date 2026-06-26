"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatMoney } from "@/components/format";

type QuoteDealValueSyncActionProps = {
  workspaceId: string;
  quoteId: string;
  dealValueCents: number | null;
  dealCurrency: string;
  quoteTotalCents: number;
  quoteCurrency: string;
};

export function QuoteDealValueSyncAction({
  workspaceId,
  quoteId,
  dealValueCents,
  dealCurrency,
  quoteTotalCents,
  quoteCurrency
}: QuoteDealValueSyncActionProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const alreadySynced = dealValueCents === quoteTotalCents && dealCurrency === quoteCurrency;

  async function syncDealValue() {
    setError(null);
    setIsSaving(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quotes/${quoteId}/sync-deal-value`, {
      method: "POST"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not sync this quote to the deal value.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  return (
    <section className="data-card" style={{ marginTop: 14 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Deal Value Sync</h2>
        <span className="badge">Manual</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 14 }}>
        Syncing is manual, including after customer acceptance. Public acceptance does not run this step automatically; this action updates the deal value and currency from the accepted quote snapshot so reports and exports use the accepted total.
      </p>
      <div className="deal-context-metrics" style={{ marginBottom: 14 }}>
        <div>
          <span>Current deal value</span>
          <strong>{formatMoney(dealValueCents, dealCurrency)}</strong>
        </div>
        <div>
          <span>Accepted quote total</span>
          <strong>{formatMoney(quoteTotalCents, quoteCurrency)}</strong>
        </div>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
      <button className="button-primary button-compact" disabled={isSaving || alreadySynced} onClick={syncDealValue} type="button">
        {alreadySynced ? "Deal value synced" : isSaving ? "Syncing..." : "Sync quote total to deal value"}
      </button>
    </section>
  );
}
