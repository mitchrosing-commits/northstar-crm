import { NextResponse } from "next/server";

import { handleApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { createEmailOAuthState } from "@/lib/email/oauth-state";
import { assertMicrosoftOAuthReady, buildMicrosoftAuthorizationUrl } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { actor } = await getCurrentWorkspaceContext();
    const config = assertMicrosoftOAuthReady();
    const state = createEmailOAuthState({
      actorUserId: actor.actorUserId,
      provider: "MICROSOFT_365",
      workspaceId: actor.workspaceId
    });

    return NextResponse.redirect(buildMicrosoftAuthorizationUrl({ config, state }));
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
