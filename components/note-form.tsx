"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type NoteFormProps = {
  workspaceId: string;
  attachment: NoteAttachment;
};

type NoteAttachment =
  | { dealId: string }
  | { leadId: string }
  | { personId: string }
  | { organizationId: string };

export function NoteForm({ workspaceId, attachment }: NoteFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!body.trim()) {
      setError("Add note content before saving.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...attachment,
        body: body.trim()
      })
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not add the note.");
      setIsSaving(false);
      return;
    }

    setBody("");
    setIsSaving(false);
    router.refresh();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      <label className="form-field">
        <span>Internal note</span>
        <textarea
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a plain-text note for your team."
          required
          rows={4}
          value={body}
        />
      </label>
      <div className="form-actions">
        <button className="button-primary" disabled={isSaving || !body.trim()} type="submit">
          {isSaving ? "Saving..." : "Save note"}
        </button>
      </div>
    </form>
  );
}
