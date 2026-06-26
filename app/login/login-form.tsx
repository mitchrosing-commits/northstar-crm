"use client";

import Link from "next/link";
import type { Route } from "next";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { loginAction, type LoginActionState } from "./actions";

type LoginFormProps = {
  nextPath: string;
};

const initialState: LoginActionState = {
  email: ""
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const [state, formAction] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="login-form">
      <input type="hidden" name="next" value={nextPath} />
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
        autoComplete="current-password"
        className="text-input"
        id="password"
        name="password"
        required
        type="password"
      />
      {state.error ? <p className="form-error">{state.error}</p> : null}
      <LoginSubmitButton />
      <p className="empty-copy">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="empty-copy">
        New to Northstar? <Link href={"/signup" as Route}>Create an account</Link>
      </p>
    </form>
  );
}

function LoginSubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button className="button-primary" disabled={pending} type="submit">
      {pending ? "Signing in..." : "Sign in"}
    </button>
  );
}
