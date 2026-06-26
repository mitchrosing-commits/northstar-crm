import { randomBytes } from "node:crypto";

import { Prisma, type QuoteAdjustmentType, type QuoteStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

const quoteInclude = {
  items: {
    orderBy: [{ createdAt: "asc" }, { name: "asc" }]
  }
} satisfies Prisma.QuoteInclude;

const quoteTransitionActions = {
  SENT: "quote.sent",
  ACCEPTED: "quote.accepted",
  DECLINED: "quote.declined"
} satisfies Partial<Record<QuoteStatus, string>>;

export type QuoteAdjustmentInput = {
  discountType?: QuoteAdjustmentType;
  discountValue?: number;
  taxType?: QuoteAdjustmentType;
  taxValue?: number;
};

export async function createQuoteFromDeal(actor: WorkspaceActor, dealId: string) {
  await ensureWorkspaceAccess(actor);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId: actor.workspaceId, ...activeWhere },
    include: {
      lineItems: {
        orderBy: [{ createdAt: "asc" }, { productName: "asc" }]
      }
    }
  });

  if (!deal) {
    throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  }

  if (deal.lineItems.length === 0) {
    throw new ApiError("VALIDATION_ERROR", "Add at least one deal line item before creating a quote draft.", 422);
  }

  const currencies = new Set(deal.lineItems.map((item) => item.currency));
  if (currencies.size > 1) {
    throw new ApiError("VALIDATION_ERROR", "Quote drafts require deal line items to use one currency.", 422);
  }

  const currency = deal.lineItems[0]?.currency ?? deal.currency;
  const subtotalCents = deal.lineItems.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const totals = calculateQuoteTotals(subtotalCents, {});
  const number = await nextQuoteNumber(actor.workspaceId);

  const quote = await prisma.quote.create({
    data: {
      workspaceId: actor.workspaceId,
      dealId: deal.id,
      number,
      currency,
      subtotalCents,
      totalCents: totals.totalCents,
      items: {
        create: deal.lineItems.map((item) => ({
          workspaceId: actor.workspaceId,
          dealLineItemId: item.id,
          productId: item.productId,
          name: item.productName,
          description: item.description,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          currency: item.currency,
          lineTotalCents: item.lineTotalCents
        }))
      }
    },
    include: quoteInclude
  });

  await writeAuditLog(actor, "quote.created", "Quote", quote.id, {
    dealId: deal.id,
    number: quote.number,
    itemCount: quote.items.length,
    currency: quote.currency,
    totalCents: quote.totalCents
  });

  return quote;
}

export async function updateQuoteAdjustments(actor: WorkspaceActor, quoteId: string, input: QuoteAdjustmentInput) {
  await ensureWorkspaceAccess(actor);

  const existing = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    }
  });

  if (!existing) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  if (existing.status !== "DRAFT") {
    throw new ApiError("VALIDATION_ERROR", "Quote adjustments can only be edited while the quote is DRAFT.", 422);
  }

  const totals = calculateQuoteTotals(existing.subtotalCents, input);
  const quote = await prisma.quote.update({
    where: { id: existing.id },
    data: totals,
    include: quoteInclude
  });

  await writeAuditLog(actor, "quote.adjustments_updated", "Quote", quote.id, {
    dealId: quote.dealId,
    number: quote.number,
    previous: {
      discountType: existing.discountType,
      discountValue: existing.discountValue,
      discountCents: existing.discountCents,
      taxType: existing.taxType,
      taxValue: existing.taxValue,
      taxCents: existing.taxCents,
      totalCents: existing.totalCents
    },
    next: {
      discountType: quote.discountType,
      discountValue: quote.discountValue,
      discountCents: quote.discountCents,
      taxType: quote.taxType,
      taxValue: quote.taxValue,
      taxCents: quote.taxCents,
      totalCents: quote.totalCents
    }
  });

  return quote;
}

export async function getQuote(actor: WorkspaceActor, dealId: string, quoteId: string) {
  await ensureWorkspaceAccess(actor);

  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      dealId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: {
      ...quoteInclude,
      publicLinks: {
        where: activePublicLinkWhere(),
        orderBy: { createdAt: "desc" },
        take: 1
      },
      deal: {
        include: {
          person: true,
          organization: true
        }
      }
    }
  });

  if (!quote) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  return quote;
}

