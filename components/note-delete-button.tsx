"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormErrorMessage } from "@/components/form-error-message";

type NoteDeleteButtonProps = {
  ariaLabel?: string;
  noteId: string;
  workspaceId: string;
};

export function NoteDeleteButton({ ariaLabel, noteId, workspaceId }: NoteDeleteButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteNote() {
    if (!window.confirm("Remove this note?")) return;

    setError(null);
    setIsDeleting(true);

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/notes/${noteId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not remove the note.");
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
        onClick={deleteNote}
        title={ariaLabel}
        type="button"
      >
        {isDeleting ? "Removing..." : "Remove"}
      </button>
      {error ? <FormErrorMessage compact>{error}</FormErrorMessage> : null}
    </>
  );
}
