import { ApiError } from "@/lib/api/responses";

export const savedViewNameMaxLength = 120;

export function normalizeSavedViewName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

export function validateSavedViewName(value: unknown) {
  const normalizedName = normalizeSavedViewName(value);

  if (!normalizedName) {
    throw new ApiError("VALIDATION_ERROR", "Saved view name is required.", 422);
  }

  if (normalizedName.length > savedViewNameMaxLength) {
    throw new ApiError(
      "VALIDATION_ERROR",
      `Saved view name must be ${savedViewNameMaxLength} characters or fewer.`,
      422
    );
  }

  return normalizedName;
}
