import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const meetingIntelligenceForm = readFileSync(
  join(process.cwd(), "components/meeting-intelligence-form.tsx"),
  "utf8",
);
const meetingIntelligencePage = readFileSync(
  join(process.cwd(), "app/meeting-intelligence/page.tsx"),
  "utf8",
);
const meetingIntelligenceReview = readFileSync(
  join(process.cwd(), "components/meeting-intelligence-review.tsx"),
  "utf8",
);
const meetingIntelligenceDetailPage = readFileSync(
  join(process.cwd(), "app/meeting-intelligence/[intakeId]/page.tsx"),
  "utf8",
);
const compactList = readFileSync(
  join(process.cwd(), "components/compact-list.tsx"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const meetingIntelligenceService = readFileSync(
  join(process.cwd(), "lib/services/meeting-intelligence-service.ts"),
  "utf8",
);
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("meeting intelligence UX", () => {
  it("uses shared CRM primitives for intake, review, and result actions", () => {
    expect(meetingIntelligenceForm).toContain("FormActionBar");
    expect(meetingIntelligenceForm).toContain('submitLabel="Analyze intake"');
    expect(meetingIntelligenceForm).toContain("panel-actions-row");
    expect(meetingIntelligenceForm).toContain(
      "Supported: pasted text, markdown, .txt, .md, .rtf, .html, .csv, .json, text-based PDF, DOCX"
    );
    expect(meetingIntelligenceForm).toContain("Provider-backed: images, whiteboards, scanned PDFs, audio, video");
    expect(meetingIntelligenceForm).toContain("Unsupported: PPTX, XLSX, legacy .doc");
    expect(meetingIntelligenceForm).toContain("Text, RTF, HTML, CSV, JSON, and markdown files extract locally before review.");
    expect(meetingIntelligenceForm).toContain("PPTX decks are not locally parsed yet.");
    expect(meetingIntelligenceForm).toContain("Images and whiteboards queue OCR/vision extraction when a provider is configured");
    expect(meetingIntelligenceForm).toContain("Scanned PDFs queue OCR/vision extraction when a PDF-capable provider is configured.");
    expect(meetingIntelligenceForm).toContain("meetingDirectUploadSourceType");
    expect(meetingIntelligenceForm).toContain("meeting-intake-upload-capabilities");
    expect(meetingIntelligenceForm).toContain("meeting-upload-capability-card");
    expect(meetingIntelligenceForm).toContain("Local extraction");
    expect(meetingIntelligenceForm).toContain("Direct and multipart upload");
    expect(meetingIntelligenceForm).toContain("Provider extraction");
    expect(meetingIntelligenceForm).toContain("Review-first apply");
    expect(meetingIntelligenceForm).toContain("Scanned PDF or video without provider support");
    expect(meetingIntelligenceForm).toContain("nothing is written to CRM records until you apply selected updates");
    expect(meetingIntelligenceForm).toContain("uploadCapabilities");
    expect(meetingIntelligenceForm).toContain("uploadGateForFile");
    expect(meetingIntelligenceForm).toContain("directUploadDecision");
    expect(meetingIntelligenceForm).toContain("capabilityAwareFileNotice");
    expect(meetingIntelligenceForm).toContain("Direct upload will be used for this file.");
    expect(meetingIntelligenceForm).toContain("Multipart upload will be used for this file.");
    expect(meetingIntelligenceForm).toContain("This file will use the bounded app upload path before provider extraction.");
    expect(meetingIntelligenceForm).toContain("Large or scanned PDFs require a PDF-capable provider.");
    expect(meetingIntelligenceForm).toContain("This provider-backed file type is not available in this environment.");
    expect(meetingIntelligenceForm).toContain("meeting-intake-upload-sessions");
    expect(meetingIntelligenceForm).toContain("meeting-intake-multipart-upload-sessions");
    expect(meetingIntelligenceForm).toContain("tryDirectUploadIntake");
    expect(meetingIntelligenceForm).toContain("uploadMultipartIntake");
    expect(meetingIntelligenceForm).toContain("readMultipartResumeState");
    expect(meetingIntelligenceForm).toContain("persistMultipartResumeState");
    expect(meetingIntelligenceForm).toContain("inspectMultipartResumeState");
    expect(meetingIntelligenceForm).toContain("continueMultipartUpload");
    expect(meetingIntelligenceForm).toContain("if (completedParts.has(partNumber)) continue;");
    expect(meetingIntelligenceForm).toContain("northstar:meeting-intelligence:multipart-resume");
    expect(meetingIntelligenceForm).toContain("Interrupted upload:");
    expect(meetingIntelligenceForm).toContain("Multipart upload resume progress");
    expect(meetingIntelligenceForm).toContain("meeting-upload-progress");
    expect(meetingIntelligenceForm).toContain("Resume");
    expect(meetingIntelligenceForm).toContain("Cancel upload");
    expect(meetingIntelligenceForm).toContain("isDirectUploadFallbackError");
    expect(meetingIntelligenceForm).toContain("Hashing file...");
    expect(meetingIntelligenceForm).toContain("Creating multipart upload session...");
    expect(meetingIntelligenceForm).toContain("Requesting direct upload session...");
    expect(meetingIntelligenceForm).toContain("Uploading file directly...");
    expect(meetingIntelligenceForm).toContain("Uploading part");
    expect(meetingIntelligenceForm).toContain("Completing multipart upload...");
    expect(meetingIntelligenceForm).toContain("Aborting multipart upload...");
    expect(meetingIntelligenceForm).toContain("Previous multipart upload is already queued for extraction.");
    expect(meetingIntelligenceForm).toContain("Previous multipart upload can no longer be resumed.");
    expect(meetingIntelligenceForm).toContain("The selected file checksum does not match the interrupted multipart upload.");
    expect(meetingIntelligenceForm).toContain("Retrying upload...");
    expect(meetingIntelligenceForm).toContain("Finalizing upload...");
    expect(meetingIntelligenceForm).toContain("Queued for extraction.");
    expect(meetingIntelligenceForm).toContain("Direct upload unavailable; using standard upload.");
    expect(meetingIntelligenceForm).toContain("Upload already finalized; opening intake...");
    expect(meetingIntelligenceForm).toContain("MEETING_INTAKE_STORED_FILE_SIZE_MISMATCH");
    expect(meetingIntelligenceForm).toContain("MEETING_INTAKE_STORED_FILE_CHECKSUM_MISMATCH");
    expect(meetingIntelligenceForm).toContain("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE");
    expect(meetingIntelligenceForm).toContain("canRetrySignedUpload");
    expect(meetingIntelligenceForm).toContain("arrayBufferToBase64(await selectedFile.arrayBuffer())");
    expect(meetingIntelligencePage).toContain("import { CompactList }");
    expect(meetingIntelligencePage).toContain(
      '<CompactList className="meeting-intake-list">',
    );
    expect(meetingIntelligencePage).toContain(
      'className="meeting-intake-row"',
    );
    expect(meetingIntelligencePage).not.toContain(
      '<div className="compact-list meeting-intake-list">',
    );

    expect(meetingIntelligenceReview).toContain("import { ActionGroup }");
    expect(meetingIntelligenceReview).toContain(
      'import { CompactList, CompactListItem } from "@/components/compact-list";',
    );
    expect(meetingIntelligenceReview).toContain("import { EmptyState }");
    expect(meetingIntelligenceReview).toContain("import { PanelTitleRow }");
    expect(meetingIntelligenceReview).toContain("sourceMetadataDetails");
    expect(meetingIntelligenceReview).toContain("conversion: ${conversionDisplay(metadata.conversionMode)}");
    for (const titleRow of [
      'title="Meeting Log"',
      'title="Matches and Warnings"',
      'title="Proposed Notes"',
      'title="Relationship Memory Updates"',
      'title="Follow-Ups"',
      'title="Normalized Markdown"',
      'title="Apply Summary"',
      'title="Applied Updates"',
    ]) {
      expect(meetingIntelligenceReview).toContain(titleRow);
    }
    expect(meetingIntelligenceReview).toContain('import { Badge } from "@/components/badge"');
    expect(meetingIntelligenceReview).toContain('import { CountBadge } from "@/components/count-badge"');
    expect(meetingIntelligenceReview).toContain("meetingReviewWarningCount(draft)");
    expect(meetingIntelligenceReview).toContain("ReviewOrientationSummary");
    expect(meetingIntelligenceReview).toContain('aria-label="Meeting Intelligence review summary"');
    expect(meetingIntelligenceReview).toContain("Editable proposals only until you apply.");
    expect(meetingIntelligenceReview).toContain("meeting-review-section");
    expect(meetingIntelligenceReview).toContain("meeting-match-review-list");
    expect(meetingIntelligenceReview).toContain("No match signals found");
    expect(meetingIntelligenceReview).toContain("UnmatchedEntityActions");
    expect(meetingIntelligenceReview).toContain("unmatchedEntityActions(entity)");
    expect(meetingIntelligenceReview).toContain("Create contact");
    expect(meetingIntelligenceReview).toContain("Create organization");
    expect(meetingIntelligenceReview).toContain("Create deal");
    expect(meetingIntelligenceReview).toContain("Create lead");
    expect(meetingIntelligenceReview).toContain("Search CRM");
    expect(meetingIntelligenceReview).toContain("for unmatched meeting mention");
    expect(globalStyles).toContain(".meeting-unmatched-actions");
    expect(meetingIntelligenceReview).toContain("meeting-proposal-evidence");
    expect(meetingIntelligenceReview).toContain("Structured summary");
    expect(meetingIntelligenceReview).toContain("section.evidenceType === \"explicit\"");
    expect(meetingIntelligenceReview).toContain("{selectedUpdateCount} selected");
    expect(meetingIntelligenceReview).toContain("Review-first safety");
    expect(meetingIntelligenceReview).toContain("Nothing is written to notes, activities, associations, or Relationship Memory fields");
    expect(meetingIntelligenceReview).toContain("relationship-memory-review-summary");
    expect(meetingIntelligenceReview).toContain("Contact Relationship Memory");
    expect(meetingIntelligenceReview).toContain("Separate from notes");
    expect(meetingIntelligenceReview).toContain("Company, deal, lead, and raw timeline facts stay in Proposed Notes");
    expect(meetingIntelligenceReview).toContain("relationship-memory-review-field-heading");
    expect(meetingIntelligenceReview).toContain("relationship-memory-fact-review-header");
    expect(meetingIntelligenceReview).toContain("Will update memory");
    expect(meetingIntelligenceReview).toContain("Excluded");
    expect(meetingIntelligenceReview).toContain("submitActionLabel=\"Apply reviewed Meeting Intelligence updates\"");
    expect(meetingIntelligenceReview).toContain("Created updates are linked below. Skipped items did not mutate CRM data.");
    expect(meetingIntelligenceReview).toContain("meeting-apply-success");
    expect(globalStyles).toContain(".meeting-review-item");
    expect(globalStyles).toContain(".meeting-review-item-header");
    expect(globalStyles).toContain(".meeting-review-item-header > *");
    expect(globalStyles).toContain(".meeting-intake-upload-capabilities");
    expect(globalStyles).toContain(".meeting-upload-capability-card");
    expect(globalStyles).toContain(".meeting-review-overview");
    expect(globalStyles).toContain(".relationship-memory-review-summary");
    expect(globalStyles).toContain(".relationship-memory-review-field-heading");
    expect(globalStyles).toContain(".relationship-memory-fact-review-header");
    expect(globalStyles).toContain(".meeting-match-review-list > .compact-list-item");
    expect(globalStyles).toContain(".meeting-processor-status-item");
    expect(globalStyles).toContain(".meeting-intake-row,");
    expect(globalStyles).toContain("min-width: 0;");
    expect(meetingIntelligenceReview).toContain("Source preview");
    expect(meetingIntelligenceReview).toContain(
      'aria-labelledby="applied-updates-heading"',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<h2 className="panel-title" id="meeting-proposal-heading">',
    );
    expect(meetingIntelligenceReview).toContain("<CompactList>");
    expect(meetingIntelligenceReview).toContain("<CompactListItem>");
    expect(meetingIntelligenceReview).toContain("<CompactListItem key=");
    expect(meetingIntelligenceReview).toContain("import { CompactTitleRow }");
    expect(meetingIntelligenceReview).toContain('<CompactTitleRow title="Skipped" />');
    expect(meetingIntelligenceReview).not.toContain(
      '<h3 className="panel-title">Skipped</h3>',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<div className="compact-list">',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<div className="compact-list-item"',
    );
    expect(compactList).toContain("export function CompactList");
    expect(compactList).toContain("export function CompactListItem");
    expect(compactList).toContain('as?: "div" | "ul"');
    expect(compactList).toContain('as?: "div" | "li"');
    expect(compactList).toContain('"compact-list"');
    expect(compactList).toContain('"compact-list-item"');
    expect(meetingIntelligenceReview).toContain(
      'const createAnotherActionsLabel = "Applied meeting intake actions";',
    );
    expect(meetingIntelligenceReview).toContain(
      'const createAnotherActionLabel = "Create another meeting intelligence intake";',
    );
    expect(meetingIntelligenceReview).toContain(
      '<ActionGroup className="form-actions" label={createAnotherActionsLabel}>',
    );
    expect(meetingIntelligenceReview).toContain(
      "aria-label={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceReview).toContain(
      "title={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<div className="form-actions">',
    );
    expect(meetingIntelligenceDetailPage).toContain('intake.status === "DRAFT"');
    expect(meetingIntelligenceDetailPage).toContain('title="Upload waiting to finish"');
    expect(meetingIntelligenceDetailPage).toContain(
      "waiting for direct or multipart file upload completion",
    );
    expect(meetingIntelligenceDetailPage).toContain("Back to intake form");
    for (const emptyTitle of [
      'title="No meeting activity proposed"',
      'title="No notes proposed"',
      'title="No relationship memory updates proposed"',
      'title="No follow-ups proposed"',
      'title="No CRM updates created"',
    ]) {
      expect(meetingIntelligenceReview).toContain(emptyTitle);
    }
    expect(meetingIntelligenceReview).toContain("relationshipBriefUpdates.map");
    expect(meetingIntelligenceReview).toContain("relationshipTargetOptions(options)");
    expect(meetingIntelligenceReview).toContain("parseRelationshipTarget");
    expect(meetingIntelligenceReview).toContain("relationshipFactDrafts");
    expect(meetingIntelligenceReview).toContain("selectedRelationshipTargets");
    expect(meetingIntelligenceReview).toContain("relationshipBriefTargetStates");
    expect(meetingIntelligenceReview).toContain("loadRelationshipTargetBrief");
    expect(meetingIntelligenceReview).toContain("/api/v1/workspaces/${workspaceId}/people/${target.id}");
    expect(meetingIntelligenceReview).toContain("relationshipBriefFieldsFromPersonResponse");
    expect(meetingIntelligenceReview).toContain("reconcileRelationshipFactsForExisting");
    expect(meetingIntelligenceReview).toContain("relationshipBriefPreviewBlocked");
    expect(meetingIntelligenceReview).toContain("Wait for the selected contact Relationship Memory preview to load");
    expect(meetingIntelligenceReview).toContain("relationshipFactsForReview");
    expect(meetingIntelligenceReview).toContain("relationshipProposedFieldsFromReviewFacts");
    expect(meetingIntelligenceReview).toContain("relationshipMergedPreviewFromFacts");
    expect(meetingIntelligenceReview).toContain("relationshipExistingPreviewText");
    expect(meetingIntelligenceReview).toContain("relationshipAfterApplyPreviewText");
    expect(meetingIntelligenceReview).toContain("Loading target Relationship Memory");
    expect(meetingIntelligenceReview).toContain("Could not load the selected contact Relationship Memory");
    expect(meetingIntelligenceReview).toContain("relationship.${index}.fact.${factIndex}.include");
    expect(meetingIntelligenceReview).toContain("relationship.${index}.fact.${factIndex}.text");
    expect(meetingIntelligenceReview).toContain("relationship.${index}.fact.${factIndex}.field");
    expect(meetingIntelligenceReview).toContain("Existing");
    expect(meetingIntelligenceReview).toContain("Proposed facts");
    expect(meetingIntelligenceReview).toContain("After apply");
    expect(meetingIntelligenceReview).toContain("Likely duplicate");
    expect(meetingIntelligenceReview).toContain("staleWarning");
    expect(meetingIntelligenceReview).toContain("Include fact");
    expect(meetingIntelligenceReview).toContain("No proposed facts for this field.");
    expect(meetingIntelligenceReview).toContain("RelationshipBriefGuidance");
    expect(meetingIntelligenceReview).toContain("RelationshipBriefFactGuidance");
    expect(meetingIntelligenceReview).toContain("Provider:");
    expect(meetingIntelligenceReview).toContain("Safe personalization");
    expect(meetingIntelligenceReview).toContain("Use cautiously");
    expect(meetingIntelligenceReview).toContain("Do not mention directly");
    expect(meetingIntelligenceReview).toContain("relationshipBriefUsageItems");
    expect(meetingIntelligenceReview).toContain("const relationshipBriefSections = relationshipBriefUsageItems()");
    expect(meetingIntelligenceReview).toContain("Relationship Memory updated");
    expect(meetingIntelligenceReview).toContain("Relationship Memory Changes");
    expect(meetingIntelligenceReview).toContain("result.relationshipBriefChanges");
    expect(meetingIntelligenceReview).toContain("relationshipBriefChangeSourceLabel");
    expect(meetingIntelligenceReview).toContain("relationshipBriefChangeExcerpt");
    expect(meetingIntelligenceReview).toContain("accepted facts");
    expect(meetingIntelligenceReview).toContain(
      'className="empty-state-compact empty-state-panel"',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<p className="muted">No notes are proposed.</p>',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<p className="muted">No next-step activities are proposed.</p>',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<p className="muted">No CRM updates were created.</p>',
    );

    expect(meetingIntelligenceDetailPage).toContain("import { ActionGroup }");
    expect(meetingIntelligenceDetailPage).toContain("import { CompactList, CompactListItem }");
    expect(meetingIntelligenceDetailPage).toContain("import { EmptyState }");
    expect(meetingIntelligenceDetailPage).toContain(
      'const failedActionsLabel = "Failed meeting intake actions";',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      '<ActionGroup className="form-actions" label={failedActionsLabel}>',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      "aria-label={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceDetailPage).toContain(
      "title={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceDetailPage).not.toContain(
      '<div className="form-actions">',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      '<EmptyState',
    );
    expect(meetingIntelligenceDetailPage).toContain("Provider boundary");
    expect(meetingIntelligenceDetailPage).toContain("Required provider");
    expect(meetingIntelligenceDetailPage).toContain("Provider-required conversion");
    expect(meetingIntelligenceDetailPage).toContain('title="Extraction queued"');
    expect(meetingIntelligenceDetailPage).toContain("Status message");
    expect(meetingIntelligenceDetailPage).toContain("meeting-processing-state");
    expect(meetingIntelligenceDetailPage).toContain("Intake could not be processed");
    expect(meetingIntelligenceDetailPage).toContain("No CRM records were changed");
    expect(meetingIntelligenceDetailPage).toContain("meeting-processor-status-list");
    expect(meetingIntelligenceDetailPage).toContain("meeting-processor-status-item");
    expect(meetingIntelligenceDetailPage).toContain(
      'className="empty-state-compact"',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      'title="No reviewable proposal yet"',
    );
    expect(meetingIntelligenceDetailPage).not.toContain(
      '<p className="muted">This intake does not have a reviewable proposal yet.</p>',
    );
    expect(meetingIntelligenceService).toContain("meetingIntelligenceActivityDescription");
    expect(meetingIntelligenceService).toContain("Source: Meeting Intelligence ${label}.");
    expect(currentStatus).toContain("Meeting Intelligence-created follow-up activities carry an explicit source line");
    expect(currentStatus).toContain("do not create `EmailLogActivityLink` rows unless the follow-up originated from an email review");
    expect(architecture).toContain("Approved Meeting Intelligence meeting logs and next-step follow-ups are ordinary `Activity` rows");
    expect(architecture).toContain("next-step follow-ups keep source context in the activity description");
  });
});
