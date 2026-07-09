import { ApiError } from "@/lib/api/responses";

import type {
  MatchConfidence,
  MatchedCrmObject,
  MeetingSourceMetadata,
  ProposedRelationshipBriefFact,
  ProposedRelationshipBriefUpdate,
  RelationshipBriefFields,
  RelationshipBriefSensitivityCategory,
  RelationshipBriefSensitivityGuidance,
  UnmatchedEntity
} from "./types";

type EnvInput = Record<string, string | undefined>;
type FetchLike = typeof fetch;

export type SemanticRelationshipContact = {
  confidence: MatchConfidence;
  evidenceExcerpt: string;
  id: string;
  label: string;
  matchedReason: string;
};

export type SemanticRelationshipBriefProviderInput = {
  contacts: SemanticRelationshipContact[];
  contextText?: string | null;
  markdown: string;
  matchedObjects: MatchedCrmObject[];
  sourceMetadata?: MeetingSourceMetadata;
  unmatchedEntities: UnmatchedEntity[];
};

export type SemanticRelationshipBriefProviderOutput = {
  proposals: ProposedRelationshipBriefUpdate[];
  warnings: string[];
};

export type SemanticRelationshipBriefProvider = {
  extract(input: SemanticRelationshipBriefProviderInput): Promise<SemanticRelationshipBriefProviderOutput>;
  id: string;
  name: string;
};

export type RelationshipSemanticExtractionReadiness = {
  configured: boolean;
  message: string;
  missingEnvNames: string[];
  providerId: "none" | "openai";
  providerName: string;
};

type OpenAIResponseBody = {
  output?: unknown;
  output_text?: unknown;
  text?: unknown;
};

const providerId = "openai";
const providerName = "OpenAI relationship extraction";
const defaultRelationshipModel = "gpt-5.5";
const maxRelationshipMarkdownChars = 40_000;
const protectedTraitPattern =
  /\b(race|ethnicity|religion|religious|church|mosque|synagogue|political|politics|party affiliation|disability|disabled|medical diagnosis|pregnant|pregnancy|sexual orientation|gender identity)\b/i;
const sensitivityCategories = new Set<RelationshipBriefSensitivityCategory>([
  "do_not_mention_directly",
  "internal_only",
  "safe_personalization",
  "use_cautiously"
]);
const relationshipBriefFieldKeys = [
  "relationshipPersonalContext",
  "relationshipCommunicationStyle",
  "relationshipBusinessConcerns",
  "relationshipFollowUpReminders",
  "relationshipInternalGuidance"
] as const satisfies Array<keyof RelationshipBriefFields>;

export function relationshipSemanticExtractionReadiness(
  env: EnvInput = process.env
): RelationshipSemanticExtractionReadiness {
  const configuredProvider = readNonEmpty(env.MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER);
  if (!configuredProvider) {
    return {
      configured: false,
      message:
        "Semantic Relationship Brief extraction is not configured. Meeting Intelligence will use deterministic relationship proposals.",
      missingEnvNames: ["MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER"],
      providerId: "none",
      providerName: "Not configured"
    };
  }
  if (configuredProvider !== providerId) {
    return {
      configured: false,
      message: `Semantic Relationship Brief provider "${configuredProvider}" is not supported.`,
      missingEnvNames: [],
      providerId: "none",
      providerName: "Unsupported provider"
    };
  }
  if (!readNonEmpty(env.OPENAI_API_KEY)) {
    return {
      configured: false,
      message:
        "Semantic Relationship Brief extraction is set to OpenAI, but OPENAI_API_KEY is missing. Meeting Intelligence will use deterministic relationship proposals.",
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId,
      providerName
    };
  }
  return {
    configured: true,
    message:
      "Semantic Relationship Brief extraction is configured through OpenAI. Suggestions remain review-first and deterministic proposals stay as fallback.",
    missingEnvNames: [],
    providerId,
    providerName
  };
}

