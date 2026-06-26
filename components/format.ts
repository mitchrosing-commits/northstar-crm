export function formatMoney(valueCents?: number | null, currency = "USD") {
  if (valueCents == null) return "Unpriced";
  const hasCents = Math.abs(valueCents) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0
  }).format(valueCents / 100);
}

export type QuoteAdjustmentDisplayType = "NONE" | "PERCENT" | "FIXED";

export function formatQuoteAdjustment(
  type: QuoteAdjustmentDisplayType,
  value: number,
  cents: number,
  currency = "USD"
) {
  if (type === "NONE" || cents === 0) return formatMoney(0, currency);
  if (type === "PERCENT") return `${formatBasisPoints(value)} (${formatMoney(cents, currency)})`;
  return formatMoney(cents, currency);
}

export function formatDate(value?: Date | string | null) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export function formatActivityType(type: string) {
  if (type === "CALL") return "Call";
  if (type === "EMAIL") return "Email";
  if (type === "MEETING") return "Meeting";
  if (type === "TASK") return "Task";
  return type;
}

function formatBasisPoints(value: number) {
  const percent = value / 100;
  return `${percent % 1 === 0 ? percent : percent.toFixed(2)}%`;
}
