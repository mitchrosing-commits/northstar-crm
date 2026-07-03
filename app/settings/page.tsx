import Link from "next/link";
import type { Route } from "next";

import { ActionGroup } from "@/components/action-group";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { formatDate } from "@/components/format";
import { InlineEmptyStateText } from "@/components/inline-empty-state-text";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { StatCard } from "@/components/stat-card";
import { TableScroll } from "@/components/table-scroll";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { resolveAuthMode } from "@/lib/auth/session";
import { passwordResetEmailReadiness, workspaceInvitationEmailReadiness } from "@/lib/email/auth-email";
import {
  getWorkspaceMembershipSummary,
  getSupplyChainVerticalSetupStatus,
  isTokenEncryptionConfigured,
  listEmailConnectionProviderCards,
  listEmailTemplates,
  listPendingWorkspaceInvitations,
  listPipelines,
} from "@/lib/services/crm";
import type { EmailProviderCard } from "@/lib/services/crm";
import {
  removeWorkspaceMemberAction,
  revokeWorkspaceInvitationAction,
  transferWorkspaceOwnershipAction,
  updateWorkspaceMemberRoleAction,
} from "@/app/workspaces/actions";
import { AccountSettingsForm } from "./account-settings-form";
import {
  createPipelineStageSettingsAction,
  syncRecentGmailAction,
  syncRecentMicrosoftAction,
  updatePipelineSettingsAction,
  updatePipelineStageSettingsAction,
} from "./actions";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { EmailTemplatesPanel } from "./email-templates-panel";
import { SettingsGuideCard } from "./settings-guide-card";
import { SettingsSection } from "./settings-section";
import { SupplyChainVerticalPanel } from "./supply-chain-vertical-panel";
import { WorkspaceInviteForm } from "./workspace-invite-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    created?: string;
    emailConnection?: string;
    supplyChainSetup?: string;
  }>;
}) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actor, actorUserId, user } =
    await getCurrentWorkspaceContext();
  const [
    summary,
    emailTemplates,
    emailProviderCards,
    pipelines,
    supplyChainSetupStatus,
  ] = await Promise.all([
    getWorkspaceMembershipSummary(actor),
    listEmailTemplates(actor),
    listEmailConnectionProviderCards(actor),
    listPipelines(actor),
    getSupplyChainVerticalSetupStatus(actor),
  ]);
  const pendingInvitations = summary.currentMembership
    .canManageWorkspaceSettings
    ? await listPendingWorkspaceInvitations(actor)
    : [];
  const invitationEmailReadiness = workspaceInvitationEmailReadiness(process.env);
  const adminMemberCount = summary.members.filter(
    (member) => member.canManageWorkspaceSettings,
  ).length;
  const currentUserIsOwner = summary.currentMembership.role === "OWNER";
  const importExportActionLabel = "Open import and export settings";
  const developerApiActionLabel = "Open developer API surface";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Workspace"
        subtitle="Account, workspace, email, pipeline, imports, and admin controls."
        title="Settings"
      />

      <section className="stat-grid">
        <StatCard
          label="Workspace"
          value={summary.workspace.name}
          valueClassName="stat-value-compact"
        />
        <StatCard label="Members" value={summary.members.length} />
        <StatCard
          label="Your role"
          value={summary.currentMembership.roleLabel}
          valueClassName="stat-value-compact"
        />
        <StatCard
          label="Settings access"
          value={
            summary.currentMembership.canManageWorkspaceSettings
              ? "Admin"
              : "Member"
          }
          valueClassName="stat-value-compact"
        />
      </section>

      <section className="panel section-separated">
        <PanelTitleRow title="Account" />
        <AccountSettingsForm
          currentName={user.name}
          email={user.email}
          roleLabel={summary.currentMembership.roleLabel}
          workspaceName={workspace.name}
        />
      </section>

      <AdminReadinessPanel />
      <AdminGuidePanel />
      <SupplyChainVerticalPanel
        setupStatus={resolvedSearchParams?.supplyChainSetup}
        status={supplyChainSetupStatus}
      />

      <SettingsSection
        action={
          <Link
            aria-label={importExportActionLabel}
            className="button-secondary"
            href="/settings/import-export"
            title={importExportActionLabel}
          >
            Open import/export
          </Link>
        }
        intro="Download workspace-scoped CSV exports or preview CSV imports before creating records."
        introClassName="empty-copy"
        title="Import / Export"
      />

      <SettingsSection
        action={
          <Link
            aria-label={developerApiActionLabel}
            className="button-secondary"
            href={"/settings/developer-api" as Route}
            title={developerApiActionLabel}
          >
            Open API surface
          </Link>
        }
        intro="Review the workspace-scoped REST surface, OpenAPI reference files, CSV export endpoints, and planned API key and webhook controls."
        introClassName="empty-copy"
        title="Developer / API"
      />

      <EmailTemplatesPanel
        templates={emailTemplates}
        workspaceId={workspace.id}
      />
      <EmailConnectionsPanel
        createdCount={resolvedSearchParams?.created}
        providers={emailProviderCards}
        status={resolvedSearchParams?.emailConnection}
      />

      {summary.currentMembership.canManageWorkspaceSettings ? (
        <PipelineSettingsPanel pipelines={pipelines} />
      ) : null}

      <SettingsSection
        badge="Production-safe"
        intro="Use local auth for hosted company workspaces. Demo auth and seed data are for demo-only environments, not company-use databases."
        introClassName="empty-copy form-callout-copy"
        title="Hosted Use Notes"
      >
        <p className="empty-copy">
          Gmail sync requires Google OAuth env vars and a redirect URI that
          matches this hosted app. Auth email delivery requires the
          auth email webhook env vars and a worker or scheduled job run. Keep
          secrets in the hosting platform; do not commit local env files.
        </p>
      </SettingsSection>

      <SettingsSection
        intro="Create a separate workspace for another team or account. You become the owner, duplicate names are allowed, and the new workspace becomes active after creation."
        title="Create Workspace"
      >
        <CreateWorkspaceForm />
      </SettingsSection>

      {summary.currentMembership.canManageWorkspaceSettings ? (
        <section className="panel section-separated">
          <PanelTitleRow
            actions={<Badge>{invitationEmailReadiness.configured ? "Email delivery configured" : "Manual link fallback"}</Badge>}
            title="Team / Workspace Invitations"
          />
          <p className="empty-copy section-separated">
            Invite a teammate by email. If they do not have a Northstar account
            yet, they can create one from the invite flow and then accept the
            shared link. {invitationEmailReadiness.configured
              ? "Invitation emails are queued for the background worker, and the manual accept link remains available below."
              : "Invitation email delivery is not configured, so share the accept link manually from the pending invitations table."}
          </p>
          <WorkspaceInviteForm />
          <TableScroll
            aria-label="Pending workspace invitations table"
            className="section-spaced"
          >
            <table className="table crm-list-table">
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
                  pendingInvitations.map((invitation) => {
                    const openInvitationLabel = `Open invitation link for ${invitation.email}`;
                    const revokeInvitationLabel = `Revoke invitation for ${invitation.email}`;
                    const invitationActionsLabel = `${invitation.email} invitation actions`;

                    return (
                      <tr key={invitation.id}>
                        <td data-label="Email">
                          <span className="table-primary-cell">
                            <strong>{invitation.email}</strong>
                          </span>
                        </td>
                        <td data-label="Role">
                          <Badge label={`${invitation.email} invited role: ${invitation.roleLabel}`}>
                            {invitation.roleLabel}
                          </Badge>
                        </td>
                        <td data-label="Invited by">
                          {invitation.invitedBy?.name ?? invitation.invitedBy?.email ?? (
                            <InlineEmptyStateText>Unknown</InlineEmptyStateText>
                          )}
                        </td>
                        <td data-label="Invite link">
                          <Link
                            aria-label={openInvitationLabel}
                            className="inline-link"
                            href={`/workspaces/invitations/${invitation.id}`}
                            title={openInvitationLabel}
                          >
                            Open invite link
                          </Link>
                        </td>
                        <td className="table-actions-cell" data-label="Action">
                          <ActionGroup className="table-row-actions" label={invitationActionsLabel}>
                            <form action={revokeWorkspaceInvitationAction}>
                              <input
                                name="invitationId"
                                type="hidden"
                                value={invitation.id}
                              />
                              <button
                                aria-label={revokeInvitationLabel}
                                className="button-secondary button-compact"
                                title={revokeInvitationLabel}
                                type="submit"
                              >
                                Revoke
                              </button>
                            </form>
                          </ActionGroup>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} data-label="Invitations">
                      <InlineEmptyStateText>No pending invitations.</InlineEmptyStateText>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
        </section>
      ) : null}

      <section className="panel">
        <PanelTitleRow title="Workspace Members" />
        <p className="empty-copy section-separated">
          Active members with access to this workspace. Owners can transfer
          ownership or change Admin/Member roles. Transferring ownership
          immediately makes that member the owner and moves you to Admin.
          Removing a member does not delete that user&apos;s account or CRM
          records.
        </p>
        <TableScroll aria-label="Workspace members table">
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Access</th>
                <th>Joined</th>
                {summary.currentMembership.canManageWorkspaceSettings ? (
                  <th>Action</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {summary.members.map((member) => {
                return (
                  <tr key={member.id}>
                    <td data-label="Member">
                      <div className="table-primary-cell">
                        <strong>{member.name ?? member.email}</strong>
                        <span className="table-secondary-text">
                          {member.email}
                        </span>
                      </div>
                    </td>
                    <td data-label="Role">
                      <Badge label={`${member.email} workspace role: ${member.roleLabel}`}>
                        {member.roleLabel}
                      </Badge>
                    </td>
                    <td data-label="Access">
                      {member.canManageWorkspaceSettings
                        ? "Settings admin"
                        : "Workspace member"}
                    </td>
                    <td data-label="Joined">{formatDate(member.joinedAt)}</td>
                    {summary.currentMembership.canManageWorkspaceSettings ? (
                      <td className="table-actions-cell" data-label="Action">
                        <WorkspaceMemberActions
                          actorUserId={actorUserId}
                          adminMemberCount={adminMemberCount}
                          currentUserIsOwner={currentUserIsOwner}
                          member={member}
                        />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </section>
    </AppShell>
  );
}

type WorkspaceMemberSummary = Awaited<
  ReturnType<typeof getWorkspaceMembershipSummary>
>["members"][number];

function WorkspaceMemberActions({
  actorUserId,
  adminMemberCount,
  currentUserIsOwner,
  member,
}: {
  actorUserId: string;
  adminMemberCount: number;
  currentUserIsOwner: boolean;
  member: WorkspaceMemberSummary;
}) {
  if (member.userId === actorUserId) {
    return <MemberActionStatus label="Current user" />;
  }
  if (member.role === "OWNER") {
    return <MemberActionStatus label="Owner removal blocked" />;
  }
  if (member.canManageWorkspaceSettings && adminMemberCount <= 1) {
    return <MemberActionStatus label="Last admin" />;
  }

  const membershipActionsLabel = `${member.email} membership actions`;
  const roleActionLabel =
    member.role === "ADMIN"
      ? `Make member: remove settings admin access for ${member.email}`
      : `Make admin: grant settings admin access to ${member.email}`;
  const transferOwnerLabel = `Transfer workspace ownership to ${member.email}`;
  const removeMemberLabel = `Remove ${member.email} from workspace`;
  const canRemoveMember = member.role !== "ADMIN" || currentUserIsOwner;

  return (
    <ActionGroup className="table-row-actions" label={membershipActionsLabel}>
      {currentUserIsOwner ? (
        <>
          <form action={updateWorkspaceMemberRoleAction}>
            <input name="membershipId" type="hidden" value={member.id} />
            <input
              name="role"
              type="hidden"
              value={member.role === "ADMIN" ? "MEMBER" : "ADMIN"}
            />
            <button
              aria-label={roleActionLabel}
              className="button-secondary button-compact"
              title={roleActionLabel}
              type="submit"
            >
              {member.role === "ADMIN" ? "Make member" : "Make admin"}
            </button>
          </form>
          <form action={transferWorkspaceOwnershipAction}>
            <input name="membershipId" type="hidden" value={member.id} />
            <button
              aria-label={transferOwnerLabel}
              className="button-secondary button-compact"
              title={transferOwnerLabel}
              type="submit"
            >
              Transfer owner
            </button>
          </form>
        </>
      ) : member.role === "ADMIN" ? (
        <MemberActionStatus label="Owner action required" />
      ) : null}
      {canRemoveMember ? (
        <form action={removeWorkspaceMemberAction}>
          <input name="membershipId" type="hidden" value={member.id} />
          <button
            aria-label={removeMemberLabel}
            className="button-secondary button-compact"
            title={removeMemberLabel}
            type="submit"
          >
            Remove
          </button>
        </form>
      ) : null}
    </ActionGroup>
  );
}

function MemberActionStatus({ label }: { label: string }) {
  return (
    <Badge className="badge settings-member-action-status" label={label}>
      {label}
    </Badge>
  );
}

type PipelineRecord = Awaited<ReturnType<typeof listPipelines>>[number];

function PipelineSettingsPanel({ pipelines }: { pipelines: PipelineRecord[] }) {
  const pipeline = pipelines[0];
  const savePipelineLabel = pipeline ? `Save pipeline settings for ${pipeline.name}` : "Save pipeline settings";
  const addStageLabel = pipeline ? `Add stage to ${pipeline.name}` : "Add pipeline stage";

  return (
    <SettingsSection
      badge="Workspace admin"
      id="pipeline-settings"
      intro={
        <>
          Keep the default New Business pipeline aligned to your sales process.
          Rename the pipeline or stages, and add a new stage when your workflow
          needs one. Stage reordering and deletion are intentionally deferred
          until there is a safe move path for active deals.
        </>
      }
      title="Pipeline / Stage Settings"
    >
      {pipeline ? (
        <div className="pipeline-settings-grid">
          <form action={updatePipelineSettingsAction} className="inline-form">
            <input name="pipelineId" type="hidden" value={pipeline.id} />
            <label className="form-field">
              <FormFieldLabel required>Pipeline name</FormFieldLabel>
              <input name="name" required defaultValue={pipeline.name} />
            </label>
            <FormActionBar compact isSaving={false} submitActionLabel={savePipelineLabel} submitLabel="Save pipeline" />
          </form>

          <div className="quote-draft-list">
            {pipeline.stages.map((stage) => {
              const stageActionsLabel = `${stage.name} stage actions`;
              const saveStageLabel = `Save stage settings for ${stage.name}`;

              return (
                <form
                  action={updatePipelineStageSettingsAction}
                  className="quote-draft-item inline-form"
                  key={stage.id}
                >
                  <input name="stageId" type="hidden" value={stage.id} />
                  <div className="form-grid">
                    <label className="form-field">
                      <FormFieldLabel required>Stage name</FormFieldLabel>
                      <input name="name" required defaultValue={stage.name} />
                    </label>
                    <label className="form-field">
                      <FormFieldLabel>Probability</FormFieldLabel>
                      <input
                        defaultValue={stage.probability ?? ""}
                        max={100}
                        min={0}
                        name="probability"
                        type="number"
                      />
                    </label>
                  </div>
                  <FormActionBar
                    actionsLabel={stageActionsLabel}
                    compact
                    isSaving={false}
                    submitActionLabel={saveStageLabel}
                    submitLabel="Save stage"
                  />
                  <p className="form-hint">Stage removal deferred.</p>
                </form>
              );
            })}
          </div>

          <form
            action={createPipelineStageSettingsAction}
            className="inline-form"
          >
            <input name="pipelineId" type="hidden" value={pipeline.id} />
            <div className="form-grid">
              <label className="form-field">
                <FormFieldLabel required>New stage</FormFieldLabel>
                <input name="name" placeholder="Legal review" required />
              </label>
              <label className="form-field">
                <FormFieldLabel>Probability</FormFieldLabel>
                <input
                  max={100}
                  min={0}
                  name="probability"
                  placeholder="70"
                  type="number"
                />
              </label>
            </div>
            <FormActionBar compact isSaving={false} submitActionLabel={addStageLabel} submitLabel="Add stage" />
          </form>
        </div>
      ) : (
        <EmptyState
          className="empty-state-compact empty-state-panel pipeline-settings-empty"
          description="New workspaces normally include a New Business pipeline. If this workspace is missing one, recreate the default pipeline before editing stages."
          title="No pipeline is available yet"
        />
      )}
    </SettingsSection>
  );
}

function AdminReadinessPanel() {
  const statuses = buildAdminReadinessStatuses();

  return (
    <SettingsSection
      badge="Hosted setup"
      intro="Quick operational checks for a hosted Northstar workspace. Secret values are never shown here."
      title="Admin Readiness Checklist"
    >
      <div className="readiness-grid">
        {statuses.map((status) => (
          <div className="readiness-item" key={status.label}>
            <Badge
              className={status.configured ? "badge badge-qualified" : "badge"}
              label={`${status.label}: ${status.configured ? "Configured" : "Needs setup"}`}
            >
              {status.configured ? "Configured" : "Needs setup"}
            </Badge>
            <strong>{status.label}</strong>
            <p>{status.detail}</p>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

function AdminGuidePanel() {
  return (
    <SettingsSection
      badge="Admin hub"
      intro="Common setup paths for shaping the CRM, moving data safely, connecting email, and reviewing the developer surface."
      title="Admin Guide"
    >
      <div
        className="settings-guide-grid section-spaced"
        aria-label="Settings admin guide"
      >
        <SettingsGuideCard
          actionLabel="Configure custom fields"
          href="/custom-fields"
          title="Data model"
        >
          <p className="empty-copy">
            Define custom fields for deals, contacts, organizations, and leads.
          </p>
        </SettingsGuideCard>
        <SettingsGuideCard
          actionLabel="Open import/export"
          href="/settings/import-export"
          title="Data movement"
        >
          <p className="empty-copy">
            Export workspace snapshots or preview CSV imports before creating
            records.
          </p>
        </SettingsGuideCard>
        <SettingsGuideCard
          actionLabel="Review email connections"
          href="#email-connections"
          title="Email setup"
        >
          <p className="empty-copy">
            Connect providers when OAuth is configured, or keep logging email
            manually.
          </p>
        </SettingsGuideCard>
        <SettingsGuideCard
          actionLabel="Open developer API"
          href={"/settings/developer-api" as Route}
          title="Developer surface"
        >
          <p className="empty-copy">
            Review workspace-scoped routes, exports, and API documentation.
          </p>
        </SettingsGuideCard>
      </div>
    </SettingsSection>
  );
}

function buildAdminReadinessStatuses() {
  const authMode = resolveAuthMode();
  const hasAppBaseUrl = Boolean(process.env.APP_BASE_URL?.trim());
  const hasEmailEncryption = isTokenEncryptionConfigured(process.env);
  const hasGoogleOauth = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() &&
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() &&
    hasEmailEncryption,
  );
  const hasMicrosoftOauth = Boolean(
    process.env.MICROSOFT_OAUTH_CLIENT_ID?.trim() &&
    process.env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim() &&
    process.env.MICROSOFT_OAUTH_REDIRECT_URI?.trim() &&
    hasEmailEncryption,
  );
  const passwordResetReadiness = passwordResetEmailReadiness(process.env);
  const invitationEmailReadiness = workspaceInvitationEmailReadiness(process.env);
  const passwordResetDetail = passwordResetReadiness.configured
    ? `Configured through ${passwordResetReadiness.deliveryMethod === "resend" ? "Resend" : "webhook"}. Worker required: yes - run npm run jobs:work as a Railway worker service.`
    : "Not configured. Set APP_BASE_URL plus RESEND_API_KEY and AUTH_EMAIL_FROM, or APP_BASE_URL plus AUTH_EMAIL_WEBHOOK_URL. Worker required after configuration: yes.";
  const invitationEmailDetail = invitationEmailReadiness.configured
    ? `Invitation email is queued through ${invitationEmailReadiness.deliveryMethod === "resend" ? "Resend" : "webhook"}. Manual invite links remain available.`
    : "Manual invite links remain available. Configure APP_BASE_URL plus RESEND_API_KEY and AUTH_EMAIL_FROM, or APP_BASE_URL plus AUTH_EMAIL_WEBHOOK_URL, to send invitation email.";

  return [
    {
      label: "Auth mode",
      configured: authMode === "local",
      detail:
        authMode === "local"
          ? "Local auth is enabled for hosted users."
          : "Use local auth for company workspaces.",
    },
    {
      label: "App base URL",
      configured: hasAppBaseUrl,
      detail: hasAppBaseUrl
        ? "Public URLs can be generated for callbacks and email links."
        : "Set APP_BASE_URL in the host.",
    },
    {
      label: "Gmail / Google Workspace",
      configured: hasGoogleOauth,
      detail: hasGoogleOauth
        ? "Google OAuth and encrypted token storage are configured."
        : "Configure Google OAuth env vars and token encryption.",
    },
    {
      label: "Microsoft 365 / Outlook",
      configured: hasMicrosoftOauth,
      detail: hasMicrosoftOauth
        ? "Microsoft OAuth and encrypted token storage are configured."
        : "Configure Microsoft OAuth env vars and token encryption.",
    },
    {
      label: "Password reset email",
      configured: passwordResetReadiness.configured,
      detail: passwordResetDetail,
    },
    {
      label: "Team invitations",
      configured: invitationEmailReadiness.configured,
      detail: invitationEmailDetail,
    },
    {
      label: "Import / export",
      configured: true,
      detail:
        "CSV export and preview-first imports are available from Settings.",
    },
    {
      label: "Demo data",
      configured: true,
      detail:
        "Seed/demo data is explicit and should not be run in company-use environments.",
    },
  ];
}

function EmailConnectionsPanel({
  createdCount,
  providers,
  status,
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
    <section className="panel section-separated" id="email-connections">
      <PanelTitleRow
        actions={<Badge>Manual logging available</Badge>}
        title="Email Connections"
      />
      <p className="empty-copy section-separated">
        Use manual email logging on deals, contacts, organizations, and leads
        today. Password reset delivery runs through the background job queue
        when webhook email is configured. Gmail / Google Workspace and Microsoft
        365 / Outlook can connect when OAuth env and encrypted token storage are
        configured. Manual sync imports recent matched metadata/snippets from
        known contacts only.
      </p>
      {statusCopy ? (
        <FormIntroCallout
          className="settings-status-callout"
          title="Connection status"
        >
          {statusCopy}
        </FormIntroCallout>
      ) : null}
      <div className="provider-card-grid">
        {providers.map((provider) => {
          const providerActionsLabel = `${provider.name} provider actions`;
          const providerPrimaryActionLabel = `${provider.actionLabel}: ${provider.name} provider setup`;
          const providerSyncLabel = provider.syncLabel ?? "Sync recent Gmail";
          const providerSyncActionLabel = `${providerSyncLabel}: import recent matched ${provider.name} messages`;

          return (
            <div className="provider-card" key={provider.name}>
              <CompactTitleRow
                actions={<Badge>{provider.status}</Badge>}
                title={provider.name}
              />
              <p>{provider.detail}</p>
              {provider.accountEmail ? (
                <p>Connected account: {provider.accountEmail}</p>
              ) : null}
              {provider.lastSyncAt ? (
                <p>Last sync: {formatDate(provider.lastSyncAt)}</p>
              ) : null}
              {provider.lastError ? (
                <p>Last sync issue: {provider.lastError}</p>
              ) : null}
              {provider.scopes.length > 0 ? (
                <p>Scopes: {provider.scopes.join(", ")}</p>
              ) : null}
              {provider.disabled || !provider.href ? (
                <button
                  aria-label={providerPrimaryActionLabel}
                  className="button-secondary button-compact"
                  disabled
                  title={providerPrimaryActionLabel}
                  type="button"
                >
                  {provider.actionLabel}
                </button>
              ) : (
                <ActionGroup
                  className="filter-actions"
                  label={providerActionsLabel}
                >
                  <Link
                    aria-label={providerPrimaryActionLabel}
                    className="button-secondary button-compact"
                    href={provider.href as Route}
                    title={providerPrimaryActionLabel}
                  >
                    {provider.actionLabel}
                  </Link>
                  {provider.syncAvailable ? (
                    <form
                      action={
                        provider.provider === "MICROSOFT_365"
                          ? syncRecentMicrosoftAction
                          : syncRecentGmailAction
                      }
                    >
                      <button
                        aria-label={providerSyncActionLabel}
                        className="button-secondary button-compact"
                        title={providerSyncActionLabel}
                        type="submit"
                      >
                        {providerSyncLabel}
                      </button>
                    </form>
                  ) : null}
                </ActionGroup>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
