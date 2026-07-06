import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { buildEmailReplyContext, type EmailReplyContext } from "./email-reply-assistant-service";
import { ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

type EnvInput = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export const emailSmartCategories = [
  "CUSTOMER",
  "PROSPECT",
  "INTERNAL",
  "PERSONAL",
  "UNKNOWN",
  "NOT_CRM_RELEVANT"
] as const;

export const emailSmartSignals = [
  "URGENT",
  "NEEDS_REPLY",
  "WAITING_ON_CUSTOMER",
  "PRICING_QUOTE",
  "CONTRACT_LEGAL",
  "OBJECTION_CONCERN",
  "POSITIVE_BUYING_SIGNAL",
  "RELATIONSHIP_RISK",
  "FOLLOW_UP_NEEDED",
  "POTENTIAL_LEAD"
] as const;

export type EmailSmartCategory = (typeof emailSmartCategories)[number];
export type EmailSmartSignal = (typeof emailSmartSignals)[number];
export type EmailSmartEvidenceSeverity = "high" | "low" | "medium";

export type EmailSmartCategoryEvidence = {
  category: EmailSmartCategory;
  confidence?: number;
  excerpts: string[];
  reason: string;
};

export type EmailSmartSignalEvidence = {
  confidence?: number;
  excerpts: string[];
  reason: string;
  severity?: EmailSmartEvidenceSeverity;
  signal: EmailSmartSignal;
};

export type EmailSmartClassification = {
  category: EmailSmartCategory;
  categoryEvidence?: EmailSmartCategoryEvidence;
  cautions: string[];
  confidence: number;
  evidence: string[];
  generatedAt?: Date;
  providerId?: string;
  providerName?: string;
  signalEvidence: EmailSmartSignalEvidence[];
  signals: EmailSmartSignal[];
  summary: string;
};

export type EmailClassificationReadiness = {
  configured: boolean;
  message: string;
  missingEnvNames: string[];
  providerId: "openai" | "none";
  providerName: string;
};

export type EmailClassificationProviderInput = {
  context: EmailReplyContext;
  prompt: {
    system: string;
    user: string;
  };
};

export type EmailClassificationProviderOutput = {
  category?: string;
  categoryEvidence?: unknown;
  cautions?: string[];
  confidence?: number;
  evidence?: string[];
  signalEvidence?: unknown;
  signals?: string[];
  summary?: string;
};

export type EmailClassificationProvider = {
  classify(input: EmailClassificationProviderInput): Promise<EmailClassificationProviderOutput>;
  id: string;
  name: string;
};

type ClassifyEmailLogOptions = {
  env?: EnvInput;
  fetchImpl?: FetchLike;
  now?: Date;
  provider?: EmailClassificationProvider | null;
};

const defaultEmailClassificationModel = "gpt-5.5";
const maxClassificationBodyChars = 2500;
const maxContextItemChars = 420;
const maxStructuredEvidenceExcerpts = 2;
const maxStructuredEvidenceExcerptChars = 220;
const maxStructuredEvidenceReasonChars = 220;
const defaultCautions = [
  "Suggested label only. Review before acting.",
  "Northstar does not create activities, notes, leads, or profile facts from smart labels."
];

export function emailClassificationReadiness(env: EnvInput = process.env): EmailClassificationReadiness {
  if (!readNonEmpty(env.OPENAI_API_KEY)) {
    return {
      configured: false,
      message: "Smart Email Labels are not configured. Set OPENAI_API_KEY to enable review-first classification.",
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId: "none",
      providerName: "Not configured"
    };
  }

  return {
    configured: true,
    message: "Smart Email Labels are configured through OpenAI. Labels are suggestions and do not mutate CRM records.",
    missingEnvNames: [],
    providerId: "openai",
    providerName: "OpenAI"
  };
}

export async function classifyEmailLog(
  actor: WorkspaceActor,
  input: { emailLogId: unknown },
  options: ClassifyEmailLogOptions = {}
) {
  await ensureWorkspaceAccess(actor);
  const emailLogId = normalizeEmailLogId(input.emailLogId);
  const context = await buildEmailReplyContext(actor, emailLogId);
  const readiness = emailClassificationReadiness(options.env);

  if (!readiness.configured && !options.provider) {
    throw new ApiError("AI_EMAIL_CLASSIFICATION_NOT_CONFIGURED", readiness.message, 503);
  }

  const provider = options.provider ?? createOpenAIEmailClassificationProvider(options.env, options.fetchImpl);
  if (!provider) {
    throw new ApiError("AI_EMAIL_CLASSIFICATION_NOT_CONFIGURED", readiness.message, 503);
  }

  const prompt = buildEmailClassificationPrompt({ context });
  const generated = normalizeProviderOutput(await provider.classify({ context, prompt }));
  const generatedAt = options.now ?? new Date();
  const classification = {
    ...generated,
    generatedAt,
    providerId: provider.id,
    providerName: provider.name
  };

  await prisma.emailLog.update({
    where: { id: emailLogId },
    data: {
      smartLabelGeneratedAt: generatedAt,
      smartLabelJson: classificationToJson(classification),
      smartLabelProvider: provider.id
    }
  });

  return classification;
}

export function buildEmailClassificationPrompt({ context }: { context: EmailReplyContext }) {
  const system = [
    "You are Northstar CRM's Smart Email Label classifier.",
    "Classify a stored CRM email so a salesperson can prioritize relationship work.",
    "Use only the provided email and CRM context.",
    "Do not classify protected traits, sensitive personal traits, health, religion, politics, ethnicity, gender, sexuality, age, disability, or other protected characteristics.",
    "Do not create, recommend automatic creation, or imply automatic creation of activities, notes, leads, profile facts, discounts, legal commitments, or email sends.",
    `Allowed categories: ${emailSmartCategories.join(", ")}.`,
    `Allowed signals: ${emailSmartSignals.join(", ")}.`,
    "Return strict JSON with keys: category, signals, confidence, summary, evidence, categoryEvidence, signalEvidence, cautions.",
    "categoryEvidence should include reason and short supporting excerpts for the selected category.",
    "signalEvidence should be an array with one item per selected signal when evidence exists; each item should include signal, reason, excerpts, and optional confidence or severity.",
    "Use only allowed selected signal keys in signalEvidence. Keep excerpts short and do not provide exact offsets."
  ].join(" ");

  const user = [
    "Email to classify:",
    `Subject: ${context.email.subject}`,
    `Direction: ${context.email.direction}`,
    `From: ${context.email.fromText ?? "Not recorded"}`,
    `To: ${context.email.toText ?? "Not recorded"}`,
    `Occurred: ${context.email.occurredAt.toISOString()}`,
    "Body:",
    truncate(context.email.body, maxClassificationBodyChars),
    "",
    "CRM context:",
    formatClassificationContext(context)
  ].join("\n");

  return { system, user };
}

export function createOpenAIEmailClassificationProvider(
  env: EnvInput = process.env,
  fetchImpl: FetchLike = fetch
): EmailClassificationProvider | null {
  const apiKey = readNonEmpty(env.OPENAI_API_KEY);
  if (!apiKey) return null;

  return {
    id: "openai",
    name: "OpenAI",
    async classify(input) {
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: [
            { role: "system", content: input.prompt.system },
            { role: "user", content: input.prompt.user }
          ],
          max_output_tokens: 900,
          model: defaultEmailClassificationModel
        })
      });
      const body = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
      if (!response.ok) {
        throw new ApiError("AI_EMAIL_CLASSIFICATION_PROVIDER_FAILED", "Smart Email Labels provider request failed.", 502);
      }
      const outputText = readNonEmpty(body?.output_text) ?? extractResponsesOutputText(body?.output) ?? readNonEmpty(body?.text);
      if (!outputText) {
        throw new ApiError("AI_EMAIL_CLASSIFICATION_EMPTY_RESULT", "Smart Email Labels provider returned no classification.", 502);
      }
      return normalizeProviderOutput(parseProviderJson(outputText));
    }
  };
}

