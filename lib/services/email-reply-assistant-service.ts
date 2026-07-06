import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { relationshipBriefPromptFact } from "@/lib/relationship-brief-usage";
import { personRelationshipProfile } from "./contact-service";
import { emailLogAttachmentRelationsWhere } from "./record-guards";
import { ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

type EnvInput = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export type EmailReplyTone = "concise" | "warm" | "professional" | "follow_up" | "pricing_quote";

export type EmailReplyAssistantReadiness = {
  configured: boolean;
  message: string;
  missingEnvNames: string[];
  providerId: "openai" | "none";
  providerName: string;
};

export type EmailReplyContext = {
  activities: string[];
  contact?: string;
  contractSteps: string[];
  deal?: string;
  email: {
    body: string;
    direction: "INBOUND" | "OUTBOUND";
    fromText: string | null;
    occurredAt: Date;
    provider: string | null;
    subject: string;
    toText: string | null;
  };
  lead?: string;
  meetingSummaries: string[];
  notes: string[];
  organization?: string;
  productsAndQuotes: string[];
  relationshipProfileFacts: string[];
};

export type EmailReplyProviderInput = {
  context: EmailReplyContext;
  prompt: {
    system: string;
    user: string;
  };
  tone: EmailReplyTone;
};

export type EmailReplyProviderOutput = {
  body: string;
  contextUsed?: string[];
  subjectSuggestion?: string;
  suggestedNextAction?: string;
  warnings?: string[];
};

export type EmailReplyProvider = {
  generate(input: EmailReplyProviderInput): Promise<EmailReplyProviderOutput>;
  id: string;
  name: string;
};

type GenerateEmailReplyDraftOptions = {
  env?: EnvInput;
  fetchImpl?: FetchLike;
  provider?: EmailReplyProvider | null;
};

const defaultEmailReplyModel = "gpt-5.5";
const maxEmailBodyChars = 3000;
const maxContextItemChars = 500;
const defaultWarnings = [
  "Review and edit before using. Northstar never sends AI-generated replies automatically.",
  "Do not add pricing, discounts, legal terms, dates, or promises unless you verify them first."
];

export function emailReplyAssistantReadiness(env: EnvInput = process.env): EmailReplyAssistantReadiness {
  if (!readNonEmpty(env.OPENAI_API_KEY)) {
    return {
      configured: false,
      message: "AI reply drafting is not configured. Set OPENAI_API_KEY to enable review-first draft generation.",
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId: "none",
      providerName: "Not configured"
    };
  }

  return {
    configured: true,
    message: "AI reply drafting is configured through OpenAI. Drafts are review-first and are never sent automatically.",
    missingEnvNames: [],
    providerId: "openai",
    providerName: "OpenAI"
  };
}

export async function generateEmailReplyDraft(
  actor: WorkspaceActor,
  input: { emailLogId: unknown; tone?: unknown },
  options: GenerateEmailReplyDraftOptions = {}
) {
  const tone = normalizeEmailReplyTone(input.tone);
  const context = await buildEmailReplyContext(actor, input.emailLogId);
  const readiness = emailReplyAssistantReadiness(options.env);

  if (!readiness.configured && !options.provider) {
    throw new ApiError("AI_EMAIL_REPLY_NOT_CONFIGURED", readiness.message, 503);
  }

  const provider = options.provider ?? createOpenAIEmailReplyProvider(options.env, options.fetchImpl);
  if (!provider) {
    throw new ApiError("AI_EMAIL_REPLY_NOT_CONFIGURED", readiness.message, 503);
  }

  const prompt = buildEmailReplyPrompt({ context, tone });
  const generated = normalizeProviderOutput(await provider.generate({ context, prompt, tone }));

  return {
    body: generated.body,
    contextUsed: generated.contextUsed.length > 0 ? generated.contextUsed : summarizeContextUsed(context),
    providerId: provider.id,
    providerName: provider.name,
    subjectSuggestion: generated.subjectSuggestion || defaultReplySubject(context.email.subject),
    suggestedNextAction: generated.suggestedNextAction,
    tone,
    warnings: dedupeWarnings([...defaultWarnings, ...generated.warnings])
  };
}

export async function buildEmailReplyContext(actor: WorkspaceActor, emailLogId: unknown): Promise<EmailReplyContext> {
  await ensureWorkspaceAccess(actor);
  const normalizedEmailLogId = normalizeEmailLogId(emailLogId);
  const emailLog = await prisma.emailLog.findFirst({
    where: {
      id: normalizedEmailLogId,
      workspaceId: actor.workspaceId,
      ...emailLogAttachmentRelationsWhere(actor.workspaceId)
    },
    include: {
      deal: {
        include: {
          contractSteps: { orderBy: { updatedAt: "desc" }, take: 5 },
          lineItems: { orderBy: { updatedAt: "desc" }, take: 5 },
          organization: true,
          person: true,
          pipeline: true,
          quotes: {
            include: { items: true },
            orderBy: { updatedAt: "desc" },
            take: 3
          },
          stage: true
        }
      },
      lead: { include: { organization: true, person: true } },
      organization: true,
      person: { include: { organization: true } }
    }
  });

  if (!emailLog) {
    throw new ApiError("NOT_FOUND", "Email log was not found.", 404);
  }

  const linkedIds = {
    dealId: emailLog.dealId,
    leadId: emailLog.leadId,
    organizationId: emailLog.organizationId ?? emailLog.deal?.organizationId ?? emailLog.lead?.organizationId ?? emailLog.person?.organizationId,
    personId: emailLog.personId ?? emailLog.deal?.personId ?? emailLog.lead?.personId
  };
  const relatedWhere = relatedRecordWhere(linkedIds);
  const [notes, activities, meetingAssociations] = relatedWhere.length
    ? await Promise.all([
        prisma.note.findMany({
          where: { workspaceId: actor.workspaceId, deletedAt: null, OR: relatedWhere },
          orderBy: { createdAt: "desc" },
          select: { body: true, createdAt: true },
          take: 5
        }),
        prisma.activity.findMany({
          where: { workspaceId: actor.workspaceId, deletedAt: null, OR: relatedWhere },
          orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
          select: { completedAt: true, description: true, dueAt: true, title: true, type: true },
          take: 5
        }),
        prisma.meetingActivityAssociation.findMany({
          where: {
            workspaceId: actor.workspaceId,
            OR: relatedWhere,
            meetingIntake: {
              status: { in: ["READY_FOR_REVIEW", "APPLIED"] }
            }
          },
          include: {
            meetingIntake: {
              select: {
                analysisJson: true,
                contextText: true,
                markdownText: true,
                proposedChangesJson: true
              }
            }
          },
          orderBy: { createdAt: "desc" },
          take: 3
        })
      ])
    : [[], [], []];

  return {
    activities: activities.map((activity) =>
      compactLine(
        `${activity.completedAt ? "Completed" : "Open"} ${activity.type.toLowerCase()}: ${activity.title}` +
          `${activity.dueAt ? `, due ${activity.dueAt.toISOString().slice(0, 10)}` : ""}` +
          `${activity.description ? ` - ${activity.description}` : ""}`
      )
    ),
    contact: summarizePerson(emailLog.person ?? emailLog.deal?.person ?? emailLog.lead?.person ?? null),
    contractSteps: (emailLog.deal?.contractSteps ?? []).map((step) =>
      compactLine(
        `${step.type}: ${step.status}` +
          `${step.dueAt ? `, due ${step.dueAt.toISOString().slice(0, 10)}` : ""}` +
          `${step.notes ? ` - ${step.notes}` : ""}`
      )
    ),
    deal: emailLog.deal
      ? compactLine(
          `${emailLog.deal.title} (${emailLog.deal.status}, ${emailLog.deal.stage.name} stage, ${emailLog.deal.pipeline.name} pipeline)` +
            `${emailLog.deal.valueCents !== null ? `, value ${formatMoney(emailLog.deal.valueCents, emailLog.deal.currency)}` : ""}`
        )
      : undefined,
    email: {
      body: truncate(emailLog.body, maxEmailBodyChars),
      direction: emailLog.direction,
      fromText: emailLog.fromText,
      occurredAt: emailLog.occurredAt,
      provider: emailLog.provider,
      subject: emailLog.subject,
      toText: emailLog.toText
    },
    lead: emailLog.lead ? compactLine(`${emailLog.lead.title} (${emailLog.lead.status})${emailLog.lead.source ? `, source ${emailLog.lead.source}` : ""}`) : undefined,
    meetingSummaries: meetingAssociations.flatMap((association) =>
      association.meetingIntake ? summarizeMeetingIntake(association.meetingIntake) : []
    ),
    notes: notes.map((note) => compactLine(`${note.createdAt.toISOString().slice(0, 10)}: ${note.body}`)),
    organization: summarizeOrganization(emailLog.organization ?? emailLog.deal?.organization ?? emailLog.lead?.organization ?? emailLog.person?.organization ?? null),
    productsAndQuotes: [
      ...(emailLog.deal?.lineItems ?? []).map((item) =>
        compactLine(`${item.productName}: quantity ${item.quantity}, line total ${formatMoney(item.lineTotalCents, item.currency)}`)
      ),
      ...(emailLog.deal?.quotes ?? []).map((quote) =>
        compactLine(
          `Quote ${quote.number}: ${quote.status}, total ${formatMoney(quote.totalCents, quote.currency)}, ${quote.items.length} item${quote.items.length === 1 ? "" : "s"}`
        )
      )
    ],
    relationshipProfileFacts: await getRelationshipProfileFacts(actor, linkedIds)
  };
}

export function buildEmailReplyPrompt({ context, tone }: { context: EmailReplyContext; tone: EmailReplyTone }) {
  const system = [
    "You are Northstar CRM's AI Email Reply Assistant.",
    "Draft a thoughtful customer reply for a salesperson to review and edit.",
    "Never claim the email was sent. Never instruct the system to send. Never auto-send.",
    "Use only the provided email and CRM context. Do not invent pricing, discounts, legal commitments, contract terms, dates, delivery promises, or approvals.",
    "Relationship Brief facts include field-level usage guidance. Do not quote fields marked internal-only or do-not-mention-directly.",
    "If context is missing, write cautiously and ask the user to fill the missing details.",
    "For pricing or quote questions, reference only provided quote/product facts and recommend confirming details before committing.",
    "Return strict JSON with keys: subjectSuggestion, body, contextUsed, warnings, suggestedNextAction."
  ].join(" ");

  const user = [
    `Tone option: ${toneLabel(tone)}.`,
    "",
    "Email to reply to:",
    `Subject: ${context.email.subject}`,
    `Direction: ${context.email.direction}`,
    `From: ${context.email.fromText ?? "Not recorded"}`,
    `To: ${context.email.toText ?? "Not recorded"}`,
    `Occurred: ${context.email.occurredAt.toISOString()}`,
    "Body:",
    context.email.body,
    "",
    "CRM context:",
    formatContextForPrompt(context)
  ].join("\n");

  return { system, user };
}

export function createOpenAIEmailReplyProvider(env: EnvInput = process.env, fetchImpl: FetchLike = fetch): EmailReplyProvider | null {
  const apiKey = readNonEmpty(env.OPENAI_API_KEY);
  if (!apiKey) return null;

  return {
    id: "openai",
    name: "OpenAI",
    async generate(input) {
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
          max_output_tokens: 1200,
          model: defaultEmailReplyModel
        })
      });
      const body = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
      if (!response.ok) {
        throw new ApiError("AI_EMAIL_REPLY_PROVIDER_FAILED", "AI email reply provider request failed.", 502);
      }
      const outputText = readNonEmpty(body?.output_text) ?? extractResponsesOutputText(body?.output) ?? readNonEmpty(body?.text);
      if (!outputText) {
        throw new ApiError("AI_EMAIL_REPLY_EMPTY_RESULT", "AI email reply provider returned no draft.", 502);
      }
      return parseProviderJson(outputText);
    }
  };
}

