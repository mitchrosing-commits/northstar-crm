import { DealStatus, GoalType, Prisma, type Goal } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { goalTargetCentsMax } from "@/lib/product-limits";
import { canManageWorkspaceSettings } from "@/lib/workspace-roles";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

const wonRevenueGoalType: GoalType = "WON_REVENUE";

export type GoalMonthInput = Date | string;

export type MonthlyWonRevenueGoalInput = {
  month: GoalMonthInput;
  currency: string;
  targetCents: number;
};

export type MonthlyWonRevenueGoalProgress = {
  goal: Goal | null;
  type: GoalType;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  targetCents: number | null;
  wonRevenueCents: number;
  remainingCents: number | null;
  progressPercent: number | null;
  includedDealCount: number;
};

export async function createOrUpdateMonthlyWonRevenueGoal(
  actor: WorkspaceActor,
  input: MonthlyWonRevenueGoalInput
) {
  const membership = await ensureWorkspaceAccess(actor);
  if (!canManageWorkspaceSettings(membership.role)) {
    throw new ApiError("FORBIDDEN", "Only workspace admins and owners can manage workspace goals.", 403);
  }
  const { periodStart, periodEnd } = monthBounds(input.month);
  const currency = normalizeGoalCurrency(input.currency);
  const targetCents = normalizeGoalTargetCents(input.targetCents);
  const uniqueWhere = {
    workspaceId_type_currency_periodStart: {
      workspaceId: actor.workspaceId,
      type: wonRevenueGoalType,
      currency,
      periodStart
    }
  };
  const existing = await prisma.goal.findUnique({ where: uniqueWhere });

  if (existing) return updateMonthlyGoalIfChanged(existing, { periodEnd, targetCents });

  try {
    return await prisma.goal.create({
      data: {
        workspaceId: actor.workspaceId,
        type: wonRevenueGoalType,
        periodEnd,
        currency,
        periodStart,
        targetCents
      }
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const concurrentGoal = await prisma.goal.findUniqueOrThrow({ where: uniqueWhere });
    return updateMonthlyGoalIfChanged(concurrentGoal, { periodEnd, targetCents });
  }
}

async function updateMonthlyGoalIfChanged(existing: Goal, input: { periodEnd: Date; targetCents: number }) {
  if (existing.periodEnd.getTime() === input.periodEnd.getTime() && existing.targetCents === input.targetCents) {
    return existing;
  }

  return prisma.goal.update({
    where: { id: existing.id },
    data: input
  });
}

export async function getMonthlyWonRevenueGoalProgress(
  actor: WorkspaceActor,
  input: { month: GoalMonthInput; currency: string }
): Promise<MonthlyWonRevenueGoalProgress> {
  await ensureWorkspaceAccess(actor);
  const { periodStart, periodEnd } = monthBounds(input.month);
  const currency = normalizeGoalCurrency(input.currency);

  const [goal, wonDeals] = await Promise.all([
    prisma.goal.findUnique({
      where: {
        workspaceId_type_currency_periodStart: {
          workspaceId: actor.workspaceId,
          type: wonRevenueGoalType,
          currency,
          periodStart
        }
      }
    }),
    prisma.deal.aggregate({
      where: {
        workspaceId: actor.workspaceId,
        ...activeWhere,
        status: DealStatus.WON,
        currency,
        wonAt: {
          gte: periodStart,
          lt: periodEnd
        }
      },
      _count: { _all: true },
      _sum: { valueCents: true }
    })
  ]);

  const wonRevenueCents = wonDeals._sum.valueCents ?? 0;
  const targetCents = goal?.targetCents ?? null;

  return {
    goal,
    type: wonRevenueGoalType,
    currency,
    periodStart,
    periodEnd,
    targetCents,
    wonRevenueCents,
    remainingCents: targetCents == null ? null : Math.max(targetCents - wonRevenueCents, 0),
    progressPercent: targetCents == null ? null : roundPercent((wonRevenueCents / targetCents) * 100),
    includedDealCount: wonDeals._count._all
  };
}

export function monthBounds(input: GoalMonthInput) {
  const monthDate = parseGoalMonth(input);
  const periodStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { periodStart, periodEnd };
}

export function normalizeGoalCurrency(value: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Goal currency must be a three-letter ISO code.", 422);
  }
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ApiError("VALIDATION_ERROR", "Goal currency must be a three-letter ISO code.", 422);
  }
  return currency;
}

export function normalizeGoalTargetCents(value: number) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ApiError("VALIDATION_ERROR", "Goal target must be a positive amount in cents.", 422);
  }
  if (!Number.isSafeInteger(value) || value > goalTargetCentsMax) {
    throw new ApiError("VALIDATION_ERROR", "Goal target is too large.", 422);
  }
  return value;
}

function parseGoalMonth(input: GoalMonthInput) {
  if (input instanceof Date) {
    assertValidDate(input);
    return input;
  }

  if (typeof input !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Goal month must be a valid date or YYYY-MM value.", 422);
  }

  const trimmed = input.trim();
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (monthMatch) {
    const year = Number.parseInt(monthMatch[1], 10);
    const month = Number.parseInt(monthMatch[2], 10);
    if (month < 1 || month > 12) {
      throw new ApiError("VALIDATION_ERROR", "Goal month must use YYYY-MM with a valid month.", 422);
    }
    return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  }

  const parsed = new Date(trimmed);
  assertValidDate(parsed);
  return parsed;
}

function assertValidDate(value: Date) {
  if (Number.isNaN(value.getTime())) {
    throw new ApiError("VALIDATION_ERROR", "Goal month must be a valid date or YYYY-MM value.", 422);
  }
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
