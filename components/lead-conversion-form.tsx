"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { LockedPanelNotice } from "@/components/locked-panel-notice";

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
    return <LockedPanelNotice title="Lead converted">This lead has already been converted.</LockedPanelNotice>;
  }

  if (pipelines.length === 0) {
    return (
      <EmptyState
        className="empty-state-compact empty-state-panel lead-conversion-empty"
        title="No pipeline available"
        description="Create or seed a pipeline before converting leads."
      />
    );
  }

  if (!selectedPipeline || selectedPipeline.stages.length === 0) {
    return (
      <EmptyState
        className="empty-state-compact empty-state-panel lead-conversion-empty"
        title="No stage available"
        description="Choose a pipeline with at least one stage before converting this lead."
      />
    );
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <label className="form-field">
        <FormFieldLabel required>Pipeline</FormFieldLabel>
        <select onChange={(event) => setPipelineId(event.target.value)} value={pipelineId}>
          {pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>
              {pipeline.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <FormFieldLabel required>Stage</FormFieldLabel>
        <select onChange={(event) => setStageId(event.target.value)} value={stageId}>
          {selectedPipeline.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <FormFieldLabel>Deal title</FormFieldLabel>
        <input
          onChange={(event) => setTitle(event.target.value)}
          placeholder={leadTitle}
          value={title}
        />
      </label>
      <FormActionBar
        disabledHint="Choose a pipeline and stage before converting this lead."
        isSaving={isSaving}
        pendingLabel="Converting..."
        submitDisabled={!pipelineId || !stageId}
        submitLabel="Convert to deal"
      />
    </form>
  );
}
