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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!selectedStage || unchanged || !canMove) return;

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
        aria-label={`Move ${dealTitle} to stage`}
        disabled={!canMove || isSaving}
        id={`pipeline-move-${dealId}`}
        onChange={(event) => setStageId(event.target.value)}
        value={stageId}
      >
        {stages.map((stage) => (
          <option key={stage.id} value={stage.id}>
            {stage.name}
          </option>
        ))}
      </select>
      <button className="button-secondary button-compact" disabled={!canMove || unchanged || isSaving} type="submit">
        {isSaving ? "Moving..." : "Move"}
      </button>
      {error ? <p className="pipeline-card-move-error">{error}</p> : null}
    </form>
  );
}
