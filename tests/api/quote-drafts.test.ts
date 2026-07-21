import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatMoney, formatQuoteAdjustment } from "@/components/format";
import { generateQuotePdf, quotePdfFilename } from "@/lib/pdf/quote-pdf";
import { buildPublicQuoteUrl } from "@/lib/public-url";
import { quoteIntColumnMax } from "@/lib/product-limits";
import {
  calculateQuoteTotals,
  generatePublicQuoteToken,
} from "@/lib/services/quote-service";

const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const quoteService = readFileSync(
  join(process.cwd(), "lib/services/quote-service.ts"),
  "utf8",
);
const crmBarrel = readFileSync(
  join(process.cwd(), "lib/services/crm.ts"),
  "utf8",
);
const dealService = readFileSync(
  join(process.cwd(), "lib/services/deal-service.ts"),
  "utf8",
);
const workspaceRoute = readFileSync(
  join(
    process.cwd(),
    "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts",
  ),
  "utf8",
);
const dealPage = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/page.tsx"),
  "utf8",
);
const quoteDetailPage = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/page.tsx"),
  "utf8",
);
const commercialPanel = readFileSync(
  join(process.cwd(), "components/commercial-workflow-panel.tsx"),
  "utf8",
);
const quotePrintPage = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/print/page.tsx"),
  "utf8",
);
const publicQuotePage = readFileSync(
  join(process.cwd(), "app/q/[token]/page.tsx"),
  "utf8",
);
const publicQuoteActions = readFileSync(
  join(process.cwd(), "app/q/[token]/actions.ts"),
  "utf8",
);
const quotePdfRoute = readFileSync(
  join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/pdf/route.ts"),
  "utf8",
);
const quotePdf = readFileSync(
  join(process.cwd(), "lib/pdf/quote-pdf.ts"),
  "utf8",
);
const quotePanel = readFileSync(
  join(process.cwd(), "components/quote-drafts-panel.tsx"),
  "utf8",
);
const downloadAction = readFileSync(
  join(process.cwd(), "components/download-action.tsx"),
  "utf8",
);
const quoteLineItemsPanel = readFileSync(
  join(process.cwd(), "components/quote-line-items-panel.tsx"),
  "utf8",
);
const quotePublicLinkControls = readFileSync(
  join(process.cwd(), "components/quote-public-link-controls.tsx"),
  "utf8",
);
const quoteValueSyncAction = readFileSync(
  join(process.cwd(), "components/quote-deal-value-sync-action.tsx"),
  "utf8",
);
const quoteStatusActions = readFileSync(
  join(process.cwd(), "components/quote-status-actions.tsx"),
  "utf8",
);
const quoteAdjustmentsForm = readFileSync(
  join(process.cwd(), "components/quote-adjustments-form.tsx"),
  "utf8",
);
const quotePrintNotice = readFileSync(
  join(process.cwd(), "components/quote-print-notice.tsx"),
  "utf8",
);
const lockedPanelNotice = readFileSync(
  join(process.cwd(), "components/locked-panel-notice.tsx"),
  "utf8",
);
const panelTitleRow = readFileSync(
  join(process.cwd(), "components/panel-title-row.tsx"),
  "utf8",
);
const compactTitleRow = readFileSync(
  join(process.cwd(), "components/compact-title-row.tsx"),
  "utf8",
);
const printButton = readFileSync(
  join(process.cwd(), "components/print-button.tsx"),
  "utf8",
);
const formatHelpers = readFileSync(
  join(process.cwd(), "components/format.ts"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const personName = readFileSync(
  join(process.cwd(), "lib/person-name.ts"),
  "utf8",
);
const tableScroll = readFileSync(
  join(process.cwd(), "components/table-scroll.tsx"),
  "utf8",
);
const currentStatus = readFileSync(
  join(process.cwd(), "docs/current-status.md"),
  "utf8",
);
const architecture = readFileSync(
  join(process.cwd(), "docs/architecture.md"),
  "utf8",
);
const routeMap = readFileSync(
  join(process.cwd(), "docs/api-route-map.md"),
  "utf8",
);

describe("quote draft MVP", () => {
  it("formats quote and product money without rounding away cents", () => {
    expect(formatMoney(125000, "USD")).toBe("$1,250");
    expect(formatMoney(125050, "USD")).toBe("$1,250.50");
  });

  it("generates safe public quote tokens and URLs", () => {
    const token = generatePublicQuoteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(buildPublicQuoteUrl("abc123", "https://crm.example.test")).toBe(
      "https://crm.example.test/q/abc123",
    );
    expect(
      buildPublicQuoteUrl("abc123", "http://localhost:3000", {
        NODE_ENV: "test",
      }),
    ).toBe("http://localhost:3000/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "http://localhost:3000", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "http://crm.example.test", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://0.0.0.0:3000", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://192.168.1.10", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://192.0.2.10", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://[fd00::1]", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://[::ffff:192.168.1.10]", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://[::192.168.1.10]", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://[64:ff9b::192.168.1.10]", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://[2001:db8::1]", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://preview:secret@crm.example.test", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://preview:secret@crm.example.test", {
        NODE_ENV: "test",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://2130706433", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://0x7f.0.0.1", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://0300.0250.0001.0012", {
        NODE_ENV: "production",
      }),
    ).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc123", "https://crm.example.test", {
        NODE_ENV: "production",
      }),
    ).toBe("https://crm.example.test/q/abc123");
    expect(buildPublicQuoteUrl("abc123")).toBe("/q/abc123");
    expect(
      buildPublicQuoteUrl("abc/../settings?x=1", "https://crm.example.test"),
    ).toBe("https://crm.example.test/q/abc%2F..%2Fsettings%3Fx%3D1");
    expect(
      buildPublicQuoteUrl({ token: "abc123" }, "https://crm.example.test"),
    ).toBe("https://crm.example.test/q/");
  });

  it("generates safe quote PDF filenames and handles long or blank PDF fields", () => {
    const pdf = generateQuotePdf({
      workspaceName: "Northstar Revenue",
      quote: {
        number: "Q 001 / final",
        status: "ACCEPTED",
        currency: "USD",
        subtotalCents: 125050,
        discountType: "NONE",
        discountValue: 0,
        discountCents: 0,
        taxType: "NONE",
        taxValue: 0,
        taxCents: 0,
        totalCents: 125050,
        createdAt: "2030-01-01T00:00:00.000Z",
        deal: {
          title: "Expansion Deal",
          organization: { name: "Acme Rockets" },
          person: { firstName: "Ada", lastName: "Lovelace" },
        },
        items: [
          {
            name: "Very Long Implementation Package Name",
            description: null,
            quantity: 1,
            unitPriceCents: 125050,
            currency: "USD",
            lineTotalCents: 125050,
          },
        ],
      },
    }).toString("latin1");

    expect(quotePdfFilename(" Q 001 / final ")).toBe("quote-Q-001-final.pdf");
    expect(quotePdfFilename(" !!! ")).toBe("quote-quote.pdf");
    expect(pdf).toContain("Organization: Acme Rockets");
    expect(pdf).toContain("Contact: Ada Lovelace");
    expect(pdf).toContain("Very Long Implement");
    expect(pdf).toContain("$1,250.50");
    expect(pdf).toContain("Quote-level discount");
    expect(pdf).toContain("Quote-level tax");
    expect(pdf).toContain("$0");
  });

  it("calculates quote-level discount and tax totals server-side", () => {
    expect(calculateQuoteTotals(10000, {})).toMatchObject({
      discountType: "NONE",
      discountValue: 0,
      discountCents: 0,
      taxType: "NONE",
      taxValue: 0,
      taxCents: 0,
      totalCents: 10000,
    });
    expect(
      calculateQuoteTotals(10000, {
        discountType: "PERCENT",
        discountValue: 1000,
      }),
    ).toMatchObject({
      discountCents: 1000,
      totalCents: 9000,
    });
    expect(
      calculateQuoteTotals(10000, {
        discountType: "FIXED",
        discountValue: 2500,
      }),
    ).toMatchObject({
      discountCents: 2500,
      totalCents: 7500,
    });
    expect(
      calculateQuoteTotals(10000, { taxType: "PERCENT", taxValue: 825 }),
    ).toMatchObject({
      taxCents: 825,
      totalCents: 10825,
    });
    expect(
      calculateQuoteTotals(10000, { taxType: "FIXED", taxValue: 500 }),
    ).toMatchObject({
      taxCents: 500,
      totalCents: 10500,
    });
    expect(
      calculateQuoteTotals(10000, {
        discountType: "FIXED",
        discountValue: 20000,
      }),
    ).toMatchObject({
      discountCents: 20000,
      totalCents: 0,
    });
    expect(
      calculateQuoteTotals(10000, {
        discountType: "PERCENT",
        discountValue: 1250,
        taxType: "PERCENT",
        taxValue: 825,
      }),
    ).toMatchObject({
      discountCents: 1250,
      taxCents: 722,
      totalCents: 9472,
    });
    expect(
      calculateQuoteTotals(10000, {
        discountType: "FIXED",
        discountValue: 20000,
        taxType: "PERCENT",
        taxValue: 1000,
      }),
    ).toMatchObject({
      discountCents: 20000,
      taxCents: 0,
      totalCents: 0,
    });
    expect(
      calculateQuoteTotals(10000, {
        discountType: "FIXED",
        discountValue: 20000,
        taxType: "FIXED",
        taxValue: 500,
      }),
    ).toMatchObject({
      discountCents: 20000,
      taxCents: 500,
      totalCents: 0,
    });
  });

  it("rejects invalid quote adjustment values and formats percentages consistently", () => {
    expect(() => calculateQuoteTotals(10000, null as never)).toThrow(
      "Quote adjustments must be an object.",
    );
    expect(() => calculateQuoteTotals(10000, [] as never)).toThrow(
      "Quote adjustments must be an object.",
    );
    expect(() =>
      calculateQuoteTotals(10000, {
        discountType: "PERCENT",
        discountValue: 10001,
      }),
    ).toThrow("Discount percent cannot be greater than 100%.");
    expect(() =>
      calculateQuoteTotals(10000, { taxType: "PERCENT", taxValue: 10001 }),
    ).toThrow("Tax percent cannot be greater than 100%.");
    expect(() =>
      calculateQuoteTotals(10000, {
        discountType: "BOGUS" as unknown as "PERCENT",
        discountValue: 1000,
      }),
    ).toThrow("Discount type must be NONE, PERCENT, or FIXED.");
    expect(() =>
      calculateQuoteTotals(10000, {
        taxType: "BOGUS" as unknown as "PERCENT",
        taxValue: 1000,
      }),
    ).toThrow("Tax type must be NONE, PERCENT, or FIXED.");
    expect(() =>
      calculateQuoteTotals(10000, {
        discountType: "FIXED",
        discountValue: "100" as never,
      }),
    ).toThrow("Discount value must be a non-negative whole number.");
    expect(() =>
      calculateQuoteTotals(10000, { discountType: "FIXED", discountValue: -1 }),
    ).toThrow("Discount value must be a non-negative whole number.");
    expect(() =>
      calculateQuoteTotals(10000, { taxType: "FIXED", taxValue: 1.5 }),
    ).toThrow("Tax value must be a non-negative whole number.");
    expect(() => calculateQuoteTotals(quoteIntColumnMax + 1, {})).toThrow(
      "Quote subtotal is too large.",
    );
    expect(() =>
      calculateQuoteTotals(10000, {
        discountType: "FIXED",
        discountValue: quoteIntColumnMax + 1,
      }),
    ).toThrow("Discount value is too large.");
    expect(() =>
      calculateQuoteTotals(10000, {
        taxType: "FIXED",
        taxValue: quoteIntColumnMax + 1,
      }),
    ).toThrow("Tax value is too large.");
    expect(() =>
      calculateQuoteTotals(quoteIntColumnMax, {
        taxType: "PERCENT",
        taxValue: 10000,
      }),
    ).toThrow("Quote total is too large.");
    expect(() =>
      calculateQuoteTotals(quoteIntColumnMax, {
        taxType: "FIXED",
        taxValue: 1,
      }),
    ).toThrow("Quote total is too large.");
    expect(formatQuoteAdjustment("PERCENT", 1250, 1250, "USD")).toBe(
      "12.50% ($12.50)",
    );
    expect(formatQuoteAdjustment("PERCENT", 333, 333, "USD")).toBe(
      "3.33% ($3.33)",
    );
    expect(formatQuoteAdjustment("NONE", 0, 0, "USD")).toBe("$0");
  });

  it("adds workspace-scoped quote and quote item snapshots", () => {
    expect(schema).toContain("model Quote");
    expect(schema).toContain("model QuoteItem");
    expect(schema).toContain("model QuotePublicLink");
    expect(schema).toContain("enum QuoteStatus");
    expect(schema).toMatch(/status\s+QuoteStatus\s+@default\(DRAFT\)/);
    expect(schema).toContain("SENT");
    expect(schema).toContain("ACCEPTED");
    expect(schema).toContain("DECLINED");
    expect(schema).toMatch(/number\s+String/);
    expect(schema).toMatch(/subtotalCents\s+Int/);
    expect(schema).toMatch(
      /discountType\s+QuoteAdjustmentType\s+@default\(NONE\)/,
    );
    expect(schema).toMatch(/discountValue\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/discountCents\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/taxType\s+QuoteAdjustmentType\s+@default\(NONE\)/);
    expect(schema).toMatch(/taxValue\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/taxCents\s+Int\s+@default\(0\)/);
    expect(schema).toMatch(/totalCents\s+Int/);
    expect(schema).toContain("enum QuoteAdjustmentType");
    expect(schema).toMatch(/name\s+String/);
    expect(schema).toMatch(/dealLineItem\s+DealLineItem\?/);
    expect(schema).toContain("@@unique([workspaceId, number])");
    expect(schema).toMatch(/token\s+String\s+@unique/);
    expect(schema).toMatch(/revokedAt\s+DateTime\?/);
  });

  it("creates quote drafts from current deal line item snapshots", () => {
    expect(quoteService).toContain("createQuoteFromDeal");
    expect(quoteService).toContain("getQuote");
    expect(quoteService).toContain("updateQuoteStatus");
    expect(quoteService).toContain("updateQuoteAdjustments");
    expect(quoteService).toContain("createQuotePublicLink");
    expect(quoteService).toContain("revokeQuotePublicLink");
    expect(quoteService).toContain("getPublicQuoteByToken");
    expect(quoteService).toContain("acceptPublicQuoteByToken");
    expect(quoteService).toContain("calculateQuoteTotals");
    expect(quoteService).toContain(
      "normalizeQuoteTransitionStatus(nextStatus)",
    );
    expect(quoteService).toContain(
      "Quote status must be SENT, ACCEPTED, or DECLINED.",
    );
    expect(quoteService).toContain("normalizeQuoteAdjustmentInput(input)");
    expect(quoteService).toContain("Quote adjustments must be an object.");
    expect(quoteService).toContain(
      "normalizeAdjustmentType(adjustmentInput.discountType",
    );
    expect(quoteService).toContain("type must be NONE, PERCENT, or FIXED.");
    expect(quoteService).toContain(
      "taxableCents = Math.max(0, subtotalCents - discountCents)",
    );
    expect(quoteService).toContain(
      "totalCents = Math.max(0, subtotalCents - discountCents + taxCents)",
    );
    expect(quoteService).toContain("quoteIntColumnMax");
    expect(quoteService).toContain(
      'assertQuoteIntColumnValue("Quote subtotal", subtotalCents)',
    );
    expect(quoteService).toContain(
      'assertQuoteIntColumnValue("Quote total", totalCents)',
    );
    expect(quoteService).toContain("syncAcceptedQuoteToDealValue");
    expect(quoteService).toContain("ensureWorkspaceAccess(actor)");
    expect(quoteService).toContain("scopeWorkspaceRelation");
    expect(quoteService).toContain("scopePublicQuote");
    expect(quoteService).toContain("where: { workspaceId: actor.workspaceId }");
    expect(quoteService).toContain(
      "items: quote.items.filter((item) => item.workspaceId === quote.workspaceId)",
    );
    expect(quoteService).toContain(
      "Add at least one deal line item before creating a quote draft.",
    );
    expect(quoteService).toContain(
      "Quote drafts require deal line items to use one currency.",
    );
    expect(quoteService).toContain("subtotalCents");
    expect(quoteService).toContain("totalCents: totals.totalCents");
    expect(quoteService).toContain(
      "Quote adjustments can only be edited while the quote is DRAFT.",
    );
    expect(quoteService).toContain("quoteTotalsEqual(existing, totals)");
    expect(quoteService).toContain("quote.adjustments_updated");
    expect(quoteService).toContain("name: item.productName");
    expect(quoteService).toContain("description: item.description");
    expect(quoteService).toContain("unitPriceCents: item.unitPriceCents");
    expect(quoteService).toContain("currency: item.currency");
    expect(quoteService).toContain("lineTotalCents: item.lineTotalCents");
    expect(quoteService).toContain("quote.created");
    expect(quoteService).toContain("quote.sent");
    expect(quoteService).toContain("quote.accepted");
    expect(quoteService).toContain("quote.declined");
    expect(quoteService).toContain("quote.public_link_created");
    expect(quoteService).toContain("quote.public_link_revoked");
    expect(quoteService).toContain("quote.public_accepted");
    expect(quoteService).toContain("lockQuotePublicLink(tx, quote.id)");
    expect(quoteService).toContain("quote-public-link:");
    expect(quoteService).toContain('publicLink.quote.status === "ACCEPTED"');
    expect(quoteService).toContain('data: { status: "ACCEPTED" }');
    expect(quoteService).toContain(
      "Only sent quotes can be accepted from a public link.",
    );
    expect(quoteService).toContain(
      "Public quote links can only be generated while the quote is SENT.",
    );
    expect(quoteService).toContain('status: { not: "DRAFT" }');
    expect(quoteService).toContain("assertQuoteDealOpen");
    expect(quoteService).toContain("Closed deals cannot be edited.");
    expect(quoteService).toContain(
      "This quote is no longer available for public acceptance.",
    );
    expect(quoteService).toContain('deal: { ...activeWhere, status: "OPEN" }');
    expect(quoteService).toContain("deal.value_synced_from_quote");
    expect(quoteService).toContain('if (quote.status !== "ACCEPTED")');
    expect(quoteService).toContain(
      "Only accepted quotes can be synced to deal value.",
    );
    expect(quoteService).toContain("Cannot move quote from");
    expect(quoteService).toContain("Quote was not found.");
    expect(crmBarrel).toContain("quote-service");
  });

  it("exposes quote creation through the workspace API and deal detail data", () => {
    expect(workspaceRoute).toContain("createQuoteFromDeal");
    expect(workspaceRoute).toContain('nestedResource === "quotes"');
    expect(workspaceRoute).toContain(
      "created(await createQuoteFromDeal(actor, idOrNested))",
    );
    expect(workspaceRoute).toContain(
      'updateQuoteStatus(actor, idOrNested, "SENT")',
    );
    expect(workspaceRoute).toContain(
      'updateQuoteStatus(actor, idOrNested, "ACCEPTED")',
    );
    expect(workspaceRoute).toContain(
      'updateQuoteStatus(actor, idOrNested, "DECLINED")',
    );
    expect(workspaceRoute).toContain(
      "updateQuoteAdjustments(actor, idOrNested, updateQuoteAdjustmentsSchema.parse(await body(request)))",
    );
    expect(workspaceRoute).toContain(
      "createQuotePublicLink(actor, idOrNested)",
    );
    expect(workspaceRoute).toContain(
      "revokeQuotePublicLink(actor, idOrNested)",
    );
    expect(workspaceRoute).toContain(
      "syncAcceptedQuoteToDealValue(actor, idOrNested)",
    );
    expect(dealService).toContain("quotes: {");
    expect(dealService).toContain("items: {");
  });

  it("renders an internal quote drafts panel on deal detail", () => {
    expect(dealPage).toContain("<QuoteDraftsPanel");
    expect(dealPage).toContain(
      'canCreate={deal.status === "OPEN" && deal.lineItems.length > 0}',
    );
    expect(dealPage).toContain(
      'disabledReason={deal.status === "OPEN" ? undefined : closedDealLockMessage("quoteDrafts")}',
    );
    expect(dealPage).toContain('href: "#quotes" as Route');
    expect(dealPage).toContain("quotes: deal.quotes.length");
    expect(dealPage).toContain('countKey: "quotes"');
    expect(dealPage).toContain('countLabel: { singular: "quote", plural: "quotes" }');
    expect(dealPage).toContain("quotes={deal.quotes}");
    expect(dealPage).toContain("activities={deal.activities}");
    expect(dealPage).toContain("dealTitle={deal.title}");
    expect(quotePanel).toContain("Create quote draft");
    expect(quotePanel).toContain("quoteLifecycleStatuses");
    expect(quotePanel).toContain("Create follow-up");
    expect(quotePanel).toContain("Quote follow-up attention summary");
    expect(quotePanel).toContain("quoteFollowUpStatus");
    expect(quotePanel).toContain("No open quote follow-up");
    expect(quotePanel).toContain("Follow-up overdue");
    expect(quotePanel).toContain("Review or reschedule");
    expect(quotePanel).toContain("Similar open follow-up exists");
    expect(quotePanel).toContain("Open quote");
    expect(quotePanel).toContain("returnTo: `/deals/${dealId}#quotes`");
    expect(quotePanel).toContain("internal snapshots of current line items");
    expect(quotePanel).toContain("Status changes are internal tracking only");
    expect(quotePanel).toContain(
      "public links, PDFs, and customer acceptance are managed from quote detail",
    );
    expect(quotePanel).toContain(
      "Add at least one product-backed deal line item to enable draft quote creation.",
    );
    expect(quotePanel).toContain(
      "Create one after the deal has product-backed line items to review a frozen pricing snapshot.",
    );
    expect(quotePanel).toContain(
      "This quote has no line items. Add product-backed line items to the deal, then create a fresh quote draft.",
    );
    expect(quotePanel).toContain("Quote drafts are read-only for this deal.");
    expect(quotePanel).toContain("disabledReason");
    expect(quotePanel).toContain("LockedPanelNotice");
    expect(quotePanel).toContain("!canCreate && disabledReason");
    expect(quotePanel).toContain("EmptyState");
    expect(quotePanel).toContain("quote-drafts-empty");
    expect(quotePanel).toContain('title="No internal quote drafts yet"');
    expect(quotePanel).toContain("description={emptyQuoteDescription}");
    expect(quotePanel).toContain('className="data-card section-spaced"');
    expect(quotePanel).toContain('id="quotes"');
    expect(quotePanel).toContain("PanelTitleRow");
    expect(quotePanel).toContain('title="Quotes"');
    expect(quotePanel).toContain(
      'description="Create, send, accept, or decline internal quote snapshots from this deal.',
    );
    expect(panelTitleRow).toContain("description?: ReactNode");
    expect(compactTitleRow).toContain("export function CompactTitleRow");
    expect(compactTitleRow).toContain('className="compact-title"');
    expect(quotePanel).toContain("CompactTitleRow");
    expect(quotePanel).toContain(
      'const quoteStatusSummaryLabel = "Quote status summary";',
    );
    expect(quotePanel).toContain("import { ActionGroup }");
    expect(quotePanel).toContain('<ActionGroup');
    expect(quotePanel).toContain('className="filter-actions panel-actions-row"');
    expect(quotePanel).toContain("label={quoteStatusSummaryLabel}");
    expect(quotePanel).toContain(
      "description={`${quote.status} · ${formatDate(quote.createdAt)}`}",
    );
    expect(quotePanel).not.toContain(
      '<h3 className="compact-title">{quote.number}</h3>',
    );
    expect(quotePanel).toContain("panel-actions-row");
    expect(quotePanel).not.toContain("panel-intro-copy");
    expect(quotePanel).not.toContain("empty-copy section-spaced");
    expect(quotePanel).toContain("<TableScroll");
    expect(tableScroll).toContain(
      'className={["table-scroll", className].filter(Boolean).join(" ")}',
    );
    expect(tableScroll).toContain('role="region"');
    expect(tableScroll).toContain("tabIndex={0}");
    expect(quotePanel).toContain(
      "aria-label={`${quote.number} quote items table`}",
    );
    expect(quotePanel).toContain('className="table crm-list-table"');
    for (const dataLabel of ["Item", "Qty", "Unit price", "Total"]) {
      expect(quotePanel).toContain(`data-label="${dataLabel}"`);
    }
    expect(quotePanel).toContain('className="table-primary-cell"');
    expect(quotePanel).toContain('className="table-secondary-text"');
    expect(quotePanel).toContain(
      "href={`/deals/${dealId}/quotes/${quote.id}`}",
    );
    expect(quotePanel).toContain(
      "const quoteActionsLabel = `${quote.number} quote actions`",
    );
    expect(quotePanel).toContain('className="filter-actions"');
    expect(quotePanel).toContain("label={quoteActionsLabel}");
    expect(quotePanel).toContain("aria-label={`View quote ${quote.number}`}");
    expect(quotePanel).toContain("title={`View quote ${quote.number}`}");
    expect(quotePanel).toContain(
      "aria-label={`Create follow-up draft for quote ${quote.number}`}",
    );
    expect(quotePanel).toContain(
      "title={`Create follow-up draft for quote ${quote.number}`}",
    );
    expect(quotePanel).toContain("/deals/${dealId}/quotes");
    expect(quotePanel).toContain('import { DownloadAction } from "@/components/download-action"');
    expect(quotePanel).toContain("<DownloadAction");
    expect(quotePanel).toContain("actionLabel={`Download PDF for quote ${quote.number}`}");
    expect(quotePanel).toContain('pendingLabel="Preparing..."');
    expect(quotePanel).toContain(
      "formatMoney(quote.totalCents, quote.currency)",
    );
  });

  it("adds an internal quote detail page for reviewing items and totals", () => {
    expect(quoteDetailPage).toContain("getQuote(actor, dealId, quoteId)");
    expect(quoteDetailPage).toContain("Internal quote");
    expect(quoteDetailPage).toContain("summarizeQuoteReadiness");
    expect(quoteDetailPage).toContain("RecordPanelJumpNav");
    expect(quoteDetailPage).toContain('label="Quote sections"');
    expect(quoteDetailPage).toContain('href: "#quote-overview" as Route');
    expect(quoteDetailPage).toContain('href: "#quote-context" as Route');
    expect(quoteDetailPage).toContain('href: "#quote-totals" as Route');
    expect(quoteDetailPage).toContain('href: "#quote-readiness" as Route');
    expect(quoteDetailPage).toContain('href: "#quote-adjustments" as Route');
    expect(quoteDetailPage).toContain('href: "#quote-status" as Route');
    expect(quoteDetailPage).toContain('href: "#public-link" as Route');
    expect(quoteDetailPage).toContain('href: "#quote-items" as Route');
    expect(quoteDetailPage).toContain("<QuoteReadinessPanel");
    expect(quoteDetailPage).toContain('id="quote-readiness"');
    expect(quoteDetailPage).toContain("<QuoteStatusActions");
    expect(quoteDetailPage).toContain('id="quote-status"');
    expect(quoteDetailPage).toContain("quoteNumber={quote.number}");
    expect(quoteDetailPage).toContain('import { StatusBadge } from "@/components/status-badge"');
    expect(quoteDetailPage).toContain("<StatusBadge status={quote.status} />");
    expect(quoteDetailPage).toContain("Add follow-up");
    expect(quoteDetailPage).toContain("const quoteFollowUpActionLabel = `Add follow-up for quote ${quote.number}`");
    expect(quoteDetailPage).toContain("const quotePrintActionLabel = `Open print view for quote ${quote.number}`");
    expect(quoteDetailPage).toContain("const quotePdfActionLabel = `Download PDF for quote ${quote.number}`");
    expect(quoteDetailPage).toContain("const backToDealActionLabel = `Back to deal ${quote.deal.title}`");
    expect(quoteDetailPage).toContain("aria-label={quoteFollowUpActionLabel}");
    expect(quoteDetailPage).toContain("title={quoteFollowUpActionLabel}");
    expect(quoteDetailPage).toContain("aria-label={quotePrintActionLabel}");
    expect(quoteDetailPage).toContain("title={quotePrintActionLabel}");
    expect(quoteDetailPage).toContain("actionLabel={quotePdfActionLabel}");
    expect(quoteDetailPage).toContain('import { DownloadAction } from "@/components/download-action"');
    expect(quoteDetailPage).toContain("<DownloadAction");
    expect(quoteDetailPage).toContain("filename={`quote-${quote.number}.pdf`}");
    expect(quoteDetailPage).toContain('pendingLabel="Preparing PDF..."');
    expect(quoteDetailPage).toContain("aria-label={backToDealActionLabel}");
    expect(quoteDetailPage).toContain("title={backToDealActionLabel}");
    expect(quoteDetailPage).toContain("buildQuoteFollowUpHref");
    expect(quoteDetailPage).toContain("<QuoteAdjustmentsForm");
    expect(quoteDetailPage).toContain('id="quote-adjustments"');
    expect(quoteDetailPage).toContain("<QuotePublicLinkControls");
    expect(quoteDetailPage).toContain('id="public-link"');
    expect(quoteDetailPage).toContain(
      'canTransition={quote.deal.status === "OPEN"}',
    );
    expect(quoteDetailPage).toContain(
      'canGenerate={quote.status === "SENT" && quote.deal.status === "OPEN"}',
    );
    expect(quoteDetailPage).toContain("buildPublicQuoteUrl(publicLink.token)");
    expect(quoteDetailPage).toContain(
      'quote.status === "DRAFT" && quote.deal.status === "OPEN"',
    );
    expect(quoteDetailPage).toContain('quote.status === "ACCEPTED"');
    expect(quoteDetailPage).toContain("<QuoteDealValueSyncAction");
    expect(quoteDetailPage).toContain("Quote Overview");
    expect(quoteDetailPage).toContain("Quote Workflow");
    expect(quoteDetailPage).toContain("buildQuoteWorkflowSummary");
    expect(quoteDetailPage).toContain("quote-workflow-summary");
    expect(quoteDetailPage).toContain("quote-workflow-grid");
    expect(quoteDetailPage).toContain("Editable draft");
    expect(quoteDetailPage).toContain("Snapshot locked");
    expect(quoteDetailPage).toContain("Review conflict");
    expect(quoteDetailPage).toContain("Manage public link");
    expect(quoteDetailPage).toContain("Customer and Deal Context");
    expect(quoteDetailPage).toContain("Totals and Adjustments");
    expect(quoteDetailPage).toContain("<QuoteLineItemsPanel");
    expect(quoteDetailPage).toContain("quoteCurrency={quote.currency}");
    expect(quoteDetailPage).toContain('className="data-card quote-overview-summary" id="quote-overview"');
    expect(quoteDetailPage).toContain('className="detail-grid quote-detail-overview" id="quote-context"');
    expect(quoteDetailPage).toContain('className="detail-grid quote-detail-overview" id="quote-totals"');
    expect(quoteDetailPage).toContain("quote-summary-grid");
    expect(quoteDetailPage).toContain("Line items");
    expect(quoteDetailPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(quoteDetailPage).toContain('formatPersonName(quote.deal.person) ?? "Unnamed contact"');
    expect(quoteDetailPage).not.toContain("function formatPersonName");
    expect(personName).toContain("export function formatPersonName");
    expect(quoteDetailPage).toContain('emptyLabel: "No contact"');
    expect(quoteDetailPage).toContain('emptyLabel: "No organization"');
    expect(quoteDetailPage).toContain("PanelTitleRow");
    expect(quoteLineItemsPanel).toContain('title="Quote Items"');
    expect(quoteLineItemsPanel).toContain(
      "Draft quote item edits change this quote snapshot only",
    );
    expect(quoteLineItemsPanel).toContain(
      "This draft quote has no line items. Add a product-backed quote item",
    );
    expect(quoteLineItemsPanel).not.toContain(
      '<h2 className="panel-title">Quote Items</h2>',
    );
    expect(quoteLineItemsPanel).toContain('className="data-card section-spaced quote-items-panel" id="quote-items"');
    expect(quoteLineItemsPanel).not.toContain("panel-intro-copy");
    expect(quoteLineItemsPanel).toContain("<TableScroll");
    expect(quoteLineItemsPanel).toContain(
      "aria-label={`${quoteNumber} quote detail items table`}",
    );
    expect(quoteLineItemsPanel).toContain('className="table crm-list-table"');
    for (const dataLabel of ["Item", "Qty", "Unit price", "Total", "Action"]) {
      expect(quoteLineItemsPanel).toContain(`data-label="${dataLabel}"`);
    }
    expect(quoteLineItemsPanel).toContain('className="table-primary-cell"');
    expect(quoteLineItemsPanel).toContain('className="table-secondary-text"');
    expect(quoteDetailPage).toContain(
      "href={`/deals/${quote.dealId}/quotes/${quote.id}/print`}",
    );
    expect(quoteDetailPage).toContain(
      "href={`/deals/${quote.dealId}/quotes/${quote.id}/pdf`}",
    );
    expect(downloadAction).toContain("if (disabled || isPreparing) return");
    expect(downloadAction).toContain("downloadFailureMessage(response.status)");
    expect(downloadAction).toContain("Download started");
    expect(downloadAction).toContain('role="alert"');
    expect(quoteDetailPage).toContain(
      "formatMoney(quote.subtotalCents, quote.currency)",
    );
    expect(quoteDetailPage).toContain("Quote-level discount");
    expect(quoteDetailPage).toContain("Quote-level tax");
    expect(quoteDetailPage).toContain("quote.discountCents");
    expect(quoteDetailPage).toContain("quote.taxCents");
    expect(quoteDetailPage).toContain(
      "formatMoney(quote.totalCents, quote.currency)",
    );
    expect(quoteLineItemsPanel).toContain(
      "formatMoney(item.unitPriceCents, item.currency)",
    );
    expect(quoteLineItemsPanel).toContain(
      "formatMoney(item.lineTotalCents, item.currency)",
    );
    expect(globalStyles).toContain(".quote-overview-summary");
    expect(globalStyles).toContain(".quote-workflow-grid");
    expect(globalStyles).toContain(".quote-workflow-item-warning");
    expect(globalStyles).toContain(".quote-summary-grid");
    expect(globalStyles).toContain(".quote-items-panel .table-primary-cell");
    expect(commercialPanel).toContain("Quote readiness");
    expect(commercialPanel).toContain("id?: string");
    expect(commercialPanel).toContain('id={id}');
    expect(commercialPanel).toContain("Blockers");
    expect(commercialPanel).toContain("Guidance");
    expect(quotePublicLinkControls).toContain("Generate public link");
    expect(quotePublicLinkControls).toContain(
      'className="data-card section-spaced"',
    );
    expect(quotePublicLinkControls).toContain("PanelTitleRow");
    expect(quotePublicLinkControls).toContain('import { Badge } from "@/components/badge"');
    expect(quotePublicLinkControls).toContain('const publicLinkStatus = publicUrl ? "Active" : "Not shared"');
    expect(quotePublicLinkControls).toContain(
      "actions={<Badge label={`Public quote link status: ${publicLinkStatus}`}>{publicLinkStatus}</Badge>}",
    );
    expect(quotePublicLinkControls).toContain('title="Public Quote Link"');
    expect(quotePublicLinkControls).toContain(
      'description="Public links are customer-facing quote views',
    );
    expect(quotePublicLinkControls).not.toContain("panel-intro-copy");
    expect(quotePublicLinkControls).toContain("FormSuccessMessage");
    expect(quotePublicLinkControls).toContain(
      'className="quote-public-link-notice"',
    );
    expect(quotePublicLinkControls).toContain("Public quote link copied.");
    expect(quotePublicLinkControls).toContain("Could not copy the public quote link.");
    expect(quotePublicLinkControls).toContain("disabled={isCopying || isSaving}");
    expect(quotePublicLinkControls).toContain("preservePublicLinkAnchor()");
    expect(quotePublicLinkControls).not.toContain(
      '{notice ? <p className="empty-copy">{notice}</p> : null}',
    );
    expect(quotePublicLinkControls).toContain("panel-field-spaced");
    expect(quotePublicLinkControls).toContain('quoteNumber = "quote"');
    expect(quotePublicLinkControls).toContain(
      "const publicLinkActionsLabel = `${quoteNumber} public quote link actions`",
    );
    expect(quotePublicLinkControls).toContain(
      "import { ActionGroup }",
    );
    expect(quotePublicLinkControls).toContain(
      '<ActionGroup className="filter-actions" label={publicLinkActionsLabel}>',
    );
    expect(quotePublicLinkControls).toContain(
      "aria-label={`Copy public quote link for ${quoteNumber}`}",
    );
    expect(quotePublicLinkControls).toContain(
      "title={`Copy public quote link for ${quoteNumber}`}",
    );
    expect(quotePublicLinkControls).toContain(
      "aria-label={`Revoke public quote link for ${quoteNumber}`}",
    );
    expect(quotePublicLinkControls).toContain(
      "title={`Revoke public quote link for ${quoteNumber}`}",
    );
    expect(quotePublicLinkControls).toContain(
      "aria-label={`Generate public quote link for ${quoteNumber}`}",
    );
    expect(quotePublicLinkControls).toContain(
      "title={`Generate public quote link for ${quoteNumber}`}",
    );
    expect(quotePublicLinkControls).toContain("Copy link");
    expect(quotePublicLinkControls).toContain("Revoke link");
    expect(quotePublicLinkControls).toContain("canGenerate");
    expect(quotePublicLinkControls).toContain("EmptyState");
    expect(quotePublicLinkControls).toContain('title="Quote not sent yet"');
    expect(quotePublicLinkControls).toContain("quote-public-link-empty");
    expect(quotePublicLinkControls).toContain(
      "Mark this quote sent before generating a public link.",
    );
    expect(quotePublicLinkControls).not.toContain(
      '<p className="empty-copy">Mark this quote sent before generating a public link.</p>',
    );
    expect(quotePublicLinkControls).toContain("/quotes/${quoteId}/public-link");
  });

  it("renders a public quote page with sent-quote acceptance and without the app shell", () => {
    expect(publicQuotePage).toContain("getPublicQuoteByToken(token)");
    expect(publicQuotePage).toContain("acceptPublicQuoteAction");
    expect(publicQuotePage).toContain("Customer-facing quote view");
    expect(publicQuotePage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(publicQuotePage).toContain('formatPersonName(quote.deal.person) ?? "Unnamed contact"');
    expect(publicQuotePage).not.toContain("function formatPersonName");
    expect(publicQuotePage).toContain(
      "Acceptance is available only while the quote is sent",
    );
    expect(quotePrintNotice).toContain("export function QuotePrintNotice");
    expect(quotePrintNotice).toContain("FormIntroCallout");
    expect(quotePrintNotice).toContain('className="quote-print-notice"');
    expect(publicQuotePage).toContain("QuotePrintNotice");
    expect(publicQuotePage).toContain('title="Quote scope"');
    expect(publicQuotePage).not.toContain(
      'className="form-callout quote-print-notice"',
    );
    expect(publicQuotePage).not.toContain("<strong>Quote scope</strong>");
    expect(publicQuotePage).not.toContain(
      '<p className="empty-copy">Review this quote snapshot.',
    );
    expect(publicQuotePage).toContain('quote.status === "SENT"');
    expect(publicQuotePage).toContain('quote.deal.status === "OPEN"');
    expect(publicQuotePage).toContain(
      'const showAcceptedConfirmation = quote.status === "ACCEPTED"',
    );
    expect(publicQuotePage).toContain(
      'const acceptedRedirectConfirmed = query?.accepted === "1" && showAcceptedConfirmation',
    );
    expect(publicQuotePage).toContain("FormSuccessMessage");
    expect(publicQuotePage).toContain("Quote acceptance recorded.");
    expect(publicQuotePage).toContain("EmptyState");
    expect(publicQuotePage).toContain('title="Quote accepted"');
    expect(publicQuotePage).toContain('title="Acceptance unavailable"');
    expect(publicQuotePage).toContain("quote-response-state");
    expect(publicQuotePage).toContain("The Northstar team will follow up");
    expect(publicQuotePage).toContain("Accept Quote");
    expect(publicQuotePage).toContain("signatures, payment, email");
    expect(publicQuotePage).toContain(
      "delivery, and internal deal-value updates are not collected on this page.",
    );
    expect(publicQuotePage).toContain(
      "It does not collect payment, signature, email delivery, or automatically update internal deal value.",
    );
    expect(publicQuotePage).toContain(
      "no payment, signature, email delivery, or automatic internal deal-value update was collected.",
    );
    expect(publicQuotePage).not.toContain(
      '<p className="empty-copy">Quote accepted.',
    );
    expect(publicQuotePage).not.toContain(
      '<p className="empty-copy">\n              This quote is not currently available for public acceptance.',
    );
    expect(publicQuotePage).toContain(
      "This quote cannot be accepted from the public link in its current status.",
    );
    expect(publicQuotePage).toContain("robots");
    expect(publicQuotePage).toContain("index: false");
    expect(publicQuotePage).toContain("follow: false");
    expect(publicQuotePage).toContain("nocache: true");
    expect(publicQuotePage).toContain(
      "formatQuoteAdjustment(quote.discountType",
    );
    expect(publicQuotePage).toContain(
      "formatMoney(quote.totalCents, quote.currency)",
    );
    expect(publicQuotePage).toContain("import { FormErrorMessage }");
    expect(publicQuotePage).toContain("import { FormSuccessMessage }");
    expect(publicQuotePage).toContain("PanelTitleRow");
    expect(publicQuotePage).toContain('import { StatusBadge } from "@/components/status-badge"');
    expect(publicQuotePage).toContain("actions={<StatusBadge status={quote.status} />}");
    expect(publicQuotePage).toContain("description={responseDescription}");
    expect(publicQuotePage).toContain("const responseDescription = canAccept");
    expect(publicQuotePage).toContain('title="Quote Response"');
    expect(publicQuotePage).not.toContain(
      '<h2 className="panel-title">Quote Response</h2>',
    );
    expect(publicQuotePage).toContain("<TableScroll");
    expect(publicQuotePage).toContain(
      "aria-label={`${quote.number} public quote items table`}",
    );
    expect(globalStyles).toContain(".table.quote-print-table");
    expect(globalStyles).toContain(".quote-print-table td::before");
    expect(globalStyles).toContain('content: attr(data-label)');
    expect(globalStyles).toContain(".quote-print-header > *");
    expect(globalStyles).toContain(".quote-print-totals div");
    expect(publicQuotePage).toContain("quote.items.map((item, index)");
    expect(publicQuotePage).toContain(
      "key={`${item.name}-${item.quantity}-${item.lineTotalCents}-${index}`}",
    );
    for (const dataLabel of ["Item", "Qty", "Unit price", "Total"]) {
      expect(publicQuotePage).toContain(`data-label="${dataLabel}"`);
    }
    expect(publicQuotePage).toContain('className="table-primary-cell"');
    expect(publicQuotePage).toContain('className="table-secondary-text"');
    expect(publicQuotePage).toContain('className="data-card section-spaced"');
    expect(publicQuotePage).not.toContain("panel-intro-copy");
    expect(publicQuotePage).toContain(
      '<FormErrorMessage className="panel-actions-row">',
    );
    expect(publicQuotePage).not.toContain("form-error panel-actions-row");
    expect(publicQuotePage).not.toContain("style={{ marginTop: 12 }}");
    expect(publicQuotePage).not.toContain("AppShell");
    expect(publicQuotePage).not.toContain("Link");
    expect(publicQuotePage).not.toContain("QuoteStatusActions");
    expect(publicQuotePage).not.toContain("QuoteDealValueSyncAction");
    expect(publicQuotePage).not.toContain("Audit");
    expect(publicQuotePage).not.toContain("workspaceId");
    expect(publicQuotePage).not.toContain("actor");
    expect(publicQuotePage).not.toContain("item.id");
    expect(publicQuoteActions).toContain("acceptPublicQuoteByToken(token)");
    expect(publicQuoteActions).toContain(
      "const redirectToken = encodeURIComponent(token)",
    );
    expect(publicQuoteActions).toContain('error.code === "VALIDATION_ERROR"');
    expect(publicQuoteActions).toContain('error.code === "DEAL_CLOSED"');
    expect(publicQuoteActions).not.toContain("getCurrentWorkspaceContext");
    expect(publicQuoteActions).not.toContain("getRequestContext");
    expect(publicQuoteActions).not.toContain("workspaceId");
    expect(publicQuoteActions).not.toContain("actor");
    expect(publicQuoteActions).toContain("notFound()");
    expect(publicQuoteActions).toContain(
      "redirect(`/q/${redirectToken}?acceptance=unavailable`)",
    );
    expect(publicQuoteActions).toContain(
      "redirect(`/q/${redirectToken}?accepted=1`)",
    );
    expect(quotePublicLinkControls).toContain(
      "Revoking a link immediately makes it return a safe 404.",
    );
    expect(quotePublicLinkControls).toContain(
      "optional acceptance while the quote is sent",
    );
    expect(quotePublicLinkControls).toContain("capture signatures");
  });

  it("renders internal lifecycle actions only for valid next states", () => {
    expect(quoteStatusActions).toContain(
      'DRAFT: [{ label: "Mark sent", action: "mark-sent" }]',
    );
    expect(quoteStatusActions).toContain(
      '{ label: "Mark accepted", action: "accept" }',
    );
    expect(quoteStatusActions).toContain(
      '{ label: "Mark declined", action: "decline" }',
    );
    expect(quoteStatusActions).toContain("ACCEPTED: []");
    expect(quoteStatusActions).toContain("DECLINED: []");
    expect(quoteStatusActions).toContain("/quotes/${quoteId}/${action}");
    expect(quoteStatusActions).toContain(
      'className="data-card section-spaced"',
    );
    expect(quoteStatusActions).toContain("PanelTitleRow");
    expect(quoteStatusActions).toContain('title="Status and Actions"');
    expect(panelTitleRow).toContain("export function PanelTitleRow");
    expect(quoteStatusActions).toContain(
      'description="Use these actions to track internal sales progress.',
    );
    expect(quoteStatusActions).toContain('import { StatusBadge } from "@/components/status-badge"');
    expect(quoteStatusActions).toContain("actions={<StatusBadge status={status} />}");
    expect(quoteStatusActions).toContain('quoteNumber = "quote"');
    expect(quoteStatusActions).toContain(
      "const quoteStatusActionsLabel = `${quoteNumber} quote status actions`",
    );
    expect(quoteStatusActions).toContain(
      "import { ActionGroup }",
    );
    expect(quoteStatusActions).toContain(
      '<ActionGroup className="filter-actions" label={quoteStatusActionsLabel}>',
    );
    expect(quoteStatusActions).toContain(
      "aria-label={`${item.label} for ${quoteNumber}`}",
    );
    expect(quoteStatusActions).toContain(
      "title={`${item.label} for ${quoteNumber}`}",
    );
    expect(quoteStatusActions).not.toContain("panel-intro-copy");
    expect(quoteStatusActions).toContain(
      "Use these actions to track internal sales progress",
    );
    expect(quoteStatusActions).toContain("LockedPanelNotice");
    expect(quoteStatusActions).toContain(
      "Closed deals are locked. Quote status is read-only.",
    );
    expect(lockedPanelNotice).toContain(
      'className="locked-panel-notice"',
    );
    expect(lockedPanelNotice).toContain("titleAttribute={title}");
    expect(quoteStatusActions).toContain("EmptyState");
    expect(quoteStatusActions).toContain('title="No status actions available"');
    expect(quoteStatusActions).toContain("quote-status-terminal");
    expect(quoteStatusActions).toContain(
      "Accepted and declined quotes are terminal in this MVP.",
    );
    expect(quoteStatusActions).not.toContain(
      '<p className="empty-copy">Accepted and declined quotes are terminal in this MVP.</p>',
    );
  });

  it("renders accepted-quote deal value sync and conflict controls", () => {
    expect(quoteValueSyncAction).toContain(
      "/quotes/${quoteId}/sync-review",
    );
    expect(quoteValueSyncAction).toContain(
      'className="data-card section-spaced"',
    );
    expect(quoteValueSyncAction).toContain("PanelTitleRow");
    expect(quoteValueSyncAction).toContain('import { Badge } from "@/components/badge"');
    expect(quoteValueSyncAction).toContain("Deal value is synced from the accepted quote");
    expect(quoteValueSyncAction).toContain("Deal value changed after this quote was sent");
    expect(quoteValueSyncAction).toContain('title="Deal Value Sync"');
    expect(quoteValueSyncAction).toContain("const requiresReview = Boolean(dealValueSyncConflict) && !persistedSynced && !reviewed");
    expect(quoteValueSyncAction).toContain("This accepted quote sync state has already been reviewed.");
    expect(quoteValueSyncAction).toContain("Update deal value to the accepted quote total");
    expect(quoteValueSyncAction).toContain("aria-label={updateActionLabel}");
    expect(quoteValueSyncAction).toContain("title={updateActionLabel}");
    expect(quoteValueSyncAction).toContain(
      "Accepted quote totals sync to the deal automatically",
    );
    expect(quoteValueSyncAction).not.toContain("panel-intro-copy");
    expect(quoteValueSyncAction).toContain("panel-metric-strip");
    expect(quoteValueSyncAction).toContain("Current deal value");
    expect(quoteValueSyncAction).toContain("Accepted quote total");
    expect(quoteValueSyncAction).toContain("Sync state");
    expect(quoteValueSyncAction).toContain("alreadySynced");
    expect(quoteValueSyncAction).toContain("Deal value updated from the accepted quote.");
    expect(quoteValueSyncAction).toContain("Conflict reviewed. Current deal value was kept.");
    expect(quoteValueSyncAction).toContain("preserveDealValueSyncAnchor()");
    expect(quoteAdjustmentsForm).toContain("PanelTitleRow");
    expect(quoteAdjustmentsForm).toContain('import { Badge } from "@/components/badge"');
    expect(quoteAdjustmentsForm).toContain('title="Quote Adjustments"');
    expect(quoteAdjustmentsForm).toContain(
      'actions={<Badge label="Quote adjustments are available for draft quotes only">Draft only</Badge>}',
    );
    expect(quoteAdjustmentsForm).toContain(
      'description="Apply one quote-level discount and one quote-level tax',
    );
    expect(quoteAdjustmentsForm).not.toContain("panel-intro-copy");
    expect(quoteAdjustmentsForm).toContain("FormActionBar");
    expect(quoteAdjustmentsForm).toContain("FormSuccessMessage");
    expect(quoteAdjustmentsForm).toContain("Quote adjustments saved. Draft totals refreshed.");
    expect(quoteAdjustmentsForm).toContain("preserveQuoteAdjustmentsAnchor()");
    expect(quoteAdjustmentsForm).toContain("import { FormFieldLabel }");
    expect(quoteAdjustmentsForm).toContain(
      "<FormFieldLabel>{label} type</FormFieldLabel>",
    );
    expect(quoteAdjustmentsForm).toContain(
      "<FormFieldLabel>{label} value</FormFieldLabel>",
    );
    expect(quoteAdjustmentsForm).toContain('submitLabel="Save adjustments"');
  });

  it("adds an authenticated printable quote view", () => {
    expect(quotePrintPage).toContain("getCurrentWorkspaceContext");
    expect(quotePrintPage).toContain("getQuote(actor, dealId, quoteId)");
    expect(quotePrintPage).toContain("Internal quote");
    expect(quotePrintPage).toContain("Authenticated internal print view.");
    expect(quotePrintPage).toContain(
      "link, stored PDF, signature, or payment document.",
    );
    expect(quotePrintPage).toContain("QuotePrintNotice");
    expect(quotePrintPage).toContain('title="Internal view"');
    expect(quotePrintPage).not.toContain(
      'className="form-callout quote-print-notice"',
    );
    expect(quotePrintPage).not.toContain("<strong>Internal view</strong>");
    expect(quotePrintPage).not.toContain(
      '<p className="empty-copy">Authenticated internal print view.',
    );
    expect(quotePrintPage).toContain(
      'const printActionsLabel = "Quote print actions";',
    );
    expect(quotePrintPage).toContain("import { ActionGroup }");
    expect(quotePrintPage).toContain('<ActionGroup');
    expect(quotePrintPage).toContain('className="quote-print-actions no-print"');
    expect(quotePrintPage).toContain("label={printActionsLabel}");
    expect(quotePrintPage).toContain(
      "href={`/deals/${dealId}/quotes/${quoteId}/pdf`}",
    );
    expect(quotePrintPage).toContain("const backToQuoteActionLabel = `Back to quote ${quote.number}`");
    expect(quotePrintPage).toContain("const quotePdfActionLabel = `Download PDF for quote ${quote.number}`");
    expect(quotePrintPage).toContain("const printQuoteActionLabel = `Print quote ${quote.number}`");
    expect(quotePrintPage).toContain("aria-label={backToQuoteActionLabel}");
    expect(quotePrintPage).toContain("title={backToQuoteActionLabel}");
    expect(quotePrintPage).toContain("actionLabel={quotePdfActionLabel}");
    expect(quotePrintPage).toContain('import { DownloadAction } from "@/components/download-action"');
    expect(quotePrintPage).toContain("<DownloadAction");
    expect(quotePrintPage).toContain("filename={`quote-${quote.number}.pdf`}");
    expect(quotePrintPage).toContain('pendingLabel="Preparing PDF..."');
    expect(quotePrintPage).toContain("<PrintButton actionLabel={printQuoteActionLabel} label=\"Print quote\" />");
    expect(quotePrintPage).toContain("workspace.name");
    expect(quotePrintPage).toContain("quote.deal.organization?.name");
    expect(quotePrintPage).toContain("quote.deal.person");
    expect(quotePrintPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(quotePrintPage).toContain('formatPersonName(quote.deal.person) ?? "Unnamed contact"');
    expect(quotePrintPage).not.toContain("function formatPersonName");
    expect(quotePrintPage).toContain(
      "formatMoney(quote.subtotalCents, quote.currency)",
    );
    expect(quotePrintPage).toContain("Quote-level discount");
    expect(quotePrintPage).toContain("Quote-level tax");
    expect(quotePrintPage).toContain("quote.discountCents");
    expect(quotePrintPage).toContain("quote.taxCents");
    expect(quotePrintPage).toContain(
      "formatMoney(quote.totalCents, quote.currency)",
    );
    expect(quotePrintPage).toContain("<TableScroll");
    expect(quotePrintPage).toContain(
      "aria-label={`${quote.number} internal printable quote items table`}",
    );
    for (const dataLabel of ["Item", "Qty", "Unit price", "Total"]) {
      expect(quotePrintPage).toContain(`data-label="${dataLabel}"`);
    }
    expect(quotePrintPage).toContain('className="table-primary-cell"');
    expect(quotePrintPage).toContain('className="table-secondary-text"');
    expect(quotePrintPage).not.toContain("<th>Description</th>");
    expect(quotePrintPage).not.toContain('<td>{item.description ?? ""}</td>');
    expect(quotePrintPage).toContain(
      "formatMoney(item.unitPriceCents, item.currency)",
    );
    expect(quotePrintPage).toContain(
      "formatMoney(item.lineTotalCents, item.currency)",
    );
    expect(printButton).toContain("window.print()");
    expect(printButton).toContain("actionLabel?: string");
    expect(printButton).toContain("const resolvedActionLabel = actionLabel ?? label");
    expect(printButton).toContain("aria-label={resolvedActionLabel}");
    expect(printButton).toContain("title={resolvedActionLabel}");
    expect(formatHelpers).toContain(
      "const hasCents = Math.abs(valueCents) % 100 !== 0",
    );
    expect(formatHelpers).toContain("minimumFractionDigits: hasCents ? 2 : 0");
    expect(globalStyles).toContain("@media print");
    expect(globalStyles).toContain(".quote-print-sheet");
    expect(globalStyles).toContain(".quote-print-notice");
    expect(globalStyles).toContain(".no-print");
    expect(globalStyles).toContain(".quote-print-table thead");
    expect(globalStyles).toContain(".quote-print-table td:first-child");
    expect(globalStyles).toContain("display: table-row-group");
  });

  it("adds an authenticated on-demand quote PDF export without storage", () => {
    expect(quotePdfRoute).toContain("getRequestContext");
    expect(quotePdfRoute).toContain("resolveCurrentWorkspaceSelectionContext");
    expect(quotePdfRoute).toContain("getQuote(actor, dealId, quoteId)");
    expect(quotePdfRoute).toContain(
      "generateQuotePdf({ workspaceName: workspace.name, quote })",
    );
    expect(quotePdfRoute).toContain('"content-type": "application/pdf"');
    expect(quotePdfRoute).toContain(
      '"cache-control": "private, no-store, max-age=0"',
    );
    expect(quotePdfRoute).toContain('"x-content-type-options": "nosniff"');
    expect(quotePdfRoute).toContain("attachment; filename=");
    expect(quotePdf).toContain("export function generateQuotePdf");
    expect(quotePdf).toContain("export function quotePdfFilename");
    expect(quotePdf).toContain(
      "Authenticated internal PDF. Generated on demand, not stored, and not a public quote link.",
    );
    expect(quotePdf).toContain("Organization: ${organization}");
    expect(quotePdf).toContain("Contact: ${contact}");
    expect(quotePdf).toContain("Quote-level discount");
    expect(quotePdf).toContain("Quote-level tax");
    expect(quotePdf).toContain(
      "formatQuoteAdjustment(quote.discountType, quote.discountValue, quote.discountCents, quote.currency)",
    );
    expect(quotePdf).toContain(
      "formatQuoteAdjustment(quote.taxType, quote.taxValue, quote.taxCents, quote.currency)",
    );
    expect(quotePdf).toContain(
      "formatMoney(item.unitPriceCents, item.currency)",
    );
    expect(quotePdf).toContain("formatMoney(quote.totalCents, quote.currency)");
    expect(quotePdf).toContain("%PDF-1.4");
  });

  it("documents quote draft scope and limitations", () => {
    expect(currentStatus).toContain("Quote statuses");
    expect(currentStatus).toContain("SENT");
    expect(architecture).toContain("Quote drafts snapshot deal line items");
    expect(routeMap).toContain("GET /deals/:dealId/quotes/:quoteId");
    expect(routeMap).toContain("GET /deals/:dealId/quotes/:quoteId/print");
    expect(routeMap).toContain("GET /deals/:dealId/quotes/:quoteId/pdf");
    expect(routeMap).toContain("GET /q/:token");
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/deals/:dealId/quotes",
    );
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/mark-sent",
    );
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/accept",
    );
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/decline",
    );
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/adjustments",
    );
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/public-link",
    );
    expect(routeMap).toContain(
      "/api/v1/workspaces/:workspaceId/quotes/:quoteId/sync-deal-value",
    );
  });
});
