import { redirect } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";

import { acceptWorkspaceInvitationAction } from "@/app/workspaces/actions";
import { ApiError } from "@/lib/api/responses";
import { getRequestContext } from "@/lib/auth/request-context";
import { getWorkspaceInvitationForAcceptance } from "@/lib/services/crm";

type WorkspaceInvitationPageProps = {
  params: Promise<{ invitationId: string }>;
};

export const dynamic = "force-dynamic";

export default async function WorkspaceInvitationPage({ params }: WorkspaceInvitationPageProps) {
  const { invitationId } = await params;
  const invitation = await loadInvitation(invitationId);

  if ("error" in invitation) {
    return (
      <main className="login-page">
        <section className="login-panel">
          <p className="page-kicker">Workspace Invitation</p>
          <h1 className="page-title">Invitation unavailable</h1>
          <p className="empty-copy">{invitation.error}</p>
          <p className="empty-copy">
            Sign in or create an account with the invited email address, then reopen the shared invite link. Ask a
            workspace owner/admin for a new link if this one was revoked.
          </p>
          <div className="form-actions">
            <Link className="button-primary" href={`/login?next=/workspaces/invitations/${invitationId}` as Route}>
              Sign in
            </Link>
            <Link className="button-secondary" href={`/signup?next=/workspaces/invitations/${invitationId}` as Route}>
              Create account
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const alreadyAccepted = invitation.status === "ACCEPTED";

  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="page-kicker">Workspace Invitation</p>
        <h1 className="page-title">{alreadyAccepted ? "Invitation already accepted" : invitation.workspace.name}</h1>
        <p className="empty-copy">
          {alreadyAccepted
            ? `You are already a member of ${invitation.workspace.name} as ${invitation.roleLabel}. Continue to Settings to work in this workspace.`
            : `Accept this invitation for ${invitation.email} to join ${invitation.workspace.name} as ${invitation.roleLabel}. If you do not have an account yet, create one with this email first; email delivery is not implemented yet, so invitations are accepted from a shared link.`}
        </p>
        <form action={acceptWorkspaceInvitationAction} className="form-actions">
          <input name="invitationId" type="hidden" value={invitation.id} />
          <button className="button-primary" type="submit">
            {alreadyAccepted ? "Continue to workspace" : "Accept invitation"}
          </button>
        </form>
      </section>
    </main>
  );
}

async function loadInvitation(invitationId: string) {
  try {
    const { actorUserId } = await getRequestContext();
    return await getWorkspaceInvitationForAcceptance(actorUserId, invitationId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirect(`/login?next=/workspaces/invitations/${invitationId}`);
    }

    if (error instanceof ApiError) {
      return { error: error.message };
    }

    return { error: "Workspace invitation could not be loaded." };
  }
}
