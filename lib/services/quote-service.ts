import { randomBytes } from "node:crypto";

import { Prisma, type QuoteAdjustmentType, type QuoteStatus } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { resolvePagination, type PaginationInput } from "@/lib/list-page-query";
import { productIntColumnMax, quoteIntColumnMax } from "@/lib/product-limits";
import { activityAttachmentRelationsWhere } from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

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
const legacySyncConflictReason = "Deal value at send time was not captured. Review before syncing this accepted quote total.";
const changedDealSyncConflictReason = "Deal value changed after this quote was sent. Review before syncing this accepted quote total.";
const quoteSyncUpdateConfirmation = "UPDATE_DEAL_TO_ACCEPTED_QUOTE";

export type QuoteAdjustmentInput = {
  discountType?: unknown;
  discountValue?: unknown;
  taxType?: unknown;
  taxValue?: unknown;
};
export type CreateQuoteItemInput = {
  productId?: unknown;
  quantity?: unknown;
  description?: unknown;
};
export type UpdateQuoteItemInput = {
  quantity?: unknown;
  description?: unknown;
};
export type QuoteSyncReviewInput = {
  resolution?: unknown;
  confirmation?: unknown;
};
export type QuoteListFilters = {
  q?: string;
  status?: QuoteStatus;
  sortBy?: "createdAt" | "updatedAt" | "number" | "totalCents";
  sortDirection?: "asc" | "desc";
};

export async function listQuotesPage(actor: WorkspaceActor, filters: QuoteListFilters = {}, pagination: PaginationInput) {
  await ensureWorkspaceAccess(actor);
  const where = quoteWhere(actor.workspaceId, filters);
  const total = await prisma.quote.count({ where });
  const pageInfo = resolvePagination(total, pagination);
  const items = await prisma.quote.findMany({
    where,
    include: {
      deal: {
        include: {
          owner: { select: userDisplaySelect },
          person: true,
          organization: true,
          stage: true
        }
      },
      _count: { select: { items: true } }
    },
    orderBy: quoteOrderBy(filters),
    skip: pageInfo.skip,
    take: pageInfo.pageSize
  });

  return { ...pageInfo, items: items.map((quote) => scopeQuoteDealRelations(actor.workspaceId, quote)) };
}

function quoteWhere(workspaceId: string, filters: QuoteListFilters): Prisma.QuoteWhereInput {
  const where: Prisma.QuoteWhereInput = {
    workspaceId,
    deal: { workspaceId, ...activeWhere }
  };

  if (filters.status) where.status = normalizeQuoteListStatus(filters.status);
  if (filters.q) {
    where.OR = [
      { number: { contains: filters.q, mode: "insensitive" } },
      { deal: { is: { workspaceId, ...activeWhere, title: { contains: filters.q, mode: "insensitive" } } } },
      { deal: { is: { workspaceId, ...activeWhere, organization: { is: { workspaceId, ...activeWhere, name: { contains: filters.q, mode: "insensitive" } } } } } },
      {
        deal: {
          is: {
            workspaceId,
            ...activeWhere,
            person: {
              is: {
                workspaceId,
                ...activeWhere,
                OR: [
                  { firstName: { contains: filters.q, mode: "insensitive" } },
                  { lastName: { contains: filters.q, mode: "insensitive" } },
                  { email: { contains: filters.q, mode: "insensitive" } }
                ]
              }
            }
          }
        }
      }
    ];
  }

  return where;
}

function normalizeQuoteListStatus(value: unknown): QuoteStatus {
  if (value === "DRAFT" || value === "SENT" || value === "ACCEPTED" || value === "DECLINED") return value;
  throw new ApiError("VALIDATION_ERROR", "Quote status filter must be DRAFT, SENT, ACCEPTED, or DECLINED.", 422);
}

