import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { redactSensitiveText } from "@/lib/security/redaction";

import { ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

export type EmailSummaryLength = "detailed" | "none" | "one_sentence" | "short";
export type RecordSummaryStyle = "balanced" | "concise" | "detailed";
export type AiReplyTone = "concise" | "follow_up" | "pricing_quote" | "professional" | "warm";
export type AssistantDetailLevel = "balanced" | "detailed" | "minimal";
export type DiagnosticsDetailLevel = "simple" | "technical";
export type RelationshipMemoryUsage = "balanced" | "conservative" | "proactive";
export type MeetingIntelligenceNoteStyle = "concise" | "detailed" | "structured";
export type AiSuggestionAggressiveness = "high" | "low" | "medium";

export type AiPreferences = {
  assistantDetailLevel: AssistantDetailLevel;
  diagnosticsDetailLevel: DiagnosticsDetailLevel;
  emailSummaryLength: EmailSummaryLength;
  meetingIntelligenceNoteStyle: MeetingIntelligenceNoteStyle;
  naturalLanguageInstructions: string | null;
  recordSummaryStyle: RecordSummaryStyle;
  relationshipMemoryUsage: RelationshipMemoryUsage;
  replyTone: AiReplyTone;
  suggestionAggressiveness: AiSuggestionAggressiveness;
};

export type AiPreferenceDraft = {
  proposedChanges: Partial<AiPreferences>;
  reviewFirst: true;
  summary: string;
};

export const aiPreferenceOptions = {
  assistantDetailLevel: ["minimal", "balanced", "detailed"] as const,
  diagnosticsDetailLevel: ["simple", "technical"] as const,
  emailSummaryLength: ["none", "one_sentence", "short", "detailed"] as const,
  meetingIntelligenceNoteStyle: ["concise", "structured", "detailed"] as const,
  recordSummaryStyle: ["concise", "balanced", "detailed"] as const,
  relationshipMemoryUsage: ["conservative", "balanced", "proactive"] as const,
  replyTone: ["concise", "warm", "professional", "follow_up", "pricing_quote"] as const,
  suggestionAggressiveness: ["low", "medium", "high"] as const
};

export const defaultAiPreferences: AiPreferences = {
  assistantDetailLevel: "balanced",
  diagnosticsDetailLevel: "simple",
  emailSummaryLength: "short",
  meetingIntelligenceNoteStyle: "structured",
  naturalLanguageInstructions: null,
  recordSummaryStyle: "balanced",
  relationshipMemoryUsage: "conservative",
  replyTone: "warm",
  suggestionAggressiveness: "medium"
};

const aiPreferenceSelect = {
  assistantDetailLevel: true,
  diagnosticsDetailLevel: true,
  emailSummaryLength: true,
  meetingIntelligenceNoteStyle: true,
  naturalLanguageInstructions: true,
  recordSummaryStyle: true,
  relationshipMemoryUsage: true,
  replyTone: true,
  suggestionAggressiveness: true
};

export async function getAiPreferences(actor: WorkspaceActor): Promise<AiPreferences> {
  await ensureWorkspaceAccess(actor);
  const row = await prisma.aiPreference.findUnique({
    where: {
      workspaceId_userId: {
        userId: actor.actorUserId,
        workspaceId: actor.workspaceId
      }
    },
    select: aiPreferenceSelect
  });
  return row ? normalizeStoredAiPreferences(row) : defaultAiPreferences;
}

export async function updateAiPreferences(actor: WorkspaceActor, input: unknown): Promise<AiPreferences> {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeAiPreferenceUpdate(input);
  const row = await prisma.aiPreference.upsert({
    create: {
      ...defaultAiPreferences,
      ...normalized,
      userId: actor.actorUserId,
      workspaceId: actor.workspaceId
    },
    update: normalized,
    where: {
      workspaceId_userId: {
        userId: actor.actorUserId,
        workspaceId: actor.workspaceId
      }
    },
    select: aiPreferenceSelect
  });
  return normalizeStoredAiPreferences(row);
}

export async function resetAiPreferences(actor: WorkspaceActor): Promise<AiPreferences> {
  await ensureWorkspaceAccess(actor);
  await prisma.aiPreference.deleteMany({
    where: {
      userId: actor.actorUserId,
      workspaceId: actor.workspaceId
    }
  });
  return defaultAiPreferences;
}

export function draftAiPreferenceChangesFromText(text: string): AiPreferenceDraft {
  const cleaned = sanitizeInstructionText(text);
  const lower = cleaned.toLowerCase();
  const proposedChanges: Partial<AiPreferences> = {};

  if (/\b(one sentence|single sentence|one-sentence)\b/.test(lower)) proposedChanges.emailSummaryLength = "one_sentence";
  else if (/\b(no email summar|disable email summar|do not summarize email)\b/.test(lower)) proposedChanges.emailSummaryLength = "none";
  else if (/\b(detailed email|long email|more email detail)\b/.test(lower)) proposedChanges.emailSummaryLength = "detailed";

  if (/\b(concise|brief|short)\b/.test(lower)) {
    proposedChanges.recordSummaryStyle = "concise";
    proposedChanges.replyTone = "concise";
  }
  if (/\b(detailed|more detail|thorough)\b/.test(lower)) {
    proposedChanges.recordSummaryStyle = "detailed";
    proposedChanges.assistantDetailLevel = "detailed";
  }
  if (/\b(warm|friendly|warmer)\b/.test(lower)) proposedChanges.replyTone = "warm";
  if (/\b(formal|professional)\b/.test(lower)) proposedChanges.replyTone = "professional";
  if (/\b(follow up|follow-up|nudge)\b/.test(lower)) proposedChanges.replyTone = "follow_up";
  if (/\b(pricing|quote|commercial)\b/.test(lower)) proposedChanges.replyTone = "pricing_quote";
  if (/\b(simple diagnostics?|hide technical|less technical)\b/.test(lower)) proposedChanges.diagnosticsDetailLevel = "simple";
  if (/\b(technical diagnostics?|debug detail|show technical)\b/.test(lower)) proposedChanges.diagnosticsDetailLevel = "technical";
  if (/\b(conservative memory|careful memory|less personal)\b/.test(lower)) proposedChanges.relationshipMemoryUsage = "conservative";
  if (/\b(proactive memory|use memory more)\b/.test(lower)) proposedChanges.relationshipMemoryUsage = "proactive";

  return {
    proposedChanges,
    reviewFirst: true,
    summary: Object.keys(proposedChanges).length > 0
      ? "Northstar can draft these preference changes for review before saving."
      : "No clear preference changes were detected. Keep or edit the written guidance before saving."
  };
}

export function aiReplyToneFromPreferences(preferences: AiPreferences): AiReplyTone {
  return preferences.replyTone;
}

export function sanitizeInstructionText(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return redactSensitiveText(trimmed).slice(0, 1200);
}

function normalizeAiPreferenceUpdate(input: unknown): Partial<AiPreferences> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("VALIDATION_ERROR", "AI preferences update must be an object.", 422);
  }
  const value = input as Record<string, unknown>;
  return omitUndefined({
    assistantDetailLevel: hasKey(value, "assistantDetailLevel")
      ? optionValue(value.assistantDetailLevel, aiPreferenceOptions.assistantDetailLevel, "Assistant detail level is invalid.")
      : undefined,
    diagnosticsDetailLevel: hasKey(value, "diagnosticsDetailLevel")
      ? optionValue(value.diagnosticsDetailLevel, aiPreferenceOptions.diagnosticsDetailLevel, "Diagnostics detail level is invalid.")
      : undefined,
    emailSummaryLength: hasKey(value, "emailSummaryLength")
      ? optionValue(value.emailSummaryLength, aiPreferenceOptions.emailSummaryLength, "Email summary length is invalid.")
      : undefined,
    meetingIntelligenceNoteStyle: hasKey(value, "meetingIntelligenceNoteStyle")
      ? optionValue(value.meetingIntelligenceNoteStyle, aiPreferenceOptions.meetingIntelligenceNoteStyle, "Meeting Intelligence note style is invalid.")
      : undefined,
    naturalLanguageInstructions: hasKey(value, "naturalLanguageInstructions")
      ? sanitizeInstructionText(value.naturalLanguageInstructions) || null
      : undefined,
    recordSummaryStyle: hasKey(value, "recordSummaryStyle")
      ? optionValue(value.recordSummaryStyle, aiPreferenceOptions.recordSummaryStyle, "Record summary style is invalid.")
      : undefined,
    relationshipMemoryUsage: hasKey(value, "relationshipMemoryUsage")
      ? optionValue(value.relationshipMemoryUsage, aiPreferenceOptions.relationshipMemoryUsage, "Relationship Memory usage is invalid.")
      : undefined,
    replyTone: hasKey(value, "replyTone")
      ? optionValue(value.replyTone, aiPreferenceOptions.replyTone, "Reply tone is invalid.")
      : undefined,
    suggestionAggressiveness: hasKey(value, "suggestionAggressiveness")
      ? optionValue(value.suggestionAggressiveness, aiPreferenceOptions.suggestionAggressiveness, "Suggestion level is invalid.")
      : undefined
  });
}

