"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

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
  const [isSaving, setIsSaving] = useState(false);
  const hasStages = stages.length > 0;
  const selectedStage = useMemo(() => stages.find((stage) => stage.id === stageId), [stageId, stages]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!selectedStage) {
      setError("Choose a valid stage in this pipeline.");
      return;
    }

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

    router.refresh();
  }

  if (!hasStages) {
    return <p className="empty-copy">No stages are available in this pipeline.</p>;
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      <label className="form-field">
        <span>Move to stage</span>
        <select onChange={(event) => setStageId(event.target.value)} value={stageId}>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <button className="button-primary" disabled={isSaving || stageId === currentStageId} type="submit">
        {isSaving ? "Moving..." : "Move deal"}
      </button>
    </form>
  );
}
