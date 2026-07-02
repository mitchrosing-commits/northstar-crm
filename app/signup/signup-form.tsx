"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState } from "react";

import { AuthSubmitButton } from "@/components/auth-submit-button";
import { AuthTextField } from "@/components/auth-text-field";
import { FormErrorMessage } from "@/components/form-error-message";
import { workspaceNameMaxLength } from "@/lib/workspace-validation";

import { signupAction, type SignupActionState } from "./actions";

const initialState: SignupActionState = {
  email: "",
  name: "",
  workspaceName: ""
};

export function SignupForm({ nextPath }: { nextPath: string }) {
  const [state, formAction] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <input type="hidden" name="next" value={nextPath} />
      <AuthTextField
        autoComplete="name"
        defaultValue={state.name}
        id="name"
        label="Name"
        name="name"
        type="text"
      />
      <AuthTextField
        autoComplete="email"
        defaultValue={state.email}
        id="email"
        label="Email"
        name="email"
        required
        type="email"
      />
      <AuthTextField
        autoComplete="new-password"
        id="password"
        label="Password"
        minLength={8}
        name="password"
        required
        type="password"
      />
      <AuthTextField
        autoComplete="organization"
        defaultValue={state.workspaceName}
        id="workspaceName"
        label="Workspace name"
        maxLength={workspaceNameMaxLength}
        name="workspaceName"
        required
        type="text"
      />
      {state.error ? <FormErrorMessage>{state.error}</FormErrorMessage> : null}
      <AuthSubmitButton pendingLabel="Creating account..." submitLabel="Create account" />
      <p className="empty-copy">
        Already have an account? <Link href={"/login" as Route}>Sign in</Link>
      </p>
    </form>
  );
}
