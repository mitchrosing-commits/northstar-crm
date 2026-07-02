export type CommercialMoney = {
  currency: string;
  valueCents: number;
};

export type CommercialQuoteStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | string;

export type CommercialLineItemSignal = {
  currency: string;
  lineTotalCents: number;
};

export type CommercialQuoteSignal = {
  id?: string;
  number?: string;
  status: CommercialQuoteStatus;
  currency: string;
  totalCents: number;
  items?: CommercialLineItemSignal[];
  publicLinks?: unknown[];
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type CommercialActivitySignal = {
  completedAt?: Date | string | null;
};

export type CommercialContractStepSignal = {
  type?: "NDA" | "MSA" | "SOW" | string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "SENT" | "SIGNED" | "BLOCKED" | "SKIPPED" | string;
};

export type CommercialDealSignal = {
  status?: string | null;
  valueCents?: number | null;
  currency: string;
  person?: unknown | null;
  organization?: unknown | null;
  lineItems?: CommercialLineItemSignal[];
  quotes?: CommercialQuoteSignal[];
  activities?: CommercialActivitySignal[];
  contractSteps?: CommercialContractStepSignal[];
};

export type QuoteReadinessSummary = {
  level: "ready" | "attention" | "locked";
  label: string;
  isReadyToSend: boolean;
  blockers: string[];
  warnings: string[];
  nextActions: string[];
};

export type DealCommercialSummary = {
  level: "ready" | "attention" | "empty" | "closed";
  label: string;
  hasCustomer: boolean;
  lineItemCount: number;
  lineItemTotals: CommercialMoney[];
  quoteCount: number;
  latestQuote: CommercialQuoteSignal | null;
  acceptedQuote: CommercialQuoteSignal | null;
  valueSource: "accepted-quote" | "line-items" | "manual" | "none" | "mixed-currency";
  valueMismatch: boolean;
  needs: string[];
  contractLabel: string;
};

export function summarizeQuoteReadiness(input: {
  quote: CommercialQuoteSignal;
  deal: Pick<CommercialDealSignal, "activities" | "contractSteps" | "organization" | "person">;
}): QuoteReadinessSummary {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: string[] = [];
  const items = input.quote.items ?? [];
  const hasCustomer = Boolean(input.deal.organization || input.deal.person);

  if (items.length === 0) blockers.push("Add at least one quote item.");
  if (input.quote.totalCents <= 0) blockers.push("Confirm a nonzero quote total.");
  if (!hasCustomer) blockers.push("Attach a contact or organization to the deal.");
  if (!hasOpenActivity(input.deal.activities)) warnings.push("Schedule a follow-up for quote review.");

  const contractWarning = contractReadinessWarning(input.deal.contractSteps);
  if (contractWarning) warnings.push(contractWarning);

  if (input.quote.status === "DRAFT") {
    if (blockers.length === 0) nextActions.push("Review totals, generate a public link if needed, then mark the quote sent.");
    else nextActions.push("Resolve readiness blockers before sending.");
  } else if (input.quote.status === "SENT") {
    if (!input.quote.publicLinks || input.quote.publicLinks.length === 0) warnings.push("No active public link is available.");
    nextActions.push("Follow up with the customer and track acceptance or decline.");
  } else if (input.quote.status === "ACCEPTED") {
    nextActions.push("Sync the accepted total to deal value when the commercial scope is final.");
  }

  if (input.quote.status === "ACCEPTED" || input.quote.status === "DECLINED") {
    return {
      level: "locked",
      label: input.quote.status === "ACCEPTED" ? "Accepted" : "Declined",
      isReadyToSend: false,
      blockers,
      warnings,
      nextActions
    };
  }

  return {
    level: blockers.length === 0 ? "ready" : "attention",
    label: blockers.length === 0 ? "Ready to send" : "Needs review",
    isReadyToSend: input.quote.status === "DRAFT" && blockers.length === 0,
    blockers,
    warnings,
    nextActions
  };
}

export function summarizeDealCommercialReadiness(deal: CommercialDealSignal): DealCommercialSummary {
  const lineItems = deal.lineItems ?? [];
  const quotes = sortQuotes(deal.quotes ?? []);
  const latestQuote = quotes[0] ?? null;
  const acceptedQuote = quotes.find((quote) => quote.status === "ACCEPTED") ?? null;
  const lineItemTotals = summarizeMoneyTotals(lineItems);
  const hasCustomer = Boolean(deal.organization || deal.person);
  const contractLabel = summarizeContractState(deal.contractSteps);
  const needs: string[] = [];

  if (!hasCustomer) needs.push("customer");
  if (lineItems.length === 0) needs.push("line items");
  if (quotes.length === 0) needs.push("quote");
  if (contractLabel === "SOW blocked" || contractLabel === "Contract attention") needs.push("contract/SOW");

  const valueSource = classifyDealValueSource(deal, lineItemTotals, acceptedQuote);
  const valueMismatch = Boolean(
    acceptedQuote &&
      deal.valueCents != null &&
      (acceptedQuote.totalCents !== deal.valueCents || acceptedQuote.currency !== deal.currency)
  );
  if (valueMismatch) needs.push("deal value sync");

  if (deal.status && deal.status !== "OPEN") {
    return {
      level: "closed",
      label: "Commercial history",
      hasCustomer,
      lineItemCount: lineItems.length,
      lineItemTotals,
      quoteCount: quotes.length,
      latestQuote,
      acceptedQuote,
      valueSource,
      valueMismatch,
      needs,
      contractLabel
    };
  }

  if (lineItems.length === 0 && quotes.length === 0) {
    return {
      level: "empty",
      label: "Scope needed",
      hasCustomer,
      lineItemCount: lineItems.length,
      lineItemTotals,
      quoteCount: quotes.length,
      latestQuote,
      acceptedQuote,
      valueSource,
      valueMismatch,
      needs,
      contractLabel
    };
  }

  return {
    level: needs.length === 0 ? "ready" : "attention",
    label: needs.length === 0 ? "Commercially ready" : "Needs commercial review",
    hasCustomer,
    lineItemCount: lineItems.length,
    lineItemTotals,
    quoteCount: quotes.length,
    latestQuote,
    acceptedQuote,
    valueSource,
    valueMismatch,
    needs,
    contractLabel
  };
}

export function summarizeMoneyTotals(items: CommercialLineItemSignal[]): CommercialMoney[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.lineTotalCents);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, valueCents]) => ({ currency, valueCents }));
}

