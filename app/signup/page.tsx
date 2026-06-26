import { redirect } from "next/navigation";

import { getRequestContext } from "@/lib/auth/request-context";
import { resolveAuthMode } from "@/lib/auth/session";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const isAuthenticated = await hasCurrentUser();
  if (isAuthenticated) redirect("/dashboard");

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="page-kicker">Northstar CRM</p>
        <h1 className="page-title">Create account</h1>
        <p className="empty-copy">
          Start a local workspace account for a demo or self-hosted Northstar CRM setup.
        </p>
        <SignupForm />
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
