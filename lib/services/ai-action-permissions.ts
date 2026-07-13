import { ApiError } from "@/lib/api/responses";

export const aiActionPermissionLevels = [
  "never_allow",
  "suggest_only",
  "require_confirmation",
  "allow_automatically"
] as const;

export type AiActionPermissionLevel = (typeof aiActionPermissionLevels)[number];

export const aiActionPermissionKeys = [
  "create_follow_up_activity",
  "create_note",
  "update_note_after_meeting",
  "update_relationship_memory",
  "update_contact_or_organization",
  "update_deal_fields",
  "change_deal_stage",
  "create_lead_or_deal",
  "draft_email",
  "send_email"
] as const;

export type AiActionPermissionKey = (typeof aiActionPermissionKeys)[number];
export type AiActionPermissionMap = Record<AiActionPermissionKey, AiActionPermissionLevel>;
export type AiActionPermissionGroup = "crm_updates" | "email" | "follow_ups_notes" | "high_impact" | "relationship_intelligence";

export type AiActionPermissionDefinition = {
  allowedLevels: readonly AiActionPermissionLevel[];
  description: string;
  group: AiActionPermissionGroup;
  key: AiActionPermissionKey;
  label: string;
  supportsAutomatic: boolean;
  technicallySupported: boolean;
  unavailableReason?: string;
};

export type AssistantActionPermissionDecision = {
  actionKey: AiActionPermissionKey | null;
  canApply: boolean;
  level: AiActionPermissionLevel;
  reason: string;
  state: "allowed_automatically" | "blocked" | "requires_confirmation" | "settings_only";
};

export const aiActionPermissionDefinitions: AiActionPermissionDefinition[] = [
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation", "allow_automatically"],
    description: "Create dated follow-up tasks from Assistant drafts.",
    group: "follow_ups_notes",
    key: "create_follow_up_activity",
    label: "Create follow-up activities",
    supportsAutomatic: true,
    technicallySupported: true
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation", "allow_automatically"],
    description: "Create CRM notes from clear Assistant drafts.",
    group: "follow_ups_notes",
    key: "create_note",
    label: "Create notes",
    supportsAutomatic: true,
    technicallySupported: true
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation"],
    description: "Update existing meeting notes after reviewed meeting work.",
    group: "follow_ups_notes",
    key: "update_note_after_meeting",
    label: "Update existing notes after a meeting",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "No Assistant apply handler updates existing notes yet."
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation"],
    description: "Update curated Relationship Memory and profile fields.",
    group: "relationship_intelligence",
    key: "update_relationship_memory",
    label: "Update Relationship Memory/profile fields",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "Relationship Memory drafts remain review-only in this slice."
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation"],
    description: "Update existing contact or organization fields.",
    group: "crm_updates",
    key: "update_contact_or_organization",
    label: "Update contact or organization fields",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "No Assistant apply handler updates contact or organization fields yet."
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation"],
    description: "Update existing deal fields without changing stage.",
    group: "crm_updates",
    key: "update_deal_fields",
    label: "Update deal fields",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "No Assistant apply handler updates deal fields yet."
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation"],
    description: "Move a deal between existing pipeline stages.",
    group: "high_impact",
    key: "change_deal_stage",
    label: "Change deal stage",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "Deal stage changes remain confirmation-only and unavailable to Assistant apply."
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation"],
    description: "Create new pipeline records from Assistant context.",
    group: "high_impact",
    key: "create_lead_or_deal",
    label: "Create leads or deals",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "Assistant does not create leads or deals in this slice."
  },
  {
    allowedLevels: ["never_allow", "suggest_only", "require_confirmation"],
    description: "Draft email text for user review.",
    group: "email",
    key: "draft_email",
    label: "Draft email",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "Assistant email drafting is settings-only here; existing email draft panels stay review-first."
  },
  {
    allowedLevels: ["never_allow", "require_confirmation"],
    description: "Send provider email from the connected mailbox.",
    group: "email",
    key: "send_email",
    label: "Send email",
    supportsAutomatic: false,
    technicallySupported: false,
    unavailableReason: "Autonomous email sending is unavailable; no Assistant provider-send handler exists."
  }
];

export const aiActionPermissionGroups: Array<{ description: string; group: AiActionPermissionGroup; label: string }> = [
  { description: "Field and record update boundaries.", group: "crm_updates", label: "CRM updates" },
  { description: "Tasks and note creation boundaries.", group: "follow_ups_notes", label: "Follow-ups and notes" },
  { description: "Email drafting and sending boundaries.", group: "email", label: "Email" },
  { description: "Relationship Memory and profile boundaries.", group: "relationship_intelligence", label: "Relationship intelligence" },
  { description: "Higher-risk pipeline changes and creation boundaries.", group: "high_impact", label: "High-impact actions" }
];

