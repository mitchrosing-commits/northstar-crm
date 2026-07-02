import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { ActionGroup } from "@/components/action-group";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { MeetingIntelligenceReview } from "@/components/meeting-intelligence-review";
import { PageHeader } from "@/components/page-header";
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
        <section className="panel">
          <FormErrorMessage>{intake.errorMessage ?? "Meeting intake failed."}</FormErrorMessage>
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
      ) : draft ? (
        <MeetingIntelligenceReview
          applyResult={applyResult}
          draft={draft}
          intakeId={intake.id}
          options={options}
          status={intake.status}
          workspaceId={workspace.id}
        />
      ) : (
        <section className="panel">
          <EmptyState
            className="empty-state-compact"
            description="This intake does not have a reviewable proposal yet. Try refreshing after processing finishes, or create another intake if the source text was empty."
            title="No reviewable proposal yet"
          />
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

function sourceTypeLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
