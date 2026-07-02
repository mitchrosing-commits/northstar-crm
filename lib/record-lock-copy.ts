export type ClosedDealLockArea =
  | "activities"
  | "contractWorkflow"
  | "customFields"
  | "emailLogs"
  | "notes"
  | "quoteDrafts"
  | "stage";

export type ConvertedLeadLockArea = "activities" | "customFields" | "emailLogs" | "notes";

export const closedDealLockedLabel = "Closed deal locked";
export const convertedLeadLockedLabel = "Converted lead locked";

const closedDealLockMessages: Record<ClosedDealLockArea, string> = {
  activities: "Closed deals are locked. Activities are read-only.",
  contractWorkflow: "Closed deals are locked. Contract workflow steps are read-only.",
  customFields: "Closed deals are locked. Custom fields are read-only.",
  emailLogs: "Closed deals are locked. Email logs are read-only.",
  notes: "Closed deals are locked. Notes are read-only.",
  quoteDrafts: "Closed deals are locked. Quote drafts are read-only.",
  stage: "Stage movement is locked after a deal is closed.",
};

const convertedLeadLockMessages: Record<ConvertedLeadLockArea, string> = {
  activities: "This lead has been converted. Create follow-up activities on the converted deal.",
  customFields: "This lead has been converted. Custom fields are read-only.",
  emailLogs: "This lead has been converted. Log new email context on the converted deal.",
  notes: "This lead has been converted. Add new context on the converted deal.",
};

export function closedDealLockMessage(area: ClosedDealLockArea) {
  return closedDealLockMessages[area];
}

export function convertedLeadLockMessage(area: ConvertedLeadLockArea) {
  return convertedLeadLockMessages[area];
}
