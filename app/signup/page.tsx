import { redirect } from "next/navigation";
import type { Route } from "next";

import { getRequestContext } from "@/lib/auth/request-context";
import { resolveAuthMode } from "@/lib/auth/session";
import { SignupForm } from "./signup-form";

type SignupPageProps = {
  searchParams?: Promise<{ next?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { next = "/dashboard" } = (await searchParams) ?? {};
  const nextPath = sanitizeNextPath(next);
  const isAuthenticated = await hasCurrentUser();
  if (isAuthenticated) redirect(nextPath as Route);

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="page-kicker">Northstar CRM</p>
        <h1 className="page-title">Create account</h1>
        <p className="empty-copy">
          Start a local workspace account for a demo or self-hosted Northstar CRM setup.
        </p>
        <SignupForm nextPath={nextPath} />
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

function sanitizeNextPath(nextPath: string) {
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return "/dashboard";
  if (nextPath.startsWith("/login") || nextPath.startsWith("/signup")) return "/dashboard";
  return nextPath;
}