function quoteOrderBy(filters: QuoteListFilters): Prisma.QuoteOrderByWithRelationInput {
  const direction = normalizeQuoteSortDirection(filters.sortDirection);
  const sortBy = normalizeQuoteSortBy(filters.sortBy);
  if (sortBy === "createdAt") return { createdAt: direction };
  if (sortBy === "number") return { number: direction };
  if (sortBy === "totalCents") return { totalCents: direction };
  return { updatedAt: direction };
}

function normalizeQuoteSortBy(value: unknown): NonNullable<QuoteListFilters["sortBy"]> {
  if (value === undefined) return "updatedAt";
  if (value === "createdAt" || value === "updatedAt" || value === "number" || value === "totalCents") return value;
  throw new ApiError("VALIDATION_ERROR", "Quote sort field must be createdAt, updatedAt, number, or totalCents.", 422);
}

function normalizeQuoteSortDirection(value: unknown): NonNullable<QuoteListFilters["sortDirection"]> {
  if (value === undefined) return "desc";
  if (value === "asc" || value === "desc") return value;
  throw new ApiError("VALIDATION_ERROR", "Quote sort direction must be asc or desc.", 422);
}

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
    include: { deal: { select: { id: true, status: true, valueCents: true, currency: true } } }
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

export async function createQuoteItem(actor: WorkspaceActor, quoteId: string, input: CreateQuoteItemInput) {
  await ensureWorkspaceAccess(actor);
  const data = normalizeCreateQuoteItemInput(input);

  return prisma.$transaction(async (tx) => {
    const quote = await findEditableDraftQuote(actor, quoteId, tx);
    const product = await tx.product.findFirst({
      where: { id: data.productId, workspaceId: actor.workspaceId, active: true, ...activeWhere },
      select: { id: true, name: true, description: true, unitPriceCents: true, currency: true }
    });

    if (!product) throw new ApiError("NOT_FOUND", "Product was not found.", 404);
    if (product.currency !== quote.currency) {
      throw new ApiError("VALIDATION_ERROR", "Draft quote line items must use the quote currency.", 422);
    }

    const lineTotalCents = calculateQuoteLineTotal(product.unitPriceCents, data.quantity);
    const item = await tx.quoteItem.create({
      data: {
        workspaceId: actor.workspaceId,
        quoteId: quote.id,
        productId: product.id,
        name: product.name,
        description: normalizeQuoteItemDescription(data.description, product.description),
        quantity: data.quantity,
        unitPriceCents: product.unitPriceCents,
        currency: product.currency,
        lineTotalCents
      }
    });
    const updatedQuote = await recalculateQuoteFromItems(tx, actor.workspaceId, quote.id);

    await writeAuditLogWithClient(tx, actor, "quote_item.created", "QuoteItem", item.id, {
      quoteId: quote.id,
      quoteNumber: quote.number,
      dealId: quote.dealId,
      productId: product.id,
      name: item.name,
      quantity: item.quantity,
      lineTotalCents: item.lineTotalCents,
      currency: item.currency
    });

    return { item, quote: updatedQuote };
  });
}

export async function updateQuoteItem(actor: WorkspaceActor, quoteItemId: string, input: UpdateQuoteItemInput) {
  await ensureWorkspaceAccess(actor);
  const data = normalizeUpdateQuoteItemInput(input);

  return prisma.$transaction(async (tx) => {
    const existing = await findEditableDraftQuoteItem(actor, quoteItemId, tx);
    const quantity = data.quantity ?? existing.quantity;
    const description = data.description === undefined ? existing.description : data.description;
    const lineTotalCents = calculateQuoteLineTotal(existing.unitPriceCents, quantity);

    if (quantity === existing.quantity && description === existing.description) {
      const quote = await tx.quote.findUniqueOrThrow({
        where: { id: existing.quote.id },
        include: quoteInclude(actor.workspaceId)
      });
      return { item: existing, quote };
    }

    const item = await tx.quoteItem.update({
      where: { id: existing.id },
      data: { quantity, description, lineTotalCents }
    });
    const updatedQuote = await recalculateQuoteFromItems(tx, actor.workspaceId, existing.quote.id);

    await writeAuditLogWithClient(tx, actor, "quote_item.updated", "QuoteItem", item.id, {
      quoteId: existing.quote.id,
      quoteNumber: existing.quote.number,
      dealId: existing.quote.dealId,
      previous: {
        quantity: existing.quantity,
        description: existing.description,
        lineTotalCents: existing.lineTotalCents
      },
      next: {
        quantity: item.quantity,
        description: item.description,
        lineTotalCents: item.lineTotalCents
      }
    });

    return { item, quote: updatedQuote };
  });
}

