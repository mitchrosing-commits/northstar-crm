import { DealStatus, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { productIntColumnMax } from "@/lib/product-limits";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type CreateProductInput = {
  name: unknown;
  description?: unknown;
  unitPriceCents: number;
  currency?: unknown;
};
export type UpdateProductInput = CreateProductInput;

export type CreateDealLineItemInput = {
  dealId: unknown;
  productId: unknown;
  quantity: unknown;
  description?: unknown;
};

const productOrderBy = [{ active: "desc" }, { name: "asc" }, { createdAt: "asc" }] satisfies Prisma.ProductOrderByWithRelationInput[];

export async function listProducts(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);

  return prisma.product.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    orderBy: productOrderBy
  });
}

export async function createProduct(actor: WorkspaceActor, input: unknown) {
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

export async function updateProduct(actor: WorkspaceActor, productId: string, input: unknown) {
  await ensureWorkspaceAccess(actor);

  const existing = await findProductInWorkspace(actor, productId);
  const data = normalizeProductInput(input);
  if (!productUpdateChanges(data, existing)) {
    return existing;
  }

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
  const activeFlag = normalizeProductActiveFlag(active);
  if (existing.active === activeFlag) return existing;

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: { active: activeFlag }
  });

  await writeAuditLog(actor, activeFlag ? "product.reactivated" : "product.deactivated", "Product", product.id, {
    name: product.name,
    active: product.active
  });

  return product;
}

export async function createDealLineItem(actor: WorkspaceActor, input: unknown) {
  await ensureWorkspaceAccess(actor);

  const lineItemInput = normalizeLineItemInput(input);

  const [deal, product] = await Promise.all([
    prisma.deal.findFirst({
      where: { id: lineItemInput.dealId, workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, status: true, title: true }
    }),
    prisma.product.findFirst({
      where: { id: lineItemInput.productId, workspaceId: actor.workspaceId, active: true, ...activeWhere },
      select: { id: true, name: true, description: true, unitPriceCents: true, currency: true }
    })
  ]);

  if (!deal) throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  if (!product) throw new ApiError("NOT_FOUND", "Product was not found.", 404);
  ensureDealIsOpen(deal.status);
  const lineTotalCents = product.unitPriceCents * lineItemInput.quantity;
  if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents > productIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", "Line item total is too large.", 422);
  }

  const lineItem = await prisma.dealLineItem.create({
    data: {
      workspaceId: actor.workspaceId,
      dealId: deal.id,
      productId: product.id,
      productName: product.name,
      description: normalizeLineItemDescription(lineItemInput.description, product.description),
      quantity: lineItemInput.quantity,
      unitPriceCents: product.unitPriceCents,
      currency: product.currency,
      lineTotalCents
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
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: {
      deal: {
        select: { status: true }
      }
    }
  });

  if (!lineItem) {
    throw new ApiError("NOT_FOUND", "Deal line item was not found.", 404);
  }
  ensureDealIsOpen(lineItem.deal.status);
  const deletedLineItem = stripDealRelation(lineItem);

  await prisma.dealLineItem.delete({ where: { id: lineItem.id } });

  await writeAuditLog(actor, "deal_line_item.removed", "DealLineItem", lineItem.id, {
    dealId: deletedLineItem.dealId,
    productId: deletedLineItem.productId,
    productName: deletedLineItem.productName,
    quantity: deletedLineItem.quantity,
    lineTotalCents: deletedLineItem.lineTotalCents,
    currency: deletedLineItem.currency
  });

  return deletedLineItem;
}

function ensureDealIsOpen(status: DealStatus) {
  if (status !== DealStatus.OPEN) {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }
}

function productUpdateChanges(
  input: ReturnType<typeof normalizeProductInput>,
  existing: { name: string; description: string | null; unitPriceCents: number; currency: string }
) {
  if (input.name !== existing.name) return true;
  if (input.description !== existing.description) return true;
  if (input.unitPriceCents !== existing.unitPriceCents) return true;
  if (input.currency !== existing.currency) return true;
  return false;
}

function normalizeProductActiveFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  throw new ApiError("VALIDATION_ERROR", "Product active flag must be true or false.", 422);
}

function normalizeLineItemInput(data: unknown) {
  const input = objectInput(data);
  return {
    dealId: normalizeLineItemRelationId(input.dealId),
    productId: normalizeLineItemRelationId(input.productId),
    quantity: normalizeLineItemQuantity(input.quantity),
    description: input.description
  };
}

function normalizeLineItemRelationId(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Line item relation ids must be text.", 422);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_ERROR", "Line item relation ids must be text.", 422);
  }
  return trimmed;
}

function normalizeLineItemQuantity(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ApiError("VALIDATION_ERROR", "Line item quantity must be at least 1.", 422);
  }
  if (value > productIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", "Line item quantity is too large.", 422);
  }
  return value;
}

function stripDealRelation<T extends { deal: unknown }>(lineItem: T) {
  const { deal, ...rest } = lineItem;
  void deal;
  return rest;
}

function normalizeCurrency(currency: unknown) {
  if (currency === undefined) return "USD";
  if (typeof currency !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Currency must be a 3-letter code.", 422);
  }
  const normalized = (currency.trim() || "USD").toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ApiError("VALIDATION_ERROR", "Currency must be a 3-letter code.", 422);
  }
  return normalized;
}

function normalizeProductInput(data: unknown) {
  const input = objectInput(data);
  const name = normalizeProductName(input.name);
  const description = normalizeProductDescription(input.description);
  const currency = normalizeCurrency(input.currency);
  const unitPriceCents = normalizeProductUnitPriceCents(input.unitPriceCents);

  if (!name) {
    throw new ApiError("VALIDATION_ERROR", "Product name is required.", 422);
  }

  return {
    name,
    description,
    unitPriceCents,
    currency
  };
}

function normalizeProductUnitPriceCents(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ApiError("VALIDATION_ERROR", "Product unit price must be a non-negative amount.", 422);
  }
  if (value > productIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", "Product unit price is too large.", 422);
  }
  return value;
}

function normalizeProductName(name: unknown) {
  if (typeof name !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Product name is required.", 422);
  }
  return name.trim();
}

function normalizeProductDescription(description: unknown) {
  if (description === undefined || description === null) return null;
  if (typeof description !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Product description must be text.", 422);
  }
  return description.trim() || null;
}

function normalizeLineItemDescription(description: unknown, fallback: string | null) {
  if (description === undefined || description === null) return fallback;
  if (typeof description !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Line item description must be text.", 422);
  }
  return description.trim() || fallback;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
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
