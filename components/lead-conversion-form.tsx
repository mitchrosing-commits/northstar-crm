"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

type PipelineOption = {
  id: string;
  name: string;
  stages: Array<{
    id: string;
    name: string;
  }>;
};

type LeadConversionFormProps = {
  workspaceId: string;
  leadId: string;
  leadTitle: string;
  leadStatus: string;
  pipelines: PipelineOption[];
};

export function LeadConversionForm({
  workspaceId,
  leadId,
  leadTitle,
  leadStatus,
  pipelines
}: LeadConversionFormProps) {
  const router = useRouter();
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? "");
  const selectedPipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === pipelineId),
    [pipelineId, pipelines]
  );
  const [stageId, setStageId] = useState(selectedPipeline?.stages[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setStageId(selectedPipeline?.stages[0]?.id ?? "");
  }, [selectedPipeline]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!pipelineId || !stageId) {
      setError("Choose a pipeline and stage before converting this lead.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/leads/${leadId}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pipelineId,
        stageId,
        title: title.trim() || null
      })
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not convert this lead.");
      setIsSaving(false);
      return;
    }

    const deal = await response.json();
    router.push(`/deals/${deal.id}`);
    router.refresh();
  }

  if (leadStatus === "CONVERTED") {
    return <p className="empty-copy">This lead has already been converted.</p>;
  }

  if (pipelines.length === 0) {
    return <p className="empty-copy">Create or seed a pipeline before converting leads.</p>;
  }

  if (!selectedPipeline || selectedPipeline.stages.length === 0) {
    return <p className="empty-copy">Choose a pipeline with at least one stage before converting this lead.</p>;
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      <label className="form-field">
        <span>Pipeline</span>
        <select onChange={(event) => setPipelineId(event.target.value)} value={pipelineId}>
          {pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Stage</span>
        <select onChange={(event) => setStageId(event.target.value)} value={stageId}>
          {selectedPipeline.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>Deal title</span>
        <input
          onChange={(event) => setTitle(event.target.value)}
          placeholder={leadTitle}
          value={title}
        />
      </label>
      <div className="form-actions">
        <button className="button-primary" disabled={isSaving || !pipelineId || !stageId} type="submit">
          {isSaving ? "Converting..." : "Convert to deal"}
        </button>
      </div>
    </form>
  );
}
