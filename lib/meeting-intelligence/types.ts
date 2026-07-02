export const meetingSourceTypes = [
  "pasted_text",
  "markdown",
  "text_file",
  "pdf",
  "docx",
  "image",
  "audio",
  "video",
  "unsupported"
] as const;

export type MeetingSourceType = (typeof meetingSourceTypes)[number];

export const meetingIntakeStatuses = [
  "DRAFT",
  "EXTRACTING",
  "EXTRACTED",
  "ANALYZING",
  "READY_FOR_REVIEW",
  "APPLIED",
  "FAILED"
] as const;

export type MeetingIntakeStatus = (typeof meetingIntakeStatuses)[number];

export type ProcessorCapability = "supported" | "provider_required" | "deferred" | "unsupported";

export type SourceDetectionInput = {
  explicitSourceType?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  text?: unknown;
};

export type SourceDetectionResult = {
  capability: ProcessorCapability;
  message?: string;
  sourceType: MeetingSourceType;
};

export type ExtractedMeetingText = {
  markdownText?: string;
  metadata: MeetingSourceMetadata;
  rawText: string;
  sourceType: MeetingSourceType;
  warnings: string[];
};

export type MeetingSourceMetadata = {
  byteLength?: number;
  filename?: string;
  mimeType?: string;
  pageCount?: number;
  processor: string;
  sourceType: MeetingSourceType;
  wordCount?: number;
};

export type NormalizedMeetingMarkdown = {
  markdown: string;
  sections: {
    actionItems: string[];
    attendees: string[];
    decisions: string[];
    openQuestions: string[];
    risks: string[];
  };
};

export type MatchConfidence = "high" | "medium" | "low" | "ambiguous";

export type CrmObjectType = "deal" | "lead" | "person" | "organization";

export type MatchedCrmObject = {
  confidence: MatchConfidence;
  displayName: string;
  evidenceExcerpt: string;
  id: string;
  matchedReason: string;
  objectType: CrmObjectType;
  status?: string;
  warning?: string;
};

export type UnmatchedEntity = {
  entityType: "person" | "organization" | "deal_or_lead" | "unknown";
  evidenceExcerpt: string;
  name: string;
  reason: string;
};

export type CrmTarget = {
  id: string;
  label?: string;
  type: CrmObjectType;
};

export type ProposedMeetingActivity = {
  associatedTargets?: CrmTarget[];
  confidence?: MatchConfidence;
  completedAt?: string;
  description: string;
  evidence: string[];
  include: boolean;
  matchedReason?: string;
  target: CrmTarget | null;
  targetWarning?: string;
  title: string;
};

export type ProposedNote = {
  body: string;
  confidence?: MatchConfidence;
  evidence: string[];
  id: string;
  include: boolean;
  kind: "meeting_summary" | "personal_fact" | "company_fact" | "deal_fact";
  matchedReason?: string;
  target: CrmTarget | null;
  targetWarning?: string;
};

export type ProposedNextStepActivity = {
  confidence?: MatchConfidence;
  description?: string;
  dueAt?: string;
  evidence: string[];
  id: string;
  include: boolean;
  matchedReason?: string;
  ownerId?: string | null;
  target: CrmTarget | null;
  targetWarning?: string;
  title: string;
  type: "CALL" | "EMAIL" | "MEETING" | "TASK";
};

export type MeetingIntelligenceDraft = {
  markdown: string;
  matchedObjects: MatchedCrmObject[];
  meetingActivity: ProposedMeetingActivity | null;
  notes: ProposedNote[];
  nextStepActivities: ProposedNextStepActivity[];
  sourceMetadata?: MeetingSourceMetadata;
  summary: string;
  unmatchedEntities: UnmatchedEntity[];
  warnings: string[];
};

export type ApplyMeetingIntelligenceInput = {
  meetingActivity?: ProposedMeetingActivity | null;
  notes?: ProposedNote[];
  nextStepActivities?: ProposedNextStepActivity[];
};

export type AppliedCrmUpdate = {
  href: string;
  id: string;
  label: string;
  type: "activity" | "note";
};

export type SkippedCrmUpdate = {
  label: string;
  reason: string;
  type: "activity" | "note";
};

export type ApplyMeetingIntelligenceResult = {
  appliedAt: string;
  created: AppliedCrmUpdate[];
  skipped: SkippedCrmUpdate[];
  warnings: string[];
};
