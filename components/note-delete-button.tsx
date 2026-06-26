"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type NoteDeleteButtonProps = {
  noteId: string;
  workspaceId: string;
};

export function NoteDeleteButton({ noteId, workspaceId }: NoteDeleteButtonProps) {
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
      <button className="button-secondary button-compact" disabled={isDeleting} onClick={deleteNote} type="button">
        {isDeleting ? "Removing..." : "Remove"}
      </button>
      {error ? <p className="form-error compact-error">{error}</p> : null}
    </>
  );
}
