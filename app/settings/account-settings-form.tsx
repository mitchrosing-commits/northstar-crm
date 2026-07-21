"use client";

import { useActionState } from "react";

import {
  updateAccountDisplayNameAction,
  type AccountSettingsActionState
} from "@/app/settings/account-actions";
import { Badge } from "@/components/badge";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSection } from "@/components/form-section";
import { FormSuccessMessage } from "@/components/form-success-message";

type AccountSettingsFormProps = {
  currentName: string | null;
  email: string;
  workspaceName: string;
  roleLabel: string;
};

export function AccountSettingsForm({ currentName, email, workspaceName, roleLabel }: AccountSettingsFormProps) {
  const initialState: AccountSettingsActionState = {
    name: currentName ?? ""
  };
  const [state, formAction, pending] = useActionState(updateAccountDisplayNameAction, initialState);

  return (
    <form action={formAction} className="inline-form">
      <FormSection
        description="This name appears on records, assignments, and workspace activity."
        title="Account details"
      >
        <div className="form-grid">
          <label className="form-field" htmlFor="account-display-name">
            <FormFieldLabel required>Display name</FormFieldLabel>
            <input
              aria-describedby={state.error ? "account-settings-error" : undefined}
              autoComplete="name"
              defaultValue={state.name}
              id="account-display-name"
              maxLength={120}
              name="name"
              required
            />
          </label>
          <label className="form-field" htmlFor="account-email">
            <span>Email</span>
            <input id="account-email" readOnly type="email" value={email} />
          </label>
        </div>
        <dl className="field-grid account-context-grid">
          <div>
            <dt className="field-label">Current workspace</dt>
            <dd className="field-value">{workspaceName}</dd>
          </div>
          <div>
            <dt className="field-label">Workspace role</dt>
            <dd className="field-value">
              <Badge label={`Workspace role: ${roleLabel}`}>{roleLabel}</Badge>
            </dd>
          </div>
        </dl>
      </FormSection>
      {state.error ? (
        <FormErrorMessage id="account-settings-error">
          {state.error}
        </FormErrorMessage>
      ) : null}
      {state.message ? <FormSuccessMessage>{state.message}</FormSuccessMessage> : null}
      <FormActionBar isSaving={pending} submitLabel="Save display name" />
    </form>
  );
}
