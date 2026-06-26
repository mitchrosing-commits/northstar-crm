"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

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
        <p className="form-success">Password reset. You can sign in with your new password.</p>
        <Link className="button-primary" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="login-form">
      <input name="token" type="hidden" value={token} />
      <label className="form-label" htmlFor="password">
        New password
      </label>
      <input
        autoComplete="new-password"
        className="text-input"
        id="password"
        minLength={minimumPasswordLength}
        name="password"
        required
        type="password"
      />
      <label className="form-label" htmlFor="confirmPassword">
        Confirm new password
      </label>
      <input
        autoComplete="new-password"
        className="text-input"
        id="confirmPassword"
        minLength={minimumPasswordLength}
        name="confirmPassword"
        required
        type="password"
      />
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <ResetPasswordSubmitButton />
    </form>
  );
}

function ResetPasswordSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button-primary" disabled={pending} type="submit">
      {pending ? "Resetting..." : "Reset password"}
    </button>
  );
}
