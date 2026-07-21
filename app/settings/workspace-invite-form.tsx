"use client";

import { useActionState } from "react";

import {
  createWorkspaceInvitationAction,
  type CreateWorkspaceInvitationActionState
} from "@/app/workspaces/actions";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSection } from "@/components/form-section";
import { FormSuccessMessage } from "@/components/form-success-message";

const initialState: CreateWorkspaceInvitationActionState = {
  email: "",
  role: "MEMBER"
};

export function WorkspaceInviteForm() {
  const [state, formAction, pending] = useActionState(createWorkspaceInvitationAction, initialState);

  return (
    <form action={formAction} className="inline-form">
      <FormSection
        description="Invite a teammate by email and choose the workspace role they should receive."
        title="Invitation details"
      >
        <div className="form-grid">
          <label className="form-field" htmlFor="invite-email">
            <FormFieldLabel required>Email</FormFieldLabel>
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
            <FormFieldLabel required>Role</FormFieldLabel>
            <select defaultValue={state.role} id="invite-role" name="role">
              <option value="MEMBER">Member</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>
        </div>
      </FormSection>
      {state.error ? (
        <FormErrorMessage id="workspace-invite-error">
          {state.error}
        </FormErrorMessage>
      ) : null}
      {state.message ? (
        <FormSuccessMessage compact id="workspace-invite-message">
          {state.message}
        </FormSuccessMessage>
      ) : null}
      <FormActionBar isSaving={pending} pendingLabel="Create invitation" submitLabel="Create invitation" />
    </form>
  );
}
