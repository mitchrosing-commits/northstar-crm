import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { CountBadge } from "@/components/count-badge";
import { EmptyState } from "@/components/empty-state";
import { formatDate } from "@/components/format";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AuditDisplayEntry } from "@/lib/audit-format";
import {
  buildQuoteLifecycleTimeline,
  normalizeQuoteLifecycleTimelineFilter,
  type QuoteLifecycleTimelineFilter,
  type QuoteLifecycleTimelineQuoteState
} from "@/lib/quote-lifecycle-timeline";
import { buildQuoteFollowUpHref, type QuoteFollowUpQuote } from "@/lib/quote-follow-up";
import { TimelineBodyText } from "@/components/timeline-body-text";
import { TimelineMetaRow } from "@/components/timeline-meta-row";

type QuoteLifecycleEntry = AuditDisplayEntry & {
  id: string;
  createdAt: Date | string;
};

type QuoteLifecycleHistoryPanelProps = {
  entries: QuoteLifecycleEntry[];
  activeFilter?: string | null;
  dealId: string;
  id?: string;
  quote: QuoteFollowUpQuote;
  quoteState: QuoteLifecycleTimelineQuoteState;
};

const milestones = [
  { action: "quote.created", label: "Draft created" },
  { action: "quote.sent", label: "Sent" },
  { action: "quote.public_link_created", label: "Public link generated" },
  { action: "quote.public_accepted", label: "Accepted" },
  { action: "quote.accepted", label: "Accepted internally" },
  { action: "quote.declined", label: "Declined" },
  { action: "deal.value_synced_from_quote", label: "Deal sync succeeded" },
  { action: "quote.deal_value_sync_conflict", label: "Deal sync conflict created" },
  { action: "quote.deal_value_sync_reviewed", label: "Conflict reviewed" }
] as const;

export function QuoteLifecycleHistoryPanel({
  entries,
  activeFilter,
  dealId,
  id = "quote-lifecycle",
  quote,
  quoteState
}: QuoteLifecycleHistoryPanelProps) {
  const timeline = buildQuoteLifecycleTimeline(
    entries,
    quoteState,
    normalizeQuoteLifecycleTimelineFilter(activeFilter)
  );
  const eventCountLabel = `${timeline.filteredEvents.length} visible lifecycle ${timeline.filteredEvents.length === 1 ? "event" : "events"}`;

  return (
    <section className="data-card section-spaced" id={id}>
      <PanelTitleRow
        actions={<CountBadge label={eventCountLabel}>{timeline.filteredEvents.length}</CountBadge>}
        actionsLabel="Quote lifecycle event count"
        description="Operational timeline built from immutable workspace audit events for this quote and its accepted-quote deal sync."
        title="Quote Lifecycle"
      />
      <div className="quote-lifecycle-summary" aria-label="Quote lifecycle current state summary">
        {timeline.summary.map((item) => (
          <div className={`quote-lifecycle-summary-item quote-lifecycle-summary-${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <div className="quote-lifecycle-grid">
        {milestones.map((milestone) => {
          const entry = entries.find((event) => event.action === milestone.action);

          return (
            <div className="quote-lifecycle-step" key={milestone.action}>
              <span>{milestone.label}</span>
              {entry ? <strong>{formatDate(entry.createdAt)}</strong> : <Badge>Not yet</Badge>}
            </div>
          );
        })}
      </div>
      <nav aria-label="Quote lifecycle filters" className="quote-lifecycle-filters">
        {timeline.filters.map((filter) => {
          const selected = filter.id === timeline.activeFilter;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={selected ? "quote-lifecycle-filter quote-lifecycle-filter-active" : "quote-lifecycle-filter"}
              href={quoteLifecycleFilterHref(filter.id)}
              key={filter.id}
            >
              <span>{filter.label}</span>
              <Badge className="quote-lifecycle-filter-count">{filter.count}</Badge>
            </Link>
          );
        })}
      </nav>
      {timeline.filteredEvents.length > 0 ? (
        <ol className="timeline quote-operational-timeline" aria-label="Quote operational lifecycle timeline">
          {timeline.filteredEvents.map((event) => (
            <li
              className={[
                "timeline-item",
                "timeline-item-audit",
                `quote-timeline-source-${event.sourceLabel === "Deal sync" ? "sync" : "quote"}`,
                event.needsAttention ? "quote-timeline-needs-attention" : null
              ]
                .filter(Boolean)
                .join(" ")}
              id={`quote-timeline-${event.id}`}
              key={event.id}
            >
              <div className="timeline-item-heading">
                <strong>{event.label}</strong>
                {event.groupedCount > 1 ? <Badge>{event.groupedCount} grouped</Badge> : null}
                {event.needsAttention ? <Badge className="quote-attention-badge">Needs attention</Badge> : null}
              </div>
              <TimelineMetaRow
                ariaLabel={`${event.label} lifecycle event metadata`}
                items={[event.sourceLabel, event.actorLabel, formatDate(event.createdAt)]}
              />
              <TimelineBodyText>{event.detail}</TimelineBodyText>
              <div className="timeline-item-actions">
                <Link className="button-secondary button-compact" href={event.anchor as Route}>
                  Open section
                </Link>
                <Link
                  className="button-secondary button-compact"
                  href={buildQuoteFollowUpHref(quote, {
                    event: event.action,
                    historyFilter: timeline.activeFilter,
                    returnHash: `quote-timeline-${event.id}`
                  })}
                >
                  Create follow-up
                </Link>
                {event.sourceLabel === "Deal sync" ? (
                  <Link className="button-secondary button-compact" href={`/deals/${dealId}` as Route}>
                    Open deal
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState className="empty-state-compact empty-state-panel" title="No matching lifecycle events" />
      )}
    </section>
  );
}

function quoteLifecycleFilterHref(filter: QuoteLifecycleTimelineFilter) {
  if (filter === "all") return "#quote-lifecycle" as Route;
  return `?history=${filter}#quote-lifecycle` as Route;
}
