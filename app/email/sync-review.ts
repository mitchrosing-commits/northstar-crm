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
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EmailSyncReview;
    if (!Number.isFinite(parsed.totalFetched) || !Array.isArray(parsed.unmatchedPreviews)) return null;
    return parsed;
  } catch {
    return null;
  }
}
