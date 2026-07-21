export const meetingSourceTypes = [
  "pasted_text",
  "markdown",
  "text_file",
  "rtf",
  "html",
  "csv",
  "json",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
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
export type MeetingSourceConversionMode = "local" | "provider_required" | "unsupported";
export type MeetingSourceProviderRequirement =
  | "document_conversion"
  | "media_processing"
  | "ocr_or_vision"
  | "transcription";

export type SourceDetectionInput = {
  explicitSourceType?: unknown;
  filename?: unknown;
  mimeType?: unknown;
  text?: unknown;
};

export type SourceDetectionResult = {
  capability: ProcessorCapability;
  conversionMode: MeetingSourceConversionMode;
  extractionMethod: string;
  message?: string;
  requiredProvider?: MeetingSourceProviderRequirement;
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
  conversionMode?: MeetingSourceConversionMode;
  extractionMethod?: string;
  filename?: string;
  mimeType?: string;
  pageCount?: number;
  processor: string;
  processorCapability?: ProcessorCapability;
  providerId?: string;
  providerName?: string;
  requiredProvider?: MeetingSourceProviderRequirement;
  sourceType: MeetingSourceType;
  statusMessage?: string;
  transcriptionConfidence?: "high" | "low" | "medium";
  warnings?: string[];
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

export type TranscriptSegment = {
  confidence?: "high" | "low" | "medium";
  id: string;
  speaker?: string;
  startTime?: string;
  text: string;
  warnings?: string[];
};

export type MeetingAssociationReview = {
  correctionUpdatedAt?: string;
  confidence: MatchConfidence | "unmatched";
  evidence: string;
  id: string;
  matchedReason?: string;
  mention: string;
  originalTarget?: CrmTarget | null;
  resolutionStatus?: "ambiguous" | "confirmed" | "stale" | "unmatched" | "user_corrected";
  selectedTarget: CrmTarget | null;
  targetType: CrmObjectType | "unknown";
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

export type MeetingProposalFactCategory =
  | "ambiguousNeedsReview"
  | "dealFact"
  | "followUpAction"
  | "organizationFact"
  | "personFact"
  | "stakeholderNote";

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
  category?: MeetingProposalFactCategory;
  confidence?: MatchConfidence;
  evidence: string[];
  id: string;
  include: boolean;
  kind: "meeting_summary" | "personal_fact" | "company_fact" | "deal_fact" | "lead_fact" | "stakeholder_note";
  matchedReason?: string;
  target: CrmTarget | null;
  targetWarning?: string;
};

export type ProposedNextStepActivity = {
  category?: MeetingProposalFactCategory;
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

export type RelationshipBriefFields = {
  relationshipBusinessConcerns?: string;
  relationshipCommunicationStyle?: string;
  relationshipFollowUpReminders?: string;
  relationshipInternalGuidance?: string;
  relationshipPersonalContext?: string;
};

export type RelationshipBriefSensitivityCategory =
  | "do_not_mention_directly"
  | "internal_only"
  | "safe_personalization"
  | "use_cautiously";

export type RelationshipBriefSensitivityGuidance = {
  category: RelationshipBriefSensitivityCategory;
  field?: keyof RelationshipBriefFields;
  guidance: string;
  reason?: string;
};

export type ProposedRelationshipBriefFact = {
  category?: MeetingProposalFactCategory;
  duplicateOfExisting?: boolean;
  evidence?: string[];
  field: keyof RelationshipBriefFields;
  id: string;
  include: boolean;
  sensitivity?: RelationshipBriefSensitivityGuidance[];
  staleWarning?: string;
  text: string;
  warnings?: string[];
};

export type ProposedRelationshipBriefUpdate = {
  confidence?: MatchConfidence;
  evidence: string[];
  existing: RelationshipBriefFields;
  facts?: ProposedRelationshipBriefFact[];
  id: string;
  include: boolean;
  matchedReason?: string;
  mergedPreview?: RelationshipBriefFields;
  proposed: RelationshipBriefFields;
  providerId?: string;
  providerName?: string;
  sensitivity?: RelationshipBriefSensitivityGuidance[];
  target: CrmTarget | null;
  targetWarning?: string;
  warnings?: string[];
};

export type MeetingSummarySectionKey =
  | "commercial_details"
  | "commitments"
  | "customer_needs_or_concerns"
  | "decisions"
  | "key_discussion_points"
  | "meeting_overview"
  | "next_steps"
  | "objectives"
  | "open_questions"
  | "participants"
  | "risks_or_blockers";

export type MeetingSummarySection = {
  evidenceType: "explicit" | "inferred";
  items: string[];
  key: MeetingSummarySectionKey;
  title: string;
};

export type MeetingCrmChangeProposalSummary = {
  canApply: boolean;
  confidence: string | null;
  duplicateWarnings: string[];
  evidence: string[];
  href: string;
  id: string;
  permissionLabel: string;
  permissionLevel: string;
  permissionReason: string;
  proposalType: string;
  rationale: string | null;
  status: string;
  targetLabel: string;
  title: string;
  warnings: string[];
};

export type MeetingIntelligenceDraft = {
  associationReviews?: MeetingAssociationReview[];
  crmChangeProposals?: MeetingCrmChangeProposalSummary[];
  markdown: string;
  matchedObjects: MatchedCrmObject[];
  meetingActivity: ProposedMeetingActivity | null;
  notes: ProposedNote[];
  nextStepActivities: ProposedNextStepActivity[];
  relationshipBriefUpdates?: ProposedRelationshipBriefUpdate[];
  sourceMetadata?: MeetingSourceMetadata;
  summary: string;
  summarySections?: MeetingSummarySection[];
  transcriptSegments?: TranscriptSegment[];
  unmatchedEntities: UnmatchedEntity[];
  warnings: string[];
};

export type ApplyMeetingIntelligenceInput = {
  meetingActivity?: ProposedMeetingActivity | null;
  notes?: ProposedNote[];
  nextStepActivities?: ProposedNextStepActivity[];
  relationshipBriefUpdates?: ProposedRelationshipBriefUpdate[];
};

export type AppliedCrmUpdate = {
  href: string;
  id: string;
  label: string;
  type: "activity" | "note" | "relationship_brief";
};

export type RelationshipBriefChangeSummary = {
  acceptedFactCount: number;
  acceptedFacts: string[];
  actorId?: string;
  changedAt: string;
  field: keyof RelationshipBriefFields;
  fieldLabel: string;
  newValue: string | null;
  previousValue: string | null;
  source: {
    intakeId?: string;
    occurredAt?: string;
    title?: string;
    type: "meeting_intelligence" | "manual";
  };
  target: {
    id: string;
    label: string;
    type: "person";
  };
};

export type SkippedCrmUpdate = {
  label: string;
  reason: string;
  type: "activity" | "note" | "relationship_brief";
};

export type ApplyMeetingIntelligenceResult = {
  appliedAt: string;
  created: AppliedCrmUpdate[];
  relationshipBriefChanges?: RelationshipBriefChangeSummary[];
  skipped: SkippedCrmUpdate[];
  warnings: string[];
};
