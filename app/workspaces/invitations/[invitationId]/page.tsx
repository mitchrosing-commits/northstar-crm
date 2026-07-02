import { redirect } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";

import { acceptWorkspaceInvitationAction } from "@/app/workspaces/actions";
import { AuthPanel } from "@/components/auth-panel";
import { EmptyState } from "@/components/empty-state";
import { ApiError } from "@/lib/api/responses";
import { getRequestContext } from "@/lib/auth/request-context";
import { redactSensitiveText } from "@/lib/security/redaction";
import { getWorkspaceInvitationForAcceptance } from "@/lib/services/crm";

type WorkspaceInvitationPageProps = {
  params: Promise<{ invitationId: string }>;
};

export const dynamic = "force-dynamic";

export default async function WorkspaceInvitationPage({ params }: WorkspaceInvitationPageProps) {
  const { invitationId } = await params;
  const invitationPath = workspaceInvitationPath(invitationId);
  const nextParam = encodeURIComponent(invitationPath);
  const invitation = await loadInvitation(invitationId);

  if ("error" in invitation) {
    return (
      <AuthPanel eyebrow="Workspace Invitation">
        <EmptyState
          actions={
            <>
              <Link className="button-primary" href={`/login?next=${nextParam}` as Route}>
                Sign in
              </Link>
              <Link className="button-secondary" href={`/signup?next=${nextParam}` as Route}>
                Create account
              </Link>
            </>
          }
          actionsLabel="Invitation recovery actions"
          className="workspace-invitation-state"
          description={invitation.error}
          title="Invitation unavailable"
          titleLevel="h1"
        >
          <p>
            Sign in or create an account with the invited email address, then reopen the shared invite link. Ask a
            workspace owner/admin for a new link if this one was revoked.
          </p>
        </EmptyState>
      </AuthPanel>
    );
  }

  const alreadyAccepted = invitation.status === "ACCEPTED";
  const acceptInvitationActionLabel = alreadyAccepted
    ? `Continue to workspace ${invitation.workspace.name}`
    : `Accept invitation to ${invitation.workspace.name}`;

  return (
    <AuthPanel eyebrow="Workspace Invitation">
      <EmptyState
        actions={
          <form action={acceptWorkspaceInvitationAction}>
            <input name="invitationId" type="hidden" value={invitation.id} />
            <button aria-label={acceptInvitationActionLabel} className="button-primary" title={acceptInvitationActionLabel} type="submit">
              {alreadyAccepted ? "Continue to workspace" : "Accept invitation"}
            </button>
          </form>
        }
        actionsLabel="Invitation actions"
        className="workspace-invitation-state"
        description={
          alreadyAccepted
            ? `You are already a member of ${invitation.workspace.name} as ${invitation.roleLabel}. Continue to Settings to work in this workspace.`
            : `Accept this invitation for ${invitation.email} to join ${invitation.workspace.name} as ${invitation.roleLabel}. If you do not have an account yet, create one with this email first; email delivery is not implemented yet, so invitations are accepted from a shared link.`
        }
        title={alreadyAccepted ? "Invitation already accepted" : invitation.workspace.name}
        titleLevel="h1"
      />
    </AuthPanel>
  );
}

async function loadInvitation(invitationId: string) {
  try {
    const { actorUserId } = await getRequestContext();
    return await getWorkspaceInvitationForAcceptance(actorUserId, invitationId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=${encodeURIComponent(workspaceInvitationPath(invitationId))}`);
    }

    if (error instanceof ApiError) {
      return { error: redactSensitiveText(error.message) };
    }

    return { error: "Workspace invitation could not be loaded." };
  }
}

function workspaceInvitationPath(invitationId: string) {
  return `/workspaces/invitations/${encodeURIComponent(invitationId)}`;
}