export async function createQuotePublicLink(actor: WorkspaceActor, quoteId: string) {
  await ensureWorkspaceAccess(actor);
  const quote = await findManageableQuote(actor, quoteId);

  const existing = await prisma.quotePublicLink.findFirst({
    where: {
      quoteId: quote.id,
      workspaceId: actor.workspaceId,
      ...activePublicLinkWhere()
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) return existing;

  const publicLink = await createUniqueQuotePublicLink(actor.workspaceId, quote.id);
  await writeAuditLog(actor, "quote.public_link_created", "Quote", quote.id, {
    dealId: quote.dealId,
    number: quote.number,
    publicLinkId: publicLink.id
  });

  return publicLink;
}

export async function revokeQuotePublicLink(actor: WorkspaceActor, quoteId: string) {
  await ensureWorkspaceAccess(actor);
  const quote = await findManageableQuote(actor, quoteId);
  const existing = await prisma.quotePublicLink.findFirst({
    where: {
      quoteId: quote.id,
      workspaceId: actor.workspaceId,
      ...activePublicLinkWhere()
    },
    orderBy: { createdAt: "desc" }
  });

  if (!existing) return { revoked: false };

  const publicLink = await prisma.quotePublicLink.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() }
  });

  await writeAuditLog(actor, "quote.public_link_revoked", "Quote", quote.id, {
    dealId: quote.dealId,
    number: quote.number,
    publicLinkId: publicLink.id
  });

  return { revoked: true };
}

export async function getPublicQuoteByToken(token: string) {
  if (!isPublicQuoteTokenShape(token)) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  const publicLink = await prisma.quotePublicLink.findFirst({
    where: {
      token,
      ...activePublicLinkWhere(),
      quote: {
        deal: activeWhere
      }
    },
    include: {
      quote: {
        include: {
          items: {
            orderBy: [{ createdAt: "asc" }, { name: "asc" }]
          },
          workspace: true,
          deal: {
            include: {
              organization: true,
              person: true
            }
          }
        }
      }
    }
  });

  if (!publicLink) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  return publicLink.quote;
}

export async function acceptPublicQuoteByToken(token: string) {
  if (!isPublicQuoteTokenShape(token)) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  const publicLink = await prisma.quotePublicLink.findFirst({
    where: {
      token,
      ...activePublicLinkWhere(),
      quote: {
        deal: activeWhere
      }
    },
    include: {
      quote: true
    }
  });

  if (!publicLink) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  if (publicLink.quote.status === "ACCEPTED") {
    return { accepted: false, alreadyAccepted: true, quote: publicLink.quote };
  }

  if (publicLink.quote.status !== "SENT") {
    throw new ApiError("VALIDATION_ERROR", "Only sent quotes can be accepted from a public link.", 422);
  }

  const quote = await prisma.quote.update({
    where: { id: publicLink.quote.id },
    data: { status: "ACCEPTED" }
  });

  await writePublicQuoteAuditLog(publicLink.workspaceId, "quote.public_accepted", quote.id, {
    quoteId: quote.id,
    quoteNumber: quote.number,
    publicLinkId: publicLink.id,
    previousStatus: publicLink.quote.status,
    nextStatus: quote.status,
    totalCents: quote.totalCents,
    currency: quote.currency
  });

  return { accepted: true, alreadyAccepted: false, quote };
}

export async function updateQuoteStatus(actor: WorkspaceActor, quoteId: string, nextStatus: Exclude<QuoteStatus, "DRAFT">) {
  await ensureWorkspaceAccess(actor);

  const existing = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    }
  });

  if (!existing) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  assertValidTransition(existing.status, nextStatus);

  const quote = await prisma.quote.update({
    where: { id: existing.id },
    data: { status: nextStatus },
    include: quoteInclude
  });

  await writeAuditLog(actor, quoteTransitionActions[nextStatus] ?? "quote.status_changed", "Quote", quote.id, {
    dealId: quote.dealId,
    number: quote.number,
    previousStatus: existing.status,
    nextStatus: quote.status
  });

  return quote;
}