export async function removeQuoteItem(actor: WorkspaceActor, quoteItemId: string) {
  await ensureWorkspaceAccess(actor);

  return prisma.$transaction(async (tx) => {
    const existing = await findEditableDraftQuoteItem(actor, quoteItemId, tx);

    await tx.quoteItem.delete({ where: { id: existing.id } });
    const updatedQuote = await recalculateQuoteFromItems(tx, actor.workspaceId, existing.quote.id);

    await writeAuditLogWithClient(tx, actor, "quote_item.removed", "QuoteItem", existing.id, {
      quoteId: existing.quote.id,
      quoteNumber: existing.quote.number,
      dealId: existing.quote.dealId,
      productId: existing.productId,
      name: existing.name,
      quantity: existing.quantity,
      lineTotalCents: existing.lineTotalCents,
      currency: existing.currency
    });

    return { item: stripQuoteRelation(existing), quote: updatedQuote };
  });
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

async function findEditableDraftQuote(
  actor: WorkspaceActor,
  quoteId: string,
  client: Pick<Prisma.TransactionClient, "quote"> | typeof prisma = prisma
) {
  const quote = await client.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: {
      deal: { select: { status: true } }
    }
  });

  if (!quote) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  assertQuoteDealOpen(quote.deal.status);
  if (quote.status !== "DRAFT") {
    throw new ApiError("VALIDATION_ERROR", "Quote line items can only be edited while the quote is DRAFT.", 422);
  }

  return quote;
}

async function findEditableDraftQuoteItem(
  actor: WorkspaceActor,
  quoteItemId: string,
  client: Pick<Prisma.TransactionClient, "quoteItem"> | typeof prisma = prisma
) {
  const item = await client.quoteItem.findFirst({
    where: {
      id: quoteItemId,
      workspaceId: actor.workspaceId,
      quote: {
        workspaceId: actor.workspaceId,
        deal: { workspaceId: actor.workspaceId, ...activeWhere }
      }
    },
    include: {
      quote: {
        include: {
          deal: { select: { status: true } }
        }
      }
    }
  });

  if (!item) {
    throw new ApiError("NOT_FOUND", "Quote line item was not found.", 404);
  }

  assertQuoteDealOpen(item.quote.deal.status);
  if (item.quote.status !== "DRAFT") {
    throw new ApiError("VALIDATION_ERROR", "Quote line items can only be edited while the quote is DRAFT.", 422);
  }

  return item;
}

async function recalculateQuoteFromItems(
  client: Pick<Prisma.TransactionClient, "quote" | "quoteItem">,
  workspaceId: string,
  quoteId: string
) {
  const quote = await client.quote.findUniqueOrThrow({ where: { id: quoteId } });
  const items = await client.quoteItem.findMany({
    where: { workspaceId, quoteId },
    select: { lineTotalCents: true }
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const totals = calculateQuoteTotals(subtotalCents, {
    discountType: quote.discountType,
    discountValue: quote.discountValue,
    taxType: quote.taxType,
    taxValue: quote.taxValue
  });

  return client.quote.update({
    where: { id: quoteId },
    data: {
      subtotalCents,
      ...totals
    },
    include: quoteInclude(workspaceId)
  });
}

function normalizeCreateQuoteItemInput(input: unknown) {
  const data = objectInput(input);
  return {
    productId: normalizeQuoteItemRelationId(data.productId),
    quantity: normalizeQuoteItemQuantity(data.quantity),
    description: data.description
  };
}

function normalizeUpdateQuoteItemInput(input: unknown) {
  const data = objectInput(input);
  return {
    quantity: data.quantity === undefined ? undefined : normalizeQuoteItemQuantity(data.quantity),
    description: data.description === undefined ? undefined : normalizeQuoteItemDescription(data.description, null)
  };
}

function normalizeQuoteItemRelationId(value: unknown) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Quote line item relation ids must be text.", 422);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ApiError("VALIDATION_ERROR", "Quote line item relation ids must be text.", 422);
  }
  return trimmed;
}

