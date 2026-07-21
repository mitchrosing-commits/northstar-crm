import { describe, expect, it } from "vitest";

import {
  buildQuoteLifecycleTimeline,
  normalizeQuoteLifecycleTimelineFilter,
  type QuoteLifecycleTimelineInputEntry,
  type QuoteLifecycleTimelineQuoteState
} from "@/lib/quote-lifecycle-timeline";

const baseQuoteState: QuoteLifecycleTimelineQuoteState = {
  status: "ACCEPTED",
  dealStatus: "OPEN",
  totalCents: 250000,
  currency: "USD",
  publicLinkActive: true,
  dealValueSyncConflict: "Deal value changed after this quote was sent. Review before syncing this accepted quote total.",
  dealValueSyncReviewedAt: null,
  dealValueSyncedAt: null,
  dealValueCents: 125000,
  dealCurrency: "USD"
};

describe("quote lifecycle operational timeline", () => {
  it("orders events newest first and uses human-readable labels", () => {
    const timeline = buildQuoteLifecycleTimeline(
      [
        entry("created", "quote.created", "2026-07-13T10:00:00.000Z", { itemCount: 1 }),
        entry("sent", "quote.sent", "2026-07-13T11:00:00.000Z", { previousStatus: "DRAFT", nextStatus: "SENT" }),
        entry("accepted", "quote.public_accepted", "2026-07-13T12:00:00.000Z", {
          publicLinkId: "plink_secret",
          token: "public_token_should_not_render"
        })
      ],
      baseQuoteState
    );

    expect(timeline.events.map((event) => event.label)).toEqual(["Quote accepted", "Quote sent", "Quote created"]);
    expect(timeline.events[0]).toMatchObject({
      actorLabel: "Riley Revenue",
      anchor: "#quote-status",
      category: "acceptance",
      detail: "Customer accepted the public quote.",
      sourceLabel: "Quote"
    });
    expect(JSON.stringify(timeline.events)).not.toContain("public_token_should_not_render");
    expect(JSON.stringify(timeline.events)).not.toContain("plink_secret");
  });

  it("filters pricing, public link, acceptance, deal-sync, and needs-attention events", () => {
    const entries = [
      entry("adjustments", "quote.adjustments_updated", "2026-07-13T10:04:00.000Z", { next: { totalCents: 250000 } }),
      entry("item-one", "quote_item.updated", "2026-07-13T10:03:30.000Z"),
      entry("item-two", "quote_item.created", "2026-07-13T10:03:10.000Z"),
      entry("link", "quote.public_link_created", "2026-07-13T10:02:00.000Z", {
        publicLinkId: "internal-public-link-id"
      }),
      entry("accepted", "quote.public_accepted", "2026-07-13T10:01:00.000Z"),
      entry("conflict", "quote.deal_value_sync_conflict", "2026-07-13T10:00:00.000Z", {
        reason: baseQuoteState.dealValueSyncConflict,
        currentDealValueCents: 125000
      })
    ];

    expect(buildQuoteLifecycleTimeline(entries, baseQuoteState, "pricing").filteredEvents.map((event) => event.label)).toEqual([
      "Adjustments changed",
      "Line items changed"
    ]);
    expect(buildQuoteLifecycleTimeline(entries, baseQuoteState, "public-link").filteredEvents).toHaveLength(1);
    expect(buildQuoteLifecycleTimeline(entries, baseQuoteState, "acceptance").filteredEvents).toHaveLength(1);
    expect(buildQuoteLifecycleTimeline(entries, baseQuoteState, "deal-sync").filteredEvents).toHaveLength(1);
    expect(buildQuoteLifecycleTimeline(entries, baseQuoteState, "needs-attention").filteredEvents).toMatchObject([
      { label: "Deal sync needs review", needsAttention: true, anchor: "#deal-value-sync" }
    ]);
  });

  it("groups repeated low-value line item events and preserves deep-link anchors", () => {
    const timeline = buildQuoteLifecycleTimeline(
      [
        entry("item-one", "quote_item.updated", "2026-07-13T10:03:30.000Z"),
        entry("item-two", "quote_item.created", "2026-07-13T10:03:10.000Z"),
        entry("item-three", "quote_item.removed", "2026-07-13T10:02:55.000Z"),
        entry("sync", "deal.value_synced_from_quote", "2026-07-13T09:59:00.000Z", {
          nextValueCents: 250000,
          nextCurrency: "USD",
          quoteId: "quote-1"
        })
      ],
      { ...baseQuoteState, dealValueSyncConflict: null, dealValueSyncedAt: "2026-07-13T10:00:00.000Z" }
    );

    expect(timeline.events).toMatchObject([
      {
        label: "Line items changed",
        groupedCount: 3,
        detail: "3 draft quote line-item changes were recorded.",
        anchor: "#quote-items"
      },
      {
        label: "Deal value synced",
        detail: "Deal value updated to $2,500.",
        anchor: "#deal-value-sync",
        sourceLabel: "Deal sync"
      }
    ]);
  });

  it("normalizes unknown filters and summarizes current quote state", () => {
    expect(normalizeQuoteLifecycleTimelineFilter("not-a-filter")).toBe("all");
    const timeline = buildQuoteLifecycleTimeline([], baseQuoteState, "needs-attention");

    expect(timeline.activeFilter).toBe("needs-attention");
    expect(timeline.summary).toEqual(
      expect.arrayContaining([
        { label: "Current status", tone: "muted", value: "ACCEPTED" },
        { label: "Public link", tone: "success", value: "Active" },
        { label: "Accepted total", tone: "muted", value: "$2,500" },
        { label: "Deal sync", tone: "warning", value: "Review needed" },
        { label: "Unresolved review", tone: "warning", value: "Yes" }
      ])
    );
  });
});

function entry(
  id: string,
  action: string,
  createdAt: string,
  metadata?: unknown
): QuoteLifecycleTimelineInputEntry {
  return {
    id,
    action,
    createdAt,
    entityType: action.startsWith("deal.") ? "Deal" : action.startsWith("quote_item.") ? "QuoteItem" : "Quote",
    metadata,
    actor: { name: "Riley Revenue", email: "riley@example.test" }
  };
}
