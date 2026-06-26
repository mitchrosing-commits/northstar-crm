import { NextRequest, NextResponse } from "next/server";

import { getRequestContext, resolveCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { verifyEmailOAuthState } from "@/lib/email/oauth-state";
import {
  assertGoogleOAuthReady,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserProfile,
  storeGoogleOAuthConnection
} from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const settingsUrl = new URL("/settings", request.url);
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");

  if (error) {
    return redirectToSettings(settingsUrl, "gmail-error");
  }

  try {
    if (!code) {
      return redirectToSettings(settingsUrl, "gmail-error");
    }

    const state = verifyEmailOAuthState(request.nextUrl.searchParams.get("state"));
    const requestContext = await getRequestContext();
    if (requestContext.actorUserId !== state.actorUserId) {
      return redirectToSettings(settingsUrl, "gmail-error");
    }

    const { actor } = await resolveCurrentWorkspaceContext({
      actorUserId: requestContext.actorUserId,
      user: requestContext.user,
      workspaceId: state.workspaceId
    });
    const config = assertGoogleOAuthReady();
    const tokenResponse = await exchangeGoogleAuthorizationCode({ code, config });
    const profile = await fetchGoogleUserProfile({ accessToken: tokenResponse.access_token as string });
    await storeGoogleOAuthConnection({
      actor,
      profile: { ...profile, email: profile.email as string },
      tokenResponse
    });

    return redirectToSettings(settingsUrl, "gmail-connected");
  } catch {
    return redirectToSettings(settingsUrl, "gmail-error");
  }
}

function redirectToSettings(settingsUrl: URL, status: string) {
  settingsUrl.searchParams.set("emailConnection", status);
  return NextResponse.redirect(settingsUrl);
}
