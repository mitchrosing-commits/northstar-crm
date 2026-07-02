import { analyzeMeetingIntelligence } from "./analyze";
import type {
  CrmTarget,
  MatchedCrmObject,
  MeetingIntelligenceDraft,
  MeetingSourceMetadata,
  ProposedNextStepActivity,
  ProposedNote,
  UnmatchedEntity
} from "./types";

export type MeetingAnalysisProviderInput = {
  contextText?: string | null;
  markdown: string;
  matchedObjects: MatchedCrmObject[];
  sourceMetadata?: MeetingSourceMetadata;
  unmatchedEntities: UnmatchedEntity[];
};

export type MeetingAnalysisProvider = {
  analyze(input: MeetingAnalysisProviderInput): Promise<MeetingAnalysisProviderOutput> | MeetingAnalysisProviderOutput;
  analyzeMeetingMarkdown(input: MeetingAnalysisProviderInput): Promise<MeetingAnalysisProviderOutput> | MeetingAnalysisProviderOutput;
  id: string;
};

export type MeetingAnalysisProviderOutput = MeetingIntelligenceDraft & {
  attendees?: string[];
  confidence?: "high" | "medium" | "low";
  decisions?: string[];
  matchedEntityCandidates?: Array<{
    confidence: "high" | "medium" | "low";
    evidence: string;
    name: string;
    suggestedTarget?: CrmTarget;
  }>;
  openQuestions?: string[];
  providerId?: string;
  proposedNextSteps?: ProposedNextStepActivity[];
  proposedNotes?: ProposedNote[];
  risks?: string[];
};

export type OcrExtractionProvider = {
  extractImageText(input: ProviderBinaryInput): Promise<ProviderTextResult>;
  id: string;
};

export type TranscriptionProvider = {
  transcribe(input: ProviderBinaryInput): Promise<ProviderTextResult>;
  id: string;
};

export type DocumentExtractionProvider = {
  extractDocumentText(input: ProviderBinaryInput): Promise<ProviderTextResult>;
  id: string;
};

export type ProviderBinaryInput = {
  bytes: Uint8Array;
  filename?: string;
  mimeType?: string;
};

export type ProviderTextResult = {
  confidence?: "high" | "medium" | "low";
  metadata?: Record<string, string | number | boolean | null>;
  text: string;
  warnings: string[];
};

export const deterministicMeetingAnalysisProvider: MeetingAnalysisProvider = {
  id: "deterministic-v3",
  analyze(input) {
    return analyzeMeetingIntelligence(input);
  },
  analyzeMeetingMarkdown(input) {
    return analyzeMeetingIntelligence(input);
  }
};
