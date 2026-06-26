"use client";

import { useActionState } from "react";

import {
  updateAccountDisplayNameAction,
  type AccountSettingsActionState
} from "@/app/settings/account-actions";

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
      <div className="form-grid">
        <label className="form-field" htmlFor="account-display-name">
          <span>Display name</span>
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
        <div className="form-field">
          <span>Current workspace</span>
          <strong>{workspaceName}</strong>
        </div>
        <div className="form-field">
          <span>Workspace role</span>
          <strong>{roleLabel}</strong>
        </div>
      </div>
      {state.error ? (
        <p className="form-error" id="account-settings-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? <p className="form-success">{state.message}</p> : null}
      <div className="form-actions">
        <button className="button-primary" disabled={pending} type="submit">
          {pending ? "Saving..." : "Save display name"}
        </button>
      </div>
    </form>
  );
}
