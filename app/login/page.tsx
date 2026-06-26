import { redirect } from "next/navigation";

import { getRequestContext } from "@/lib/auth/request-context";
import { resolveAuthMode } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next = "/dashboard" } = await searchParams;
  const isContinuation = next !== "/dashboard";
  const isAuthenticated = await hasCurrentUser();
  if (isAuthenticated) redirect("/dashboard");

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="page-kicker">Northstar CRM</p>
        <h1 className="page-title">Sign in</h1>
        <p className="empty-copy">
          {isContinuation ? "Please sign in to continue. " : null}
          Use a local workspace account. SSO and external email delivery are not part of this MVP.
        </p>
        <LoginForm nextPath={next} />
      </section>
    </main>
  );
}

async function hasCurrentUser() {
  if (resolveAuthMode() !== "local") return false;

  try {
    await getRequestContext();
    return true;
  } catch {
    return false;
  }
}