function normalizeQuoteItemQuantity(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ApiError("VALIDATION_ERROR", "Quote line item quantity must be at least 1.", 422);
  }
  if (value > productIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", "Quote line item quantity is too large.", 422);
  }
  return value;
}

function normalizeQuoteItemDescription(description: unknown, fallback: string | null) {
  if (description === undefined) return fallback;
  if (description === null) return null;
  if (typeof description !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Quote line item description must be text.", 422);
  }
  return description.trim() || null;
}

function calculateQuoteLineTotal(unitPriceCents: number, quantity: number) {
  const lineTotalCents = unitPriceCents * quantity;
  if (!Number.isSafeInteger(lineTotalCents) || lineTotalCents > quoteIntColumnMax) {
    throw new ApiError("VALIDATION_ERROR", "Quote line item total is too large.", 422);
  }
  return lineTotalCents;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function auditMetadataQuoteId(metadata: unknown) {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
  const quoteId = (metadata as Record<string, unknown>).quoteId;
  return typeof quoteId === "string" ? quoteId : null;
}

function stripQuoteRelation<T extends { quote: unknown }>(item: T) {
  const { quote, ...rest } = item;
  void quote;
  return rest;
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
              ...activeWhere
            },
            orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
            take: 20
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

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      workspaceId: actor.workspaceId,
      OR: [
        { entityType: "Quote", entityId: quote.id },
        {
          entityType: "QuoteItem",
          action: { in: ["quote_item.created", "quote_item.updated", "quote_item.removed"] },
          metadata: { path: ["quoteId"], equals: quote.id }
        },
        { entityType: "Deal", entityId: quote.dealId, action: "deal.value_synced_from_quote" }
      ]
    },
    include: { actor: { select: userDisplaySelect } },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return {
    ...scopeQuoteDealRelations(actor.workspaceId, quote),
    auditLogs: auditLogs.filter((event) => event.entityType === "Quote" || auditMetadataQuoteId(event.metadata) === quote.id)
  };
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
            select: { id: true, status: true, workspaceId: true, valueCents: true, currency: true }
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

  const { accepted, quote } = await prisma.$transaction(async (tx) => {
    const accepted = await tx.quote.updateMany({
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
    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: publicLink.quote.id },
      include: { deal: { select: { id: true, status: true, valueCents: true, currency: true } } }
    });

    if (accepted.count === 1) {
      await applyAcceptedQuoteDealValueSync(tx, publicLink.workspaceId, quote, null);
      await writePublicQuoteAuditLogWithClient(tx, publicLink.workspaceId, "quote.public_accepted", quote.id, {
        quoteId: quote.id,
        quoteNumber: quote.number,
        publicLinkId: publicLink.id,
        previousStatus: publicLink.quote.status,
        nextStatus: quote.status,
        totalCents: quote.totalCents,
        currency: quote.currency
      });
    }

    return { accepted, quote };
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
    include: { deal: { select: { id: true, status: true, valueCents: true, currency: true } } }
  });

  if (!existing) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  assertQuoteDealOpen(existing.deal.status);
  assertValidTransition(existing.status, normalizedNextStatus);

  const quote = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.update({
      where: { id: existing.id },
      data: quoteTransitionData(normalizedNextStatus, existing),
      include: {
        ...quoteInclude(actor.workspaceId),
        deal: { select: { id: true, status: true, valueCents: true, currency: true } }
      }
    });

    if (normalizedNextStatus === "ACCEPTED") {
      await applyAcceptedQuoteDealValueSync(tx, actor.workspaceId, quote, actor);
    }

    await writeAuditLogWithClient(tx, actor, quoteTransitionActions[normalizedNextStatus] ?? "quote.status_changed", "Quote", quote.id, {
      dealId: quote.dealId,
      number: quote.number,
      previousStatus: existing.status,
      nextStatus: quote.status
    });

    return tx.quote.findUniqueOrThrow({
      where: { id: quote.id },
      include: quoteInclude(actor.workspaceId)
    });
  });

  return quote;
}

