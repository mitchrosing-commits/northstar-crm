import { NextRequest, NextResponse } from "next/server";

import { getRequestContext, resolveCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { verifyEmailOAuthState } from "@/lib/email/oauth-state";
import { buildAppUrl } from "@/lib/public-url";
import {
  assertMicrosoftOAuthReady,
  exchangeMicrosoftAuthorizationCode,
  fetchMicrosoftUserProfile,
  storeMicrosoftOAuthConnection
} from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const settingsUrl = new URL(buildAppUrl("/settings", { requestUrl: request.url }));
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");

  if (error) {
    return redirectToSettings(settingsUrl, "microsoft-error");
  }

  try {
    if (!code) {
      return redirectToSettings(settingsUrl, "microsoft-error");
    }

    const state = verifyEmailOAuthState(request.nextUrl.searchParams.get("state"));
    if (state.provider !== "MICROSOFT_365") {
      return redirectToSettings(settingsUrl, "microsoft-error");
    }

    const requestContext = await getRequestContext();
    if (requestContext.actorUserId !== state.actorUserId) {
      return redirectToSettings(settingsUrl, "microsoft-error");
    }

    const { actor } = await resolveCurrentWorkspaceContext({
      actorUserId: requestContext.actorUserId,
      user: requestContext.user,
      workspaceId: state.workspaceId
    });
    const config = assertMicrosoftOAuthReady();
    const tokenResponse = await exchangeMicrosoftAuthorizationCode({ code, config });
    const profile = await fetchMicrosoftUserProfile({ accessToken: tokenResponse.access_token as string });
    await storeMicrosoftOAuthConnection({
      actor,
      profile: {
        ...profile,
        mail: profile.mail ?? profile.userPrincipalName ?? "",
        userPrincipalName: profile.userPrincipalName ?? profile.mail ?? ""
      },
      tokenResponse
    });

    return redirectToSettings(settingsUrl, "microsoft-connected");
  } catch {
    return redirectToSettings(settingsUrl, "microsoft-error");
  }
}

function redirectToSettings(settingsUrl: URL, status: string) {
  settingsUrl.searchParams.set("emailConnection", status);
  return NextResponse.redirect(settingsUrl);
}
