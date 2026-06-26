"use client";

import { useActionState } from "react";

import {
  createWorkspaceInvitationAction,
  type CreateWorkspaceInvitationActionState
} from "@/app/workspaces/actions";

const initialState: CreateWorkspaceInvitationActionState = {
  email: "",
  role: "MEMBER"
};

export function WorkspaceInviteForm() {
  const [state, formAction, pending] = useActionState(createWorkspaceInvitationAction, initialState);

  return (
    <form action={formAction} className="inline-form">
      <div className="form-grid">
        <label className="form-field" htmlFor="invite-email">
          <span>Email</span>
          <input
            aria-describedby={state.error ? "workspace-invite-error" : state.message ? "workspace-invite-message" : undefined}
            autoComplete="email"
            defaultValue={state.email}
            id="invite-email"
            name="email"
            required
            type="email"
          />
        </label>
        <label className="form-field" htmlFor="invite-role">
          <span>Role</span>
          <select defaultValue={state.role} id="invite-role" name="role">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
      </div>
      {state.error ? (
        <p className="form-error" id="workspace-invite-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="compact-success" id="workspace-invite-message" role="status">
          {state.message}
        </p>
      ) : null}
      <div className="form-actions">
        <button className="button-primary" disabled={pending} type="submit">
          Create invitation
        </button>
      </div>
    </form>
  );
}
