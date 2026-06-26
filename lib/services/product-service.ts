import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type CreateProductInput = {
  name: string;
  description?: string | null;
  unitPriceCents: number;
  currency?: string;
};
export type UpdateProductInput = CreateProductInput;

export type CreateDealLineItemInput = {
  dealId: string;
  productId: string;
  quantity: number;
  description?: string | null;
};

const productOrderBy = [{ active: "desc" }, { name: "asc" }, { createdAt: "asc" }] satisfies Prisma.ProductOrderByWithRelationInput[];

export async function listProducts(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);

  return prisma.product.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    orderBy: productOrderBy
  });
}

export async function createProduct(actor: WorkspaceActor, input: CreateProductInput) {
  await ensureWorkspaceAccess(actor);

  const data = normalizeProductInput(input);

  const product = await prisma.product.create({
    data: {
      workspaceId: actor.workspaceId,
      ...data
    }
  });

  await writeAuditLog(actor, "product.created", "Product", product.id, {
    name: product.name,
    unitPriceCents: product.unitPriceCents,
    currency: product.currency
  });

  return product;
}

export async function updateProduct(actor: WorkspaceActor, productId: string, input: UpdateProductInput) {
  await ensureWorkspaceAccess(actor);

  const existing = await findProductInWorkspace(actor, productId);
  const data = normalizeProductInput(input);
  const product = await prisma.product.update({
    where: { id: existing.id },
    data
  });

  await writeAuditLog(actor, "product.updated", "Product", product.id, {
    previousName: existing.name,
    name: product.name,
    unitPriceCents: product.unitPriceCents,
    currency: product.currency,
    active: product.active
  });

  return product;
}

export async function setProductActive(actor: WorkspaceActor, productId: string, active: boolean) {
  await ensureWorkspaceAccess(actor);

  const existing = await findProductInWorkspace(actor, productId);
  const product = await prisma.product.update({
    where: { id: existing.id },
    data: { active }
  });

  await writeAuditLog(actor, active ? "product.reactivated" : "product.deactivated", "Product", product.id, {
    name: product.name,
    active: product.active
  });

  return product;
}

export async function createDealLineItem(actor: WorkspaceActor, input: CreateDealLineItemInput) {
  await ensureWorkspaceAccess(actor);

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new ApiError("VALIDATION_ERROR", "Line item quantity must be at least 1.", 422);
  }

  const [deal, product] = await Promise.all([
    prisma.deal.findFirst({
      where: { id: input.dealId, workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, title: true }
    }),
    prisma.product.findFirst({
      where: { id: input.productId, workspaceId: actor.workspaceId, active: true, ...activeWhere },
      select: { id: true, name: true, description: true, unitPriceCents: true, currency: true }
    })
  ]);

  if (!deal) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  if (!product) throw new ApiError("NOT_FOUND", "Product was not found.", 404);

  const lineItem = await prisma.dealLineItem.create({
    data: {
      workspaceId: actor.workspaceId,
      dealId: deal.id,
      productId: product.id,
      productName: product.name,
      description: input.description?.trim() || product.description,
      quantity: input.quantity,
      unitPriceCents: product.unitPriceCents,
      currency: product.currency,
      lineTotalCents: product.unitPriceCents * input.quantity
    }
  });

  await writeAuditLog(actor, "deal_line_item.created", "DealLineItem", lineItem.id, {
    dealId: deal.id,
    productId: product.id,
    productName: lineItem.productName,
    quantity: lineItem.quantity,
    lineTotalCents: lineItem.lineTotalCents,
    currency: lineItem.currency
  });

  return lineItem;
}

export async function removeDealLineItem(actor: WorkspaceActor, lineItemId: string) {
  await ensureWorkspaceAccess(actor);

  const lineItem = await prisma.dealLineItem.findFirst({
    where: {
      id: lineItemId,
      workspaceId: actor.workspaceId
    }
  });

  if (!lineItem) {
    throw new ApiError("NOT_FOUND", "Deal line item was not found.", 404);
  }

  await prisma.dealLineItem.delete({ where: { id: lineItem.id } });

  await writeAuditLog(actor, "deal_line_item.removed", "DealLineItem", lineItem.id, {
    dealId: lineItem.dealId,
    productId: lineItem.productId,
    productName: lineItem.productName,
    quantity: lineItem.quantity,
    lineTotalCents: lineItem.lineTotalCents,
    currency: lineItem.currency
  });

  return lineItem;
}

function normalizeCurrency(currency?: string) {
  const normalized = (currency?.trim() || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ApiError("VALIDATION_ERROR", "Currency must be a 3-letter code.", 422);
  }
  return normalized;
}

function normalizeProductInput(input: CreateProductInput | UpdateProductInput) {
  const name = input.name.trim();
  const description = input.description?.trim() || null;
  const currency = normalizeCurrency(input.currency);

  if (!name) {
    throw new ApiError("VALIDATION_ERROR", "Product name is required.", 422);
  }

  if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0) {
    throw new ApiError("VALIDATION_ERROR", "Product unit price must be a non-negative amount.", 422);
  }

  return {
    name,
    description,
    unitPriceCents: input.unitPriceCents,
    currency
  };
}

async function findProductInWorkspace(actor: WorkspaceActor, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, workspaceId: actor.workspaceId, ...activeWhere }
  });

  if (!product) {
    throw new ApiError("NOT_FOUND", "Product was not found.", 404);
  }

  return product;
}
