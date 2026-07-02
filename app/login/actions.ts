"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";

import { ApiError } from "@/lib/api/responses";
import { loginWithEmailAndPassword } from "@/lib/auth/local-auth";
import { sanitizeAuthNextPath } from "@/lib/auth/next-path";
import {
  localSessionCookieName,
  resolveAuthMode,
  serializeLocalSessionCookieValue
} from "@/lib/auth/session";
import { redactSensitiveText } from "@/lib/security/redaction";

export type LoginActionState = {
  email: string;
  error?: string;
};

export async function loginAction(_previousState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeAuthNextPath(String(formData.get("next") ?? ""));
  let session: Awaited<ReturnType<typeof loginWithEmailAndPassword>>["session"];

  try {
    if (resolveAuthMode() !== "local") {
      return {
        email,
        error: "Email/password login is available only when AUTH_MODE is local."
      };
    }

    session = (await loginWithEmailAndPassword(email, password)).session;
    const cookieStore = await cookies();
    cookieStore.set(localSessionCookieName, serializeLocalSessionCookieValue(session.token), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: session.expiresAt
    });
  } catch (error) {
    return {
      email,
      error: error instanceof ApiError ? redactSensitiveText(error.message) : "Sign in failed."
    };
  }

  redirect(nextPath as Route);
}
