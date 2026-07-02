import { randomBytes } from "node:crypto";

import { Prisma, type QuoteAdjustmentType, type QuoteStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { quoteIntColumnMax } from "@/lib/product-limits";
import { activityAttachmentRelationsWhere } from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

const quoteItemsOrderBy = [{ createdAt: "asc" }, { name: "asc" }] satisfies Prisma.QuoteItemOrderByWithRelationInput[];

const quoteInclude = (workspaceId: string) => ({
  items: {
    where: { workspaceId },
    orderBy: quoteItemsOrderBy
  }
}) satisfies Prisma.QuoteInclude;

const quoteTransitionActions = {
  SENT: "quote.sent",
  ACCEPTED: "quote.accepted",
  DECLINED: "quote.declined"
} satisfies Partial<Record<QuoteStatus, string>>;

const QUOTE_NUMBER_CREATE_ATTEMPTS = 5;

export type QuoteAdjustmentInput = {
  discountType?: unknown;
  discountValue?: unknown;
  taxType?: unknown;
  taxValue?: unknown;
};

export async function createQuoteFromDeal(actor: WorkspaceActor, dealId: string) {
  await ensureWorkspaceAccess(actor);

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId: actor.workspaceId, ...activeWhere },
    include: {
      lineItems: {
        where: { workspaceId: actor.workspaceId },
        orderBy: [{ createdAt: "asc" }, { productName: "asc" }]
      }
    }
  });

  if (!deal) {
    throw new ApiError("NOT_FOUND", "Deal was not found.", 404);
  }

  assertQuoteDealOpen(deal.status);

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
  const quoteItems = deal.lineItems.map((item) => ({
    workspaceId: actor.workspaceId,
    dealLineItemId: item.id,
    productId: item.productId,
    name: item.productName,
    description: item.description,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    currency: item.currency,
    lineTotalCents: item.lineTotalCents
  }));

  const quote = await createQuoteWithUniqueNumber({
    workspaceId: actor.workspaceId,
    dealId: deal.id,
    currency,
    subtotalCents,
    totalCents: totals.totalCents,
    items: quoteItems
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

async function createQuoteWithUniqueNumber({
  workspaceId,
  dealId,
  currency,
  subtotalCents,
  totalCents,
  items
}: {
  workspaceId: string;
  dealId: string;
  currency: string;
  subtotalCents: number;
  totalCents: number;
  items: Array<{
    workspaceId: string;
    dealLineItemId: string;
    productId: string | null;
    name: string;
    description: string | null;
    quantity: number;
    unitPriceCents: number;
    currency: string;
    lineTotalCents: number;
  }>;
}) {
  for (let attempt = 0; attempt < QUOTE_NUMBER_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockWorkspaceQuoteNumber(tx, workspaceId);
        const number = await nextQuoteNumber(workspaceId, tx);

        return tx.quote.create({
          data: {
            workspaceId,
            dealId,
            number,
            currency,
            subtotalCents,
            totalCents,
            items: { create: items }
          },
          include: quoteInclude(workspaceId)
        });
      });
    } catch (error) {
      if (!isUniqueQuoteNumberCollision(error) || attempt === QUOTE_NUMBER_CREATE_ATTEMPTS - 1) throw error;
    }
  }

  throw new ApiError("INTERNAL_ERROR", "Could not create a unique quote number.", 500);
}