export function readEmailSmartClassification(emailLog: {
  smartLabelGeneratedAt?: Date | string | null;
  smartLabelJson?: Prisma.JsonValue | null;
  smartLabelProvider?: string | null;
}): EmailSmartClassification | null {
  if (!emailLog.smartLabelJson || typeof emailLog.smartLabelJson !== "object" || Array.isArray(emailLog.smartLabelJson)) return null;
  const parsed = normalizeProviderOutput(parseStoredClassification(emailLog.smartLabelJson));
  if (!parsed.summary && parsed.category === "UNKNOWN" && parsed.signals.length === 0 && parsed.evidence.length === 0) return null;

  const generatedAt = emailLog.smartLabelGeneratedAt ? new Date(emailLog.smartLabelGeneratedAt) : undefined;
  return {
    ...parsed,
    generatedAt: generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt : undefined,
    providerId: emailLog.smartLabelProvider ?? undefined,
    providerName: emailLog.smartLabelProvider === "openai" ? "OpenAI" : undefined
  };
}

export function emailSmartClassificationLabels(classification: EmailSmartClassification) {
  return [
    emailSmartCategoryLabel(classification.category),
    ...classification.signals.map(emailSmartSignalLabel)
  ];
}

export function emailSmartCategoryLabel(category: EmailSmartCategory) {
  if (category === "CUSTOMER") return "Customer";
  if (category === "PROSPECT") return "Prospect";
  if (category === "INTERNAL") return "Internal";
  if (category === "PERSONAL") return "Personal";
  if (category === "NOT_CRM_RELEVANT") return "Not CRM relevant";
  return "Unknown";
}

