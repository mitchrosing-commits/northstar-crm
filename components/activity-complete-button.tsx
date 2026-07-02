"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { FormErrorMessage } from "@/components/form-error-message";

type ActivityCompleteButtonProps = {
  workspaceId: string;
  activityId: string;
  inline?: boolean;
  ariaLabel?: string;
};

export function ActivityCompleteButton({ workspaceId, activityId, inline = false, ariaLabel }: ActivityCompleteButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const actionsLabel = "Complete activity actions";

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
      <button
        aria-label={ariaLabel}
        className="button-secondary button-compact"
        disabled={isSaving}
        onClick={completeActivity}
        title={ariaLabel}
        type="button"
      >
        {isSaving ? "Saving..." : "Mark complete"}
      </button>
      {error ? <FormErrorMessage compact>{error}</FormErrorMessage> : null}
    </>
  );

  if (inline) return content;

  return (
    <ActionGroup className="activity-actions" label={actionsLabel}>
      {content}
    </ActionGroup>
  );
}
