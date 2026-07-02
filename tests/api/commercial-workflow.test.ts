import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  summarizeDealCommercialReadiness,
  summarizeMoneyTotals,
  summarizeQuoteReadiness,
} from "@/lib/commercial-workflow";

const commercialPanel = readFileSync(
  join(process.cwd(), "components/commercial-workflow-panel.tsx"),
  "utf8",
);
const fieldMetric = readFileSync(
  join(process.cwd(), "components/field-metric.tsx"),
  "utf8",
);

describe("commercial workflow helpers", () => {
  it("summarizes multi-currency line-item totals deterministically", () => {
    expect(
      summarizeMoneyTotals([
        { currency: "USD", lineTotalCents: 12500 },
        { currency: "EUR", lineTotalCents: 5000 },
        { currency: "USD", lineTotalCents: 7500 },
      ]),
    ).toEqual([
      { currency: "EUR", valueCents: 5000 },
      { currency: "USD", valueCents: 20000 },
    ]);
  });

  it("guides draft quote readiness without inventing new blocking statuses", () => {
    expect(
      summarizeQuoteReadiness({
        quote: {
          status: "DRAFT",
          currency: "USD",
          totalCents: 0,
          items: [],
        },
        deal: {
          organization: null,
          person: null,
          activities: [],
          contractSteps: [{ type: "SOW", status: "NOT_STARTED" }],
        },
      }),
    ).toMatchObject({
      level: "attention",
      label: "Needs review",
      isReadyToSend: false,
      blockers: [
        "Add at least one quote item.",
        "Confirm a nonzero quote total.",
        "Attach a contact or organization to the deal.",
      ],
      warnings: [
        "Schedule a follow-up for quote review.",
        "SOW has not started yet.",
      ],
    });

    expect(
      summarizeQuoteReadiness({
        quote: {
          status: "DRAFT",
          currency: "USD",
          totalCents: 120000,
          items: [{ currency: "USD", lineTotalCents: 120000 }],
        },
        deal: {
          organization: { name: "Acme" },
          person: null,
          activities: [{ completedAt: null }],
          contractSteps: [{ type: "SOW", status: "SIGNED" }],
        },
      }),
    ).toMatchObject({
      level: "ready",
      label: "Ready to send",
      isReadyToSend: true,
      blockers: [],
      warnings: [],
    });
  });

  it("summarizes deal commercial readiness from line items, quotes, value, and SOW state", () => {
    const summary = summarizeDealCommercialReadiness({
      status: "OPEN",
      currency: "USD",
      valueCents: 125000,
      organization: { name: "Acme" },
      person: null,
      lineItems: [{ currency: "USD", lineTotalCents: 125000 }],
      quotes: [
        {
          number: "Q-0001",
          status: "SENT",
          currency: "USD",
          totalCents: 120000,
          createdAt: "2030-01-01T00:00:00.000Z",
        },
        {
          number: "Q-0002",
          status: "ACCEPTED",
          currency: "USD",
          totalCents: 120000,
          createdAt: "2030-02-01T00:00:00.000Z",
        },
      ],
      contractSteps: [{ type: "SOW", status: "BLOCKED" }],
    });

    expect(summary.latestQuote?.number).toBe("Q-0002");
    expect(summary.acceptedQuote?.number).toBe("Q-0002");
    expect(summary.valueSource).toBe("line-items");
    expect(summary.valueMismatch).toBe(true);
    expect(summary.contractLabel).toBe("SOW blocked");
    expect(summary.needs).toEqual(["contract/SOW", "deal value sync"]);
    expect(summary.label).toBe("Needs commercial review");
  });

  it("recognizes accepted quote-backed deal value", () => {
    expect(
      summarizeDealCommercialReadiness({
        status: "OPEN",
        currency: "USD",
        valueCents: 90000,
        organization: { name: "Acme" },
        lineItems: [{ currency: "USD", lineTotalCents: 90000 }],
        quotes: [
          {
            number: "Q-0003",
            status: "ACCEPTED",
            currency: "USD",
            totalCents: 90000,
            createdAt: "2030-03-01T00:00:00.000Z",
          },
        ],
        contractSteps: [{ type: "SOW", status: "SIGNED" }],
      }),
    ).toMatchObject({
      level: "ready",
      label: "Commercially ready",
      valueSource: "accepted-quote",
      valueMismatch: false,
      needs: [],
    });
  });

  it("renders commercial readiness guidance through shared panel descriptions", () => {
    expect(commercialPanel).toContain("PanelTitleRow");
    expect(commercialPanel).toContain('title="Commercial Readiness"');
    expect(commercialPanel).toContain("description={description}");
    expect(commercialPanel).toContain('Review: ${summary.needs.join(", ")}');
    expect(commercialPanel).toContain(
      "Deal scope, quote history, customer context, and contract/SOW status are aligned",
    );
    expect(commercialPanel).toContain('title="Send Review"');
    expect(commercialPanel).toContain("const description =");
    expect(commercialPanel).toContain("summary.nextActions.length > 0");
    expect(commercialPanel).toContain('summary.nextActions.join(" ")');
    expect(commercialPanel).toContain("FieldMetric");
    expect(commercialPanel).toContain(
      "<FieldMetric label={label} value={value} />",
    );
    expect(commercialPanel).toContain("<FieldMetric");
    expect(commercialPanel).toContain(
      'value={items.length > 0 ? items.join(" ") : empty}',
    );
    expect(commercialPanel).toContain(
      'const reviewActionsLabel = "Commercial review actions";',
    );
    expect(commercialPanel).toContain("import { ActionGroup }");
    expect(commercialPanel).toContain(
      '<ActionGroup className="filter-actions panel-actions-row" label={reviewActionsLabel}>',
    );
    expect(commercialPanel).toContain(
      'const reviewLineItemsLabel = "Commercial readiness: review deal line items";',
    );
    expect(commercialPanel).toContain(
      'const reviewQuotesLabel = "Commercial readiness: review deal quotes";',
    );
    expect(commercialPanel).toContain("const reviewContractWorkflowLabel =");
    expect(commercialPanel).toContain(
      "Commercial readiness: review contract and SOW workflow",
    );
    expect(commercialPanel).toContain("aria-label={reviewLineItemsLabel}");
    expect(commercialPanel).toContain("title={reviewLineItemsLabel}");
    expect(commercialPanel).toContain("aria-label={reviewQuotesLabel}");
    expect(commercialPanel).toContain("title={reviewQuotesLabel}");
    expect(commercialPanel).toContain(
      "aria-label={reviewContractWorkflowLabel}",
    );
    expect(commercialPanel).toContain("title={reviewContractWorkflowLabel}");
    expect(fieldMetric).toContain('className="field-label"');
    expect(fieldMetric).toContain(
      'className={["field-value", valueClassName].filter(Boolean).join(" ")}',
    );
    expect(commercialPanel).not.toContain("panel-intro-copy");
  });
});