function normalizeStoredAiPreferences(row: Record<keyof AiPreferences, string | null>): AiPreferences {
  return {
    assistantDetailLevel: optionOrDefault(row.assistantDetailLevel, aiPreferenceOptions.assistantDetailLevel, defaultAiPreferences.assistantDetailLevel),
    diagnosticsDetailLevel: optionOrDefault(row.diagnosticsDetailLevel, aiPreferenceOptions.diagnosticsDetailLevel, defaultAiPreferences.diagnosticsDetailLevel),
    emailSummaryLength: optionOrDefault(row.emailSummaryLength, aiPreferenceOptions.emailSummaryLength, defaultAiPreferences.emailSummaryLength),
    meetingIntelligenceNoteStyle: optionOrDefault(row.meetingIntelligenceNoteStyle, aiPreferenceOptions.meetingIntelligenceNoteStyle, defaultAiPreferences.meetingIntelligenceNoteStyle),
    naturalLanguageInstructions: row.naturalLanguageInstructions || null,
    recordSummaryStyle: optionOrDefault(row.recordSummaryStyle, aiPreferenceOptions.recordSummaryStyle, defaultAiPreferences.recordSummaryStyle),
    relationshipMemoryUsage: optionOrDefault(row.relationshipMemoryUsage, aiPreferenceOptions.relationshipMemoryUsage, defaultAiPreferences.relationshipMemoryUsage),
    replyTone: optionOrDefault(row.replyTone, aiPreferenceOptions.replyTone, defaultAiPreferences.replyTone),
    suggestionAggressiveness: optionOrDefault(row.suggestionAggressiveness, aiPreferenceOptions.suggestionAggressiveness, defaultAiPreferences.suggestionAggressiveness)
  };
}

function optionValue<const T extends readonly string[]>(value: unknown, options: T, message: string): T[number] {
  if (typeof value === "string" && (options as readonly string[]).includes(value)) return value as T[number];
  throw new ApiError("VALIDATION_ERROR", message, 422);
}

function optionOrDefault<const T extends readonly string[]>(value: string | null, options: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? value as T[number] : fallback;
}

function hasKey(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<AiPreferences>;
}
