"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";

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
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

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
    setSuccess("Note saved. Recent notes refreshed.");
    setIsSaving(false);
    router.replace(currentPathWithHash("notes"), { scroll: true });
    router.refresh();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {success ? <FormSuccessMessage compact>{success}</FormSuccessMessage> : null}
      <label className="form-field">
        <FormFieldLabel required>Internal note</FormFieldLabel>
        <textarea
          onChange={(event) => {
            setSuccess(null);
            setBody(event.target.value);
          }}
          placeholder="Add a plain-text note for your team."
          required
          rows={4}
          value={body}
        />
      </label>
      <FormActionBar
        disabledHint="Write a note before saving."
        isSaving={isSaving}
        submitDisabled={!body.trim()}
        submitLabel="Save note"
      />
    </form>
  );
}

function currentPathWithHash(hash: string) {
  return `${window.location.pathname}${window.location.search}#${hash}` as Route;
}
