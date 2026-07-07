import type { CrmTarget, ProposedNextStepActivity, ProposedNote, ProposedRelationshipBriefFact } from "./types";

export type MeetingPlacementExplanation = {
  confidence: "high" | "low" | "medium";
  label: string;
  reason: string;
  reviewFirst: true;
  targetType: "activity" | "deal" | "lead" | "organization" | "person" | "unknown";
};

export function explainMeetingNotePlacement(note: Pick<ProposedNote, "body" | "kind" | "target">): MeetingPlacementExplanation {
  const targetType = normalizeTargetType(note.target);
  if (note.kind === "personal_fact" || targetType === "person") {
    return explanation("Contact context", "The proposal contains person-level detail or targets a contact.", "person", "medium");
  }
  if (note.kind === "company_fact" || targetType === "organization") {
    return explanation("Organization context", "The proposal looks account-level or targets an organization.", "organization", "medium");
  }
  if (note.kind === "deal_fact" || targetType === "deal") {
    return explanation("Deal context", "The proposal refers to commercial or pipeline context for a deal.", "deal", "medium");
  }
  if (note.kind === "lead_fact" || targetType === "lead") {
    return explanation("Lead context", "The proposal belongs with pre-conversion lead qualification.", "lead", "medium");
  }
  return inferFromText(note.body);
}

export function explainMeetingActivityPlacement(activity: Pick<ProposedNextStepActivity, "target" | "title"> & { type?: string }): MeetingPlacementExplanation {
  const targetType = normalizeTargetType(activity.target);
  if (targetType !== "unknown") {
    const label = activity.type ? `${activity.type.toLowerCase()} follow-up` : "meeting update";
    return explanation("Follow-up target", `The ${label} is attached to the selected ${targetType}.`, targetType, "medium");
  }
  return explanation("Needs target review", "No target is selected, so this follow-up will be skipped until a reviewer chooses one.", "activity", "low");
}

export function explainRelationshipFactPlacement(fact: Pick<ProposedRelationshipBriefFact, "field" | "text">): MeetingPlacementExplanation {
  if (/\b(company|contract|procurement|security|legal|implementation|rollout|msa|sow)\b/i.test(fact.text)) {
    return explanation("Check organization placement", "This fact may be account-level even though it was proposed for contact memory.", "organization", "low");
  }
  return explanation("Contact memory", `This fact maps to the ${fact.field.replace("relationship", "").replace(/([A-Z])/g, " $1").trim()} field.`, "person", "medium");
}

function inferFromText(text: string): MeetingPlacementExplanation {
  if (/\b(pricing|quote|renewal|contract|close|deal|stage)\b/i.test(text)) {
    return explanation("Deal context", "Commercial language suggests this belongs on a deal timeline.", "deal", "medium");
  }
  if (/\b(company|account|team|procurement|security|implementation)\b/i.test(text)) {
    return explanation("Organization context", "Account-level language suggests an organization note.", "organization", "medium");
  }
  if (/\b(prefers|family|birthday|communication|likes|personal)\b/i.test(text)) {
    return explanation("Contact context", "Personal or communication preference language suggests contact Relationship Memory.", "person", "medium");
  }
  return explanation("Needs target review", "Northstar could not confidently infer the best CRM target from the proposal text.", "unknown", "low");
}

function normalizeTargetType(target: CrmTarget | null | undefined): MeetingPlacementExplanation["targetType"] {
  if (!target) return "unknown";
  if (target.type === "person") return "person";
  if (target.type === "deal" || target.type === "lead" || target.type === "organization") return target.type;
  return "unknown";
}

function explanation(
  label: string,
  reason: string,
  targetType: MeetingPlacementExplanation["targetType"],
  confidence: MeetingPlacementExplanation["confidence"]
): MeetingPlacementExplanation {
  return { confidence, label, reason, reviewFirst: true, targetType };
}
