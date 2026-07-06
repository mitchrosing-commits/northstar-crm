"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState, useState } from "react";

import { createEmailFollowUpActivityAction, type CreateEmailFollowUpActionState } from "@/app/email/actions";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import type { EmailFollowUpDraft } from "@/lib/services/email-follow-up-service";

type EmailFollowUpPanelProps = {
  draft: EmailFollowUpDraft;
  subject: string;
};

const initialState: CreateEmailFollowUpActionState = {};
const disclosureLabel = "Create follow-up activity from this email";

export function EmailFollowUpPanel({ draft, subject }: EmailFollowUpPanelProps) {
  const [state, formAction, isPending] = useActionState(createEmailFollowUpActivityAction, initialState);
  const [title, setTitle] = useState(draft.title);
  const [type, setType] = useState(draft.type);
  const [dueAt, setDueAt] = useState(draft.dueAt);
  const [description, setDescription] = useState(draft.description);
  const stateApplies = state.emailLogId === draft.emailLogId;
  const actionLabel = `Create reviewed follow-up activity from email ${subject}`;

  return (
    <details aria-label={disclosureLabel} className="email-draft-panel email-follow-up-panel" title={disclosureLabel}>
      <summary title={disclosureLabel}>Create follow-up</summary>
      <p className="form-hint">
        Review-first activity draft. Nothing is created until you save this follow-up.
      </p>
      {draft.target ? (
        <form action={formAction} className="email-follow-up-form">
          <input name="emailLogId" type="hidden" value={draft.emailLogId} />
          <div className="email-follow-up-context">
            <span>Linked to </span>
            <Link className="inline-link" href={draft.target.href} title={`Open ${draft.target.label}`}>
              {draft.target.label}
            </Link>
          </div>
          {draft.hasSavedLabels ? (
            <p className="form-hint">Defaults use saved labels: {draft.labels.join(", ")}.</p>
          ) : (
            <p className="form-hint">No saved Smart Labels yet; using conservative manual defaults. You can classify first or edit this draft now.</p>
          )}
          <div className="form-grid">
            <label className="form-field form-field-wide">
              <FormFieldLabel required>Title</FormFieldLabel>
              <input name="title" onChange={(event) => setTitle(event.target.value)} required value={title} />
            </label>
            <label className="form-field">
              <FormFieldLabel>Type</FormFieldLabel>
              <select name="type" onChange={(event) => setType(event.target.value as typeof type)} value={type}>
                <option value="EMAIL">Email</option>
                <option value="CALL">Call</option>
                <option value="MEETING">Meeting</option>
                <option value="TASK">Task</option>
              </select>
            </label>
            <label className="form-field">
              <FormFieldLabel>Due date</FormFieldLabel>
              <input name="dueAt" onChange={(event) => setDueAt(event.target.value)} type="date" value={dueAt} />
            </label>
            <label className="form-field form-field-wide">
              <FormFieldLabel>Description</FormFieldLabel>
              <textarea name="description" onChange={(event) => setDescription(event.target.value)} rows={6} value={description} />
            </label>
          </div>
          <FormActionBar
            actionsLabel={`Email follow-up activity actions for ${subject}`}
            compact
            disabledHint="Add an activity title before creating the follow-up."
            isSaving={isPending}
            submitActionLabel={actionLabel}
            submitDisabled={!title.trim()}
            submitLabel="Create activity"
          />
        </form>
      ) : (
        <FormErrorMessage compact>
          Link this email to a deal, lead, contact, or organization before creating a follow-up activity.
        </FormErrorMessage>
      )}
      {stateApplies && state.error ? <FormErrorMessage compact>{state.error}</FormErrorMessage> : null}
      {stateApplies && state.message ? (
        <FormSuccessMessage compact>
          {state.message}{" "}
          {state.activityHref ? (
            <Link className="inline-link" href={state.activityHref as Route} title="Open created follow-up activity">
              Open activity
            </Link>
          ) : null}
          {state.targetHref && state.targetLabel ? (
            <>
              {" "}
              or{" "}
              <Link className="inline-link" href={state.targetHref as Route} title={`Open ${state.targetLabel}`}>
                open {state.targetLabel}
              </Link>
              .
            </>
          ) : null}
        </FormSuccessMessage>
      ) : null}
    </details>
  );
}