export async function updateQuoteAdjustments(actor: WorkspaceActor, quoteId: string, input: QuoteAdjustmentInput) {
  await ensureWorkspaceAccess(actor);

  const existing = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: { deal: { select: { status: true } } }
  });

  if (!existing) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  assertQuoteDealOpen(existing.deal.status);

  if (existing.status !== "DRAFT") {
    throw new ApiError("VALIDATION_ERROR", "Quote adjustments can only be edited while the quote is DRAFT.", 422);
  }

  const totals = calculateQuoteTotals(existing.subtotalCents, input);
  if (quoteTotalsEqual(existing, totals)) {
    return getQuote(actor, existing.dealId, existing.id);
  }

  const quote = await prisma.quote.update({
    where: { id: existing.id },
    data: totals,
    include: quoteInclude(actor.workspaceId)
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

function quoteTotalsEqual(
  quote: {
    discountType: QuoteAdjustmentType;
    discountValue: number;
    discountCents: number;
    taxType: QuoteAdjustmentType;
    taxValue: number;
    taxCents: number;
    totalCents: number;
  },
  totals: ReturnType<typeof calculateQuoteTotals>
) {
  return (
    quote.discountType === totals.discountType &&
    quote.discountValue === totals.discountValue &&
    quote.discountCents === totals.discountCents &&
    quote.taxType === totals.taxType &&
    quote.taxValue === totals.taxValue &&
    quote.taxCents === totals.taxCents &&
    quote.totalCents === totals.totalCents
  );
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
      ...quoteInclude(actor.workspaceId),
      publicLinks: {
        where: activePublicLinkWhere(),
        orderBy: { createdAt: "desc" },
        take: 1
      },
      deal: {
        include: {
          person: true,
          organization: true,
          activities: {
            where: {
              workspaceId: actor.workspaceId,
              ...activityAttachmentRelationsWhere(actor.workspaceId),
              ...activeWhere,
              completedAt: null
            },
            orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
            take: 1
          },
          contractSteps: {
            where: { workspaceId: actor.workspaceId, ...activeWhere },
            orderBy: { type: "asc" }
          }
        }
      }
    }
  });

  if (!quote) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  return scopeQuoteDealRelations(actor.workspaceId, quote);
}

export async function createQuotePublicLink(actor: WorkspaceActor, quoteId: string) {
  await ensureWorkspaceAccess(actor);
  const quote = await findManageableQuote(actor, quoteId);
  assertQuoteDealOpen(quote.deal.status);
  assertQuoteCanCreatePublicLink(quote.status);

  const { publicLink, created } = await prisma.$transaction(async (tx) => {
    await lockQuotePublicLink(tx, quote.id);
    const existing = await tx.quotePublicLink.findFirst({
      where: {
        quoteId: quote.id,
        workspaceId: actor.workspaceId,
        ...activePublicLinkWhere()
      },
      orderBy: { createdAt: "desc" }
    });

    if (existing) return { publicLink: existing, created: false };

    return {
      publicLink: await createUniqueQuotePublicLink(actor.workspaceId, quote.id, tx),
      created: true
    };
  });

  if (!created) return publicLink;

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
        status: { not: "DRAFT" },
        workspace: { deletedAt: null },
        deal: activeWhere
      }
    },
    include: {
      quote: {
        include: {
          items: {
            orderBy: quoteItemsOrderBy
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

  assertPublicQuoteWorkspaceIntegrity(publicLink);

  return scopePublicQuote(publicLink.quote);
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
        status: { not: "DRAFT" },
        workspace: { deletedAt: null },
        deal: activeWhere
      }
    },
    include: {
      quote: {
        include: {
          deal: {
            select: { status: true, workspaceId: true }
          }
        }
      }
    }
  });

  if (!publicLink) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  assertPublicQuoteWorkspaceIntegrity(publicLink);

  if (publicLink.quote.status === "ACCEPTED") {
    return { accepted: false, alreadyAccepted: true, quote: publicLink.quote };
  }

  if (publicLink.quote.deal.status !== "OPEN") {
    throw new ApiError("VALIDATION_ERROR", "This quote is no longer available for public acceptance.", 422);
  }

  if (publicLink.quote.status !== "SENT") {
    throw new ApiError("VALIDATION_ERROR", "Only sent quotes can be accepted from a public link.", 422);
  }

  const accepted = await prisma.quote.updateMany({
    where: {
      id: publicLink.quote.id,
      status: "SENT",
      workspaceId: publicLink.workspaceId,
      workspace: { deletedAt: null },
      deal: { ...activeWhere, status: "OPEN" },
      publicLinks: {
        some: {
          id: publicLink.id,
          ...activePublicLinkWhere()
        }
      }
    },
    data: { status: "ACCEPTED" }
  });

  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: publicLink.quote.id },
    include: { deal: { select: { status: true } } }
  });

  if (accepted.count !== 1) {
    if (quote.status === "ACCEPTED") {
      return { accepted: false, alreadyAccepted: true, quote };
    }
    if (quote.status !== "SENT") {
      throw new ApiError("VALIDATION_ERROR", "Only sent quotes can be accepted from a public link.", 422);
    }
    if (quote.deal.status !== "OPEN") {
      throw new ApiError("VALIDATION_ERROR", "This quote is no longer available for public acceptance.", 422);
    }
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

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
  const normalizedNextStatus = normalizeQuoteTransitionStatus(nextStatus);

  const existing = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: { deal: { select: { status: true } } }
  });

  if (!existing) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  assertQuoteDealOpen(existing.deal.status);
  assertValidTransition(existing.status, normalizedNextStatus);

  const quote = await prisma.quote.update({
    where: { id: existing.id },
    data: { status: normalizedNextStatus },
    include: quoteInclude(actor.workspaceId)
  });

  await writeAuditLog(actor, quoteTransitionActions[normalizedNextStatus] ?? "quote.status_changed", "Quote", quote.id, {
    dealId: quote.dealId,
    number: quote.number,
    previousStatus: existing.status,
    nextStatus: quote.status
  });

  return quote;
}

