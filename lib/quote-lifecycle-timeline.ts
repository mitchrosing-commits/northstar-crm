import { formatMoney } from "@/components/format";
import type { AuditDisplayEntry } from "@/lib/audit-format";

export const quoteLifecycleTimelineFilters = [
  { id: "all", label: "All events" },
  { id: "lifecycle", label: "Quote lifecycle" },
  { id: "pricing", label: "Pricing and line items" },
  { id: "public-link", label: "Public link" },
  { id: "acceptance", label: "Acceptance" },
  { id: "deal-sync", label: "Deal-value sync" },
  { id: "needs-attention", label: "Needs attention" }
] as const;

export type QuoteLifecycleTimelineFilter = (typeof quoteLifecycleTimelineFilters)[number]["id"];

export type QuoteLifecycleTimelineInputEntry = AuditDisplayEntry & {
  id: string;
  createdAt: Date | string;
};

export type QuoteLifecycleTimelineQuoteState = {
  status: string;
  dealStatus: string;
  totalCents: number;
  currency: string;
  publicLinkActive: boolean;
  dealValueSyncedAt?: Date | string | null;
  dealValueSyncConflict?: string | null;
  dealValueSyncReviewedAt?: Date | string | null;
  dealValueSyncResolution?: string | null;
  dealValueCents?: number | null;
  dealCurrency?: string | null;
};

export type QuoteLifecycleTimelineEvent = {
  id: string;
  action: string;
  actorLabel: string;
  anchor: string;
  category: Exclude<QuoteLifecycleTimelineFilter, "all" | "needs-attention">;
  createdAt: Date | string;
  detail: string;
  groupedCount: number;
  label: string;
  needsAttention: boolean;
  sourceLabel: "Quote" | "Deal sync";
};

export type QuoteLifecycleTimelineSummaryItem = {
  label: string;
  tone: "muted" | "success" | "warning";
  value: string;
};

const lineItemActions = new Set(["quote_item.created", "quote_item.updated", "quote_item.removed"]);
const quoteLifecycleActions = new Set([
  "quote.created",
  "quote.sent",
  "quote.accepted",
  "quote.declined"
]);
const pricingActions = new Set(["quote.adjustments_updated", ...lineItemActions]);
const publicLinkActions = new Set(["quote.public_link_created", "quote.public_link_revoked"]);
const acceptanceActions = new Set(["quote.accepted", "quote.public_accepted", "quote.declined"]);
const dealSyncActions = new Set([
  "deal.value_synced_from_quote",
  "quote.deal_value_sync_conflict",
  "quote.deal_value_sync_reviewed"
]);

export function normalizeQuoteLifecycleTimelineFilter(value: unknown): QuoteLifecycleTimelineFilter {
  return quoteLifecycleTimelineFilters.some((filter) => filter.id === value)
    ? (value as QuoteLifecycleTimelineFilter)
    : "all";
}

export function buildQuoteLifecycleTimeline(
  entries: QuoteLifecycleTimelineInputEntry[],
  quoteState: QuoteLifecycleTimelineQuoteState,
  activeFilter: QuoteLifecycleTimelineFilter = "all"
) {
  const normalizedFilter = normalizeQuoteLifecycleTimelineFilter(activeFilter);
  const events = groupTimelineEvents(
    entries
      .map((entry) => mapTimelineEvent(entry, quoteState))
      .filter((event): event is QuoteLifecycleTimelineEvent => Boolean(event))
      .sort((a, b) => eventTime(b.createdAt) - eventTime(a.createdAt))
  );
  const filteredEvents = filterTimelineEvents(events, normalizedFilter);

  return {
    activeFilter: normalizedFilter,
    events,
    filteredEvents,
    filters: quoteLifecycleTimelineFilters.map((filter) => ({
      ...filter,
      count: filterTimelineEvents(events, filter.id).length
    })),
    summary: buildQuoteLifecycleTimelineSummary(quoteState),
    unresolvedReview: hasUnresolvedSyncReview(quoteState)
  };
}

export function buildQuoteLifecycleTimelineSummary(
  quoteState: QuoteLifecycleTimelineQuoteState
): QuoteLifecycleTimelineSummaryItem[] {
  const editable = quoteState.status === "DRAFT" && quoteState.dealStatus === "OPEN";
  const unresolvedReview = hasUnresolvedSyncReview(quoteState);
  const synced =
    Boolean(quoteState.dealValueSyncedAt) ||
    (quoteState.dealValueCents === quoteState.totalCents && quoteState.dealCurrency === quoteState.currency);
  const reviewed = Boolean(quoteState.dealValueSyncReviewedAt);
  const syncValue = quoteState.status !== "ACCEPTED"
    ? "Not applicable"
    : synced
      ? "Synced"
      : unresolvedReview
        ? "Review needed"
        : reviewed && quoteState.dealValueSyncResolution === "KEEP_CURRENT_DEAL"
          ? "Current deal value kept"
          : "Pending";

  return [
    { label: "Current status", tone: quoteState.status === "DRAFT" || quoteState.status === "SENT" ? "warning" : "muted", value: quoteState.status },
    { label: "Editability", tone: editable ? "success" : "muted", value: editable ? "Editable draft" : "Snapshot locked" },
    { label: "Public link", tone: quoteState.publicLinkActive ? "success" : "muted", value: quoteState.publicLinkActive ? "Active" : "Not active" },
    { label: "Accepted total", tone: "muted", value: formatMoney(quoteState.totalCents, quoteState.currency) },
    { label: "Deal sync", tone: unresolvedReview ? "warning" : synced ? "success" : "muted", value: syncValue },
    { label: "Unresolved review", tone: unresolvedReview ? "warning" : "success", value: unresolvedReview ? "Yes" : "No" }
  ];
}

