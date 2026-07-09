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

export type EmailLocalClassificationInput = {
  body?: string | null;
  deal?: unknown | null;
  dealId?: string | null;
  direction?: string | null;
  fromText?: string | null;
  lead?: unknown | null;
  leadId?: string | null;
  organization?: unknown | null;
  organizationId?: string | null;
  person?: unknown | null;
  personId?: string | null;
  providerLabels?: Prisma.JsonValue | null;
  providerSnippet?: string | null;
  subject?: string | null;
  toText?: string | null;
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

export function buildLocalEmailSmartClassification(
  email: EmailLocalClassificationInput,
  options: { now?: Date } = {}
): EmailSmartClassification {
  const labels = buildLocalEmailLabelSuggestions(email);
  const text = localEmailSearchText(email);
  const lower = text.toLowerCase();
  const linkedToCrm = emailLinkedToCrm(email);
  const automated = localEmailIsAutomated(email, lower);
  const personal = !linkedToCrm && hasAny(lower, ["family", "personal", "birthday", "dinner", "weekend", "vacation"]);
  const signals: EmailSmartSignal[] = [];

  if (hasAny(lower, ["urgent", "asap", "today", "deadline", "blocked", "escalat"])) signals.push("URGENT");
  if (String(email.direction ?? "").toUpperCase() === "INBOUND" && (localEmailHasQuestion(text) || hasAny(lower, ["can you", "could you", "please", "let me know", "thoughts?", "available?"]))) {
    signals.push("NEEDS_REPLY");
  }
  if (hasAny(lower, ["waiting on customer", "waiting for customer", "pending customer", "customer owes"])) signals.push("WAITING_ON_CUSTOMER");
  if (hasAny(lower, ["pricing", "price", "quote", "proposal"])) signals.push("PRICING_QUOTE");
  if (hasAny(lower, ["contract", "msa", "sow", "legal", "terms"])) signals.push("CONTRACT_LEGAL");
  if (hasAny(lower, ["objection", "concern", "issue", "blocked", "unhappy", "delay"])) signals.push("OBJECTION_CONCERN");
  if (hasAny(lower, ["interested", "buying", "demo", "trial", "move forward", "approved"])) signals.push("POSITIVE_BUYING_SIGNAL");
  if (hasAny(lower, ["risk", "churn", "cancel", "unhappy", "escalat"])) signals.push("RELATIONSHIP_RISK");
  if (hasAny(lower, ["follow up", "follow-up", "next step", "circle back", "check in"])) signals.push("FOLLOW_UP_NEEDED");
  if (!linkedToCrm && hasAny(lower, ["demo", "pricing", "interested", "trial", "intro", "proposal"])) signals.push("POTENTIAL_LEAD");

  const category: EmailSmartCategory = personal
    ? "PERSONAL"
    : automated
      ? "NOT_CRM_RELEVANT"
      : linkedToCrm
        ? "CUSTOMER"
        : signals.includes("POTENTIAL_LEAD") || signals.includes("POSITIVE_BUYING_SIGNAL") || signals.includes("PRICING_QUOTE")
          ? "PROSPECT"
          : "UNKNOWN";
  const uniqueSignals = Array.from(new Set(signals)).slice(0, 6);
  const evidence = localEvidence(email, labels, uniqueSignals);
  const categoryEvidence = localCategoryEvidence(category, email, linkedToCrm, automated, personal);
  const signalEvidence = uniqueSignals.map((signal) => localSignalEvidence(signal, email, lower));

  return {
    category,
    ...(categoryEvidence ? { categoryEvidence } : {}),
    cautions: [
      ...defaultCautions,
      "AI refinement was unavailable or not requested; these labels were generated with deterministic local rules."
    ],
    confidence: localConfidence(category, uniqueSignals, linkedToCrm),
    evidence,
    generatedAt: options.now ?? new Date(),
    providerId: "local_rules",
    providerName: "Local rules",
    signalEvidence,
    signals: uniqueSignals,
    summary: localClassificationSummary(labels, category, uniqueSignals)
  };
}

export function buildLocalEmailLabelSuggestions(email: EmailLocalClassificationInput) {
  const text = localEmailSearchText(email);
  const lower = text.toLowerCase();
  const linkedToCrm = emailLinkedToCrm(email);
  const automated = localEmailIsAutomated(email, lower);
  const personal = !linkedToCrm && hasAny(lower, ["family", "personal", "birthday", "dinner", "weekend", "vacation"]);
  const labels = new Set<string>();

  if (String(email.direction ?? "").toUpperCase() === "INBOUND" && (localEmailHasQuestion(text) || hasAny(lower, ["can you", "could you", "please", "let me know", "thoughts?", "available?"]))) labels.add("Needs reply");
  if (hasAny(lower, ["follow up", "follow-up", "next step", "circle back", "check in"])) labels.add("Follow-up");
  if (hasAny(lower, ["pricing", "price", "quote", "proposal"])) labels.add("Pricing / quote");
  if (hasAny(lower, ["contract", "msa", "sow", "legal", "terms"])) labels.add("Contract / legal");
  if (hasAny(lower, ["meeting", "calendar", "demo", "call", "zoom", "agenda"])) labels.add("Meeting / scheduling");
  if (hasAny(lower, ["risk", "concern", "blocked", "unhappy", "delay", "issue", "cancel", "churn", "escalat"])) labels.add("Relationship risk");
  if (hasAny(lower, ["demo", "trial", "interested", "buying", "proposal", "intro"])) labels.add(linkedToCrm ? "Opportunity" : "Lead");
  if (linkedToCrm) labels.add("CRM linked");
  if (!linkedToCrm) labels.add("No CRM link");
  if (linkedToCrm) labels.add("Customer");
  if (!linkedToCrm && labels.has("Lead")) labels.add("Prospect");
  if (automated) {
    labels.add("Newsletter / promotion");
    labels.add("Automated / no-reply");
    labels.add("Unimportant");
  }
  if (personal) labels.add("Personal / Low Priority");
  if (!automated && !personal && (linkedToCrm || labels.size > 1)) labels.add("Work");

  return [...labels].slice(0, 8);
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
  const generatedAt = options.now ?? new Date();

  if (!readiness.configured && !options.provider) {
    const localClassification = buildLocalEmailSmartClassification(emailLocalClassificationInputFromContext(context), { now: generatedAt });
    await saveEmailSmartClassification(emailLogId, localClassification, generatedAt, "local_rules");
    return localClassification;
  }

  const provider = options.provider ?? createOpenAIEmailClassificationProvider(options.env, options.fetchImpl);
  if (!provider) {
    const localClassification = buildLocalEmailSmartClassification(emailLocalClassificationInputFromContext(context), { now: generatedAt });
    await saveEmailSmartClassification(emailLogId, localClassification, generatedAt, "local_rules");
    return localClassification;
  }

  const prompt = buildEmailClassificationPrompt({ context });
  let generated: EmailSmartClassification;
  try {
    generated = normalizeProviderOutput(await provider.classify({ context, prompt }));
  } catch {
    const localClassification = buildLocalEmailSmartClassification(emailLocalClassificationInputFromContext(context), { now: generatedAt });
    await saveEmailSmartClassification(emailLogId, localClassification, generatedAt, "local_rules");
    return localClassification;
  }
  const classification = {
    ...generated,
    generatedAt,
    providerId: provider.id,
    providerName: provider.name
  };

  await saveEmailSmartClassification(emailLogId, classification, generatedAt, provider.id);

  return classification;
}

function saveEmailSmartClassification(
  emailLogId: string,
  classification: EmailSmartClassification,
  generatedAt: Date,
  providerId: string
) {
  return prisma.emailLog.update({
    where: { id: emailLogId },
    data: {
      smartLabelGeneratedAt: generatedAt,
      smartLabelJson: classificationToJson(classification),
      smartLabelProvider: providerId
    }
  });
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
    providerName:
      emailLog.smartLabelProvider === "openai"
        ? "OpenAI"
        : emailLog.smartLabelProvider === "local_rules"
          ? "Local rules"
          : undefined
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

function emailLocalClassificationInputFromContext(context: EmailReplyContext): EmailLocalClassificationInput {
  return {
    body: context.email.body,
    deal: context.deal,
    direction: context.email.direction,
    fromText: context.email.fromText,
    lead: context.lead,
    organization: context.organization,
    person: context.contact,
    providerSnippet: null,
    subject: context.email.subject,
    toText: context.email.toText
  };
}

function localEmailSearchText(email: EmailLocalClassificationInput) {
  return [email.subject, email.fromText, email.toText, email.providerSnippet, email.body].filter(Boolean).join(" ");
}

function emailLinkedToCrm(email: EmailLocalClassificationInput) {
  return Boolean(
    email.personId ||
      email.organizationId ||
      email.dealId ||
      email.leadId ||
      email.person ||
      email.organization ||
      email.deal ||
      email.lead
  );
}

function localEmailIsAutomated(email: EmailLocalClassificationInput, lower: string) {
  const labels = Array.isArray(email.providerLabels) ? email.providerLabels.filter((item): item is string => typeof item === "string") : [];
  return (
    hasAny(lower, [
      "unsubscribe",
      "newsletter",
      "view in browser",
      "marketing",
      "promotion",
      "webinar",
      "digest",
      "no-reply",
      "noreply",
      "notification"
    ]) || labels.some((label) => ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"].includes(label))
  );
}

function localEmailHasQuestion(value: string) {
  return /\?|\b(can|could|would|will|are|is|do|does|did|when|what|where|who|how)\b[^.!?]{0,120}\?/i.test(value);
}

function localEvidence(email: EmailLocalClassificationInput, labels: string[], signals: EmailSmartSignal[]) {
  const source = compactLine(email.body || email.providerSnippet || email.subject || "Stored email metadata was available.");
  const evidence = [
    labels.length ? `Local labels: ${labels.join(", ")}.` : "",
    signals.length ? `Local signals: ${signals.map(emailSmartSignalLabel).join(", ")}.` : "",
    source ? `Source text reviewed: ${truncate(source, maxStructuredEvidenceExcerptChars)}` : ""
  ];
  return dedupeStrings(evidence).slice(0, 4);
}

function localCategoryEvidence(
  category: EmailSmartCategory,
  email: EmailLocalClassificationInput,
  linkedToCrm: boolean,
  automated: boolean,
  personal: boolean
): EmailSmartCategoryEvidence | undefined {
  if (category === "UNKNOWN") return undefined;
  const reason = automated
    ? "Local rules detected newsletter, notification, or promotional patterns."
    : personal
      ? "Local rules found personal or low-work signals without CRM linkage."
      : linkedToCrm
        ? "The email is linked to an existing CRM record."
        : "Local rules found prospect or opportunity language.";
  const excerpt = compactLine(email.body || email.providerSnippet || email.subject || "");
  return {
    category,
    confidence: localConfidence(category, [], linkedToCrm),
    excerpts: excerpt ? [truncate(excerpt, maxStructuredEvidenceExcerptChars)] : [],
    reason
  };
}

function localSignalEvidence(signal: EmailSmartSignal, email: EmailLocalClassificationInput, lower: string): EmailSmartSignalEvidence {
  const source = compactLine(email.body || email.providerSnippet || email.subject || "");
  return {
    signal,
    excerpts: source ? [truncate(source, maxStructuredEvidenceExcerptChars)] : [],
    reason: localSignalReason(signal),
    severity: signal === "URGENT" || signal === "RELATIONSHIP_RISK" ? "high" : signal === "NEEDS_REPLY" ? "medium" : "low",
    confidence: hasAny(lower, localSignalNeedles(signal)) ? 0.7 : 0.55
  };
}

function localSignalReason(signal: EmailSmartSignal) {
  if (signal === "URGENT") return "Local rules found urgency or deadline language.";
  if (signal === "NEEDS_REPLY") return "Local rules found an inbound question or action request.";
  if (signal === "WAITING_ON_CUSTOMER") return "Local rules found waiting-on-customer language.";
  if (signal === "PRICING_QUOTE") return "Local rules found pricing, quote, or proposal language.";
  if (signal === "CONTRACT_LEGAL") return "Local rules found contract, legal, MSA, SOW, or terms language.";
  if (signal === "OBJECTION_CONCERN") return "Local rules found concern, objection, delay, or issue language.";
  if (signal === "POSITIVE_BUYING_SIGNAL") return "Local rules found buying, demo, approval, or move-forward language.";
  if (signal === "RELATIONSHIP_RISK") return "Local rules found risk, churn, cancellation, or escalation language.";
  if (signal === "FOLLOW_UP_NEEDED") return "Local rules found follow-up or next-step language.";
  return "Local rules found potential lead language without a CRM link.";
}

function localSignalNeedles(signal: EmailSmartSignal) {
  if (signal === "URGENT") return ["urgent", "asap", "today", "deadline", "blocked", "escalat"];
  if (signal === "NEEDS_REPLY") return ["can you", "could you", "please", "let me know", "thoughts?", "available?"];
  if (signal === "WAITING_ON_CUSTOMER") return ["waiting on customer", "waiting for customer", "pending customer", "customer owes"];
  if (signal === "PRICING_QUOTE") return ["pricing", "price", "quote", "proposal"];
  if (signal === "CONTRACT_LEGAL") return ["contract", "msa", "sow", "legal", "terms"];
  if (signal === "OBJECTION_CONCERN") return ["objection", "concern", "issue", "blocked", "unhappy", "delay"];
  if (signal === "POSITIVE_BUYING_SIGNAL") return ["interested", "buying", "demo", "trial", "move forward", "approved"];
  if (signal === "RELATIONSHIP_RISK") return ["risk", "churn", "cancel", "unhappy", "escalat"];
  if (signal === "FOLLOW_UP_NEEDED") return ["follow up", "follow-up", "next step", "circle back", "check in"];
  return ["demo", "pricing", "interested", "trial", "intro", "proposal"];
}

function localConfidence(category: EmailSmartCategory, signals: EmailSmartSignal[], linkedToCrm: boolean) {
  if (linkedToCrm && signals.length >= 2) return 0.72;
  if (signals.length >= 2) return 0.64;
  if (linkedToCrm || category !== "UNKNOWN") return 0.56;
  return 0.42;
}

function localClassificationSummary(labels: string[], category: EmailSmartCategory, signals: EmailSmartSignal[]) {
  if (labels.length > 0) return `Local rules suggest ${labels.slice(0, 5).join(", ")}.`;
  return defaultClassificationSummary(category, signals);
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
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
