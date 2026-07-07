import type { AiPreferences } from "./ai-preferences-service";

export type StoredEmailSummary = {
  confidence: "high" | "low" | "medium";
  generatedAt: string;
  reviewFirst: true;
  source: "body" | "snippet" | "unavailable";
  status: "disabled" | "ready" | "unavailable";
  summary: string;
  warnings: string[];
};

export function summarizeStoredEmailForAi(
  email: { body?: string | null; providerSnippet?: string | null; subject?: string | null },
  preferences?: Pick<AiPreferences, "emailSummaryLength">
): StoredEmailSummary {
  const length = preferences?.emailSummaryLength ?? "short";
  if (length === "none") {
    return {
      confidence: "high",
      generatedAt: new Date().toISOString(),
      reviewFirst: true,
      source: "unavailable",
      status: "disabled",
      summary: "Stored email summaries are disabled in AI preferences.",
      warnings: ["No summary was generated."]
    };
  }

  const body = cleanEmailText(email.body);
  const snippet = cleanEmailText(email.providerSnippet);
  const sourceText = body || snippet;
  if (!sourceText) {
    return {
      confidence: "low",
      generatedAt: new Date().toISOString(),
      reviewFirst: true,
      source: "unavailable",
      status: "unavailable",
      summary: "Summary unavailable because this stored email has no body or snippet available to Northstar.",
      warnings: ["Full-message sync is required before this email can be summarized."]
    };
  }

  return {
    confidence: body ? "medium" : "low",
    generatedAt: new Date().toISOString(),
    reviewFirst: true,
    source: body ? "body" : "snippet",
    status: "ready",
    summary: summarizeText(sourceText, length),
    warnings: body ? [] : ["Summary is based on stored snippet only."]
  };
}

function summarizeText(text: string, length: Exclude<AiPreferences["emailSummaryLength"], "none">) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (length === "one_sentence") return truncate(sentences[0] ?? text, 180);
  if (length === "detailed") return truncate(sentences.slice(0, 4).join(" ") || text, 720);
  return truncate(sentences.slice(0, 2).join(" ") || text, 360);
}

function cleanEmailText(value: string | null | undefined) {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
