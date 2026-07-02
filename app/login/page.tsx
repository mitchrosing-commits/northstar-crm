import { redirect } from "next/navigation";
import type { Route } from "next";

import { AuthPanel } from "@/components/auth-panel";
import { sanitizeAuthNextPath } from "@/lib/auth/next-path";
import { getRequestContext } from "@/lib/auth/request-context";
import { resolveAuthMode } from "@/lib/auth/session";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { next = "/dashboard" } = await searchParams;
  const nextPath = sanitizeAuthNextPath(next);
  const isContinuation = nextPath !== "/dashboard";
  const isAuthenticated = await hasCurrentUser();
  if (isAuthenticated) redirect(nextPath as Route);

  return (
    <AuthPanel
      description={
        <>
          {isContinuation ? "Please sign in to continue. " : null}
          Use a local workspace account. SSO and external email delivery are not part of this MVP.
        </>
      }
      title="Sign in"
    >
      <LoginForm nextPath={nextPath} />
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
