"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { formatDate, formatMoney } from "@/components/format";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";

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
  disabledReason?: string;
};

export function QuoteDraftsPanel({
  workspaceId,
  dealId,
  quotes,
  canCreate,
  disabledReason,
}: QuoteDraftsPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const emptyQuoteDescription = canCreate
    ? "Create one after the deal has product-backed line items to review a frozen pricing snapshot."
    : disabledReason
      ? "Quote drafts are read-only for this deal."
      : "Add at least one product-backed deal line item to enable draft quote creation.";
  const quoteStatusSummaryLabel = "Quote status summary";

  async function createDraftQuote() {
    setError(null);
    setIsSaving(true);

    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/deals/${dealId}/quotes`,
      {
        method: "POST",
      },
    );

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
    <section className="data-card section-spaced" id="quotes">
      <PanelTitleRow
        actions={
          <button
            className="button-primary button-compact"
            disabled={isSaving || !canCreate}
            onClick={createDraftQuote}
            type="button"
          >
            {isSaving ? "Creating..." : "Create quote draft"}
          </button>
        }
        description="Create, send, accept, or decline internal quote snapshots from this deal. Quotes are internal snapshots of current line items. Status changes are internal tracking only; public links, PDFs, and customer acceptance are managed from quote detail without email delivery, signatures, or payment collection."
        title="Quotes"
      />
      <ActionGroup
        className="filter-actions panel-actions-row"
        label={quoteStatusSummaryLabel}
      >
        {quoteLifecycleStatuses.map((status) => (
          <Badge key={status}>
            {status}:{" "}
            {
              quotes.filter((quote) => quote.status === status.toUpperCase())
                .length
            }
          </Badge>
        ))}
      </ActionGroup>
      {!canCreate && disabledReason ? (
        <LockedPanelNotice>{disabledReason}</LockedPanelNotice>
      ) : null}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {quotes.length > 0 ? (
        <div className="quote-draft-list">
          {quotes.map((quote) => {
            const quoteActionsLabel = `${quote.number} quote actions`;

            return (
              <article className="quote-draft-item" key={quote.id}>
                <CompactTitleRow
                  actions={
                    <Badge>
                      {formatMoney(quote.totalCents, quote.currency)}
                    </Badge>
                  }
                  description={`${quote.status} · ${formatDate(quote.createdAt)}`}
                  title={quote.number}
                />
                <ActionGroup
                  className="filter-actions"
                  label={quoteActionsLabel}
                >
                  <Link
                    aria-label={`View quote ${quote.number}`}
                    className="button-secondary button-compact"
                    href={`/deals/${dealId}/quotes/${quote.id}`}
                    title={`View quote ${quote.number}`}
                  >
                    View quote
                  </Link>
                  {quote.status === "SENT" ? (
                    <Link
                      aria-label={`Add follow-up for quote ${quote.number}`}
                      className="button-secondary button-compact"
                      href={buildActivityFollowUpHref({
                        dueInDays: 3,
                        related: { type: "deal", id: dealId },
                        returnTo: `/deals/${dealId}`,
                        title: `Follow up on ${quote.number}`,
                        type: "TASK",
                      })}
                      title={`Add follow-up for quote ${quote.number}`}
                    >
                      Add quote follow-up
                    </Link>
                  ) : null}
                </ActionGroup>
                <TableScroll aria-label={`${quote.number} quote items table`}>
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
                      {quote.items.length > 0 ? (
                        quote.items.map((item) => (
                          <tr key={item.id}>
                            <td data-label="Item">
                              <div className="table-primary-cell">
                                <strong>{item.name}</strong>
                                {item.description ? (
                                  <span className="table-secondary-text">
                                    {item.description}
                                  </span>
                                ) : null}
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
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4} data-label="Quote items">
                            This quote has no line items. Add product-backed line items to the deal, then create a fresh quote draft.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </TableScroll>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          className="empty-state-compact empty-state-panel quote-drafts-empty"
          description={emptyQuoteDescription}
          title="No internal quote drafts yet"
        />
      )}
    </section>
  );
}

const quoteLifecycleStatuses = ["Draft", "Sent", "Accepted", "Declined"];
