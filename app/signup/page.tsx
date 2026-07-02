import { redirect } from "next/navigation";
import type { Route } from "next";

import { AuthPanel } from "@/components/auth-panel";
import { sanitizeAuthNextPath } from "@/lib/auth/next-path";
import { getRequestContext } from "@/lib/auth/request-context";
import { resolveAuthMode } from "@/lib/auth/session";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

type SignupPageProps = {
  searchParams?: Promise<{ next?: string }>;
};

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { next = "/dashboard" } = (await searchParams) ?? {};
  const nextPath = sanitizeAuthNextPath(next);
  const isAuthenticated = await hasCurrentUser();
  if (isAuthenticated) redirect(nextPath as Route);

  return (
    <AuthPanel
      description="Start a local workspace account for a demo or self-hosted Northstar CRM setup."
      title="Create account"
    >
      <SignupForm nextPath={nextPath} />
    </AuthPanel>
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
