"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";
import { formatDate, formatMoney } from "@/components/format";
import { PanelTitleRow } from "@/components/panel-title-row";

type QuoteDealValueSyncActionProps = {
  workspaceId: string;
  quoteId: string;
  id?: string;
  dealValueCents: number | null;
  dealCurrency: string;
  dealValueSyncedAt?: Date | string | null;
  dealValueSyncConflict?: string | null;
  dealValueSyncReviewedAt?: Date | string | null;
  dealValueSyncResolution?: string | null;
  dealId: string;
  quoteHref: string;
  quoteTotalCents: number;
  quoteCurrency: string;
  sentDealValueCents?: number | null;
  sentDealCurrency?: string | null;
  sentAt?: Date | string | null;
  acceptedAt?: Date | string | null;
};

export function QuoteDealValueSyncAction({
  workspaceId,
  quoteId,
  id,
  dealValueCents,
  dealCurrency,
  dealValueSyncedAt,
  dealValueSyncConflict,
  dealValueSyncReviewedAt,
  dealValueSyncResolution,
  dealId,
  quoteHref,
  quoteTotalCents,
  quoteCurrency,
  sentDealValueCents,
  sentDealCurrency,
  sentAt,
  acceptedAt
}: QuoteDealValueSyncActionProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<"update" | "keep" | null>(null);
  const [confirmedUpdate, setConfirmedUpdate] = useState(false);
  const alreadySynced = dealValueCents === quoteTotalCents && dealCurrency === quoteCurrency;
  const persistedSynced = Boolean(dealValueSyncedAt);
  const reviewed = Boolean(dealValueSyncReviewedAt);
  const requiresReview = Boolean(dealValueSyncConflict) && !persistedSynced && !reviewed;
  const reviewComplete = persistedSynced || reviewed || alreadySynced;
  const syncState = persistedSynced || alreadySynced
    ? "Synced"
    : reviewed && dealValueSyncResolution === "KEEP_CURRENT_DEAL"
      ? "Reviewed: current deal value kept"
      : requiresReview
        ? "Review needed"
        : "Pending";
  const updateActionLabel = "Update deal value to the accepted quote total";
  const keepActionLabel = "Keep current deal value and mark this quote sync conflict reviewed";
  const openDealHref =
    `/deals/${dealId}?returnTo=${encodeURIComponent(quoteHref)}#overview` as Route;

  async function submitReview(resolution: "UPDATE_DEAL_TO_QUOTE" | "KEEP_CURRENT_DEAL") {
    setError(null);
    setNotice(null);
    if (savingAction !== null) return;
    const action = resolution === "UPDATE_DEAL_TO_QUOTE" ? "update" : "keep";
    setSavingAction(action);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/quotes/${quoteId}/sync-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resolution,
        confirmation: resolution === "UPDATE_DEAL_TO_QUOTE" && confirmedUpdate ? "UPDATE_DEAL_TO_ACCEPTED_QUOTE" : undefined
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not review this quote sync conflict.");
      setSavingAction(null);
      return;
    }

    setNotice(resolution === "UPDATE_DEAL_TO_QUOTE" ? "Deal value updated from the accepted quote." : "Conflict reviewed. Current deal value was kept.");
    setSavingAction(null);
    preserveDealValueSyncAnchor();
    router.refresh();
  }

  return (
    <section className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={
          persistedSynced || alreadySynced ? (
            <Badge label="Deal value is synced from the accepted quote">Synced</Badge>
          ) : requiresReview ? (
            <Badge label="Deal value changed after this quote was sent">Review</Badge>
          ) : (
            <Badge label="Accepted quote is waiting for deal value sync">Pending</Badge>
          )
        }
        description="Accepted quote totals sync to the deal automatically only when the deal value still matches the sent-time baseline. Review conflicts before reports and exports use a different deal value."
        title="Deal Value Sync"
      />
      <div className="deal-context-metrics panel-metric-strip">
        <div>
          <span>Sent-time deal value</span>
          <strong>{formatMoney(sentDealValueCents ?? null, sentDealCurrency ?? quoteCurrency)}</strong>
        </div>
        <div>
          <span>Current deal value</span>
          <strong>{formatMoney(dealValueCents, dealCurrency)}</strong>
        </div>
        <div>
          <span>Accepted quote total</span>
          <strong>{formatMoney(quoteTotalCents, quoteCurrency)}</strong>
        </div>
        <div>
          <span>Sync state</span>
          <strong>{syncState}</strong>
        </div>
        <div>
          <span>Sent</span>
          <strong>{sentAt ? formatDate(sentAt) : "Not recorded"}</strong>
        </div>
        <div>
          <span>Accepted</span>
          <strong>{acceptedAt ? formatDate(acceptedAt) : "Not recorded"}</strong>
        </div>
      </div>
      {dealValueSyncConflict && requiresReview ? <FormErrorMessage>{dealValueSyncConflict}</FormErrorMessage> : null}
      {dealValueSyncConflict && !requiresReview ? (
        <p className="form-help">
          Automatic sync was blocked because: {dealValueSyncConflict}
        </p>
      ) : null}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {notice ? <FormSuccessMessage>{notice}</FormSuccessMessage> : null}
      {requiresReview ? (
        <div className="quote-sync-review-actions">
          <div className="form-help">
            <strong>Update the deal:</strong> changes the current deal value and currency to the accepted quote total. This writes an audit event and leaves quote items unchanged.
          </div>
          <label className="checkbox-label">
            <input
              checked={confirmedUpdate}
              onChange={(event) => setConfirmedUpdate(event.target.checked)}
              type="checkbox"
            />
            Confirm that the deal should use the accepted quote total.
          </label>
          <div className="form-actions form-actions-compact">
            <button
              aria-label={updateActionLabel}
              className="button-primary button-compact"
              disabled={savingAction !== null || !confirmedUpdate}
              onClick={() => submitReview("UPDATE_DEAL_TO_QUOTE")}
              title={updateActionLabel}
              type="button"
            >
              {savingAction === "update" ? "Updating..." : "Update deal value"}
            </button>
            <button
              aria-label={keepActionLabel}
              className="button-secondary button-compact"
              disabled={savingAction !== null}
              onClick={() => submitReview("KEEP_CURRENT_DEAL")}
              title={keepActionLabel}
              type="button"
            >
              {savingAction === "keep" ? "Reviewing..." : "Keep current deal value"}
            </button>
            <Link className="button-secondary button-compact" href={openDealHref}>
              Open deal
            </Link>
          </div>
          <p className="form-help">
            Keeping the current deal value records that this conflict was reviewed and does not update the deal.
          </p>
        </div>
      ) : (
        <p className="form-help">
          {reviewComplete
            ? "This accepted quote sync state has already been reviewed. Repeating the action will not create duplicate sync or audit events."
            : "No sync conflict is waiting for review."}
        </p>
      )}
    </section>
  );
}

function preserveDealValueSyncAnchor() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#deal-value-sync`);
}
