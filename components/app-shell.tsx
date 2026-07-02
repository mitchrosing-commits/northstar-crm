import { Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { logoutAction } from "@/app/logout/actions";
import { PrimaryNav } from "@/components/primary-nav";
import { SidebarCommand } from "@/components/sidebar-command";
import { switchWorkspaceAction } from "@/app/workspaces/actions";
import { getRequestContext } from "@/lib/auth/request-context";
import { listWorkspaceMembershipOptions } from "@/lib/services/crm";
export { appShellNavigationManifest } from "@/lib/navigation";

type AppShellProps = {
  children: React.ReactNode;
  globalSearchDefaultValue?: string;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
};

export async function AppShell({ children, globalSearchDefaultValue, workspace }: AppShellProps) {
  const { actorUserId, user } = await getRequestContext();
  const workspaceOptions = await listWorkspaceMembershipOptions(actorUserId);
  const currentWorkspace = workspaceOptions.find((option) => option.workspaceId === workspace.id);
  const settingsActionLabel = `Open workspace settings for ${workspace.name}`;
  const switchWorkspaceLabel = "Switch active workspace";
  const signOutActionLabel = "Sign out of Northstar CRM";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside aria-label="Workspace navigation" className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <span>Northstar CRM</span>
        </div>
        <PrimaryNav />
        <SidebarCommand globalSearchDefaultValue={globalSearchDefaultValue} />
        <div className="workspace-card">
          <p className="workspace-name">{workspace.name}</p>
          <p className="workspace-slug">{workspace.slug}</p>
          {currentWorkspace ? <p className="workspace-role">{currentWorkspace.roleLabel}</p> : null}
          {workspaceOptions.length > 1 ? (
            <form action={switchWorkspaceAction} className="workspace-switcher">
              <label className="sr-only" htmlFor="workspaceId">
                Active workspace
              </label>
              <select className="workspace-select" defaultValue={workspace.id} id="workspaceId" name="workspaceId">
                {workspaceOptions.map((option) => (
                  <option key={option.workspaceId} value={option.workspaceId}>
                    {option.name}
                  </option>
                ))}
              </select>
              <button aria-label={switchWorkspaceLabel} className="sidebar-action" title={switchWorkspaceLabel} type="submit">
                Switch
              </button>
            </form>
          ) : null}
          <p className="signed-in-user">{user.name ?? user.email}</p>
          <Link
            aria-label={settingsActionLabel}
            className="sidebar-action sidebar-settings-link"
            href={"/settings" as Route}
            title={settingsActionLabel}
          >
            Settings
          </Link>
          <form action={logoutAction}>
            <button aria-label={signOutActionLabel} className="sidebar-action" title={signOutActionLabel} type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="main" id="main-content">
        {children}
      </main>
    </div>
  );
}
