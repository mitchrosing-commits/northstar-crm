import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);
const workspaceService = readFileSync(
  join(process.cwd(), "lib/services/workspace-service.ts"),
  "utf8",
);
const workspaceActions = readFileSync(
  join(process.cwd(), "app/workspaces/actions.ts"),
  "utf8",
);
const settingsPage = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);
const inviteForm = readFileSync(
  join(process.cwd(), "app/settings/workspace-invite-form.tsx"),
  "utf8",
);
const acceptPage = readFileSync(
  join(process.cwd(), "app/workspaces/invitations/[invitationId]/page.tsx"),
  "utf8",
);
const authPanel = readFileSync(
  join(process.cwd(), "components/auth-panel.tsx"),
  "utf8",
);
const tableScroll = readFileSync(
  join(process.cwd(), "components/table-scroll.tsx"),
  "utf8",
);
const routeMap = readFileSync(
  join(process.cwd(), "docs/api-route-map.md"),
  "utf8",
);
const currentStatus = readFileSync(
  join(process.cwd(), "docs/current-status.md"),
  "utf8",
);

describe("workspace invitations MVP", () => {
  it("adds a workspace-scoped invitation model with pending/accepted/revoked states", () => {
    expect(schema).toContain("model WorkspaceInvitation");
    expect(schema).toContain("enum WorkspaceInvitationStatus");
    expect(schema).toContain("PENDING");
    expect(schema).toContain("ACCEPTED");
    expect(schema).toContain("REVOKED");
    expect(schema).toContain("@@unique([workspaceId, email, status])");
    expect(schema).toContain("invitedById String?");
  });

  it("keeps invitation rules in the workspace service", () => {
    expect(workspaceService).toContain("createWorkspaceInvitation");
    expect(workspaceService).toContain("listPendingWorkspaceInvitations");
    expect(workspaceService).toContain(
      "status: WorkspaceInvitationStatus.PENDING",
    );
    expect(workspaceService).toContain("revokeWorkspaceInvitation");
    expect(workspaceService).toContain("acceptWorkspaceInvitation");
    expect(workspaceService).toContain("removeWorkspaceMember");
    expect(workspaceService).toContain("ensureWorkspaceSettingsAdmin");
    expect(workspaceService).toContain("normalizeInvitationRole");
    expect(workspaceService).toContain(
      "Workspace invitations cannot grant owner access.",
    );
    expect(workspaceService).toContain(
      "Workspace invitation role must be Admin or Member.",
    );
    expect(workspaceService).toContain("if (invitedUser)");
    expect(workspaceService).toContain(
      "A pending invitation already exists for this email.",
    );
    expect(workspaceService).toContain(
      "This invitation does not belong to the signed-in user.",
    );
    expect(workspaceService).toContain(
      "assertAcceptedInvitationStillHasMembership",
    );
    expect(workspaceService).toContain(
      "await tx.workspaceMembership.createMany",
    );
    expect(workspaceService).toContain("skipDuplicates: true");
    expect(workspaceService).toContain(
      "const accepted = await tx.workspaceInvitation.updateMany",
    );
    expect(workspaceService).toContain(
      "status: WorkspaceInvitationStatus.PENDING",
    );
    expect(workspaceService).toContain("handlePendingInvitationClaimMiss");
    expect(workspaceService).toContain(
      "assertAcceptedInvitationMembershipInTransaction",
    );
    expect(workspaceService).toContain("workspace: { deletedAt: null }");
    expect(workspaceService).toContain("if (accepted.count !== 1)");
    expect(
      workspaceService.indexOf(
        "const accepted = await tx.workspaceInvitation.updateMany",
      ),
    ).toBeLessThan(
      workspaceService.indexOf("await tx.workspaceMembership.createMany"),
    );
    expect(workspaceService).toContain(
      "Workspace invitation was already accepted and is no longer available.",
    );
    expect(workspaceService).toContain(
      "Cannot remove the last workspace admin.",
    );
    expect(workspaceService).toContain("Owner removal is not available yet.");
    expect(workspaceService).toContain("workspace_member.removed");
  });

  it("wires settings forms and accept links through server actions", () => {
    expect(workspaceActions).toContain("createWorkspaceInvitationAction");
    expect(workspaceActions).toContain("revokeWorkspaceInvitationAction");
    expect(workspaceActions).toContain("acceptWorkspaceInvitationAction");
    expect(workspaceActions).toContain("removeWorkspaceMemberAction");
    expect(workspaceActions).toContain("updateWorkspaceMemberRoleAction");
    expect(workspaceActions).toContain("transferWorkspaceOwnershipAction");
    expect(workspaceActions).toContain(
      "cookieStore.set(activeWorkspaceCookieName, workspace.id",
    );
    expect(workspaceActions).toContain("Invitation record created for");
    expect(workspaceActions).toContain(
      "Share the accept link from the pending invitations table.",
    );
    expect(settingsPage).toContain("Team / Workspace Invitations");
    expect(settingsPage).toContain("Manual link sharing");
    expect(settingsPage).toContain("Invite a teammate by email.");
    expect(settingsPage).toContain("they can create one from the invite");
    expect(settingsPage).toContain(
      "invitation email delivery is not configured",
    );
    expect(settingsPage).toContain(
      'aria-label="Pending workspace invitations table"',
    );
    expect(settingsPage).toContain("TableScroll");
    expect(settingsPage).toContain('className="section-spaced"');
    expect(settingsPage).toContain('className="table crm-list-table"');
    for (const dataLabel of [
      "Email",
      "Role",
      "Invited by",
      "Invite link",
      "Action",
      "Invitations",
      "Member",
      "Access",
      "Joined",
    ]) {
      expect(settingsPage).toContain(`data-label="${dataLabel}"`);
    }
    expect(settingsPage).toContain('className="table-actions-cell"');
    expect(settingsPage).toContain('className="table-primary-cell"');
    expect(settingsPage).toContain("<strong>{invitation.email}</strong>");
    expect(settingsPage).toContain(
      "const openInvitationLabel = `Open invitation link for ${invitation.email}`",
    );
    expect(settingsPage).toContain(
      "const revokeInvitationLabel = `Revoke invitation for ${invitation.email}`",
    );
    expect(settingsPage).toContain("aria-label={openInvitationLabel}");
    expect(settingsPage).toContain("title={openInvitationLabel}");
    expect(settingsPage).toContain("aria-label={revokeInvitationLabel}");
    expect(settingsPage).toContain("title={revokeInvitationLabel}");
    expect(tableScroll).toContain(
      'className={["table-scroll", className].filter(Boolean).join(" ")}',
    );
    expect(settingsPage).not.toContain('overflowX: "auto"');
    expect(settingsPage).toContain("empty-copy section-separated");
    expect(settingsPage).not.toContain("style={{ marginBottom: 16 }}");
    expect(settingsPage).toContain("Open invite link");
    expect(settingsPage).toContain("Hosted Use Notes");
    expect(settingsPage).toContain("empty-copy form-callout-copy");
    expect(settingsPage).toContain(
      "Use local auth for hosted company workspaces.",
    );
    expect(settingsPage).toContain(
      "Demo auth and seed data are for demo-only environments",
    );
    expect(settingsPage).toContain("Gmail sync requires Google OAuth env vars");
    expect(settingsPage).toContain("auth email webhook env vars");
    expect(settingsPage).toContain("Workspace Members");
    expect(settingsPage).toContain("<WorkspaceInviteForm");
    expect(inviteForm).toContain("import { FormFieldLabel }");
    expect(inviteForm).toContain("import { FormSuccessMessage }");
    expect(inviteForm).toContain(
      "<FormFieldLabel required>Email</FormFieldLabel>",
    );
    expect(inviteForm).toContain(
      "<FormFieldLabel required>Role</FormFieldLabel>",
    );
    expect(inviteForm).toContain(
      '<FormSuccessMessage compact id="workspace-invite-message">',
    );
    expect(inviteForm).not.toContain(
      '<p className="compact-success" id="workspace-invite-message" role="status">',
    );
    expect(settingsPage).toContain("removeWorkspaceMemberAction");
    expect(settingsPage).toContain("updateWorkspaceMemberRoleAction");
    expect(settingsPage).toContain("transferWorkspaceOwnershipAction");
    expect(settingsPage).not.toContain("style={{ marginBottom: 12 }}");
    expect(settingsPage).toContain("revokeWorkspaceInvitationAction");
    expect(inviteForm).toContain(
      "useActionState(createWorkspaceInvitationAction",
    );
    expect(inviteForm).toContain("Create invitation");
    expect(authPanel).toContain("export function AuthPanel");
    expect(acceptPage).toContain(
      'import { AuthPanel } from "@/components/auth-panel"',
    );
    expect(acceptPage).toContain('<AuthPanel eyebrow="Workspace Invitation">');
    expect(acceptPage).toContain(
      'import { EmptyState } from "@/components/empty-state"',
    );
    expect(acceptPage).toContain('className="workspace-invitation-state"');
    expect(acceptPage).toContain('actionsLabel="Invitation recovery actions"');
    expect(acceptPage).toContain('actionsLabel="Invitation actions"');
    expect(acceptPage).toContain("Accept invitation");
    expect(acceptPage).toContain("Invitation already accepted");
    expect(acceptPage).toContain("Continue to workspace");
    expect(acceptPage).toContain("const acceptInvitationActionLabel = alreadyAccepted");
    expect(acceptPage).toContain("`Accept invitation to ${invitation.workspace.name}`");
    expect(acceptPage).toContain("`Continue to workspace ${invitation.workspace.name}`");
    expect(acceptPage).toContain("aria-label={acceptInvitationActionLabel}");
    expect(acceptPage).toContain("title={acceptInvitationActionLabel}");
    expect(acceptPage).not.toContain('<main className="login-page">');
    expect(acceptPage).not.toContain('<section className="login-panel">');
    expect(acceptPage).not.toContain(
      '<p className="empty-copy">{invitation.error}</p>',
    );
    expect(acceptPage).not.toContain(
      '<h1 className="page-title">Invitation unavailable</h1>',
    );
    expect(acceptPage).toContain(
      "create an account with the invited email address",
    );
    expect(acceptPage).toContain(
      "const invitationPath = workspaceInvitationPath(invitationId)",
    );
    expect(acceptPage).toContain(
      "const nextParam = encodeURIComponent(invitationPath)",
    );
    expect(acceptPage).toContain("href={`/signup?next=${nextParam}` as Route}");
    expect(acceptPage).toContain(
      "redirect(`/login?next=${encodeURIComponent(workspaceInvitationPath(invitationId))}`)",
    );
    expect(acceptPage).toContain(
      "function workspaceInvitationPath(invitationId: string)",
    );
    expect(acceptPage).toContain("encodeURIComponent(invitationId)");
    expect(acceptPage).toContain(
      "return await getWorkspaceInvitationForAcceptance(actorUserId, invitationId)",
    );
  });

  it("documents no-email invitation limitations", () => {
    expect(routeMap).toContain("GET /workspaces/invitations/:invitationId");
    expect(routeMap).toContain("createWorkspaceInvitationAction");
    expect(routeMap).toContain("acceptWorkspaceInvitationAction");
    expect(routeMap).toContain(
      "blocks old accepted links after member removal",
    );
    expect(routeMap).toContain("removeWorkspaceMemberAction");
    expect(currentStatus).toContain("Workspace invitations");
    expect(currentStatus).toContain(
      "Owners/admins can remove non-admin workspace members",
    );
    expect(currentStatus).toContain(
      "No invitation email delivery is implemented",
    );
    expect(currentStatus).toContain(
      "accepted invitations are idempotent only while the accepted membership still exists",
    );
  });
});
