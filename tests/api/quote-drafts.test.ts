import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatMoney, formatQuoteAdjustment } from "@/components/format";
import { generateQuotePdf, quotePdfFilename } from "@/lib/pdf/quote-pdf";
import { buildPublicQuoteUrl } from "@/lib/public-url";
import { calculateQuoteTotals, generatePublicQuoteToken } from "@/lib/services/quote-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const quoteService = readFileSync(join(process.cwd(), "lib/services/quote-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const dealService = readFileSync(join(process.cwd(), "lib/services/deal-service.ts"), "utf8");
const workspaceRoute = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const quoteDetailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/page.tsx"), "utf8");
const quotePrintPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/print/page.tsx"), "utf8");
const publicQuotePage = readFileSync(join(process.cwd(), "app/q/[token]/page.tsx"), "utf8");
const publicQuoteActions = readFileSync(join(process.cwd(), "app/q/[token]/actions.ts"), "utf8");
const quotePdfRoute = readFileSync(join(process.cwd(), "app/deals/[dealId]/quotes/[quoteId]/pdf/route.ts"), "utf8");
const quotePdf = readFileSync(join(process.cwd(), "lib/pdf/quote-pdf.ts"), "utf8");
const quotePanel = readFileSync(join(process.cwd(), "components/quote-drafts-panel.tsx"), "utf8");
const quotePublicLinkControls = readFileSync(join(process.cwd(), "components/quote-public-link-controls.tsx"), "utf8");
const quoteValueSyncAction = readFileSync(join(process.cwd(), "components/quote-deal-value-sync-action.tsx"), "utf8");
const quoteStatusActions = readFileSync(join(process.cwd(), "components/quote-status-actions.tsx"), "utf8");
const printButton = readFileSync(join(process.cwd(), "components/print-button.tsx"), "utf8");
const formatHelpers = readFileSync(join(process.cwd(), "components/format.ts"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");

describe("quote draft MVP", () => {
  it("formats quote and product money without rounding away cents", () => {
    expect(formatMoney(125000, "USD")).toBe("$1,250");
    expect(formatMoney(125050, "USD")).toBe("$1,250.50");
  });

  it("generates safe public quote tokens and URLs", () => {
    const token = generatePublicQuoteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(buildPublicQuoteUrl("abc123", "https://crm.example.test")).toBe("https://crm.example.test/q/abc123");
    expect(buildPublicQuoteUrl("abc123")).toBe("/q/abc123");
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
          person: { firstName: "Ada", lastName: "Lovelace" }
        },
        items: [
          {
            name: "Very Long Implementation Package Name",
            description: null,
            quantity: 1,
            unitPriceCents: 125050,
            currency: "USD",
            lineTotalCents: 125050
          }
        ]
      }
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
      totalCents: 10000
    });
    expect(calculateQuoteTotals(10000, { discountType: "PERCENT", discountValue: 1000 })).toMatchObject({
      discountCents: 1000,
      totalCents: 9000
    });
    expect(calculateQuoteTotals(10000, { discountType: "FIXED", discountValue: 2500 })).toMatchObject({
      discountCents: 2500,
      totalCents: 7500
    });
    expect(calculateQuoteTotals(10000, { taxType: "PERCENT", taxValue: 825 })).toMatchObject({
      taxCents: 825,
      totalCents: 10825
    });
    expect(calculateQuoteTotals(10000, { taxType: "FIXED", taxValue: 500 })).toMatchObject({
      taxCents: 500,
      totalCents: 10500
    });
    expect(calculateQuoteTotals(10000, { discountType: "FIXED", discountValue: 20000 })).toMatchObject({
      discountCents: 20000,
      totalCents: 0
    });
    expect(calculateQuoteTotals(10000, { discountType: "PERCENT", discountValue: 1250, taxType: "PERCENT", taxValue: 825 })).toMatchObject({
      discountCents: 1250,
      taxCents: 722,
      totalCents: 9472
    });
    expect(calculateQuoteTotals(10000, { discountType: "FIXED", discountValue: 20000, taxType: "PERCENT", taxValue: 1000 })).toMatchObject({
      discountCents: 20000,
      taxCents: 0,
      totalCents: 0
    });
    expect(calculateQuoteTotals(10000, { discountType: "FIXED", discountValue: 20000, taxType: "FIXED", taxValue: 500 })).toMatchObject({
      discountCents: 20000,
      taxCents: 500,
      totalCents: 0
    });
  });

  it("rejects invalid quote adjustment values and formats percentages consistently", () => {
    expect(() => calculateQuoteTotals(10000, { discountType: "PERCENT", discountValue: 10001 })).toThrow("Discount percent cannot be greater than 100%.");
    expect(() => calculateQuoteTotals(10000, { taxType: "PERCENT", taxValue: 10001 })).toThrow("Tax percent cannot be greater than 100%.");
    expect(() => calculateQuoteTotals(10000, { discountType: "FIXED", discountValue: -1 })).toThrow("Discount value must be a non-negative whole number.");
    expect(() => calculateQuoteTotals(10000, { taxType: "FIXED", taxValue: 1.5 })).toThrow("Tax value must be a non-negative whole number.");
    expect(formatQuoteAdjustment("PERCENT", 1250, 1250, "USD")).toBe("12.50% ($12.50)");
    expect(formatQuoteAdjustment("PERCENT", 333, 333, "USD")).toBe("3.33% ($3.33)");
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
    expect(schema).toMatch(/discountType\s+QuoteAdjustmentType\s+@default\(NONE\)/);
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
    expect(quoteService).toContain("taxableCents = Math.max(0, subtotalCents - discountCents)");
    expect(quoteService).toContain("totalCents = Math.max(0, subtotalCents - discountCents + taxCents)");
    expect(quoteService).toContain("syncAcceptedQuoteToDealValue");
    expect(quoteService).toContain("ensureWorkspaceAccess(actor)");
    expect(quoteService).toContain("Add at least one deal line item before creating a quote draft.");
    expect(quoteService).toContain("Quote drafts require deal line items to use one currency.");
    expect(quoteService).toContain("subtotalCents");
    expect(quoteService).toContain("totalCents: totals.totalCents");
    expect(quoteService).toContain("Quote adjustments can only be edited while the quote is DRAFT.");
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
    expect(quoteService).toContain("publicLink.quote.status === \"ACCEPTED\"");
    expect(quoteService).toContain("data: { status: \"ACCEPTED\" }");
    expect(quoteService).toContain("Only sent quotes can be accepted from a public link.");
    expect(quoteService).toContain("deal.value_synced_from_quote");
    expect(quoteService).toContain("if (quote.status !== \"ACCEPTED\")");
    expect(quoteService).toContain("Only accepted quotes can be synced to deal value.");
    expect(quoteService).toContain("Cannot move quote from");
    expect(quoteService).toContain("Quote was not found.");
    expect(crmBarrel).toContain("quote-service");
  });

  it("exposes quote creation through the workspace API and deal detail data", () => {
    expect(workspaceRoute).toContain("createQuoteFromDeal");
    expect(workspaceRoute).toContain("nestedResource === \"quotes\"");
    expect(workspaceRoute).toContain("created(await createQuoteFromDeal(actor, idOrNested))");
    expect(workspaceRoute).toContain("updateQuoteStatus(actor, idOrNested, \"SENT\")");
    expect(workspaceRoute).toContain("updateQuoteStatus(actor, idOrNested, \"ACCEPTED\")");
    expect(workspaceRoute).toContain("updateQuoteStatus(actor, idOrNested, \"DECLINED\")");
    expect(workspaceRoute).toContain("updateQuoteAdjustments(actor, idOrNested, updateQuoteAdjustmentsSchema.parse(await body(request)))");
    expect(workspaceRoute).toContain("createQuotePublicLink(actor, idOrNested)");
    expect(workspaceRoute).toContain("revokeQuotePublicLink(actor, idOrNested)");
    expect(workspaceRoute).toContain("syncAcceptedQuoteToDealValue(actor, idOrNested)");
    expect(dealService).toContain("quotes: {");
    expect(dealService).toContain("items: {");
  });

  it("renders an internal quote drafts panel on deal detail", () => {
    expect(dealPage).toContain("<QuoteDraftsPanel");
    expect(dealPage).toContain("quotes={deal.quotes}");
    expect(quotePanel).toContain("Create draft quote");
    expect(quotePanel).toContain("internal snapshots of current line items");
    expect(quotePanel).toContain("Status changes are internal tracking only");
    expect(quotePanel).toContain("public links, PDFs, and customer acceptance are managed from quote detail");
    expect(quotePanel).toContain("Add at least one deal line item to enable draft quote creation.");
    expect(quotePanel).toContain("href={`/deals/${dealId}/quotes/${quote.id}`}");
    expect(quotePanel).toContain("/deals/${dealId}/quotes");
    expect(quotePanel).toContain("formatMoney(quote.totalCents, quote.currency)");
  });

  it("adds an internal quote detail page for reviewing items and totals", () => {
    expect(quoteDetailPage).toContain("getQuote(actor, dealId, quoteId)");
    expect(quoteDetailPage).toContain("Internal quote");
    expect(quoteDetailPage).toContain("<QuoteStatusActions");
    expect(quoteDetailPage).toContain("<QuoteAdjustmentsForm");
    expect(quoteDetailPage).toContain("<QuotePublicLinkControls");
    expect(quoteDetailPage).toContain("buildPublicQuoteUrl(publicLink.token)");
    expect(quoteDetailPage).toContain("quote.status === \"DRAFT\"");
    expect(quoteDetailPage).toContain("quote.status === \"ACCEPTED\"");
    expect(quoteDetailPage).toContain("<QuoteDealValueSyncAction");
    expect(quoteDetailPage).toContain("Quote Context");
    expect(quoteDetailPage).toContain("Quote Totals");
    expect(quoteDetailPage).toContain("Quote Items");
    expect(quoteDetailPage).toContain("href={`/deals/${quote.dealId}/quotes/${quote.id}/print`}");
    expect(quoteDetailPage).toContain("href={`/deals/${quote.dealId}/quotes/${quote.id}/pdf`}");
    expect(quoteDetailPage).toContain("formatMoney(quote.subtotalCents, quote.currency)");
    expect(quoteDetailPage).toContain("Quote-level discount");
    expect(quoteDetailPage).toContain("Quote-level tax");
    expect(quoteDetailPage).toContain("quote.discountCents");
    expect(quoteDetailPage).toContain("quote.taxCents");
    expect(quoteDetailPage).toContain("formatMoney(quote.totalCents, quote.currency)");
    expect(quoteDetailPage).toContain("formatMoney(item.unitPriceCents, item.currency)");
    expect(quoteDetailPage).toContain("formatMoney(item.lineTotalCents, item.currency)");
    expect(quoteDetailPage).toContain("These items are snapshots from the deal line items");
    expect(quotePublicLinkControls).toContain("Generate public link");
    expect(quotePublicLinkControls).toContain("Copy link");
    expect(quotePublicLinkControls).toContain("Revoke link");
    expect(quotePublicLinkControls).toContain("/quotes/${quoteId}/public-link");
  });

  it("renders a public quote page with sent-quote acceptance and without the app shell", () => {
    expect(publicQuotePage).toContain("getPublicQuoteByToken(token)");
    expect(publicQuotePage).toContain("acceptPublicQuoteAction");
    expect(publicQuotePage).toContain("Customer-facing quote view");
    expect(publicQuotePage).toContain("Acceptance is available only while the quote is sent");
    expect(publicQuotePage).toContain("quote.status === \"SENT\"");
    expect(publicQuotePage).toContain("Quote accepted. The Northstar team will follow up");
    expect(publicQuotePage).toContain("Accept Quote");
    expect(publicQuotePage).toContain("signatures, payment, email delivery, and internal deal-value updates are not collected on this page.");
    expect(publicQuotePage).toContain("It does not collect payment, signature, email delivery, or automatically update internal deal value.");
    expect(publicQuotePage).toContain("no payment, signature, email delivery, or automatic internal deal-value update was collected.");
    expect(publicQuotePage).toContain("This quote cannot be accepted from the public link in its current status.");
    expect(publicQuotePage).toContain("robots");
    expect(publicQuotePage).toContain("index: false");
    expect(publicQuotePage).toContain("follow: false");
    expect(publicQuotePage).toContain("nocache: true");
    expect(publicQuotePage).toContain("formatQuoteAdjustment(quote.discountType");
    expect(publicQuotePage).toContain("formatMoney(quote.totalCents, quote.currency)");
    expect(publicQuotePage).not.toContain("AppShell");
    expect(publicQuotePage).not.toContain("Link");
    expect(publicQuotePage).not.toContain("QuoteStatusActions");
    expect(publicQuotePage).not.toContain("QuoteDealValueSyncAction");
    expect(publicQuotePage).not.toContain("Audit");
    expect(publicQuotePage).not.toContain("workspaceId");
    expect(publicQuotePage).not.toContain("actor");
    expect(publicQuotePage).not.toContain("item.id");
    expect(publicQuoteActions).toContain("acceptPublicQuoteByToken(token)");
    expect(publicQuoteActions).not.toContain("getCurrentWorkspaceContext");
    expect(publicQuoteActions).not.toContain("getRequestContext");
    expect(publicQuoteActions).not.toContain("workspaceId");
    expect(publicQuoteActions).not.toContain("actor");
    expect(publicQuoteActions).toContain("notFound()");
    expect(publicQuoteActions).toContain("acceptance=unavailable");
    expect(publicQuoteActions).toContain("accepted=1");
    expect(quotePublicLinkControls).toContain("Revoking a link immediately makes it return a safe 404.");
    expect(quotePublicLinkControls).toContain("optional acceptance while the quote is sent");
    expect(quotePublicLinkControls).toContain("capture signatures");
  });

  it("renders internal lifecycle actions only for valid next states", () => {
    expect(quoteStatusActions).toContain("DRAFT: [{ label: \"Mark sent\", action: \"mark-sent\" }]");
    expect(quoteStatusActions).toContain("{ label: \"Mark accepted\", action: \"accept\" }");
    expect(quoteStatusActions).toContain("{ label: \"Mark declined\", action: \"decline\" }");
    expect(quoteStatusActions).toContain("ACCEPTED: []");
    expect(quoteStatusActions).toContain("DECLINED: []");
    expect(quoteStatusActions).toContain("/quotes/${quoteId}/${action}");
    expect(quoteStatusActions).toContain("These actions track internal sales progress only");
    expect(quoteStatusActions).toContain("Accepted and declined quotes are terminal in this MVP.");
  });

  it("renders manual accepted-quote deal value sync controls", () => {
    expect(quoteValueSyncAction).toContain("/quotes/${quoteId}/sync-deal-value");
    expect(quoteValueSyncAction).toContain("Sync quote total to deal value");
    expect(quoteValueSyncAction).toContain("Current deal value");
    expect(quoteValueSyncAction).toContain("Accepted quote total");
    expect(quoteValueSyncAction).toContain("Syncing is manual, including after customer acceptance.");
    expect(quoteValueSyncAction).toContain("Public acceptance does not run this step automatically");
    expect(quoteValueSyncAction).toContain("reports and exports use the accepted total");
    expect(quoteValueSyncAction).toContain("alreadySynced");
    expect(quoteValueSyncAction).toContain("Deal value synced");
  });

  it("adds an authenticated printable quote view", () => {
    expect(quotePrintPage).toContain("getCurrentWorkspaceContext");
    expect(quotePrintPage).toContain("getQuote(actor, dealId, quoteId)");
    expect(quotePrintPage).toContain("Internal quote");
    expect(quotePrintPage).toContain("Authenticated internal print view. This is not a public quote link, stored PDF, signature, or payment document.");
    expect(quotePrintPage).toContain("href={`/deals/${dealId}/quotes/${quoteId}/pdf`}");
    expect(quotePrintPage).toContain("workspace.name");
    expect(quotePrintPage).toContain("quote.deal.organization?.name");
    expect(quotePrintPage).toContain("quote.deal.person ? formatPersonName");
    expect(quotePrintPage).toContain("formatMoney(quote.subtotalCents, quote.currency)");
    expect(quotePrintPage).toContain("Quote-level discount");
    expect(quotePrintPage).toContain("Quote-level tax");
    expect(quotePrintPage).toContain("quote.discountCents");
    expect(quotePrintPage).toContain("quote.taxCents");
    expect(quotePrintPage).toContain("formatMoney(quote.totalCents, quote.currency)");
    expect(quotePrintPage).toContain("formatMoney(item.unitPriceCents, item.currency)");
    expect(quotePrintPage).toContain("formatMoney(item.lineTotalCents, item.currency)");
    expect(printButton).toContain("window.print()");
    expect(formatHelpers).toContain("const hasCents = Math.abs(valueCents) % 100 !== 0");
    expect(formatHelpers).toContain("minimumFractionDigits: hasCents ? 2 : 0");
    expect(globalStyles).toContain("@media print");
    expect(globalStyles).toContain(".quote-print-sheet");
    expect(globalStyles).toContain(".no-print");
  });

  it("adds an authenticated on-demand quote PDF export without storage", () => {
    expect(quotePdfRoute).toContain("getRequestContext");
    expect(quotePdfRoute).toContain("resolveCurrentWorkspaceSelectionContext");
    expect(quotePdfRoute).toContain("getQuote(actor, dealId, quoteId)");
    expect(quotePdfRoute).toContain("generateQuotePdf({ workspaceName: workspace.name, quote })");
    expect(quotePdfRoute).toContain("\"content-type\": \"application/pdf\"");
    expect(quotePdfRoute).toContain("\"cache-control\": \"private, no-store, max-age=0\"");
    expect(quotePdfRoute).toContain("\"x-content-type-options\": \"nosniff\"");
    expect(quotePdfRoute).toContain("attachment; filename=");
    expect(quotePdf).toContain("export function generateQuotePdf");
    expect(quotePdf).toContain("export function quotePdfFilename");
    expect(quotePdf).toContain("Authenticated internal PDF. Generated on demand, not stored, and not a public quote link.");
    expect(quotePdf).toContain("Organization: ${organization}");
    expect(quotePdf).toContain("Contact: ${contact}");
    expect(quotePdf).toContain("Quote-level discount");
    expect(quotePdf).toContain("Quote-level tax");
    expect(quotePdf).toContain("formatQuoteAdjustment(quote.discountType, quote.discountValue, quote.discountCents, quote.currency)");
    expect(quotePdf).toContain("formatQuoteAdjustment(quote.taxType, quote.taxValue, quote.taxCents, quote.currency)");
    expect(quotePdf).toContain("formatMoney(item.unitPriceCents, item.currency)");
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
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/deals/:dealId/quotes");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/quotes/:quoteId/mark-sent");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/quotes/:quoteId/accept");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/quotes/:quoteId/decline");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/quotes/:quoteId/adjustments");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/quotes/:quoteId/public-link");
    expect(routeMap).toContain("/api/v1/workspaces/:workspaceId/quotes/:quoteId/sync-deal-value");
  });
});
