import Link from "next/link";

import { ActionGroup } from "@/components/action-group";
import { Badge } from "@/components/badge";
import { FieldMetric } from "@/components/field-metric";
import { formatMoney } from "@/components/format";
import { PanelTitleRow } from "@/components/panel-title-row";
import type {
  DealCommercialSummary,
  QuoteReadinessSummary,
} from "@/lib/commercial-workflow";

export function DealCommercialSummaryPanel({
  dealId,
  summary,
}: {
  dealId: string;
  summary: DealCommercialSummary;
}) {
  const description =
    summary.needs.length > 0
      ? `Review: ${summary.needs.join(", ")}.`
      : "Deal scope, quote history, customer context, and contract/SOW status are aligned for the current v1 workflow.";
  const reviewLineItemsLabel = "Commercial readiness: review deal line items";
  const reviewQuotesLabel = "Commercial readiness: review deal quotes";
  const reviewContractWorkflowLabel =
    "Commercial readiness: review contract and SOW workflow";
  const reviewActionsLabel = "Commercial review actions";

  return (
    <section className="data-card section-spaced">
      <PanelTitleRow
        actions={
          <Badge
            className={`badge ${summary.level === "ready" ? "badge-won" : summary.level === "attention" ? "badge-lost" : ""}`}
          >
            {summary.label}
          </Badge>
        }
        description={description}
        eyebrow="Commercial workflow"
        title="Commercial Readiness"
      />
      <div className="deal-context-metrics">
        <div>
          <span>Line items</span>
          <strong>{summary.lineItemCount}</strong>
        </div>
        <div>
          <span>Line total</span>
          <strong>{formatMoneyTotals(summary.lineItemTotals)}</strong>
        </div>
        <div>
          <span>Quotes</span>
          <strong>{summary.quoteCount}</strong>
        </div>
        <div>
          <span>Value source</span>
          <strong>{valueSourceLabel(summary.valueSource)}</strong>
        </div>
      </div>
      <div className="field-grid section-spaced">
        <CommercialField
          label="Latest quote"
          value={quoteLabel(summary.latestQuote)}
        />
        <CommercialField
          label="Accepted quote"
          value={quoteLabel(summary.acceptedQuote)}
        />
        <CommercialField label="Contract / SOW" value={summary.contractLabel} />
        <CommercialField
          label="Customer context"
          value={summary.hasCustomer ? "Attached" : "Missing"}
        />
      </div>
      <ActionGroup className="filter-actions panel-actions-row" label={reviewActionsLabel}>
        <Link
          aria-label={reviewLineItemsLabel}
          className="button-secondary button-compact"
          href={`/deals/${dealId}#line-items`}
          title={reviewLineItemsLabel}
        >
          Review line items
        </Link>
        <Link
          aria-label={reviewQuotesLabel}
          className="button-secondary button-compact"
          href={`/deals/${dealId}#quotes`}
          title={reviewQuotesLabel}
        >
          Review quotes
        </Link>
        <Link
          aria-label={reviewContractWorkflowLabel}
          className="button-secondary button-compact"
          href={`/deals/${dealId}#contract-workflow`}
          title={reviewContractWorkflowLabel}
        >
          Review SOW
        </Link>
      </ActionGroup>
    </section>
  );
}

export function QuoteReadinessPanel({
  summary,
}: {
  summary: QuoteReadinessSummary;
}) {
  const description =
    summary.nextActions.length > 0 ? summary.nextActions.join(" ") : undefined;

  return (
    <section className="data-card section-spaced">
      <PanelTitleRow
        actions={
          <Badge
            className={`badge ${summary.level === "ready" ? "badge-won" : summary.level === "attention" ? "badge-lost" : ""}`}
          >
            {summary.label}
          </Badge>
        }
        description={description}
        eyebrow="Quote readiness"
        title="Send Review"
      />
      <div className="field-grid">
        <ReadinessList
          label="Blockers"
          items={summary.blockers}
          empty="No send blockers"
        />
        <ReadinessList
          label="Guidance"
          items={summary.warnings}
          empty="No guidance warnings"
        />
      </div>
    </section>
  );
}

export function DealCommercialListSummary({
  lineItemCount,
  quoteCount,
  latestQuote,
}: {
  lineItemCount: number;
  quoteCount: number;
  latestQuote?: {
    number: string;
    status: string;
    totalCents: number;
    currency: string;
  } | null;
}) {
  return (
    <span className="table-primary-cell">
      <strong>
        {quoteCount > 0
          ? `${quoteCount} quote${quoteCount === 1 ? "" : "s"}`
          : "No quotes"}
      </strong>
      <span className="table-secondary-text">
        {latestQuote
          ? `${latestQuote.number} · ${latestQuote.status} · ${formatMoney(latestQuote.totalCents, latestQuote.currency)}`
          : `${lineItemCount} line item${lineItemCount === 1 ? "" : "s"}`}
      </span>
    </span>
  );
}

function CommercialField({ label, value }: { label: string; value: string }) {
  return <FieldMetric label={label} value={value} />;
}

function ReadinessList({
  empty,
  items,
  label,
}: {
  empty: string;
  items: string[];
  label: string;
}) {
  return (
    <FieldMetric
      label={label}
      value={items.length > 0 ? items.join(" ") : empty}
    />
  );
}

function quoteLabel(quote: DealCommercialSummary["latestQuote"]) {
  if (!quote) return "None";
  return `${quote.number ?? "Quote"} · ${quote.status} · ${formatMoney(quote.totalCents, quote.currency)}`;
}

function formatMoneyTotals(totals: DealCommercialSummary["lineItemTotals"]) {
  if (totals.length === 0) return "$0";
  return totals
    .map((total) => formatMoney(total.valueCents, total.currency))
    .join(" / ");
}

function valueSourceLabel(source: DealCommercialSummary["valueSource"]) {
  if (source === "accepted-quote") return "Accepted quote";
  if (source === "line-items") return "Line items";
  if (source === "mixed-currency") return "Mixed currency";
  if (source === "none") return "Not set";
  return "Manual";
}
