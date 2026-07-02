"use client";

import Link from "next/link";
import { useActionState } from "react";

import { AuthSubmitButton } from "@/components/auth-submit-button";
import { AuthTextField } from "@/components/auth-text-field";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";

import { resetPasswordAction, type ResetPasswordActionState } from "./actions";

type ResetPasswordFormProps = {
  minimumPasswordLength: number;
  token: string;
};

const initialState: ResetPasswordActionState = {};

export function ResetPasswordForm({ minimumPasswordLength, token }: ResetPasswordFormProps) {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);

  if (state.success) {
    return (
      <div className="login-form">
        <FormSuccessMessage>Password reset. You can sign in with your new password.</FormSuccessMessage>
        <Link className="button-primary" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="login-form">
      <input name="token" type="hidden" value={token} />
      <AuthTextField
        autoComplete="new-password"
        id="password"
        label="New password"
        minLength={minimumPasswordLength}
        name="password"
        required
        type="password"
      />
      <AuthTextField
        autoComplete="new-password"
        id="confirmPassword"
        label="Confirm new password"
        minLength={minimumPasswordLength}
        name="confirmPassword"
        required
        type="password"
      />
      {state.error ? <FormErrorMessage>{state.error}</FormErrorMessage> : null}
      <AuthSubmitButton pendingLabel="Resetting..." submitLabel="Reset password" />
    </form>
  );
}
