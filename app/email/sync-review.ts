import type { EmailSyncPreview } from "@/lib/services/email-connection-service";

export const emailSyncReviewCookieName = "northstar-email-sync-review";

export type EmailSyncReview = {
  created: number;
  duplicates: number;
  provider: "Gmail" | "Microsoft";
  skipped: number;
  totalFetched: number;
  unmatchedPreviews: EmailSyncPreview[];
};

export function encodeEmailSyncReview(review: EmailSyncReview) {
  return Buffer.from(JSON.stringify(review), "utf8").toString("base64url");
}

export function decodeEmailSyncReview(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return isEmailSyncReview(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isEmailSyncReview(value: unknown): value is EmailSyncReview {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeInteger(value.created) &&
    isNonNegativeInteger(value.duplicates) &&
    (value.provider === "Gmail" || value.provider === "Microsoft") &&
    isNonNegativeInteger(value.skipped) &&
    isNonNegativeInteger(value.totalFetched) &&
    Array.isArray(value.unmatchedPreviews) &&
    value.unmatchedPreviews.every(isEmailSyncPreview)
  );
}

function isEmailSyncPreview(value: unknown): value is EmailSyncPreview {
  if (!isRecord(value)) return false;
  return (
    (value.direction === "INBOUND" || value.direction === "OUTBOUND") &&
    isNullableString(value.email) &&
    isNullableString(value.fromText) &&
    typeof value.occurredAt === "string" &&
    (value.provider === "GOOGLE_WORKSPACE" || value.provider === "MICROSOFT_365") &&
    typeof value.providerMessageId === "string" &&
    isNullableString(value.snippet) &&
    typeof value.subject === "string" &&
    isNullableString(value.toText)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}
