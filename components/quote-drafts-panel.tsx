"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { ActivityDueBadge } from "@/components/activity-due-badge";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { DownloadAction } from "@/components/download-action";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { formatDate, formatMoney } from "@/components/format";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";
import {
  buildQuoteFollowUpHref,
  quoteFollowUpStatus,
  quoteHasSimilarOpenFollowUp,
  type QuoteFollowUpQuote,
  type QuoteFollowUpStatus
} from "@/lib/quote-follow-up";

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
  dealValueSyncConflict?: string | null;
  dealValueSyncReviewedAt?: Date | string | null;
  dealValueSyncedAt?: Date | string | null;
};

type QuoteFollowUpActivity = {
  id: string;
  title: string;
  description?: string | null;
  dueAt?: Date | string | null;
  completedAt?: Date | string | null;
  owner?: {
    name?: string | null;
    email: string;
  } | null;
};

type QuoteDraftsPanelProps = {
  workspaceId: string;
  dealId: string;
  dealTitle: string;
  activities: QuoteFollowUpActivity[];
  followUpReferenceDate: Date | string;
  quotes: QuoteDraft[];
  canCreate: boolean;
  disabledReason?: string;
};

export function QuoteDraftsPanel({
  workspaceId,
  dealId,
  dealTitle,
  activities,
  followUpReferenceDate,
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
  const quotesWithFollowUp = quotes.map((quote) => {
    const followUpQuote = toQuoteFollowUpQuote(quote, dealId, dealTitle, activities);
    return {
      followUpQuote,
      quote,
      status: quoteFollowUpStatus(followUpQuote, new Date(followUpReferenceDate))
    };
  });
  const followUpSummary = summarizeQuoteFollowUps(quotesWithFollowUp);

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

    const quote = await response.json();
    setIsSaving(false);
    router.push(`/deals/${dealId}/quotes/${quote.id}?created=1#quote-items`);
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
        <Badge className={`badge ${followUpSummary.toneClass}`} label="Quote follow-up attention summary">
          {followUpSummary.label}
        </Badge>
      </ActionGroup>
      {!canCreate && disabledReason ? (
        <LockedPanelNotice>{disabledReason}</LockedPanelNotice>
      ) : null}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {quotes.length > 0 ? (
        <div className="quote-draft-list">
          {quotesWithFollowUp.map(({ followUpQuote, quote, status }) => {
            const quoteActionsLabel = `${quote.number} quote actions`;
            const shouldShowFollowUp = shouldShowQuoteFollowUp(quote, status);
            const similarOpenFollowUp = quoteHasSimilarOpenFollowUp(followUpQuote);

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
                  {quote.status === "DRAFT" ? (
                    <Link
                      aria-label={`Manage draft line items for quote ${quote.number}`}
                      className="button-secondary button-compact"
                      href={`/deals/${dealId}/quotes/${quote.id}#quote-items`}
                      title={`Manage draft line items for quote ${quote.number}`}
                    >
                      Manage items
                    </Link>
                  ) : null}
                  {quote.status === "SENT" ? (
                    <Link
                      aria-label={`Manage public link for quote ${quote.number}`}
                      className="button-secondary button-compact"
                      href={`/deals/${dealId}/quotes/${quote.id}#public-link`}
                      title={`Manage public link for quote ${quote.number}`}
                    >
                      Public link
                    </Link>
                  ) : null}
                  <DownloadAction
                    actionLabel={`Download PDF for quote ${quote.number}`}
                    className="button-secondary button-compact"
                    filename={`quote-${quote.number}.pdf`}
                    href={`/deals/${dealId}/quotes/${quote.id}/pdf`}
                    label="PDF"
                    pendingLabel="Preparing..."
                  />
                  {quote.status !== "DRAFT" && !similarOpenFollowUp ? (
                    <Link
                      aria-label={`Create follow-up draft for quote ${quote.number}`}
                      className="button-secondary button-compact"
                      href={buildQuoteFollowUpHref(followUpQuote, {
                        now: followUpReferenceDate,
                        returnTo: `/deals/${dealId}#quotes`
                      })}
                      title={`Create follow-up draft for quote ${quote.number}`}
                    >
                      Create follow-up
                    </Link>
                  ) : null}
                </ActionGroup>
                {shouldShowFollowUp ? (
                  <QuoteFollowUpSummary
                    dealId={dealId}
                    followUpQuote={followUpQuote}
                    now={followUpReferenceDate}
                    status={status}
                  />
                ) : (
                  <p className="quote-follow-up-compact-note">
                    Draft quote - follow-up actions become useful after the quote is sent.
                  </p>
                )}
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

function toQuoteFollowUpQuote(
  quote: QuoteDraft,
  dealId: string,
  dealTitle: string,
  activities: QuoteFollowUpActivity[]
): QuoteFollowUpQuote {
  return {
    deal: {
      activities,
      title: dealTitle
    },
    dealId,
    dealValueSyncConflict: quote.dealValueSyncConflict,
    dealValueSyncReviewedAt: quote.dealValueSyncReviewedAt,
    dealValueSyncedAt: quote.dealValueSyncedAt,
    id: quote.id,
    number: quote.number,
    status: quote.status
  };
}

function shouldShowQuoteFollowUp(quote: QuoteDraft, status: QuoteFollowUpStatus) {
  if (status.activity) return true;
  return quote.status === "SENT" || quote.status === "ACCEPTED" || quote.status === "DECLINED";
}

function summarizeQuoteFollowUps(
  quotes: Array<{ quote: QuoteDraft; status: QuoteFollowUpStatus }>
) {
  const relevant = quotes.filter(({ quote, status }) => shouldShowQuoteFollowUp(quote, status));
  const overdue = relevant.filter(({ status }) => status.label === "Follow-up overdue").length;
  const awaiting = relevant.filter(({ status }) => status.label === "No open quote follow-up").length;

  if (overdue > 0) {
    return {
      label: `${overdue} overdue quote follow-up${overdue === 1 ? "" : "s"}`,
      toneClass: "badge-overdue"
    };
  }

  if (awaiting > 0) {
    return {
      label: `${awaiting} quote${awaiting === 1 ? "" : "s"} awaiting follow-up`,
      toneClass: "badge-review-needed"
    };
  }

  if (relevant.length > 0) {
    return {
      label: "All active quotes covered",
      toneClass: "badge-completed"
    };
  }

  return {
    label: "No active quote follow-up needed",
    toneClass: "badge-not-applicable"
  };
}

function QuoteFollowUpSummary({
  dealId,
  followUpQuote,
  now,
  status
}: {
  dealId: string;
  followUpQuote: QuoteFollowUpQuote;
  now: Date | string;
  status: QuoteFollowUpStatus;
}) {
  const activity = status.activity;
  const returnTo = `/deals/${dealId}#quotes`;
  const activityHref = activity ? (`/activities/${activity.id}/edit?returnTo=${encodeURIComponent(returnTo)}` as Route) : null;
  const createHref = buildQuoteFollowUpHref(followUpQuote, { now, returnTo });
  const statusClassName = status.tone === "success"
    ? "quote-follow-up-card quote-follow-up-card-success"
    : status.tone === "warning"
      ? "quote-follow-up-card quote-follow-up-card-warning"
      : "quote-follow-up-card quote-follow-up-card-muted";

  return (
    <div className={statusClassName}>
      <div className="quote-follow-up-card-main">
        <span className="quote-follow-up-label">{status.label}</span>
        {activity ? (
          <>
            <Link className="inline-link" href={activityHref as Route}>
              {activity.title}
            </Link>
            <span className="quote-follow-up-meta">
              <ActivityDueBadge activity={activity} />
              {activity.owner ? (
                <span>Owner: {activity.owner.name ?? activity.owner.email}</span>
              ) : null}
              {activity.completedAt ? <span>Completed</span> : <span>Open</span>}
            </span>
          </>
        ) : (
          <InlineEmptyStateText>
            No saved activity mentions {followUpQuote.number} yet.
          </InlineEmptyStateText>
        )}
      </div>
      <ActionGroup className="filter-actions quote-follow-up-compact-actions" label={`${followUpQuote.number} follow-up actions`}>
        <Link className="button-secondary button-compact" href={`/deals/${dealId}/quotes/${followUpQuote.id}` as Route}>
          Open quote
        </Link>
        {activityHref ? (
          <Link className="button-secondary button-compact" href={activityHref}>
            {status.label === "Follow-up overdue" ? "Review or reschedule" : "Review follow-up"}
          </Link>
        ) : (
          <Link className="button-secondary button-compact" href={createHref}>
            Create follow-up
          </Link>
        )}
      </ActionGroup>
      {activity && !activity.completedAt ? (
        <p className="quote-follow-up-compact-note">
          Similar open follow-up exists. Open it before creating another.
        </p>
      ) : null}
    </div>
  );
}
