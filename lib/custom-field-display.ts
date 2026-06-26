import type { CustomFieldType } from "@prisma/client";

export const supportedCustomFieldTypes = ["TEXT", "NUMBER", "DATE", "BOOLEAN"] as const;
export const customFieldFilterOperators = ["equals", "contains", "is_empty", "is_not_empty"] as const;

export type CustomFieldFilterOperator = (typeof customFieldFilterOperators)[number];

export function isSupportedCustomFieldType(fieldType: CustomFieldType | string) {
  return supportedCustomFieldTypes.includes(fieldType as (typeof supportedCustomFieldTypes)[number]);
}

export function normalizeCustomFieldFilterOperator(rawOperator?: string | null) {
  const operator = rawOperator?.trim();
  if (!operator) return "equals" satisfies CustomFieldFilterOperator;
  return customFieldFilterOperators.includes(operator as CustomFieldFilterOperator)
    ? (operator as CustomFieldFilterOperator)
    : undefined;
}

export function isCustomFieldFilterOperatorAllowed(fieldType: CustomFieldType, operator: CustomFieldFilterOperator) {
  if (!isSupportedCustomFieldType(fieldType)) return false;
  if (operator === "contains") return fieldType === "TEXT";
  return true;
}

export function hasCustomFieldDisplayValue(value: unknown) {
  return value !== null && value !== undefined && value !== "";
}

export function isEmptyCustomFieldValue(value: unknown) {
  if (value === null || value === undefined) return true;
  return typeof value === "string" && value.trim().length === 0;
}

export function customFieldDisplayValue(value: unknown) {
  if (!hasCustomFieldDisplayValue(value)) return "Not filled in yet";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function normalizeCustomFieldFilterValue(fieldType: CustomFieldType, rawValue: string) {
  const value = rawValue.trim();
  if (!value) return undefined;

  if (fieldType === "TEXT") return value;

  if (fieldType === "NUMBER") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : undefined;
  }

  if (fieldType === "DATE") {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  }

  if (fieldType === "BOOLEAN") {
    const normalized = value.toLowerCase();
    if (["true", "yes", "1"].includes(normalized)) return true;
    if (["false", "no", "0"].includes(normalized)) return false;
  }

  return undefined;
}
