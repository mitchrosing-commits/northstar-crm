"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";

type StageOption = {
  id: string;
  name: string;
};

type DealStageMoveFormProps = {
  workspaceId: string;
  dealId: string;
  pipelineId: string;
  currentStageId: string;
  stages: StageOption[];
};

export function DealStageMoveForm({
  workspaceId,
  dealId,
  pipelineId,
  currentStageId,
  stages
}: DealStageMoveFormProps) {
  const router = useRouter();
  const [stageId, setStageId] = useState(currentStageId);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const hasStages = stages.length > 0;
  const selectedStage = useMemo(() => stages.find((stage) => stage.id === stageId), [stageId, stages]);
  const selectedStageRequiresCloseOutcome = Boolean(selectedStage && isCloseStageName(selectedStage.name));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedStage) {
      setError("Choose a valid stage in this pipeline.");
      return;
    }
    if (selectedStageRequiresCloseOutcome) {
      setError("Use Mark won or Mark lost to close this deal intentionally.");
      return;
    }
    const movedStageName = selectedStage.name;

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId,
        stageId: selectedStage.id
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not move this deal.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    setSuccess(`Deal moved to ${movedStageName}.`);
    router.replace(currentPathWithHash("overview"), { scroll: true });
    router.refresh();
  }

  if (!hasStages) {
    return (
      <EmptyState
        className="empty-state-compact empty-state-panel deal-stage-empty"
        title="No stages available"
        description="No stages are available in this pipeline."
      />
    );
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {success ? <FormSuccessMessage compact>{success}</FormSuccessMessage> : null}
      <label className="form-field">
        <FormFieldLabel required>Move to stage</FormFieldLabel>
        <select onChange={(event) => setStageId(event.target.value)} value={stageId}>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      {selectedStageRequiresCloseOutcome ? (
        <p className="form-hint form-hint-info">
          Closing a deal requires an outcome. Use Mark won or Mark lost so the pipeline status stays clear.
        </p>
      ) : null}
      <FormActionBar
        disabledHint={
          selectedStageRequiresCloseOutcome
            ? "Use Mark won or Mark lost to close this deal intentionally."
            : "Choose a different stage before moving this deal."
        }
        isSaving={isSaving}
        pendingLabel="Moving..."
        submitDisabled={stageId === currentStageId || selectedStageRequiresCloseOutcome}
        submitLabel="Move deal"
      />
    </form>
  );
}

function isCloseStageName(name: string) {
  return /\bclosed?\b/i.test(name.trim());
}

function currentPathWithHash(hash: string) {
  return `${window.location.pathname}${window.location.search}#${hash}` as Route;
}
