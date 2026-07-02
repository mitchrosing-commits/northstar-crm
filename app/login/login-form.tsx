"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState } from "react";

import { AuthSubmitButton } from "@/components/auth-submit-button";
import { AuthTextField } from "@/components/auth-text-field";
import { FormErrorMessage } from "@/components/form-error-message";

import { loginAction, type LoginActionState } from "./actions";

type LoginFormProps = {
  nextPath: string;
};

const initialState: LoginActionState = {
  email: ""
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const [state, formAction] = useActionState(loginAction, initialState);
  const signupHref = nextPath && nextPath !== "/dashboard" ? `/signup?next=${encodeURIComponent(nextPath)}` : "/signup";

  return (
    <form action={formAction} className="login-form">
      <input type="hidden" name="next" value={nextPath} />
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
        autoComplete="current-password"
        id="password"
        label="Password"
        name="password"
        required
        type="password"
      />
      {state.error ? <FormErrorMessage>{state.error}</FormErrorMessage> : null}
      <AuthSubmitButton pendingLabel="Signing in..." submitLabel="Sign in" />
      <p className="empty-copy">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="empty-copy">
        New to Northstar? <Link href={signupHref as Route}>Create an account</Link>
      </p>
    </form>
  );
}