function quoteTransitionData(
  nextStatus: Exclude<QuoteStatus, "DRAFT">,
  quote: { deal: { valueCents: number | null; currency: string } }
): Prisma.QuoteUpdateInput {
  if (nextStatus !== "SENT") {
    return { status: nextStatus };
  }

  return {
    status: nextStatus,
    sentDealValueCents: quote.deal.valueCents,
    sentDealCurrency: quote.deal.currency,
    dealValueSyncedAt: null,
    dealValueSyncConflict: null
  };
}

function normalizeQuoteTransitionStatus(value: unknown): Exclude<QuoteStatus, "DRAFT"> {
  if (value === "SENT" || value === "ACCEPTED" || value === "DECLINED") return value;
  throw new ApiError("VALIDATION_ERROR", "Quote status must be SENT, ACCEPTED, or DECLINED.", 422);
}

function normalizeQuoteSyncReviewResolution(input: QuoteSyncReviewInput) {
  const resolution = input.resolution;
  if (resolution === "UPDATE_DEAL_TO_QUOTE" || resolution === "KEEP_CURRENT_DEAL") return resolution;
  throw new ApiError("VALIDATION_ERROR", "Quote sync review resolution must be UPDATE_DEAL_TO_QUOTE or KEEP_CURRENT_DEAL.", 422);
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

  if (quote.dealValueSyncedAt) {
    return { deal: quote.deal, quote, synced: false };
  }

  const alreadySynced = quote.deal.valueCents === quote.totalCents && quote.deal.currency === quote.currency;
  if (alreadySynced) {
    const updatedQuote = await prisma.quote.update({
      where: { id: quote.id },
      data: {
        dealValueSyncedAt: new Date(),
        dealValueSyncReviewedAt: new Date(),
        dealValueSyncResolution: "UPDATE_DEAL_TO_QUOTE",
        dealValueSyncConflict: null
      }
    });
    return { deal: quote.deal, quote: updatedQuote, synced: false };
  }

  const { deal, updatedQuote } = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.update({
      where: { id: quote.dealId },
      data: {
        valueCents: quote.totalCents,
        currency: quote.currency
      }
    });
    const updatedQuote = await tx.quote.update({
      where: { id: quote.id },
      data: {
        dealValueSyncedAt: new Date(),
        dealValueSyncReviewedAt: new Date(),
        dealValueSyncResolution: "UPDATE_DEAL_TO_QUOTE",
        dealValueSyncConflict: null
      }
    });

    await writeAuditLogWithClient(tx, actor, "deal.value_synced_from_quote", "Deal", deal.id, {
      quoteId: quote.id,
      quoteNumber: quote.number,
      previousValueCents: quote.deal.valueCents,
      previousCurrency: quote.deal.currency,
      nextValueCents: deal.valueCents,
      nextCurrency: deal.currency,
      mode: "reviewed-manual-sync"
    });

    return { deal, updatedQuote };
  });

  return { deal, quote: updatedQuote, synced: true };
}