function mapTimelineEvent(
  entry: QuoteLifecycleTimelineInputEntry,
  quoteState: QuoteLifecycleTimelineQuoteState
): QuoteLifecycleTimelineEvent | null {
  if (quoteLifecycleActions.has(entry.action)) return quoteLifecycleEvent(entry);
  if (pricingActions.has(entry.action)) return pricingEvent(entry);
  if (publicLinkActions.has(entry.action)) return publicLinkEvent(entry);
  if (acceptanceActions.has(entry.action)) return acceptanceEvent(entry);
  if (dealSyncActions.has(entry.action)) return dealSyncEvent(entry, quoteState);
  return null;
}

function quoteLifecycleEvent(entry: QuoteLifecycleTimelineInputEntry): QuoteLifecycleTimelineEvent {
  if (entry.action === "quote.created") {
    const itemCount = numberMetadata(entry.metadata, "itemCount");
    return timelineEvent(entry, {
      anchor: "#quote-overview",
      category: "lifecycle",
      detail: itemCount === null ? "Draft quote created from the deal." : `Draft quote created with ${itemCount} ${itemCount === 1 ? "line item" : "line items"}.`,
      label: "Quote created",
      sourceLabel: "Quote"
    });
  }

  if (entry.action === "quote.sent") {
    return timelineEvent(entry, {
      anchor: "#quote-status",
      category: "lifecycle",
      detail: statusDetail(entry.metadata, "Quote moved to sent."),
      label: "Quote sent",
      sourceLabel: "Quote"
    });
  }

  if (entry.action === "quote.declined") {
    return timelineEvent(entry, {
      anchor: "#quote-status",
      category: "acceptance",
      detail: statusDetail(entry.metadata, "Quote was declined."),
      label: "Quote declined",
      sourceLabel: "Quote"
    });
  }

  return timelineEvent(entry, {
    anchor: "#quote-status",
    category: "acceptance",
    detail: statusDetail(entry.metadata, "Quote was accepted internally."),
    label: "Quote accepted",
    sourceLabel: "Quote"
  });
}

function pricingEvent(entry: QuoteLifecycleTimelineInputEntry): QuoteLifecycleTimelineEvent {
  if (lineItemActions.has(entry.action)) {
    const actionLabel =
      entry.action === "quote_item.created"
        ? "added"
        : entry.action === "quote_item.updated"
          ? "updated"
          : "removed";
    return timelineEvent(entry, {
      anchor: "#quote-items",
      category: "pricing",
      detail: `A draft quote line item was ${actionLabel}.`,
      label: "Line items changed",
      sourceLabel: "Quote"
    });
  }

  return timelineEvent(entry, {
    anchor: "#quote-adjustments",
    category: "pricing",
    detail: adjustmentDetail(entry.metadata),
    label: "Adjustments changed",
    sourceLabel: "Quote"
  });
}

function publicLinkEvent(entry: QuoteLifecycleTimelineInputEntry): QuoteLifecycleTimelineEvent {
  const created = entry.action === "quote.public_link_created";
  return timelineEvent(entry, {
    anchor: "#public-link",
    category: "public-link",
    detail: created ? "A customer-facing public quote link was generated." : "The active public quote link was revoked.",
    label: created ? "Public link generated" : "Public link revoked",
    sourceLabel: "Quote"
  });
}

function acceptanceEvent(entry: QuoteLifecycleTimelineInputEntry): QuoteLifecycleTimelineEvent {
  if (entry.action === "quote.public_accepted") {
    return timelineEvent(entry, {
      anchor: "#quote-status",
      category: "acceptance",
      detail: "Customer accepted the public quote.",
      label: "Quote accepted",
      sourceLabel: "Quote"
    });
  }

  return quoteLifecycleEvent(entry);
}

