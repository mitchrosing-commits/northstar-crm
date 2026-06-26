"use client";

import { useActionState } from "react";

import { createWorkspaceAction, type CreateWorkspaceActionState } from "@/app/workspaces/actions";

const initialState: CreateWorkspaceActionState = {
  name: ""
};

export function CreateWorkspaceForm() {
  const [state, formAction, pending] = useActionState(createWorkspaceAction, initialState);

  return (
    <form action={formAction} className="inline-form">
      <label className="form-field" htmlFor="workspace-name">
        <span>Workspace name</span>
        <input
          aria-describedby={state.error ? "workspace-create-error" : undefined}
          autoComplete="organization"
          defaultValue={state.name}
          id="workspace-name"
          name="name"
          required
        />
      </label>
      {state.error ? (
        <p className="form-error" id="workspace-create-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="form-actions">
        <button className="button-primary" disabled={pending} type="submit">
          Create workspace
        </button>
      </div>
    </form>
  );
}