export function createOpenAISemanticRelationshipBriefProvider(
  env: EnvInput = process.env,
  fetchImpl: FetchLike = fetch
): SemanticRelationshipBriefProvider | null {
  const readiness = relationshipSemanticExtractionReadiness(env);
  const apiKey = readNonEmpty(env.OPENAI_API_KEY);
  if (!readiness.configured || !apiKey) return null;

  return {
    id: providerId,
    name: providerName,
    async extract(input) {
      const prompt = buildSemanticRelationshipBriefPrompt(input);
      const response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user }
          ],
          max_output_tokens: 1800,
          model: readNonEmpty(env.MEETING_INTELLIGENCE_OPENAI_RELATIONSHIP_MODEL) ?? defaultRelationshipModel
        })
      });
      const body = (await response.json().catch(() => null)) as OpenAIResponseBody | null;
      if (!response.ok) {
        throw new ApiError(
          "MEETING_RELATIONSHIP_PROVIDER_FAILED",
          "Semantic Relationship Brief provider request failed.",
          502
        );
      }
      const outputText = readNonEmpty(body?.output_text) ?? extractResponsesOutputText(body?.output) ?? readNonEmpty(body?.text);
      if (!outputText) {
        throw new ApiError(
          "MEETING_RELATIONSHIP_PROVIDER_EMPTY_RESULT",
          "Semantic Relationship Brief provider returned no proposals.",
          502
        );
      }
      return parseSemanticRelationshipProviderJson(outputText, input);
    }
  };
}

export function buildSemanticRelationshipBriefPrompt(input: SemanticRelationshipBriefProviderInput) {
  const system = [
    "You are Northstar CRM's semantic Relationship Brief extractor.",
    "Extract only relationship-profile facts explicitly supported by the provided meeting context.",
    "Target only the listed contact ids. Do not invent contacts, facts, or protected traits.",
    "Do not return company facts, deal facts, stakeholder-role notes, or follow-up actions as Relationship Brief facts.",
    "If a fact is about an organization, opportunity, budget, SOW, legal/procurement, implementation plan, or action item, omit it unless it is clearly phrased as that contact's own concern or communication preference.",
    "Do not infer religion, politics, health, disability, race, ethnicity, pregnancy, sexual orientation, gender identity, or other protected traits.",
    "Prefer concise durable profile facts over raw transcript snippets.",
    "Relationship Brief is curated memory, not raw history. Everything you return will still be reviewed by a human before saving.",
    "Return strict JSON with key proposals. Each proposal should include targetPersonId, proposed, confidence, evidence, matchedReason, sensitivity, and warnings.",
    "Sensitivity categories are safe_personalization, internal_only, use_cautiously, and do_not_mention_directly."
  ].join(" ");

  const user = [
    "Matched contacts allowed for relationship updates:",
    JSON.stringify(
      input.contacts.map((contact) => ({
        confidence: contact.confidence,
        evidenceExcerpt: contact.evidenceExcerpt,
        label: contact.label,
        matchedReason: contact.matchedReason,
        targetPersonId: contact.id
      })),
      null,
      2
    ),
    "",
    "Return JSON shape:",
    JSON.stringify(
      {
        proposals: [
          {
            confidence: "high|medium|low",
            evidence: ["short exact evidence excerpt from the meeting text"],
            matchedReason: "why this contact/fact was selected",
            proposed: {
              relationshipBusinessConcerns: "optional",
              relationshipCommunicationStyle: "optional",
              relationshipFollowUpReminders: "optional",
              relationshipInternalGuidance: "optional",
              relationshipPersonalContext: "optional"
            },
            facts: [
              {
                field: "relationshipPersonalContext",
                text: "one distinct optional fact",
                sensitivity: [
                  {
                    category: "safe_personalization",
                    guidance: "how to use this fact safely"
                  }
                ]
              }
            ],
            sensitivity: [
              {
                category: "safe_personalization|internal_only|use_cautiously|do_not_mention_directly",
                field: "optional proposed field key",
                guidance: "how the user should apply this fact safely",
                reason: "optional"
              }
            ],
            targetPersonId: "contact id from the allowed list",
            warnings: ["optional caution"]
          }
        ]
      },
      null,
      2
    ),
    "",
    "User context:",
    input.contextText ?? "None",
    "",
    "Meeting markdown:",
    truncate(input.markdown, maxRelationshipMarkdownChars)
  ].join("\n");

  return { system, user };
}

