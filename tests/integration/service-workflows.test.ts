import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MembershipRole } from "@prisma/client";

import { classifyDealAttention } from "@/lib/deal-attention";
import { dealListStateOptions } from "@/lib/deal-list-state";
import { parseListViewState } from "@/lib/list-page-query";
import {
  dealValueCentsMax,
  goalTargetCentsMax,
  productIntColumnMax,
  sortOrderIntColumnMax,
  stageProbabilityMax,
  stageProbabilityMin
} from "@/lib/product-limits";
import { savedViewNameMaxLength } from "@/lib/saved-view-validation";
import type { AutomationTemplateId } from "@/lib/services/crm";
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

    await fx.prisma.user.update({
      where: { id: fx.userA.id },
      data: { deletedAt: new Date("2030-01-01T00:00:00.000Z") }
    });
    await expect(crm.listDeals(fx.actorA)).rejects.toMatchObject({ code: "FORBIDDEN" });

    await fx.prisma.workspace.update({
      where: { id: fx.workspaceB.id },
      data: { deletedAt: new Date("2030-01-02T00:00:00.000Z") }
    });
    await expect(crm.listDeals(fx.actorB)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps workspace creation inputs narrow at the service boundary", async () => {
    const fx = currentFixture();
    const malformedNameSlug = `malformed-workspace-name-${Date.now()}`;
    const slug = `service-boundary-workspace-${Date.now()}`;
    let createdWorkspaceId: string | undefined;

    await expect(
      crm.createWorkspace(fx.userA.id, {
        name: { text: "Malformed Workspace" },
        slug: malformedNameSlug
      } as never)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Workspace name is required."
    });
    await expect(fx.prisma.workspace.count({ where: { slug: malformedNameSlug } })).resolves.toBe(0);

    try {
      const created = await crm.createWorkspace(fx.userA.id, {
        name: "   Service Boundary Workspace   ",
        slug,
        deletedAt: new Date("2030-01-01T00:00:00.000Z"),
        memberships: {
          create: {
            userId: fx.userB.id,
            role: "ADMIN"
          }
        }
      } as never);
      createdWorkspaceId = created.id;

      const [workspace, memberships, pipelineCount] = await Promise.all([
        fx.prisma.workspace.findUniqueOrThrow({ where: { id: created.id } }),
        fx.prisma.workspaceMembership.findMany({
          where: { workspaceId: created.id },
          select: { role: true, userId: true }
        }),
        fx.prisma.pipeline.count({ where: { workspaceId: created.id } })
      ]);

      expect(workspace.name).toBe("Service Boundary Workspace");
      expect(workspace.slug).toBe(slug);
      expect(workspace.deletedAt).toBeNull();
      expect(memberships).toEqual([{ role: "OWNER", userId: fx.userA.id }]);
      expect(pipelineCount).toBeGreaterThan(0);
    } finally {
      if (createdWorkspaceId) {
        await fx.prisma.auditLog.deleteMany({ where: { workspaceId: createdWorkspaceId } });
        await fx.prisma.pipelineStage.deleteMany({ where: { workspaceId: createdWorkspaceId } });
        await fx.prisma.pipeline.deleteMany({ where: { workspaceId: createdWorkspaceId } });
        await fx.prisma.workspaceMembership.deleteMany({ where: { workspaceId: createdWorkspaceId } });
        await fx.prisma.workspace.deleteMany({ where: { id: createdWorkspaceId } });
      }
    }
  });

  it("creates workspace-scoped products and deal line items without changing deal value", async () => {
    const fx = currentFixture();
    const initialProductCount = await fx.prisma.product.count({ where: { workspaceId: fx.workspaceA.id } });
    await expect(crm.createProduct(fx.actorA, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Product name is required."
    });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "   ",
        unitPriceCents: 1000,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.createProduct(fx.actorA, {
        name: { text: "Malformed product" },
        unitPriceCents: 1000,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422, message: "Product name is required." });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "Invalid Price",
        unitPriceCents: -1,
        currency: "USD"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "Overflow Price",
        unitPriceCents: productIntColumnMax + 1,
        currency: "USD"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Product unit price is too large."
    });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "Invalid Currency",
        unitPriceCents: 1000,
        currency: "US"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "Invalid Currency Type",
        unitPriceCents: 1000,
        currency: { code: "USD" }
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422, message: "Currency must be a 3-letter code." });
    await expect(
      crm.createProduct(fx.actorA, {
        name: "Invalid Description Type",
        description: { text: "Malformed description" },
        unitPriceCents: 1000,
        currency: "USD"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Product description must be text."
    });
    await expect(fx.prisma.product.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      initialProductCount
    );
    const product = await crm.createProduct(fx.actorA, {
      name: "Implementation Package",
      description: "Fixed-fee onboarding",
      unitPriceCents: 125000,
      currency: "usd"
    });
    const maxPriceProduct = await crm.createProduct(fx.actorA, {
      name: "Maximum Price Package",
      description: "Boundary proof",
      unitPriceCents: productIntColumnMax,
      currency: "USD"
    });
    const otherWorkspaceProduct = await crm.createProduct(fx.actorB, {
      name: "Other Workspace Package",
      unitPriceCents: 9900,
      currency: "USD"
    });
    await expect(crm.updateProduct(fx.actorA, product.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Product name is required."
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
        name: "Overflow Price",
        unitPriceCents: productIntColumnMax + 1,
        currency: "USD"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Product unit price is too large."
    });
    await expect(
      crm.updateProduct(fx.actorA, product.id, {
        name: "Invalid Currency",
        unitPriceCents: 1000,
        currency: "US"
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    const productsA = await crm.listProducts(fx.actorA);
    const productsB = await crm.listProducts(fx.actorB);
    await expect(crm.setProductActive(fx.actorA, product.id, "false" as unknown as boolean)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Product active flag must be true or false."
    });
    await expect(fx.prisma.product.findUnique({ where: { id: product.id } })).resolves.toMatchObject({
      active: true
    });
    await expect(crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: product.id,
        quantity: productIntColumnMax + 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Line item quantity is too large."
    });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: maxPriceProduct.id,
        quantity: 2
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Line item total is too large."
    });
    const initialLineItemCount = await fx.prisma.dealLineItem.count({ where: { workspaceId: fx.workspaceA.id } });
    await expect(crm.createDealLineItem(fx.actorA, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Line item relation ids must be text."
    });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: { id: fx.recordsA.deal.id } as unknown as string,
        productId: product.id,
        quantity: 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Line item relation ids must be text."
    });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: { id: product.id } as unknown as string,
        quantity: 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Line item relation ids must be text."
    });
    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: product.id,
        quantity: 1,
        description: { text: "Malformed line item description" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Line item description must be text."
    });
    await expect(fx.prisma.dealLineItem.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      initialLineItemCount
    );
    const lineItem = await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 3
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const quoteDetail = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    await expect(crm.updateQuoteAdjustments(fx.actorA, quote.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Quote adjustments must be an object."
    });
    await expect(
      crm.updateQuoteAdjustments(fx.actorA, quote.id, {
        discountType: "FIXED",
        discountValue: "1000" as never
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Discount value must be a non-negative whole number."
    });
    await expect(
      crm.updateQuoteAdjustments(fx.actorA, quote.id, {
        discountType: "BOGUS" as unknown as "PERCENT",
        discountValue: 1000
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Discount type must be NONE, PERCENT, or FIXED."
    });
    await expect(
      crm.updateQuoteAdjustments(fx.actorA, quote.id, {
        taxType: "BOGUS" as unknown as "PERCENT",
        taxValue: 1000
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Tax type must be NONE, PERCENT, or FIXED."
    });
    await expect(fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).resolves.toMatchObject({
      discountType: "NONE",
      discountValue: 0,
      discountCents: 0,
      taxType: "NONE",
      taxValue: 0,
      taxCents: 0,
      totalCents: 375000
    });
    const adjustedQuote = await crm.updateQuoteAdjustments(fx.actorA, quote.id, {
      discountType: "PERCENT",
      discountValue: 1000,
      taxType: "PERCENT",
      taxValue: 500
    });
    const quoteAdjustmentAuditCountBeforeDuplicate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.adjustments_updated"
      }
    });
    const duplicateAdjustedQuote = await crm.updateQuoteAdjustments(fx.actorA, quote.id, {
      discountType: "PERCENT",
      discountValue: 1000,
      taxType: "PERCENT",
      taxValue: 500
    });
    const quoteAdjustmentAuditCountAfterDuplicate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.adjustments_updated"
      }
    });
    await expect(crm.createQuotePublicLink(fx.actorA, quote.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const staleDraftPublicLink = await fx.prisma.quotePublicLink.create({
      data: {
        workspaceId: fx.workspaceA.id,
        quoteId: quote.id,
        token: crm.generatePublicQuoteToken()
      }
    });
    await expect(crm.getPublicQuoteByToken(staleDraftPublicLink.token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.acceptPublicQuoteByToken(staleDraftPublicLink.token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await fx.prisma.quotePublicLink.update({
      where: { id: staleDraftPublicLink.id },
      data: { revokedAt: new Date("2029-01-01T00:00:00.000Z") }
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
    await expect(crm.acceptPublicQuoteByToken("short")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.updateQuoteStatus(fx.actorA, quote.id, "ARCHIVED" as unknown as "SENT")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Quote status must be SENT, ACCEPTED, or DECLINED."
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
    await expect(crm.getPublicQuoteByToken(expiredLink.token)).rejects.toMatchObject({
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
    const publicAcceptance = await crm.acceptPublicQuoteByToken(regeneratedPublicLink.token);
    const acceptedQuote = publicAcceptance.quote;
    const repeatPublicAcceptance = await crm.acceptPublicQuoteByToken(regeneratedPublicLink.token);
    const internalAcceptedQuote = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    await expect(crm.createQuotePublicLink(fx.actorA, quote.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(crm.updateQuoteStatus(fx.actorA, quote.id, "DECLINED")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const acceptedAdjustmentAuditCountBefore = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.adjustments_updated"
      }
    });
    await expect(
      crm.updateQuoteAdjustments(fx.actorA, quote.id, {
        discountType: "FIXED",
        discountValue: 1000
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Quote adjustments can only be edited while the quote is DRAFT."
    });
    const acceptedQuoteAfterBlockedAdjustment = await fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const acceptedAdjustmentAuditCountAfter = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.adjustments_updated"
      }
    });
    const updatedProduct = await crm.updateProduct(fx.actorA, product.id, {
      name: " Implementation Package Updated ",
      description: " Updated onboarding ",
      unitPriceCents: 150000,
      currency: "eur"
    });
    const productUpdateAuditCountBeforeNoop = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, entityId: product.id, entityType: "Product", action: "product.updated" }
    });
    const noopUpdatedProduct = await crm.updateProduct(fx.actorA, product.id, {
      name: " Implementation Package Updated ",
      description: " Updated onboarding ",
      unitPriceCents: 150000,
      currency: "eur"
    });
    const productRowAfterNoopUpdate = await fx.prisma.product.findUniqueOrThrow({
      where: { id: product.id }
    });
    const productUpdateAuditCountAfterNoop = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, entityId: product.id, entityType: "Product", action: "product.updated" }
    });
    const deactivatedProduct = await crm.setProductActive(fx.actorA, product.id, false);
    const productDeactivateAuditCountBeforeDuplicate = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, entityId: product.id, entityType: "Product", action: "product.deactivated" }
    });
    const duplicateDeactivatedProduct = await crm.setProductActive(fx.actorA, product.id, false);
    const productDeactivateAuditCountAfterDuplicate = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, entityId: product.id, entityType: "Product", action: "product.deactivated" }
    });
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
    expect(duplicateAdjustedQuote).toMatchObject({
      discountType: "PERCENT",
      discountValue: 1000,
      discountCents: 37500,
      taxType: "PERCENT",
      taxValue: 500,
      taxCents: 16875,
      totalCents: 354375
    });
    expect(quoteAdjustmentAuditCountBeforeDuplicate).toBe(1);
    expect(quoteAdjustmentAuditCountAfterDuplicate).toBe(quoteAdjustmentAuditCountBeforeDuplicate);
    expect(publicLink.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(publicLink.token.length).toBeGreaterThanOrEqual(32);
    expect(repeatedPublicLink.id).toBe(publicLink.id);
    expect(regeneratedPublicLink.id).not.toBe(publicLink.id);
    expect(regeneratedPublicLink.token).not.toBe(publicLink.token);
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
    expect(regeneratedPublicQuote.id).toBe(quote.id);
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
    expect(acceptedQuoteAfterBlockedAdjustment).toMatchObject({
      status: "ACCEPTED",
      discountType: "PERCENT",
      discountValue: 1000,
      discountCents: 37500,
      taxType: "PERCENT",
      taxValue: 500,
      taxCents: 16875,
      totalCents: 354375
    });
    expect(acceptedAdjustmentAuditCountBefore).toBe(quoteAdjustmentAuditCountAfterDuplicate);
    expect(acceptedAdjustmentAuditCountAfter).toBe(acceptedAdjustmentAuditCountBefore);
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
    expect(noopUpdatedProduct).toMatchObject({
      name: "Implementation Package Updated",
      description: "Updated onboarding",
      unitPriceCents: 150000,
      currency: "EUR"
    });
    expect(noopUpdatedProduct.updatedAt.toISOString()).toBe(updatedProduct.updatedAt.toISOString());
    expect(productRowAfterNoopUpdate.updatedAt.toISOString()).toBe(updatedProduct.updatedAt.toISOString());
    expect(productUpdateAuditCountBeforeNoop).toBe(1);
    expect(productUpdateAuditCountAfterNoop).toBe(productUpdateAuditCountBeforeNoop);
    expect(deactivatedProduct.active).toBe(false);
    expect(duplicateDeactivatedProduct.active).toBe(false);
    expect(productDeactivateAuditCountBeforeDuplicate).toBe(1);
    expect(productDeactivateAuditCountAfterDuplicate).toBe(productDeactivateAuditCountBeforeDuplicate);
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
    expect(dealWithLineItems.valueCents).toBe(354375);
    expect(reportAfterLineItem.metrics.openPipelineValueCents).toBe(354375);
    const dealAfterPublicAcceptance = await crm.getDeal(fx.actorA, fx.recordsA.deal.id);
    expect(dealAfterPublicAcceptance.valueCents).toBe(354375);
    const syncResult = await crm.syncAcceptedQuoteToDealValue(fx.actorA, quote.id);
    const repeatSyncResult = await crm.syncAcceptedQuoteToDealValue(fx.actorA, quote.id);
    const dealAfterSync = await crm.getDeal(fx.actorA, fx.recordsA.deal.id);
    const reportAfterSync = await crm.getDealReport(fx.actorA);
    expect(syncResult).toMatchObject({
      synced: false,
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
    await expect(
      crm.reviewQuoteDealValueSync(fx.actorB, quote.id, { resolution: "KEEP_CURRENT_DEAL" })
    ).rejects.toMatchObject({
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
    const declinedPublicLink = await crm.createQuotePublicLink(fx.actorA, declinedQuote.id);
    await expect(crm.syncAcceptedQuoteToDealValue(fx.actorA, declinedQuote.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    const terminalDeclinedQuote = await crm.updateQuoteStatus(fx.actorA, declinedQuote.id, "DECLINED");
    const terminalDeclinedPublicQuote = await crm.getPublicQuoteByToken(declinedPublicLink.token);
    await expect(crm.createQuotePublicLink(fx.actorA, declinedQuote.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
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
    expect(declinedQuote.number).toBe("Q-0002");
    expect(terminalDeclinedQuote.status).toBe("DECLINED");
    expect(terminalDeclinedPublicQuote.status).toBe("DECLINED");

    const reactivatedProduct = await crm.setProductActive(fx.actorA, product.id, true);
    const productReactivateAuditCountBeforeDuplicate = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, entityId: product.id, entityType: "Product", action: "product.reactivated" }
    });
    const duplicateReactivatedProduct = await crm.setProductActive(fx.actorA, product.id, true);
    const productReactivateAuditCountAfterDuplicate = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, entityId: product.id, entityType: "Product", action: "product.reactivated" }
    });
    const newLineItem = await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    expect(reactivatedProduct.active).toBe(true);
    expect(duplicateReactivatedProduct.active).toBe(true);
    expect(productReactivateAuditCountBeforeDuplicate).toBe(1);
    expect(productReactivateAuditCountAfterDuplicate).toBe(productReactivateAuditCountBeforeDuplicate);
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
      publicLinkId: regeneratedPublicLink.id,
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

  it("allocates unique workspace quote numbers for parallel draft creation", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Concurrency Package",
      unitPriceCents: 25000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });

    const quotes = await Promise.all(Array.from({ length: 4 }, () => crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id)));
    const quoteNumbers = quotes.map((quote) => quote.number).sort();

    expect(new Set(quoteNumbers).size).toBe(4);
    expect(quoteNumbers).toEqual(["Q-0001", "Q-0002", "Q-0003", "Q-0004"]);
  });

  it("rejects quote drafts when individually valid line items overflow the aggregate subtotal", async () => {
    const fx = currentFixture();
    const maxProduct = await crm.createProduct(fx.actorA, {
      name: "Quote subtotal max package",
      unitPriceCents: productIntColumnMax,
      currency: "USD"
    });
    const oneCentProduct = await crm.createProduct(fx.actorA, {
      name: "Quote subtotal penny package",
      unitPriceCents: 1,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: maxProduct.id,
      quantity: 1
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: oneCentProduct.id,
      quantity: 1
    });
    const quoteCountBefore = await fx.prisma.quote.count({ where: { dealId: fx.recordsA.deal.id } });
    const quoteItemCountBefore = await fx.prisma.quoteItem.count({ where: { workspaceId: fx.workspaceA.id } });

    await expect(crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Quote subtotal is too large."
    });
    await expect(fx.prisma.quote.count({ where: { dealId: fx.recordsA.deal.id } })).resolves.toBe(quoteCountBefore);
    await expect(fx.prisma.quoteItem.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      quoteItemCountBefore
    );
  });

  it("returns one active public quote link under concurrent generation", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Concurrent Public Link Package",
      unitPriceCents: 51500,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");

    const publicLinks = await Promise.all(Array.from({ length: 8 }, () => crm.createQuotePublicLink(fx.actorA, quote.id)));
    const activePublicLinkCount = await fx.prisma.quotePublicLink.count({
      where: {
        quoteId: quote.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    });
    const publicLinkCreatedAuditCount = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.public_link_created"
      }
    });

    expect(new Set(publicLinks.map((link) => link.id)).size).toBe(1);
    expect(new Set(publicLinks.map((link) => link.token)).size).toBe(1);
    expect(activePublicLinkCount).toBe(1);
    expect(publicLinkCreatedAuditCount).toBe(1);
  });

  it("accepts public quote links idempotently under concurrent submissions", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Race Acceptance Package",
      unitPriceCents: 40000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    const publicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);

    const results = await Promise.all([
      crm.acceptPublicQuoteByToken(publicLink.token),
      crm.acceptPublicQuoteByToken(publicLink.token)
    ]);
    const acceptedQuote = await fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
    const publicAcceptedAuditCount = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.public_accepted"
      }
    });

    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(results.filter((result) => result.alreadyAccepted)).toHaveLength(1);
    expect(results.every((result) => result.quote.id === quote.id)).toBe(true);
    expect(acceptedQuote.status).toBe("ACCEPTED");
    expect(publicAcceptedAuditCount).toBe(1);
  });

  it("auto-syncs accepted quote totals to the deal when the deal value is unchanged since send", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Auto Sync Acceptance Package",
      unitPriceCents: 175000,
      currency: "USD"
    });
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Auto sync accepted quote deal",
      valueCents: 50000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED");

    const [syncedDeal, acceptedQuote, syncAuditCount] = await Promise.all([
      fx.prisma.deal.findUniqueOrThrow({ where: { id: deal.id } }),
      fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Deal",
          entityId: deal.id,
          action: "deal.value_synced_from_quote"
        }
      })
    ]);

    expect(syncedDeal).toMatchObject({ valueCents: 175000, currency: "USD" });
    expect(acceptedQuote.status).toBe("ACCEPTED");
    expect(acceptedQuote.sentDealValueCents).toBe(50000);
    expect(acceptedQuote.sentDealCurrency).toBe("USD");
    expect(acceptedQuote.dealValueSyncedAt).toBeTruthy();
    expect(acceptedQuote.dealValueSyncConflict).toBeNull();
    expect(syncAuditCount).toBe(1);
  });

  it("surfaces an accepted quote sync conflict when the deal changed after send", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Changed Deal Conflict Package",
      unitPriceCents: 210000,
      currency: "USD"
    });
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Changed after sent deal",
      valueCents: 80000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await fx.prisma.deal.update({
      where: { id: deal.id },
      data: { valueCents: 99000 }
    });

    await crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED");
    const [unchangedDeal, acceptedQuote, syncAuditCount, conflictAuditCount] = await Promise.all([
      fx.prisma.deal.findUniqueOrThrow({ where: { id: deal.id } }),
      fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Deal",
          entityId: deal.id,
          action: "deal.value_synced_from_quote"
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Quote",
          entityId: quote.id,
          action: "quote.deal_value_sync_conflict"
        }
      })
    ]);

    expect(unchangedDeal.valueCents).toBe(99000);
    expect(acceptedQuote.status).toBe("ACCEPTED");
    expect(acceptedQuote.dealValueSyncedAt).toBeNull();
    expect(acceptedQuote.dealValueSyncConflict).toContain("Deal value changed after this quote was sent");
    expect(syncAuditCount).toBe(0);
    expect(conflictAuditCount).toBe(1);
  });

  it("reviews a quote sync conflict without overwriting the current deal value", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Keep Current Conflict Package",
      unitPriceCents: 240000,
      currency: "USD"
    });
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Keep current reviewed conflict",
      valueCents: 70000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await fx.prisma.deal.update({
      where: { id: deal.id },
      data: { valueCents: 99000 }
    });
    await crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED");

    const firstReview = await crm.reviewQuoteDealValueSync(fx.actorA, quote.id, { resolution: "KEEP_CURRENT_DEAL" });
    const duplicateReview = await crm.reviewQuoteDealValueSync(fx.actorA, quote.id, { resolution: "KEEP_CURRENT_DEAL" });
    const [reviewedDeal, reviewedQuote, reviewAuditCount, dealSyncAuditCount] = await Promise.all([
      fx.prisma.deal.findUniqueOrThrow({ where: { id: deal.id } }),
      fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Quote",
          entityId: quote.id,
          action: "quote.deal_value_sync_reviewed"
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Deal",
          entityId: deal.id,
          action: "deal.value_synced_from_quote"
        }
      })
    ]);

    expect(firstReview).toMatchObject({ reviewed: true, synced: false });
    expect(duplicateReview).toMatchObject({ reviewed: false, synced: false });
    expect(reviewedDeal.valueCents).toBe(99000);
    expect(reviewedQuote.dealValueSyncedAt).toBeNull();
    expect(reviewedQuote.dealValueSyncReviewedAt).toBeTruthy();
    expect(reviewedQuote.dealValueSyncResolution).toBe("KEEP_CURRENT_DEAL");
    expect(reviewedQuote.dealValueSyncConflict).toContain("Deal value changed after this quote was sent");
    expect(reviewAuditCount).toBe(1);
    expect(dealSyncAuditCount).toBe(0);
  });

  it("requires confirmation before updating the deal from a reviewed quote sync conflict", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Confirmed Conflict Update Package",
      unitPriceCents: 310000,
      currency: "USD"
    });
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Confirmed conflict update",
      valueCents: 125000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await fx.prisma.deal.update({
      where: { id: deal.id },
      data: { valueCents: 175000 }
    });
    await crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED");

    await expect(
      crm.reviewQuoteDealValueSync(fx.actorA, quote.id, { resolution: "UPDATE_DEAL_TO_QUOTE" })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });

    const reviewed = await crm.reviewQuoteDealValueSync(fx.actorA, quote.id, {
      resolution: "UPDATE_DEAL_TO_QUOTE",
      confirmation: "UPDATE_DEAL_TO_ACCEPTED_QUOTE"
    });
    const duplicateReview = await crm.reviewQuoteDealValueSync(fx.actorA, quote.id, {
      resolution: "UPDATE_DEAL_TO_QUOTE",
      confirmation: "UPDATE_DEAL_TO_ACCEPTED_QUOTE"
    });
    const [updatedDeal, updatedQuote, dealSyncAuditCount, reviewAuditEvents, detailedQuote] = await Promise.all([
      fx.prisma.deal.findUniqueOrThrow({ where: { id: deal.id } }),
      fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Deal",
          entityId: deal.id,
          action: "deal.value_synced_from_quote"
        }
      }),
      fx.prisma.auditLog.findMany({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Quote",
          entityId: quote.id,
          action: "quote.deal_value_sync_reviewed"
        }
      }),
      crm.getQuote(fx.actorA, deal.id, quote.id)
    ]);

    expect(reviewed).toMatchObject({ reviewed: true, synced: true });
    expect(duplicateReview).toMatchObject({ reviewed: false, synced: true });
    expect(updatedDeal).toMatchObject({ valueCents: 310000, currency: "USD" });
    expect(updatedQuote.sentDealValueCents).toBe(125000);
    expect(updatedQuote.dealValueSyncedAt).toBeTruthy();
    expect(updatedQuote.dealValueSyncReviewedAt).toBeTruthy();
    expect(updatedQuote.dealValueSyncResolution).toBe("UPDATE_DEAL_TO_QUOTE");
    expect(dealSyncAuditCount).toBe(1);
    expect(reviewAuditEvents).toHaveLength(1);
    expect(reviewAuditEvents[0]?.metadata).toMatchObject({
      changedDealValue: true,
      previousDealValueCents: 175000,
      acceptedQuoteTotalCents: 310000,
      resolution: "UPDATE_DEAL_TO_QUOTE"
    });
    expect(detailedQuote.auditLogs.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "quote.sent",
        "quote.accepted",
        "quote.deal_value_sync_conflict",
        "quote.deal_value_sync_reviewed",
        "deal.value_synced_from_quote"
      ])
    );
  });

  it("keeps public double acceptance idempotent while auto-syncing the deal only once", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Public Auto Sync Package",
      unitPriceCents: 66000,
      currency: "USD"
    });
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Public auto sync deal",
      valueCents: 1000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    const publicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);

    const [first, second] = await Promise.all([
      crm.acceptPublicQuoteByToken(publicLink.token),
      crm.acceptPublicQuoteByToken(publicLink.token)
    ]);
    const [syncedDeal, acceptedQuote, dealSyncAuditCount, publicAcceptedAuditCount] = await Promise.all([
      fx.prisma.deal.findUniqueOrThrow({ where: { id: deal.id } }),
      fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Deal",
          entityId: deal.id,
          action: "deal.value_synced_from_quote"
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Quote",
          entityId: quote.id,
          action: "quote.public_accepted"
        }
      })
    ]);

    expect([first.accepted, second.accepted].filter(Boolean)).toHaveLength(1);
    expect([first.alreadyAccepted, second.alreadyAccepted].filter(Boolean)).toHaveLength(1);
    expect(syncedDeal.valueCents).toBe(66000);
    expect(acceptedQuote.dealValueSyncedAt).toBeTruthy();
    expect(dealSyncAuditCount).toBe(1);
    expect(publicAcceptedAuditCount).toBe(1);
  });

  it("edits draft quote snapshot items without changing deal line items and locks accepted snapshots", async () => {
    const fx = currentFixture();
    const baseProduct = await crm.createProduct(fx.actorA, {
      name: "Draft Snapshot Base Package",
      unitPriceCents: 30000,
      currency: "USD"
    });
    const addOnProduct = await crm.createProduct(fx.actorA, {
      name: "Draft Snapshot Add-on",
      unitPriceCents: 12000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: baseProduct.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const added = await crm.createQuoteItem(fx.actorA, quote.id, {
      productId: addOnProduct.id,
      quantity: 2,
      description: "Quote-only add-on"
    });
    const updated = await crm.updateQuoteItem(fx.actorA, added.item.id, {
      quantity: 3,
      description: "Reviewed quote-only add-on"
    });
    const dealLineItemsBeforeRemove = await fx.prisma.dealLineItem.count({ where: { dealId: fx.recordsA.deal.id } });
    await crm.removeQuoteItem(fx.actorA, updated.item.id);
    const quoteAfterRemove = await fx.prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
      include: { items: true }
    });
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED");

    await expect(
      crm.createQuoteItem(fx.actorA, quote.id, { productId: addOnProduct.id, quantity: 1 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(crm.updateQuoteItem(fx.actorA, quote.items[0]?.id ?? "", { quantity: 2 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(crm.removeQuoteItem(fx.actorA, quote.items[0]?.id ?? "")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422
    });
    await expect(fx.prisma.dealLineItem.count({ where: { dealId: fx.recordsA.deal.id } })).resolves.toBe(
      dealLineItemsBeforeRemove
    );
    const detailedQuote = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    expect(detailedQuote.auditLogs.map((event) => event.action)).toEqual(
      expect.arrayContaining(["quote_item.created", "quote_item.updated", "quote_item.removed"])
    );
    expect(
      detailedQuote.auditLogs
        .filter((event) => event.action.startsWith("quote_item."))
        .every((event) => (event.metadata as { quoteId?: string } | null)?.quoteId === quote.id)
    ).toBe(true);
    expect(added.quote.totalCents).toBe(54000);
    expect(updated.quote.totalCents).toBe(66000);
    expect(quoteAfterRemove.items).toHaveLength(1);
    expect(quoteAfterRemove.totalCents).toBe(30000);
  });

  it("keeps quote item mutations workspace-scoped", async () => {
    const fx = currentFixture();
    const productA = await crm.createProduct(fx.actorA, {
      name: "Scoped Quote Item Product A",
      unitPriceCents: 45000,
      currency: "USD"
    });
    const productB = await crm.createProduct(fx.actorB, {
      name: "Scoped Quote Item Product B",
      unitPriceCents: 45000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: productA.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const quoteItemId = quote.items[0]?.id ?? "";

    await expect(crm.createQuoteItem(fx.actorB, quote.id, { productId: productB.id, quantity: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.updateQuoteItem(fx.actorB, quoteItemId, { quantity: 2 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.removeQuoteItem(fx.actorB, quoteItemId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
  });

  it("rejects public quote tokens when persisted workspace relationships are inconsistent", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Boundary Package",
      unitPriceCents: 125000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quoteWithMismatchedLink = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await crm.updateQuoteStatus(fx.actorA, quoteWithMismatchedLink.id, "SENT");
    const mismatchedLink = await fx.prisma.quotePublicLink.create({
      data: {
        workspaceId: fx.workspaceB.id,
        quoteId: quoteWithMismatchedLink.id,
        token: crm.generatePublicQuoteToken()
      }
    });

    await expect(crm.getPublicQuoteByToken(mismatchedLink.token)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(crm.acceptPublicQuoteByToken(mismatchedLink.token)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    const quoteWithMismatchedDeal = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await crm.updateQuoteStatus(fx.actorA, quoteWithMismatchedDeal.id, "SENT");
    const mismatchedDealLink = await crm.createQuotePublicLink(fx.actorA, quoteWithMismatchedDeal.id);
    await fx.prisma.quote.update({
      where: { id: quoteWithMismatchedDeal.id },
      data: { dealId: fx.recordsB.deal.id }
    });

    await expect(crm.getPublicQuoteByToken(mismatchedDealLink.token)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(crm.acceptPublicQuoteByToken(mismatchedDealLink.token)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    const [firstQuote, secondQuote, badWorkspaceAuditCount] = await Promise.all([
      fx.prisma.quote.findUniqueOrThrow({ where: { id: quoteWithMismatchedLink.id } }),
      fx.prisma.quote.findUniqueOrThrow({ where: { id: quoteWithMismatchedDeal.id } }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceB.id,
          action: "quote.public_accepted",
          entityId: { in: [quoteWithMismatchedLink.id, quoteWithMismatchedDeal.id] }
        }
      })
    ]);
    expect(firstQuote.status).toBe("SENT");
    expect(secondQuote.status).toBe("SENT");
    expect(badWorkspaceAuditCount).toBe(0);
  });

  it("rejects public quote tokens after the owning workspace is deleted", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Deleted Workspace Quote Package",
      unitPriceCents: 75000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    const publicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);
    await fx.prisma.workspace.update({
      where: { id: fx.workspaceA.id },
      data: { deletedAt: new Date("2030-01-03T00:00:00.000Z") }
    });

    await expect(crm.getPublicQuoteByToken(publicLink.token)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(crm.acceptPublicQuoteByToken(publicLink.token)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    await expect(fx.prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).resolves.toMatchObject({
      status: "SENT"
    });
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityId: quote.id,
          action: "quote.public_accepted"
        }
      })
    ).resolves.toBe(0);
  });

  it("scopes quote snapshots, quote items, and quote deal labels when persisted relations are inconsistent", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Scoped Quote Package",
      unitPriceCents: 50000,
      currency: "USD"
    });
    const lineItem = await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const crossWorkspaceLineItem = await fx.prisma.dealLineItem.create({
      data: {
        workspaceId: fx.workspaceB.id,
        dealId: fx.recordsA.deal.id,
        productName: "Cross Workspace Deal Line Item",
        quantity: 1,
        unitPriceCents: 9900,
        currency: "USD",
        lineTotalCents: 9900
      }
    });
    await fx.prisma.deal.update({
      where: { id: fx.recordsA.deal.id },
      data: {
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id
      }
    });

    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const crossWorkspaceQuoteItem = await fx.prisma.quoteItem.create({
      data: {
        workspaceId: fx.workspaceB.id,
        quoteId: quote.id,
        name: "Cross Workspace Quote Item",
        quantity: 1,
        unitPriceCents: 12345,
        currency: "USD",
        lineTotalCents: 12345
      }
    });
    const staleQuoteDealActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        personId: fx.recordsB.person.id,
        type: "TASK",
        title: "Stale quote deal next activity",
        dueAt: new Date("2030-01-02T09:00:00.000Z")
      }
    });
    const quoteDetail = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    const publicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);
    const publicQuote = await crm.getPublicQuoteByToken(publicLink.token);

    expect(quote.items.map((item) => item.dealLineItemId)).toEqual([lineItem.id]);
    expect(quote.items.map((item) => item.dealLineItemId)).not.toContain(crossWorkspaceLineItem.id);
    expect(quote.items.map((item) => item.name)).not.toContain("Cross Workspace Deal Line Item");
    expect(quote.subtotalCents).toBe(50000);
    expect(quoteDetail.items.map((item) => item.id)).not.toContain(crossWorkspaceQuoteItem.id);
    expect(quoteDetail.items.map((item) => item.name)).toEqual(["Scoped Quote Package"]);
    expect(quoteDetail.deal.person).toBeNull();
    expect(quoteDetail.deal.organization).toBeNull();
    expect(quoteDetail.deal.activities.map((activity) => activity.id)).not.toContain(staleQuoteDealActivity.id);
    expect(publicQuote.items.map((item) => item.id)).not.toContain(crossWorkspaceQuoteItem.id);
    expect(publicQuote.items.map((item) => item.name)).toEqual(["Scoped Quote Package"]);
    expect(publicQuote.deal.person).toBeNull();
    expect(publicQuote.deal.organization).toBeNull();
  });

  it("omits soft-deleted customer labels from internal and public quote reads", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Soft Deleted Quote Customer Package",
      unitPriceCents: 64000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    const publicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);
    await fx.prisma.person.update({
      where: { id: fx.recordsA.person.id },
      data: { deletedAt: new Date("2030-03-01T00:00:00.000Z") }
    });
    await fx.prisma.organization.update({
      where: { id: fx.recordsA.organization.id },
      data: { deletedAt: new Date("2030-03-01T00:00:00.000Z") }
    });

    const quoteDetail = await crm.getQuote(fx.actorA, fx.recordsA.deal.id, quote.id);
    const publicQuote = await crm.getPublicQuoteByToken(publicLink.token);

    expect(quoteDetail.deal.person).toBeNull();
    expect(quoteDetail.deal.organization).toBeNull();
    expect(publicQuote.deal.person).toBeNull();
    expect(publicQuote.deal.organization).toBeNull();
  });

  it("keeps dashboard and deal attention signals scoped when related rows are inconsistent", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Dashboard Boundary Package",
      unitPriceCents: 42000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const activeQuote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const boundaryDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      title: "Dashboard boundary no next",
      valueCents: 180000,
      currency: "USD"
    });
    await fx.prisma.deal.update({
      where: { id: boundaryDeal.id },
      data: {
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id
      }
    });
    const staleQuoteDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      title: "Dashboard stale quote deal",
      valueCents: 99000,
      currency: "USD"
    });
    const staleQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: staleQuoteDeal.id,
        number: "Q-DASHBOARD-STALE",
        currency: "USD",
        subtotalCents: 1000,
        totalCents: 1000
      }
    });
    await fx.prisma.deal.update({
      where: { id: staleQuoteDeal.id },
      data: { deletedAt: new Date("2030-01-01T00:00:00.000Z") }
    });
    const crossWorkspaceActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceB.id,
        ownerId: fx.userB.id,
        dealId: boundaryDeal.id,
        type: "TASK",
        title: "Cross-workspace next activity",
        dueAt: new Date("2030-01-02T09:00:00.000Z")
      }
    });
    const staleSameWorkspaceActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: boundaryDeal.id,
        personId: fx.recordsB.person.id,
        type: "TASK",
        title: "Stale same-workspace pipeline next activity",
        dueAt: new Date("2030-01-02T10:00:00.000Z")
      }
    });
    const staleSameWorkspaceNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        dealId: boundaryDeal.id,
        organizationId: fx.recordsB.organization.id,
        body: "Stale same-workspace pipeline note"
      }
    });
    const staleSameWorkspaceEmailLog = await fx.prisma.emailLog.create({
      data: {
        workspaceId: fx.workspaceA.id,
        createdById: fx.userA.id,
        dealId: boundaryDeal.id,
        organizationId: fx.recordsB.organization.id,
        direction: "INBOUND",
        occurredAt: new Date("2030-01-02T10:30:00.000Z"),
        subject: "Stale same-workspace pipeline email",
        body: "This stale email should not change assistant or pipeline signals."
      }
    });
    const crossWorkspaceQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceB.id,
        dealId: boundaryDeal.id,
        number: "Q-DASHBOARD-CROSS",
        status: "SENT",
        currency: "USD",
        subtotalCents: 2500,
        totalCents: 2500
      }
    });

    const [summary, dealPage, pipelines, dealDetail, attentionItems] = await Promise.all([
      crm.getDashboardSummary(fx.actorA, new Date("2030-01-02T12:00:00.000Z")),
      crm.listDealsPage(fx.actorA, { q: "Dashboard boundary no next" }, { page: 1, pageSize: 10 }),
      crm.listPipelines(fx.actorA),
      crm.getDeal(fx.actorA, boundaryDeal.id),
      crm.getNeedsAttentionSummary(fx.actorA, new Date("2030-01-02T12:00:00.000Z"))
    ]);
    const pipelineDeal = pipelines
      .flatMap((pipeline) => pipeline.stages.flatMap((stage) => stage.deals))
      .find((deal) => deal.id === boundaryDeal.id);

    expect(summary.onboarding.counts.quotes).toBe(1);
    expect(summary.recentQuotes.map((quote) => quote.id)).toContain(activeQuote.id);
    expect(summary.recentQuotes.map((quote) => quote.id)).not.toEqual(
      expect.arrayContaining([staleQuote.id, crossWorkspaceQuote.id])
    );
    expect(summary.pipelineHealth.openDealsWithoutNextActivity).toBe(2);
    expect(dealPage.items[0]?.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(dealPage.items[0]?.activities).toHaveLength(0);
    expect(pipelineDeal).toMatchObject({ person: null, organization: null });
    expect(pipelineDeal?.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(pipelineDeal?.activities.map((activity) => activity.id)).not.toContain(staleSameWorkspaceActivity.id);
    expect(pipelineDeal?.notes.map((note) => note.id)).not.toContain(staleSameWorkspaceNote.id);
    expect(pipelineDeal?.emailLogs.map((emailLog) => emailLog.id)).not.toContain(staleSameWorkspaceEmailLog.id);
    expect(pipelineDeal?.quotes.map((quote) => quote.id)).not.toContain(crossWorkspaceQuote.id);
    expect(pipelineDeal?.activities).toHaveLength(0);
    expect(pipelineDeal?.notes).toHaveLength(0);
    expect(pipelineDeal?.emailLogs).toHaveLength(0);
    expect(pipelineDeal?.quotes).toHaveLength(0);
    expect(dealDetail.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(dealDetail.quotes.map((quote) => quote.id)).not.toContain(crossWorkspaceQuote.id);
    expect(attentionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionHref: `/deals/${boundaryDeal.id}#add-activity`,
          href: `/deals/${boundaryDeal.id}`,
          kind: "deal-no-next-activity",
          title: "Dashboard boundary no next"
        })
      ])
    );
  });

  it("keeps contact, organization, and lead relation reads scoped when related rows are inconsistent", async () => {
    const fx = currentFixture();
    const crossWorkspaceActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceB.id,
        ownerId: fx.userB.id,
        leadId: fx.recordsA.lead.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        type: "TASK",
        title: "Cross-workspace contact lead activity",
        dueAt: new Date("2029-01-01T09:00:00.000Z")
      }
    });
    const crossWorkspaceNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceB.id,
        authorId: fx.userB.id,
        leadId: fx.recordsA.lead.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        body: "Cross-workspace note should not appear on workspace A records."
      }
    });
    const crossWorkspacePerson = await fx.prisma.person.create({
      data: {
        workspaceId: fx.workspaceB.id,
        ownerId: fx.userB.id,
        organizationId: fx.recordsA.organization.id,
        firstName: "Cross",
        lastName: "Workspace",
        email: "cross-workspace-person@example.test"
      }
    });
    const crossWorkspaceDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceB.id,
        pipelineId: fx.recordsB.pipeline.id,
        stageId: fx.recordsB.stageOne.id,
        ownerId: fx.userB.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "Cross-workspace linked deal",
        valueCents: 45000,
        currency: "USD"
      }
    });

    const [peoplePage, personDetail, organizationsPage, organizationDetail, leadsPage, leadDetail] = await Promise.all([
      crm.listPeoplePage(fx.actorA, { q: fx.recordsA.person.email ?? "" }, { page: 1, pageSize: 10 }),
      crm.getPerson(fx.actorA, fx.recordsA.person.id),
      crm.listOrganizationsPage(fx.actorA, { q: fx.recordsA.organization.name }, { page: 1, pageSize: 10 }),
      crm.getOrganization(fx.actorA, fx.recordsA.organization.id),
      crm.listLeadsPage(fx.actorA, { q: fx.recordsA.lead.title }, { page: 1, pageSize: 10 }),
      crm.getLead(fx.actorA, fx.recordsA.lead.id)
    ]);
    const listedPerson = peoplePage.items.find((person) => person.id === fx.recordsA.person.id);
    const listedOrganization = organizationsPage.items.find((organization) => organization.id === fx.recordsA.organization.id);
    const listedLead = leadsPage.items.find((lead) => lead.id === fx.recordsA.lead.id);

    expect(listedPerson?.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(personDetail.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(personDetail.notes.map((note) => note.id)).not.toContain(crossWorkspaceNote.id);
    expect(personDetail.deals.map((deal) => deal.id)).not.toContain(crossWorkspaceDeal.id);
    expect(personDetail.deals.map((deal) => deal.id)).toContain(fx.recordsA.deal.id);

    expect(listedOrganization?.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(listedOrganization?._count).toMatchObject({ people: 1, deals: 1 });
    expect(organizationDetail.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(organizationDetail.notes.map((note) => note.id)).not.toContain(crossWorkspaceNote.id);
    expect(organizationDetail.people.map((person) => person.id)).not.toContain(crossWorkspacePerson.id);
    expect(organizationDetail.deals.map((deal) => deal.id)).not.toContain(crossWorkspaceDeal.id);
    expect(organizationDetail.people.map((person) => person.id)).toContain(fx.recordsA.person.id);
    expect(organizationDetail.deals.map((deal) => deal.id)).toContain(fx.recordsA.deal.id);

    expect(listedLead?.activities.map((activity) => activity.id)).toEqual([fx.recordsA.activity.id]);
    expect(leadDetail.activities.map((activity) => activity.id)).toContain(fx.recordsA.activity.id);
    expect(leadDetail.activities.map((activity) => activity.id)).not.toContain(crossWorkspaceActivity.id);
    expect(leadDetail.notes.map((note) => note.id)).toContain(fx.recordsA.note.id);
    expect(leadDetail.notes.map((note) => note.id)).not.toContain(crossWorkspaceNote.id);
  });

  it("omits cross-workspace direct relation labels from CRM list and detail reads", async () => {
    const fx = currentFixture();
    const betaPersonName = `${fx.recordsB.person.firstName} ${fx.recordsB.person.lastName}`;
    const corruptedDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        title: "Alpha direct relation boundary deal",
        valueCents: 15000,
        currency: "USD"
      }
    });
    const missingActivityDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        title: "Alpha missing relation boundary deal",
        valueCents: 25000,
        currency: "USD"
      }
    });
    const corruptedLead = await fx.prisma.lead.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        title: "Alpha direct relation boundary lead",
        source: "Boundary source"
      }
    });
    const corruptedPerson = await fx.prisma.person.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        organizationId: fx.recordsB.organization.id,
        firstName: "Alpha",
        lastName: "Boundary",
        email: "alpha-boundary@example.test"
      }
    });
    const mixedDealActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: corruptedDeal.id,
        leadId: fx.recordsB.lead.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        type: "TASK",
        title: "Alpha mixed deal boundary activity"
      }
    });
    const mixedDealNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        dealId: corruptedDeal.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        body: "Alpha mixed deal boundary note"
      }
    });
    const mixedLeadActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsB.deal.id,
        leadId: corruptedLead.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        type: "TASK",
        title: "Alpha mixed lead boundary activity"
      }
    });
    const mixedLeadNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        leadId: corruptedLead.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        body: "Alpha mixed lead boundary note"
      }
    });

    const [
      dealPage,
      dealDetail,
      leadPage,
      leadDetail,
      peoplePage,
      personDetail,
      betaDealPersonSearch,
      betaDealOrgSearch,
      betaLeadPersonSearch,
      betaLeadOrgSearch,
      betaPeopleOrgSearch,
      missingNextDeals
    ] = await Promise.all([
      crm.listDealsPage(fx.actorA, { q: corruptedDeal.title }, { page: 1, pageSize: 10 }),
      crm.getDeal(fx.actorA, corruptedDeal.id),
      crm.listLeadsPage(fx.actorA, { q: corruptedLead.title }, { page: 1, pageSize: 10 }),
      crm.getLead(fx.actorA, corruptedLead.id),
      crm.listPeoplePage(fx.actorA, { q: corruptedPerson.email ?? "" }, { page: 1, pageSize: 10 }),
      crm.getPerson(fx.actorA, corruptedPerson.id),
      crm.listDealsPage(fx.actorA, { q: betaPersonName }, { page: 1, pageSize: 10 }),
      crm.listDealsPage(fx.actorA, { q: fx.recordsB.organization.name }, { page: 1, pageSize: 10 }),
      crm.listLeadsPage(fx.actorA, { q: betaPersonName }, { page: 1, pageSize: 10 }),
      crm.listLeadsPage(fx.actorA, { q: fx.recordsB.organization.name }, { page: 1, pageSize: 10 }),
      crm.listPeoplePage(fx.actorA, { q: fx.recordsB.organization.name }, { page: 1, pageSize: 10 }),
      crm.listRecordsMissingNextActivity(fx.actorA, "deal", { take: 25 })
    ]);
    const listedDeal = dealPage.items.find((deal) => deal.id === corruptedDeal.id);
    const listedLead = leadPage.items.find((lead) => lead.id === corruptedLead.id);
    const listedPerson = peoplePage.items.find((person) => person.id === corruptedPerson.id);
    const missingDeal = missingNextDeals.find((deal) => deal.id === missingActivityDeal.id);

    expect(listedDeal?.person).toBeNull();
    expect(listedDeal?.organization).toBeNull();
    expect(listedDeal?.activities.map((activity) => activity.id)).not.toContain(mixedDealActivity.id);
    expect(dealDetail.person).toBeNull();
    expect(dealDetail.organization).toBeNull();
    expect(dealDetail.activities.map((activity) => activity.id)).not.toContain(mixedDealActivity.id);
    expect(dealDetail.notes.map((note) => note.id)).not.toContain(mixedDealNote.id);

    expect(listedLead?.person).toBeNull();
    expect(listedLead?.organization).toBeNull();
    expect(listedLead?.activities.map((activity) => activity.id)).not.toContain(mixedLeadActivity.id);
    expect(leadDetail.person).toBeNull();
    expect(leadDetail.organization).toBeNull();
    expect(leadDetail.activities.map((activity) => activity.id)).not.toContain(mixedLeadActivity.id);
    expect(leadDetail.notes.map((note) => note.id)).not.toContain(mixedLeadNote.id);

    expect(listedPerson?.organization).toBeNull();
    expect(personDetail.organization).toBeNull();
    expect(missingDeal?.relatedLabel).toBe(fx.recordsA.stageOne.name);

    expect(betaDealPersonSearch.items.map((deal) => deal.id)).not.toContain(corruptedDeal.id);
    expect(betaDealOrgSearch.items.map((deal) => deal.id)).not.toContain(corruptedDeal.id);
    expect(betaDealOrgSearch.items.map((deal) => deal.id)).not.toContain(missingActivityDeal.id);
    expect(betaLeadPersonSearch.items.map((lead) => lead.id)).not.toContain(corruptedLead.id);
    expect(betaLeadOrgSearch.items.map((lead) => lead.id)).not.toContain(corruptedLead.id);
    expect(betaPeopleOrgSearch.items.map((person) => person.id)).not.toContain(corruptedPerson.id);
  });

  it("converts a lead into a deal and reattaches lead timeline records", async () => {
    const fx = currentFixture();
    const leadEmailLog = await crm.createEmailLog(fx.actorA, {
      leadId: fx.recordsA.lead.id,
      direction: "INBOUND",
      occurredAt: new Date("2030-02-05T14:30:00.000Z"),
      subject: "Lead conversion context",
      body: "Email context that should follow the converted deal."
    });
    const staleLeadActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        leadId: fx.recordsA.lead.id,
        personId: fx.recordsB.person.id,
        type: "TASK",
        title: "Stale lead conversion activity"
      }
    });
    const staleLeadNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        leadId: fx.recordsA.lead.id,
        organizationId: fx.recordsB.organization.id,
        body: "Stale lead conversion note"
      }
    });
    const staleLeadEmailLog = await fx.prisma.emailLog.create({
      data: {
        workspaceId: fx.workspaceA.id,
        createdById: fx.userA.id,
        leadId: fx.recordsA.lead.id,
        organizationId: fx.recordsB.organization.id,
        direction: "INBOUND",
        occurredAt: new Date("2030-02-05T15:30:00.000Z"),
        subject: "Stale lead conversion email",
        body: "This stale email should not be moved to the converted deal."
      }
    });
    await expect(
      crm.convertLeadToDeal(fx.actorA, fx.recordsA.lead.id, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageTwo.id,
        title: { text: "Malformed conversion title" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Converted deal title must be text."
    });
    await expect(fx.prisma.lead.findUnique({ where: { id: fx.recordsA.lead.id } })).resolves.toMatchObject({
      status: "NEW"
    });
    await expect(
      fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id, title: "Malformed conversion title" } })
    ).resolves.toBe(0);
    await expect(
      fx.prisma.auditLog.count({
        where: { workspaceId: fx.workspaceA.id, entityType: "Lead", entityId: fx.recordsA.lead.id, action: "lead.converted" }
      })
    ).resolves.toBe(0);

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
    const movedEmailLog = await fx.prisma.emailLog.findUniqueOrThrow({
      where: { id: leadEmailLog.id }
    });
    const [staleActivityAfterConversion, staleNoteAfterConversion, staleEmailAfterConversion] = await Promise.all([
      fx.prisma.activity.findUniqueOrThrow({ where: { id: staleLeadActivity.id } }),
      fx.prisma.note.findUniqueOrThrow({ where: { id: staleLeadNote.id } }),
      fx.prisma.emailLog.findUniqueOrThrow({ where: { id: staleLeadEmailLog.id } })
    ]);
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
    expect(movedEmailLog.leadId).toBeNull();
    expect(movedEmailLog.dealId).toBe(deal.id);
    expect(staleActivityAfterConversion).toMatchObject({ leadId: fx.recordsA.lead.id, dealId: null });
    expect(staleNoteAfterConversion).toMatchObject({ leadId: fx.recordsA.lead.id, dealId: null });
    expect(staleEmailAfterConversion).toMatchObject({ leadId: fx.recordsA.lead.id, dealId: null });
    expect(auditEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["deal.created_from_lead", "lead.converted"])
    );
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "lead.converted",
          metadata: expect.objectContaining({ reattachedActivities: 1, reattachedNotes: 1, reattachedEmailLogs: 1 })
        })
      ])
    );
    await expect(
      crm.updateLead(fx.actorA, fx.recordsA.lead.id, {
        source: "Edited after conversion",
        title: "Edited converted lead"
      })
    ).rejects.toMatchObject({
      code: "LEAD_LOCKED",
      message: "Converted leads cannot be edited.",
      status: 409
    });
    await expect(
      crm.createActivity(fx.actorA, {
        leadId: fx.recordsA.lead.id,
        type: "TASK",
        title: "Converted lead follow-up"
      })
    ).rejects.toMatchObject({
      code: "LEAD_CONVERTED",
      message: "Create follow-up activities on the converted deal.",
      status: 409
    });
    await expect(fx.prisma.lead.findUnique({ where: { id: fx.recordsA.lead.id } })).resolves.toMatchObject({
      source: fx.recordsA.lead.source,
      status: "CONVERTED",
      title: fx.recordsA.lead.title
    });
    await expect(
      fx.prisma.activity.count({
        where: { workspaceId: fx.workspaceA.id, leadId: fx.recordsA.lead.id, title: "Converted lead follow-up" }
      })
    ).resolves.toBe(0);
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityId: fx.recordsA.lead.id,
          entityType: "Lead",
          action: "lead.updated"
        }
      })
    ).resolves.toBe(0);
  });

  it("allows only one deal to be created when lead conversion requests run in parallel", async () => {
    const fx = currentFixture();
    const lead = await crm.createLead(fx.actorA, {
      title: "Parallel conversion lead",
      source: "Readiness regression"
    });

    const results = await Promise.allSettled([
      crm.convertLeadToDeal(fx.actorA, lead.id, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Parallel conversion deal"
      }),
      crm.convertLeadToDeal(fx.actorA, lead.id, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Parallel conversion deal"
      })
    ]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof crm.convertLeadToDeal>>> => {
      return result.status === "fulfilled";
    });
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const [convertedLead, dealCount, auditCount] = await Promise.all([
      fx.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } }),
      fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id, title: "Parallel conversion deal" } }),
      fx.prisma.auditLog.count({ where: { workspaceId: fx.workspaceA.id, entityType: "Lead", entityId: lead.id, action: "lead.converted" } })
    ]);

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "LEAD_ALREADY_CONVERTED", status: 409 });
    expect(fulfilled[0]?.value.title).toBe("Parallel conversion deal");
    expect(convertedLead.status).toBe("CONVERTED");
    expect(dealCount).toBe(1);
    expect(auditCount).toBe(1);
  });

  it("rejects deal stage moves that target another workspace stage", async () => {
    const fx = currentFixture();

    await expect(
      crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { stageId: fx.recordsB.stageOne.id })
    ).rejects.toMatchObject({
      code: "INVALID_STAGE",
      message: "The stage must belong to the selected pipeline and workspace.",
      status: 422
    });

    await expect(fx.prisma.deal.findUnique({ where: { id: fx.recordsA.deal.id } })).resolves.toMatchObject({
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id
    });
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityId: fx.recordsA.deal.id,
          entityType: "Deal",
          action: "deal.stage_changed"
        }
      })
    ).resolves.toBe(0);
  });

  it("rejects deal writes and lead conversions that target a soft-deleted pipeline", async () => {
    const fx = currentFixture();

    await fx.prisma.pipeline.update({
      where: { id: fx.recordsA.pipeline.id },
      data: { deletedAt: new Date("2030-01-01T00:00:00.000Z") }
    });

    await expect(
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Deleted pipeline deal"
      })
    ).rejects.toMatchObject({
      code: "INVALID_STAGE",
      message: "The stage must belong to the selected pipeline and workspace.",
      status: 422
    });
    await expect(
      crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { stageId: fx.recordsA.stageTwo.id })
    ).rejects.toMatchObject({
      code: "INVALID_STAGE",
      status: 422
    });
    await expect(
      crm.convertLeadToDeal(fx.actorA, fx.recordsA.lead.id, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Deleted pipeline conversion"
      })
    ).rejects.toMatchObject({
      code: "INVALID_STAGE",
      status: 422
    });

    await expect(
      fx.prisma.deal.count({
        where: { workspaceId: fx.workspaceA.id, title: { in: ["Deleted pipeline deal", "Deleted pipeline conversion"] } }
      })
    ).resolves.toBe(0);
    await expect(fx.prisma.deal.findUnique({ where: { id: fx.recordsA.deal.id } })).resolves.toMatchObject({
      stageId: fx.recordsA.stageOne.id
    });
    await expect(fx.prisma.lead.findUnique({ where: { id: fx.recordsA.lead.id } })).resolves.toMatchObject({
      status: "NEW"
    });
  });

  it("blocks normal edits and stage moves after a deal is closed", async () => {
    const fx = currentFixture();
    const completedAt = new Date("2030-01-01T13:00:00.000Z");
    const dealActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      type: "TASK",
      title: "Close lock follow-up"
    });
    const dismissibleDealActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      type: "TASK",
      title: "Close lock dismissible follow-up"
    });
    const dealNote = await crm.createNote(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      body: "Close lock note"
    });
    const lineItemProduct = await crm.createProduct(fx.actorA, {
      name: "Close lock line item package",
      unitPriceCents: 50000,
      currency: "USD"
    });
    const blockedLineItemProduct = await crm.createProduct(fx.actorA, {
      name: "Blocked close lock line item package",
      unitPriceCents: 75000,
      currency: "USD"
    });
    const dealLineItem = await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: lineItemProduct.id,
      quantity: 1
    });

    await expect(
      crm.closeDeal(fx.actorA, fx.recordsA.deal.id, { status: "ARCHIVED" as unknown as "LOST" })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Deal close status must be WON or LOST."
    });
    await expect(fx.prisma.deal.findUnique({ where: { id: fx.recordsA.deal.id } })).resolves.toMatchObject({
      lostAt: null,
      status: "OPEN",
      wonAt: null
    });
    await expect(
      crm.closeDeal(fx.actorA, fx.recordsA.deal.id, {
        status: "LOST",
        lostReason: { text: "Malformed lost reason" } as never
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Deal lost reason must be text."
    });
    await expect(fx.prisma.deal.findUnique({ where: { id: fx.recordsA.deal.id } })).resolves.toMatchObject({
      lostAt: null,
      status: "OPEN",
      wonAt: null
    });
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Deal",
          entityId: fx.recordsA.deal.id,
          action: { in: ["deal.won", "deal.lost"] }
        }
      })
    ).resolves.toBe(0);

    await crm.closeDeal(fx.actorA, fx.recordsA.deal.id, { status: "WON" });

    await expect(
      crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { title: "Should not update" })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED" });

    await expect(
      crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { stageId: fx.recordsA.stageTwo.id })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED" });

    await expect(
      crm.createActivity(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        type: "TASK",
        title: "Should not create closed deal activity"
      })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });

    await expect(
      crm.updateActivity(fx.actorA, dealActivity.id, { title: "Should not edit closed deal activity" })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });

    await expect(crm.updateActivity(fx.actorA, dealActivity.id, { completedAt })).resolves.toMatchObject({
      completedAt
    });

    await expect(crm.softDeleteActivity(fx.actorA, dismissibleDealActivity.id)).resolves.toBeUndefined();
    await expect(fx.prisma.activity.findUnique({ where: { id: dismissibleDealActivity.id } })).resolves.toMatchObject({
      deletedAt: expect.any(Date)
    });

    await expect(
      crm.createNote(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        body: "Should not create closed deal note"
      })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });

    await expect(crm.softDeleteNote(fx.actorA, dealNote.id)).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });

    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date("2030-01-01T12:00:00.000Z"),
        subject: "Should not log closed deal email",
        body: "Closed deal email log should be rejected."
      })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });

    await expect(
      crm.createDealLineItem(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        productId: blockedLineItemProduct.id,
        quantity: 1
      })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });

    await expect(crm.removeDealLineItem(fx.actorA, dealLineItem.id)).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });

    await expect(crm.softDeleteDeal(fx.actorA, fx.recordsA.deal.id)).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });

    const [
      deal,
      activity,
      note,
      lineItem,
      blockedNoteCount,
      blockedEmailLogCount,
      blockedLineItemCount,
      clearedActivityAuditCount,
      blockedLineItemRemovalAuditCount
    ] = await Promise.all([
      fx.prisma.deal.findUnique({ where: { id: fx.recordsA.deal.id } }),
      fx.prisma.activity.findUnique({ where: { id: dealActivity.id } }),
      fx.prisma.note.findUnique({ where: { id: dealNote.id } }),
      fx.prisma.dealLineItem.findUnique({ where: { id: dealLineItem.id } }),
      fx.prisma.note.count({
        where: {
          workspaceId: fx.workspaceA.id,
          body: "Should not create closed deal note"
        }
      }),
      fx.prisma.emailLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          subject: "Should not log closed deal email"
        }
      }),
      fx.prisma.dealLineItem.count({
        where: {
          workspaceId: fx.workspaceA.id,
          dealId: fx.recordsA.deal.id,
          productId: blockedLineItemProduct.id
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Activity",
          entityId: dealActivity.id,
          action: { in: ["activity.updated", "activity.completed", "activity.deleted"] }
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "DealLineItem",
          entityId: dealLineItem.id,
          action: "deal_line_item.removed"
        }
      })
    ]);

    expect(deal).toMatchObject({
      deletedAt: null,
      status: "WON"
    });
    expect(activity).toMatchObject({
      completedAt,
      deletedAt: null,
      title: "Close lock follow-up"
    });
    expect(note).toMatchObject({
      body: "Close lock note",
      deletedAt: null
    });
    expect(lineItem).toMatchObject({
      dealId: fx.recordsA.deal.id,
      productId: lineItemProduct.id,
      quantity: 1,
      lineTotalCents: 50000
    });
    expect(blockedNoteCount).toBe(0);
    expect(blockedEmailLogCount).toBe(0);
    expect(blockedLineItemCount).toBe(0);
    expect(clearedActivityAuditCount).toBe(1);
    expect(blockedLineItemRemovalAuditCount).toBe(0);
  });

  it("blocks accepted quote value sync after a deal is closed", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Closed Deal Sync Package",
      unitPriceCents: 250000,
      currency: "USD"
    });
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Closed deal quote sync lock",
      valueCents: 100000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED");
    await crm.closeDeal(fx.actorA, deal.id, { status: "WON" });

    await expect(crm.syncAcceptedQuoteToDealValue(fx.actorA, quote.id)).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });
    await expect(fx.prisma.deal.findUnique({ where: { id: deal.id } })).resolves.toMatchObject({
      status: "WON",
      valueCents: 250000,
      currency: "USD"
    });
  });

  it("blocks quote mutations and public acceptance after a deal is closed", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Closed Deal Quote Lifecycle Package",
      unitPriceCents: 90000,
      currency: "USD"
    });
    const deal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Closed deal quote lifecycle lock",
      valueCents: 90000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    const draftQuote = await crm.createQuoteFromDeal(fx.actorA, deal.id);
    const publicLink = await crm.createQuotePublicLink(fx.actorA, quote.id);
    await crm.closeDeal(fx.actorA, deal.id, { status: "WON" });

    await expect(crm.createQuoteFromDeal(fx.actorA, deal.id)).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });
    await expect(
      crm.updateQuoteAdjustments(fx.actorA, draftQuote.id, { discountType: "PERCENT", discountValue: 5 })
    ).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });
    await expect(crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED")).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });
    await expect(crm.createQuotePublicLink(fx.actorA, quote.id)).rejects.toMatchObject({
      code: "DEAL_CLOSED",
      status: 409
    });
    await expect(crm.acceptPublicQuoteByToken(publicLink.token)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "This quote is no longer available for public acceptance.",
      status: 422
    });
    await expect(crm.revokeQuotePublicLink(fx.actorA, quote.id)).resolves.toMatchObject({ revoked: true });
    await expect(fx.prisma.quote.findUnique({ where: { id: quote.id } })).resolves.toMatchObject({
      status: "SENT"
    });
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

  it("rejects deal, activity, and note attachments to records from another workspace", async () => {
    const fx = currentFixture();

    await expect(
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userB.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "Invalid owner deal"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        personId: fx.recordsB.person.id,
        title: "Invalid contact deal"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      crm.updateDeal(fx.actorA, fx.recordsA.deal.id, {
        organizationId: fx.recordsB.organization.id
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      fx.prisma.deal.count({
        where: {
          workspaceId: fx.workspaceA.id,
          title: { in: ["Invalid owner deal", "Invalid contact deal"] }
        }
      })
    ).resolves.toBe(0);
    await expect(fx.prisma.deal.findUnique({ where: { id: fx.recordsA.deal.id } })).resolves.toMatchObject({
      organizationId: fx.recordsA.organization.id
    });

    const dealCountBeforeMalformedInput = await fx.prisma.deal.count({
      where: { workspaceId: fx.workspaceA.id }
    });
    await expect(
      crm.createDeal(fx.actorA, {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: { id: fx.userA.id } as unknown as string,
        title: "Malformed deal owner"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Deal relation ids must be text."
    });
    await expect(fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      dealCountBeforeMalformedInput
    );
    const boundaryDeal = await crm.createDeal(fx.actorA, {
      id: "caller-controlled-deal-id",
      workspaceId: fx.workspaceB.id,
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      createdAt: new Date("2035-01-01T00:00:00.000Z"),
      updatedAt: new Date("2035-01-02T00:00:00.000Z"),
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      personId: fx.recordsA.person.id,
      organizationId: fx.recordsA.organization.id,
      title: "   Service boundary deal   ",
      valueCents: 12345,
      currency: " usd ",
      expectedCloseAt: "2030-02-03T04:05:06.000Z"
    } as never);
    const updatedBoundaryDeal = await crm.updateDeal(fx.actorA, boundaryDeal.id, {
      id: "caller-controlled-updated-deal-id",
      workspaceId: fx.workspaceB.id,
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      createdAt: new Date("2035-01-01T00:00:00.000Z"),
      updatedAt: new Date("2035-01-02T00:00:00.000Z"),
      title: "   Updated service boundary deal   ",
      currency: " eur ",
      expectedCloseAt: { set: null }
    } as never);
    const boundaryDealRow = await fx.prisma.deal.findUniqueOrThrow({
      where: { id: boundaryDeal.id }
    });
    const dealUpdateAuditCountBeforeNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "deal.updated",
        entityType: "Deal",
        entityId: boundaryDeal.id
      }
    });
    const noopBoundaryDeal = await crm.updateDeal(fx.actorA, boundaryDeal.id, {
      title: "   Updated service boundary deal   ",
      currency: " eur ",
      expectedCloseAt: { set: null }
    } as never);
    const emptyBoundaryDealUpdate = await crm.updateDeal(fx.actorA, boundaryDeal.id, {});
    const dealUpdateAuditCountAfterNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "deal.updated",
        entityType: "Deal",
        entityId: boundaryDeal.id
      }
    });
    const dealUpdateAuditCountBeforeMalformedUpdate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "deal.updated",
        entityType: "Deal",
        entityId: boundaryDeal.id
      }
    });
    await expect(crm.updateDeal(fx.actorA, boundaryDeal.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Deal update must be an object."
    });
    await expect(crm.updateDeal(fx.actorA, boundaryDeal.id, [] as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Deal update must be an object."
    });
    const [dealUpdateAuditCountAfterMalformedUpdate, boundaryDealAfterMalformedUpdate] = await Promise.all([
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "deal.updated",
          entityType: "Deal",
          entityId: boundaryDeal.id
        }
      }),
      fx.prisma.deal.findUniqueOrThrow({ where: { id: boundaryDeal.id } })
    ]);

    expect(boundaryDeal.id).not.toBe("caller-controlled-deal-id");
    expect(boundaryDeal).toMatchObject({
      workspaceId: fx.workspaceA.id,
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      personId: fx.recordsA.person.id,
      organizationId: fx.recordsA.organization.id,
      title: "Service boundary deal",
      valueCents: 12345,
      currency: "USD",
      deletedAt: null
    });
    expect(boundaryDeal.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
    expect(boundaryDeal.expectedCloseAt?.toISOString()).toBe("2030-02-03T04:05:06.000Z");
    expect(updatedBoundaryDeal).toMatchObject({
      id: boundaryDeal.id,
      workspaceId: fx.workspaceA.id,
      title: "Updated service boundary deal",
      currency: "EUR",
      expectedCloseAt: null
    });
    expect(boundaryDealRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      deletedAt: null
    });
    expect(boundaryDealAfterMalformedUpdate).toMatchObject({
      workspaceId: fx.workspaceA.id,
      title: "Updated service boundary deal",
      currency: "EUR",
      expectedCloseAt: null,
      deletedAt: null
    });
    expect(boundaryDealAfterMalformedUpdate.updatedAt.toISOString()).toBe(boundaryDealRow.updatedAt.toISOString());
    expect(noopBoundaryDeal.title).toBe("Updated service boundary deal");
    expect(noopBoundaryDeal.currency).toBe("EUR");
    expect(noopBoundaryDeal.expectedCloseAt).toBeNull();
    expect(emptyBoundaryDealUpdate.title).toBe("Updated service boundary deal");
    expect(dealUpdateAuditCountBeforeNoop).toBe(1);
    expect(dealUpdateAuditCountAfterNoop).toBe(dealUpdateAuditCountBeforeNoop);
    expect(dealUpdateAuditCountBeforeMalformedUpdate).toBe(1);
    expect(dealUpdateAuditCountAfterMalformedUpdate).toBe(dealUpdateAuditCountBeforeMalformedUpdate);

    await expect(
      crm.createActivity(fx.actorA, {
        dealId: fx.recordsB.deal.id,
        type: "TASK",
        title: "Invalid activity attachment"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const activityCountBeforeMalformedInput = await fx.prisma.activity.count({
      where: { workspaceId: fx.workspaceA.id }
    });
    await expect(
      crm.createActivity(fx.actorA, {
        type: "TASK",
        title: "Detached service activity"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Attach the activity to a CRM record."
    });
    await expect(
      crm.createActivity(fx.actorA, {
        dealId: { id: fx.recordsA.deal.id } as unknown as string,
        type: "TASK",
        title: "Malformed activity attachment"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Activity relation ids must be text."
    });
    await expect(
      crm.createActivity(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        type: "EVENT" as never,
        title: "Invalid activity type"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Activity type must be CALL, EMAIL, MEETING, or TASK."
    });
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      activityCountBeforeMalformedInput
    );
    const boundaryActivity = await crm.createActivity(fx.actorA, {
      id: "caller-controlled-activity-id",
      workspaceId: fx.workspaceB.id,
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      createdAt: new Date("2035-01-01T00:00:00.000Z"),
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "   Service boundary activity   ",
      description: "   Trim this description   "
    } as never);
    const updatedBoundaryActivity = await crm.updateActivity(fx.actorA, boundaryActivity.id, {
      workspaceId: fx.workspaceB.id,
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      title: "   Updated service boundary activity   "
    } as never);
    const boundaryActivityRow = await fx.prisma.activity.findUniqueOrThrow({
      where: { id: boundaryActivity.id }
    });
    const activityUpdateAuditCountBeforeNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "activity.updated",
        entityType: "Activity",
        entityId: boundaryActivity.id
      }
    });
    const noopBoundaryActivity = await crm.updateActivity(fx.actorA, boundaryActivity.id, {
      title: "   Updated service boundary activity   "
    });
    const emptyBoundaryActivityUpdate = await crm.updateActivity(fx.actorA, boundaryActivity.id, {});
    const activityUpdateAuditCountAfterNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "activity.updated",
        entityType: "Activity",
        entityId: boundaryActivity.id
      }
    });
    const activityUpdateAuditCountBeforeMalformedUpdate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "activity.updated",
        entityType: "Activity",
        entityId: boundaryActivity.id
      }
    });
    await expect(crm.updateActivity(fx.actorA, boundaryActivity.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Activity update must be an object."
    });
    await expect(crm.updateActivity(fx.actorA, boundaryActivity.id, [] as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Activity update must be an object."
    });
    const [activityUpdateAuditCountAfterMalformedUpdate, boundaryActivityAfterMalformedUpdate] = await Promise.all([
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "activity.updated",
          entityType: "Activity",
          entityId: boundaryActivity.id
        }
      }),
      fx.prisma.activity.findUniqueOrThrow({ where: { id: boundaryActivity.id } })
    ]);

    expect(boundaryActivity.id).not.toBe("caller-controlled-activity-id");
    expect(boundaryActivity).toMatchObject({
      workspaceId: fx.workspaceA.id,
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      title: "Service boundary activity",
      description: "Trim this description",
      deletedAt: null
    });
    expect(boundaryActivity.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
    expect(updatedBoundaryActivity.title).toBe("Updated service boundary activity");
    expect(boundaryActivityRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      deletedAt: null
    });
    expect(boundaryActivityAfterMalformedUpdate).toMatchObject({
      workspaceId: fx.workspaceA.id,
      title: "Updated service boundary activity",
      deletedAt: null
    });
    expect(boundaryActivityAfterMalformedUpdate.updatedAt.toISOString()).toBe(boundaryActivityRow.updatedAt.toISOString());
    expect(noopBoundaryActivity.title).toBe("Updated service boundary activity");
    expect(emptyBoundaryActivityUpdate.title).toBe("Updated service boundary activity");
    expect(activityUpdateAuditCountBeforeNoop).toBe(1);
    expect(activityUpdateAuditCountAfterNoop).toBe(activityUpdateAuditCountBeforeNoop);
    expect(activityUpdateAuditCountBeforeMalformedUpdate).toBe(1);
    expect(activityUpdateAuditCountAfterMalformedUpdate).toBe(activityUpdateAuditCountBeforeMalformedUpdate);

    await expect(
      crm.createNote(fx.actorA, {
        personId: fx.recordsB.person.id,
        body: "Invalid note attachment"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects lead, contact, and organization relation writes to another workspace", async () => {
    const fx = currentFixture();
    const deletedOwner = await fx.prisma.user.create({
      data: {
        email: `deleted-owner-${Date.now()}@example.test`,
        name: "Deleted Owner",
        deletedAt: new Date("2030-01-01T00:00:00.000Z")
      }
    });
    await fx.prisma.workspaceMembership.create({
      data: {
        workspaceId: fx.workspaceA.id,
        userId: deletedOwner.id,
        role: "MEMBER"
      }
    });

    try {
      await expect(
        crm.createLead(fx.actorA, {
          ownerId: fx.userB.id,
          title: "Invalid owner lead"
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.createLead(fx.actorA, {
          title: "Invalid status lead",
          status: "NURTURING" as unknown as "QUALIFIED"
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Lead status must be NEW, QUALIFIED, or DISQUALIFIED."
      });

      const leadCountBeforeMalformedInput = await fx.prisma.lead.count({
        where: { workspaceId: fx.workspaceA.id }
      });
      await expect(
        crm.createLead(fx.actorA, {
          ownerId: { id: fx.userA.id } as unknown as string,
          title: "Malformed owner lead"
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Lead relation ids must be text."
      });
      await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
        leadCountBeforeMalformedInput
      );
      const boundaryLead = await crm.createLead(fx.actorA, {
        id: "caller-controlled-lead-id",
        workspaceId: fx.workspaceB.id,
        deletedAt: new Date("2030-01-01T00:00:00.000Z"),
        createdAt: new Date("2035-01-01T00:00:00.000Z"),
        updatedAt: new Date("2035-01-02T00:00:00.000Z"),
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "   Service boundary lead   ",
        source: "   Referral   ",
        status: "QUALIFIED"
      } as never);
      const updatedBoundaryLead = await crm.updateLead(fx.actorA, boundaryLead.id, {
        id: "caller-controlled-updated-lead-id",
        workspaceId: fx.workspaceB.id,
        deletedAt: new Date("2030-01-01T00:00:00.000Z"),
        createdAt: new Date("2035-01-01T00:00:00.000Z"),
        updatedAt: new Date("2035-01-02T00:00:00.000Z"),
        title: "   Updated service boundary lead   ",
        source: null
      } as never);
      const boundaryLeadRow = await fx.prisma.lead.findUniqueOrThrow({
        where: { id: boundaryLead.id }
      });
      const leadUpdateAuditCountBeforeNoop = await fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "lead.updated",
          entityType: "Lead",
          entityId: boundaryLead.id
        }
      });
      const noopBoundaryLead = await crm.updateLead(fx.actorA, boundaryLead.id, {
        title: "   Updated service boundary lead   "
      });
      const emptyBoundaryLeadUpdate = await crm.updateLead(fx.actorA, boundaryLead.id, {});
      const leadUpdateAuditCountAfterNoop = await fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "lead.updated",
          entityType: "Lead",
          entityId: boundaryLead.id
        }
      });
      const leadUpdateAuditCountBeforeMalformedUpdate = await fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "lead.updated",
          entityType: "Lead",
          entityId: boundaryLead.id
        }
      });
      await expect(crm.updateLead(fx.actorA, boundaryLead.id, null as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Lead update must be an object."
      });
      await expect(crm.updateLead(fx.actorA, boundaryLead.id, [] as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Lead update must be an object."
      });
      const leadUpdateAuditCountAfterMalformedUpdate = await fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "lead.updated",
          entityType: "Lead",
          entityId: boundaryLead.id
        }
      });
      const boundaryLeadAfterMalformedUpdate = await fx.prisma.lead.findUniqueOrThrow({
        where: { id: boundaryLead.id }
      });

      expect(boundaryLead.id).not.toBe("caller-controlled-lead-id");
      expect(boundaryLead).toMatchObject({
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "Service boundary lead",
        source: "Referral",
        status: "QUALIFIED",
        deletedAt: null
      });
      expect(boundaryLead.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
      expect(updatedBoundaryLead).toMatchObject({
        id: boundaryLead.id,
        workspaceId: fx.workspaceA.id,
        title: "Updated service boundary lead",
        source: null,
        deletedAt: null
      });
      expect(boundaryLeadRow).toMatchObject({
        workspaceId: fx.workspaceA.id,
        deletedAt: null
      });
      expect(boundaryLeadAfterMalformedUpdate).toMatchObject({
        title: "Updated service boundary lead",
        source: null,
        workspaceId: fx.workspaceA.id,
        deletedAt: null
      });
      expect(noopBoundaryLead.title).toBe("Updated service boundary lead");
      expect(emptyBoundaryLeadUpdate.title).toBe("Updated service boundary lead");
      expect(leadUpdateAuditCountBeforeNoop).toBe(1);
      expect(leadUpdateAuditCountAfterNoop).toBe(leadUpdateAuditCountBeforeNoop);
      expect(leadUpdateAuditCountBeforeMalformedUpdate).toBe(1);
      expect(leadUpdateAuditCountAfterMalformedUpdate).toBe(leadUpdateAuditCountBeforeMalformedUpdate);

      const leadReturnContact = await crm.createPerson(fx.actorA, {
        firstName: "Lead",
        lastName: "Returnflow",
        email: "lead-returnflow@example.test"
      });
      const leadReturnOrganization = await crm.createOrganization(fx.actorA, {
        name: "Lead Returnflow Org"
      });
      const leadWithNewRelations = await crm.updateLead(fx.actorA, boundaryLead.id, {
        personId: leadReturnContact.id,
        organizationId: leadReturnOrganization.id
      });
      expect(leadWithNewRelations).toMatchObject({
        id: boundaryLead.id,
        personId: leadReturnContact.id,
        organizationId: leadReturnOrganization.id
      });
      await expect(fx.prisma.lead.findUnique({ where: { id: boundaryLead.id } })).resolves.toMatchObject({
        personId: leadReturnContact.id,
        organizationId: leadReturnOrganization.id
      });

      await expect(
        crm.createLead(fx.actorA, {
          ownerId: deletedOwner.id,
          title: "Invalid deleted owner lead"
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.createLead(fx.actorA, {
          personId: fx.recordsB.person.id,
          title: "Invalid contact lead"
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.updateLead(fx.actorA, fx.recordsA.lead.id, {
          organizationId: fx.recordsB.organization.id
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.updateLead(fx.actorA, fx.recordsA.lead.id, {
          status: "NURTURING" as unknown as "QUALIFIED"
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Lead status must be NEW, QUALIFIED, or DISQUALIFIED."
      });
      await expect(fx.prisma.lead.findUnique({ where: { id: fx.recordsA.lead.id } })).resolves.toMatchObject({
        status: "NEW"
      });

      await expect(
        crm.createPerson(fx.actorA, {
          firstName: "Invalid",
          lastName: "Contact",
          email: "invalid-contact-relation@example.test",
          organizationId: fx.recordsB.organization.id
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.updatePerson(fx.actorA, fx.recordsA.person.id, {
          ownerId: fx.userB.id
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.createOrganization(fx.actorA, {
          name: "Invalid owner organization",
          ownerId: fx.userB.id
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.createOrganization(fx.actorA, {
          name: "Invalid deleted owner organization",
          ownerId: deletedOwner.id
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        crm.updateOrganization(fx.actorA, fx.recordsA.organization.id, {
          ownerId: fx.userB.id
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const contactCountBeforeMalformedInput = await fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } });
      const organizationCountBeforeMalformedInput = await fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } });
      await expect(crm.createPerson(fx.actorA, null as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Contact first name is required."
      });
      await expect(crm.createOrganization(fx.actorA, null as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Organization name is required."
      });
      await expect(
        crm.createPerson(fx.actorA, {
          firstName: "Malformed",
          organizationId: { id: fx.recordsA.organization.id } as unknown as string
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Contact relation ids must be text."
      });
      await expect(
        crm.createOrganization(fx.actorA, {
          name: "Malformed Owner Organization",
          ownerId: { id: fx.userA.id } as unknown as string
        })
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Organization relation ids must be text."
      });
      await expect(fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
        contactCountBeforeMalformedInput
      );
      await expect(fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
        organizationCountBeforeMalformedInput
      );

      const boundaryPerson = await crm.createPerson(fx.actorA, {
        id: "caller-controlled-person-id",
        workspaceId: fx.workspaceB.id,
        deletedAt: new Date("2030-01-01T00:00:00.000Z"),
        createdAt: new Date("2035-01-01T00:00:00.000Z"),
        ownerId: fx.userA.id,
        organizationId: fx.recordsA.organization.id,
        firstName: "   Boundary   ",
        lastName: "   Contact   ",
        email: " boundary@example.test ",
        phone: " 555-0199 "
      } as never);
      const updatedBoundaryPerson = await crm.updatePerson(fx.actorA, boundaryPerson.id, {
        workspaceId: fx.workspaceB.id,
        deletedAt: new Date("2030-01-01T00:00:00.000Z"),
        firstName: "   Boundary Updated   "
      } as never);
      const boundaryOrganization = await crm.createOrganization(fx.actorA, {
        id: "caller-controlled-organization-id",
        workspaceId: fx.workspaceB.id,
        deletedAt: new Date("2030-01-01T00:00:00.000Z"),
        createdAt: new Date("2035-01-01T00:00:00.000Z"),
        ownerId: fx.userA.id,
        name: "   Boundary Organization   ",
        domain: " boundary.example.test "
      } as never);
      const updatedBoundaryOrganization = await crm.updateOrganization(fx.actorA, boundaryOrganization.id, {
        workspaceId: fx.workspaceB.id,
        deletedAt: new Date("2030-01-01T00:00:00.000Z"),
        name: "   Boundary Organization Updated   "
      } as never);
      const [boundaryPersonRow, boundaryOrganizationRow] = await Promise.all([
        fx.prisma.person.findUniqueOrThrow({ where: { id: boundaryPerson.id } }),
        fx.prisma.organization.findUniqueOrThrow({ where: { id: boundaryOrganization.id } })
      ]);
      const [personUpdateAuditCountBeforeNoop, organizationUpdateAuditCountBeforeNoop] = await Promise.all([
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "person.updated",
            entityType: "Person",
            entityId: boundaryPerson.id
          }
        }),
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "organization.updated",
            entityType: "Organization",
            entityId: boundaryOrganization.id
          }
        })
      ]);
      const noopBoundaryPerson = await crm.updatePerson(fx.actorA, boundaryPerson.id, {
        firstName: "   Boundary Updated   "
      });
      const emptyBoundaryPersonUpdate = await crm.updatePerson(fx.actorA, boundaryPerson.id, {});
      const noopBoundaryOrganization = await crm.updateOrganization(fx.actorA, boundaryOrganization.id, {
        name: "   Boundary Organization Updated   "
      });
      const emptyBoundaryOrganizationUpdate = await crm.updateOrganization(fx.actorA, boundaryOrganization.id, {});
      const [personUpdateAuditCountAfterNoop, organizationUpdateAuditCountAfterNoop] = await Promise.all([
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "person.updated",
            entityType: "Person",
            entityId: boundaryPerson.id
          }
        }),
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "organization.updated",
            entityType: "Organization",
            entityId: boundaryOrganization.id
          }
        })
      ]);
      const [personUpdateAuditCountBeforeMalformedUpdate, organizationUpdateAuditCountBeforeMalformedUpdate] = await Promise.all([
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "person.updated",
            entityType: "Person",
            entityId: boundaryPerson.id
          }
        }),
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "organization.updated",
            entityType: "Organization",
            entityId: boundaryOrganization.id
          }
        })
      ]);
      await expect(crm.updatePerson(fx.actorA, boundaryPerson.id, null as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Contact update must be an object."
      });
      await expect(crm.updatePerson(fx.actorA, boundaryPerson.id, [] as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Contact update must be an object."
      });
      await expect(crm.updateOrganization(fx.actorA, boundaryOrganization.id, null as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Organization update must be an object."
      });
      await expect(crm.updateOrganization(fx.actorA, boundaryOrganization.id, [] as never)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        message: "Organization update must be an object."
      });
      const [
        personUpdateAuditCountAfterMalformedUpdate,
        organizationUpdateAuditCountAfterMalformedUpdate,
        boundaryPersonAfterMalformedUpdate,
        boundaryOrganizationAfterMalformedUpdate
      ] = await Promise.all([
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "person.updated",
            entityType: "Person",
            entityId: boundaryPerson.id
          }
        }),
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            action: "organization.updated",
            entityType: "Organization",
            entityId: boundaryOrganization.id
          }
        }),
        fx.prisma.person.findUniqueOrThrow({ where: { id: boundaryPerson.id } }),
        fx.prisma.organization.findUniqueOrThrow({ where: { id: boundaryOrganization.id } })
      ]);

      expect(boundaryPerson.id).not.toBe("caller-controlled-person-id");
      expect(boundaryPerson).toMatchObject({
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        organizationId: fx.recordsA.organization.id,
        firstName: "Boundary",
        lastName: "Contact",
        email: "boundary@example.test",
        phone: "555-0199",
        deletedAt: null
      });
      expect(boundaryPerson.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
      expect(updatedBoundaryPerson.firstName).toBe("Boundary Updated");
      expect(noopBoundaryPerson.firstName).toBe("Boundary Updated");
      expect(emptyBoundaryPersonUpdate.firstName).toBe("Boundary Updated");
      expect(boundaryPersonRow).toMatchObject({
        workspaceId: fx.workspaceA.id,
        deletedAt: null
      });
      expect(boundaryPersonAfterMalformedUpdate).toMatchObject({
        workspaceId: fx.workspaceA.id,
        firstName: "Boundary Updated",
        deletedAt: null
      });
      expect(personUpdateAuditCountBeforeNoop).toBe(1);
      expect(personUpdateAuditCountAfterNoop).toBe(personUpdateAuditCountBeforeNoop);
      expect(personUpdateAuditCountBeforeMalformedUpdate).toBe(1);
      expect(personUpdateAuditCountAfterMalformedUpdate).toBe(personUpdateAuditCountBeforeMalformedUpdate);
      expect(boundaryOrganization.id).not.toBe("caller-controlled-organization-id");
      expect(boundaryOrganization).toMatchObject({
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        name: "Boundary Organization",
        domain: "boundary.example.test",
        deletedAt: null
      });
      expect(boundaryOrganization.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
      expect(updatedBoundaryOrganization.name).toBe("Boundary Organization Updated");
      expect(noopBoundaryOrganization.name).toBe("Boundary Organization Updated");
      expect(emptyBoundaryOrganizationUpdate.name).toBe("Boundary Organization Updated");
      expect(boundaryOrganizationRow).toMatchObject({
        workspaceId: fx.workspaceA.id,
        deletedAt: null
      });
      expect(boundaryOrganizationAfterMalformedUpdate).toMatchObject({
        workspaceId: fx.workspaceA.id,
        name: "Boundary Organization Updated",
        deletedAt: null
      });
      expect(organizationUpdateAuditCountBeforeNoop).toBe(1);
      expect(organizationUpdateAuditCountAfterNoop).toBe(organizationUpdateAuditCountBeforeNoop);
      expect(organizationUpdateAuditCountBeforeMalformedUpdate).toBe(1);
      expect(organizationUpdateAuditCountAfterMalformedUpdate).toBe(organizationUpdateAuditCountBeforeMalformedUpdate);

      await expect(
        fx.prisma.lead.count({
          where: {
            workspaceId: fx.workspaceA.id,
            title: { in: ["Invalid owner lead", "Invalid deleted owner lead", "Invalid contact lead"] }
          }
        })
      ).resolves.toBe(0);
      await expect(
        fx.prisma.person.count({
          where: { workspaceId: fx.workspaceA.id, email: "invalid-contact-relation@example.test" }
        })
      ).resolves.toBe(0);
      await expect(
        fx.prisma.organization.count({
          where: { workspaceId: fx.workspaceA.id, name: { in: ["Invalid owner organization", "Invalid deleted owner organization"] } }
        })
      ).resolves.toBe(0);
      await expect(fx.prisma.lead.findUniqueOrThrow({ where: { id: fx.recordsA.lead.id } })).resolves.toMatchObject({
        organizationId: fx.recordsA.organization.id
      });
      await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
        ownerId: fx.userA.id
      });
      await expect(
        fx.prisma.organization.findUniqueOrThrow({ where: { id: fx.recordsA.organization.id } })
      ).resolves.toMatchObject({
        ownerId: fx.userA.id
      });
    } finally {
      await fx.prisma.lead.deleteMany({ where: { workspaceId: fx.workspaceA.id, ownerId: deletedOwner.id } });
      await fx.prisma.organization.deleteMany({ where: { workspaceId: fx.workspaceA.id, ownerId: deletedOwner.id } });
      await fx.prisma.workspaceMembership.deleteMany({ where: { userId: deletedOwner.id } });
      await fx.prisma.user.deleteMany({ where: { id: deletedOwner.id } });
    }
  });

  it("edits curated relationship briefs on contacts without weakening workspace scope", async () => {
    const fx = currentFixture();
    const personId = fx.recordsA.person.id;
    const auditCountBefore = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, action: "person.updated", entityType: "Person", entityId: personId }
    });

    const updated = await crm.updatePerson(fx.actorA, personId, {
      relationshipPersonalContext: "  Rockies fan; mentioned a Colorado trip with family.  ",
      relationshipCommunicationStyle: "Prefers concise morning emails.",
      relationshipBusinessConcerns: "Worried about switching costs.",
      relationshipFollowUpReminders: "Ask how the Colorado trip went.",
      relationshipInternalGuidance: "Use naturally for thoughtful follow-up; do not over-personalize."
    });
    const detail = await crm.getPerson(fx.actorA, personId);
    const auditCountAfterUpdate = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, action: "person.updated", entityType: "Person", entityId: personId }
    });
    const updateAuditLog = await fx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: fx.workspaceA.id, action: "person.updated", entityType: "Person", entityId: personId },
      orderBy: { createdAt: "desc" }
    });
    const noop = await crm.updatePerson(fx.actorA, personId, {
      relationshipPersonalContext: "Rockies fan; mentioned a Colorado trip with family."
    });
    const auditCountAfterNoop = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, action: "person.updated", entityType: "Person", entityId: personId }
    });
    const cleared = await crm.updatePerson(fx.actorA, personId, {
      relationshipFollowUpReminders: "   "
    });
    const auditCountAfterClear = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, action: "person.updated", entityType: "Person", entityId: personId }
    });
    const clearAuditLog = await fx.prisma.auditLog.findFirstOrThrow({
      where: { workspaceId: fx.workspaceA.id, action: "person.updated", entityType: "Person", entityId: personId },
      orderBy: { createdAt: "desc" }
    });

    expect(updated).toMatchObject({
      relationshipPersonalContext: "Rockies fan; mentioned a Colorado trip with family.",
      relationshipCommunicationStyle: "Prefers concise morning emails.",
      relationshipBusinessConcerns: "Worried about switching costs.",
      relationshipFollowUpReminders: "Ask how the Colorado trip went.",
      relationshipInternalGuidance: "Use naturally for thoughtful follow-up; do not over-personalize."
    });
    expect(detail).toMatchObject({
      workspaceId: fx.workspaceA.id,
      relationshipPersonalContext: "Rockies fan; mentioned a Colorado trip with family.",
      relationshipCommunicationStyle: "Prefers concise morning emails.",
      relationshipBusinessConcerns: "Worried about switching costs.",
      relationshipFollowUpReminders: "Ask how the Colorado trip went.",
      relationshipInternalGuidance: "Use naturally for thoughtful follow-up; do not over-personalize."
    });
    expect(auditCountAfterUpdate).toBe(auditCountBefore + 1);
    expect(updateAuditLog.metadata).toMatchObject({
      relationshipBriefChanges: expect.arrayContaining([
        expect.objectContaining({
          acceptedFactCount: 0,
          acceptedFacts: [],
          actorId: fx.userA.id,
          field: "relationshipPersonalContext",
          fieldLabel: "Personal context",
          newValue: "Rockies fan; mentioned a Colorado trip with family.",
          previousValue: null,
          source: { type: "manual" },
          target: expect.objectContaining({
            id: personId,
            label: expect.any(String),
            type: "person"
          })
        }),
        expect.objectContaining({
          field: "relationshipInternalGuidance",
          fieldLabel: "Internal guidance",
          source: { type: "manual" }
        })
      ]),
      source: { type: "manual" }
    });
    expect(JSON.stringify(detail.auditLogs)).toContain("relationshipBriefChanges");
    expect(noop.relationshipPersonalContext).toBe("Rockies fan; mentioned a Colorado trip with family.");
    expect(auditCountAfterNoop).toBe(auditCountAfterUpdate);
    expect(cleared.relationshipFollowUpReminders).toBeNull();
    expect(auditCountAfterClear).toBe(auditCountAfterNoop + 1);
    expect(clearAuditLog.metadata).toMatchObject({
      relationshipBriefChanges: [
        expect.objectContaining({
          field: "relationshipFollowUpReminders",
          fieldLabel: "Follow-up reminders",
          newValue: null,
          previousValue: "Ask how the Colorado trip went.",
          source: { type: "manual" }
        })
      ],
      source: { type: "manual" }
    });
    const detailAfterHistoryRead = await crm.getPerson(fx.actorA, personId);
    const auditCountAfterHistoryRead = await fx.prisma.auditLog.count({
      where: { workspaceId: fx.workspaceA.id, action: "person.updated", entityType: "Person", entityId: personId }
    });
    expect(auditCountAfterHistoryRead).toBe(auditCountAfterClear);
    expect(JSON.stringify(detailAfterHistoryRead.auditLogs)).toContain("relationshipBriefChanges");
    expect(JSON.stringify(detailAfterHistoryRead.auditLogs)).toContain("manual");

    await expect(
      crm.updatePerson(fx.actorB, personId, {
        relationshipPersonalContext: "Cross-workspace memory edit"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      crm.updatePerson(fx.actorA, personId, {
        relationshipPersonalContext: { text: "Malformed relationship context" } as never
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Relationship personal context must be text."
    });
    await expect(
      crm.updatePerson(fx.actorA, personId, {
        relationshipPersonalContext: "x".repeat(2001)
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Relationship brief fields must be 2,000 characters or fewer."
    });
  });

  it("creates and reads plain notes across core records with ordering, workspace scope, and converted-lead locking", async () => {
    const fx = currentFixture();
    const initialNoteCount = await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } });
    await expect(crm.createNote(fx.actorA, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Note body is required."
    });
    await expect(
      crm.createNote(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        body: "   "
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422, message: "Note body is required." });
    await expect(
      crm.createNote(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        body: { text: "Malformed note body" } as never
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422, message: "Note body is required." });
    await expect(
      crm.createNote(fx.actorA, {
        dealId: { id: fx.recordsA.deal.id } as unknown as string,
        body: "Malformed note attachment"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Note attachment ids must be text."
    });
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(initialNoteCount);

    const olderDealNote = await crm.createNote(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      body: "  Older deal note  "
    });
    const newerDealNote = await crm.createNote(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      body: "Newer deal note"
    });
    const boundaryNote = await crm.createNote(fx.actorA, {
      id: "caller-controlled-note-id",
      workspaceId: fx.workspaceB.id,
      authorId: fx.userB.id,
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      createdAt: new Date("2035-01-01T00:00:00.000Z"),
      dealId: fx.recordsA.deal.id,
      body: "   Service boundary note   "
    } as never);
    const boundaryNoteRow = await fx.prisma.note.findUniqueOrThrow({
      where: { id: boundaryNote.id }
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
    const staleCrossWorkspaceNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        dealId: fx.recordsB.deal.id,
        body: "Stale cross-workspace note attachment"
      }
    });

    const [deal, person, organization, lead, dealTimeline, listedNotes] = await Promise.all([
      crm.getDeal(fx.actorA, fx.recordsA.deal.id),
      crm.getPerson(fx.actorA, fx.recordsA.person.id),
      crm.getOrganization(fx.actorA, fx.recordsA.organization.id),
      crm.getLead(fx.actorA, fx.recordsA.lead.id),
      crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: fx.recordsA.deal.id }),
      crm.listNotes(fx.actorA)
    ]);

    expect(deal.notes.map((note) => note.body).slice(0, 2)).toEqual(["Newer deal note", "Older deal note"]);
    expect(deal.notes.map((note) => note.body)).toContain("Service boundary note");
    expect(deal.notes[0].authorId).toBe(fx.userA.id);
    expect(boundaryNote.id).not.toBe("caller-controlled-note-id");
    expect(boundaryNote).toMatchObject({
      workspaceId: fx.workspaceA.id,
      authorId: fx.userA.id,
      dealId: fx.recordsA.deal.id,
      body: "Service boundary note",
      deletedAt: null
    });
    expect(boundaryNote.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
    expect(boundaryNoteRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      authorId: fx.userA.id,
      deletedAt: null
    });
    expect(person.notes.map((note) => note.body)).toContain("Contact note");
    expect(organization.notes.map((note) => note.body)).toContain("Organization note");
    expect(lead.notes.map((note) => note.body)).toContain("Lead note before conversion");
    expect(dealTimeline.find((item) => item.type === "note")).toMatchObject({ body: "Newer deal note" });
    expect(listedNotes.map((note) => note.id)).not.toContain(staleCrossWorkspaceNote.id);
    await expect(crm.softDeleteNote(fx.actorA, staleCrossWorkspaceNote.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

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
    await expect(crm.createEmailTemplate(fx.actorA, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Template name is required."
    });
    await expect(crm.createEmailLog(fx.actorA, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email subject is required."
    });
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
    const emailTemplateDeactivateAuditCountBeforeDuplicate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityId: template.id,
        entityType: "EmailTemplate",
        action: "email_template.deactivated"
      }
    });
    const duplicateDeactivatedTemplate = await crm.setEmailTemplateActive(fx.actorA, template.id, false);
    const emailTemplateDeactivateAuditCountAfterDuplicate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityId: template.id,
        entityType: "EmailTemplate",
        action: "email_template.deactivated"
      }
    });
    const activeTemplatesAfterDeactivate = await crm.listEmailTemplates(fx.actorA, { activeOnly: true });
    const editedInactiveTemplate = await crm.updateEmailTemplate(fx.actorA, template.id, {
      name: "Dormant follow-up",
      subject: "Dormant next steps",
      body: "Dormant template body."
    });
    const activeTemplatesAfterInactiveEdit = await crm.listEmailTemplates(fx.actorA, { activeOnly: true });
    const reactivatedTemplate = await crm.setEmailTemplateActive(fx.actorA, template.id, true);
    const emailTemplateReactivateAuditCountBeforeDuplicate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityId: template.id,
        entityType: "EmailTemplate",
        action: "email_template.reactivated"
      }
    });
    const duplicateReactivatedTemplate = await crm.setEmailTemplateActive(fx.actorA, template.id, true);
    const emailTemplateReactivateAuditCountAfterDuplicate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityId: template.id,
        entityType: "EmailTemplate",
        action: "email_template.reactivated"
      }
    });
    const activeTemplates = await crm.listEmailTemplates(fx.actorA, { activeOnly: true });
    const otherWorkspaceTemplate = await crm.createEmailTemplate(fx.actorB, {
      name: "Other workspace template",
      subject: "Other subject",
      body: "Other body"
    });
    await expect(
      crm.createEmailTemplate(fx.actorA, {
        name: "Invalid active template",
        subject: "Invalid active subject",
        body: "Invalid active body",
        active: "true" as unknown as boolean
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email template active flag must be true or false."
    });
    const emailTemplateCountBeforeMalformedText = await fx.prisma.emailTemplate.count({
      where: { workspaceId: fx.workspaceA.id }
    });
    await expect(
      crm.createEmailTemplate(fx.actorA, {
        name: "Invalid subject template",
        subject: { text: "Invalid subject" } as unknown as string,
        body: "Invalid subject body"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Template subject is required."
    });
    expect(await fx.prisma.emailTemplate.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(
      emailTemplateCountBeforeMalformedText
    );
    await expect(crm.setEmailTemplateActive(fx.actorA, template.id, "false" as unknown as boolean)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email template active flag must be true or false."
    });
    await expect(
      crm.listEmailTemplates(fx.actorA, { activeOnly: "false" as unknown as boolean })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email template active-only filter must be true or false."
    });
    await expect(
      fx.prisma.emailTemplate.findFirst({
        where: { workspaceId: fx.workspaceA.id, name: "Invalid active template" }
      })
    ).resolves.toBeNull();
    await expect(fx.prisma.emailTemplate.findUnique({ where: { id: template.id } })).resolves.toMatchObject({
      active: true
    });
    const emailLogCountBeforeMalformedParticipant = await fx.prisma.emailLog.count({
      where: { workspaceId: fx.workspaceA.id }
    });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date("2030-03-01T14:30:00.000Z"),
        fromText: { email: "seller@example.test" } as never,
        subject: "Malformed participant email",
        body: "Malformed participant body."
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email participant fields must be text."
    });
    await expect(fx.prisma.emailLog.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      emailLogCountBeforeMalformedParticipant
    );
    const emailLog = await crm.createEmailLog(fx.actorA, {
      id: "caller-controlled-email-log-id",
      createdAt: new Date("2035-01-01T00:00:00.000Z"),
      dealId: fx.recordsA.deal.id,
      direction: "OUTBOUND",
      occurredAt: new Date("2030-03-01T15:30:00.000Z"),
      fromText: "seller@example.test",
      toText: "buyer@example.test",
      ccText: "legal@example.test",
      provider: "GOOGLE_WORKSPACE",
      providerMessageId: "gmail-service-boundary-1",
      providerThreadId: "thread-service-boundary-1",
      subject: reactivatedTemplate.subject,
      body: reactivatedTemplate.body
    });
    const latestEmailLog = await crm.createEmailLog(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      occurredAt: new Date("2030-03-02T15:30:00.000Z"),
      fromText: "buyer@example.test",
      toText: "seller@example.test",
      subject: "Latest limited email",
      body: "Latest email body."
    });
    const changedAfterLogTemplate = await crm.updateEmailTemplate(fx.actorA, template.id, {
      name: "Follow-up after log",
      subject: "Changed after log",
      body: "Changed after log body."
    });
    const dealEmailLogs = await crm.listEmailLogsForRecord(fx.actorA, { type: "DEAL", id: fx.recordsA.deal.id });
    const limitedEmailLogs = await crm.listEmailLogs(fx.actorA, { limit: 1.8 });
    const defaultedEmailLogs = await crm.listEmailLogs(fx.actorA, { limit: Number.NaN });
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
    expect(duplicateDeactivatedTemplate.active).toBe(false);
    expect(emailTemplateDeactivateAuditCountBeforeDuplicate).toBe(1);
    expect(emailTemplateDeactivateAuditCountAfterDuplicate).toBe(emailTemplateDeactivateAuditCountBeforeDuplicate);
    expect(activeTemplatesAfterDeactivate.map((item) => item.id)).not.toContain(template.id);
    expect(editedInactiveTemplate).toMatchObject({
      active: false,
      name: "Dormant follow-up",
      subject: "Dormant next steps",
      body: "Dormant template body."
    });
    expect(activeTemplatesAfterInactiveEdit.map((item) => item.id)).not.toContain(template.id);
    expect(reactivatedTemplate.active).toBe(true);
    expect(duplicateReactivatedTemplate.active).toBe(true);
    expect(emailTemplateReactivateAuditCountBeforeDuplicate).toBe(1);
    expect(emailTemplateReactivateAuditCountAfterDuplicate).toBe(emailTemplateReactivateAuditCountBeforeDuplicate);
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
    expect(emailLog.id).not.toBe("caller-controlled-email-log-id");
    expect(emailLog.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
    expect(emailLog).toMatchObject({
      provider: "GOOGLE_WORKSPACE",
      providerMessageId: "gmail-service-boundary-1",
      providerThreadId: "thread-service-boundary-1"
    });
    expect(dealEmailLogs.map((item) => item.id)).toContain(emailLog.id);
    expect(dealEmailLogs.map((item) => item.id)).toContain(latestEmailLog.id);
    expect(limitedEmailLogs.map((item) => item.id)).toEqual([latestEmailLog.id]);
    expect(defaultedEmailLogs.map((item) => item.id)).toEqual(expect.arrayContaining([emailLog.id, latestEmailLog.id]));
    expect(dealTimeline.find((item) => item.type === "email" && item.subject === "Dormant next steps")).toMatchObject({
      subject: "Dormant next steps",
      body: "Dormant template body.",
      direction: "OUTBOUND",
      fromText: "seller@example.test",
      toText: "buyer@example.test"
    });
    expect(activityCountAfter).toBe(activityCountBefore);
    expect(auditLogs.map((event) => event.action)).toEqual([
      "email_log.created",
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
    const emailLogCountBeforeMalformedInput = await fx.prisma.emailLog.count({ where: { workspaceId: fx.workspaceA.id } });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: { id: fx.recordsA.deal.id } as unknown as string,
        direction: "OUTBOUND",
        occurredAt: new Date(),
        subject: "Malformed attachment",
        body: "Should fail before Prisma."
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email log attachment ids must be text."
    });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: null as unknown as Date,
        subject: "Null date",
        body: "Should not become an epoch timestamp."
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email occurred date is required."
    });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date(),
        provider: "PERSONAL_GMAIL" as never,
        subject: "Invalid provider",
        body: "Should fail with a controlled validation error."
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email provider must be Google Workspace, Microsoft 365, or IMAP/SMTP."
    });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date(),
        providerMessageId: { id: "gmail-bad" } as unknown as string,
        subject: "Malformed provider id",
        body: "Should fail with a controlled validation error."
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email provider message id must be text."
    });
    await expect(
      crm.createEmailLog(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date(),
        subject: "Malformed body",
        body: { text: "Malformed body" } as unknown as string
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Email body is required."
    });
    expect(await fx.prisma.emailLog.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(
      emailLogCountBeforeMalformedInput
    );
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

  it("updates email templates partially and treats empty updates as read-only refreshes", async () => {
    const fx = currentFixture();
    const template = await crm.createEmailTemplate(fx.actorA, {
      name: "Partial update template",
      subject: "Original subject",
      body: "Original body."
    });

    await expect(crm.updateEmailTemplate(fx.actorA, template.id, null)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Email template update must be an object.",
      status: 422
    });
    const subjectOnlyUpdate = await crm.updateEmailTemplate(fx.actorA, template.id, {
      subject: "Subject-only update"
    });
    const auditCountBeforeMalformedUpdate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "email_template.updated",
        entityType: "EmailTemplate",
        entityId: template.id
      }
    });
    await expect(crm.updateEmailTemplate(fx.actorA, template.id, [] as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Email template update must be an object.",
      status: 422
    });
    const auditCountAfterMalformedUpdate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "email_template.updated",
        entityType: "EmailTemplate",
        entityId: template.id
      }
    });
    const templateAfterMalformedUpdate = await fx.prisma.emailTemplate.findUniqueOrThrow({ where: { id: template.id } });
    const auditCountBeforeNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "email_template.updated",
        entityType: "EmailTemplate",
        entityId: template.id
      }
    });
    const noopUpdate = await crm.updateEmailTemplate(fx.actorA, template.id, {});
    const unchangedUpdate = await crm.updateEmailTemplate(fx.actorA, template.id, {
      name: "  Partial update template  ",
      subject: "  Subject-only update  ",
      body: "  Original body.  ",
      active: true
    });
    const auditCountAfterNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "email_template.updated",
        entityType: "EmailTemplate",
        entityId: template.id
      }
    });

    expect(subjectOnlyUpdate).toMatchObject({
      name: "Partial update template",
      subject: "Subject-only update",
      body: "Original body.",
      active: true
    });
    expect(templateAfterMalformedUpdate).toMatchObject({
      name: "Partial update template",
      subject: "Subject-only update",
      body: "Original body.",
      active: true
    });
    expect(auditCountBeforeMalformedUpdate).toBe(1);
    expect(auditCountAfterMalformedUpdate).toBe(auditCountBeforeMalformedUpdate);
    expect(noopUpdate).toMatchObject({
      id: template.id,
      name: "Partial update template",
      subject: "Subject-only update",
      body: "Original body.",
      active: true
    });
    expect(noopUpdate.updatedAt.toISOString()).toBe(subjectOnlyUpdate.updatedAt.toISOString());
    expect(unchangedUpdate).toMatchObject({
      id: template.id,
      name: "Partial update template",
      subject: "Subject-only update",
      body: "Original body.",
      active: true
    });
    expect(unchangedUpdate.updatedAt.toISOString()).toBe(subjectOnlyUpdate.updatedAt.toISOString());
    expect(auditCountBeforeNoop).toBe(1);
    expect(auditCountAfterNoop).toBe(auditCountBeforeNoop);
  });

  it("rejects malformed record types for email log and timeline lookups", async () => {
    const fx = currentFixture();
    await crm.createEmailLog(fx.actorA, {
      organizationId: fx.recordsA.organization.id,
      direction: "INBOUND",
      occurredAt: new Date("2030-04-01T12:00:00.000Z"),
      subject: "Organization email history",
      body: "Should only be returned for explicit organization lookups."
    });

    await expect(
      crm.listEmailLogsForRecord(fx.actorA, {
        type: "ACCOUNT" as unknown as "ORGANIZATION",
        id: fx.recordsA.organization.id
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Email log record type must be DEAL, LEAD, PERSON, or ORGANIZATION."
    });
    await expect(
      crm.getRecordTimeline(fx.actorA, {
        type: "ACCOUNT" as unknown as "ORGANIZATION",
        id: fx.recordsA.organization.id
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Timeline record type must be DEAL, LEAD, PERSON, or ORGANIZATION."
    });
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

    const expectedSummary = {
      overdue: 2,
      dueToday: 1,
      upcoming: 1,
      unscheduled: 1,
      completed: 1,
      completedRecently: 1,
      openTotal: 5
    };
    const healthBeforeStaleAttachments = await crm.getFollowUpHealthSummary(fx.actorA, now);

    expect(await crm.getActivityWorkQueueSummary(fx.actorA, now)).toEqual(expectedSummary);

    const closedDealWithOverdueActivity = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      title: "Closed deal should not own urgent work",
      valueCents: 42000,
      currency: "USD"
    });
    const closedDealActivity = await crm.createActivity(fx.actorA, {
      dealId: closedDealWithOverdueActivity.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Closed deal overdue cleanup",
      dueAt: new Date("2030-01-14T10:00:00.000Z")
    });
    await crm.closeDeal(fx.actorA, closedDealWithOverdueActivity.id, { status: "WON" });

    const [summaryAfterClosedDeal, dashboardAfterClosedDeal, needsAttentionAfterClosedDeal] = await Promise.all([
      crm.getActivityWorkQueueSummary(fx.actorA, now),
      crm.getDashboardSummary(fx.actorA, now),
      crm.getNeedsAttentionSummary(fx.actorA, now)
    ]);

    expect(summaryAfterClosedDeal).toEqual(expectedSummary);
    expect(dashboardAfterClosedDeal.priorityActivities.map((activity) => activity.id)).not.toContain(closedDealActivity.id);
    expect(needsAttentionAfterClosedDeal.map((item) => item.id)).not.toContain(`activity-${closedDealActivity.id}`);

    await fx.prisma.activity.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: fx.recordsB.deal.id,
          type: "TASK",
          title: "Stale work queue activity",
          dueAt: new Date("2030-01-15T08:00:00.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: fx.recordsB.deal.id,
          type: "TASK",
          title: "Stale completed work queue activity",
          dueAt: new Date("2030-01-13T09:00:00.000Z"),
          completedAt: new Date("2030-01-13T12:30:00.000Z")
        }
      ]
    });

    expect(await crm.getActivityWorkQueueSummary(fx.actorA, now)).toEqual(expectedSummary);
    expect(await crm.getFollowUpHealthSummary(fx.actorA, now)).toEqual(healthBeforeStaleAttachments);

    await crm.updateActivity(fx.actorA, todayActivity.id, { completedAt: now });

    expect(await crm.getActivityWorkQueueSummary(fx.actorA, now)).toEqual({
      overdue: 2,
      dueToday: 0,
      upcoming: 1,
      unscheduled: 1,
      completed: 2,
      completedRecently: 2,
      openTotal: 4
    });
    await expect(crm.updateActivity(fx.actorA, todayActivity.id, { completedAt: null })).rejects.toMatchObject({
      code: "ACTIVITY_COMPLETED"
    });
    await expect(
      crm.updateActivity(fx.actorA, todayActivity.id, {
        dueAt: new Date("2030-01-16T11:00:00.000Z"),
        title: "Edited after completion"
      })
    ).rejects.toMatchObject({
      code: "ACTIVITY_COMPLETED",
      message: "Completed activities cannot be edited.",
      status: 409
    });
    await expect(crm.softDeleteActivity(fx.actorA, todayActivity.id)).rejects.toMatchObject({
      code: "ACTIVITY_COMPLETED",
      message: "Completed activities cannot be removed."
    });
    await expect(fx.prisma.activity.findUnique({ where: { id: todayActivity.id } })).resolves.toMatchObject({
      completedAt: now,
      deletedAt: null,
      dueAt: new Date("2030-01-15T09:00:00.000Z"),
      title: "Today contact follow-up"
    });
    await expect(
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityId: todayActivity.id,
          entityType: "Activity",
          action: "activity.updated"
        }
      })
    ).resolves.toBe(0);
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
    const unscheduledLeadActivity = await crm.createActivity(fx.actorA, {
      leadId: fx.recordsA.lead.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Filter unscheduled lead task"
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
    const staleCrossWorkspaceActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsB.deal.id,
        type: "TASK",
        title: "Filter stale cross-workspace attachment",
        dueAt: addHours(today, 9)
      }
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
    const unscheduledLeadPage = await crm.listActivitiesPage(
      fx.actorA,
      {
        status: "open",
        ownerId: fx.userA.id,
        relatedType: "lead",
        relatedId: fx.recordsA.lead.id,
        due: "unscheduled"
      },
      { page: 1, pageSize: 10 }
    );
    const recentlyCompletedPage = await crm.listActivitiesPage(
      fx.actorA,
      {
        status: "completed",
        ownerId: fx.userA.id,
        relatedType: "deal",
        relatedId: fx.recordsA.deal.id,
        completed: "recent"
      },
      { page: 1, pageSize: 10 }
    );
    const staleSearchPage = await crm.listActivitiesPage(
      fx.actorA,
      {
        q: "Filter stale cross-workspace attachment"
      },
      { page: 1, pageSize: 10 }
    );
    const staleRelatedPage = await crm.listActivitiesPage(
      fx.actorA,
      {
        relatedType: "deal",
        relatedId: fx.recordsB.deal.id
      },
      { page: 1, pageSize: 10 }
    );
    const completedActivityAuditLog = await fx.prisma.auditLog.findFirst({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Activity",
        entityId: completedDealActivity.id,
        action: "activity.created"
      }
    });
    const malformedRelatedType = "account" as unknown as "organization";

    expect(dueTodayPage.items.map((activity) => activity.id)).toEqual([todayDealActivity.id]);
    expect(overduePage.items.map((activity) => activity.id)).toEqual([overdueDealActivity.id]);
    expect(completedPage.items.map((activity) => activity.id)).toEqual([completedDealActivity.id]);
    expect(upcomingContactPage.items.map((activity) => activity.id)).toEqual([upcomingContactActivity.id]);
    expect(unscheduledLeadPage.items.map((activity) => activity.id)).toEqual([unscheduledLeadActivity.id]);
    expect(recentlyCompletedPage.items.map((activity) => activity.id)).toEqual([completedDealActivity.id]);
    expect(completedActivityAuditLog?.metadata).toMatchObject({
      title: "Filter completed deal meeting",
      completedAt: addHours(today, 11).toISOString()
    });
    expect(dueTodayPage.items.map((activity) => activity.title)).not.toContain("Filter other workspace noise");
    expect(staleSearchPage.items).toEqual([]);
    expect(staleRelatedPage.items).toEqual([]);
    await expect(crm.getActivity(fx.actorA, staleCrossWorkspaceActivity.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      crm.updateActivity(fx.actorA, staleCrossWorkspaceActivity.id, { title: "Edited stale attachment" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.softDeleteActivity(fx.actorA, staleCrossWorkspaceActivity.id)).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
    await expect(
      crm.listActivities(fx.actorA, {
        relatedType: malformedRelatedType,
        relatedId: fx.recordsA.organization.id
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Activity related type must be deal, lead, person, or organization."
    });
    await expect(
      crm.listActivitiesPage(
        fx.actorA,
        {
          relatedType: malformedRelatedType,
          relatedId: fx.recordsA.organization.id
        },
        { page: 1, pageSize: 10 }
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Activity related type must be deal, lead, person, or organization."
    });
    await expect(
      crm.listActivitiesPage(fx.actorA, { status: "stale" as unknown as "open" }, { page: 1, pageSize: 10 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Activity status filter must be open or completed."
    });
    await expect(
      crm.listActivitiesPage(fx.actorA, { due: "later" as unknown as "today" }, { page: 1, pageSize: 10 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Activity due filter must be overdue, today, upcoming, or unscheduled."
    });
    await expect(
      crm.listActivitiesPage(fx.actorA, { completed: "all" as unknown as "recent" }, { page: 1, pageSize: 10 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Activity completed filter must be recent."
    });
  });

  it("filters deals and leads by missing or due follow-up state", async () => {
    const fx = currentFixture();
    const today = startOfLocalDay(new Date());
    const yesterday = addDays(today, -1);
    const missingDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Follow-up filter missing deal",
      valueCents: 1000,
      currency: "USD"
    });
    const overdueDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Follow-up filter overdue deal",
      valueCents: 2000,
      currency: "USD"
    });
    await crm.createActivity(fx.actorA, {
      dealId: overdueDeal.id,
      ownerId: fx.userA.id,
      type: "CALL",
      title: "Follow-up filter overdue activity",
      dueAt: addHours(yesterday, 9)
    });
    const missingLead = await crm.createLead(fx.actorA, {
      ownerId: fx.userA.id,
      title: "Follow-up filter missing lead",
      status: "QUALIFIED"
    });
    const todayLead = await crm.createLead(fx.actorA, {
      ownerId: fx.userA.id,
      title: "Follow-up filter today lead",
      status: "NEW"
    });
    await crm.createActivity(fx.actorA, {
      leadId: todayLead.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Follow-up filter today activity",
      dueAt: addHours(today, 9)
    });

    const [missingDeals, overdueDeals, missingLeads, todayLeads] = await Promise.all([
      crm.listDealsPage(fx.actorA, { q: "Follow-up filter", followUp: "missing" }, { page: 1, pageSize: 20 }),
      crm.listDealsPage(fx.actorA, { q: "Follow-up filter", followUp: "overdue" }, { page: 1, pageSize: 20 }),
      crm.listLeadsPage(fx.actorA, { q: "Follow-up filter", followUp: "missing" }, { page: 1, pageSize: 20 }),
      crm.listLeadsPage(fx.actorA, { q: "Follow-up filter", followUp: "today" }, { page: 1, pageSize: 20 })
    ]);

    expect(missingDeals.items.map((deal) => deal.id)).toContain(missingDeal.id);
    expect(missingDeals.items.map((deal) => deal.id)).not.toContain(overdueDeal.id);
    expect(overdueDeals.items.map((deal) => deal.id)).toEqual([overdueDeal.id]);
    expect(missingLeads.items.map((lead) => lead.id)).toContain(missingLead.id);
    expect(missingLeads.items.map((lead) => lead.id)).not.toContain(todayLead.id);
    expect(todayLeads.items.map((lead) => lead.id)).toEqual([todayLead.id]);
    await expect(
      crm.listDealsPage(
        fx.actorA,
        { q: "Follow-up filter", followUp: "someday" as unknown as "unscheduled" },
        { page: 1, pageSize: 20 }
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Deal follow-up filter must be missing, overdue, today, upcoming, or unscheduled."
    });
    await expect(
      crm.listLeadsPage(
        fx.actorA,
        { q: "Follow-up filter", followUp: "someday" as unknown as "unscheduled" },
        { page: 1, pageSize: 20 }
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Lead follow-up filter must be missing, overdue, today, upcoming, or unscheduled."
    });
  });

  it("rejects malformed deal and lead list status filters", async () => {
    const fx = currentFixture();

    await expect(
      crm.listDealsPage(fx.actorA, { status: "ARCHIVED" as unknown as "OPEN" }, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Deal status filter must be OPEN, WON, or LOST."
    });
    await expect(
      crm.listLeadsPage(fx.actorA, { status: "ARCHIVED" as unknown as "NEW" }, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Lead status filter must be NEW, QUALIFIED, DISQUALIFIED, or CONVERTED."
    });
  });

  it("rejects malformed CRM list sort filters before querying", async () => {
    const fx = currentFixture();

    await expect(
      crm.listDealsPage(fx.actorA, { sortBy: "probability" as unknown as "updatedAt" }, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Deal sort field must be createdAt, updatedAt, title, valueCents, or expectedCloseAt."
    });
    await expect(
      crm.listLeadsPage(fx.actorA, { sortDirection: "sideways" as unknown as "desc" }, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Lead sort direction must be asc or desc."
    });
    await expect(
      crm.listPeoplePage(fx.actorA, { sortBy: "email" as unknown as "name" }, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Contact sort field must be createdAt, updatedAt, or name."
    });
    await expect(
      crm.listOrganizationsPage(fx.actorA, { sortDirection: "sideways" as unknown as "asc" }, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Organization sort direction must be asc or desc."
    });
    await expect(
      crm.listActivitiesPage(fx.actorA, { sortBy: "owner" as unknown as "dueAt" }, { page: 1, pageSize: 20 })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Activity sort field must be createdAt, updatedAt, title, dueAt, or completedAt."
    });
  });

  it("normalizes malformed CRM list pagination before querying", async () => {
    const fx = currentFixture();
    const malformedPagination = { page: Number.NaN, pageSize: Number.POSITIVE_INFINITY } as never;
    const pages = await Promise.all([
      crm.listDealsPage(fx.actorA, {}, malformedPagination),
      crm.listLeadsPage(fx.actorA, {}, malformedPagination),
      crm.listPeoplePage(fx.actorA, {}, malformedPagination),
      crm.listOrganizationsPage(fx.actorA, {}, malformedPagination),
      crm.listActivitiesPage(fx.actorA, {}, malformedPagination)
    ]);

    for (const page of pages) {
      expect(page).toMatchObject({
        page: 1,
        pageSize: 10,
        skip: 0
      });
      expect(page.items.length).toBeGreaterThan(0);
    }
  });

  it("filters deals by commercial quote and line-item state", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Commercial filter package",
      unitPriceCents: 42000,
      currency: "USD"
    });
    const noQuoteDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Commercial filter no quote",
      valueCents: 42000,
      currency: "USD"
    });
    const quotedDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Commercial filter quoted",
      valueCents: 42000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: quotedDeal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, quotedDeal.id);
    await crm.updateQuoteStatus(fx.actorA, quote.id, "SENT");
    await crm.updateQuoteStatus(fx.actorA, quote.id, "ACCEPTED");

    const [noQuote, hasQuote, acceptedQuote, valueNoLineItems] = await Promise.all([
      crm.listDealsPage(fx.actorA, { q: "Commercial filter", commercial: "noQuote" }, { page: 1, pageSize: 20 }),
      crm.listDealsPage(fx.actorA, { q: "Commercial filter", commercial: "hasQuote" }, { page: 1, pageSize: 20 }),
      crm.listDealsPage(fx.actorA, { q: "Commercial filter", commercial: "acceptedQuote" }, { page: 1, pageSize: 20 }),
      crm.listDealsPage(fx.actorA, { q: "Commercial filter", commercial: "valueNoLineItems" }, { page: 1, pageSize: 20 })
    ]);

    expect(noQuote.items.map((deal) => deal.id)).toContain(noQuoteDeal.id);
    expect(noQuote.items.map((deal) => deal.id)).not.toContain(quotedDeal.id);
    expect(hasQuote.items.map((deal) => deal.id)).toEqual([quotedDeal.id]);
    expect(acceptedQuote.items.map((deal) => deal.id)).toEqual([quotedDeal.id]);
    expect(valueNoLineItems.items.map((deal) => deal.id)).toContain(noQuoteDeal.id);
    expect(valueNoLineItems.items.map((deal) => deal.id)).not.toContain(quotedDeal.id);
    await expect(
      crm.listDealsPage(
        fx.actorA,
        { q: "Commercial filter", commercial: "staleQuote" as unknown as "hasQuote" },
        { page: 1, pageSize: 20 }
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Deal commercial filter must be noQuote, hasQuote, acceptedQuote, or valueNoLineItems."
    });
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
    const staleMissingNextActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: deal.id,
        personId: fx.recordsB.person.id,
        type: "TASK",
        title: "Stale next-step activity",
        dueAt: tomorrow
      }
    });

    const beforeReport = await crm.getDealReport(fx.actorA, { q: "Activity polish no next" });
    const limitedMissingNext = await crm.listRecordsMissingNextActivity(fx.actorA, "deal", { take: 1.8 });
    const defaultedMissingNext = await crm.listRecordsMissingNextActivity(fx.actorA, "deal", {
      take: Number.POSITIVE_INFINITY
    });

    expect(beforeReport.metrics.dealsWithNoNextActivity).toBe(1);
    expect(limitedMissingNext).toHaveLength(1);
    expect(limitedMissingNext[0]?.type).toBe("deal");
    expect(limitedMissingNext.map((item) => item.id)).not.toContain(fx.recordsB.deal.id);
    expect(defaultedMissingNext.map((item) => item.id)).toContain(deal.id);
    expect(defaultedMissingNext.map((item) => item.id)).not.toContain(fx.recordsB.deal.id);
    await expect(crm.listActivities(fx.actorA, { relatedType: "deal", relatedId: deal.id })).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: staleMissingNextActivity.id })])
    );
    await expect(crm.listRecordsMissingNextActivity(fx.actorA, "account" as unknown as "lead")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Missing-next-activity record type must be deal or lead."
    });
    await expect(
      crm.createActivity(fx.actorA, {
        dealId: deal.id,
        ownerId: fx.userA.id,
        type: "TASK",
        title: "Invalid due activity",
        dueAt: new Date("not-a-date")
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Activity due date is invalid."
    });

    const activity = await crm.createActivity(fx.actorA, {
      dealId: deal.id,
      ownerId: fx.userA.id,
      type: "TASK",
      title: "Draft next-step recap",
      dueAt: tomorrow
    });
    const updatedDueAt = new Date(tomorrow);
    updatedDueAt.setDate(updatedDueAt.getDate() + 1);
    await expect(
      crm.updateActivity(fx.actorA, activity.id, {
        completedAt: new Date("not-a-date")
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Activity completed date is invalid."
    });
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
    const noActivityLead = await crm.createLead(fx.actorA, {
      ownerId: fx.userA.id,
      title: "Assistant no-activity lead",
      source: "Referral"
    });
    const overdueActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      ownerId: fx.userA.id,
      type: "CALL",
      title: "Assistant overdue call",
      dueAt: overdueAt
    });
    await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        leadId: noActivityLead.id,
        organizationId: fx.recordsB.organization.id,
        type: "TASK",
        title: "Stale assistant lead activity",
        dueAt: new Date("2030-03-21T09:00:00.000Z")
      }
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
        }),
        expect.objectContaining({
          actionHref: `/leads/${noActivityLead.id}`,
          href: `/leads/${noActivityLead.id}`,
          kind: "lead-no-activity",
          reason: "This active lead has no next activity.",
          title: "Assistant no-activity lead"
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
    await expect(
      crm.createPipeline(fx.actorA, {
        name: { text: "Malformed Pipeline" },
        sortOrder: 2
      } as never)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Pipeline name is required."
    });
    await expect(
      crm.createStage(fx.actorA, fx.recordsA.pipeline.id, {
        name: "Malformed Description Stage",
        description: "Should not be accepted",
        sortOrder: 4
      } as never)
    ).resolves.toMatchObject({
      name: "Malformed Description Stage",
      sortOrder: 4
    });
    const boundaryPipeline = await crm.createPipeline(fx.actorA, {
      name: "   Service Boundary Pipeline   ",
      sortOrder: { set: 2 },
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      workspaceId: fx.workspaceB.id
    } as never);
    const boundaryStage = await crm.createStage(fx.actorA, fx.recordsA.pipeline.id, {
      name: "   Service Boundary Stage   ",
      probability: { set: 55 },
      sortOrder: { set: 5 },
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      pipelineId: fx.recordsB.pipeline.id,
      workspaceId: fx.workspaceB.id
    } as never);
    const hardenedPipeline = await crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, {
      name: "   Enterprise Sales Hardened   ",
      sortOrder: { set: 2 },
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      workspaceId: fx.workspaceB.id
    } as never);
    const hardenedStage = await crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, {
      name: "   Discovery Complete Hardened   ",
      probability: { set: 46 },
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      pipelineId: fx.recordsB.pipeline.id,
      workspaceId: fx.workspaceB.id
    } as never);
    const [pipelineUpdateAuditCountBeforeNoop, stageUpdateAuditCountBeforeNoop] = await Promise.all([
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "pipeline.updated",
          entityType: "Pipeline",
          entityId: fx.recordsA.pipeline.id
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "stage.updated",
          entityType: "PipelineStage",
          entityId: fx.recordsA.stageOne.id
        }
      })
    ]);
    const noopPipeline = await crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, {
      name: "  Enterprise Sales Hardened  ",
      sortOrder: { set: 2 }
    } as never);
    const emptyPipelineUpdate = await crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, {});
    const noopStage = await crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, {
      name: "  Discovery Complete Hardened  ",
      probability: { set: 46 }
    } as never);
    const emptyStageUpdate = await crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, {});
    const [pipelineUpdateAuditCountAfterNoop, stageUpdateAuditCountAfterNoop] = await Promise.all([
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "pipeline.updated",
          entityType: "Pipeline",
          entityId: fx.recordsA.pipeline.id
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "stage.updated",
          entityType: "PipelineStage",
          entityId: fx.recordsA.stageOne.id
        }
      })
    ]);
    const [boundaryPipelineRow, boundaryStageRow, hardenedPipelineRow, hardenedStageRow] = await Promise.all([
      fx.prisma.pipeline.findUniqueOrThrow({ where: { id: boundaryPipeline.id } }),
      fx.prisma.pipelineStage.findUniqueOrThrow({ where: { id: boundaryStage.id } }),
      fx.prisma.pipeline.findUniqueOrThrow({ where: { id: fx.recordsA.pipeline.id } }),
      fx.prisma.pipelineStage.findUniqueOrThrow({ where: { id: fx.recordsA.stageOne.id } })
    ]);
    const [pipelineUpdateAuditCountBeforeMalformedUpdate, stageUpdateAuditCountBeforeMalformedUpdate] = await Promise.all([
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "pipeline.updated",
          entityType: "Pipeline",
          entityId: fx.recordsA.pipeline.id
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "stage.updated",
          entityType: "PipelineStage",
          entityId: fx.recordsA.stageOne.id
        }
      })
    ]);
    await expect(crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Pipeline update must be an object."
    });
    await expect(crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, [] as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Pipeline update must be an object."
    });
    await expect(crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Stage update must be an object."
    });
    await expect(crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, [] as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Stage update must be an object."
    });
    const [
      pipelineUpdateAuditCountAfterMalformedUpdate,
      stageUpdateAuditCountAfterMalformedUpdate,
      pipelineAfterMalformedUpdate,
      stageAfterMalformedUpdate
    ] = await Promise.all([
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "pipeline.updated",
          entityType: "Pipeline",
          entityId: fx.recordsA.pipeline.id
        }
      }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          action: "stage.updated",
          entityType: "PipelineStage",
          entityId: fx.recordsA.stageOne.id
        }
      }),
      fx.prisma.pipeline.findUniqueOrThrow({ where: { id: fx.recordsA.pipeline.id } }),
      fx.prisma.pipelineStage.findUniqueOrThrow({ where: { id: fx.recordsA.stageOne.id } })
    ]);
    await expect(
      crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, {
        sortOrder: sortOrderIntColumnMax + 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Sort order is too large."
    });
    await expect(
      crm.createStage(fx.actorA, fx.recordsA.pipeline.id, {
        name: "Overflow Stage",
        sortOrder: sortOrderIntColumnMax + 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Sort order is too large."
    });
    await expect(
      crm.updatePipeline(fx.actorA, fx.recordsA.pipeline.id, {
        sortOrder: "late" as unknown as number
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Sort order must be a whole number."
    });
    await expect(
      crm.createStage(fx.actorA, fx.recordsA.pipeline.id, {
        name: "Impossible Forecast Stage",
        probability: stageProbabilityMax + 1,
        sortOrder: 4
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Stage probability must be between 0 and 100."
    });
    await expect(
      crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, {
        probability: stageProbabilityMin - 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Stage probability must be between 0 and 100."
    });
    await expect(
      crm.updateStage(fx.actorA, fx.recordsA.stageOne.id, {
        probability: { set: "high" } as unknown as number
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Stage probability must be a whole number."
    });
    const pipelines = await crm.listPipelines(fx.actorA);
    const pipeline = pipelines.find((item) => item.id === fx.recordsA.pipeline.id);

    expect(renamedPipeline.name).toBe("Enterprise Sales");
    expect(renamedStage).toMatchObject({ name: "Discovery Complete", probability: 45 });
    expect(addedStage).toMatchObject({ name: "Legal Review", probability: 70 });
    expect(boundaryPipeline).toMatchObject({ name: "Service Boundary Pipeline", sortOrder: 2 });
    expect(boundaryPipelineRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      deletedAt: null
    });
    expect(boundaryStage).toMatchObject({
      name: "Service Boundary Stage",
      probability: 55,
      sortOrder: 5
    });
    expect(boundaryStageRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      pipelineId: fx.recordsA.pipeline.id,
      deletedAt: null
    });
    expect(hardenedPipeline).toMatchObject({ name: "Enterprise Sales Hardened", sortOrder: 2 });
    expect(noopPipeline).toMatchObject({ name: "Enterprise Sales Hardened", sortOrder: 2 });
    expect(emptyPipelineUpdate).toMatchObject({ name: "Enterprise Sales Hardened", sortOrder: 2 });
    expect(hardenedPipelineRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      deletedAt: null
    });
    expect(pipelineAfterMalformedUpdate).toMatchObject({
      workspaceId: fx.workspaceA.id,
      name: "Enterprise Sales Hardened",
      sortOrder: 2,
      deletedAt: null
    });
    expect(pipelineUpdateAuditCountBeforeNoop).toBe(2);
    expect(pipelineUpdateAuditCountAfterNoop).toBe(pipelineUpdateAuditCountBeforeNoop);
    expect(pipelineUpdateAuditCountBeforeMalformedUpdate).toBe(2);
    expect(pipelineUpdateAuditCountAfterMalformedUpdate).toBe(pipelineUpdateAuditCountBeforeMalformedUpdate);
    expect(hardenedStage).toMatchObject({ name: "Discovery Complete Hardened", probability: 46 });
    expect(noopStage).toMatchObject({ name: "Discovery Complete Hardened", probability: 46 });
    expect(emptyStageUpdate).toMatchObject({ name: "Discovery Complete Hardened", probability: 46 });
    expect(hardenedStageRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      pipelineId: fx.recordsA.pipeline.id,
      deletedAt: null
    });
    expect(stageAfterMalformedUpdate).toMatchObject({
      workspaceId: fx.workspaceA.id,
      pipelineId: fx.recordsA.pipeline.id,
      name: "Discovery Complete Hardened",
      probability: 46,
      deletedAt: null
    });
    expect(stageUpdateAuditCountBeforeNoop).toBe(2);
    expect(stageUpdateAuditCountAfterNoop).toBe(stageUpdateAuditCountBeforeNoop);
    expect(stageUpdateAuditCountBeforeMalformedUpdate).toBe(2);
    expect(stageUpdateAuditCountAfterMalformedUpdate).toBe(stageUpdateAuditCountBeforeMalformedUpdate);
    expect(pipeline?.stages.map((stage) => stage.name)).toContain("Legal Review");
    expect(pipeline?.stages.map((stage) => stage.name)).not.toContain("Impossible Forecast Stage");
    expect(pipeline?.stages.find((stage) => stage.id === fx.recordsA.stageOne.id)?.probability).toBe(46);
    await expect(
      crm.updateStage(fx.actorA, fx.recordsB.stageOne.id, { name: "Cross-workspace rename" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocks pipeline and stage deletion while active deals still depend on them", async () => {
    const fx = currentFixture();
    const unusedPipeline = await crm.createPipeline(fx.actorA, {
      name: "Unused deletion pipeline",
      sortOrder: 99
    });
    const unusedStage = await crm.createStage(fx.actorA, unusedPipeline.id, {
      name: "Unused deletion stage",
      sortOrder: 1
    });

    await expect(crm.softDeletePipeline(fx.actorA, fx.recordsA.pipeline.id)).rejects.toMatchObject({
      code: "PIPELINE_IN_USE",
      message: "Move or delete active deals before deleting this pipeline.",
      status: 409
    });
    await expect(crm.softDeleteStage(fx.actorA, fx.recordsA.stageOne.id)).rejects.toMatchObject({
      code: "STAGE_IN_USE",
      message: "Move or delete active deals before deleting this stage.",
      status: 409
    });
    await crm.softDeleteStage(fx.actorA, unusedStage.id);
    await crm.softDeletePipeline(fx.actorA, unusedPipeline.id);

    await expect(fx.prisma.pipeline.findUnique({ where: { id: fx.recordsA.pipeline.id } })).resolves.toMatchObject({
      deletedAt: null
    });
    await expect(fx.prisma.pipelineStage.findUnique({ where: { id: fx.recordsA.stageOne.id } })).resolves.toMatchObject({
      deletedAt: null
    });
    await expect(fx.prisma.pipeline.findUnique({ where: { id: unusedPipeline.id } })).resolves.toMatchObject({
      deletedAt: expect.any(Date)
    });
    await expect(fx.prisma.pipelineStage.findUnique({ where: { id: unusedStage.id } })).resolves.toMatchObject({
      deletedAt: expect.any(Date)
    });
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
    const activityCountBeforeMalformedTemplate = await fx.prisma.activity.count({
      where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id }
    });
    await expect(
      crm.createAutomationTemplateActivity(fx.actorA, {
        dealId: fx.recordsA.deal.id,
        templateId: "unknown-template" as unknown as AutomationTemplateId
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Automation template is not available."
    });
    await expect(
      crm.createAutomationTemplateActivity(fx.actorA, {
        dealId: { id: fx.recordsA.deal.id } as unknown as string,
        templateId: "deal-next-activity"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Automation target ids must be text."
    });
    await expect(
      crm.createAutomationTemplateActivity(
        fx.actorA,
        {
          dealId: fx.recordsA.deal.id,
          templateId: "deal-next-activity"
        },
        new Date("not-a-date")
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Automation template timestamp is invalid."
    });
    expect(await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id } })).toBe(
      activityCountBeforeMalformedTemplate
    );
    const staleAutomationActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: fx.recordsA.deal.id,
        personId: fx.recordsB.person.id,
        ownerId: fx.userA.id,
        type: "EMAIL",
        title: `Quote follow-up: ${fx.recordsA.deal.title}`,
        dueAt: new Date("2030-02-01T09:00:00.000Z")
      }
    });
    const leadOutreach = await crm.createAutomationTemplateActivity(fx.actorA, {
      leadId: fx.recordsA.lead.id,
      templateId: "lead-first-outreach"
    });
    const quoteFollowUp = await crm.createAutomationTemplateActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      templateId: "quote-follow-up"
    });
    const activities = await crm.listActivities(fx.actorA, { relatedType: "deal", relatedId: fx.recordsA.deal.id });
    const leadActivities = await crm.listActivities(fx.actorA, { relatedType: "lead", relatedId: fx.recordsA.lead.id });

    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ activityId: first.activityId, created: false });
    expect(quoteFollowUp).toMatchObject({ created: true });
    expect(quoteFollowUp.activityId).not.toBe(staleAutomationActivity.id);
    expect(activities.filter((activity) => activity.title === "Schedule next step: Alpha Needle Deal")).toHaveLength(1);
    expect(activities.filter((activity) => activity.title === "Quote follow-up: Alpha Needle Deal")).toHaveLength(1);
    expect(activities.map((activity) => activity.id)).not.toContain(staleAutomationActivity.id);
    expect(leadOutreach.created).toBe(true);
    expect(leadActivities.map((activity) => activity.title)).toContain("First outreach: Alpha Needle Lead");
    await expect(
      crm.createAutomationTemplateActivity(fx.actorA, {
        dealId: fx.recordsB.deal.id,
        templateId: "deal-next-activity"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps deal automation templates aligned with deal lifecycle", async () => {
    const fx = currentFixture();
    const wonDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Automation won lifecycle",
      valueCents: 100000,
      currency: "USD"
    });
    const lostDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      title: "Automation lost lifecycle",
      valueCents: 75000,
      currency: "USD"
    });

    await crm.closeDeal(fx.actorA, wonDeal.id, { status: "WON" });
    await crm.closeDeal(fx.actorA, lostDeal.id, { status: "LOST", lostReason: "Timing" });

    for (const templateId of ["deal-next-activity", "deal-proposal-follow-up", "quote-follow-up", "contract-follow-up"] as const) {
      await expect(
        crm.createAutomationTemplateActivity(fx.actorA, {
          dealId: wonDeal.id,
          templateId
        })
      ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });
    }

    const handoff = await crm.createAutomationTemplateActivity(fx.actorA, {
      dealId: wonDeal.id,
      templateId: "post-sale-handoff"
    });
    const reengagement = await crm.createAutomationTemplateActivity(fx.actorA, {
      dealId: lostDeal.id,
      templateId: "lost-reengagement"
    });
    const activities = await fx.prisma.activity.findMany({
      where: {
        workspaceId: fx.workspaceA.id,
        dealId: { in: [wonDeal.id, lostDeal.id] }
      },
      orderBy: { title: "asc" }
    });

    expect(handoff.created).toBe(true);
    expect(reengagement.created).toBe(true);
    expect(activities.map((activity) => activity.title)).toEqual([
      "Post-sale handoff: Automation won lifecycle",
      "Re-engage later: Automation lost lifecycle"
    ]);
  });

  it("keeps search results scoped to the current workspace", async () => {
    const fx = currentFixture();
    const product = await crm.createProduct(fx.actorA, {
      name: "Search Boundary Package",
      unitPriceCents: 88000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const validQuote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const validEmailLog = await crm.createEmailLog(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      direction: "OUTBOUND",
      occurredAt: new Date("2030-02-01T09:30:00.000Z"),
      fromText: "seller@example.test",
      toText: "buyer@example.test",
      subject: "Needle account email follow-up",
      body: "Search should include this valid workspace email log."
    });
    const mismatchedQuote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await fx.prisma.quote.update({
      where: { id: mismatchedQuote.id },
      data: { dealId: fx.recordsB.deal.id }
    });
    const directRelationDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        title: "Search boundary direct relation deal",
        valueCents: 33000,
        currency: "USD"
      }
    });
    const directRelationLead = await fx.prisma.lead.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        title: "Search boundary direct relation lead",
        source: "Boundary search"
      }
    });
    const directRelationPerson = await fx.prisma.person.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        organizationId: fx.recordsB.organization.id,
        firstName: "Search",
        lastName: "Boundary",
        email: "search-boundary@example.test"
      }
    });
    const directRelationQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: directRelationDeal.id,
        number: "Q-SEARCH-BOUNDARY",
        status: "DRAFT",
        currency: "USD",
        subtotalCents: 33000,
        totalCents: 33000
      }
    });
    const typoRankClosedDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        title: "Needle Priority Closed Search",
        valueCents: 15000,
        currency: "USD",
        status: "WON"
      }
    });
    const typoRankOpenDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        title: "Needle Priority Open Search",
        valueCents: 25000,
        currency: "USD",
        status: "OPEN"
      }
    });
    const deletedOrganization = await fx.prisma.organization.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        name: "Search Boundary Softgone Customer",
        deletedAt: new Date("2030-02-01T08:00:00.000Z")
      }
    });
    const deletedOrganizationDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        organizationId: deletedOrganization.id,
        title: "Quote boundary active deal",
        valueCents: 44000,
        currency: "USD"
      }
    });
    const deletedOrganizationQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: deletedOrganizationDeal.id,
        number: "Q-SEARCH-DELETED-ORG",
        status: "DRAFT",
        currency: "USD",
        subtotalCents: 44000,
        totalCents: 44000
      }
    });
    const deletedDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        title: "Search Boundary Deleted Deal",
        valueCents: 55000,
        currency: "USD",
        deletedAt: new Date("2030-02-01T08:30:00.000Z")
      }
    });
    const deletedDealQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: deletedDeal.id,
        number: "Q-SEARCH-DELETED-DEAL",
        status: "DRAFT",
        currency: "USD",
        subtotalCents: 55000,
        totalCents: 55000
      }
    });
    const deletedDealEmailLog = await fx.prisma.emailLog.create({
      data: {
        workspaceId: fx.workspaceA.id,
        createdById: fx.userA.id,
        dealId: deletedDeal.id,
        direction: "OUTBOUND",
        occurredAt: new Date("2030-02-01T10:30:00.000Z"),
        subject: "Search boundary deleted deal email",
        body: "Should not surface email context attached to a deleted deal."
      }
    });
    const mismatchedActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsB.deal.id,
        type: "TASK",
        title: "Search boundary mismatched activity",
        dueAt: new Date("2030-02-01T09:00:00.000Z")
      }
    });
    const mismatchedNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        personId: fx.recordsB.person.id,
        body: "Search boundary mismatched note"
      }
    });
    const mismatchedEmailLog = await fx.prisma.emailLog.create({
      data: {
        workspaceId: fx.workspaceA.id,
        createdById: fx.userA.id,
        organizationId: fx.recordsB.organization.id,
        direction: "OUTBOUND",
        occurredAt: new Date("2030-02-01T10:00:00.000Z"),
        subject: "Search boundary mismatched email",
        body: "Should not surface cross-workspace related context."
      }
    });

    const malformedQueryResults = await crm.searchCrm(fx.actorA, { q: "needle" } as unknown as string);
    const overlongQueryResults = await crm.searchCrm(fx.actorA, ` ${"x".repeat(200)} `);
    const results = await crm.searchCrm(fx.actorA, "  needle  ");
    const validQuoteResults = await crm.searchCrm(fx.actorA, validQuote.number);
    const quoteContactResults = await crm.searchCrm(fx.actorA, fx.recordsA.person.email ?? fx.recordsA.person.firstName);
    const mismatchedQuoteResults = await crm.searchCrm(fx.actorA, mismatchedQuote.number);
    const mismatchedActivityResults = await crm.searchCrm(fx.actorA, mismatchedActivity.title);
    const mismatchedNoteResults = await crm.searchCrm(fx.actorA, mismatchedNote.body);
    const mismatchedEmailResults = await crm.searchCrm(fx.actorA, mismatchedEmailLog.subject);
    const directDealResults = await crm.searchCrm(fx.actorA, directRelationDeal.title);
    const directLeadResults = await crm.searchCrm(fx.actorA, directRelationLead.title);
    const directPersonResults = await crm.searchCrm(fx.actorA, directRelationPerson.email ?? "");
    const directQuoteResults = await crm.searchCrm(fx.actorA, directRelationQuote.number);
    const typoRankResults = await crm.searchCrm(fx.actorA, "Nedle Prority");
    const crossWorkspaceOrganizationResults = await crm.searchCrm(fx.actorA, fx.recordsB.organization.name);
    const crossWorkspacePersonResults = await crm.searchCrm(fx.actorA, fx.recordsB.person.email ?? fx.recordsB.person.firstName);
    const deletedOrganizationResults = await crm.searchCrm(fx.actorA, deletedOrganization.name);
    const deletedDealQuoteResults = await crm.searchCrm(fx.actorA, deletedDealQuote.number);
    const deletedDealEmailResults = await crm.searchCrm(fx.actorA, deletedDealEmailLog.subject);
    const [activityList, emailLogList] = await Promise.all([crm.listActivities(fx.actorA), crm.listEmailLogs(fx.actorA)]);
    const directDealResult = directDealResults.deals.find((deal) => deal.id === directRelationDeal.id);
    const directLeadResult = directLeadResults.leads.find((lead) => lead.id === directRelationLead.id);
    const directPersonResult = directPersonResults.people.find((person) => person.id === directRelationPerson.id);
    const directQuoteResult = directQuoteResults.quotes.find((quote) => quote.id === directRelationQuote.id);

    expect(malformedQueryResults).toMatchObject({
      query: "",
      deals: [],
      leads: [],
      people: [],
      organizations: [],
      activities: [],
      notes: [],
      quotes: [],
      emailLogs: []
    });
    expect(overlongQueryResults.query).toBe("x".repeat(120));
    expect(overlongQueryResults.deals).toEqual([]);
    expect(results.query).toBe("needle");
    expect(results.deals.map((deal) => deal.id)).toContain(fx.recordsA.deal.id);
    expect(results.deals.map((deal) => deal.id)).not.toContain(fx.recordsB.deal.id);
    expect(results.leads.map((lead) => lead.id)).toContain(fx.recordsA.lead.id);
    expect(results.leads.map((lead) => lead.id)).not.toContain(fx.recordsB.lead.id);
    expect(results.activities.map((activity) => activity.id)).toContain(fx.recordsA.activity.id);
    expect(results.activities.map((activity) => activity.id)).not.toContain(fx.recordsB.activity.id);
    expect(results.notes.map((note) => note.id)).toContain(fx.recordsA.note.id);
    expect(results.notes.map((note) => note.id)).not.toContain(fx.recordsB.note.id);
    expect(results.emailLogs.map((emailLog) => emailLog.id)).toContain(validEmailLog.id);
    expect(validQuoteResults.quotes.map((quote) => quote.id)).toContain(validQuote.id);
    expect(quoteContactResults.quotes.map((quote) => quote.id)).toContain(validQuote.id);
    expect(mismatchedQuoteResults.quotes.map((quote) => quote.id)).not.toContain(mismatchedQuote.id);
    expect(mismatchedQuoteResults.quotes.map((quote) => quote.dealId)).not.toContain(fx.recordsB.deal.id);
    expect(mismatchedActivityResults.activities.map((activity) => activity.id)).not.toContain(mismatchedActivity.id);
    expect(mismatchedNoteResults.notes.map((note) => note.id)).not.toContain(mismatchedNote.id);
    expect(mismatchedEmailResults.emailLogs.map((emailLog) => emailLog.id)).not.toContain(mismatchedEmailLog.id);
    expect(directDealResult).toMatchObject({ person: null, organization: null });
    expect(directLeadResult).toMatchObject({ person: null, organization: null });
    expect(directPersonResult).toMatchObject({ organization: null });
    expect(directQuoteResult?.deal).toMatchObject({ person: null, organization: null });
    expect(typoRankResults.deals.map((deal) => deal.id)).toContain(typoRankClosedDeal.id);
    expect(typoRankResults.deals.map((deal) => deal.id)[0]).toBe(typoRankOpenDeal.id);
    expect(crossWorkspaceOrganizationResults.quotes.map((quote) => quote.id)).not.toContain(directRelationQuote.id);
    expect(crossWorkspaceOrganizationResults.deals.map((deal) => deal.id)).not.toContain(directRelationDeal.id);
    expect(crossWorkspaceOrganizationResults.leads.map((lead) => lead.id)).not.toContain(directRelationLead.id);
    expect(crossWorkspaceOrganizationResults.people.map((person) => person.id)).not.toContain(directRelationPerson.id);
    expect(crossWorkspacePersonResults.quotes.map((quote) => quote.id)).not.toContain(directRelationQuote.id);
    expect(deletedOrganizationResults.quotes.map((quote) => quote.id)).not.toContain(deletedOrganizationQuote.id);
    expect(deletedOrganizationResults.quotes.map((quote) => quote.dealId)).not.toContain(deletedOrganizationDeal.id);
    expect(deletedDealQuoteResults.quotes.map((quote) => quote.id)).not.toContain(deletedDealQuote.id);
    expect(deletedDealQuoteResults.quotes.map((quote) => quote.dealId)).not.toContain(deletedDeal.id);
    expect(deletedDealEmailResults.emailLogs.map((emailLog) => emailLog.id)).not.toContain(deletedDealEmailLog.id);
    expect(deletedDealEmailResults.emailLogs.map((emailLog) => emailLog.dealId)).not.toContain(deletedDeal.id);
    expect(activityList.map((activity) => activity.id)).not.toContain(mismatchedActivity.id);
    expect(emailLogList.map((emailLog) => emailLog.id)).not.toContain(mismatchedEmailLog.id);
    expect(emailLogList.map((emailLog) => emailLog.id)).not.toContain(deletedDealEmailLog.id);
  });

  it("treats malformed CSV import text as empty input without creating records", async () => {
    const fx = currentFixture();
    const malformedCsv = { text: "name,title,pipeline,stage\nShould not import" };
    const countsBefore = await Promise.all([
      fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
    ]);

    const [organizationPreview, contactPreview, leadPreview, dealPreview] = await Promise.all([
      crm.previewOrganizationImport(fx.actorA, malformedCsv),
      crm.previewContactImport(fx.actorA, malformedCsv),
      crm.previewLeadImport(fx.actorA, malformedCsv),
      crm.previewDealImport(fx.actorA, malformedCsv)
    ]);
    const [organizationResult, contactResult, leadResult, dealResult] = await Promise.all([
      crm.importOrganizationsFromCsv(fx.actorA, malformedCsv),
      crm.importContactsFromCsv(fx.actorA, malformedCsv),
      crm.importLeadsFromCsv(fx.actorA, malformedCsv),
      crm.importDealsFromCsv(fx.actorA, malformedCsv)
    ]);

    for (const preview of [organizationPreview, contactPreview, leadPreview, dealPreview]) {
      expect(preview).toMatchObject({
        totalRows: 0,
        validRows: 0,
        duplicateRows: 0,
        invalidRows: 0,
        parseErrors: ["CSV text is required."],
        rows: []
      });
    }
    for (const result of [organizationResult, contactResult, leadResult, dealResult]) {
      expect(result).toMatchObject({
        createdCount: 0,
        skippedDuplicateCount: 0,
        skippedInvalidCount: 0,
        errorCount: 1,
        failedRows: [],
        preview: { parseErrors: ["CSV text is required."] }
      });
    }
    await expect(
      Promise.all([
        fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
      ])
    ).resolves.toEqual(countsBefore);
  });

  it("counts only non-empty data rows and blocks imports when CSV import previews are missing required headers", async () => {
    const fx = currentFixture();
    const organizationCsv = "unexpected,Custom: Region\nAcme,West\n,\nBeta,East";
    const contactCsv = "email,phone\njane@example.com,555-0100\n,\njohn@example.com,";
    const leadCsv = "source,status\nweb,NEW\n,\nreferral,QUALIFIED";
    const dealCsv = "value,currency\n10,USD\n,\n20,USD";
    const organizationMissingHeaderErrors = ["CSV must include a name column."];
    const contactMissingHeaderErrors = ["CSV must include a contact name or firstName column."];
    const leadMissingHeaderErrors = ["CSV must include a lead title or name column."];
    const dealMissingHeaderErrors = [
      "CSV must include a deal title, title, or name column.",
      "CSV must include a pipeline, pipelineName, or pipeline name column.",
      "CSV must include a stage, stageName, or stage name column."
    ];
    const countsBefore = await Promise.all([
      fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
    ]);

    const [organizationPreview, contactPreview, leadPreview, dealPreview] = await Promise.all([
      crm.previewOrganizationImport(fx.actorA, organizationCsv),
      crm.previewContactImport(fx.actorA, contactCsv),
      crm.previewLeadImport(fx.actorA, leadCsv),
      crm.previewDealImport(fx.actorA, dealCsv)
    ]);

    expect(organizationPreview).toMatchObject({
      totalRows: 2,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      unsupportedColumns: ["unexpected", "Custom: Region"],
      parseErrors: organizationMissingHeaderErrors,
      rows: []
    });
    expect(contactPreview).toMatchObject({
      totalRows: 2,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      parseErrors: contactMissingHeaderErrors,
      rows: []
    });
    expect(leadPreview).toMatchObject({
      totalRows: 2,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      parseErrors: leadMissingHeaderErrors,
      rows: []
    });
    expect(dealPreview).toMatchObject({
      totalRows: 2,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 0,
      parseErrors: dealMissingHeaderErrors,
      rows: []
    });

    const [organizationResult, contactResult, leadResult, dealResult] = await Promise.all([
      crm.importOrganizationsFromCsv(fx.actorA, organizationCsv),
      crm.importContactsFromCsv(fx.actorA, contactCsv),
      crm.importLeadsFromCsv(fx.actorA, leadCsv),
      crm.importDealsFromCsv(fx.actorA, dealCsv)
    ]);

    expect(organizationResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: organizationMissingHeaderErrors.length,
      failedRows: [],
      preview: {
        totalRows: 2,
        parseErrors: organizationMissingHeaderErrors,
        rows: []
      }
    });
    expect(contactResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: contactMissingHeaderErrors.length,
      failedRows: [],
      preview: {
        totalRows: 2,
        parseErrors: contactMissingHeaderErrors,
        rows: []
      }
    });
    expect(leadResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: leadMissingHeaderErrors.length,
      failedRows: [],
      preview: {
        totalRows: 2,
        parseErrors: leadMissingHeaderErrors,
        rows: []
      }
    });
    expect(dealResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: dealMissingHeaderErrors.length,
      failedRows: [],
      preview: {
        totalRows: 2,
        parseErrors: dealMissingHeaderErrors,
        rows: []
      }
    });
    await expect(
      Promise.all([
        fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
      ])
    ).resolves.toEqual(countsBefore);
  });

  it("rejects duplicate CSV import header aliases before preview rows can be created", async () => {
    const fx = currentFixture();
    const countsBefore = await Promise.all([
      fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
    ]);

    const organizationCsv = "Name,Organization   Name,Domain\nPrimary Org,Hidden Org,duplicate-org.example";
    const contactCsv = "Full Name,Name,Email\nPrimary Contact,Hidden Contact,duplicate-contact@example.test";
    const leadCsv = "Lead Title,Name,Source\nPrimary Lead,Hidden Lead,Website";
    const dealCsv = `Deal Title,Name,Pipeline,Stage\nPrimary Deal,Hidden Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name}`;
    const [organizationPreview, contactPreview, leadPreview, dealPreview] = await Promise.all([
      crm.previewOrganizationImport(fx.actorA, organizationCsv),
      crm.previewContactImport(fx.actorA, contactCsv),
      crm.previewLeadImport(fx.actorA, leadCsv),
      crm.previewDealImport(fx.actorA, dealCsv)
    ]);
    const [organizationResult, contactResult, leadResult, dealResult] = await Promise.all([
      crm.importOrganizationsFromCsv(fx.actorA, organizationCsv),
      crm.importContactsFromCsv(fx.actorA, contactCsv),
      crm.importLeadsFromCsv(fx.actorA, leadCsv),
      crm.importDealsFromCsv(fx.actorA, dealCsv)
    ]);

    expect(organizationPreview).toMatchObject({
      totalRows: 1,
      parseErrors: ["CSV includes duplicate organization name columns. Keep one organization name column before importing."],
      rows: []
    });
    expect(contactPreview).toMatchObject({
      totalRows: 1,
      parseErrors: ["CSV includes duplicate contact name columns. Keep one contact name column before importing."],
      rows: []
    });
    expect(leadPreview).toMatchObject({
      totalRows: 1,
      parseErrors: ["CSV includes duplicate lead title columns. Keep one lead title column before importing."],
      rows: []
    });
    expect(dealPreview).toMatchObject({
      totalRows: 1,
      parseErrors: ["CSV includes duplicate deal title columns. Keep one deal title column before importing."],
      rows: []
    });
    for (const result of [organizationResult, contactResult, leadResult, dealResult]) {
      expect(result).toMatchObject({
        createdCount: 0,
        skippedDuplicateCount: 0,
        skippedInvalidCount: 0,
        errorCount: 1,
        failedRows: []
      });
    }
    await expect(
      Promise.all([
        fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
      ])
    ).resolves.toEqual(countsBefore);
  });

  it("rejects malformed CSV import owner emails before creating rows", async () => {
    const fx = currentFixture();
    const invalidOwnerEmail = "not-an-email";
    const invalidOwnerEmailMessage = "Owner email must be a valid email address.";
    const countsBefore = await Promise.all([
      fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
      fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
    ]);
    const organizationCsv = `name,ownerEmail\nInvalid Owner Org,${invalidOwnerEmail}`;
    const contactCsv = `name,email,ownerEmail\nInvalid Owner Contact,invalid-owner-contact@example.test,${invalidOwnerEmail}`;
    const leadCsv = `title,ownerEmail\nInvalid Owner Lead,${invalidOwnerEmail}`;
    const dealCsv = [
      "title,pipeline,stage,ownerEmail",
      `Invalid Owner Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},${invalidOwnerEmail}`
    ].join("\n");

    const [organizationPreview, contactPreview, leadPreview, dealPreview] = await Promise.all([
      crm.previewOrganizationImport(fx.actorA, organizationCsv),
      crm.previewContactImport(fx.actorA, contactCsv),
      crm.previewLeadImport(fx.actorA, leadCsv),
      crm.previewDealImport(fx.actorA, dealCsv)
    ]);
    const [organizationResult, contactResult, leadResult, dealResult] = await Promise.all([
      crm.importOrganizationsFromCsv(fx.actorA, organizationCsv),
      crm.importContactsFromCsv(fx.actorA, contactCsv),
      crm.importLeadsFromCsv(fx.actorA, leadCsv),
      crm.importDealsFromCsv(fx.actorA, dealCsv)
    ]);

    for (const preview of [organizationPreview, contactPreview, leadPreview, dealPreview]) {
      expect(preview).toMatchObject({
        totalRows: 1,
        validRows: 0,
        duplicateRows: 0,
        invalidRows: 1,
        parseErrors: []
      });
      expect(preview.rows[0]).toMatchObject({
        ownerEmail: invalidOwnerEmail,
        status: "invalid",
        skipReasons: [invalidOwnerEmailMessage],
        errors: [invalidOwnerEmailMessage]
      });
    }
    for (const result of [organizationResult, contactResult, leadResult, dealResult]) {
      expect(result).toMatchObject({
        createdCount: 0,
        skippedDuplicateCount: 0,
        skippedInvalidCount: 1,
        errorCount: 0,
        failedRows: []
      });
    }
    await expect(
      Promise.all([
        fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
        fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } })
      ])
    ).resolves.toEqual(countsBefore);
  });

  it("previews Organizations CSV imports with validation and workspace-scoped duplicate detection", async () => {
    const fx = currentFixture();

    const preview = await crm.previewOrganizationImport(
      fx.actorA,
      [
        "name,domain,ownerEmail,Custom: Region",
        `"${fx.recordsA.organization.name}",duplicate.example,${fx.userA.email},North`,
        `"Fresh ""Quoted"" Org",fresh.example,${fx.userA.email},West`,
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
      unsupportedColumns: ["Custom: Region"],
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
        ownerId: fx.userA.id,
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
      "name,domain,ownerEmail,Custom: Region",
      `"${fx.recordsA.organization.name}",should-not-overwrite.example,,North`,
      `Fresh Import One,fresh-one.example,${fx.userA.email},East`,
      "Fresh Import Two,,,West",
      "Fresh Import One,fresh-one-dupe.example,,East",
      ",missing.example,,South"
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
      ownerId: fx.userA.id
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
        "name,email,phone,organizationName,ownerEmail,title,Custom: Tier",
        `"Existing Contact",${fx.recordsA.person.email?.toUpperCase()},555-0101,${fx.recordsA.organization.name},,CEO,Gold`,
        `"Fresh Contact",fresh@example.test,555-0102,${fx.recordsA.organization.name},${fx.userA.email},VP,Silver`,
        `"Fresh Contact Duplicate",FRESH@example.test,555-0103,,,VP,Silver`,
        `"No Email Contact",,555-0104,,,Director,Bronze`,
        ",missing@example.test,555-0105,,,Manager,Bronze",
        `"Wrong Workspace Org",workspace@example.test,555-0106,${fx.recordsB.organization.name},,Manager,Bronze`,
        "\"Ambiguous Person\",ambiguous@example.test,555-0107,Ambiguous Org,,Manager,Bronze",
        "\"Missing Org Person\",missing-org@example.test,555-0108,No Such Org,,Manager,Bronze",
        "\"Invalid Email Person\",not-an-email,555-0109,,,Manager,Bronze"
      ].join("\n")
    );

    expect(preview).toMatchObject({
      totalRows: 9,
      validRows: 2,
      duplicateRows: 2,
      invalidRows: 5,
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
        ownerId: fx.userA.id,
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
      }),
      expect.objectContaining({
        rowNumber: 10,
        email: "not-an-email",
        status: "invalid",
        skipReasons: ["Contact email must be a valid email address."]
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
      "name,email,phone,organizationName,ownerEmail,Custom: Tier",
      `"${originalContact.firstName} ${originalContact.lastName}",${originalContact.email?.toUpperCase()},555-9999,${fx.recordsA.organization.name},,Gold`,
      `"Fresh Contact",fresh-contact@example.test,555-0101,${fx.recordsA.organization.name},${fx.userA.email},Silver`,
      `"Second Import",second-import@example.test,555-0102,,,Bronze`,
      `"Fresh Contact Duplicate",FRESH-CONTACT@example.test,555-0103,,,Silver`,
      ",missing-name@example.test,555-0104,,,Bronze",
      "\"Missing Org\",missing-org-contact@example.test,555-0105,No Such Org,,Bronze",
      "\"Invalid Email\",not-an-email,555-0106,,,Bronze"
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
      skippedInvalidCount: 3,
      errorCount: 0
    });
    expect(result.createdCount + result.skippedDuplicateCount + result.skippedInvalidCount).toBe(result.preview.totalRows);
    expect(result.createdContacts.map((contact) => contact.name).sort()).toEqual(["Fresh Contact", "Second Import"]);
    expect(rerunResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 4,
      skippedInvalidCount: 3,
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
      ownerId: fx.userA.id
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
        "title,source,status,organizationName,ownerEmail,contactEmail,email,Custom: Priority",
        `"${fx.recordsA.lead.title}",Partner,NEW,${fx.recordsA.organization.name},,,existing@example.test,High`,
        `"Fresh Lead",Web,QUALIFIED,${fx.recordsA.organization.name},${fx.userA.email},${fx.recordsA.person.email},fresh@example.test,Medium`,
        `"Fresh Lead",Referral,NEW,,,,fresh-dupe@example.test,Medium`,
        `"No Org Lead",Outbound,, ,,,no-org@example.test,Low`,
        ",Web,NEW,,,,missing-title@example.test,Low",
        `"Wrong Workspace Org",Web,NEW,${fx.recordsB.organization.name},,,workspace@example.test,Low`,
        "\"Ambiguous Lead\",Web,NEW,Lead Ambiguous Org,,,ambiguous@example.test,Low",
        "\"Missing Org Lead\",Web,NEW,No Such Lead Org,,,missing-org@example.test,Low",
        "\"Converted Lead\",Web,CONVERTED,,,,converted@example.test,Low",
        "\"Bad Status Lead\",Web,ARCHIVED,,,,bad-status@example.test,Low"
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
        personId: fx.recordsA.person.id,
        ownerId: fx.userA.id,
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
      "title,source,status,organizationName,ownerEmail,contactEmail,Custom: Priority",
      `"${originalLead.title}",Should Not Overwrite,NEW,${fx.recordsA.organization.name},,,High`,
      `"Fresh Lead One",Web,,${fx.recordsA.organization.name},${fx.userA.email},${fx.recordsA.person.email},Medium`,
      `"Fresh Lead Two",Referral,QUALIFIED,,${fx.userA.email},,Low`,
      "\"Fresh Lead Three\",Outbound,DISQUALIFIED,,,,Low",
      "\"Fresh Lead One\",Partner,NEW,,,,Medium",
      ",Web,NEW,,,,Low",
      "\"Converted Import\",Web,CONVERTED,,,,Low",
      "\"Missing Org Import\",Web,NEW,No Such Lead Org,,,Low"
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
      ownerId: fx.userA.id,
      personId: fx.recordsA.person.id
    });
    expect(leads.find((lead) => lead.title === "Fresh Lead Two")).toMatchObject({
      source: "Referral",
      status: "QUALIFIED",
      organizationId: null,
      ownerId: fx.userA.id
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
        `,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,,USD,,,,No Such Organization,,SMB,2029-01-09,`,
        `"Invalid Contact Email Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,1.00,USD,2030-01-01,not-an-email,,${fx.recordsA.organization.name},${fx.userA.email},SMB,2029-01-10,`,
        `"Invalid Owner Email Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},OPEN,1.00,USD,2030-01-01,,,${fx.recordsA.organization.name},not-an-email,SMB,2029-01-11,`
      ].join("\n")
    );

    expect(preview).toMatchObject({
      totalRows: 11,
      validRows: 1,
      duplicateRows: 2,
      invalidRows: 8,
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
          "Deal value must be a non-negative amount with at most two decimal places and fit current storage limits.",
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
      }),
      expect.objectContaining({
        rowNumber: 11,
        contactEmail: "not-an-email",
        status: "invalid",
        skipReasons: ["Contact email must be a valid email address."]
      }),
      expect.objectContaining({
        rowNumber: 12,
        ownerEmail: "not-an-email",
        status: "invalid",
        skipReasons: ["Owner email must be a valid email address."]
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
    const oversizedValuePreview = await crm.previewDealImport(
      fx.actorA,
      [
        "title,pipeline,stage,value,currency",
        `"Oversized Value Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},${((dealValueCentsMax + 1) / 100).toFixed(2)},USD`
      ].join("\n")
    );

    expect(oversizedValuePreview).toMatchObject({
      totalRows: 1,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 1,
      parseErrors: []
    });
    expect(oversizedValuePreview.rows[0]).toMatchObject({
      title: "Oversized Value Deal",
      status: "invalid",
      skipReasons: ["Deal value must be a non-negative amount with at most two decimal places and fit current storage limits."]
    });
    const impossibleDatePreview = await crm.previewDealImport(
      fx.actorA,
      [
        "title,pipeline,stage,expectedCloseAt",
        `"Impossible Date Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},2030-02-31`,
        `"Impossible Datetime Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},2030-02-31T00:00:00.000Z`
      ].join("\n")
    );

    expect(impossibleDatePreview).toMatchObject({
      totalRows: 2,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 2,
      parseErrors: []
    });
    expect(impossibleDatePreview.rows).toEqual([
      expect.objectContaining({
        title: "Impossible Date Deal",
        expectedCloseAt: null,
        status: "invalid",
        skipReasons: ["Expected close date must be a valid ISO datetime or YYYY-MM-DD date."]
      }),
      expect.objectContaining({
        title: "Impossible Datetime Deal",
        expectedCloseAt: null,
        status: "invalid",
        skipReasons: ["Expected close date must be a valid ISO datetime or YYYY-MM-DD date."]
      })
    ]);
    await expect(
      crm.previewDealImport({ workspaceId: fx.workspaceB.id, actorUserId: fx.userA.id }, "title,pipeline,stage\nNo Access,No,No")
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts human-readable CSV import headers for spreadsheet-pasted previews", async () => {
    const fx = currentFixture();

    const organizationPreview = await crm.previewOrganizationImport(
      fx.actorA,
      `\uFEFFOrganization Name,Domain,Owner\u00A0Email\nReadable Alias Org,readable-alias.example,${fx.userA.email}`
    );
    const contactPreview = await crm.previewContactImport(
      fx.actorA,
      `\uFEFFFull Name,Email,Phone,Organization   Name,Owner Email\nReadable Alias Contact,readable-alias-contact@example.test,555-0120,${fx.recordsA.organization.name},${fx.userA.email}`
    );
    const leadPreview = await crm.previewLeadImport(
      fx.actorA,
      `\uFEFFLead Title,Source,Contact\tEmail,Contact Name,Organization Name,Owner Email\nReadable Alias Lead,Website,${fx.recordsA.person.email},,${fx.recordsA.organization.name},${fx.userA.email}`
    );
    const dealPreview = await crm.previewDealImport(
      fx.actorA,
      `\uFEFFDeal Title,Pipeline   Name,Stage\tName,Expected Close At,Contact Email,Organization Name,Owner Email\nReadable Alias Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},2030-04-05,${fx.recordsA.person.email},${fx.recordsA.organization.name},${fx.userA.email}`
    );

    expect(organizationPreview).toMatchObject({
      totalRows: 1,
      validRows: 1,
      unsupportedColumns: []
    });
    expect(organizationPreview.rows[0]).toMatchObject({ ownerId: fx.userA.id });
    expect(contactPreview).toMatchObject({
      totalRows: 1,
      validRows: 1,
      unsupportedColumns: []
    });
    expect(contactPreview.rows[0]).toMatchObject({
      organizationId: fx.recordsA.organization.id,
      ownerId: fx.userA.id
    });
    expect(leadPreview).toMatchObject({
      totalRows: 1,
      validRows: 1,
      unsupportedColumns: []
    });
    expect(leadPreview.rows[0]).toMatchObject({
      personId: fx.recordsA.person.id,
      organizationId: fx.recordsA.organization.id,
      ownerId: fx.userA.id
    });
    expect(dealPreview).toMatchObject({
      totalRows: 1,
      validRows: 1,
      unsupportedColumns: []
    });
    expect(dealPreview.rows[0]).toMatchObject({
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      personId: fx.recordsA.person.id,
      organizationId: fx.recordsA.organization.id,
      ownerId: fx.userA.id
    });
    expect(dealPreview.rows[0].expectedCloseAt?.toISOString()).toBe("2030-04-05T00:00:00.000Z");
  });

  it("does not let invalid CSV import rows reserve duplicate keys for later valid rows", async () => {
    const fx = currentFixture();
    const organizationCsv = [
      "name,ownerEmail",
      "Recoverable Import Org,missing-owner@example.test",
      "Recoverable Import Org,"
    ].join("\n");
    const contactCsv = [
      "name,email,organizationName",
      "Blocked Contact,recoverable-contact@example.test,Missing Import Org",
      "Recoverable Contact,recoverable-contact@example.test,"
    ].join("\n");
    const leadCsv = [
      "title,status,organizationName",
      "Recoverable Import Lead,NEW,Missing Import Org",
      "Recoverable Import Lead,NEW,"
    ].join("\n");
    const dealCsv = [
      "title,pipeline,stage,ownerEmail",
      `Recoverable Import Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},missing-owner@example.test`,
      `Recoverable Import Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},`
    ].join("\n");

    const organizationPreview = await crm.previewOrganizationImport(fx.actorA, organizationCsv);
    const contactPreview = await crm.previewContactImport(fx.actorA, contactCsv);
    const leadPreview = await crm.previewLeadImport(fx.actorA, leadCsv);
    const dealPreview = await crm.previewDealImport(fx.actorA, dealCsv);
    const organizationResult = await crm.importOrganizationsFromCsv(fx.actorA, organizationCsv);
    const contactResult = await crm.importContactsFromCsv(fx.actorA, contactCsv);
    const leadResult = await crm.importLeadsFromCsv(fx.actorA, leadCsv);
    const dealResult = await crm.importDealsFromCsv(fx.actorA, dealCsv);

    expect(organizationPreview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 1 });
    expect(organizationPreview.rows).toEqual([
      expect.objectContaining({
        status: "invalid",
        skipReasons: ["Owner email must match an active user who belongs to this workspace."]
      }),
      expect.objectContaining({
        name: "Recoverable Import Org",
        status: "valid",
        skipReasons: []
      })
    ]);
    expect(contactPreview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 1 });
    expect(contactPreview.rows).toEqual([
      expect.objectContaining({
        status: "invalid",
        skipReasons: ["Organization name was not found in this workspace."]
      }),
      expect.objectContaining({
        name: "Recoverable Contact",
        email: "recoverable-contact@example.test",
        status: "valid",
        skipReasons: []
      })
    ]);
    expect(leadPreview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 1 });
    expect(leadPreview.rows).toEqual([
      expect.objectContaining({
        status: "invalid",
        skipReasons: ["Organization name was not found in this workspace."]
      }),
      expect.objectContaining({
        title: "Recoverable Import Lead",
        status: "valid",
        skipReasons: []
      })
    ]);
    expect(dealPreview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 1 });
    expect(dealPreview.rows).toEqual([
      expect.objectContaining({
        status: "invalid",
        skipReasons: ["Owner email must match an active user who belongs to this workspace."]
      }),
      expect.objectContaining({
        title: "Recoverable Import Deal",
        status: "valid",
        skipReasons: []
      })
    ]);
    expect(organizationResult).toMatchObject({ createdCount: 1, skippedDuplicateCount: 0, skippedInvalidCount: 1 });
    expect(contactResult).toMatchObject({ createdCount: 1, skippedDuplicateCount: 0, skippedInvalidCount: 1 });
    expect(leadResult).toMatchObject({ createdCount: 1, skippedDuplicateCount: 0, skippedInvalidCount: 1 });
    expect(dealResult).toMatchObject({ createdCount: 1, skippedDuplicateCount: 0, skippedInvalidCount: 1 });
    await expect(
      fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id, name: "Recoverable Import Org" } })
    ).resolves.toBe(1);
    await expect(
      fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id, email: "recoverable-contact@example.test" } })
    ).resolves.toBe(1);
    await expect(
      fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id, title: "Recoverable Import Lead" } })
    ).resolves.toBe(1);
    await expect(
      fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id, title: "Recoverable Import Deal" } })
    ).resolves.toBe(1);
  });

  it("keeps repeated existing deal duplicates separate from CSV duplicate rows", async () => {
    const fx = currentFixture();
    const csv = [
      "title,pipeline,stage,contactEmail,organizationName",
      `"${fx.recordsA.deal.title}",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},${fx.recordsA.person.email},${fx.recordsA.organization.name}`,
      `"${fx.recordsA.deal.title}",${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},${fx.recordsA.person.email},${fx.recordsA.organization.name}`
    ].join("\n");

    const preview = await crm.previewDealImport(fx.actorA, csv);
    const result = await crm.importDealsFromCsv(fx.actorA, csv);

    expect(preview).toMatchObject({ validRows: 0, duplicateRows: 2, invalidRows: 0 });
    expect(preview.rows).toEqual([
      expect.objectContaining({
        status: "duplicate",
        skipReasons: [
          "Duplicate skipped: a deal with the same title, pipeline, stage, contact, and organization already exists in this workspace."
        ]
      }),
      expect.objectContaining({
        status: "duplicate",
        skipReasons: [
          "Duplicate skipped: a deal with the same title, pipeline, stage, contact, and organization already exists in this workspace."
        ]
      })
    ]);
    expect(result).toMatchObject({ createdCount: 0, skippedDuplicateCount: 2, skippedInvalidCount: 0, errorCount: 0 });
  });

  it("revalidates stale CSV import associations before creating records", async () => {
    const fx = currentFixture();
    const staleOrganization = await fx.prisma.organization.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Stale Import Association Org",
        domain: "stale-import-association.example"
      }
    });
    const stalePipeline = await fx.prisma.pipeline.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Stale Import Pipeline",
        stages: {
          create: {
            workspaceId: fx.workspaceA.id,
            name: "Stale Import Stage",
            sortOrder: 1
          }
        }
      },
      include: { stages: true }
    });
    const contactCsv = [
      "name,email,organizationName",
      "Stale Association Contact,stale-association-contact@example.test,Stale Import Association Org"
    ].join("\n");
    const dealCsv = [
      "title,pipeline,stage",
      "Stale Association Deal,Stale Import Pipeline,Stale Import Stage"
    ].join("\n");

    const [contactPreview, dealPreview] = await Promise.all([
      crm.previewContactImport(fx.actorA, contactCsv),
      crm.previewDealImport(fx.actorA, dealCsv)
    ]);
    await Promise.all([
      fx.prisma.organization.update({
        where: { id: staleOrganization.id },
        data: { deletedAt: new Date("2030-05-01T00:00:00.000Z") }
      }),
      fx.prisma.pipelineStage.update({
        where: { id: stalePipeline.stages[0].id },
        data: { deletedAt: new Date("2030-05-01T00:00:00.000Z") }
      })
    ]);

    const [contactResult, dealResult] = await Promise.all([
      crm.importContactsFromCsv(fx.actorA, contactCsv),
      crm.importDealsFromCsv(fx.actorA, dealCsv)
    ]);

    expect(contactPreview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 0 });
    expect(dealPreview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 0 });
    expect(contactResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 1,
      errorCount: 0
    });
    expect(contactResult.preview.rows[0]).toMatchObject({
      status: "invalid",
      skipReasons: ["Organization name was not found in this workspace."]
    });
    expect(dealResult).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 1,
      errorCount: 0
    });
    expect(dealResult.preview.rows[0]).toMatchObject({
      status: "invalid",
      skipReasons: ["Stage must already exist in the resolved pipeline; stages from other pipelines are not used."]
    });
    await expect(
      fx.prisma.person.findFirst({
        where: { workspaceId: fx.workspaceA.id, email: "stale-association-contact@example.test" }
      })
    ).resolves.toBeNull();
    await expect(
      fx.prisma.deal.findFirst({
        where: { workspaceId: fx.workspaceA.id, title: "Stale Association Deal" }
      })
    ).resolves.toBeNull();
  });

  it("revalidates stale CSV import owner memberships before creating records", async () => {
    const fx = currentFixture();
    const staleOwner = await fx.prisma.user.create({
      data: {
        email: `stale-import-owner-${Date.now()}@example.test`,
        name: "Stale Import Owner",
        memberships: {
          create: {
            workspaceId: fx.workspaceA.id,
            role: MembershipRole.MEMBER
          }
        }
      }
    });
    const organizationCsv = `name,ownerEmail\nStale Owner Import Org,${staleOwner.email}`;
    const contactCsv = `name,email,ownerEmail\nStale Owner Import Contact,stale-owner-import-contact@example.test,${staleOwner.email}`;
    const leadCsv = `title,ownerEmail\nStale Owner Import Lead,${staleOwner.email}`;
    const dealCsv = [
      "title,pipeline,stage,ownerEmail",
      `Stale Owner Import Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},${staleOwner.email}`
    ].join("\n");

    try {
      const [organizationPreview, contactPreview, leadPreview, dealPreview] = await Promise.all([
        crm.previewOrganizationImport(fx.actorA, organizationCsv),
        crm.previewContactImport(fx.actorA, contactCsv),
        crm.previewLeadImport(fx.actorA, leadCsv),
        crm.previewDealImport(fx.actorA, dealCsv)
      ]);
      await fx.prisma.workspaceMembership.delete({
        where: {
          workspaceId_userId: {
            workspaceId: fx.workspaceA.id,
            userId: staleOwner.id
          }
        }
      });

      const [organizationResult, contactResult, leadResult, dealResult] = await Promise.all([
        crm.importOrganizationsFromCsv(fx.actorA, organizationCsv),
        crm.importContactsFromCsv(fx.actorA, contactCsv),
        crm.importLeadsFromCsv(fx.actorA, leadCsv),
        crm.importDealsFromCsv(fx.actorA, dealCsv)
      ]);
      const staleOwnerMessage = "Owner email must match an active user who belongs to this workspace.";

      for (const preview of [organizationPreview, contactPreview, leadPreview, dealPreview]) {
        expect(preview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 0 });
        expect(preview.rows[0]).toMatchObject({ ownerId: staleOwner.id, status: "valid" });
      }
      for (const result of [organizationResult, contactResult, leadResult, dealResult]) {
        expect(result).toMatchObject({
          createdCount: 0,
          skippedDuplicateCount: 0,
          skippedInvalidCount: 1,
          errorCount: 0
        });
        expect(result.preview.rows[0]).toMatchObject({
          status: "invalid",
          skipReasons: [staleOwnerMessage],
          errors: [staleOwnerMessage]
        });
      }
      await expect(
        Promise.all([
          fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id, name: "Stale Owner Import Org" } }),
          fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id, email: "stale-owner-import-contact@example.test" } }),
          fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id, title: "Stale Owner Import Lead" } }),
          fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id, title: "Stale Owner Import Deal" } })
        ])
      ).resolves.toEqual([0, 0, 0, 0]);
    } finally {
      await fx.prisma.workspaceMembership.deleteMany({ where: { userId: staleOwner.id } });
      await fx.prisma.user.delete({ where: { id: staleOwner.id } }).catch(() => null);
    }
  });

  it("revalidates deleted CSV import owner users before creating records", async () => {
    const fx = currentFixture();
    const staleOwner = await fx.prisma.user.create({
      data: {
        email: `deleted-import-owner-${Date.now()}@example.test`,
        name: "Deleted Import Owner",
        memberships: {
          create: {
            workspaceId: fx.workspaceA.id,
            role: MembershipRole.MEMBER
          }
        }
      }
    });
    const organizationCsv = `name,ownerEmail\nDeleted Owner Import Org,${staleOwner.email}`;
    const contactCsv = `name,email,ownerEmail\nDeleted Owner Import Contact,deleted-owner-import-contact@example.test,${staleOwner.email}`;
    const leadCsv = `title,ownerEmail\nDeleted Owner Import Lead,${staleOwner.email}`;
    const dealCsv = [
      "title,pipeline,stage,ownerEmail",
      `Deleted Owner Import Deal,${fx.recordsA.pipeline.name},${fx.recordsA.stageOne.name},${staleOwner.email}`
    ].join("\n");

    try {
      const [organizationPreview, contactPreview, leadPreview, dealPreview] = await Promise.all([
        crm.previewOrganizationImport(fx.actorA, organizationCsv),
        crm.previewContactImport(fx.actorA, contactCsv),
        crm.previewLeadImport(fx.actorA, leadCsv),
        crm.previewDealImport(fx.actorA, dealCsv)
      ]);
      await fx.prisma.user.update({
        where: { id: staleOwner.id },
        data: { deletedAt: new Date("2030-06-01T00:00:00.000Z") }
      });

      const [organizationResult, contactResult, leadResult, dealResult] = await Promise.all([
        crm.importOrganizationsFromCsv(fx.actorA, organizationCsv),
        crm.importContactsFromCsv(fx.actorA, contactCsv),
        crm.importLeadsFromCsv(fx.actorA, leadCsv),
        crm.importDealsFromCsv(fx.actorA, dealCsv)
      ]);
      const staleOwnerMessage = "Owner email must match an active user who belongs to this workspace.";

      for (const preview of [organizationPreview, contactPreview, leadPreview, dealPreview]) {
        expect(preview).toMatchObject({ validRows: 1, duplicateRows: 0, invalidRows: 0 });
        expect(preview.rows[0]).toMatchObject({ ownerId: staleOwner.id, status: "valid" });
      }
      for (const result of [organizationResult, contactResult, leadResult, dealResult]) {
        expect(result).toMatchObject({
          createdCount: 0,
          skippedDuplicateCount: 0,
          skippedInvalidCount: 1,
          errorCount: 0
        });
        expect(result.preview.rows[0]).toMatchObject({
          status: "invalid",
          skipReasons: [staleOwnerMessage],
          errors: [staleOwnerMessage]
        });
      }
      await expect(
        Promise.all([
          fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id, name: "Deleted Owner Import Org" } }),
          fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id, email: "deleted-owner-import-contact@example.test" } }),
          fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id, title: "Deleted Owner Import Lead" } }),
          fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id, title: "Deleted Owner Import Deal" } })
        ])
      ).resolves.toEqual([0, 0, 0, 0]);
    } finally {
      await fx.prisma.workspaceMembership.deleteMany({ where: { userId: staleOwner.id } });
      await fx.prisma.user.delete({ where: { id: staleOwner.id } }).catch(() => null);
    }
  });

  it("keeps Deals CSV stage resolution scoped to the actor workspace", async () => {
    const fx = currentFixture();
    const crossWorkspaceStage = await fx.prisma.pipelineStage.create({
      data: {
        workspaceId: fx.workspaceB.id,
        pipelineId: fx.recordsA.pipeline.id,
        name: "Cross Workspace Import Stage",
        probability: 10,
        sortOrder: 99
      }
    });
    const csv = [
      "title,pipeline,stage",
      `"Cross Workspace Stage Deal",${fx.recordsA.pipeline.name},${crossWorkspaceStage.name}`
    ].join("\n");

    const preview = await crm.previewDealImport(fx.actorA, csv);
    const result = await crm.importDealsFromCsv(fx.actorA, csv);

    expect(preview).toMatchObject({
      totalRows: 1,
      validRows: 0,
      duplicateRows: 0,
      invalidRows: 1
    });
    expect(preview.rows[0]).toMatchObject({
      title: "Cross Workspace Stage Deal",
      pipelineId: fx.recordsA.pipeline.id,
      stageId: null,
      status: "invalid",
      skipReasons: ["Stage must already exist in the resolved pipeline; stages from other pipelines are not used."]
    });
    expect(result).toMatchObject({
      createdCount: 0,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 1,
      errorCount: 0
    });
    await expect(
      fx.prisma.deal.findFirst({
        where: { workspaceId: fx.workspaceA.id, title: "Cross Workspace Stage Deal" }
      })
    ).resolves.toBeNull();
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
      `"Missing Org Deal",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},OPEN,,,,,No Such Deal Org,,Missing`,
      `"Invalid Deal Email",${fx.recordsA.pipeline.name},${fx.recordsA.stageTwo.name},OPEN,100.00,USD,2030-03-04,not-an-email,${fx.recordsA.organization.name},${fx.userA.email},Missing`
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
      skippedInvalidCount: 3,
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
      skippedInvalidCount: 3,
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
    const blankDeal = await crm.createDeal(fx.actorA, {
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      title: "Custom field filter blank",
      valueCents: 46000,
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
    const duplicateCustomFieldAuditCountBefore = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Deal",
        entityId: fx.recordsA.deal.id,
        action: "custom_field_value.updated"
      }
    });
    const duplicateCustomFieldSave = await crm.upsertCustomFieldValues(fx.actorA, {
      entityType: "DEAL",
      entityId: fx.recordsA.deal.id,
      values: { [field.id]: "High" }
    });
    const duplicateCustomFieldAuditCountAfter = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Deal",
        entityId: fx.recordsA.deal.id,
        action: "custom_field_value.updated"
      }
    });
    await crm.upsertCustomFieldValues(fx.actorA, {
      entityType: "DEAL",
      entityId: otherDeal.id,
      values: { [field.id]: "Low" }
    });
    await crm.upsertCustomFieldValues(fx.actorA, {
      entityType: "DEAL",
      entityId: blankDeal.id,
      values: { [field.id]: "" }
    });
    await fx.prisma.customFieldValue.create({
      data: {
        workspaceId: fx.workspaceA.id,
        fieldId: field.id,
        entityType: "DEAL",
        entityId: fx.recordsB.deal.id,
        value: "Should not surface"
      }
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
    const scopedSummaries = await crm.listCustomFieldSummaries(fx.actorA, "DEAL", [
      fx.recordsA.deal.id,
      fx.recordsA.deal.id,
      fx.recordsB.deal.id,
      ""
    ]);
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
    const emptyValuePage = await crm.listDealsPage(
      fx.actorA,
      { q: "Custom field filter blank", customFieldId: field.id, customFieldOperator: "is_empty" },
      { page: 1, pageSize: 10 }
    );
    const notEmptyValuePage = await crm.listDealsPage(
      fx.actorA,
      { q: "Custom field filter", customFieldId: field.id, customFieldOperator: "is_not_empty" },
      { page: 1, pageSize: 10 }
    );
    const malformedFieldIdPage = await crm.listDealsPage(
      fx.actorA,
      {
        q: "Needle",
        customFieldId: { id: field.id },
        customFieldValue: "Medium"
      },
      { page: 1, pageSize: 10 }
    );
    const malformedFieldValuePage = await crm.listDealsPage(
      fx.actorA,
      {
        q: "Needle",
        customFieldId: field.id,
        customFieldValue: { value: "Medium" }
      },
      { page: 1, pageSize: 10 }
    );
    const malformedOperatorPage = await crm.listDealsPage(
      fx.actorA,
      {
        customFieldId: field.id,
        customFieldOperator: { operator: "contains" },
        customFieldValue: "High"
      },
      { page: 1, pageSize: 10 }
    );

    expect(matchingPage.items.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);
    expect(summaries.get(fx.recordsA.deal.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: field.id, value: "High" })])
    );
    expect(scopedSummaries.get(fx.recordsA.deal.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: field.id, value: "High" })])
    );
    expect(scopedSummaries.has(fx.recordsB.deal.id)).toBe(false);
    expect(duplicateCustomFieldSave).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: field.id,
          values: expect.arrayContaining([expect.objectContaining({ value: "High" })])
        })
      ])
    );
    expect(duplicateCustomFieldAuditCountBefore).toBe(1);
    expect(duplicateCustomFieldAuditCountAfter).toBe(duplicateCustomFieldAuditCountBefore);
    expect(invalidValuePage.items).toEqual([]);
    expect(searchMissPage.items).toEqual([]);
    expect(emptyValuePage.items.map((deal) => deal.id)).toEqual([blankDeal.id]);
    expect(notEmptyValuePage.items.map((deal) => deal.id)).toEqual([otherDeal.id]);
    expect(notEmptyValuePage.items.map((deal) => deal.id)).not.toContain(fx.recordsB.deal.id);
    expect(malformedFieldIdPage.items.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);
    expect(malformedFieldValuePage.items.map((deal) => deal.id)).toEqual([fx.recordsA.deal.id]);
    expect(malformedOperatorPage.items).toEqual([]);
  });

  it("rejects malformed custom field entity types at service boundaries", async () => {
    const fx = currentFixture();
    const organizationField = await crm.createCustomField(fx.actorA, {
      entityType: "ORGANIZATION",
      name: "Malformed Type Guard",
      key: "malformed_type_guard",
      fieldType: "TEXT",
      required: false
    });
    const malformedEntityType = "ACCOUNT" as unknown as "ORGANIZATION";
    const customFieldDefinitionCountBeforeMalformedBoundary = await fx.prisma.customFieldDefinition.count({
      where: { workspaceId: fx.workspaceA.id }
    });

    await expect(crm.createCustomField(fx.actorA, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Custom field entity type must be DEAL, PERSON, ORGANIZATION, or LEAD."
    });
    await expect(
      crm.createCustomField(fx.actorA, {
        entityType: "DEAL",
        name: "Unsupported Field Type",
        key: "unsupported_field_type",
        fieldType: "URL" as unknown as "TEXT",
        required: false
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Custom field type must be TEXT, NUMBER, DATE, BOOLEAN, or SELECT."
    });
    await expect(
      crm.createCustomField(fx.actorA, {
        entityType: "DEAL",
        name: "Malformed Required Flag",
        key: "malformed_required_flag",
        fieldType: "TEXT",
        required: "yes" as never
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Custom field required flag must be true or false."
    });
    await expect(
      crm.createCustomField(fx.actorA, {
        entityType: "DEAL",
        name: "Select Without Options",
        key: "select_without_options",
        fieldType: "SELECT",
        required: false
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Select custom fields require at least one option."
    });
    await expect(
      crm.createCustomField(fx.actorA, {
        entityType: "DEAL",
        name: "Select With Malformed Options",
        key: "select_with_malformed_options",
        fieldType: "SELECT",
        options: { values: ["High"] },
        required: false
      } as never)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Select custom fields require at least one option."
    });
    await expect(fx.prisma.customFieldDefinition.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      customFieldDefinitionCountBeforeMalformedBoundary
    );
    const boundaryField = await crm.createCustomField(fx.actorA, {
      id: "caller-controlled-custom-field-id",
      workspaceId: fx.workspaceB.id,
      deletedAt: new Date("2030-01-01T00:00:00.000Z"),
      createdAt: new Date("2035-01-01T00:00:00.000Z"),
      updatedAt: new Date("2035-01-02T00:00:00.000Z"),
      entityType: "DEAL",
      name: "   Service Boundary Field   ",
      key: " service_boundary_field ",
      fieldType: "TEXT",
      options: ["Ignored for text"],
      required: true
    } as never);
    const selectField = await crm.createCustomField(fx.actorA, {
      entityType: "DEAL",
      name: "Readiness Select",
      key: "readiness_select",
      fieldType: "SELECT",
      options: [" High ", "Low", "High", "", { value: "Ignored" }],
      required: false
    } as never);
    const boundaryFieldRow = await fx.prisma.customFieldDefinition.findUniqueOrThrow({
      where: { id: boundaryField.id }
    });

    expect(boundaryField.id).not.toBe("caller-controlled-custom-field-id");
    expect(boundaryField).toMatchObject({
      workspaceId: fx.workspaceA.id,
      entityType: "DEAL",
      name: "Service Boundary Field",
      key: "service_boundary_field",
      fieldType: "TEXT",
      required: true,
      deletedAt: null
    });
    expect(boundaryField.options).toBeNull();
    expect(boundaryField.createdAt.toISOString()).not.toBe("2035-01-01T00:00:00.000Z");
    expect(boundaryFieldRow).toMatchObject({
      workspaceId: fx.workspaceA.id,
      deletedAt: null
    });
    expect(selectField.options).toEqual(["High", "Low"]);
    await expect(
      crm.upsertCustomFieldValues(fx.actorA, {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [selectField.id]: "High" }
      })
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: selectField.id })]));
    await expect(
      crm.upsertCustomFieldValues(fx.actorA, {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [selectField.id]: "Medium" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Readiness Select must be one of the configured options."
    });
    await expect(
      crm.listRecordCustomFields(fx.actorA, malformedEntityType, fx.recordsA.organization.id)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Custom field entity type must be DEAL, PERSON, ORGANIZATION, or LEAD."
    });
    await expect(
      crm.listCustomFieldSummaries(fx.actorA, malformedEntityType, [fx.recordsA.organization.id])
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Custom field entity type must be DEAL, PERSON, ORGANIZATION, or LEAD."
    });
    await expect(
      crm.listCustomFieldFilteredEntityIds(fx.workspaceA.id, malformedEntityType, {
        customFieldId: organizationField.id,
        customFieldValue: "Enterprise"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Custom field entity type must be DEAL, PERSON, ORGANIZATION, or LEAD."
    });
    await expect(
      crm.upsertCustomFieldValues(fx.actorA, {
        entityType: malformedEntityType,
        entityId: fx.recordsA.organization.id,
        values: { [organizationField.id]: "Should not save" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Custom field entity type must be DEAL, PERSON, ORGANIZATION, or LEAD."
    });
    await expect(
      crm.upsertCustomFieldValues(fx.actorA, {
        entityType: "ORGANIZATION",
        entityId: { id: fx.recordsA.organization.id },
        values: { [organizationField.id]: "Should not save" }
      } as never)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Custom field record id must be text."
    });
    await expect(
      crm.upsertCustomFieldValues(fx.actorA, {
        entityType: "ORGANIZATION",
        entityId: fx.recordsA.organization.id,
        values: null
      } as never)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Custom field values must be an object."
    });
    await expect(
      fx.prisma.customFieldValue.count({
        where: {
          workspaceId: fx.workspaceA.id,
          fieldId: organizationField.id,
          entityId: fx.recordsA.organization.id
        }
      })
    ).resolves.toBe(0);
    await expect(
      fx.prisma.customFieldDefinition.count({
        where: {
          workspaceId: fx.workspaceA.id,
          key: { in: ["unsupported_field_type", "malformed_required_flag", "select_without_options", "select_with_malformed_options"] }
        }
      })
    ).resolves.toBe(0);
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
      dealListStateOptions
    );

    const savedView = await crm.createDealSavedView(fx.actorA, {
      name: "  Open   needle deals  ",
      state
    });
    const malformedInputView = await crm.createDealSavedView(fx.actorA, {
      name: "Malformed input deal view",
      state: parseListViewState(
        {
          status: "PARKED",
          stageId: "stage_123",
          followUp: "someday",
          commercial: "maybe",
          customFieldId: "field_123",
          customFieldOperator: "before",
          customFieldValue: "High",
          sortBy: "title",
          sortDirection: "asc",
          page: "4",
          pageSize: "25"
        },
        dealListStateOptions
      )
    });
    const incompleteCustomFieldView = await crm.createDealSavedView(fx.actorA, {
      name: "Incomplete custom field deal view",
      state: parseListViewState(
        {
          status: "OPEN",
          customFieldId: "field_123",
          customFieldOperator: "contains",
          sortBy: "title",
          sortDirection: "asc",
          pageSize: "25"
        },
        dealListStateOptions
      )
    });
    const serializedStateView = await crm.createDealSavedView(fx.actorA, {
      name: "Serialized deal view",
      state: {
        filters: {
          status: "OPEN"
        },
        page: 9,
        pageSize: 25,
        sortBy: "title",
        sortDirection: "asc"
      }
    });
    const savedViewCountBeforeMalformedCreate = await fx.prisma.savedView.count({
      where: { workspaceId: fx.workspaceA.id, recordType: "DEAL" }
    });
    await expect(crm.createDealSavedView(fx.actorA, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Saved view name is required."
    });
    await expect(
      crm.createDealSavedView(fx.actorA, {
        name: "Broken state deal view",
        state: null
      } as never)
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Saved view state is required."
    });
    await expect(
      crm.createDealSavedView(fx.actorA, {
        name: "   ",
        state
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Saved view name is required."
    });
    await expect(
      crm.createDealSavedView(fx.actorA, {
        name: "x".repeat(savedViewNameMaxLength + 1),
        state
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: `Saved view name must be ${savedViewNameMaxLength} characters or fewer.`
    });
    await expect(
      fx.prisma.savedView.count({ where: { workspaceId: fx.workspaceA.id, recordType: "DEAL" } })
    ).resolves.toBe(savedViewCountBeforeMalformedCreate);
    const malformedView = await fx.prisma.savedView.create({
      data: {
        workspaceId: fx.workspaceA.id,
        recordType: "DEAL",
        name: "Malformed deal view",
        state: {
          filters: {
            status: "PARKED",
            stageId: "stage_456",
            followUp: "someday",
            commercial: "maybe",
            customFieldId: "field_123",
            customFieldOperator: "before",
            customFieldValue: "High",
            unsupportedFilter: "ignored"
          },
          sortBy: "unsupported",
          sortDirection: "sideways",
          page: 9,
          pageSize: 999
        }
      }
    });
    const legacyPaginationView = await fx.prisma.savedView.create({
      data: {
        workspaceId: fx.workspaceA.id,
        recordType: "DEAL",
        name: "Legacy pagination deal view",
        state: {
          filters: {
            status: "OPEN"
          },
          sortBy: "title",
          sortDirection: "asc",
          pagination: {
            page: 7,
            pageSize: 25
          }
        }
      }
    });
    const invalidDefaultStateView = await fx.prisma.savedView.create({
      data: {
        workspaceId: fx.workspaceA.id,
        recordType: "DEAL",
        name: "Invalid default state deal view",
        state: ["legacy-state-array"]
      }
    });
    const [workspaceAViews, workspaceBViews] = await Promise.all([
      crm.listDealSavedViews(fx.actorA),
      crm.listDealSavedViews(fx.actorB)
    ]);
    const normalizedMalformedView = workspaceAViews.find((view) => view.id === malformedView.id);
    const normalizedLegacyPaginationView = workspaceAViews.find((view) => view.id === legacyPaginationView.id);
    const normalizedInvalidDefaultStateView = workspaceAViews.find((view) => view.id === invalidDefaultStateView.id);
    (normalizedInvalidDefaultStateView?.state.filters as Record<string, string>).status = "WON";
    const relistedWorkspaceAViews = await crm.listDealSavedViews(fx.actorA);
    const relistedInvalidDefaultStateView = relistedWorkspaceAViews.find((view) => view.id === invalidDefaultStateView.id);
    const persistedSerializedStateView = await fx.prisma.savedView.findUniqueOrThrow({
      where: { id: serializedStateView.id },
      select: { state: true }
    });
    const persistedSerializedStateText = JSON.stringify(persistedSerializedStateView.state);

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
    expect(malformedInputView).toMatchObject({
      state: {
        filters: { stageId: "stage_123" },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      },
      href: "/deals?stageId=stage_123&sortBy=title&sortDirection=asc&pageSize=25"
    });
    expect(malformedInputView.href).not.toContain("status=PARKED");
    expect(malformedInputView.href).not.toContain("followUp=someday");
    expect(malformedInputView.href).not.toContain("commercial=maybe");
    expect(malformedInputView.href).not.toContain("customField");
    expect(incompleteCustomFieldView).toMatchObject({
      state: {
        filters: { status: "OPEN" },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      },
      href: "/deals?status=OPEN&sortBy=title&sortDirection=asc&pageSize=25"
    });
    expect(incompleteCustomFieldView.href).not.toContain("customField");
    expect(serializedStateView).toMatchObject({
      state: {
        filters: { status: "OPEN" },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      },
      href: "/deals?status=OPEN&sortBy=title&sortDirection=asc&pageSize=25"
    });
    expect(serializedStateView.href).not.toContain("page=9");
    expect(persistedSerializedStateText).not.toContain("\"page\"");
    expect(persistedSerializedStateText).not.toContain("\"pagination\"");
    expect(workspaceAViews.map((view) => view.id)).toContain(savedView.id);
    expect(workspaceBViews.map((view) => view.id)).not.toContain(savedView.id);
    expect(normalizedMalformedView).toMatchObject({
      state: {
        filters: { stageId: "stage_456" },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 50
      },
      href: "/deals?stageId=stage_456&sortBy=updatedAt&sortDirection=desc&pageSize=50"
    });
    expect(normalizedLegacyPaginationView).toMatchObject({
      state: {
        filters: { status: "OPEN" },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      },
      href: "/deals?status=OPEN&sortBy=title&sortDirection=asc&pageSize=25"
    });
    expect(normalizedLegacyPaginationView?.href).not.toContain("page=7");
    expect(normalizedInvalidDefaultStateView).toMatchObject({
      state: {
        filters: { status: "WON" },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 10
      }
    });
    expect(relistedInvalidDefaultStateView).toMatchObject({
      state: {
        filters: {},
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 10
      },
      href: "/deals?sortBy=updatedAt&sortDirection=desc&pageSize=10"
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
        filterKeys: ["status", "source", "ownerId", "followUp", "customFieldId", "customFieldOperator", "customFieldValue"],
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
    const persistedLeadState = await fx.prisma.savedView.findUniqueOrThrow({
      where: { id: savedView.id },
      select: { state: true }
    });
    const persistedLeadStateText = JSON.stringify(persistedLeadState.state);

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
        },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      },
      href: `/leads?q=Needle&status=QUALIFIED&source=Webinar&ownerId=${fx.userA.id}&customFieldId=lead_field_123&customFieldOperator=is_not_empty&sortBy=title&sortDirection=asc&pageSize=25`
    });
    expect(savedView.href).not.toContain("page=7");
    expect(persistedLeadStateText).not.toContain("\"page\"");
    expect(persistedLeadStateText).not.toContain("\"pagination\"");
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
    const persistedContactState = await fx.prisma.savedView.findUniqueOrThrow({
      where: { id: savedView.id },
      select: { state: true }
    });
    const persistedContactStateText = JSON.stringify(persistedContactState.state);

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
    expect(persistedContactStateText).not.toContain("\"page\"");
    expect(persistedContactStateText).not.toContain("\"pagination\"");
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
    const persistedOrganizationState = await fx.prisma.savedView.findUniqueOrThrow({
      where: { id: savedView.id },
      select: { state: true }
    });
    const persistedOrganizationStateText = JSON.stringify(persistedOrganizationState.state);

    expect(savedView).toMatchObject({
      workspaceId: fx.workspaceA.id,
      recordType: "ORGANIZATION",
      name: "Enterprise organizations",
      state: {
        q: "Orbit",
        filters: {
          ownerId: fx.userA.id,
          customFieldId: "organization_field_123",
          customFieldOperator: "is_not_empty"
        },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 25
      },
      href: `/organizations?q=Orbit&ownerId=${fx.userA.id}&customFieldId=organization_field_123&customFieldOperator=is_not_empty&sortBy=updatedAt&sortDirection=desc&pageSize=25`
    });
    expect(savedView.href).not.toContain("page=5");
    expect(persistedOrganizationStateText).not.toContain("\"page\"");
    expect(persistedOrganizationStateText).not.toContain("\"pagination\"");
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
    await fx.prisma.deal.update({
      where: { id: fx.recordsA.deal.id },
      data: {
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id
      }
    });
    await crm.closeDeal(fx.actorA, wonDeal.id, { status: "WON" });
    await crm.closeDeal(fx.actorA, lostDeal.id, { status: "LOST", lostReason: "Timing" });
    const emptyOrganization = await crm.createOrganization(fx.actorA, {
      name: "Report organization without people"
    });
    await fx.prisma.person.create({
      data: {
        workspaceId: fx.workspaceB.id,
        ownerId: fx.userB.id,
        organizationId: emptyOrganization.id,
        firstName: "Cross",
        lastName: "Workspace",
        email: "report-cross-workspace-person@example.test"
      }
    });

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
    expect(report.dataHygiene.openDealsMissingContactOrOrganization).toBe(3);
    expect(report.dataHygiene.organizationsWithoutPeople).toBe(1);
    expect(report.topOpenDeals.find((deal) => deal.id === fx.recordsA.deal.id)).toMatchObject({
      organization: null,
      stageName: fx.recordsA.stageOne.name
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
    await fx.prisma.workspaceMembership.create({
      data: {
        workspaceId: fx.workspaceA.id,
        userId: fx.userB.id,
        role: MembershipRole.MEMBER
      }
    });
    const memberActor = { workspaceId: fx.workspaceA.id, actorUserId: fx.userB.id };
    await expect(
      crm.getMonthlyWonRevenueGoalProgress(memberActor, {
        month: "2030-03",
        currency: "USD"
      })
    ).resolves.toMatchObject({ wonRevenueCents: 0, targetCents: null });
    await expect(
      crm.createOrUpdateMonthlyWonRevenueGoal(memberActor, {
        month: "2030-03",
        currency: "USD",
        targetCents: 10000
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      message: "Only workspace admins and owners can manage workspace goals."
    });
    expect(await fx.prisma.goal.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(0);

    await expect(
      crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
        month: "2030-03",
        currency: "USD",
        targetCents: -1
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    await expect(
      crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
        month: "2030-03",
        currency: "USD",
        targetCents: goalTargetCentsMax + 1
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Goal target is too large."
    });
    const goalCountBeforeMalformedInput = await fx.prisma.goal.count({ where: { workspaceId: fx.workspaceA.id } });
    await expect(
      crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
        month: { set: "2030-03" } as unknown as string,
        currency: "USD",
        targetCents: 10000
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Goal month must be a valid date or YYYY-MM value."
    });
    await expect(
      crm.getMonthlyWonRevenueGoalProgress(fx.actorA, {
        month: "2030-03",
        currency: { code: "USD" } as unknown as string
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Goal currency must be a three-letter ISO code."
    });
    expect(await fx.prisma.goal.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(
      goalCountBeforeMalformedInput
    );
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
    const stableGoalUpdatedAt = new Date("2030-03-20T12:00:00.000Z");
    await fx.prisma.goal.update({
      where: { id: updatedGoal.id },
      data: { updatedAt: stableGoalUpdatedAt }
    });
    const duplicateGoal = await crm.createOrUpdateMonthlyWonRevenueGoal(fx.actorA, {
      month: "2030-03",
      currency: "USD",
      targetCents: 12000
    });
    const duplicateGoalRow = await fx.prisma.goal.findUniqueOrThrow({ where: { id: updatedGoal.id } });
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
    expect(duplicateGoal.id).toBe(updatedGoal.id);
    expect(duplicateGoal.targetCents).toBe(12000);
    expect(duplicateGoal.updatedAt.toISOString()).toBe(stableGoalUpdatedAt.toISOString());
    expect(duplicateGoalRow.updatedAt.toISOString()).toBe(stableGoalUpdatedAt.toISOString());
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
    const beforeReport = await crm.getDealReport(fx.actorA);
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
    const staleCrossWorkspaceActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsB.deal.id,
        type: "TASK",
        title: "Stale cross-workspace report activity",
        dueAt: yesterday
      }
    });

    const report = await crm.getDealReport(fx.actorA, { q: "Hygiene" });
    const stageOne = report.stageBreakdown.find((stage) => stage.stageId === fx.recordsA.stageOne.id);
    const taskActivitySummary = report.activitySummary.byType.find((group) => group.type === "TASK");

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
    expect(report.activitySummary.open).toBe(beforeReport.activitySummary.open + 3);
    expect(taskActivitySummary?.count).toBe(
      (beforeReport.activitySummary.byType.find((group) => group.type === "TASK")?.count ?? 0) + 1
    );
    expect(report.activitySummary.open).not.toBe(beforeReport.activitySummary.open + 4);
    expect((await crm.listActivities(fx.actorA)).map((activity) => activity.id)).not.toContain(staleCrossWorkspaceActivity.id);
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
    const emailLog = await crm.createEmailLog(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      direction: "OUTBOUND",
      occurredAt: new Date("2030-02-02T12:00:00.000Z"),
      subject: "Deal timeline email",
      body: "Customer-facing timeline email body.",
      fromText: "seller@example.test",
      toText: "buyer@example.test"
    });
    const mismatchedActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        leadId: fx.recordsB.lead.id,
        type: "TASK",
        title: "Mismatched timeline activity"
      }
    });
    const mismatchedNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        personId: fx.recordsB.person.id,
        body: "Mismatched timeline note"
      }
    });
    const mismatchedEmailLog = await fx.prisma.emailLog.create({
      data: {
        workspaceId: fx.workspaceA.id,
        createdById: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        organizationId: fx.recordsB.organization.id,
        direction: "OUTBOUND",
        occurredAt: new Date("2030-02-02T13:00:00.000Z"),
        subject: "Mismatched timeline email",
        body: "This email has a cross-workspace attachment."
      }
    });
    await crm.updateDeal(fx.actorA, fx.recordsA.deal.id, { title: "Timeline deal updated" });

    const timeline = await crm.getRecordTimeline(fx.actorA, { type: "DEAL", id: fx.recordsA.deal.id });
    const activityItems = timeline.filter((item) => item.type === "activity");
    const emailItem = timeline.find((item) => item.type === "email");
    const timelineText = timeline.map((item) =>
      item.type === "activity" ? item.title : item.type === "note" ? item.body : item.type === "email" ? item.subject : ""
    );

    expect(timeline.map((item) => item.type)).toEqual(expect.arrayContaining(["note", "activity", "email", "audit"]));
    expect(timeline.find((item) => item.type === "note")).toMatchObject({ body: "Deal timeline note" });
    expect(emailItem).toMatchObject({
      id: `email-${emailLog.id}`,
      body: "Customer-facing timeline email body.",
      createdByName: "Integration A",
      direction: "OUTBOUND",
      fromText: "seller@example.test",
      subject: "Deal timeline email",
      toText: "buyer@example.test"
    });
    expect(activityItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: openActivity.title, completedAt: null }),
        expect.objectContaining({ title: completedActivity.title, completedAt: expect.any(Date) })
      ])
    );
    expect(timeline.find((item) => item.type === "audit")).toMatchObject({ type: "audit" });
    expect(timeline.map((item) => item.id)).not.toEqual(
      expect.arrayContaining([
        `activity-${mismatchedActivity.id}`,
        `note-${mismatchedNote.id}`,
        `email-${mismatchedEmailLog.id}`
      ])
    );
    expect(timelineText).not.toEqual(
      expect.arrayContaining(["Mismatched timeline activity", "Mismatched timeline note", "Mismatched timeline email"])
    );
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
