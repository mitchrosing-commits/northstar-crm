export type RelationshipBriefFieldKey =
  | "relationshipPersonalContext"
  | "relationshipCommunicationStyle"
  | "relationshipBusinessConcerns"
  | "relationshipFollowUpReminders"
  | "relationshipInternalGuidance";

export type RelationshipBriefUsageCategory =
  | "safe_personalization"
  | "tone_context"
  | "use_cautiously"
  | "internal_only"
  | "do_not_mention_directly";

export type RelationshipBriefUsageGuidance = {
  aiUsage: string;
  badges: string[];
  category: RelationshipBriefUsageCategory;
  customerFacingUse: string;
  description: string;
  emptyLabel: string;
  key: RelationshipBriefFieldKey;
  label: string;
};

export const relationshipBriefUsageGuidance = {
  relationshipPersonalContext: {
    aiUsage: "May inform warm personalization when voluntarily shared, but avoid protected traits or overly sensitive details.",
    badges: ["Safe personalization"],
    category: "safe_personalization",
    customerFacingUse: "Safe to mention lightly when relevant and voluntarily shared.",
    description: "Voluntarily shared interests, preferences, or personal context that can make follow-up warmer.",
    emptyLabel: "No personal context saved",
    key: "relationshipPersonalContext",
    label: "Personal context"
  },
  relationshipCommunicationStyle: {
    aiUsage: "Use for tone, cadence, and level of detail. Usually adapt the reply rather than quoting the preference.",
    badges: ["Use for tone"],
    category: "tone_context",
    customerFacingUse: "Use to adapt tone and structure; do not usually mention directly.",
    description: "How this contact prefers to communicate, including cadence, detail level, or channel preferences.",
    emptyLabel: "No communication preference saved",
    key: "relationshipCommunicationStyle",
    label: "Communication style"
  },
  relationshipBusinessConcerns: {
    aiUsage: "Use as sales context and handle carefully in customer-facing language.",
    badges: ["Use cautiously"],
    category: "use_cautiously",
    customerFacingUse: "May be addressed carefully, without sounding like internal profiling.",
    description: "Known objections, priorities, risks, or buying concerns to keep in mind during account work.",
    emptyLabel: "No business concerns saved",
    key: "relationshipBusinessConcerns",
    label: "Business concerns"
  },
  relationshipFollowUpReminders: {
    aiUsage: "Use as operational next-step context. Do not quote as a stored reminder.",
    badges: ["Internal next step", "Do not mention directly"],
    category: "do_not_mention_directly",
    customerFacingUse: "Use to remember next steps; do not mention that it was stored as a reminder.",
    description: "Human details or promises worth remembering before the next conversation.",
    emptyLabel: "No relationship reminders saved",
    key: "relationshipFollowUpReminders",
    label: "Follow-up reminders"
  },
  relationshipInternalGuidance: {
    aiUsage: "Internal-only handling guidance. Do not include the stored text in customer-facing AI drafts.",
    badges: ["Internal only", "Do not mention directly"],
    category: "internal_only",
    customerFacingUse: "Never mention directly.",
    description: "Private team guidance for handling the relationship. Do not quote this directly to the contact.",
    emptyLabel: "No internal guidance saved",
    key: "relationshipInternalGuidance",
    label: "Internal guidance"
  }
} satisfies Record<RelationshipBriefFieldKey, RelationshipBriefUsageGuidance>;

export const relationshipBriefFieldOrder = [
  "relationshipPersonalContext",
  "relationshipCommunicationStyle",
  "relationshipBusinessConcerns",
  "relationshipFollowUpReminders",
  "relationshipInternalGuidance"
] satisfies RelationshipBriefFieldKey[];

export function relationshipBriefUsageItems() {
  return relationshipBriefFieldOrder.map((key) => relationshipBriefUsageGuidance[key]);
}

export function relationshipBriefUsageForField(key: RelationshipBriefFieldKey) {
  return relationshipBriefUsageGuidance[key];
}

export function relationshipBriefFieldLabel(key: RelationshipBriefFieldKey) {
  return relationshipBriefUsageGuidance[key].label;
}

export function relationshipBriefPromptFact(key: RelationshipBriefFieldKey, value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const guidance = relationshipBriefUsageGuidance[key];
  if (key === "relationshipInternalGuidance") {
    return `${guidance.label}: present but withheld from customer-facing AI context. ${guidance.aiUsage}`;
  }
  return `${guidance.label} (${guidance.aiUsage}): ${trimmed}`;
}
