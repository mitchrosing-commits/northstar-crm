"use client";

import Link from "next/link";
import { useActionState } from "react";

import { AuthSubmitButton } from "@/components/auth-submit-button";
import { AuthTextField } from "@/components/auth-text-field";
import { FormSuccessMessage } from "@/components/form-success-message";

import { forgotPasswordAction, type ForgotPasswordActionState } from "./actions";

const initialState: ForgotPasswordActionState = {
  email: ""
};

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <AuthTextField
        autoComplete="email"
        defaultValue={state.email}
        id="email"
        label="Email"
        name="email"
        required
        type="email"
      />
      {state.message ? <FormSuccessMessage>{state.message}</FormSuccessMessage> : null}
      {state.resetUrl ? (
        <p className="empty-copy">
          Development reset link: <a href={state.resetUrl}>Open reset form</a>
        </p>
      ) : null}
      <AuthSubmitButton pendingLabel="Preparing..." submitLabel="Request reset" />
      <p className="empty-copy">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