export const defaultAiActionPermissions: AiActionPermissionMap = {
  change_deal_stage: "suggest_only",
  create_follow_up_activity: "require_confirmation",
  create_lead_or_deal: "suggest_only",
  create_note: "require_confirmation",
  draft_email: "suggest_only",
  send_email: "require_confirmation",
  update_contact_or_organization: "suggest_only",
  update_deal_fields: "suggest_only",
  update_note_after_meeting: "suggest_only",
  update_relationship_memory: "suggest_only"
};

const definitionByKey = new Map(aiActionPermissionDefinitions.map((definition) => [definition.key, definition]));

export function normalizeStoredAiActionPermissions(
  value: unknown,
  fallback: AiActionPermissionMap = defaultAiActionPermissions
): AiActionPermissionMap {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(
    aiActionPermissionKeys.map((key) => {
      const level = input[key];
      return [key, isAllowedLevelForAction(key, level) ? level : fallback[key]];
    })
  ) as AiActionPermissionMap;
}

export function normalizeAiActionPermissionUpdate(input: unknown): AiActionPermissionMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ApiError("VALIDATION_ERROR", "Assistant action permissions must be an object.", 422);
  }
  const value = input as Record<string, unknown>;
  const unknownKeys = Object.keys(value).filter((key) => !(aiActionPermissionKeys as readonly string[]).includes(key));
  if (unknownKeys.length > 0) {
    throw new ApiError("VALIDATION_ERROR", "Assistant action permission includes an unsupported action.", 422);
  }
  return Object.fromEntries(
    aiActionPermissionKeys.map((key) => {
      const level = value[key] ?? defaultAiActionPermissions[key];
      if (!isAllowedLevelForAction(key, level)) {
        throw new ApiError("VALIDATION_ERROR", `${permissionActionLabel(key)} does not support that permission level.`, 422);
      }
      return [key, level];
    })
  ) as AiActionPermissionMap;
}

export function aiActionPermissionOptionsForAction(key: AiActionPermissionKey) {
  return [...(definitionByKey.get(key)?.allowedLevels ?? ["never_allow", "suggest_only"])];
}

export function permissionActionLabel(key: AiActionPermissionKey) {
  return definitionByKey.get(key)?.label ?? key;
}

export function permissionLevelLabel(level: AiActionPermissionLevel) {
  if (level === "never_allow") return "Never allow";
  if (level === "suggest_only") return "Suggest or draft only";
  if (level === "require_confirmation") return "Require confirmation";
  return "Allow automatically";
}

export function assistantActionPermissionKeyForRequest(actionType: string): AiActionPermissionKey | null {
  if (actionType === "activity") return "create_follow_up_activity";
  if (actionType === "note") return "create_note";
  if (actionType === "contact_relationship_update") return "update_relationship_memory";
  if (actionType === "organization_contact_creation") return "update_contact_or_organization";
  return null;
}

export function decideAssistantActionPermission(input: {
  actionType: string;
  permissions: AiActionPermissionMap;
  status: string;
  technicallyCanApply: boolean;
}): AssistantActionPermissionDecision {
  const actionKey = assistantActionPermissionKeyForRequest(input.actionType);
  if (!actionKey) {
    return {
      actionKey,
      canApply: false,
      level: "suggest_only",
      reason: "This Assistant action is settings-only until a scoped apply handler exists.",
      state: "settings_only"
    };
  }

  const definition = definitionByKey.get(actionKey);
  const level = input.permissions[actionKey] ?? defaultAiActionPermissions[actionKey];
  if (input.status !== "PENDING") {
    return {
      actionKey,
      canApply: false,
      level,
      reason: "This request is no longer pending.",
      state: "blocked"
    };
  }
  if (definition?.technicallySupported && !input.technicallyCanApply) {
    return {
      actionKey,
      canApply: false,
      level,
      reason: "Apply is only available for low-risk pending activity or note requests with a clear target.",
      state: "blocked"
    };
  }
  if (!definition?.technicallySupported) {
    return {
      actionKey,
      canApply: false,
      level,
      reason: definition?.unavailableReason ?? "No scoped Assistant apply handler exists for this action yet.",
      state: "settings_only"
    };
  }
  if (level === "never_allow") {
    return {
      actionKey,
      canApply: false,
      level,
      reason: "Your AI Preferences currently never allow this Assistant action.",
      state: "blocked"
    };
  }
  if (level === "suggest_only") {
    return {
      actionKey,
      canApply: false,
      level,
      reason: "Your AI Preferences allow suggestions and drafts only for this action.",
      state: "blocked"
    };
  }
  if (level === "allow_automatically") {
    return {
      actionKey,
      canApply: true,
      level,
      reason: "Your AI Preferences allow this supported low-risk action automatically; new eligible requests can apply immediately.",
      state: "allowed_automatically"
    };
  }
  return {
    actionKey,
    canApply: true,
    level,
    reason: "Your AI Preferences require explicit confirmation before this supported action is applied.",
    state: "requires_confirmation"
  };
}

function isAllowedLevelForAction(key: AiActionPermissionKey, value: unknown): value is AiActionPermissionLevel {
  return typeof value === "string" && (definitionByKey.get(key)?.allowedLevels ?? []).includes(value as AiActionPermissionLevel);
}
