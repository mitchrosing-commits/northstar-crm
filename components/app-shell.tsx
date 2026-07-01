import { Sparkles } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { logoutAction } from "@/app/logout/actions";
import { PrimaryNav } from "@/components/primary-nav";
import { switchWorkspaceAction } from "@/app/workspaces/actions";
import { getRequestContext } from "@/lib/auth/request-context";
import { listWorkspaceMembershipOptions } from "@/lib/services/crm";

export const appShellNavigationManifest = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { href: "/pipeline", label: "Pipeline", icon: "PanelsTopLeft" },
  { href: "/deals", label: "Deals", icon: "CircleDollarSign" },
  { href: "/contacts", label: "Contacts", icon: "Contact" },
  { href: "/organizations", label: "Organizations", icon: "Building2" },
  { href: "/leads", label: "Leads", icon: "Contact" },
  { href: "/activities", label: "Activities", icon: "CalendarCheck" },
  { href: "/email", label: "Email", icon: "Inbox" },
  { href: "/reports", label: "Reports", icon: "BarChart3" },
  { href: "/products", label: "Products", icon: "Package" },
  { href: "/search", label: "Search", icon: "Search" },
  { href: "/custom-fields", label: "Custom Fields", icon: "SlidersHorizontal" },
  { href: "/settings", label: "Settings", icon: "Settings" }
] as const;

type AppShellProps = {
  children: React.ReactNode;
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
};

export async function AppShell({ children, workspace }: AppShellProps) {
  const { actorUserId, user } = await getRequestContext();
  const workspaceOptions = await listWorkspaceMembershipOptions(actorUserId);
  const currentWorkspace = workspaceOptions.find((option) => option.workspaceId === workspace.id);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={18} aria-hidden="true" />
          </span>
          <span>Northstar CRM</span>
        </div>
        <PrimaryNav />
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
              <button className="sidebar-action" type="submit">
                Switch
              </button>
            </form>
          ) : null}
          <p className="signed-in-user">{user.name ?? user.email}</p>
          <Link className="sidebar-action sidebar-settings-link" href={"/settings" as Route}>
            Settings
          </Link>
          <form action={logoutAction}>
            <button className="sidebar-action" type="submit">
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