export function parseSemanticRelationshipProviderJson(
  value: string,
  input: SemanticRelationshipBriefProviderInput
): SemanticRelationshipBriefProviderOutput {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return normalizeSemanticRelationshipProviderOutput(parsed, input);
  } catch {
    throw new ApiError(
      "MEETING_RELATIONSHIP_PROVIDER_INVALID_RESULT",
      "Semantic Relationship Brief provider returned invalid JSON.",
      502
    );
  }
}

function normalizeSemanticRelationshipProviderOutput(
  value: Record<string, unknown>,
  input: SemanticRelationshipBriefProviderInput
): SemanticRelationshipBriefProviderOutput {
  const contactsById = new Map(input.contacts.map((contact) => [contact.id, contact]));
  const warnings = readStringArray(value.warnings) ?? [];
  const proposals = Array.isArray(value.proposals) ? value.proposals : [];
  const normalizedProposals: ProposedRelationshipBriefUpdate[] = [];

  for (const item of proposals) {
    if (!item || typeof item !== "object") continue;
    const proposalInput = item as Record<string, unknown>;
    const contactId = readNonEmpty(proposalInput.targetPersonId) ?? readNonEmpty(proposalInput.personId);
    const contact = contactId ? contactsById.get(contactId) : undefined;
    if (!contact) {
      warnings.push("Semantic relationship proposal targeted an unavailable contact and was ignored.");
      continue;
    }
    const fieldWarnings: string[] = [];
    const providerFacts = normalizeSemanticFacts(proposalInput.facts, fieldWarnings);
    const proposed = compactRelationshipFields({
      ...relationshipFieldsFromFacts(providerFacts),
      ...normalizeRelationshipBriefFields(proposalInput.proposed, fieldWarnings)
    });
    if (Object.keys(proposed).length === 0) {
      warnings.push(`Semantic relationship proposal for ${contact.label} had no supported fields and was ignored.`);
      continue;
    }
    const sensitivity = normalizeSensitivityGuidance(proposalInput.sensitivity);
    const facts = providerFacts.length > 0 ? providerFacts : relationshipFactsFromFields(proposed, {
      evidence: readStringArray(proposalInput.evidence) ?? [],
      id: `relationship-brief-semantic-${contact.id}`,
      sensitivity,
      warnings: readStringArray(proposalInput.warnings) ?? []
    });
    const proposalWarnings = [...fieldWarnings, ...(readStringArray(proposalInput.warnings) ?? [])].slice(0, 8);
    warnings.push(...fieldWarnings);
    normalizedProposals.push({
      confidence: normalizeConfidence(proposalInput.confidence) ?? contact.confidence,
      evidence: uniqueStrings([...(readStringArray(proposalInput.evidence) ?? []), contact.evidenceExcerpt]).slice(0, 5),
      existing: {},
      facts,
      id: `relationship-brief-semantic-${contact.id}`,
      include: true,
      matchedReason: readNonEmpty(proposalInput.matchedReason) ?? contact.matchedReason,
      proposed,
      providerId,
      providerName,
      sensitivity,
      target: { id: contact.id, label: contact.label, type: "person" },
      warnings: proposalWarnings.length > 0 ? proposalWarnings : undefined
    });
  }

  return { proposals: normalizedProposals, warnings: uniqueStrings(warnings).slice(0, 10) };
}