export function emailSmartSignalLabel(signal: EmailSmartSignal) {
  if (signal === "URGENT") return "Urgent";
  if (signal === "NEEDS_REPLY") return "Needs reply";
  if (signal === "WAITING_ON_CUSTOMER") return "Waiting on customer";
  if (signal === "PRICING_QUOTE") return "Pricing / quote";
  if (signal === "CONTRACT_LEGAL") return "Contract / legal";
  if (signal === "OBJECTION_CONCERN") return "Objection / concern";
  if (signal === "POSITIVE_BUYING_SIGNAL") return "Positive buying signal";
  if (signal === "RELATIONSHIP_RISK") return "Relationship risk";
  if (signal === "FOLLOW_UP_NEEDED") return "Follow-up needed";
  return "Potential lead";
}

export function emailSmartSignalPriorityRank(classification: EmailSmartClassification | null) {
  if (!classification) return 0;
  const signals = new Set(classification.signals);
  if (signals.has("URGENT") || signals.has("RELATIONSHIP_RISK")) return 4;
  if (signals.has("NEEDS_REPLY") || signals.has("OBJECTION_CONCERN")) return 3;
  if (signals.has("PRICING_QUOTE") || signals.has("CONTRACT_LEGAL")) return 2;
  if (signals.has("FOLLOW_UP_NEEDED") || signals.has("POSITIVE_BUYING_SIGNAL") || signals.has("POTENTIAL_LEAD")) return 1;
  return 0;
}

function normalizeProviderOutput(output: EmailClassificationProviderOutput): EmailSmartClassification {
  const category = normalizeCategory(output.category);
  const signals = uniqueAllowedSignals(output.signals);
  const evidence = dedupeStrings(readStringArray(output.evidence))
    .map((item) => truncate(item, maxStructuredEvidenceExcerptChars))
    .slice(0, 4);
  const categoryEvidence = normalizeCategoryEvidence(output.categoryEvidence, category);
  const signalEvidence = normalizeSignalEvidence(output.signalEvidence, signals);
  const cautions = dedupeStrings([...defaultCautions, ...readStringArray(output.cautions)]).slice(0, 5);
  const summary = readNonEmpty(output.summary) ?? defaultClassificationSummary(category, signals);

  return {
    category,
    ...(categoryEvidence ? { categoryEvidence } : {}),
    cautions,
    confidence: normalizeConfidence(output.confidence),
    evidence,
    signalEvidence,
    signals,
    summary: truncate(compactLine(summary), 240)
  };
}

