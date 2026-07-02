"use client";

import { useActionState } from "react";

import { createWorkspaceAction, type CreateWorkspaceActionState } from "@/app/workspaces/actions";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { workspaceNameMaxLength } from "@/lib/workspace-validation";

const initialState: CreateWorkspaceActionState = {
  name: ""
};

export function CreateWorkspaceForm() {
  const [state, formAction, pending] = useActionState(createWorkspaceAction, initialState);

  return (
    <form action={formAction} className="inline-form">
      <label className="form-field" htmlFor="workspace-name">
        <FormFieldLabel required>Workspace name</FormFieldLabel>
        <input
          aria-describedby={state.error ? "workspace-create-error" : undefined}
          autoComplete="organization"
          defaultValue={state.name}
          id="workspace-name"
          maxLength={workspaceNameMaxLength}
          name="name"
          required
        />
      </label>
      {state.error ? (
        <FormErrorMessage id="workspace-create-error">
          {state.error}
        </FormErrorMessage>
      ) : null}
      <FormActionBar isSaving={pending} pendingLabel="Create workspace" submitLabel="Create workspace" />
    </form>
  );
}
