"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { forgotPasswordAction, type ForgotPasswordActionState } from "./actions";

const initialState: ForgotPasswordActionState = {
  email: ""
};

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);

  return (
    <form action={formAction} className="login-form">
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
      {state.message ? <p className="form-success">{state.message}</p> : null}
      {state.resetUrl ? (
        <p className="empty-copy">
          Development reset link: <a href={state.resetUrl}>Open reset form</a>
        </p>
      ) : null}
      <ForgotPasswordSubmitButton />
      <p className="empty-copy">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}

function ForgotPasswordSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button-primary" disabled={pending} type="submit">
      {pending ? "Preparing..." : "Request reset"}
    </button>
  );
}
