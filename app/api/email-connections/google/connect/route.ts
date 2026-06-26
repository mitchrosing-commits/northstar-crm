import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { createEmailOAuthState } from "@/lib/email/oauth-state";
import { assertGoogleOAuthReady, buildGoogleAuthorizationUrl } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { actor } = await getCurrentWorkspaceContext();
    const config = assertGoogleOAuthReady();
    const state = createEmailOAuthState({
      actorUserId: actor.actorUserId,
      provider: "GOOGLE_WORKSPACE",
      workspaceId: actor.workspaceId
    });

    return NextResponse.redirect(buildGoogleAuthorizationUrl({ config, state }));
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    return handleApiError(error);
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
