"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { goalTargetCentsMax } from "@/lib/product-limits";
import { redactSensitiveText } from "@/lib/security/redaction";
import { createOrUpdateMonthlyWonRevenueGoal } from "@/lib/services/crm";

export async function saveMonthlyWonRevenueGoalAction(formData: FormData) {
  const month = String(formData.get("goalMonth") ?? "");
  const currency = String(formData.get("goalCurrency") ?? "");
  const targetAmount = String(formData.get("goalTargetAmount") ?? "");
  const params = new URLSearchParams({
    goalMonth: month,
    goalCurrency: currency.trim().toUpperCase()
  });

  try {
    const { actor } = await getCurrentWorkspaceContext();
    await createOrUpdateMonthlyWonRevenueGoal(actor, {
      month,
      currency,
      targetCents: parseMoneyToCents(targetAmount)
    });

    revalidatePath("/reports");
    params.set("goalSaved", "1");
  } catch (error) {
    params.set("goalError", error instanceof ApiError ? redactSensitiveText(error.message) : "Goal target could not be saved.");
  }

  redirect(`/reports?${params.toString()}`);
}

function parseMoneyToCents(value: string) {
  const normalized = value.trim().replace(/[$,]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new ApiError("VALIDATION_ERROR", "Goal target must be a positive currency amount.", 422);
  }

  const [dollars, cents = ""] = normalized.split(".");
  const amountCents = Number.parseInt(dollars, 10) * 100 + Number.parseInt(cents.padEnd(2, "0"), 10);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new ApiError("VALIDATION_ERROR", "Goal target must be a positive currency amount.", 422);
  }
  if (!Number.isSafeInteger(amountCents) || amountCents > goalTargetCentsMax) {
    throw new ApiError("VALIDATION_ERROR", "Goal target is too large.", 422);
  }
  return amountCents;
}