export async function syncAcceptedQuoteToDealValue(actor: WorkspaceActor, quoteId: string) {
  await ensureWorkspaceAccess(actor);

  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: {
      deal: true
    }
  });

  if (!quote) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  if (quote.status !== "ACCEPTED") {
    throw new ApiError("VALIDATION_ERROR", "Only accepted quotes can be synced to deal value.", 422);
  }

  const alreadySynced = quote.deal.valueCents === quote.totalCents && quote.deal.currency === quote.currency;
  if (alreadySynced) {
    return { deal: quote.deal, quote, synced: false };
  }

  const deal = await prisma.deal.update({
    where: { id: quote.dealId },
    data: {
      valueCents: quote.totalCents,
      currency: quote.currency
    }
  });

  await writeAuditLog(actor, "deal.value_synced_from_quote", "Deal", deal.id, {
    quoteId: quote.id,
    quoteNumber: quote.number,
    previousValueCents: quote.deal.valueCents,
    previousCurrency: quote.deal.currency,
    nextValueCents: deal.valueCents,
    nextCurrency: deal.currency
  });

  return { deal, quote, synced: true };
}

function assertValidTransition(currentStatus: QuoteStatus, nextStatus: Exclude<QuoteStatus, "DRAFT">) {
  const allowed =
    (currentStatus === "DRAFT" && nextStatus === "SENT") ||
    (currentStatus === "SENT" && (nextStatus === "ACCEPTED" || nextStatus === "DECLINED"));

  if (!allowed) {
    throw new ApiError("VALIDATION_ERROR", `Cannot move quote from ${currentStatus} to ${nextStatus}.`, 422);
  }
}

export function calculateQuoteTotals(subtotalCents: number, input: QuoteAdjustmentInput) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new ApiError("VALIDATION_ERROR", "Quote subtotal must be a non-negative amount.", 422);
  }

  const discountType = input.discountType ?? "NONE";
  const taxType = input.taxType ?? "NONE";
  const discountValue = normalizeAdjustmentValue(discountType, input.discountValue ?? 0, "Discount");
  const taxValue = normalizeAdjustmentValue(taxType, input.taxValue ?? 0, "Tax");
  const discountCents = calculateAdjustmentCents(subtotalCents, discountType, discountValue);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = calculateAdjustmentCents(taxableCents, taxType, taxValue);
  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents);

  return {
    discountType,
    discountValue,
    discountCents,
    taxType,
    taxValue,
    taxCents,
    totalCents
  };
}

function normalizeAdjustmentValue(type: QuoteAdjustmentType, value: number, label: "Discount" | "Tax") {
  if (!Number.isInteger(value) || value < 0) {
    throw new ApiError("VALIDATION_ERROR", `${label} value must be a non-negative whole number.`, 422);
  }
  if (type === "NONE") return 0;
  if (type === "PERCENT" && value > 10000) {
    throw new ApiError("VALIDATION_ERROR", `${label} percent cannot be greater than 100%.`, 422);
  }
  return value;
}

function calculateAdjustmentCents(subtotalCents: number, type: QuoteAdjustmentType, value: number) {
  if (type === "NONE") return 0;
  if (type === "FIXED") return value;
  return Math.round((subtotalCents * value) / 10000);
}

function activePublicLinkWhere(now = new Date()): Prisma.QuotePublicLinkWhereInput {
  return {
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
  };
}

async function findManageableQuote(actor: WorkspaceActor, quoteId: string) {
  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    select: {
      id: true,
      dealId: true,
      number: true
    }
  });

  if (!quote) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  return quote;
}

async function createUniqueQuotePublicLink(workspaceId: string, quoteId: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.quotePublicLink.create({
        data: {
          workspaceId,
          quoteId,
          token: generatePublicQuoteToken()
        }
      });
    } catch (error) {
      if (!isUniqueTokenCollision(error) || attempt === 2) throw error;
    }
  }

  throw new ApiError("INTERNAL_ERROR", "Could not create a public quote link.", 500);
}

export function generatePublicQuoteToken() {
  return randomBytes(32).toString("base64url");
}

function isPublicQuoteTokenShape(token: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

function isUniqueTokenCollision(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function writePublicQuoteAuditLog(workspaceId: string, action: string, entityId: string, metadata: unknown) {
  await prisma.auditLog.create({
    data: {
      workspaceId,
      action,
      entityType: "Quote",
      entityId,
      metadata: JSON.parse(JSON.stringify(metadata))
    }
  });
}

async function nextQuoteNumber(workspaceId: string) {
  const count = await prisma.quote.count({ where: { workspaceId } });
  return `Q-${String(count + 1).padStart(4, "0")}`;
}
