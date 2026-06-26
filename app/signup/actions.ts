"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiError } from "@/lib/api/responses";
import { signupWithEmailAndPassword } from "@/lib/auth/local-auth";
import { activeWorkspaceCookieName } from "@/lib/auth/request-context";
import {
  localSessionCookieName,
  resolveAuthMode,
  serializeLocalSessionCookieValue
} from "@/lib/auth/session";
import { createWorkspaceFromName } from "@/lib/services/crm";

export type SignupActionState = {
  email: string;
  name: string;
  workspaceName: string;
  error?: string;
};

const activeWorkspaceCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30
} as const;

export async function signupAction(
  _previousState: SignupActionState,
  formData: FormData
): Promise<SignupActionState> {
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  const workspaceName = String(formData.get("workspaceName") ?? "");
  let session: Awaited<ReturnType<typeof signupWithEmailAndPassword>>["session"];
  let workspaceId: string;

  try {
    if (!workspaceName.trim()) {
      return { email, name, workspaceName, error: "Workspace name is required." };
    }

    if (resolveAuthMode() !== "local") {
      return {
        email,
        name,
        workspaceName,
        error: "Signup is available only when AUTH_MODE is local."
      };
    }

    const result = await signupWithEmailAndPassword({ email, name, password });
    session = result.session;
    const workspace = await createWorkspaceFromName(result.user.id, workspaceName);
    workspaceId = workspace.id;
  } catch (error) {
    if (error instanceof ApiError) {
      return { email, name, workspaceName, error: error.message };
    }

    return { email, name, workspaceName, error: "Signup failed." };
  }

  const cookieStore = await cookies();
  cookieStore.set(localSessionCookieName, serializeLocalSessionCookieValue(session.token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt
  });
  cookieStore.set(activeWorkspaceCookieName, workspaceId, activeWorkspaceCookieOptions);
  redirect("/dashboard");
}