function parseProviderJson(value: string): EmailClassificationProviderOutput {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      category: readNonEmpty(parsed.category),
      categoryEvidence: parsed.categoryEvidence,
      cautions: readStringArray(parsed.cautions),
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined,
      evidence: readStringArray(parsed.evidence),
      signalEvidence: parsed.signalEvidence,
      signals: readStringArray(parsed.signals),
      summary: readNonEmpty(parsed.summary)
    };
  } catch {
    return {
      category: "UNKNOWN",
      cautions: ["Provider returned plain text instead of JSON."],
      confidence: 0.2,
      evidence: [],
      signals: [],
      summary: value
    };
  }
}

function parseStoredClassification(value: Prisma.JsonValue | null | undefined): EmailClassificationProviderOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    category: readNonEmpty(record.category),
    categoryEvidence: record.categoryEvidence,
    cautions: readStringArray(record.cautions),
    confidence: typeof record.confidence === "number" ? record.confidence : undefined,
    evidence: readStringArray(record.evidence),
    signalEvidence: record.signalEvidence,
    signals: readStringArray(record.signals),
    summary: readNonEmpty(record.summary)
  };
}

function classificationToJson(classification: EmailSmartClassification): Prisma.InputJsonObject {
  return {
    category: classification.category,
    ...(classification.categoryEvidence ? { categoryEvidence: classification.categoryEvidence } : {}),
    cautions: classification.cautions,
    confidence: classification.confidence,
    evidence: classification.evidence,
    signalEvidence: classification.signalEvidence,
    signals: classification.signals,
    summary: classification.summary
  };
}

function formatClassificationContext(context: EmailReplyContext) {
  const sections = [
    ["Contact", context.contact ? [context.contact] : []],
    ["Organization", context.organization ? [context.organization] : []],
    ["Deal", context.deal ? [context.deal] : []],
    ["Lead", context.lead ? [context.lead] : []],
    ["Recent notes", context.notes],
    ["Recent activities and follow-ups", context.activities],
    ["Quotes, products, and contracts", [...context.productsAndQuotes, ...context.contractSteps]],
    ["Meeting Intelligence", context.meetingSummaries],
    ["Approved relationship profile facts", context.relationshipProfileFacts]
  ];

  return sections
    .map(([title, values]) => {
      const items = values as string[];
      return items.length ? `${title}:\n${items.map((item) => `- ${truncate(item, maxContextItemChars)}`).join("\n")}` : `${title}: none available`;
    })
    .join("\n\n");
}

function normalizeEmailLogId(value: unknown) {
  const normalized = readNonEmpty(value);
  if (!normalized) {
    throw new ApiError("VALIDATION_ERROR", "Email log id is required.", 422);
  }
  return normalized;
}

function normalizeCategory(value: unknown): EmailSmartCategory {
  return emailSmartCategories.includes(value as EmailSmartCategory) ? (value as EmailSmartCategory) : "UNKNOWN";
}

function uniqueAllowedSignals(values: unknown) {
  return Array.from(
    new Set(
      readStringArray(values)
        .filter((value): value is EmailSmartSignal => emailSmartSignals.includes(value as EmailSmartSignal))
        .slice(0, 6)
    )
  );
}

