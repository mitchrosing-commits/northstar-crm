import { NextRequest, NextResponse } from "next/server";

import { getRequestContext, resolveCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { verifyEmailOAuthState } from "@/lib/email/oauth-state";
import { buildAppUrl } from "@/lib/public-url";
import {
  assertGoogleOAuthReady,
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserProfile,
  resolveGoogleOAuthGrantedScopes,
  storeGoogleOAuthConnection
} from "@/lib/services/crm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const settingsUrl = new URL(buildAppUrl("/settings", { requestUrl: request.url }));
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");

  if (error) {
    return redirectToOAuthDestination(
      request,
      settingsUrl,
      safeStateReturnTo(request.nextUrl.searchParams.get("state")),
      "gmail-error",
    );
  }

  try {
    if (!code) {
      return redirectToSettings(settingsUrl, "gmail-error");
    }

    const state = verifyEmailOAuthState(request.nextUrl.searchParams.get("state"));
    if (state.provider !== "GOOGLE_WORKSPACE") {
      return redirectToSettings(settingsUrl, "gmail-error");
    }

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
    const scopeResolution = await resolveGoogleOAuthGrantedScopes({
      accessToken: tokenResponse.access_token as string,
      tokenResponse
    });
    const profile = await fetchGoogleUserProfile({ accessToken: tokenResponse.access_token as string });
    await storeGoogleOAuthConnection({
      actor,
      grantedScopes: scopeResolution.scopes,
      profile: { ...profile, email: profile.email as string },
      scopeResolution,
      tokenResponse
    });

    return redirectToOAuthDestination(
      request,
      settingsUrl,
      state.returnTo,
      "gmail-connected",
    );
  } catch {
    return redirectToSettings(settingsUrl, "gmail-error");
  }
}

function redirectToSettings(settingsUrl: URL, status: string) {
  settingsUrl.searchParams.set("emailConnection", status);
  return NextResponse.redirect(settingsUrl);
}

function redirectToOAuthDestination(
  request: NextRequest,
  settingsUrl: URL,
  returnTo: string | undefined,
  status: string,
) {
  if (!returnTo) return redirectToSettings(settingsUrl, status);
  const emailUrl = new URL(buildAppUrl(returnTo, { requestUrl: request.url }));
  emailUrl.searchParams.set("emailConnection", status);
  return NextResponse.redirect(emailUrl);
}

function safeStateReturnTo(stateValue: string | null) {
  try {
    const state = verifyEmailOAuthState(stateValue);
    return state.provider === "GOOGLE_WORKSPACE" ? state.returnTo : undefined;
  } catch {
    return undefined;
  }
}