function normalizeQuoteTransitionStatus(value: unknown): Exclude<QuoteStatus, "DRAFT"> {
  if (value === "SENT" || value === "ACCEPTED" || value === "DECLINED") return value;
  throw new ApiError("VALIDATION_ERROR", "Quote status must be SENT, ACCEPTED, or DECLINED.", 422);
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

  if (quote.deal.status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
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

export function calculateQuoteTotals(subtotalCents: number, input: unknown) {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
    throw new ApiError("VALIDATION_ERROR", "Quote subtotal must be a non-negative amount.", 422);
  }
  assertQuoteIntColumnValue("Quote subtotal", subtotalCents);

  const adjustmentInput = normalizeQuoteAdjustmentInput(input);
  const discountType = normalizeAdjustmentType(adjustmentInput.discountType ?? "NONE", "Discount");
  const taxType = normalizeAdjustmentType(adjustmentInput.taxType ?? "NONE", "Tax");
  const discountValue = normalizeAdjustmentValue(discountType, adjustmentInput.discountValue ?? 0, "Discount");
  const taxValue = normalizeAdjustmentValue(taxType, adjustmentInput.taxValue ?? 0, "Tax");
  const discountCents = calculateAdjustmentCents(subtotalCents, discountType, discountValue);
  assertQuoteIntColumnValue("Quote discount", discountCents);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = calculateAdjustmentCents(taxableCents, taxType, taxValue);
  assertQuoteIntColumnValue("Quote tax", taxCents);
  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents);
  assertQuoteIntColumnValue("Quote total", totalCents);

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

function normalizeQuoteAdjustmentInput(input: unknown): QuoteAdjustmentInput {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as QuoteAdjustmentInput;
  throw new ApiError("VALIDATION_ERROR", "Quote adjustments must be an object.", 422);
}

function normalizeAdjustmentType(value: unknown, label: "Discount" | "Tax"): QuoteAdjustmentType {
  if (value === "NONE" || value === "PERCENT" || value === "FIXED") return value;
  throw new ApiError("VALIDATION_ERROR", `${label} type must be NONE, PERCENT, or FIXED.`, 422);
}

function normalizeAdjustmentValue(type: QuoteAdjustmentType, value: unknown, label: "Discount" | "Tax") {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ApiError("VALIDATION_ERROR", `${label} value must be a non-negative whole number.`, 422);
  }
  if (type === "NONE") return 0;
  if (type === "PERCENT" && value > 10000) {
    throw new ApiError("VALIDATION_ERROR", `${label} percent cannot be greater than 100%.`, 422);
  }
  if (value > quoteIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", `${label} value is too large.`, 422);
  }
  return value;
}

