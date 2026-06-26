import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { formatDate } from "@/components/format";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWorkspaceMembershipSummary, listEmailConnectionProviderCards, listEmailTemplates, listPendingWorkspaceInvitations } from "@/lib/services/crm";
import type { EmailProviderCard } from "@/lib/services/crm";
import {
  removeWorkspaceMemberAction,
  revokeWorkspaceInvitationAction,
  transferWorkspaceOwnershipAction,
  updateWorkspaceMemberRoleAction
} from "@/app/workspaces/actions";
import { AccountSettingsForm } from "./account-settings-form";
import { syncRecentGmailAction, syncRecentMicrosoftAction } from "./actions";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { EmailTemplatesPanel } from "./email-templates-panel";
import { WorkspaceInviteForm } from "./workspace-invite-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams
}: {
  searchParams?: Promise<{ created?: string; emailConnection?: string }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actor, actorUserId, user } = await getCurrentWorkspaceContext();
  const [summary, emailTemplates, emailProviderCards] = await Promise.all([
    getWorkspaceMembershipSummary(actor),
    listEmailTemplates(actor),
    listEmailConnectionProviderCards(actor)
  ]);
  const pendingInvitations = summary.currentMembership.canManageWorkspaceSettings ? await listPendingWorkspaceInvitations(actor) : [];
  const adminMemberCount = summary.members.filter((member) => member.canManageWorkspaceSettings).length;
  const currentUserIsOwner = summary.currentMembership.role === "OWNER";

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Workspace</p>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>

      <section className="stat-grid">
        <div className="stat-card">
          <p className="stat-label">Workspace</p>
          <p className="stat-value stat-value-compact">{summary.workspace.name}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Members</p>
          <p className="stat-value">{summary.members.length}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Your role</p>
          <p className="stat-value stat-value-compact">{summary.currentMembership.roleLabel}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Settings access</p>
          <p className="stat-value stat-value-compact">
            {summary.currentMembership.canManageWorkspaceSettings ? "Admin" : "Member"}
          </p>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Account</h2>
        </div>
        <AccountSettingsForm
          currentName={user.name}
          email={user.email}
          roleLabel={summary.currentMembership.roleLabel}
          workspaceName={workspace.name}
        />
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Import / Export</h2>
          <Link className="button-secondary" href="/settings/import-export">
            Open exports
          </Link>
        </div>
        <p className="empty-copy">
          Download workspace-scoped CSV files for core CRM records.
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Developer / API</h2>
          <Link className="button-secondary" href={"/settings/developer-api" as Route}>
            Open API surface
          </Link>
        </div>
        <p className="empty-copy">
          Review the workspace-scoped REST surface, OpenAPI reference files, CSV export endpoints, and planned API key
          and webhook controls.
        </p>
      </section>

      <EmailTemplatesPanel templates={emailTemplates} workspaceId={workspace.id} />
      <EmailConnectionsPanel
        createdCount={resolvedSearchParams?.created}
        providers={emailProviderCards}
        status={resolvedSearchParams?.emailConnection}
      />

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Hosted Use Notes</h2>
          <span className="badge">Production-safe</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 12 }}>
          Use local auth for hosted company workspaces. Demo auth and seed data are for demo-only environments, not
          company-use databases.
        </p>
        <p className="empty-copy">
          Gmail sync requires Google OAuth env vars and a redirect URI that matches this hosted app. Password reset email
          delivery requires the auth email webhook env vars and a worker or scheduled job run. Keep secrets in the
          hosting platform; do not commit local env files.
        </p>
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Create Workspace</h2>
        </div>
        <p className="empty-copy" style={{ marginBottom: 16 }}>
          Create a separate workspace for another team or account. You become the owner, duplicate names are allowed,
          and the new workspace becomes active after creation.
        </p>
        <CreateWorkspaceForm />
      </section>

      {summary.currentMembership.canManageWorkspaceSettings ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-title-row">
            <h2 className="panel-title">Team / Workspace Invitations</h2>
            <span className="badge">Manual link sharing</span>
          </div>
          <p className="empty-copy" style={{ marginBottom: 16 }}>
            Invite an existing Northstar user by email. Northstar creates an invitation record and accept link; hosted
            invitation email delivery is not configured in this MVP, so share the link manually.
          </p>
          <WorkspaceInviteForm />
          <div style={{ marginTop: 18, overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Invited by</th>
                  <th>Invite link</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingInvitations.length > 0 ? (
                  pendingInvitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td>{invitation.email}</td>
                      <td>
                        <span className="badge">{invitation.roleLabel}</span>
                      </td>
                      <td>{invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? "Unknown"}</td>
                      <td>
                        <Link className="inline-link" href={`/workspaces/invitations/${invitation.id}`}>
                          Open invite link
                        </Link>
                      </td>
                      <td>
                        <form action={revokeWorkspaceInvitationAction}>
                          <input name="invitationId" type="hidden" value={invitation.id} />
                          <button className="button-secondary button-compact" type="submit">
                            Revoke
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5}>No pending invitations.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Workspace Members</h2>
        </div>
        <p className="empty-copy" style={{ marginBottom: 16 }}>
          Active members with access to this workspace. Owners can transfer ownership or change Admin/Member roles.
          Transferring ownership immediately makes that member the owner and moves you to Admin. Removing a member does
          not delete that user&apos;s account or CRM records.
        </p>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Access</th>
              <th>Joined</th>
              {summary.currentMembership.canManageWorkspaceSettings ? <th>Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {summary.members.map((member) => (
              <tr key={member.id}>
                <td>
                  <strong>{member.name ?? member.email}</strong>
                </td>
                <td>{member.email}</td>
                <td>
                  <span className="badge">{member.roleLabel}</span>
                </td>
                <td>{member.canManageWorkspaceSettings ? "Settings admin" : "Workspace member"}</td>
                <td>{formatDate(member.joinedAt)}</td>
                {summary.currentMembership.canManageWorkspaceSettings ? (
                  <td>
                    {member.userId === actorUserId ? (
                      <span className="muted">Current user</span>
                    ) : member.role === "OWNER" ? (
                      <span className="muted">Owner removal blocked</span>
                    ) : member.canManageWorkspaceSettings && adminMemberCount <= 1 ? (
                      <span className="muted">Last admin</span>
                    ) : (
                      <div className="filter-actions">
                        {currentUserIsOwner ? (
                          <>
                            <form action={updateWorkspaceMemberRoleAction}>
                              <input name="membershipId" type="hidden" value={member.id} />
                              <input name="role" type="hidden" value={member.role === "ADMIN" ? "MEMBER" : "ADMIN"} />
                              <button className="button-secondary button-compact" type="submit">
                                {member.role === "ADMIN" ? "Make member" : "Make admin"}
                              </button>
                            </form>
                            <form action={transferWorkspaceOwnershipAction}>
                              <input name="membershipId" type="hidden" value={member.id} />
                              <button className="button-secondary button-compact" type="submit">
                                Transfer owner
                              </button>
                            </form>
                          </>
                        ) : member.role === "ADMIN" ? (
                          <span className="muted">Owner action required</span>
                        ) : null}
                        {member.role === "ADMIN" && !currentUserIsOwner ? null : (
                          <form action={removeWorkspaceMemberAction}>
                            <input name="membershipId" type="hidden" value={member.id} />
                            <button className="button-secondary button-compact" type="submit">
                              Remove
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}

function EmailConnectionsPanel({
  createdCount,
  providers,
  status
}: {
  createdCount?: string;
  providers: EmailProviderCard[];
  status?: string;
}) {
  const statusCopy =
    status === "gmail-connected"
      ? "Gmail connection saved. Use Sync recent Gmail to import matched messages from known contacts."
      : status === "microsoft-connected"
        ? "Microsoft connection saved. Use Sync recent Microsoft mail to import matched messages from known contacts."
      : status === "gmail-synced"
        ? `Recent Gmail sync finished. Imported ${createdCount ?? "0"} matched message${createdCount === "1" ? "" : "s"}.`
        : status === "microsoft-synced"
          ? `Recent Microsoft mail sync finished. Imported ${createdCount ?? "0"} matched message${createdCount === "1" ? "" : "s"}.`
        : status === "gmail-sync-error"
          ? "Recent Gmail sync was not completed. Reconnect Gmail or check provider configuration."
          : status === "microsoft-sync-error"
            ? "Recent Microsoft mail sync was not completed. Reconnect Microsoft or check provider configuration."
      : status === "gmail-error"
        ? "Gmail connection was not completed. Check provider configuration and try again."
        : status === "microsoft-error"
          ? "Microsoft connection was not completed. Check provider configuration and try again."
        : null;

  return (
    <section className="panel" id="email-connections" style={{ marginBottom: 16 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Email Connections</h2>
        <span className="badge">Manual logging available</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 16 }}>
        Use manual email logging on deals, contacts, organizations, and leads today. Password reset delivery runs through
        the background job queue when webhook email is configured. Gmail / Google Workspace and Microsoft 365 / Outlook
        can connect when OAuth env and encrypted token storage are configured. Manual sync imports recent matched
        metadata/snippets from known contacts only.
      </p>
      {statusCopy ? <p className="empty-copy">{statusCopy}</p> : null}
      <div className="provider-card-grid">
        {providers.map((provider) => (
          <div className="provider-card" key={provider.name}>
            <div>
              <h3>{provider.name}</h3>
              <span className="badge">{provider.status}</span>
            </div>
            <p>{provider.detail}</p>
            {provider.accountEmail ? <p>Connected account: {provider.accountEmail}</p> : null}
            {provider.lastSyncAt ? <p>Last sync: {formatDate(provider.lastSyncAt)}</p> : null}
            {provider.scopes.length > 0 ? <p>Scopes: {provider.scopes.join(", ")}</p> : null}
            {provider.disabled || !provider.href ? (
              <button className="button-secondary button-compact" disabled type="button">
                {provider.actionLabel}
              </button>
            ) : (
              <div className="filter-actions">
                <Link className="button-secondary button-compact" href={provider.href as Route}>
                  {provider.actionLabel}
                </Link>
                {provider.syncAvailable ? (
                  <form action={provider.provider === "MICROSOFT_365" ? syncRecentMicrosoftAction : syncRecentGmailAction}>
                    <button className="button-secondary button-compact" type="submit">
                      {provider.syncLabel ?? "Sync recent Gmail"}
                    </button>
                  </form>
                ) : null}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
