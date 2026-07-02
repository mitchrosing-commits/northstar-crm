"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/badge";
import { FormErrorMessage } from "@/components/form-error-message";
import { formatMoney } from "@/components/format";
import { PanelTitleRow } from "@/components/panel-title-row";

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
  const syncActionLabel = alreadySynced
    ? "Deal value is already synced to this accepted quote"
    : isSaving
      ? "Syncing accepted quote total to deal value"
      : "Sync accepted quote total to deal value";

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
    <section className="data-card section-spaced">
      <PanelTitleRow
        actions={<Badge label="Deal value sync is a manual action">Manual</Badge>}
        description="Syncing is manual, including after customer acceptance. Public acceptance does not run this step automatically; this action updates the deal value and currency from the accepted quote snapshot so reports and exports use the accepted total."
        title="Deal Value Sync"
      />
      <div className="deal-context-metrics panel-metric-strip">
        <div>
          <span>Current deal value</span>
          <strong>{formatMoney(dealValueCents, dealCurrency)}</strong>
        </div>
        <div>
          <span>Accepted quote total</span>
          <strong>{formatMoney(quoteTotalCents, quoteCurrency)}</strong>
        </div>
      </div>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <button
        aria-label={syncActionLabel}
        className="button-primary button-compact"
        disabled={isSaving || alreadySynced}
        onClick={syncDealValue}
        title={syncActionLabel}
        type="button"
      >
        {alreadySynced ? "Deal value synced" : isSaving ? "Syncing..." : "Sync quote total to deal value"}
      </button>
    </section>
  );
}
