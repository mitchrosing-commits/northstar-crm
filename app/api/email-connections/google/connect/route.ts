import { NextRequest, NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { createEmailOAuthState } from "@/lib/email/oauth-state";
import { assertGoogleOAuthReady, buildGoogleAuthorizationUrl } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { actor } = await getCurrentWorkspaceContext();
    const config = assertGoogleOAuthReady();
    const state = createEmailOAuthState({
      actorUserId: actor.actorUserId,
      provider: "GOOGLE_WORKSPACE",
      returnTo: safeEmailOAuthReturnTo(request.nextUrl.searchParams.get("returnTo")),
      workspaceId: actor.workspaceId
    });

    return NextResponse.redirect(buildGoogleAuthorizationUrl({ config, state }));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return handleApiError(error);
  }
}

function safeEmailOAuthReturnTo(value: string | null) {
  if (!value || value.length > 1200 || !value.startsWith("/email")) {
    return undefined;
  }
  try {
    const url = new URL(value, "https://northstar.local");
    return url.pathname === "/email" ? `${url.pathname}${url.search}${url.hash}` : undefined;
  } catch {
    return undefined;
  }
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