type OpenAIResponseBody = {
  output?: unknown;
  output_text?: unknown;
  text?: unknown;
};

function parseProviderJson(value: string): EmailReplyProviderOutput {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      body: readNonEmpty(parsed.body) ?? "",
      contextUsed: readStringArray(parsed.contextUsed),
      subjectSuggestion: readNonEmpty(parsed.subjectSuggestion),
      suggestedNextAction: readNonEmpty(parsed.suggestedNextAction),
      warnings: readStringArray(parsed.warnings)
    };
  } catch {
    return { body: value };
  }
}

function normalizeProviderOutput(output: EmailReplyProviderOutput) {
  const body = readNonEmpty(output.body);
  if (!body) {
    throw new ApiError("AI_EMAIL_REPLY_EMPTY_RESULT", "AI email reply provider returned no draft.", 502);
  }

  return {
    body,
    contextUsed: output.contextUsed?.map(compactLine).filter(Boolean) ?? [],
    subjectSuggestion: readNonEmpty(output.subjectSuggestion),
    suggestedNextAction: readNonEmpty(output.suggestedNextAction),
    warnings: output.warnings?.map(compactLine).filter(Boolean) ?? []
  };
}

function formatContextForPrompt(context: EmailReplyContext) {
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

function summarizeContextUsed(context: EmailReplyContext) {
  return [
    "Email subject and body",
    context.contact ? "Contact" : null,
    context.organization ? "Organization" : null,
    context.deal ? "Deal stage/status" : null,
    context.lead ? "Lead status" : null,
    context.notes.length ? "Recent notes" : null,
    context.activities.length ? "Recent activities/follow-ups" : null,
    context.productsAndQuotes.length || context.contractSteps.length ? "Quotes/contracts/products" : null,
    context.meetingSummaries.length ? "Meeting Intelligence summaries" : null,
    context.relationshipProfileFacts.length ? "Approved relationship profile facts" : null
  ].filter((value): value is string => Boolean(value));
}

function summarizePerson(person: { email: string | null; firstName: string; lastName: string | null } | null) {
  if (!person) return undefined;
  return compactLine(`${formatPersonName(person) ?? "Unnamed contact"}${person.email ? ` <${person.email}>` : ""}`);
}

function summarizeOrganization(organization: { domain: string | null; name: string } | null) {
  if (!organization) return undefined;
  return compactLine(`${organization.name}${organization.domain ? ` (${organization.domain})` : ""}`);
}

function summarizeMeetingIntake(intake: {
  analysisJson: unknown;
  contextText: string | null;
  markdownText: string | null;
  proposedChangesJson: unknown;
}) {
  const values = [
    summarizeJsonArray(intake.analysisJson, "decisions", "Decision"),
    summarizeJsonArray(intake.analysisJson, "risks", "Risk"),
    summarizeJsonArray(intake.analysisJson, "openQuestions", "Open question"),
    summarizeJsonNotes(intake.proposedChangesJson),
    intake.contextText ? `Meeting context: ${intake.contextText}` : null,
    intake.markdownText ? `Meeting notes: ${intake.markdownText}` : null
  ].flat().filter((value): value is string => Boolean(value));

  return values.slice(0, 4).map(compactLine);
}

function summarizeJsonArray(value: unknown, key: string, label: string) {
  if (!value || typeof value !== "object") return [];
  const items = (value as Record<string, unknown>)[key];
  if (!Array.isArray(items)) return [];
  return items.slice(0, 3).flatMap((item) => (typeof item === "string" ? [`${label}: ${item}`] : []));
}

function summarizeJsonNotes(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const notes = (value as Record<string, unknown>).proposedNotes;
  if (!Array.isArray(notes)) return [];
  return notes.slice(0, 2).flatMap((note) => {
    if (!note || typeof note !== "object") return [];
    const body = readNonEmpty((note as Record<string, unknown>).body);
    return body ? [`Meeting note: ${body}`] : [];
  });
}

async function getRelationshipProfileFacts(actor: WorkspaceActor, linkedIds: Record<string, string | null | undefined>) {
  if (!linkedIds.personId) return [];
  const person = await prisma.person.findFirst({
    where: { id: linkedIds.personId, workspaceId: actor.workspaceId, deletedAt: null },
    select: {
      relationshipBusinessConcerns: true,
      relationshipCommunicationStyle: true,
      relationshipFollowUpReminders: true,
      relationshipInternalGuidance: true,
      relationshipPersonalContext: true
    }
  });
  if (!person) return [];

  const profile = personRelationshipProfile(person);
  return [
    relationshipBriefPromptFact("relationshipPersonalContext", profile.personalContext),
    relationshipBriefPromptFact("relationshipCommunicationStyle", profile.communicationStyle),
    relationshipBriefPromptFact("relationshipBusinessConcerns", profile.businessConcerns),
    relationshipBriefPromptFact("relationshipFollowUpReminders", profile.followUpReminders),
    relationshipBriefPromptFact("relationshipInternalGuidance", profile.internalGuidance)
  ].filter((value): value is string => Boolean(value));
}

function relatedRecordWhere({
  dealId,
  leadId,
  organizationId,
  personId
}: {
  dealId?: string | null;
  leadId?: string | null;
  organizationId?: string | null;
  personId?: string | null;
}) {
  return [
    dealId ? { dealId } : null,
    leadId ? { leadId } : null,
    personId ? { personId } : null,
    organizationId ? { organizationId } : null
  ].filter((item): item is { dealId: string } | { leadId: string } | { personId: string } | { organizationId: string } =>
    Boolean(item)
  );
}

function normalizeEmailLogId(value: unknown) {
  const normalized = readNonEmpty(value);
  if (!normalized) {
    throw new ApiError("VALIDATION_ERROR", "Email log id is required.", 422);
  }
  return normalized;
}

function normalizeEmailReplyTone(value: unknown): EmailReplyTone {
  if (value === "warm" || value === "professional" || value === "follow_up" || value === "pricing_quote") return value;
  return "concise";
}

function toneLabel(tone: EmailReplyTone) {
  if (tone === "warm") return "warm";
  if (tone === "professional") return "professional";
  if (tone === "follow_up") return "follow up";
  if (tone === "pricing_quote") return "answer pricing or quote questions carefully";
  return "concise";
}

function defaultReplySubject(subject: string) {
  return subject.trim().toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const text = readNonEmpty(item);
    return text ? [text] : [];
  });
}

function dedupeWarnings(warnings: string[]) {
  return Array.from(new Set(warnings.map(compactLine).filter(Boolean)));
}

function compactLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number) {
  const compacted = value.trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    currency,
    style: "currency"
  }).format(cents / 100);
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

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
