"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { activeWorkspaceCookieName } from "@/lib/auth/request-context";
import { revokeLocalSessionToken } from "@/lib/auth/local-auth";
import {
  localSessionCookieName,
  resolveSessionIdentity
} from "@/lib/auth/session";

export async function logoutAction() {
  const headerStore = await headers();
  const session = resolveSessionIdentity(headerStore);

  if (session.kind === "session") {
    await revokeLocalSessionToken(session.token);
  }

  const cookieStore = await cookies();
  cookieStore.delete(activeWorkspaceCookieName);
  cookieStore.delete(localSessionCookieName);
  redirect("/login");
}
