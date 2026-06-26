"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

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
      <label className="form-label" htmlFor="name">
        Name
      </label>
      <input
        autoComplete="name"
        className="text-input"
        defaultValue={state.name}
        id="name"
        name="name"
        type="text"
      />
      <label className="form-label" htmlFor="email">
        Email
      </label>
      <input
        autoComplete="email"
        className="text-input"
        defaultValue={state.email}
        id="email"
        name="email"
        required
        type="email"
      />
      <label className="form-label" htmlFor="password">
        Password
      </label>
      <input
        autoComplete="new-password"
        className="text-input"
        id="password"
        minLength={8}
        name="password"
        required
        type="password"
      />
      <label className="form-label" htmlFor="workspaceName">
        Workspace name
      </label>
      <input
        autoComplete="organization"
        className="text-input"
        defaultValue={state.workspaceName}
        id="workspaceName"
        name="workspaceName"
        required
        type="text"
      />
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <SignupSubmitButton />
      <p className="empty-copy">
        Already have an account? <Link href={"/login" as Route}>Sign in</Link>
      </p>
    </form>
  );
}

function SignupSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button-primary" disabled={pending} type="submit">
      {pending ? "Creating account..." : "Create account"}
    </button>
  );
}