function normalizeSemanticFacts(value: unknown, warnings: string[]): ProposedRelationshipBriefFact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Record<string, unknown>;
    const text = readNonEmpty(input.text);
    const field = normalizeRelationshipBriefFieldKey(input.field);
    if (!text || !field) return [];
    if (protectedTraitPattern.test(text)) {
      warnings.push("Protected or sensitive trait detail was excluded from a semantic Relationship Brief fact.");
      return [];
    }
    return [{
      category: "personFact",
      evidence: readStringArray(input.evidence),
      field,
      id: readNonEmpty(input.id) ?? `semantic-relationship-fact-${field}-${index + 1}`,
      include: input.include !== false,
      sensitivity: normalizeSensitivityGuidance(input.sensitivity),
      text: truncate(text, 2000),
      warnings: readStringArray(input.warnings)
    }];
  });
}

function relationshipFieldsFromFacts(facts: ProposedRelationshipBriefFact[]): RelationshipBriefFields {
  const fields: RelationshipBriefFields = {};
  for (const key of relationshipBriefFieldKeys) {
    const selected = facts.filter((fact) => fact.include && fact.field === key).map((fact) => fact.text);
    if (selected.length > 0) fields[key] = uniqueStrings(selected).join("\n");
  }
  return fields;
}

function relationshipFactsFromFields(
  fields: RelationshipBriefFields,
  proposal: Pick<ProposedRelationshipBriefUpdate, "evidence" | "id" | "sensitivity" | "warnings">
): ProposedRelationshipBriefFact[] {
  return relationshipBriefFieldKeys.flatMap((field) =>
    splitRelationshipFacts(fields[field]).map((text, index) => ({
      category: "personFact" as const,
      evidence: proposal.evidence,
      field,
      id: `${proposal.id}-${field}-${index + 1}`,
      include: true,
      sensitivity: proposal.sensitivity?.filter((item) => !item.field || item.field === field),
      text,
      warnings: proposal.warnings
    }))
  );
}

function splitRelationshipFacts(value: string | undefined) {
  if (!value) return [];
  return value.split(/\n{1,}/).map((item) => item.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function normalizeRelationshipBriefFields(value: unknown, warnings: string[]): RelationshipBriefFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const fields: RelationshipBriefFields = {};
  for (const key of relationshipBriefFieldKeys) {
    const text = readNonEmpty(input[key]);
    if (!text) continue;
    if (protectedTraitPattern.test(text)) {
      warnings.push("Protected or sensitive trait detail was excluded from a semantic Relationship Brief proposal.");
      continue;
    }
    fields[key] = truncate(text, 2000);
  }
  return fields;
}

function compactRelationshipFields(fields: RelationshipBriefFields): RelationshipBriefFields {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, value?.trim()])
      .filter((entry): entry is [keyof RelationshipBriefFields, string] => Boolean(entry[1]))
  ) as RelationshipBriefFields;
}

function normalizeSensitivityGuidance(value: unknown): RelationshipBriefSensitivityGuidance[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const guidance = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Record<string, unknown>;
    const category = normalizeSensitivityCategory(input.category);
    const text = readNonEmpty(input.guidance);
    if (!category || !text) return [];
    const field = normalizeRelationshipBriefFieldKey(input.field);
    return [{
      category,
      field,
      guidance: truncate(text, 500),
      reason: readNonEmpty(input.reason)
    }];
  });
  return guidance.length > 0 ? guidance.slice(0, 8) : undefined;
}

function normalizeRelationshipBriefFieldKey(value: unknown): keyof RelationshipBriefFields | undefined {
  const field = readNonEmpty(value);
  return relationshipBriefFieldKeys.find((key) => key === field);
}

function normalizeSensitivityCategory(value: unknown): RelationshipBriefSensitivityCategory | undefined {
  const category = readNonEmpty(value);
  if (!category) return undefined;
  return sensitivityCategories.has(category as RelationshipBriefSensitivityCategory)
    ? category as RelationshipBriefSensitivityCategory
    : undefined;
}

function normalizeConfidence(value: unknown): MatchConfidence | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => readNonEmpty(item)).filter((item): item is string => Boolean(item)).slice(0, 10);
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = readNonEmpty(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
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
          const entry = readNonEmpty(value.text);
          return entry ? [entry] : [];
        }
        return [];
      });
    })
    .join("\n")
    .trim();
  return text || undefined;
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength).trim() : value;
}