export async function reviewQuoteDealValueSync(actor: WorkspaceActor, quoteId: string, input: QuoteSyncReviewInput) {
  await ensureWorkspaceAccess(actor);
  const resolution = normalizeQuoteSyncReviewResolution(input);

  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      workspaceId: actor.workspaceId,
      deal: { workspaceId: actor.workspaceId, ...activeWhere }
    },
    include: { deal: true }
  });

  if (!quote) {
    throw new ApiError("NOT_FOUND", "Quote was not found.", 404);
  }

  if (quote.status !== "ACCEPTED") {
    throw new ApiError("VALIDATION_ERROR", "Only accepted quotes can have deal value sync reviewed.", 422);
  }

  if (quote.dealValueSyncedAt || quote.dealValueSyncReviewedAt) {
    return { deal: quote.deal, quote, reviewed: false, synced: Boolean(quote.dealValueSyncedAt) };
  }

  if (resolution === "KEEP_CURRENT_DEAL") {
    const updatedQuote = await prisma.$transaction(async (tx) => {
      const updatedQuote = await tx.quote.update({
        where: { id: quote.id },
        data: {
          dealValueSyncReviewedAt: new Date(),
          dealValueSyncResolution: resolution
        }
      });

      await writeAuditLogWithClient(tx, actor, "quote.deal_value_sync_reviewed", "Quote", quote.id, {
        quoteId: quote.id,
        quoteNumber: quote.number,
        dealId: quote.dealId,
        resolution,
        changedDealValue: false,
        currentDealValueCents: quote.deal.valueCents,
        currentDealCurrency: quote.deal.currency,
        acceptedQuoteTotalCents: quote.totalCents,
        acceptedQuoteCurrency: quote.currency,
        reason: quote.dealValueSyncConflict
      });

      return updatedQuote;
    });

    return { deal: quote.deal, quote: updatedQuote, reviewed: true, synced: false };
  }

  if (input.confirmation !== quoteSyncUpdateConfirmation) {
    throw new ApiError("VALIDATION_ERROR", "Confirm before updating the deal value from this accepted quote.", 422);
  }

  if (quote.deal.status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }

  const { deal, updatedQuote } = await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.update({
      where: { id: quote.dealId },
      data: {
        valueCents: quote.totalCents,
        currency: quote.currency
      }
    });
    const updatedQuote = await tx.quote.update({
      where: { id: quote.id },
      data: {
        dealValueSyncedAt: new Date(),
        dealValueSyncReviewedAt: new Date(),
        dealValueSyncResolution: resolution
      }
    });

    await writeAuditLogWithClient(tx, actor, "deal.value_synced_from_quote", "Deal", deal.id, {
      quoteId: quote.id,
      quoteNumber: quote.number,
      previousValueCents: quote.deal.valueCents,
      previousCurrency: quote.deal.currency,
      nextValueCents: deal.valueCents,
      nextCurrency: deal.currency,
      mode: "reviewed-conflict-resolution"
    });
    await writeAuditLogWithClient(tx, actor, "quote.deal_value_sync_reviewed", "Quote", quote.id, {
      quoteId: quote.id,
      quoteNumber: quote.number,
      dealId: quote.dealId,
      resolution,
      changedDealValue: true,
      previousDealValueCents: quote.deal.valueCents,
      previousDealCurrency: quote.deal.currency,
      acceptedQuoteTotalCents: quote.totalCents,
      acceptedQuoteCurrency: quote.currency,
      reason: quote.dealValueSyncConflict
    });

    return { deal, updatedQuote };
  });

  return { deal, quote: updatedQuote, reviewed: true, synced: true };
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

