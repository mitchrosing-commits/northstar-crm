import { BarChart3, Building2, CalendarCheck, CircleDollarSign, Contact, Inbox, LayoutDashboard, Package, PanelsTopLeft, Search, Settings, SlidersHorizontal, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { logoutAction } from "@/app/logout/actions";
import { switchWorkspaceAction } from "@/app/workspaces/actions";
import { getRequestContext } from "@/lib/auth/request-context";
import { listWorkspaceMembershipOptions } from "@/lib/services/crm";

const navItems: Array<{ href: Route; label: string; icon: LucideIcon }> = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/pipeline", label: "Pipeline", icon: PanelsTopLeft },
  { href: "/deals" as Route, label: "Deals", icon: CircleDollarSign },
  { href: "/contacts", label: "Contacts", icon: Contact },
  { href: "/organizations", label: "Organizations", icon: Building2 },
  { href: "/leads", label: "Leads", icon: Contact },
  { href: "/activities", label: "Activities", icon: CalendarCheck },
  { href: "/email" as Route, label: "Email", icon: Inbox },
  { href: "/reports" as Route, label: "Reports", icon: BarChart3 },
  { href: "/products" as Route, label: "Products", icon: Package },
  { href: "/search" as Route, label: "Search", icon: Search },
  { href: "/custom-fields" as Route, label: "Custom Fields", icon: SlidersHorizontal },
  { href: "/settings" as Route, label: "Settings", icon: Settings }
];

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
        <nav aria-label="Primary">
          <ul className="nav-list">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label}>
                  <Link className="nav-item" href={item.href}>
                    <Icon size={17} aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
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
