import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { ActionGroup } from "@/components/action-group";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CompactList, CompactListItem } from "@/components/compact-list";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { MeetingIntelligenceReview } from "@/components/meeting-intelligence-review";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatusBadge } from "@/components/status-badge";
import type { ApplyMeetingIntelligenceResult, MeetingIntelligenceDraft } from "@/lib/meeting-intelligence/types";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getMeetingIntake, getMeetingIntelligenceOptions } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ intakeId: string }>;
};

export default async function MeetingIntelligenceDetailPage({ params }: PageProps) {
  const { intakeId } = await params;
  const { workspace, actorUserId } = await getCurrentWorkspaceContext();
  const actor = { workspaceId: workspace.id, actorUserId };
  const [intake, options] = await Promise.all([getMeetingIntake(actor, intakeId), getMeetingIntelligenceOptions(actor)]);
  const failedActionsLabel = "Failed meeting intake actions";
  const createAnotherActionLabel = "Create another meeting intelligence intake";

  if (!intake) notFound();
  const draft = parseDraft(intake.proposedChangesJson);
  const applyResult = parseApplyResult(intake.applyResultJson);
  const analysis = parseAnalysis(intake.analysisJson);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Meeting intelligence"
        subtitle={intake.originalFilename ?? sourceTypeLabel(intake.sourceType)}
        title="Review Intake"
      >
        <StatusBadge status={intake.status.replaceAll("_", " ")} />
      </PageHeader>

      {intake.status === "FAILED" ? (
        <section className="panel meeting-processing-state" aria-labelledby="meeting-intake-failed-heading">
          <PanelTitleRow
            description="No CRM records were changed. Fix the source/provider issue, then create a new intake."
            title="Intake could not be processed"
            titleId="meeting-intake-failed-heading"
          />
          <FormErrorMessage>{intake.errorMessage ?? "Meeting intake failed."}</FormErrorMessage>
          <ProcessorStatusList processorStatus={analysis?.processorStatus} />
          <ActionGroup className="form-actions" label={failedActionsLabel}>
            <Link
              aria-label={createAnotherActionLabel}
              className="button-primary"
              href={"/meeting-intelligence" as Route}
              title={createAnotherActionLabel}
            >
              Create another intake
            </Link>
          </ActionGroup>
        </section>
      ) : intake.status === "DRAFT" ? (
        <section className="panel meeting-processing-state" aria-labelledby="meeting-upload-waiting-heading">
          <EmptyState
            className="empty-state-compact"
            description="This upload session is waiting for direct or multipart file upload completion. Return to the intake form to resume or cancel an interrupted upload before analysis can start."
            title="Upload waiting to finish"
            titleId="meeting-upload-waiting-heading"
          />
          <ProcessorStatusList processorStatus={analysis?.processorStatus} />
          <ActionGroup className="form-actions" label="Draft upload session actions">
            <Link
              aria-label={createAnotherActionLabel}
              className="button-primary"
              href={"/meeting-intelligence" as Route}
              title={createAnotherActionLabel}
            >
              Back to intake form
            </Link>
          </ActionGroup>
        </section>
      ) : draft ? (
        <MeetingIntelligenceReview
          applyResult={applyResult}
          draft={draft}
          intakeId={intake.id}
          options={options}
          status={intake.status}
          workspaceId={workspace.id}
        />
      ) : intake.status === "EXTRACTING" ? (
        <section className="panel meeting-processing-state" aria-labelledby="meeting-extraction-queued-heading">
          <EmptyState
            className="empty-state-compact"
            description="This intake is waiting for provider extraction. Run the background worker to process queued extraction jobs, then refresh this page."
            title="Extraction queued"
            titleId="meeting-extraction-queued-heading"
          />
          <ProcessorStatusList processorStatus={analysis?.processorStatus} />
        </section>
      ) : (
        <section className="panel meeting-processing-state" aria-labelledby="meeting-no-proposal-heading">
          <EmptyState
            className="empty-state-compact"
            description="This intake does not have a reviewable proposal yet. Try refreshing after processing finishes, or create another intake if the source text was empty."
            title="No reviewable proposal yet"
            titleId="meeting-no-proposal-heading"
          />
          <ProcessorStatusList processorStatus={analysis?.processorStatus} />
        </section>
      )}
    </AppShell>
  );
}

function parseDraft(value: unknown): MeetingIntelligenceDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as MeetingIntelligenceDraft;
}

function parseApplyResult(value: unknown): ApplyMeetingIntelligenceResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as ApplyMeetingIntelligenceResult;
}

type IntakeAnalysisJson = {
  processorStatus?: {
    capability?: string;
    conversionMode?: string;
    extractionMethod?: string;
    failureCode?: string;
    message?: string;
    originalFilename?: string;
    originalMimeType?: string;
    requiredProvider?: string;
    sourceType?: string;
    warnings?: string[];
  };
};

function parseAnalysis(value: unknown): IntakeAnalysisJson | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as IntakeAnalysisJson;
}

function ProcessorStatusList({ processorStatus }: { processorStatus?: IntakeAnalysisJson["processorStatus"] }) {
  if (!processorStatus) return null;
  return (
    <CompactList className="meeting-processor-status-list">
      <CompactListItem className="meeting-processor-status-item">
        <strong>{processorStatus.capability === "provider_required" ? "Provider boundary" : "Source details"}</strong>
        <span className="muted">
          {[processorStatus.sourceType ? sourceTypeLabel(processorStatus.sourceType) : null, processorStatus.originalFilename, processorStatus.originalMimeType]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </CompactListItem>
      <CompactListItem className="meeting-processor-status-item">
        <strong>Processor status</strong>
        <span className="muted">
          {[capabilityLabel(processorStatus.capability), conversionLabel(processorStatus.conversionMode), processorStatus.extractionMethod]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </CompactListItem>
      {processorStatus.requiredProvider ? (
        <CompactListItem className="meeting-processor-status-item">
          <strong>Required provider</strong>
          <span className="muted">{providerLabel(processorStatus.requiredProvider)}</span>
        </CompactListItem>
      ) : null}
      {processorStatus.failureCode ? (
        <CompactListItem className="meeting-processor-status-item">
          <strong>Failure code</strong>
          <span className="muted">{processorStatus.failureCode}</span>
        </CompactListItem>
      ) : null}
      {processorStatus.message ? (
        <CompactListItem className="meeting-processor-status-item">
          <strong>Status message</strong>
          <span className="muted">{processorStatus.message}</span>
        </CompactListItem>
      ) : null}
      {processorStatus.warnings?.map((warning) => (
        <CompactListItem className="meeting-processor-status-item" key={warning}>
          <Badge>{warning}</Badge>
        </CompactListItem>
      ))}
    </CompactList>
  );
}

function sourceTypeLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function capabilityLabel(value: string | undefined) {
  if (value === "provider_required") return "Provider required";
  if (value === "supported") return "Supported";
  if (value === "unsupported") return "Unsupported";
  if (value === "deferred") return "Deferred";
  return value;
}

function conversionLabel(value: string | undefined) {
  if (value === "local") return "Local conversion";
  if (value === "provider_required") return "Provider-required conversion";
  if (value === "unsupported") return "Unsupported conversion";
  return value;
}

function providerLabel(value: string) {
  if (value === "ocr_or_vision") return "OCR or vision provider";
  if (value === "transcription") return "Transcription provider";
  if (value === "media_processing") return "Media processing or transcription provider";
  if (value === "document_conversion") return "Document conversion to DOCX or text";
  return value;
}
