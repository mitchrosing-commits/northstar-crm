import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const workspaceActions = readFileSync(join(process.cwd(), "app/workspaces/actions.ts"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const inviteForm = readFileSync(join(process.cwd(), "app/settings/workspace-invite-form.tsx"), "utf8");
const acceptPage = readFileSync(join(process.cwd(), "app/workspaces/invitations/[invitationId]/page.tsx"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

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
    expect(workspaceService).toContain("status: WorkspaceInvitationStatus.PENDING");
    expect(workspaceService).toContain("revokeWorkspaceInvitation");
    expect(workspaceService).toContain("acceptWorkspaceInvitation");
    expect(workspaceService).toContain("removeWorkspaceMember");
    expect(workspaceService).toContain("ensureWorkspaceSettingsAdmin");
    expect(workspaceService).toContain("Workspace invitations cannot grant owner access.");
    expect(workspaceService).toContain("Invitations can only be created for existing users.");
    expect(workspaceService).toContain("A pending invitation already exists for this email.");
    expect(workspaceService).toContain("This invitation does not belong to the signed-in user.");
    expect(workspaceService).toContain("assertAcceptedInvitationStillHasMembership");
    expect(workspaceService).toContain("Workspace invitation was already accepted and is no longer available.");
    expect(workspaceService).toContain("Cannot remove the last workspace admin.");
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
    expect(workspaceActions).toContain("cookieStore.set(activeWorkspaceCookieName, workspace.id");
    expect(settingsPage).toContain("Workspace Invitations");
    expect(settingsPage).toContain("Workspace Members");
    expect(settingsPage).toContain("<WorkspaceInviteForm");
    expect(settingsPage).toContain("removeWorkspaceMemberAction");
    expect(settingsPage).toContain("updateWorkspaceMemberRoleAction");
    expect(settingsPage).toContain("transferWorkspaceOwnershipAction");
    expect(settingsPage).toContain("revokeWorkspaceInvitationAction");
    expect(inviteForm).toContain("useActionState(createWorkspaceInvitationAction");
    expect(inviteForm).toContain("Create invitation");
    expect(acceptPage).toContain("Accept invitation");
    expect(acceptPage).toContain("Invitation already accepted");
    expect(acceptPage).toContain("Continue to workspace");
    expect(acceptPage).toContain("signed in with the invited email address");
    expect(acceptPage).toContain("return await getWorkspaceInvitationForAcceptance(actorUserId, invitationId)");
    expect(acceptPage).toContain("redirect(`/login?next=/workspaces/invitations/${invitationId}`)");
  });

  it("documents no-email invitation limitations", () => {
    expect(routeMap).toContain("GET /workspaces/invitations/:invitationId");
    expect(routeMap).toContain("createWorkspaceInvitationAction");
    expect(routeMap).toContain("acceptWorkspaceInvitationAction");
    expect(routeMap).toContain("blocks old accepted links after member removal");
    expect(routeMap).toContain("removeWorkspaceMemberAction");
    expect(currentStatus).toContain("Workspace invitations are available for existing users only");
    expect(currentStatus).toContain("Owners/admins can remove non-admin workspace members");
    expect(currentStatus).toContain("No invitation email delivery is implemented");
    expect(currentStatus).toContain("accepted invitations are idempotent only while the accepted membership still exists");
  });
});
