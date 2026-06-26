import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { classifyDealAttention } from "@/lib/deal-attention";
import { parseListViewState } from "@/lib/list-page-query";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type CrmServices = typeof import("@/lib/services/crm");
type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let crm: CrmServices;
let fixture: Fixture | undefined;

beforeAll(async () => {
  crm = await import("@/lib/services/crm");
});

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("database-backed CRM service workflows", () => {
  it("prevents a user from accessing or mutating another workspace's records", async () => {
    const fx = currentFixture();

    await expect(
      crm.listDeals({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      crm.updateDeal(fx.actorA, fx.recordsB.deal.id, { title: "Cross-workspace edit" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates workspace-scoped products and deal line items without changing deal value", async () => {
    const fx = currentFixture();
    const initialReport = await crm.getDealReport(fx.actorA);
    await expect(
      crm.createProduct(fx.actorA, {
        name: "   ",
        unitPriceCents: 1000,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "Invalid Price",
        unitPriceCents: -1,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "Invalid Currency",
        unitPriceCents: 1000,
        currency: "US"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    const product = await crm.createProduct(fx.actorA, {
      name: "Implementation Package",
      description: "Fixed-fee onboarding",
      unitPriceCents: 125000,
      currency: "usd"
    });
    const otherWorkspaceProduct = await crm.createProduct(fx.actorB, {
      name: "Other Workspace Package",
      unitPriceCents: 9900,
      currency: "USD"
    });
    await expect(
      crm.updateProduct(fx.actorA, product.id, {
        name: "   ",
        unitPriceCents: 1000,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.updateProduct(fx.actorA, product.id, {
        name: "Invalid Price",
        unitPriceCents: -1,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.updateProduct(fx.actorA, product.id, {
        name: "Invalid Currency",
        unitPriceCents: 1000,
        currency: "US"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    const productsA = await crm.listProducts(fx.actorA);
    const productsB = await crm.listProducts(fx.actorB);
    await expect(crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const lineItem = await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 3
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const quoteDetail = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    const adjustedQuote = await crm.updateQuoteAdjustments(fx.actorA, quote.id, {
      discountType: "PERCENT",
      discountValue: 1000,
      taxType: "PERCENT",
      taxValue: 500
    });
    const publicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);
    const repeatedPublicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);
    const publicQuote = await crm.getPublicQuoteByToken(publicLink.token);
    const loadedThenExpiredLink = await fx.prisma.quotePublicLink.create({
      data: {
        workspaceId: fx.workspaceA.id,
        quoteId: quote.id,
        token: crm.generatePublicQuoteToken(),
        expiresAt: new Date("2030-01-01T00:00:00.000Z")
      }
    });
    const loadedThenExpiredPublicQuote = await crm.getPublicQuoteByToken(loadedThenExpiredLink.token);
    await fx.prisma.quotePublicLink.update({
      where: { id: loadedThenExpiredLink.id },
      data: { expiresAt: new Date("2000-01-01T00:00:00.000Z") }
    });
    const expiredLink = await fx.prisma.quotePublicLink.create({
      data: {
        workspaceId: fx.workspaceA.id,
        quoteId: quote.id,
        token: crm.generatePublicQuoteToken(),
        expiresAt: new Date("2000-01-01T00:00:00.000Z")
      }
    });
    await expect(crm.createQuotePublicLink(fx.actorB, quote.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.getPublicQuoteByToken("short")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.getPublicQuoteByToken("invalid-token")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.getPublicQuoteByToken(expiredLink.token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.acceptPublicQuoteByToken(publicLink.token)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(crm.acceptPublicQuoteByToken("short")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.acceptPublicQuoteByToken(expiredLink.token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.acceptPublicQuoteByToken(loadedThenExpiredLink.token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const sentQuote = await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await expect(
      crm.updateQuoteAdjustments(fx.actorA, quote.id, {
        discountType: "FIXED",
        discountValue: 1000
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(crm.updateQuoteStatus(fx.actorA, quote.id, "SENT")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const publicAcceptance = await crm.acceptPublicQuoteByToken(publicLink.token);
    const acceptedQuote = publicAcceptance.quote;
    const repeatPublicAcceptance = await crm.acceptPublicQuoteByToken(publicLink.token);
    const internalAcceptedQuote = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    await expect(crm.updateQuoteStatus(fx.actorA, quote.id, "DECLINED")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const updatedProduct = await crm.updateProduct(fx.actorA, product.id, {
      name: " Implementation Package Updated ",
      description: " Updated onboarding ",
      unitPriceCents: 150000,
      currency: "eur"
    });
    const deactivatedProduct = await crm.setProductActive(fx.actorA, product.id, false);
    const inactiveProducts = await crm.listProducts(fx.actorA);
    const dealWithLineItems = await crm.getDeal(fx.actorA, fx.recordsA.deal.id);
    const reportAfterLineItem = await crm.getDealReport(fx.actorA);

    expect(productsA.map((item) => item.id)).toContain(product.id);
    expect(productsA.map((item) => item.id)).not.toContain(otherWorkspaceProduct.id);
    expect(productsB.map((item) => item.id)).toContain(otherWorkspaceProduct.id);
    expect(lineItem.productName).toBe("Implementation Package");
    expect(lineItem.unitPriceCents).toBe(125000);
    expect(lineItem.currency).toBe("USD");
    expect(lineItem.lineTotalCents).toBe(375000);
    expect(quote).toMatchObject({
      dealId: fx.recordsA.deal.id,
      number: "Q-0001",
      status: "DRAFT",
      currency: "USD",
      subtotalCents: 375000,
      totalCents: 375000
    });
    expect(adjustedQuote).toMatchObject({
      discountType: "PERCENT",
      discountValue: 1000,
      discountCents: 37500,
      taxType: "PERCENT",
      taxValue: 500,
      taxCents: 16875,
      totalCents: 354375
    });
    expect(publicLink.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(publicLink.token.length).toBeGreaterThanOrEqual(32);
    expect(repeatedPublicLink.id).toBe(publicLink.id);
    expect(publicQuote).toMatchObject({
      id: quote.id,
      number: "Q-0001",
      totalCents: 354375,
      workspace: { id: fx.workspaceA.id },
      deal: {
        title: "Alpha Needle Deal",
        organization: { name: "Alpha Orbit Organization" },
        person: { firstName: "Alpha", lastName: "Contact" }
      }
    });
    expect(loadedThenExpiredPublicQuote.id).toBe(quote.id);
    expect(quote.items).toHaveLength(1);
    expect(quote.items[0]).toMatchObject({
      dealLineItemId: lineItem.id,
      productId: product.id,
      name: "Implementation Package",
      quantity: 3,
      unitPriceCents: 125000,
      currency: "USD",
      lineTotalCents: 375000
    });
    expect(sentQuote.status).toBe("SENT");
    expect(acceptedQuote.status).toBe("ACCEPTED");
    expect(publicAcceptance).toMatchObject({ accepted: true, alreadyAccepted: false });
    expect(repeatPublicAcceptance).toMatchObject({ accepted: false, alreadyAccepted: true });
    expect(internalAcceptedQuote.status).toBe("ACCEPTED");
    expect(quoteDetail).toMatchObject({
      id: quote.id,
      number: "Q-0001",
      status: "DRAFT",
      currency: "USD",
      subtotalCents: 375000,
      totalCents: 375000,
      deal: {
        id: fx.recordsA.deal.id,
        title: "Alpha Needle Deal",
        organization: { id: fx.recordsA.organization.id, name: "Alpha Orbit Organization" },
        person: { id: fx.recordsA.person.id, firstName: "Alpha", lastName: "Contact" }
      }
    });
    expect(quoteDetail.items[0]).toMatchObject({
      name: "Implementation Package",
      quantity: 3,
      unitPriceCents: 125000,
      currency: "USD",
      lineTotalCents: 375000
    });
    expect(updatedProduct).toMatchObject({
      name: "Implementation Package Updated",
      description: "Updated onboarding",
      unitPriceCents: 150000,
      currency: "EUR"
    });
    expect(deactivatedProduct.active).toBe(false);
    expect(inactiveProducts.find((item) => item.id === product.id)?.active).toBe(false);
    expect(dealWithLineItems.lineItems).toHaveLength(1);
    expect(dealWithLineItems.lineItems[0]).toMatchObject({
      productName: "Implementation Package",
      quantity: 3,
      unitPriceCents: 125000,
      currency: "USD",
      lineTotalCents: 375000
    });
    expect(dealWithLineItems.quotes).toHaveLength(1);
    expect(dealWithLineItems.quotes[0].status).toBe("ACCEPTED");
    expect(dealWithLineItems.quotes[0].items[0]).toMatchObject({
      name: "Implementation Package",
      quantity: 3,
      unitPriceCents: 125000,
      currency: "USD",
      lineTotalCents: 375000
    });
    expect(dealWithLineItems.valueCents).toBe(fx.recordsA.deal.valueCents);
    expect(reportAfterLineItem.metrics.openPipelineValueCents).toBe(initialReport.metrics.openPipelineValueCents);
    const dealAfterPublicAcceptance = await crm.getDeal(fx.actorA, fx.recordsA.deal.id);
    expect(dealAfterPublicAcceptance.valueCents).toBe(fx.recordsA.deal.valueCents);
    const syncResult = await crm.syncAcceptedQuoteToDealValue(fx.actorA, quote.id);
    const repeatSyncResult = await crm.syncAcceptedQuoteToDealValue(fx.actorA, quote.id);
    const dealAfterSync = await crm.getDeal(fx.actorA, fx.recordsA.deal.id);
    const reportAfterSync = await crm.getDealReport(fx.actorA);
    expect(syncResult).toMatchObject({
      synced: true,
      deal: {
        id: fx.recordsA.deal.id,
        valueCents: 354375,
        currency: "USD"
      }
    });
    expect(repeatSyncResult).toMatchObject({
      synced: false,
      deal: {
        id: fx.recordsA.deal.id,
        valueCents: 354375,
        currency: "USD"
      }
    });
    expect(dealAfterSync.valueCents).toBe(354375);
    expect(dealAfterSync.currency).toBe("USD");
    expect(reportAfterSync.metrics.openPipelineValueCents).toBe(354375);

    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: otherWorkspaceProduct.id,
        quantity: 1
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsB.deal.id,
        productId: product.id,
        quantity: 1
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(crm.createQuoteFromDeal(fx.actorA, fx.recordsB.deal.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.updateQuoteStatus(fx.actorB, quote.id, "SENT")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.updateQuoteAdjustments(fx.actorB, quote.id, { discountType: "FIXED", discountValue: 1000 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.revokeQuotePublicLink(fx.actorB, quote.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.syncAcceptedQuoteToDealValue(fx.actorB, quote.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.getQuote(fx.actorB, fx.recordsA.deal.id, quote.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.getQuote(fx.actorA, fx.recordsB.deal.id, quote.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: product.id,
        quantity: 1
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: otherWorkspaceProduct.id,
        quantity: 0
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.updateProduct(fx.actorB, product.id, {
        name: "Cross Workspace Update",
        unitPriceCents: 1000,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(crm.setProductActive(fx.actorB, product.id, true)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.removeDealLineItem(fx.actorB, lineItem.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    const declinedQuote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await expect(crm.syncAcceptedQuoteToDealValue(fx.actorA, declinedQuote.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await crm.updateQuoteStatus(fx.actorA, declinedQuote.id, "SENT");
    await expect(crm.syncAcceptedQuoteToDealValue(fx.actorA, declinedQuote.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const terminalDeclinedQuote = await crm.updateQuoteStatus(fx.actorA, declinedQuote.id, "DECLINED");
    const declinedPublicLink = await crm.createQuotePublicLink(fx.actorA, declinedQuote.id);
    await expect(crm.updateQuoteStatus(fx.actorA, declinedQuote.id, "ACCEPTED")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(crm.acceptPublicQuoteByToken(declinedPublicLink.token)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(crm.syncAcceptedQuoteToDealValue(fx.actorA, declinedQuote.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(crm.revokeQuotePublicLink(fx.actorA, quote.id)).resolves.toMatchObject({ revoked: true });
    await expect(crm.getPublicQuoteByToken(publicLink.token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.acceptPublicQuoteByToken(publicLink.token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    const regeneratedPublicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);
    const regeneratedPublicQuote = await crm.getPublicQuoteByToken(regeneratedPublicLink.token);
    expect(regeneratedPublicLink.id).not.toBe(publicLink.id);
    expect(regeneratedPublicLink.token).not.toBe(publicLink.token);
    expect(regeneratedPublicQuote.id).toBe(quote.id);
    expect(declinedQuote.number).toBe("Q-0002");
    expect(terminalDeclinedQuote.status).toBe("DECLINED");

    const reactivatedProduct = await crm.setProductActive(fx.actorA, product.id, true);
    const newLineItem = await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    expect(reactivatedProduct.active).toBe(true);
    expect(newLineItem).toMatchObject({
      productName: "Implementation Package Updated",
      quantity: 1,
      unitPriceCents: 150000,
      currency: "EUR",
      lineTotalCents: 150000
    });
    await expect(crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const refreshedQuoteDetail = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    expect(refreshedQuoteDetail.items).toHaveLength(1);
    expect(refreshedQuoteDetail.items[0]).toMatchObject({
      name: "Implementation Package",
      quantity: 3,
      unitPriceCents: 125000,
      currency: "USD",
      lineTotalCents: 375000
    });
    const persistedQuote = await fx.prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
      include: { items: true }
    });
    const quoteAuditLog = await fx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: fx.workspaceA.id, entityType: "Quote", entityId: quote.id, action: "quote.created" }
    });
    const quoteLifecycleLogs = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityType: "Quote", entityId: quote.id },
      orderBy: { action: "asc" }
    });
    const dealSyncLogs = await fx.prisma.auditLog.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Deal",
        entityId: fx.recordsA.deal.id,
        action: "deal.value_synced_from_quote"
      }
    });
    expect(persistedQuote.items[0]).toMatchObject({
      name: "Implementation Package",
      quantity: 3,
      unitPriceCents: 125000,
      currency: "USD",
      lineTotalCents: 375000
    });
    expect(quoteAuditLog.metadata).toMatchObject({
      dealId: fx.recordsA.deal.id,
      number: "Q-0001",
      itemCount: 1,
      currency: "USD",
      totalCents: 375000
    });
    expect(quoteLifecycleLogs.map((event) => event.action)).toEqual([
      "quote.adjustments_updated",
      "quote.created",
      "quote.public_accepted",
      "quote.public_link_created",
      "quote.public_link_created",
      "quote.public_link_revoked",
      "quote.sent"
    ]);
    expect(quoteLifecycleLogs.find((event) => event.action === "quote.adjustments_updated")?.metadata).toMatchObject({
      previous: { totalCents: 375000 },
      next: {
        discountType: "PERCENT",
        discountCents: 37500,
        taxType: "PERCENT",
        taxCents: 16875,
        totalCents: 354375
      }
    });
    expect(quoteLifecycleLogs.find((event) => event.action === "quote.sent")?.metadata).toMatchObject({
      previousStatus: "DRAFT",
      nextStatus: "SENT"
    });
    expect(quoteLifecycleLogs.find((event) => event.action === "quote.public_accepted")?.metadata).toMatchObject({
      quoteId: quote.id,
      quoteNumber: "Q-0001",
      publicLinkId: publicLink.id,
      previousStatus: "SENT",
      nextStatus: "ACCEPTED",
      totalCents: 354375,
      currency: "USD"
    });
    expect(
      quoteLifecycleLogs
        .filter((event) => event.action === "quote.public_link_created")
        .map((event) => (event.metadata as { publicLinkId?: string } | null)?.publicLinkId)
        .sort()
    ).toEqual([publicLink.id, regeneratedPublicLink.id].sort());
    expect(quoteLifecycleLogs.find((event) => event.action === "quote.public_link_revoked")?.metadata).toMatchObject({
      publicLinkId: publicLink.id
    });
    expect(dealSyncLogs).toHaveLength(1);
    expect(dealSyncLogs[0].metadata).toMatchObject({
      quoteId: quote.id,
      quoteNumber: "Q-0001",
      previousValueCents: 123400,
      previousCurrency: "USD",
      nextValueCents: 354375,
      nextCurrency: "USD"
    });

    await crm.removeDealLineItem(fx.actorA, lineItem.id);
    await crm.removeDealLineItem(fx.actorA, newLineItem.id);
    await expect(fx.prisma.dealLineItem.count({ where: { dealId: fx.recordsA.deal.id } })).resolves.toBe(0);
  });

  it("converts a lead into a deal and reattaches lead timeline records", async () => {
    const fx = currentFixture();

    const deal = await crm.convertLeadToDeal(fx.actorA, fx.recordsA.lead.id, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      title: "Converted Needle Deal"
    });

    const convertedLead = await fx.prisma.lead.findUniqueOrThrow({
      where: { id: fx.recordsA.lead.id }
    });
    const movedActivity = await fx.prisma.activity.findUniqueOrThrow({
      where: { id: fx.recordsA.activity.id }
    });
    const movedNote = await fx.prisma.note.findUniqueOrThrow({
      where: { id: fx.recordsA.note.id }
    });
    const auditEvents = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityId: { in: [fx.recordsA.lead.id, deal.id] } },
      orderBy: { action: "asc" }
    });

    expect(deal.title).toBe("Converted Needle Deal");
    expect(deal.pipelineId).toBe(fx.recordsA.pipeline.id);
    expect(deal.stageId).toBe(fx.recordsA.stageTwo.id);
    expect(convertedLead.status).toBe("CONVERTED");
    expect(movedActivity.leadId).toBeNull();
    expect(movedActivity.dealId).toBe(deal.id);
    expect(movedNote.leadId).toBeNull();
    expect(movedNote.dealId).toBe(deal.id);
    expect(auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["deal.created_from_lead", "lead.converted"])
    );
  });

  it("blocks normal edits and stage moves after a deal is closed", async () => {
    const fx = currentFixture();

    await crm.closeDeal(fx.actorA, fx.recordsA.deal.id, { status: "WON" });

    await expect(
      crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { title: "Should not update" })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED" });

    await expect(
      crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { stageId: fx.recordsA.stageTwo.id })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED" });
  });

  it("reopens won and lost deals while preserving pipeline stage and audit history", async () => {
    const fx = currentFixture();

    const beforeWonClose = Date.now();
    const wonDeal = await crm.closeDeal(fx.actorA, fx.recordsA.deal.id, { status: "WON" });
    const afterWonClose = Date.now();
    const reopenedWonDeal = await crm.reopenDeal(fx.actorA, wonDeal.id);
    const lostDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      title: "Lost then reopened",
      valueCents: 99000,
      currency: "USD"
    });
    const beforeLostClose = Date.now();
    const closedLostDeal = await crm.closeDeal(fx.actorA, lostDeal.id, { status: "LOST", lostReason: "Timing" });
    const afterLostClose = Date.now();
    const reopenedLostDeal = await crm.reopenDeal(fx.actorA, lostDeal.id);
    const auditEvents = await fx.prisma.auditLog.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Deal",
        entityId: { in: [wonDeal.id, lostDeal.id] },
        action: { in: ["deal.won", "deal.lost", "deal.reopened"] }
      },
      orderBy: { createdAt: "asc" }
    });
    const timeline = await crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: wonDeal.id });

    expect(reopenedWonDeal.status).toBe("OPEN");
    expect(reopenedWonDeal.stageId).toBe(fx.recordsA.stageOne.id);
    expect(wonDeal.wonAt).toBeInstanceOf(Date);
    expect(wonDeal.lostAt).toBeNull();
    expect(wonDeal.wonAt!.getTime()).toBeGreaterThanOrEqual(beforeWonClose);
    expect(wonDeal.wonAt!.getTime()).toBeLessThanOrEqual(afterWonClose);
    expect(reopenedWonDeal.wonAt).toBeNull();
    expect(reopenedWonDeal.lostAt).toBeNull();
    expect(reopenedLostDeal.status).toBe("OPEN");
    expect(reopenedLostDeal.stageId).toBe(fx.recordsA.stageTwo.id);
    expect(closedLostDeal.lostAt).toBeInstanceOf(Date);
    expect(closedLostDeal.wonAt).toBeNull();
    expect(closedLostDeal.lostAt!.getTime()).toBeGreaterThanOrEqual(beforeLostClose);
    expect(closedLostDeal.lostAt!.getTime()).toBeLessThanOrEqual(afterLostClose);
    expect(reopenedLostDeal.wonAt).toBeNull();
    expect(reopenedLostDeal.lostAt).toBeNull();
    expect(auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["deal.won", "deal.lost", "deal.reopened"])
    );
    expect(timeline.find((item) => item.type === "audit" && item.event.action === "deal.reopened")).toBeTruthy();
  });

  it("rejects reopening open deals and deals from another workspace", async () => {
    const fx = currentFixture();

    await expect(crm.reopenDeal(fx.actorA, fx.recordsA.deal.id)).rejects.toMatchObject({ code: "DEAL_ALREADY_OPEN" });
    await crm.closeDeal(fx.actorB, fx.recordsB.deal.id, { status: "LOST" });
    await expect(crm.reopenDeal(fx.actorA, fx.recordsB.deal.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects activity and note attachments to records from another workspace", async () => {
    const fx = currentFixture();

    await expect(
      crm.createActivity(fx.actorA, {
        dealId: fx.recordsB.deal.id,
        type: "TASK",
        title: "Invalid activity attachment"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      crm.createNote(fx.actorA, {
        personId: fx.recordsB.person.id,
        body: "Invalid note attachment"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates and reads plain notes across core records with ordering, workspace scope, and converted-lead locking", async () => {
    const fx = currentFixture();
    const olderDealNote = await crm.createNote(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      body: "Older deal note"
    });
    const newerDealNote = await crm.createNote(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      body: "Newer deal note"
    });
    await Promise.all([
      fx.prisma.note.update({
        where: { id: olderDealNote.id },
        data: { createdAt: new Date("2030-01-01T10:00:00.000Z") }
      }),
      fx.prisma.note.update({
        where: { id: newerDealNote.id },
        data: { createdAt: new Date("2030-01-02T10:00:00.000Z") }
      }),
      crm.createNote(fx.actorA, {
        personId: fx.recordsA.person.id,
        body: "Contact note"
      }),
      crm.createNote(fx.actorA, {
        organizationId: fx.recordsA.organization.id,
        body: "Organization note"
      }),
      crm.createNote(fx.actorA, {
        leadId: fx.recordsA.lead.id,
        body: "Lead note before conversion"
      })
    ]);

    const [deal, person, organization, lead, dealTimeline] = await Promise.all([
      crm.getDeal(fx.actorA, fx.recordsA.deal.id),
      crm.getPerson(fx.actorA, fx.recordsA.person.id),
      crm.getOrganization(fx.actorA, fx.recordsA.organization.id),
      crm.getLead(fx.actorA, fx.recordsA.lead.id),
      crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: fx.recordsA.deal.id })
    ]);

    expect(deal.notes.map((note) => note.body)).toEqual(["Newer deal note", "Older deal note"]);
    expect(deal.notes[0].authorId).toBe(fx.userA.id);
    expect(person.notes.map((note) => note.body)).toContain("Contact note");
    expect(organization.notes.map((note) => note.body)).toContain("Organization note");
    expect(lead.notes.map((note) => note.body)).toContain("Lead note before conversion");
    expect(dealTimeline.find((item) => item.type === "note")).toMatchObject({ body: "Newer deal note" });

    await expect(
      crm.createNote(fx.actorA, {
        organizationId: fx.recordsB.organization.id,
        body: "Cross-workspace organization note"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await crm.convertLeadToDeal(fx.actorA, fx.recordsA.lead.id, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      title: "Converted note lock deal"
    });
    await expect(
      crm.createNote(fx.actorA, {
        leadId: fx.recordsA.lead.id,
        body: "Converted lead note"
      })
    ).rejects.toMatchObject({ code: "LEAD_CONVERTED" });
  });

  it("logs manual emails and manages reusable email templates inside the current workspace", async () => {
    const fx = currentFixture();
    const activityCountBefore = await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } });
    const template = await crm.createEmailTemplate(fx.actorA, {
      name: "Follow-up",
      subject: "Next steps",
      body: "Thanks for the conversation."
    });
    const updatedTemplate = await crm.updateEmailTemplate(fx.actorA, template.id, {
      name: "Follow-up Updated",
      subject: "Updated next steps",
      body: "Updated template body."
    });
    const deactivatedTemplate = await crm.setEmailTemplateActive(fx.actorA, template.id, false);
    const activeTemplatesAfterDeactivate = await crm.listEmailTemplates(fx.actorA, { activeOnly: true });
    const editedInactiveTemplate = await crm.updateEmailTemplate(fx.actorA, template.id, {
      name: "Dormant follow-up",
      subject: "Dormant next steps",
      body: "Dormant template body."
    });
    const activeTemplatesAfterInactiveEdit = await crm.listEmailTemplates(fx.actorA, { activeOnly: true });
    const reactivatedTemplate = await crm.setEmailTemplateActive(fx.actorA, template.id, true);
    const activeTemplates = await crm.listEmailTemplates(fx.actorA, { activeOnly: true });
    const otherWorkspaceTemplate = await crm.createEmailTemplate(fx.actorB, {
      name: "Other workspace template",
      subject: "Other subject",
      body: "Other body"
    });
    const emailLog = await crm.createEmailLog(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      direction: "OUTBOUND",
      occurredAt: new Date("2030-03-01T15:30:00.000Z"),
      fromText: "seller@example.test",
      toText: "buyer@example.test",
      ccText: "legal@example.test",
      subject: reactivatedTemplate.subject,
      body: reactivatedTemplate.body
    });
    const changedAfterLogTemplate = await crm.updateEmailTemplate(fx.actorA, template.id, {
      name: "Follow-up after log",
      subject: "Changed after log",
      body: "Changed after log body."
    });
    const dealEmailLogs = await crm.listEmailLogsForRecord(fx.actorA, { type: "DEAL", id: fx.recordsA.deal.id });
    const dealTimeline = await crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: fx.recordsA.deal.id });
    const activityCountAfter = await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } });
    const auditLogs = await fx.prisma.auditLog.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        action: {
          in: [
            "email_log.created",
            "email_template.created",
            "email_template.updated",
            "email_template.deactivated",
            "email_template.reactivated"
          ]
        }
      },
      orderBy: [{ action: "asc" }, { createdAt: "asc" }]
    });

    expect(template).toMatchObject({
      workspaceId: fx.workspaceA.id,
      name: "Follow-up",
      subject: "Next steps",
      active: true
    });
    expect(updatedTemplate).toMatchObject({
      name: "Follow-up Updated",
      subject: "Updated next steps",
      body: "Updated template body."
    });
    expect(deactivatedTemplate.active).toBe(false);
    expect(activeTemplatesAfterDeactivate.map((item) => item.id)).not.toContain(template.id);
    expect(editedInactiveTemplate).toMatchObject({
      active: false,
      name: "Dormant follow-up",
      subject: "Dormant next steps",
      body: "Dormant template body."
    });
    expect(activeTemplatesAfterInactiveEdit.map((item) => item.id)).not.toContain(template.id);
    expect(reactivatedTemplate.active).toBe(true);
    expect(reactivatedTemplate.subject).toBe("Dormant next steps");
    expect(activeTemplates.map((item) => item.id)).toContain(template.id);
    expect(activeTemplates.map((item) => item.id)).not.toContain(otherWorkspaceTemplate.id);
    expect(changedAfterLogTemplate.subject).toBe("Changed after log");
    expect(emailLog).toMatchObject({
      workspaceId: fx.workspaceA.id,
      createdById: fx.userA.id,
      dealId: fx.recordsA.deal.id,
      direction: "OUTBOUND",
      subject: "Dormant next steps",
      body: "Dormant template body.",
      fromText: "seller@example.test",
      toText: "buyer@example.test",
      ccText: "legal@example.test"
    });
    expect(dealEmailLogs.map((item) => item.id)).toContain(emailLog.id);
    expect(dealTimeline.find((item) => item.type === "email")).toMatchObject({
      subject: "Dormant next steps",
      body: "Dormant template body.",
      direction: "OUTBOUND",
      fromText: "seller@example.test",
      toText: "buyer@example.test"
    });
    expect(activityCountAfter).toBe(activityCountBefore);
    expect(auditLogs.map((event) => event.action)).toEqual([
      "email_log.created",
      "email_template.created",
      "email_template.deactivated",
      "email_template.reactivated",
      "email_template.updated",
      "email_template.updated",
      "email_template.updated"
    ]);
    expect(auditLogs.find((event) => event.action === "email_log.created")?.metadata).toMatchObject({
      subject: "Dormant next steps",
      direction: "OUTBOUND"
    });

    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsB.deal.id,
        direction: "INBOUND",
        occurredAt: new Date(),
        subject: "Cross workspace",
        body: "Should be blocked."
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      crm.listEmailLogsForRecord(fx.actorA, { type: "DEAL", id: fx.recordsB.deal.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      crm.updateEmailTemplate(fx.actorA, otherWorkspaceTemplate.id, {
        name: "Wrong workspace",
        subject: "Nope",
        body: "Nope"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      crm.createEmailLog(fx.actorA, {
        direction: "OUTBOUND",
        occurredAt: new Date(),
        subject: "No record",
        body: "Missing attachment."
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date(),
        subject: " ",
        body: "Missing subject."
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date("not-a-date"),
        subject: "Invalid date",
        body: "Missing a valid occurred date."
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const convertedLead = await crm.createLead(fx.actorA, {
      title: "Email converted lead"
    });
    await crm.convertLeadToDeal(fx.actorA, convertedLead.id, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Email converted lead deal"
    });
    await expect(
      crm.createEmailLog(fx.actorA, {
        leadId: convertedLead.id,
        direction: "INBOUND",
        occurredAt: new Date(),
        subject: "Converted lead email",
        body: "Should move to deal."
      })
    ).rejects.toMatchObject({ code: "LEAD_CONVERTED" });
  });

  it("summarizes daily activity work by due bucket and completion inside the current workspace", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-15T12:00:00.000Z");
    await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "CALL",
      title: "Overdue deal follow-up",
      dueAt: new Date("2030-01-14T16:00:00.000Z")
    });
    const todayActivity = await crm.createActivity(fx.actorA, {
      personId: fx.recordsA.person.id,
      ownerId: fx.userA.id,
      type: "EMAIL",
      title: "Today contact follow-up",
      dueAt: new Date("2030-01-15T09:00:00.000Z")
    });
    await crm.createActivity(fx.actorA, {
      organizationId: fx.recordsA.organization.id,
      ownerId: fx.userA.id,
      type: "MEETING",
      title: "Upcoming organization review",
      dueAt: new Date("2030-01-16T09:00:00.000Z")
    });
    await crm.createActivity(fx.actorA, {
      leadId: fx.recordsA.lead.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Unscheduled lead cleanup"
    });
    await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        type: "TASK",
        title: "Completed prep",
        dueAt: new Date("2030-01-13T09:00:00.000Z"),
        completedAt: new Date("2030-01-13T12:00:00.000Z")
      }
    });
    await crm.createActivity(fx.actorB, {
      dealId: fx.recordsB.deal.id,
      ownerId: fx.userB.id,
      type: "TASK",
      title: "Other workspace overdue noise",
      dueAt: new Date("2030-01-14T09:00:00.000Z")
    });

    const summary = await crm.getActivityWorkQueueSummary(fx.actorA, now);

    expect(summary).toEqual({
      overdue: 2,
      dueToday: 1,
      upcoming: 1,
      unscheduled: 1,
      completed: 1,
      openTotal: 5
    });

    await crm.updateActivity(fx.actorA, todayActivity.id, { completedAt: now });

    expect(await crm.getActivityWorkQueueSummary(fx.actorA, now)).toEqual({
      overdue: 2,
      dueToday: 0,
      upcoming: 1,
      unscheduled: 1,
      completed: 2,
      openTotal: 4
    });
    await expect(crm.updateActivity(fx.actorA, todayActivity.id, { completedAt: null })).rejects.toMatchObject({
      code: "ACTIVITY_COMPLETED"
    });
  });

  it("filters activity work queues by status, due bucket, owner, and related record", async () => {
    const fx = currentFixture();
    const today = startOfLocalDay(new Date());
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    const todayDealActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "CALL",
      title: "Filter today deal call",
      dueAt: addHours(today, 9)
    });
    const overdueDealActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "EMAIL",
      title: "Filter overdue deal email",
      dueAt: addHours(yesterday, 9)
    });
    const upcomingContactActivity = await crm.createActivity(fx.actorA, {
      personId: fx.recordsA.person.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Filter upcoming contact task",
      dueAt: addHours(tomorrow, 9)
    });
    const completedDealActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "MEETING",
      title: "Filter completed deal meeting",
      dueAt: addHours(today, 10),
      completedAt: addHours(today, 11)
    });
    await crm.createActivity(fx.actorB, {
      dealId: fx.recordsB.deal.id,
      ownerId: fx.userB.id,
      type: "TASK",
      title: "Filter other workspace noise",
      dueAt: addHours(today, 9)
    });

    const dueTodayPage = await crm.listActivitiesPage(
      fx.actorA,
      {
        status: "open",
        ownerId: fx.userA.id,
        relatedType: "deal",
        relatedId: fx.recordsA.deal.id,
        due: "today"
      },
      { page: 1, pageSize: 10 }
    );
    const overduePage = await crm.listActivitiesPage(
      fx.actorA,
      {
        status: "open",
        ownerId: fx.userA.id,
        relatedType: "deal",
        relatedId: fx.recordsA.deal.id,
        due: "overdue"
      },
      { page: 1, pageSize: 10 }
    );
    const completedPage = await crm.listActivitiesPage(
      fx.actorA,
      {
        status: "completed",
        ownerId: fx.userA.id,
        relatedType: "deal",
        relatedId: fx.recordsA.deal.id
      },
      { page: 1, pageSize: 10 }
    );
    const upcomingContactPage = await crm.listActivitiesPage(
      fx.actorA,
      {
        status: "open",
        ownerId: fx.userA.id,
        relatedType: "person",
        relatedId: fx.recordsA.person.id,
        due: "upcoming"
      },
      { page: 1, pageSize: 10 }
    );

    expect(dueTodayPage.items.map((activity) => activity.id)).toEqual([todayDealActivity.id]);
    expect(overduePage.items.map((activity) => activity.id)).toEqual([overdueDealActivity.id]);
    expect(completedPage.items.map((activity) => activity.id)).toEqual([completedDealActivity.id]);
    expect(upcomingContactPage.items.map((activity) => activity.id)).toEqual([upcomingContactActivity.id]);
    expect(dueTodayPage.items.map((activity) => activity.title)).not.toContain("Filter other workspace noise");
  });

  it("creates and edits deal activities while resolving no-next-activity attention", async () => {
    const fx = currentFixture();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Activity polish no next",
      valueCents: 5000,
      currency: "USD"
    });

    const beforeReport = await crm.getDealReport(fx.actorA, { q: "Activity polish no next" });

    expect(beforeReport.metrics.dealsWithNoNextActivity).toBe(1);

    const activity = await crm.createActivity(fx.actorA, {
      dealId: deal.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Draft next-step recap",
      dueAt: tomorrow
    });
    const updatedDueAt = new Date(tomorrow);
    updatedDueAt.setDate(updatedDueAt.getDate() + 1);
    await crm.updateActivity(fx.actorA, activity.id, {
      title: "Send next-step recap",
      dueAt: updatedDueAt
    });
    const [updatedActivity, dealPage, afterReport] = await Promise.all([
      crm.getActivity(fx.actorA, activity.id),
      crm.listDealsPage(fx.actorA, { q: "Activity polish no next" }, { page: 1, pageSize: 10 }),
      crm.getDealReport(fx.actorA, { q: "Activity polish no next" })
    ]);

    expect(updatedActivity).toMatchObject({
      title: "Send next-step recap",
      dealId: deal.id,
      ownerId: fx.userA.id
    });
    expect(updatedActivity.dueAt?.toISOString()).toBe(updatedDueAt.toISOString());
    expect(afterReport.metrics.dealsWithNoNextActivity).toBe(0);
    expect(classifyDealAttention(dealPage.items[0])).toBe("upcoming");
    await expect(
      crm.updateActivity(fx.actorA, fx.recordsB.activity.id, { title: "Cross-workspace activity edit" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("surfaces deterministic Needs Attention items for overdue activities and deals without next activity", async () => {
    const fx = currentFixture();
    const now = new Date("2030-03-20T12:00:00.000Z");
    const overdueAt = new Date("2030-03-19T09:00:00.000Z");
    const noNextDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      title: "Assistant no-next deal",
      valueCents: 76000,
      currency: "USD"
    });
    const overdueActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "CALL",
      title: "Assistant overdue call",
      dueAt: overdueAt
    });

    const items = await crm.getNeedsAttentionSummary(fx.actorA, now);

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionHref: `/activities/${overdueActivity.id}/edit`,
          kind: "overdue-activity",
          reason: "This activity is overdue.",
          title: "Assistant overdue call"
        }),
        expect.objectContaining({
          actionHref: `/deals/${noNextDeal.id}#add-activity`,
          href: `/deals/${noNextDeal.id}`,
          kind: "deal-no-next-activity",
          reason: "This open deal has no next activity scheduled.",
          title: "Assistant no-next deal"
        })
      ])
    );
    expect(items.map((item) => item.href)).not.toContain(`/deals/${fx.recordsB.deal.id}`);
  });

  it("customizes pipeline and stage names while adding a new stage", async () => {
    const fx = currentFixture();

    const renamedPipeline = await crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, {
      name: "Enterprise Sales"
    });
    const renamedStage = await crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, {
      name: "Discovery Complete",
      probability: 45
    });
    const addedStage = await crm.createStage(fx.actorA, fx.recordsA.pipeline.id, {
      name: "Legal Review",
      probability: 70,
      sortOrder: 3
    });
    const pipelines = await crm.listPipelines(fx.actorA);
    const pipeline = pipelines.find((item) => item.id === fx.recordsA.pipeline.id);

    expect(renamedPipeline.name).toBe("Enterprise Sales");
    expect(renamedStage).toMatchObject({ name: "Discovery Complete", probability: 45 });
    expect(addedStage).toMatchObject({ name: "Legal Review", probability: 70 });
    expect(pipeline?.stages.map((stage) => stage.name)).toContain("Legal Review");
    await expect(
      crm.updateStage(fx.actorA, fx.recordsB.stageOne.id, { name: "Cross-workspace rename" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates suggested automation activities once per template and related record", async () => {
    const fx = currentFixture();

    const first = await crm.createAutomationTemplateActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      templateId: "deal-next-activity"
    });
    const duplicate = await crm.createAutomationTemplateActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      templateId: "deal-next-activity"
    });
    const leadOutreach = await crm.createAutomationTemplateActivity(fx.actorA, {
      leadId: fx.recordsA.lead.id,
      templateId: "lead-first-outreach"
    });
    const activities = await crm.listActivities(fx.actorA, { relatedType: "deal", relatedId: fx.recordsA.deal.id });
    const leadActivities = await crm.listActivities(fx.actorA, { relatedType: "lead", relatedId: fx.recordsA.lead.id });

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ activityId: first.activityId, created: false });
    expect(activities.filter((activity) => activity.title === "Schedule next step: Alpha Needle Deal")).toHaveLength(1);
    expect(leadOutreach.created).toBe(true);
    expect(leadActivities.map((activity) => activity.title)).toContain("First outreach: Alpha Needle Lead");
    await expect(
      crm.createAutomationTemplateActivity(fx.actorA, {
        dealId: fx.recordsB.deal.id,
        templateId: "deal-next-activity"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps search results scoped to the current workspace", async () => {
    const fx = currentFixture();

    const results = await crm.searchCrm(fx.actorA, "needle");

    expect(results.deals.map((deal) => deal.id)).toContain(fx.recordsA.deal.id);
    expect(results.deals.map((deal) => deal.id)).not.toContain(fx.recordsB.deal.id);
    expect(results.leads.map((lead) => lead.id)).toContain(fx.recordsA.lead.id);
    expect(results.leads.map((lead) => lead.id)).not.toContain(fx.recordsB.lead.id);
    expect(results.activities.map((activity) => activity.id)).toContain(fx.recordsA.activity.id);
    expect(results.activities.map((activity) => activity.id)).not.toContain(fx.recordsB.activity.id);
    expect(results.notes.map((note) => note.id)).toContain(fx.recordsA.note.id);
    expect(results.notes.map((note) => note.id)).not.toContain(fx.recordsB.note.id);
  });

  it("previews Organizations CSV imports with validation and workspace-scoped duplicate detection", async () => {
    const fx = currentFixture();

    const preview = await crm.previewOrganizationImport(
      fx.actorA,
      [
        "name,domain,ownerEmail,Custom: Region",
        `"${fx.recordsA.organization.name}",duplicate.example,owner@example.test,North`,
        "\"Fresh \"\"Quoted\"\" Org\",fresh.example,,West",
        "\"Fresh \"\"Quoted\"\" Org\",fresh-again.example,,West",
        `${fx.recordsB.organization.name},beta-is-valid-in-a.example,,South`,
        ",missing.example,,"
      ].join("\n")
    );

    expect(preview).toMatchObject({
      totalRows: 5,
      validRows: 2,
      duplicateRows: 2,
      invalidRows: 1,
      unsupportedColumns: ["ownerEmail", "Custom: Region"],
      parseErrors: []
    });
    expect(preview.validRows + preview.duplicateRows + preview.invalidRows).toBe(preview.totalRows);
    expect(preview.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        name: fx.recordsA.organization.name,
        status: "duplicate",
        skipReasons: ["Duplicate organization name in this workspace."],
        warnings: expect.arrayContaining(["Duplicate organization name in this workspace."])
      }),
      expect.objectContaining({
        rowNumber: 3,
        name: "Fresh \"Quoted\" Org",
        domain: "fresh.example",
        status: "valid"
      }),
      expect.objectContaining({
        rowNumber: 4,
        name: "Fresh \"Quoted\" Org",
        status: "duplicate",
        skipReasons: ["Duplicate organization name in this CSV."],
        warnings: expect.arrayContaining(["Duplicate organization name in this CSV."])
      }),
      expect.objectContaining({
        rowNumber: 5,
        name: fx.recordsB.organization.name,
        status: "valid"
      }),
      expect.objectContaining({
        rowNumber: 6,
        status: "invalid",
        skipReasons: ["Organization name is required."],
        errors: ["Organization name is required."]
      })
    ]);
    await expect(fx.prisma.organization.findMany({ where: { workspaceId: fx.workspaceA.id } })).resolves.toHaveLength(1);

    await expect(
      crm.previewOrganizationImport({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "name\nNo Access")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("imports only valid Organizations CSV rows after server-side revalidation", async () => {
    const fx = currentFixture();
    const originalOrganization = await fx.prisma.organization.findUniqueOrThrow({
      where: { id: fx.recordsA.organization.id }
    });
    const csv = [
      "name,domain,Custom: Region",
      `"${fx.recordsA.organization.name}",should-not-overwrite.example,North`,
      "Fresh Import One,fresh-one.example,East",
      "Fresh Import Two,,West",
      "Fresh Import One,fresh-one-dupe.example,East",
      ",missing.example,South"
    ].join("\n");

    const result = await crm.importOrganizationsFromCsv(fx.actorA, csv);
    const rerunResult = await crm.importOrganizationsFromCsv(fx.actorA, csv);
    const organizations = await fx.prisma.organization.findMany({
      where: { workspaceId: fx.workspaceA.id },
      orderBy: { name: "asc" }
    });
    const unchangedOriginal = await fx.prisma.organization.findUniqueOrThrow({
      where: { id: fx.recordsA.organization.id }
    });

    expect(result).toMatchObject({
      createdCount: 2,
      skippedDuplicateCount: 2,
      skippedInvalidCount: 1,
      errorCount: 0
    });
    expect(result.createdCount + result.skippedDuplicateCount + result.skippedInvalidCount).toBe(result.preview.totalRows);
    expect(rerunResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 4,
      skippedInvalidCount: 1,
      errorCount: 0
    });
    expect(rerunResult.createdCount + rerunResult.skippedDuplicateCount + rerunResult.skippedInvalidCount).toBe(
      rerunResult.preview.totalRows
    );
    expect(result.createdOrganizations.map((organization) => organization.name).sort()).toEqual([
      "Fresh Import One",
      "Fresh Import Two"
    ]);
    expect(organizations.map((organization) => organization.name).sort()).toEqual([
      originalOrganization.name,
      "Fresh Import One",
      "Fresh Import Two"
    ]);
    expect(organizations.find((organization) => organization.name === "Fresh Import One")).toMatchObject({
      domain: "fresh-one.example",
      ownerId: null
    });
    expect(organizations.find((organization) => organization.name === "Fresh Import Two")).toMatchObject({
      domain: null,
      ownerId: null
    });
    expect(unchangedOriginal.domain).toBe(originalOrganization.domain);
    expect(unchangedOriginal.updatedAt.getTime()).toBe(originalOrganization.updatedAt.getTime());

    const importAuditLogs = await fx.prisma.auditLog.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "organization.imported",
        entityType: "Organization"
      },
      orderBy: { createdAt: "asc" }
    });

    expect(importAuditLogs).toHaveLength(2);
    expect(importAuditLogs.map((log) => log.actorId)).toEqual([fx.userA.id, fx.userA.id]);
    expect(importAuditLogs.map((log) => log.workspaceId)).toEqual([fx.workspaceA.id, fx.workspaceA.id]);
    expect(importAuditLogs.map((log) => log.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          importSource: "csv",
          recordType: "organization",
          displayName: "Fresh Import One",
          name: "Fresh Import One"
        }),
        expect.objectContaining({
          importSource: "csv",
          recordType: "organization",
          displayName: "Fresh Import Two",
          name: "Fresh Import Two"
        })
      ])
    );
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceB.id,
          action: "organization.imported"
        }
      })
    ).resolves.toBe(0);

    const stalePreviewCsv = "name,domain\nServer Revalidated,server-revalidated.example";
    const stalePreview = await crm.previewOrganizationImport(fx.actorA, stalePreviewCsv);
    await fx.prisma.organization.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Server Revalidated",
        domain: "already-created.example"
      }
    });
    const revalidatedImport = await crm.importOrganizationsFromCsv(fx.actorA, stalePreviewCsv);

    expect(stalePreview.validRows).toBe(1);
    expect(revalidatedImport).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 1,
      skippedInvalidCount: 0,
      errorCount: 0
    });

    await expect(
      crm.importOrganizationsFromCsv({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "name\nNo Access")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("previews Contacts CSV imports with email duplicates and workspace-scoped organization references", async () => {
    const fx = currentFixture();
    await Promise.all([
      fx.prisma.organization.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "Ambiguous Org",
          domain: "ambiguous-one.example"
        }
      }),
      fx.prisma.organization.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "Ambiguous Org",
          domain: "ambiguous-two.example"
        }
      })
    ]);
    const contactCountBefore = await fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } });
    const preview = await crm.previewContactImport(
      fx.actorA,
      [
        "name,email,phone,organizationName,title,Custom: Tier",
        `"Existing Contact",${fx.recordsA.person.email?.toUpperCase()},555-0101,${fx.recordsA.organization.name},CEO,Gold`,
        `"Fresh Contact",fresh@example.test,555-0102,${fx.recordsA.organization.name},VP,Silver`,
        `"Fresh Contact Duplicate",FRESH@example.test,555-0103,,VP,Silver`,
        `"No Email Contact",,555-0104,,Director,Bronze`,
        ",missing@example.test,555-0105,,Manager,Bronze",
        `"Wrong Workspace Org",workspace@example.test,555-0106,${fx.recordsB.organization.name},Manager,Bronze`,
        "\"Ambiguous Person\",ambiguous@example.test,555-0107,Ambiguous Org,Manager,Bronze",
        "\"Missing Org Person\",missing-org@example.test,555-0108,No Such Org,Manager,Bronze"
      ].join("\n")
    );

    expect(preview).toMatchObject({
      totalRows: 8,
      validRows: 2,
      duplicateRows: 2,
      invalidRows: 4,
      unsupportedColumns: ["title", "Custom: Tier"],
      parseErrors: []
    });
    expect(preview.validRows + preview.duplicateRows + preview.invalidRows).toBe(preview.totalRows);
    expect(preview.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        email: fx.recordsA.person.email?.toUpperCase(),
        organizationId: fx.recordsA.organization.id,
        status: "duplicate",
        skipReasons: ["Duplicate contact email in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 3,
        name: "Fresh Contact",
        firstName: "Fresh",
        lastName: "Contact",
        email: "fresh@example.test",
        organizationId: fx.recordsA.organization.id,
        status: "valid"
      }),
      expect.objectContaining({
        rowNumber: 4,
        email: "FRESH@example.test",
        status: "duplicate",
        skipReasons: ["Duplicate contact email in this CSV."]
      }),
      expect.objectContaining({
        rowNumber: 5,
        name: "No Email Contact",
        email: "",
        organizationId: null,
        status: "valid"
      }),
      expect.objectContaining({
        rowNumber: 6,
        status: "invalid",
        skipReasons: ["Contact name is required."]
      }),
      expect.objectContaining({
        rowNumber: 7,
        organizationName: fx.recordsB.organization.name,
        status: "invalid",
        skipReasons: ["Organization name was not found in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 8,
        organizationName: "Ambiguous Org",
        status: "invalid",
        skipReasons: ["Organization name matches multiple organizations in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 9,
        organizationName: "No Such Org",
        status: "invalid",
        skipReasons: ["Organization name was not found in this workspace."]
      })
    ]);

    await expect(fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(contactCountBefore);
    await expect(
      crm.previewContactImport({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "name\nNo Access")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("imports only valid Contacts CSV rows after server-side revalidation", async () => {
    const fx = currentFixture();
    const originalContact = await fx.prisma.person.findUniqueOrThrow({
      where: { id: fx.recordsA.person.id }
    });
    const csv = [
      "name,email,phone,organizationName,Custom: Tier",
      `"${originalContact.firstName} ${originalContact.lastName}",${originalContact.email?.toUpperCase()},555-9999,${fx.recordsA.organization.name},Gold`,
      `"Fresh Contact",fresh-contact@example.test,555-0101,${fx.recordsA.organization.name},Silver`,
      `"Second Import",second-import@example.test,555-0102,,Bronze`,
      `"Fresh Contact Duplicate",FRESH-CONTACT@example.test,555-0103,,Silver`,
      ",missing-name@example.test,555-0104,,Bronze",
      "\"Missing Org\",missing-org-contact@example.test,555-0105,No Such Org,Bronze"
    ].join("\n");

    const result = await crm.importContactsFromCsv(fx.actorA, csv);
    const rerunResult = await crm.importContactsFromCsv(fx.actorA, csv);
    const contacts = await fx.prisma.person.findMany({
      where: { workspaceId: fx.workspaceA.id },
      orderBy: [{ email: "asc" }, { firstName: "asc" }]
    });
    const unchangedOriginal = await fx.prisma.person.findUniqueOrThrow({
      where: { id: fx.recordsA.person.id }
    });

    expect(result).toMatchObject({
      createdCount: 2,
      skippedDuplicateCount: 2,
      skippedInvalidCount: 2,
      errorCount: 0
    });
    expect(result.createdCount + result.skippedDuplicateCount + result.skippedInvalidCount).toBe(result.preview.totalRows);
    expect(result.createdContacts.map((contact) => contact.name).sort()).toEqual(["Fresh Contact", "Second Import"]);
    expect(rerunResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 4,
      skippedInvalidCount: 2,
      errorCount: 0
    });
    expect(rerunResult.createdCount + rerunResult.skippedDuplicateCount + rerunResult.skippedInvalidCount).toBe(
      rerunResult.preview.totalRows
    );

    expect(contacts.map((contact) => contact.email).filter(Boolean).sort()).toEqual([
      originalContact.email,
      "fresh-contact@example.test",
      "second-import@example.test"
    ]);
    expect(contacts.find((contact) => contact.email === "fresh-contact@example.test")).toMatchObject({
      firstName: "Fresh",
      lastName: "Contact",
      phone: "555-0101",
      organizationId: fx.recordsA.organization.id,
      ownerId: null
    });
    expect(contacts.find((contact) => contact.email === "second-import@example.test")).toMatchObject({
      firstName: "Second",
      lastName: "Import",
      phone: "555-0102",
      organizationId: null,
      ownerId: null
    });
    expect(unchangedOriginal.phone).toBe(originalContact.phone);
    expect(unchangedOriginal.updatedAt.getTime()).toBe(originalContact.updatedAt.getTime());
    await expect(
      fx.prisma.organization.findFirst({
        where: { workspaceId: fx.workspaceA.id, name: "No Such Org" }
      })
    ).resolves.toBeNull();

    const importAuditLogs = await fx.prisma.auditLog.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "contact.imported",
        entityType: "Person"
      },
      orderBy: { createdAt: "asc" }
    });

    expect(importAuditLogs).toHaveLength(2);
    expect(importAuditLogs.map((log) => log.actorId)).toEqual([fx.userA.id, fx.userA.id]);
    expect(importAuditLogs.map((log) => log.workspaceId)).toEqual([fx.workspaceA.id, fx.workspaceA.id]);
    expect(importAuditLogs.map((log) => log.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          importSource: "csv",
          recordType: "contact",
          displayName: "Fresh Contact",
          name: "Fresh Contact",
          email: "fresh-contact@example.test"
        }),
        expect.objectContaining({
          importSource: "csv",
          recordType: "contact",
          displayName: "Second Import",
          name: "Second Import",
          email: "second-import@example.test"
        })
      ])
    );
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceB.id,
          action: "contact.imported"
        }
      })
    ).resolves.toBe(0);

    const stalePreviewCsv = "name,email\nServer Revalidated Contact,server-revalidated-contact@example.test";
    const stalePreview = await crm.previewContactImport(fx.actorA, stalePreviewCsv);
    await fx.prisma.person.create({
      data: {
        workspaceId: fx.workspaceA.id,
        firstName: "Server",
        lastName: "Revalidated",
        email: "server-revalidated-contact@example.test"
      }
    });
    const revalidatedImport = await crm.importContactsFromCsv(fx.actorA, stalePreviewCsv);

    expect(stalePreview.validRows).toBe(1);
    expect(revalidatedImport).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 1,
      skippedInvalidCount: 0,
      errorCount: 0
    });

    await expect(
      crm.importContactsFromCsv({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "name,email\nNo Access,no-access@example.test")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("previews Leads CSV imports with title duplicates and workspace-scoped organization references", async () => {
    const fx = currentFixture();
    await Promise.all([
      fx.prisma.organization.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "Lead Ambiguous Org",
          domain: "lead-ambiguous-one.example"
        }
      }),
      fx.prisma.organization.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "Lead Ambiguous Org",
          domain: "lead-ambiguous-two.example"
        }
      })
    ]);
    const leadCountBefore = await fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } });
    const preview = await crm.previewLeadImport(
      fx.actorA,
      [
        "title,source,status,organizationName,email,Custom: Priority",
        `"${fx.recordsA.lead.title}",Partner,NEW,${fx.recordsA.organization.name},existing@example.test,High`,
        `"Fresh Lead",Web,QUALIFIED,${fx.recordsA.organization.name},fresh@example.test,Medium`,
        `"Fresh Lead",Referral,NEW,,fresh-dupe@example.test,Medium`,
        `"No Org Lead",Outbound,, ,no-org@example.test,Low`,
        ",Web,NEW,,missing-title@example.test,Low",
        `"Wrong Workspace Org",Web,NEW,${fx.recordsB.organization.name},workspace@example.test,Low`,
        "\"Ambiguous Lead\",Web,NEW,Lead Ambiguous Org,ambiguous@example.test,Low",
        "\"Missing Org Lead\",Web,NEW,No Such Lead Org,missing-org@example.test,Low",
        "\"Converted Lead\",Web,CONVERTED,,converted@example.test,Low",
        "\"Bad Status Lead\",Web,ARCHIVED,,bad-status@example.test,Low"
      ].join("\n")
    );

    expect(preview).toMatchObject({
      totalRows: 10,
      validRows: 2,
      duplicateRows: 2,
      invalidRows: 6,
      unsupportedColumns: ["email", "Custom: Priority"],
      parseErrors: []
    });
    expect(preview.validRows + preview.duplicateRows + preview.invalidRows).toBe(preview.totalRows);
    expect(preview.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        title: fx.recordsA.lead.title,
        organizationId: fx.recordsA.organization.id,
        status: "duplicate",
        skipReasons: ["Duplicate lead title in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 3,
        title: "Fresh Lead",
        source: "Web",
        statusValue: "QUALIFIED",
        organizationId: fx.recordsA.organization.id,
        status: "valid"
      }),
      expect.objectContaining({
        rowNumber: 4,
        title: "Fresh Lead",
        status: "duplicate",
        skipReasons: ["Duplicate lead title in this CSV."]
      }),
      expect.objectContaining({
        rowNumber: 5,
        title: "No Org Lead",
        statusValue: "NEW",
        organizationId: null,
        status: "valid"
      }),
      expect.objectContaining({
        rowNumber: 6,
        status: "invalid",
        skipReasons: ["Lead title is required."]
      }),
      expect.objectContaining({
        rowNumber: 7,
        organizationName: fx.recordsB.organization.name,
        status: "invalid",
        skipReasons: ["Organization name was not found in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 8,
        organizationName: "Lead Ambiguous Org",
        status: "invalid",
        skipReasons: ["Organization name matches multiple organizations in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 9,
        organizationName: "No Such Lead Org",
        status: "invalid",
        skipReasons: ["Organization name was not found in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 10,
        statusValue: "CONVERTED",
        status: "invalid",
        skipReasons: ["Converted leads cannot be imported through CSV."]
      }),
      expect.objectContaining({
        rowNumber: 11,
        statusValue: "ARCHIVED",
        status: "invalid",
        skipReasons: ["Lead status must be NEW, QUALIFIED, or DISQUALIFIED."]
      })
    ]);

    await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(leadCountBefore);
    await expect(
      crm.previewLeadImport({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "title\nNo Access")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("imports only valid Leads CSV rows after server-side revalidation", async () => {
    const fx = currentFixture();
    const originalLead = await fx.prisma.lead.findUniqueOrThrow({
      where: { id: fx.recordsA.lead.id }
    });
    const csv = [
      "title,source,status,organizationName,Custom: Priority",
      `"${originalLead.title}",Should Not Overwrite,NEW,${fx.recordsA.organization.name},High`,
      `"Fresh Lead One",Web,,${fx.recordsA.organization.name},Medium`,
      "\"Fresh Lead Two\",Referral,QUALIFIED,,Low",
      "\"Fresh Lead Three\",Outbound,DISQUALIFIED,,Low",
      "\"Fresh Lead One\",Partner,NEW,,Medium",
      ",Web,NEW,,Low",
      "\"Converted Import\",Web,CONVERTED,,Low",
      "\"Missing Org Import\",Web,NEW,No Such Lead Org,Low"
    ].join("\n");

    const result = await crm.importLeadsFromCsv(fx.actorA, csv);
    const rerunResult = await crm.importLeadsFromCsv(fx.actorA, csv);
    const leads = await fx.prisma.lead.findMany({
      where: { workspaceId: fx.workspaceA.id },
      orderBy: { title: "asc" }
    });
    const unchangedOriginal = await fx.prisma.lead.findUniqueOrThrow({
      where: { id: fx.recordsA.lead.id }
    });

    expect(result).toMatchObject({
      createdCount: 3,
      skippedDuplicateCount: 2,
      skippedInvalidCount: 3,
      errorCount: 0
    });
    expect(result.createdCount + result.skippedDuplicateCount + result.skippedInvalidCount).toBe(result.preview.totalRows);
    expect(result.createdLeads.map((lead) => ({ title: lead.title, status: lead.status })).sort((a, b) => a.title.localeCompare(b.title))).toEqual([
      { title: "Fresh Lead One", status: "NEW" },
      { title: "Fresh Lead Three", status: "DISQUALIFIED" },
      { title: "Fresh Lead Two", status: "QUALIFIED" }
    ]);
    expect(rerunResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 5,
      skippedInvalidCount: 3,
      errorCount: 0
    });
    expect(rerunResult.createdCount + rerunResult.skippedDuplicateCount + rerunResult.skippedInvalidCount).toBe(
      rerunResult.preview.totalRows
    );

    expect(leads.map((lead) => lead.title).sort()).toEqual([
      originalLead.title,
      "Fresh Lead One",
      "Fresh Lead Three",
      "Fresh Lead Two"
    ]);
    expect(leads.find((lead) => lead.title === "Fresh Lead One")).toMatchObject({
      source: "Web",
      status: "NEW",
      organizationId: fx.recordsA.organization.id,
      ownerId: null,
      personId: null
    });
    expect(leads.find((lead) => lead.title === "Fresh Lead Two")).toMatchObject({
      source: "Referral",
      status: "QUALIFIED",
      organizationId: null
    });
    expect(leads.find((lead) => lead.title === "Fresh Lead Three")).toMatchObject({
      source: "Outbound",
      status: "DISQUALIFIED",
      organizationId: null
    });
    expect(unchangedOriginal.source).toBe(originalLead.source);
    expect(unchangedOriginal.updatedAt.getTime()).toBe(originalLead.updatedAt.getTime());
    await expect(
      fx.prisma.organization.findFirst({
        where: { workspaceId: fx.workspaceA.id, name: "No Such Lead Org" }
      })
    ).resolves.toBeNull();

    const importAuditLogs = await fx.prisma.auditLog.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "lead.imported",
        entityType: "Lead"
      },
      orderBy: { createdAt: "asc" }
    });

    expect(importAuditLogs).toHaveLength(3);
    expect(importAuditLogs.map((log) => log.actorId)).toEqual([fx.userA.id, fx.userA.id, fx.userA.id]);
    expect(importAuditLogs.map((log) => log.workspaceId)).toEqual([fx.workspaceA.id, fx.workspaceA.id, fx.workspaceA.id]);
    expect(importAuditLogs.map((log) => log.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          importSource: "csv",
          recordType: "lead",
          displayName: "Fresh Lead One",
          title: "Fresh Lead One",
          status: "NEW"
        }),
        expect.objectContaining({
          importSource: "csv",
          recordType: "lead",
          displayName: "Fresh Lead Two",
          title: "Fresh Lead Two",
          status: "QUALIFIED"
        }),
        expect.objectContaining({
          importSource: "csv",
          recordType: "lead",
          displayName: "Fresh Lead Three",
          title: "Fresh Lead Three",
          status: "DISQUALIFIED"
        })
      ])
    );
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceB.id,
          action: "lead.imported"
        }
      })
    ).resolves.toBe(0);

    const stalePreviewCsv = "title,source\nServer Revalidated Lead,Web";
    const stalePreview = await crm.previewLeadImport(fx.actorA, stalePreviewCsv);
    await fx.prisma.lead.create({
      data: {
        workspaceId: fx.workspaceA.id,
        title: "Server Revalidated Lead",
        source: "Already created"
      }
    });
    const revalidatedImport = await crm.importLeadsFromCsv(fx.actorA, stalePreviewCsv);

    expect(stalePreview.validRows).toBe(1);
    expect(revalidatedImport).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 1,
      skippedInvalidCount: 0,
      errorCount: 0
    });

    await expect(
      crm.importLeadsFromCsv({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "title\nNo Access")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("previews Deals CSV imports with explicit workspace-scoped associations", async () => {
    const fx = currentFixture();
    await Promise.all([
      fx.prisma.person.create({
        data: {
          workspaceId: fx.workspaceA.id,
          firstName: "Ambiguous",
          lastName: "Contact",
          email: "deal-ambiguous-one@example.test"
        }
      }),
      fx.prisma.person.create({
        data: {
          workspaceId: fx.workspaceA.id,
          firstName: "Ambiguous",
          lastName: "Contact",
          email: "deal-ambiguous-two@example.test"
        }
      })
    ]);
    const dealCountBefore = await fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } });
    const preview = await crm.previewDealImport(
      fx.actorA,
      [
        "title,pipeline,stage,status,value,currency,expectedCloseAt,contactEmail,contactName,organizationName,ownerEmail,Custom: Segment,createdAt,lostReason",
        `"${fx.recordsA.deal.title}",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,1234.00,USD,2030-01-01,${fx.recordsA.person.email?.toUpperCase()},,${fx.recordsA.organization.name},${fx.userA.email},Enterprise,2029-01-01,Already here`,
        `"Fresh Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},WON,456.78,eur,2030-02-03T00:00:00.000Z,${fx.recordsA.person.email},,${fx.recordsA.organization.name},${fx.userA.email},Commercial,2029-01-02,`,
        `"Fresh Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},LOST,500.00,USD,,${fx.recordsA.person.email},,${fx.recordsA.organization.name},${fx.userA.email},Commercial,2029-01-03,Not stored`,
        `"Ambiguous Contact Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,1.00,USD,,,Ambiguous Contact,${fx.recordsA.organization.name},${fx.userA.email},SMB,2029-01-04,`,
        `"Nonmember Owner Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,1.00,USD,2030-01-01,,,${fx.recordsA.organization.name},${fx.userB.email},SMB,2029-01-05,`,
        `"Wrong Workspace Pipeline",${fx.recordsB.pipeline.name},${fx.recordsB.stageOne.name},OPEN,1.00,USD,2030-01-01,,,,${fx.userA.email},SMB,2029-01-06,`,
        "\"Bad Fields\",Alpha Pipeline,Alpha Qualified,ARCHIVED,-1.00,US,not-a-date,,,,,SMB,2029-01-07,",
        `"Missing Pipeline And Stage",,,OPEN,,USD,,,,,,SMB,2029-01-08,`,
        `,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,,USD,,,,No Such Organization,,SMB,2029-01-09,`
      ].join("\n")
    );

    expect(preview).toMatchObject({
      totalRows: 9,
      validRows: 1,
      duplicateRows: 2,
      invalidRows: 6,
      unsupportedColumns: ["Custom: Segment", "createdAt", "lostReason"],
      parseErrors: []
    });
    expect(preview.validRows + preview.duplicateRows + preview.invalidRows).toBe(preview.totalRows);
    expect(preview.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        title: fx.recordsA.deal.title,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        ownerId: fx.userA.id,
        status: "duplicate",
        skipReasons: [
          "Duplicate skipped: a deal with the same title, pipeline, stage, contact, and organization already exists in this workspace."
        ]
      }),
      expect.objectContaining({
        rowNumber: 3,
        title: "Fresh Deal",
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageTwo.id,
        statusValue: "WON",
        valueCents: 45678,
        currency: "EUR",
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        ownerId: fx.userA.id,
        status: "valid"
      }),
      expect.objectContaining({
        rowNumber: 4,
        status: "duplicate",
        skipReasons: [
          "Duplicate skipped: another CSV row has the same title, pipeline, stage, contact, and organization."
        ]
      }),
      expect.objectContaining({
        rowNumber: 5,
        contactName: "Ambiguous Contact",
        status: "invalid",
        skipReasons: ["Contact reference matches multiple contacts in this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 6,
        ownerEmail: fx.userB.email,
        status: "invalid",
        skipReasons: ["Owner email must match an active user who belongs to this workspace."]
      }),
      expect.objectContaining({
        rowNumber: 7,
        pipelineName: fx.recordsB.pipeline.name,
        status: "invalid",
        skipReasons: ["Pipeline must already exist in this workspace; no default pipeline is inferred."]
      }),
      expect.objectContaining({
        rowNumber: 8,
        status: "invalid",
        skipReasons: [
          "Deal status must be OPEN, WON, or LOST.",
          "Deal value must be a non-negative amount with at most two decimal places.",
          "Currency must be a 3-letter code.",
          "Expected close date must be a valid ISO datetime or YYYY-MM-DD date."
        ]
      }),
      expect.objectContaining({
        rowNumber: 9,
        title: "Missing Pipeline And Stage",
        status: "invalid",
        skipReasons: ["Pipeline is required.", "Stage is required."]
      }),
      expect.objectContaining({
        rowNumber: 10,
        status: "invalid",
        skipReasons: [
          "Deal title is required.",
          "Organization must already exist in this workspace; organizations are not auto-created."
        ]
      })
    ]);
    expect(preview.rows[1].warnings).toContain(
      "Imported WON/LOST status does not set wonAt/lostAt or lost reason; Goals v1 progress excludes imported won deals until closed in-app."
    );
    await expect(fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(dealCountBefore);
    const aliasPreview = await crm.previewDealImport(
      fx.actorA,
      [
        "name,pipelineName,stageName,value,currency,status,contactName,organizationName,ownerEmail",
        `"Alias Header Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},2500.00,usd,LOST,${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName},${fx.recordsA.organization.name},${fx.userA.email}`
      ].join("\n")
    );
    expect(aliasPreview).toMatchObject({
      totalRows: 1,
      validRows: 1,
      duplicateRows: 0,
      invalidRows: 0,
      unsupportedColumns: [],
      parseErrors: []
    });
    expect(aliasPreview.rows[0]).toMatchObject({
      title: "Alias Header Deal",
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      statusValue: "LOST",
      valueCents: 250000,
      currency: "USD",
      personId: fx.recordsA.person.id,
      organizationId: fx.recordsA.organization.id,
      ownerId: fx.userA.id
    });
    expect(aliasPreview.rows[0].warnings).toContain(
      "Imported WON/LOST status does not set wonAt/lostAt or lost reason; Goals v1 progress excludes imported won deals until closed in-app."
    );
    await expect(
      crm.previewDealImport({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "title,pipeline,stage\nNo Access,No,No")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("imports only valid Deals CSV rows after server-side revalidation and writes audit timeline events", async () => {
    const fx = currentFixture();
    const originalDeal = await fx.prisma.deal.findUniqueOrThrow({
      where: { id: fx.recordsA.deal.id }
    });
    const csv = [
      "title,pipeline,stage,status,value,currency,expectedCloseAt,contactEmail,organizationName,ownerEmail,Custom: Segment",
      `"${originalDeal.title}",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,999.00,USD,2030-01-01,${fx.recordsA.person.email},${fx.recordsA.organization.name},${fx.userA.email},Enterprise`,
      `"Fresh Deal One",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},WON,1200.50,EUR,2030-03-04,${fx.recordsA.person.email},${fx.recordsA.organization.name},${fx.userA.email},Commercial`,
      `"Fresh Deal Two",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},,,,,,,,SMB`,
      `"Fresh Lost Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},LOST,900.00,USD,,${fx.recordsA.person.email},${fx.recordsA.organization.name},${fx.userA.email},Commercial`,
      `"Fresh Deal One",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},LOST,1200.50,EUR,2030-03-04,${fx.recordsA.person.email},${fx.recordsA.organization.name},${fx.userA.email},Commercial`,
      `,${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},OPEN,,,,,,,Missing`,
      `"Missing Org Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},OPEN,,,,,No Such Deal Org,,Missing`
    ].join("\n");

    const result = await crm.importDealsFromCsv(fx.actorA, csv);
    const rerunResult = await crm.importDealsFromCsv(fx.actorA, csv);
    const deals = await fx.prisma.deal.findMany({
      where: { workspaceId: fx.workspaceA.id },
      orderBy: { title: "asc" }
    });
    const unchangedOriginal = await fx.prisma.deal.findUniqueOrThrow({
      where: { id: fx.recordsA.deal.id }
    });

    expect(result).toMatchObject({
      createdCount: 3,
      skippedDuplicateCount: 2,
      skippedInvalidCount: 2,
      errorCount: 0
    });
    expect(result.createdCount + result.skippedDuplicateCount + result.skippedInvalidCount).toBe(result.preview.totalRows);
    expect(result.createdDeals.map((deal) => ({ title: deal.title, status: deal.status })).sort((a, b) => a.title.localeCompare(b.title))).toEqual([
      { title: "Fresh Deal One", status: "WON" },
      { title: "Fresh Deal Two", status: "OPEN" },
      { title: "Fresh Lost Deal", status: "LOST" }
    ]);
    expect(rerunResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 5,
      skippedInvalidCount: 2,
      errorCount: 0
    });
    expect(rerunResult.createdCount + rerunResult.skippedDuplicateCount + rerunResult.skippedInvalidCount).toBe(
      rerunResult.preview.totalRows
    );

    expect(deals.map((deal) => deal.title).sort()).toEqual([
      originalDeal.title,
      "Fresh Deal One",
      "Fresh Deal Two",
      "Fresh Lost Deal"
    ]);
    expect(deals.find((deal) => deal.title === "Fresh Deal One")).toMatchObject({
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      ownerId: fx.userA.id,
      personId: fx.recordsA.person.id,
      organizationId: fx.recordsA.organization.id,
      valueCents: 120050,
      currency: "EUR",
      status: "WON"
    });
    expect(deals.find((deal) => deal.title === "Fresh Deal Two")).toMatchObject({
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      ownerId: null,
      personId: null,
      organizationId: null,
      valueCents: null,
      currency: "USD",
      status: "OPEN",
      expectedCloseAt: null
    });
    expect(deals.find((deal) => deal.title === "Fresh Lost Deal")).toMatchObject({
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      personId: fx.recordsA.person.id,
      organizationId: fx.recordsA.organization.id,
      valueCents: 90000,
      currency: "USD",
      status: "LOST",
      expectedCloseAt: null
    });
    expect(unchangedOriginal.valueCents).toBe(originalDeal.valueCents);
    expect(unchangedOriginal.updatedAt.getTime()).toBe(originalDeal.updatedAt.getTime());
    await expect(
      fx.prisma.organization.findFirst({
        where: { workspaceId: fx.workspaceA.id, name: "No Such Deal Org" }
      })
    ).resolves.toBeNull();

    const importAuditLogs = await fx.prisma.auditLog.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "deal.imported",
        entityType: "Deal"
      },
      orderBy: { createdAt: "asc" }
    });

    expect(importAuditLogs).toHaveLength(3);
    expect(importAuditLogs.map((log) => log.actorId)).toEqual([fx.userA.id, fx.userA.id, fx.userA.id]);
    expect(importAuditLogs.map((log) => log.workspaceId)).toEqual([fx.workspaceA.id, fx.workspaceA.id, fx.workspaceA.id]);
    expect(importAuditLogs.map((log) => log.metadata)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          importSource: "csv",
          recordType: "deal",
          displayName: "Fresh Deal One",
          title: "Fresh Deal One",
          status: "WON",
          pipelineId: fx.recordsA.pipeline.id,
          stageId: fx.recordsA.stageTwo.id,
          personId: fx.recordsA.person.id,
          organizationId: fx.recordsA.organization.id
        }),
        expect.objectContaining({
          importSource: "csv",
          recordType: "deal",
          displayName: "Fresh Deal Two",
          title: "Fresh Deal Two",
          status: "OPEN",
          pipelineId: fx.recordsA.pipeline.id,
          stageId: fx.recordsA.stageTwo.id,
          personId: null,
          organizationId: null
        }),
        expect.objectContaining({
          importSource: "csv",
          recordType: "deal",
          displayName: "Fresh Lost Deal",
          title: "Fresh Lost Deal",
          status: "LOST",
          pipelineId: fx.recordsA.pipeline.id,
          stageId: fx.recordsA.stageOne.id,
          personId: fx.recordsA.person.id,
          organizationId: fx.recordsA.organization.id
        })
      ])
    );

    const freshDealOne = deals.find((deal) => deal.title === "Fresh Deal One");
    expect(freshDealOne).toBeTruthy();
    const timeline = await crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: freshDealOne!.id });
    expect(timeline.find((item) => item.type === "audit" && item.event.action === "deal.imported")).toBeTruthy();
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceB.id,
          action: "deal.imported"
        }
      })
    ).resolves.toBe(0);

    const stalePreviewCsv = `title,pipeline,stage\nServer Revalidated Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name}`;
    const stalePreview = await crm.previewDealImport(fx.actorA, stalePreviewCsv);
    await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageTwo.id,
        title: "Server Revalidated Deal"
      }
    });
    const revalidatedImport = await crm.importDealsFromCsv(fx.actorA, stalePreviewCsv);

    expect(stalePreview.validRows).toBe(1);
    expect(revalidatedImport).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 1,
      skippedInvalidCount: 0,
      errorCount: 0
    });

    await expect(
      crm.importDealsFromCsv({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "title,pipeline,stage\nNo Access,No,No")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("filters CRM lists by supported custom field exact values", async () => {
    const fx = currentFixture();
    const otherDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      title: "Custom field filter miss",
      valueCents: 45000,
      currency: "USD"
    });
    const field = await crm.createCustomField(fx.actorA, {
      entityType: "DEAL",
      name: "Implementation Fit",
      key: "implementation_fit",
      fieldType: "TEXT",
      required: false
    });
    await crm.upsertCustomFieldValues(fx.actorA, {
      entityType: "DEAL",
      entityId: fx.recordsA.deal.id,
      values: { [field.id]: "High" }
    });
    await crm.upsertCustomFieldValues(fx.actorA, {
      entityType: "DEAL",
      entityId: otherDeal.id,
      values: { [field.id]: "Low" }
    });

    const matchingPage = await crm.listDealsPage(
      fx.actorA,
      { q: "Needle", customFieldId: field.id, customFieldValue: "High" },
      { page: 1, pageSize: 10 }
    );
    const summaries = await crm.listCustomFieldSummaries(
      fx.actorA,
      "DEAL",
      matchingPage.items.map((deal) => deal.id)
    );
    const invalidValuePage = await crm.listDealsPage(
      fx.actorA,
      { customFieldId: field.id, customFieldValue: "Medium" },
      { page: 1, pageSize: 10 }
    );
    const searchMissPage = await crm.listDealsPage(
      fx.actorA,
      { q: "not this record", customFieldId: field.id, customFieldValue: "High" },
      { page: 1, pageSize: 10 }
    );

    expect(matchingPage.items.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);
    expect(summaries.get(fx.recordsA.deal.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: field.id, value: "High" })])
    );
    expect(invalidValuePage.items).toEqual([]);
    expect(searchMissPage.items).toEqual([]);
  });

  it("persists Deal saved views, scopes them by workspace, and round-trips query state", async () => {
    const fx = currentFixture();
    const state = parseListViewState(
      {
        q: "Needle",
        status: "OPEN",
        customFieldId: "field_123",
        customFieldOperator: "contains",
        customFieldValue: "High",
        sortBy: "title",
        sortDirection: "asc",
        page: "4",
        pageSize: "25"
      },
      {
        defaultSortBy: "updatedAt",
        defaultSortDirection: "desc",
        filterKeys: [
          "status",
          "stageId",
          "ownerId",
          "personId",
          "organizationId",
          "customFieldId",
          "customFieldOperator",
          "customFieldValue"
        ],
        sortByValues: ["updatedAt", "createdAt", "title", "valueCents", "expectedCloseAt"] as const
      }
    );

    const savedView = await crm.createDealSavedView(fx.actorA, {
      name: "Open needle deals",
      state
    });
    const malformedView = await fx.prisma.savedView.create({
      data: {
        workspaceId: fx.workspaceA.id,
        recordType: "DEAL",
        name: "Malformed deal view",
        state: {
          filters: { status: "OPEN", unsupportedFilter: "ignored" },
          sortBy: "unsupported",
          sortDirection: "sideways",
          page: 9,
          pageSize: 999
        }
      }
    });
    const [workspaceAViews, workspaceBViews] = await Promise.all([
      crm.listDealSavedViews(fx.actorA),
      crm.listDealSavedViews(fx.actorB)
    ]);
    const normalizedMalformedView = workspaceAViews.find((view) => view.id === malformedView.id);

    expect(savedView).toMatchObject({
      workspaceId: fx.workspaceA.id,
      recordType: "DEAL",
      name: "Open needle deals",
      state: {
        q: "Needle",
        filters: {
          status: "OPEN",
          customFieldId: "field_123",
          customFieldOperator: "contains",
          customFieldValue: "High"
        },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      },
      href: "/deals?q=Needle&status=OPEN&customFieldId=field_123&customFieldOperator=contains&customFieldValue=High&sortBy=title&sortDirection=asc&pageSize=25"
    });
    expect(savedView.href).not.toContain("page=4");
    expect(workspaceAViews.map((view) => view.id)).toContain(savedView.id);
    expect(workspaceBViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(normalizedMalformedView).toMatchObject({
      state: {
        filters: { status: "OPEN" },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 50
      },
      href: "/deals?status=OPEN&sortBy=updatedAt&sortDirection=desc&pageSize=50"
    });

    await expect(crm.deleteDealSavedView(fx.actorB, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await crm.deleteDealSavedView(fx.actorA, savedView.id);
    await expect(fx.prisma.savedView.findUnique({ where: { id: savedView.id } })).resolves.toBeNull();
  });

  it("persists Lead saved views, scopes them by workspace and record type, and normalizes stale payloads", async () => {
    const fx = currentFixture();
    const state = parseListViewState(
      {
        q: "Needle",
        status: "QUALIFIED",
        source: "Webinar",
        ownerId: fx.userA.id,
        customFieldId: "lead_field_123",
        customFieldOperator: "is_not_empty",
        customFieldValue: "High",
        sortBy: "title",
        sortDirection: "asc",
        page: "7",
        pageSize: "25"
      },
      {
        defaultSortBy: "updatedAt",
        defaultSortDirection: "desc",
        filterKeys: ["status", "source", "ownerId", "customFieldId", "customFieldOperator", "customFieldValue"],
        sortByValues: ["updatedAt", "createdAt", "title"] as const
      }
    );

    const savedView = await crm.createLeadSavedView(fx.actorA, {
      name: "Qualified webinar leads",
      state
    });
    const malformedView = await fx.prisma.savedView.create({
      data: {
        workspaceId: fx.workspaceA.id,
        recordType: "LEAD",
        name: "Malformed lead view",
        state: {
          filters: { status: "QUALIFIED", unsupportedFilter: "ignored" },
          sortBy: "unsupported",
          sortDirection: "sideways",
          page: 9,
          pageSize: 999
        }
      }
    });
    const [workspaceALeadViews, workspaceBLeadViews, workspaceADealViews] = await Promise.all([
      crm.listLeadSavedViews(fx.actorA),
      crm.listLeadSavedViews(fx.actorB),
      crm.listDealSavedViews(fx.actorA)
    ]);
    const normalizedMalformedView = workspaceALeadViews.find((view) => view.id === malformedView.id);

    expect(savedView).toMatchObject({
      workspaceId: fx.workspaceA.id,
      recordType: "LEAD",
      name: "Qualified webinar leads",
      state: {
        q: "Needle",
        filters: {
          status: "QUALIFIED",
          source: "Webinar",
          ownerId: fx.userA.id,
          customFieldId: "lead_field_123",
          customFieldOperator: "is_not_empty",
          customFieldValue: "High"
        },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      },
      href: `/leads?q=Needle&status=QUALIFIED&source=Webinar&ownerId=${fx.userA.id}&customFieldId=lead_field_123&customFieldOperator=is_not_empty&customFieldValue=High&sortBy=title&sortDirection=asc&pageSize=25`
    });
    expect(savedView.href).not.toContain("page=7");
    expect(workspaceALeadViews.map((view) => view.id)).toContain(savedView.id);
    expect(workspaceBLeadViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(workspaceADealViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(normalizedMalformedView).toMatchObject({
      state: {
        filters: { status: "QUALIFIED" },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 50
      },
      href: "/leads?status=QUALIFIED&sortBy=updatedAt&sortDirection=desc&pageSize=50"
    });

    await expect(crm.deleteLeadSavedView(fx.actorB, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.deleteDealSavedView(fx.actorA, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await crm.deleteLeadSavedView(fx.actorA, savedView.id);
    await expect(fx.prisma.savedView.findUnique({ where: { id: savedView.id } })).resolves.toBeNull();
  });

  it("persists Contact saved views, scopes them by workspace and record type, and normalizes stale payloads", async () => {
    const fx = currentFixture();
    const state = parseListViewState(
      {
        q: "Contact",
        organizationId: fx.recordsA.organization.id,
        ownerId: fx.userA.id,
        customFieldId: "contact_field_123",
        customFieldOperator: "contains",
        customFieldValue: "Decision maker",
        sortBy: "updatedAt",
        sortDirection: "desc",
        page: "6",
        pageSize: "25"
      },
      {
        defaultSortBy: "name",
        defaultSortDirection: "asc",
        filterKeys: ["organizationId", "ownerId", "customFieldId", "customFieldOperator", "customFieldValue"],
        sortByValues: ["name", "createdAt", "updatedAt"] as const
      }
    );

    const savedView = await crm.createContactSavedView(fx.actorA, {
      name: "Decision maker contacts",
      state
    });
    const malformedView = await fx.prisma.savedView.create({
      data: {
        workspaceId: fx.workspaceA.id,
        recordType: "PERSON",
        name: "Malformed contact view",
        state: {
          filters: { organizationId: fx.recordsA.organization.id, unsupportedFilter: "ignored" },
          sortBy: "unsupported",
          sortDirection: "sideways",
          page: 4,
          pageSize: 999
        }
      }
    });
    const [workspaceAContactViews, workspaceBContactViews, workspaceADealViews, workspaceALeadViews] =
      await Promise.all([
        crm.listContactSavedViews(fx.actorA),
        crm.listContactSavedViews(fx.actorB),
        crm.listDealSavedViews(fx.actorA),
        crm.listLeadSavedViews(fx.actorA)
      ]);
    const normalizedMalformedView = workspaceAContactViews.find((view) => view.id === malformedView.id);

    expect(savedView).toMatchObject({
      workspaceId: fx.workspaceA.id,
      recordType: "PERSON",
      name: "Decision maker contacts",
      state: {
        q: "Contact",
        filters: {
          organizationId: fx.recordsA.organization.id,
          ownerId: fx.userA.id,
          customFieldId: "contact_field_123",
          customFieldOperator: "contains",
          customFieldValue: "Decision maker"
        },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 25
      },
      href: `/contacts?q=Contact&organizationId=${fx.recordsA.organization.id}&ownerId=${fx.userA.id}&customFieldId=contact_field_123&customFieldOperator=contains&customFieldValue=Decision+maker&sortBy=updatedAt&sortDirection=desc&pageSize=25`
    });
    expect(savedView.href).not.toContain("page=6");
    expect(workspaceAContactViews.map((view) => view.id)).toContain(savedView.id);
    expect(workspaceBContactViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(workspaceADealViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(workspaceALeadViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(normalizedMalformedView).toMatchObject({
      state: {
        filters: { organizationId: fx.recordsA.organization.id },
        sortBy: "name",
        sortDirection: "asc",
        pageSize: 50
      },
      href: `/contacts?organizationId=${fx.recordsA.organization.id}&sortBy=name&sortDirection=asc&pageSize=50`
    });

    await expect(crm.deleteContactSavedView(fx.actorB, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.deleteDealSavedView(fx.actorA, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.deleteLeadSavedView(fx.actorA, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await crm.deleteContactSavedView(fx.actorA, savedView.id);
    await expect(fx.prisma.savedView.findUnique({ where: { id: savedView.id } })).resolves.toBeNull();
  });

  it("persists Organization saved views, scopes them by workspace and record type, and normalizes stale payloads", async () => {
    const fx = currentFixture();
    const state = parseListViewState(
      {
        q: "Orbit",
        ownerId: fx.userA.id,
        customFieldId: "organization_field_123",
        customFieldOperator: "is_not_empty",
        customFieldValue: "Enterprise",
        sortBy: "updatedAt",
        sortDirection: "desc",
        page: "5",
        pageSize: "25"
      },
      {
        defaultSortBy: "name",
        defaultSortDirection: "asc",
        filterKeys: ["ownerId", "customFieldId", "customFieldOperator", "customFieldValue"],
        sortByValues: ["name", "createdAt", "updatedAt"] as const
      }
    );

    const savedView = await crm.createOrganizationSavedView(fx.actorA, {
      name: "Enterprise organizations",
      state
    });
    const malformedView = await fx.prisma.savedView.create({
      data: {
        workspaceId: fx.workspaceA.id,
        recordType: "ORGANIZATION",
        name: "Malformed organization view",
        state: {
          filters: { ownerId: fx.userA.id, unsupportedFilter: "ignored" },
          sortBy: "unsupported",
          sortDirection: "sideways",
          page: 8,
          pageSize: 999
        }
      }
    });
    const [
      workspaceAOrganizationViews,
      workspaceBOrganizationViews,
      workspaceADealViews,
      workspaceALeadViews,
      workspaceAContactViews
    ] = await Promise.all([
      crm.listOrganizationSavedViews(fx.actorA),
      crm.listOrganizationSavedViews(fx.actorB),
      crm.listDealSavedViews(fx.actorA),
      crm.listLeadSavedViews(fx.actorA),
      crm.listContactSavedViews(fx.actorA)
    ]);
    const normalizedMalformedView = workspaceAOrganizationViews.find((view) => view.id === malformedView.id);

    expect(savedView).toMatchObject({
      workspaceId: fx.workspaceA.id,
      recordType: "ORGANIZATION",
      name: "Enterprise organizations",
      state: {
        q: "Orbit",
        filters: {
          ownerId: fx.userA.id,
          customFieldId: "organization_field_123",
          customFieldOperator: "is_not_empty",
          customFieldValue: "Enterprise"
        },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 25
      },
      href: `/organizations?q=Orbit&ownerId=${fx.userA.id}&customFieldId=organization_field_123&customFieldOperator=is_not_empty&customFieldValue=Enterprise&sortBy=updatedAt&sortDirection=desc&pageSize=25`
    });
    expect(savedView.href).not.toContain("page=5");
    expect(workspaceAOrganizationViews.map((view) => view.id)).toContain(savedView.id);
    expect(workspaceBOrganizationViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(workspaceADealViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(workspaceALeadViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(workspaceAContactViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(normalizedMalformedView).toMatchObject({
      state: {
        filters: { ownerId: fx.userA.id },
        sortBy: "name",
        sortDirection: "asc",
        pageSize: 50
      },
      href: `/organizations?ownerId=${fx.userA.id}&sortBy=name&sortDirection=asc&pageSize=50`
    });

    await expect(crm.deleteOrganizationSavedView(fx.actorB, savedView.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    await expect(crm.deleteDealSavedView(fx.actorA, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.deleteLeadSavedView(fx.actorA, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.deleteContactSavedView(fx.actorA, savedView.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await crm.deleteOrganizationSavedView(fx.actorA, savedView.id);
    await expect(fx.prisma.savedView.findUnique({ where: { id: savedView.id } })).resolves.toBeNull();
  });

  it("calculates Deal Reporting v1 metrics and stage totals within the current workspace", async () => {
    const fx = currentFixture();
    await Promise.all([
      fx.prisma.pipelineStage.update({ where: { id: fx.recordsA.stageOne.id }, data: { probability: 20 } }),
      fx.prisma.pipelineStage.update({ where: { id: fx.recordsA.stageTwo.id }, data: { probability: 50 } }),
      fx.prisma.pipelineStage.update({ where: { id: fx.recordsB.stageOne.id }, data: { probability: 100 } })
    ]);
    const stageTwoOpen = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      title: "Report open stage two",
      valueCents: 2000,
      currency: "USD",
      expectedCloseAt: new Date("2030-04-01T00:00:00.000Z")
    });
    const unassignedZeroValueDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      title: "Report zero unassigned",
      valueCents: 0,
      currency: "EUR",
      ownerId: null,
      expectedCloseAt: new Date("2030-03-15T00:00:00.000Z")
    });
    const wonDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Report won",
      valueCents: 3000,
      currency: "USD"
    });
    const lostDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Report lost",
      valueCents: 4000,
      currency: "USD"
    });
    await crm.createDeal(fx.actorB, {
      pipelineId: fx.recordsB.pipeline.id,
      stageId: fx.recordsB.stageOne.id,
      title: "Other workspace report noise",
      valueCents: 999999,
      currency: "USD"
    });
    await crm.closeDeal(fx.actorA, wonDeal.id, { status: "WON" });
    await crm.closeDeal(fx.actorA, lostDeal.id, { status: "LOST", lostReason: "Timing" });

    const report = await crm.getDealReport(fx.actorA);
    const filteredReport = await crm.getDealReport(fx.actorA, { q: "stage two" });
    const stageOne = report.stageBreakdown.find((stage) => stage.stageId === fx.recordsA.stageOne.id);
    const stageTwo = report.stageBreakdown.find((stage) => stage.stageId === fx.recordsA.stageTwo.id);

    expect(report.metrics).toEqual({
      openPipelineValueCents: 125400,
      openDealsCount: 3,
      wonDealsCount: 1,
      wonDealsValueCents: 3000,
      lostDealsCount: 1,
      lostDealsValueCents: 4000,
      dealsWithOverdueActivities: 0,
      dealsDueToday: 0,
      dealsWithNoNextActivity: 3
    });
    expect(stageOne).toMatchObject({
      stageName: fx.recordsA.stageOne.name,
      pipelineName: fx.recordsA.pipeline.name,
      openDealCount: 1,
      openDealValueCents: fx.recordsA.deal.valueCents
    });
    expect(stageTwo).toMatchObject({
      stageName: fx.recordsA.stageTwo.name,
      pipelineName: fx.recordsA.pipeline.name,
      openDealCount: 2,
      openDealValueCents: stageTwoOpen.valueCents
    });
    expect(filteredReport.metrics).toMatchObject({
      openPipelineValueCents: 2000,
      openDealsCount: 1,
      wonDealsCount: 0,
      lostDealsCount: 0
    });
    expect(report.forecast.openDealCount).toBe(3);
    expect(report.forecast.summaries).toEqual([
      {
        currency: "EUR",
        openDealCount: 1,
        openForecastValueCents: 0,
        weightedForecastValueCents: 0,
        missingProbabilityDealCount: 0,
        missingProbabilityValueCents: 0,
        noExpectedCloseDealCount: 0,
        noExpectedCloseValueCents: 0
      },
      {
        currency: "USD",
        openDealCount: 2,
        openForecastValueCents: 125400,
        weightedForecastValueCents: 25680,
        missingProbabilityDealCount: 0,
        missingProbabilityValueCents: 0,
        noExpectedCloseDealCount: 1,
        noExpectedCloseValueCents: fx.recordsA.deal.valueCents
      }
    ]);
    expect(report.forecast.rows.map((row) => row.dealId)).toEqual([
      unassignedZeroValueDeal.id,
      stageTwoOpen.id,
      fx.recordsA.deal.id
    ]);
    expect(report.forecast.rows.find((row) => row.dealId === unassignedZeroValueDeal.id)).toMatchObject({
      ownerName: "Unassigned",
      valueCents: 0,
      weightedValueCents: 0,
      currency: "EUR"
    });
    expect(filteredReport.forecast.openDealCount).toBe(1);
    expect(filteredReport.forecast.summaries[0]).toMatchObject({
      currency: "USD",
      openDealCount: 1,
      openForecastValueCents: 2000,
      weightedForecastValueCents: 1000
    });
  });

  it("calculates monthly workspace won-revenue goal progress from wonAt only", async () => {
    const fx = currentFixture();
    await expect(
      crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
        month: "2030-03",
        currency: "USD",
        targetCents: -1
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    const goal = await crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
      month: "2030-03",
      currency: "usd",
      targetCents: 10000
    });
    const updatedGoal = await crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
      month: new Date("2030-03-15T12:00:00.000Z"),
      currency: "USD",
      targetCents: 12000
    });
    const eurGoal = await crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
      month: "2030-03",
      currency: " eur ",
      targetCents: 5000
    });

    await Promise.all([
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Goal first boundary",
        status: "WON",
        valueCents: 3000,
        currency: "USD",
        wonAt: new Date("2030-03-01T00:00:00.000Z")
      }),
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Goal last moment",
        status: "WON",
        valueCents: 4000,
        currency: "USD",
        wonAt: new Date("2030-03-31T23:59:59.999Z")
      }),
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Goal next month noise",
        status: "WON",
        valueCents: 5000,
        currency: "USD",
        wonAt: new Date("2030-04-01T00:00:00.000Z")
      }),
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Goal legacy null wonAt",
        status: "WON",
        valueCents: 6000,
        currency: "USD",
        expectedCloseAt: new Date("2030-03-10T00:00:00.000Z"),
        wonAt: null
      }),
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Goal open noise",
        status: "OPEN",
        valueCents: 7000,
        currency: "USD",
        expectedCloseAt: new Date("2030-03-10T00:00:00.000Z"),
        wonAt: new Date("2030-03-10T00:00:00.000Z")
      }),
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Goal lost noise",
        status: "LOST",
        valueCents: 8000,
        currency: "USD",
        lostAt: new Date("2030-03-10T00:00:00.000Z")
      }),
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Goal EUR separate",
        status: "WON",
        valueCents: 9000,
        currency: "EUR",
        wonAt: new Date("2030-03-10T00:00:00.000Z")
      }),
      crm.createDeal(fx.actorB, {
        pipelineId: fx.recordsB.pipeline.id,
        stageId: fx.recordsB.stageOne.id,
        title: "Goal other workspace noise",
        status: "WON",
        valueCents: 999999,
        currency: "USD",
        wonAt: new Date("2030-03-10T00:00:00.000Z")
      })
    ]);

    const progress = await crm.getMonthlyWonRevenueGoalProgress(fx.actorA, { month: "2030-03", currency: "USD" });
    const eurProgress = await crm.getMonthlyWonRevenueGoalProgress(fx.actorA, { month: "2030-03", currency: "EUR" });
    const aprilProgress = await crm.getMonthlyWonRevenueGoalProgress(fx.actorA, { month: "2030-04", currency: "USD" });

    expect(goal.id).toBe(updatedGoal.id);
    expect(eurGoal.id).not.toBe(goal.id);
    expect(eurGoal.currency).toBe("EUR");
    expect(updatedGoal.targetCents).toBe(12000);
    expect(progress).toMatchObject({
      type: "WON_REVENUE",
      currency: "USD",
      periodStart: new Date("2030-03-01T00:00:00.000Z"),
      periodEnd: new Date("2030-04-01T00:00:00.000Z"),
      targetCents: 12000,
      wonRevenueCents: 7000,
      remainingCents: 5000,
      progressPercent: 58.33,
      includedDealCount: 2
    });
    expect(progress.goal?.id).toBe(goal.id);
    expect(eurProgress).toMatchObject({
      goal: { id: eurGoal.id },
      targetCents: 5000,
      wonRevenueCents: 9000,
      remainingCents: 0,
      progressPercent: 180,
      includedDealCount: 1
    });
    expect(aprilProgress).toMatchObject({
      wonRevenueCents: 5000,
      includedDealCount: 1
    });
  });

  it("calculates pipeline hygiene counts from open deal activities within the current workspace", async () => {
    const fx = currentFixture();
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const overdueDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Hygiene overdue",
      valueCents: 1000,
      currency: "USD"
    });
    const todayDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Hygiene today",
      valueCents: 2000,
      currency: "USD"
    });
    const upcomingDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Hygiene upcoming",
      valueCents: 3000,
      currency: "USD"
    });
    await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Hygiene no next activity",
      valueCents: 4000,
      currency: "USD"
    });
    const otherWorkspaceDeal = await crm.createDeal(fx.actorB, {
      pipelineId: fx.recordsB.pipeline.id,
      stageId: fx.recordsB.stageOne.id,
      title: "Hygiene other workspace noise",
      valueCents: 999999,
      currency: "USD"
    });
    await Promise.all([
      crm.createActivity(fx.actorA, {
        dealId: overdueDeal.id,
        type: "TASK",
        title: "Past-due hygiene step",
        dueAt: yesterday
      }),
      crm.createActivity(fx.actorA, {
        dealId: todayDeal.id,
        type: "CALL",
        title: "Today hygiene step",
        dueAt: today
      }),
      crm.createActivity(fx.actorA, {
        dealId: upcomingDeal.id,
        type: "EMAIL",
        title: "Future hygiene step",
        dueAt: tomorrow
      }),
      crm.createActivity(fx.actorB, {
        dealId: otherWorkspaceDeal.id,
        type: "TASK",
        title: "Other workspace overdue hygiene step",
        dueAt: yesterday
      })
    ]);

    const report = await crm.getDealReport(fx.actorA, { q: "Hygiene" });
    const stageOne = report.stageBreakdown.find((stage) => stage.stageId === fx.recordsA.stageOne.id);

    expect(report.metrics).toEqual({
      openPipelineValueCents: 10000,
      openDealsCount: 4,
      wonDealsCount: 0,
      wonDealsValueCents: 0,
      lostDealsCount: 0,
      lostDealsValueCents: 0,
      dealsWithOverdueActivities: 1,
      dealsDueToday: 1,
      dealsWithNoNextActivity: 1
    });
    expect(stageOne).toMatchObject({
      openDealCount: 4,
      openDealValueCents: 10000
    });
  });

  it("returns a workspace-scoped unified timeline with notes, activities, and audit events", async () => {
    const fx = currentFixture();

    await crm.updateLead(fx.actorA, fx.recordsA.lead.id, { source: "Timeline source" });
    const timeline = await crm.getRecordTimeline(fx.actorA, { type: "LEAD", id: fx.recordsA.lead.id });

    expect(timeline.map((item) => item.type)).toEqual(expect.arrayContaining(["note", "activity", "audit"]));
    expect(timeline.find((item) => item.type === "note")).toMatchObject({ body: fx.recordsA.note.body });
    expect(timeline.find((item) => item.type === "activity")).toMatchObject({ title: fx.recordsA.activity.title });
    expect(timeline.find((item) => item.type === "audit")).toMatchObject({ type: "audit" });
    expect(timeline).toEqual(
      [...timeline].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    );

    await expect(
      crm.getRecordTimeline(fx.actorA, { type: "LEAD", id: fx.recordsB.lead.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns deal timeline context with notes, open and completed activities, and deal history", async () => {
    const fx = currentFixture();
    const openActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "CALL",
      title: "Open timeline call",
      dueAt: new Date("2030-02-01T09:00:00.000Z")
    });
    const completedActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Completed timeline prep",
      dueAt: new Date("2030-01-31T09:00:00.000Z")
    });
    await crm.updateActivity(fx.actorA, completedActivity.id, {
      completedAt: new Date("2030-01-31T17:00:00.000Z")
    });
    await crm.createNote(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      body: "Deal timeline note"
    });
    await crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { title: "Timeline deal updated" });

    const timeline = await crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: fx.recordsA.deal.id });
    const activityItems = timeline.filter((item) => item.type === "activity");

    expect(timeline.map((item) => item.type)).toEqual(expect.arrayContaining(["note", "activity", "audit"]));
    expect(timeline.find((item) => item.type === "note")).toMatchObject({ body: "Deal timeline note" });
    expect(activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: openActivity.title, completedAt: null }),
        expect.objectContaining({ title: completedActivity.title, completedAt: expect.any(Date) })
      ])
    );
    expect(timeline.find((item) => item.type === "audit")).toMatchObject({ type: "audit" });
    expect(timeline).toEqual(
      [...timeline].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    );

    await expect(
      crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: fx.recordsB.deal.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("soft-deletes activities and notes, keeps rows, and excludes them from reads and search", async () => {
    const fx = currentFixture();

    await crm.softDeleteActivity(fx.actorA, fx.recordsA.activity.id);
    await crm.softDeleteNote(fx.actorA, fx.recordsA.note.id);

    const [activity, note, lead, activities, results, timeline, auditEvents] = await Promise.all([
      fx.prisma.activity.findUniqueOrThrow({ where: { id: fx.recordsA.activity.id } }),
      fx.prisma.note.findUniqueOrThrow({ where: { id: fx.recordsA.note.id } }),
      crm.getLead(fx.actorA, fx.recordsA.lead.id),
      crm.listActivities(fx.actorA),
      crm.searchCrm(fx.actorA, "needle"),
      crm.getRecordTimeline(fx.actorA, { type: "LEAD", id: fx.recordsA.lead.id }),
      fx.prisma.auditLog.findMany({
        where: {
          workspaceId: fx.workspaceA.id,
          action: { in: ["activity.deleted", "note.deleted"] }
        },
        orderBy: { action: "asc" }
      })
    ]);

    expect(activity.deletedAt).toBeInstanceOf(Date);
    expect(note.deletedAt).toBeInstanceOf(Date);
    expect(lead.activities.map((item) => item.id)).not.toContain(fx.recordsA.activity.id);
    expect(lead.notes.map((item) => item.id)).not.toContain(fx.recordsA.note.id);
    expect(activities.map((item) => item.id)).not.toContain(fx.recordsA.activity.id);
    expect(results.activities.map((item) => item.id)).not.toContain(fx.recordsA.activity.id);
    expect(results.notes.map((item) => item.id)).not.toContain(fx.recordsA.note.id);
    expect(timeline.map((item) => item.id)).not.toContain(`activity-${fx.recordsA.activity.id}`);
    expect(timeline.map((item) => item.id)).not.toContain(`note-${fx.recordsA.note.id}`);
    expect(auditEvents.map((event) => event.action)).toEqual(["activity.deleted", "note.deleted"]);
  });

  it("prevents soft-deleting activities and notes from another workspace", async () => {
    const fx = currentFixture();

    await expect(crm.softDeleteActivity(fx.actorA, fx.recordsB.activity.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.softDeleteNote(fx.actorA, fx.recordsB.note.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not created.");
  return fixture;
}

function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addHours(value: Date, hours: number) {
  const date = new Date(value);
  date.setHours(date.getHours() + hours);
  return date;
}