function classifyDealValueSource(
  deal: CommercialDealSignal,
  lineItemTotals: CommercialMoney[],
  acceptedQuote: CommercialQuoteSignal | null
): DealCommercialSummary["valueSource"] {
  if (deal.valueCents == null) return "none";
  if (acceptedQuote && acceptedQuote.currency === deal.currency && acceptedQuote.totalCents === deal.valueCents) return "accepted-quote";
  if (lineItemTotals.length > 1) return "mixed-currency";
  const lineItemTotal = lineItemTotals[0];
  if (lineItemTotal && lineItemTotal.currency === deal.currency && lineItemTotal.valueCents === deal.valueCents) return "line-items";
  return "manual";
}

function sortQuotes(quotes: CommercialQuoteSignal[]) {
  return [...quotes].sort((a, b) => quoteTimestamp(b) - quoteTimestamp(a));
}

function quoteTimestamp(quote: CommercialQuoteSignal) {
  return toTime(quote.updatedAt) || toTime(quote.createdAt);
}

function hasOpenActivity(activities: CommercialActivitySignal[] | undefined) {
  return Boolean(activities?.some((activity) => !activity.completedAt));
}

function contractReadinessWarning(steps: CommercialContractStepSignal[] | undefined) {
  const contractLabel = summarizeContractState(steps);
  if (contractLabel === "SOW blocked") return "SOW is blocked.";
  if (contractLabel === "Contract attention") return "Contract workflow needs attention.";
  if (contractLabel === "SOW not started") return "SOW has not started yet.";
  return null;
}

function summarizeContractState(steps: CommercialContractStepSignal[] | undefined) {
  if (!steps || steps.length === 0) return "No contract steps";
  if (steps.some((step) => step.status === "BLOCKED" && step.type === "SOW")) return "SOW blocked";
  if (steps.some((step) => step.status === "BLOCKED" || step.status === "SENT" || step.status === "IN_PROGRESS")) {
    return "Contract attention";
  }
  const sow = steps.find((step) => step.type === "SOW");
  if (!sow) return "SOW not started";
  if (sow.status === "SIGNED") return "SOW signed";
  if (sow.status === "SKIPPED") return "SOW skipped";
  return "SOW not started";
}

function toTime(value: Date | string | null | undefined) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}