function normalizeCategoryEvidence(value: unknown, category: EmailSmartCategory): EmailSmartCategoryEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const evidenceCategory = normalizeCategory(readNonEmpty(record.category) ?? category);
  if (evidenceCategory !== category) return undefined;
  const reason = truncate(compactLine(readNonEmpty(record.reason) ?? ""), maxStructuredEvidenceReasonChars);
  const excerpts = normalizeEvidenceExcerpts(record.excerpts ?? record.evidence);
  const confidence = normalizeOptionalConfidence(record.confidence);
  if (!reason && excerpts.length === 0 && confidence === undefined) return undefined;
  return {
    category,
    ...(confidence === undefined ? {} : { confidence }),
    excerpts,
    reason: reason || `Saved evidence for ${emailSmartCategoryLabel(category)} category.`
  };
}

function normalizeSignalEvidence(value: unknown, selectedSignals: EmailSmartSignal[]): EmailSmartSignalEvidence[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set(selectedSignals);
  const bySignal = new Map<EmailSmartSignal, EmailSmartSignalEvidence>();

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const signal = readNonEmpty(record.signal);
    if (!signal || !emailSmartSignals.includes(signal as EmailSmartSignal) || !selected.has(signal as EmailSmartSignal)) continue;
    const normalizedSignal = signal as EmailSmartSignal;
    const reason = truncate(compactLine(readNonEmpty(record.reason) ?? ""), maxStructuredEvidenceReasonChars);
    const excerpts = normalizeEvidenceExcerpts(record.excerpts ?? record.evidence);
    const confidence = normalizeOptionalConfidence(record.confidence);
    const severity = normalizeEvidenceSeverity(record.severity);
    if (!reason && excerpts.length === 0 && confidence === undefined && !severity) continue;

    const existing = bySignal.get(normalizedSignal);
    bySignal.set(normalizedSignal, {
      signal: normalizedSignal,
      ...(confidence === undefined ? {} : { confidence }),
      excerpts: existing ? dedupeStrings([...existing.excerpts, ...excerpts]).slice(0, maxStructuredEvidenceExcerpts) : excerpts,
      reason: reason || existing?.reason || `Saved evidence for ${emailSmartSignalLabel(normalizedSignal)} signal.`,
      ...(severity ? { severity } : existing?.severity ? { severity: existing.severity } : {})
    });
  }

  return selectedSignals.flatMap((signal) => {
    const evidence = bySignal.get(signal);
    return evidence ? [evidence] : [];
  });
}

function normalizeEvidenceExcerpts(value: unknown) {
  return dedupeStrings(readStringArray(value))
    .map((item) => truncate(compactLine(item), maxStructuredEvidenceExcerptChars))
    .filter(Boolean)
    .slice(0, maxStructuredEvidenceExcerpts);
}

function normalizeOptionalConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return normalizeConfidence(value);
}

function normalizeEvidenceSeverity(value: unknown): EmailSmartEvidenceSeverity | undefined {
  const normalized = readNonEmpty(value)?.toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return undefined;
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function defaultClassificationSummary(category: EmailSmartCategory, signals: EmailSmartSignal[]) {
  const labels = [emailSmartCategoryLabel(category), ...signals.map(emailSmartSignalLabel)];
  return labels.length ? labels.join(" · ") : "No strong smart label signal.";
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = readNonEmpty(item);
    return text ? [text] : [];
  });
}

function dedupeStrings(values: string[]) {
  return Array.from(new Set(values.map(compactLine).filter(Boolean)));
}

function compactLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const compacted = value.trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

type OpenAIResponseBody = {
  output?: unknown;
  output_text?: unknown;
  text?: unknown;
};

function extractResponsesOutputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  const text = output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((contentItem) => {
        if (!contentItem || typeof contentItem !== "object") return [];
        const value = contentItem as { text?: unknown; type?: unknown };
        if (value.type === "output_text" || value.type === "text") {
          const itemText = readNonEmpty(value.text);
          return itemText ? [itemText] : [];
        }
        return [];
      });
    })
    .join("\n")
    .trim();

  return text || undefined;
}
