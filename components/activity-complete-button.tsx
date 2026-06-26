"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ActivityCompleteButtonProps = {
  workspaceId: string;
  activityId: string;
  inline?: boolean;
};

export function ActivityCompleteButton({ workspaceId, activityId, inline = false }: ActivityCompleteButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function completeActivity() {
    setError(null);
    setIsSaving(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/activities/${activityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completedAt: new Date().toISOString() })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not complete the activity.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  const content = (
    <>
      <button className="button-secondary button-compact" disabled={isSaving} onClick={completeActivity} type="button">
        {isSaving ? "Saving..." : "Mark complete"}
      </button>
      {error ? <p className="form-error compact-error">{error}</p> : null}
    </>
  );

  if (inline) return content;

  return (
    <div className="activity-actions">
      {content}
    </div>
  );
}
