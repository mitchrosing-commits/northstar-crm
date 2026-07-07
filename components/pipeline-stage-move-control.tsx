"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type StageOption = {
  id: string;
  name: string;
};

type PipelineStageMoveControlProps = {
  currentStageId: string;
  dealId: string;
  dealTitle: string;
  pipelineId: string;
  stages: StageOption[];
  status: string;
  workspaceId: string;
};

export function PipelineStageMoveControl({
  currentStageId,
  dealId,
  dealTitle,
  pipelineId,
  stages,
  status,
  workspaceId
}: PipelineStageMoveControlProps) {
  const router = useRouter();
  const [stageId, setStageId] = useState(currentStageId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canMove = status === "OPEN" && stages.length > 1;
  const selectedStage = useMemo(() => stages.find((stage) => stage.id === stageId), [stageId, stages]);
  const unchanged = stageId === currentStageId;
  const selectedStageRequiresCloseOutcome = Boolean(selectedStage && isCloseStageName(selectedStage.name));
  const helperId = `pipeline-move-${dealId}-helper`;
  const selectLabel = `Choose a new stage for ${dealTitle}`;
  const moveActionLabel = isSaving ? `Moving ${dealTitle}` : `Move ${dealTitle} to ${selectedStage?.name ?? "selected stage"}`;
  const disabledReason = pipelineMoveDisabledReason({
    canMove,
    isSaving,
    selectedStageRequiresCloseOutcome,
    status,
    stages,
    unchanged
  });
  const moveTitle = disabledReason ? `${moveActionLabel}: ${disabledReason}` : moveActionLabel;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!selectedStage || unchanged || !canMove || selectedStageRequiresCloseOutcome) return;

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineId, stageId: selectedStage.id })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not move this deal.");
      setIsSaving(false);
      return;
    }

    router.refresh();
    setIsSaving(false);
  }

  return (
    <form className="pipeline-card-move" onSubmit={onSubmit}>
      <label className="pipeline-card-move-label" htmlFor={`pipeline-move-${dealId}`}>
        Move
      </label>
      <select
        aria-describedby={helperId}
        aria-label={selectLabel}
        disabled={!canMove || isSaving}
        id={`pipeline-move-${dealId}`}
        onChange={(event) => setStageId(event.target.value)}
        title={selectLabel}
        value={stageId}
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </select>
      <button
        aria-describedby={disabledReason ? helperId : undefined}
        aria-label={moveActionLabel}
        className="button-secondary button-compact"
        disabled={!canMove || unchanged || isSaving || selectedStageRequiresCloseOutcome}
        title={moveTitle}
        type="submit"
      >
        {isSaving ? "Moving..." : "Move"}
      </button>
      <span className={disabledReason ? "pipeline-card-move-guidance" : "sr-only"} id={helperId}>
        {disabledReason ?? `Move ${dealTitle} from its current stage to ${selectedStage?.name ?? "the selected stage"}.`}
      </span>
      {error ? <p className="pipeline-card-move-error">{error}</p> : null}
    </form>
  );
}

function pipelineMoveDisabledReason({
  canMove,
  isSaving,
  selectedStageRequiresCloseOutcome,
  status,
  stages,
  unchanged
}: {
  canMove: boolean;
  isSaving: boolean;
  selectedStageRequiresCloseOutcome: boolean;
  status: string;
  stages: StageOption[];
  unchanged: boolean;
}) {
  if (isSaving) return "Stage move is in progress.";
  if (status !== "OPEN") return "Closed deals cannot be moved from the pipeline board.";
  if (stages.length <= 1) return "Add another stage before moving deals on the board.";
  if (selectedStageRequiresCloseOutcome) return "Open the deal and use Mark won or Mark lost to close it intentionally.";
  if (!canMove) return "This deal cannot be moved from the pipeline board.";
  if (unchanged) return "Choose a different stage before moving this deal.";
  return null;
}

function isCloseStageName(name: string) {
  return /\bclosed?\b/i.test(name.trim());
}