function dealSyncEvent(
  entry: QuoteLifecycleTimelineInputEntry,
  quoteState: QuoteLifecycleTimelineQuoteState
): QuoteLifecycleTimelineEvent {
  if (entry.action === "deal.value_synced_from_quote") {
    return timelineEvent(entry, {
      anchor: "#deal-value-sync",
      category: "deal-sync",
      detail: dealValueChangeDetail(entry.metadata, "Deal value was synced from the accepted quote."),
      label: "Deal value synced",
      sourceLabel: "Deal sync"
    });
  }

  if (entry.action === "quote.deal_value_sync_reviewed") {
    return timelineEvent(entry, {
      anchor: "#deal-value-sync",
      category: "deal-sync",
      detail: syncReviewDetail(entry.metadata),
      label: "Conflict reviewed",
      sourceLabel: "Deal sync"
    });
  }

  return timelineEvent(entry, {
    anchor: "#deal-value-sync",
    category: "deal-sync",
    detail: stringMetadata(entry.metadata, "reason") ?? "Automatic deal-value sync was blocked and needs review.",
    label: hasUnresolvedSyncReview(quoteState) ? "Deal sync needs review" : "Deal sync conflict created",
    needsAttention: hasUnresolvedSyncReview(quoteState),
    sourceLabel: "Deal sync"
  });
}

function timelineEvent(
  entry: QuoteLifecycleTimelineInputEntry,
  event: Omit<QuoteLifecycleTimelineEvent, "id" | "action" | "actorLabel" | "createdAt" | "groupedCount" | "needsAttention"> & {
    needsAttention?: boolean;
  }
): QuoteLifecycleTimelineEvent {
  return {
    id: entry.id,
    action: entry.action,
    actorLabel: entry.actor?.name ?? entry.actor?.email ?? "System",
    createdAt: entry.createdAt,
    groupedCount: 1,
    needsAttention: event.needsAttention ?? false,
    ...event
  };
}

function filterTimelineEvents(events: QuoteLifecycleTimelineEvent[], filter: QuoteLifecycleTimelineFilter) {
  if (filter === "all") return events;
  if (filter === "needs-attention") return events.filter((event) => event.needsAttention);
  return events.filter((event) => event.category === filter);
}

function groupTimelineEvents(events: QuoteLifecycleTimelineEvent[]) {
  const grouped: QuoteLifecycleTimelineEvent[] = [];

  for (const event of events) {
    const previous = grouped[grouped.length - 1];
    if (
      previous &&
      previous.category === event.category &&
      previous.label === event.label &&
      previous.actorLabel === event.actorLabel &&
      Math.abs(eventTime(previous.createdAt) - eventTime(event.createdAt)) <= 60_000
    ) {
      previous.groupedCount += event.groupedCount;
      previous.id = `${previous.id}-${event.id}`;
      previous.detail = groupedDetail(previous, event);
      previous.needsAttention = previous.needsAttention || event.needsAttention;
      continue;
    }
    grouped.push({ ...event });
  }

  return grouped;
}

function groupedDetail(previous: QuoteLifecycleTimelineEvent, event: QuoteLifecycleTimelineEvent) {
  if (previous.label === "Line items changed") {
    return `${previous.groupedCount} draft quote line-item changes were recorded.`;
  }
  if (previous.label === event.label) {
    return `${previous.groupedCount} related ${previous.category.replace("-", " ")} events were recorded.`;
  }
  return previous.detail;
}

function statusDetail(metadata: unknown, fallback: string) {
  const previousStatus = stringMetadata(metadata, "previousStatus");
  const nextStatus = stringMetadata(metadata, "nextStatus");
  return previousStatus && nextStatus ? `Status changed from ${previousStatus} to ${nextStatus}.` : fallback;
}

function adjustmentDetail(metadata: unknown) {
  const totalCents = nestedNumberMetadata(metadata, "next", "totalCents");
  const currency = stringMetadata(metadata, "currency") ?? "USD";
  return totalCents === null
    ? "Quote discount, tax, or total settings changed."
    : `Quote discount, tax, or total settings changed. New total: ${formatMoney(totalCents, currency)}.`;
}

function dealValueChangeDetail(metadata: unknown, fallback: string) {
  const nextValueCents = numberMetadata(metadata, "nextValueCents");
  const nextCurrency = stringMetadata(metadata, "nextCurrency") ?? "USD";
  return nextValueCents === null ? fallback : `Deal value updated to ${formatMoney(nextValueCents, nextCurrency)}.`;
}

function syncReviewDetail(metadata: unknown) {
  const resolution = stringMetadata(metadata, "resolution");
  if (resolution === "KEEP_CURRENT_DEAL") return "Reviewed and kept the current deal value.";
  if (resolution === "UPDATE_DEAL_TO_QUOTE") return "Reviewed and updated the deal to the accepted quote value.";
  return "Reviewed the deal-value sync conflict.";
}

function hasUnresolvedSyncReview(quoteState: QuoteLifecycleTimelineQuoteState) {
  return Boolean(quoteState.dealValueSyncConflict && !quoteState.dealValueSyncedAt && !quoteState.dealValueSyncReviewedAt);
}

function eventTime(value: Date | string) {
  return new Date(value).getTime();
}

function stringMetadata(metadata: unknown, key: string) {
  if (!isRecord(metadata)) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberMetadata(metadata: unknown, key: string) {
  if (!isRecord(metadata)) return null;
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nestedNumberMetadata(metadata: unknown, key: string, nestedKey: string) {
  if (!isRecord(metadata) || !isRecord(metadata[key])) return null;
  return numberMetadata(metadata[key], nestedKey);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
