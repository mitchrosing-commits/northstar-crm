"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormErrorMessage } from "@/components/form-error-message";

type ActivityDeleteButtonProps = {
  activityId: string;
  workspaceId: string;
  ariaLabel?: string;
};

export function ActivityDeleteButton({ activityId, workspaceId, ariaLabel }: ActivityDeleteButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteActivity() {
    if (!window.confirm("Remove this activity?")) return;

    setError(null);
    setIsDeleting(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/activities/${activityId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not remove the activity.");
      setIsDeleting(false);
      return;
    }

    setIsDeleting(false);
    router.refresh();
  }

  return (
    <>
      <button
        aria-label={ariaLabel}
        className="button-secondary button-compact"
        disabled={isDeleting}
        onClick={deleteActivity}
        title={ariaLabel}
        type="button"
      >
        {isDeleting ? "Removing..." : "Remove"}
      </button>
      {error ? <FormErrorMessage compact>{error}</FormErrorMessage> : null}
    </>
  );
}