async function applyAcceptedQuoteDealValueSync(
  client: Pick<Prisma.TransactionClient, "deal" | "quote" | "auditLog">,
  workspaceId: string,
  quote: {
    id: string;
    dealId: string;
    number: string;
    totalCents: number;
    currency: string;
    sentDealValueCents: number | null;
    sentDealCurrency: string | null;
    dealValueSyncedAt: Date | null;
    deal: { id: string; valueCents: number | null; currency: string };
  },
  actor: WorkspaceActor | null
) {
  if (quote.dealValueSyncedAt) return { synced: false, conflict: false };

  const alreadySynced = quote.deal.valueCents === quote.totalCents && quote.deal.currency === quote.currency;
  if (alreadySynced) {
    await client.quote.update({
      where: { id: quote.id },
      data: {
        dealValueSyncedAt: new Date(),
        dealValueSyncReviewedAt: new Date(),
        dealValueSyncResolution: "UPDATE_DEAL_TO_QUOTE",
        dealValueSyncConflict: null
      }
    });
    return { synced: false, conflict: false };
  }

  if (quote.sentDealCurrency === null) {
    await client.quote.update({
      where: { id: quote.id },
      data: { dealValueSyncConflict: legacySyncConflictReason }
    });
    await writeQuoteSyncConflictAuditLog(client, workspaceId, actor, quote, legacySyncConflictReason);
    return { synced: false, conflict: true };
  }

  const dealChangedSinceSent =
    quote.deal.valueCents !== quote.sentDealValueCents || quote.deal.currency !== quote.sentDealCurrency;

  if (dealChangedSinceSent) {
    await client.quote.update({
      where: { id: quote.id },
      data: { dealValueSyncConflict: changedDealSyncConflictReason }
    });
    await writeQuoteSyncConflictAuditLog(client, workspaceId, actor, quote, changedDealSyncConflictReason);
    return { synced: false, conflict: true };
  }

  const deal = await client.deal.update({
    where: { id: quote.dealId },
    data: {
      valueCents: quote.totalCents,
      currency: quote.currency
    }
  });
  await client.quote.update({
    where: { id: quote.id },
    data: {
      dealValueSyncedAt: new Date(),
      dealValueSyncReviewedAt: new Date(),
      dealValueSyncResolution: "UPDATE_DEAL_TO_QUOTE",
      dealValueSyncConflict: null
    }
  });
  await writeAuditLogWithClient(client, actor ?? { workspaceId, actorUserId: "" }, "deal.value_synced_from_quote", "Deal", deal.id, {
    quoteId: quote.id,
    quoteNumber: quote.number,
    previousValueCents: quote.deal.valueCents,
    previousCurrency: quote.deal.currency,
    nextValueCents: deal.valueCents,
    nextCurrency: deal.currency,
    mode: actor ? "internal-acceptance-auto-sync" : "public-acceptance-auto-sync"
  });
  return { synced: true, conflict: false };
}

async function writeQuoteSyncConflictAuditLog(
  client: Pick<Prisma.TransactionClient, "auditLog">,
  workspaceId: string,
  actor: WorkspaceActor | null,
  quote: {
    id: string;
    dealId: string;
    number: string;
    totalCents: number;
    currency: string;
    deal: { valueCents: number | null; currency: string };
  },
  reason: string
) {
  await writeAuditLogWithClient(client, actor ?? { workspaceId, actorUserId: "" }, "quote.deal_value_sync_conflict", "Quote", quote.id, {
    quoteId: quote.id,
    quoteNumber: quote.number,
    dealId: quote.dealId,
    reason,
    quoteTotalCents: quote.totalCents,
    quoteCurrency: quote.currency,
    currentDealValueCents: quote.deal.valueCents,
    currentDealCurrency: quote.deal.currency
  });
}

async function writeAuditLogWithClient(
  client: Pick<Prisma.TransactionClient, "auditLog">,
  actor: WorkspaceActor,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: unknown
) {
  await client.auditLog.create({
    data: {
      workspaceId: actor.workspaceId,
      actorId: actor.actorUserId || null,
      action,
      entityType,
      entityId,
      metadata: serializeAuditMetadata(metadata)
    }
  });
}

function serializeAuditMetadata(metadata: unknown): Prisma.InputJsonValue | undefined {
  if (metadata === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;
  } catch {
    return { serializationError: "Audit metadata could not be serialized." };
  }
}

async function writePublicQuoteAuditLogWithClient(
  client: Pick<Prisma.TransactionClient, "auditLog">,
  workspaceId: string,
  action: string,
  entityId: string,
  metadata: unknown
) {
  await client.auditLog.create({
    data: {
      workspaceId,
      action,
      entityType: "Quote",
      entityId,
      metadata: serializeAuditMetadata(metadata)
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