function assertQuoteIntColumnValue(label: "Quote subtotal" | "Quote discount" | "Quote tax" | "Quote total", value: number) {
  if (!Number.isSafeInteger(value) || value > quoteIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", `${label} is too large.`, 422);
  }
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

function assertPublicQuoteWorkspaceIntegrity(publicLink: {
  workspaceId: string;
  quote: { workspaceId: string; deal?: { workspaceId: string } | null };
}) {
  if (publicLink.workspaceId !== publicLink.quote.workspaceId || publicLink.quote.deal?.workspaceId !== publicLink.quote.workspaceId) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }
}

function scopeQuoteDealRelations<
  T extends {
    deal: {
      workspaceId: string;
      person: WorkspaceScopedRelation;
      organization: WorkspaceScopedRelation;
    };
  }
>(workspaceId: string, quote: T) {
  return {
    ...quote,
    deal: {
      ...quote.deal,
      person: scopeWorkspaceRelation(workspaceId, quote.deal.person),
      organization: scopeWorkspaceRelation(workspaceId, quote.deal.organization)
    }
  };
}

function scopePublicQuote<
  T extends {
    workspaceId: string;
    items: Array<{ workspaceId: string }>;
    deal: {
      workspaceId: string;
      person: WorkspaceScopedRelation;
      organization: WorkspaceScopedRelation;
    };
  }
>(quote: T) {
  return {
    ...quote,
    items: quote.items.filter((item) => item.workspaceId === quote.workspaceId),
    deal: {
      ...quote.deal,
      person: scopeWorkspaceRelation(quote.workspaceId, quote.deal.person),
      organization: scopeWorkspaceRelation(quote.workspaceId, quote.deal.organization)
    }
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
      number: true,
      status: true,
      deal: {
        select: { status: true }
      }
    }
  });

  if (!quote) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  return quote;
}

function assertQuoteCanCreatePublicLink(status: QuoteStatus) {
  if (status !== "SENT") {
    throw new ApiError("VALIDATION_ERROR", "Public quote links can only be generated while the quote is SENT.", 422);
  }
}

function assertQuoteDealOpen(status: string) {
  if (status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }
}

async function createUniqueQuotePublicLink(
  workspaceId: string,
  quoteId: string,
  client: Pick<Prisma.TransactionClient, "quotePublicLink"> | typeof prisma = prisma
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.quotePublicLink.create({
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

function isUniqueQuoteNumberCollision(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function lockWorkspaceQuoteNumber(client: Pick<Prisma.TransactionClient, "$executeRaw">, workspaceId: string) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-number:${workspaceId}`}), 0)`;
}

async function lockQuotePublicLink(client: Pick<Prisma.TransactionClient, "$executeRaw">, quoteId: string) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-public-link:${quoteId}`}), 0)`;
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

async function nextQuoteNumber(workspaceId: string, client: Pick<Prisma.TransactionClient, "quote"> = prisma) {
  const quotes = await client.quote.findMany({
    where: { workspaceId, number: { startsWith: "Q-" } },
    select: { number: true }
  });
  const maxNumber = quotes.reduce((max, quote) => {
    const parsed = /^Q-(\d+)$/.exec(quote.number);
    if (!parsed) return max;
    return Math.max(max, Number.parseInt(parsed[1] ?? "0", 10));
  }, 0);

  return `Q-${String(maxNumber + 1).padStart(4, "0")}`;
}
