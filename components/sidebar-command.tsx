"use client";

import {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Contact,
  Inbox,
  LayoutDashboard,
  Package,
  PanelsTopLeft,
  Search,
  Settings,
  SlidersHorizontal,
  X,
  type LucideIcon
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";

import { ActionGroup } from "@/components/action-group";
import { queryListHref } from "@/lib/search-create-actions";
import { SidebarSearchShortcut } from "@/components/sidebar-search-shortcut";
import { searchListNavigationItems, sidebarJumpNavigationItems, type AppNavigationIconName } from "@/lib/navigation";

type SidebarCommandProps = {
  globalSearchDefaultValue?: string;
};

type SidebarQuickAction = {
  helper: string;
  href: Route;
  icon: LucideIcon;
  label: string;
};

const sidebarJumpActionIcons: Record<AppNavigationIconName, LucideIcon> = {
  BarChart3,
  BrainCircuit,
  Building2,
  CalendarCheck,
  CircleDollarSign,
  Contact,
  Inbox,
  LayoutDashboard,
  Package,
  PanelsTopLeft,
  Search,
  Settings,
  SlidersHorizontal
};

const sidebarJumpActions: SidebarQuickAction[] = sidebarJumpNavigationItems.map((item) => ({
  href: item.href,
  label: item.label,
  helper: item.helper,
  icon: sidebarJumpActionIcons[item.icon]
}));

const globalActionsLabel = "Global actions";
const quickActionsLabel = "Quick actions";
const searchFormLabel = "Search workspace records";
const submitSearchLabel = "Submit workspace search";

export function SidebarCommand({ globalSearchDefaultValue }: SidebarCommandProps) {
  const pathname = usePathname() ?? "";
  const generatedSearchId = useId();
  const searchInputId = `${generatedSearchId}-global-search`;
  const searchHelperId = `${generatedSearchId}-sidebar-command-helper`;
  const searchValue = globalSearchDefaultValue?.trim() ?? "";
  const hasSearchValue = searchValue.length > 0;
  const clearSearchActionLabel = hasSearchValue ? clearSearchLabel(searchValue) : "";
  const findActions = hasSearchValue
    ? searchListNavigationItems.map((item) => ({
        href: queryListHref(item.href, searchValue),
        label: item.label,
        helper: sidebarSearchListHelper(item.label, searchValue),
        icon: sidebarJumpActionIcons[item.icon]
      }))
    : [];
  const sidebarQuickActionGroups: Array<{ actions: SidebarQuickAction[]; label: string }> = [
    ...(findActions.length > 0 ? [{ label: "Find", actions: findActions }] : []),
    { label: "Jump", actions: sidebarJumpActions }
  ];

  return (
    <section aria-label={globalActionsLabel} className="sidebar-command" title={globalActionsLabel}>
      <SidebarSearchShortcut inputId={searchInputId} />
      <div className="sidebar-command-header">
        <p className="sidebar-command-eyebrow">Command</p>
        <p className="sidebar-command-copy">Search and jump without leaving the workspace flow.</p>
      </div>
      <form
        action="/search"
        aria-describedby={searchHelperId}
        aria-label={searchFormLabel}
        className="sidebar-search"
        role="search"
        title={searchFormLabel}
      >
        <label className="sr-only" htmlFor={searchInputId}>
          Search workspace
        </label>
        <Search size={15} aria-hidden="true" />
        <input
          aria-keyshortcuts="/ Meta+K Control+K"
          defaultValue={globalSearchDefaultValue}
          id={searchInputId}
          name="q"
          placeholder="Search records..."
          type="search"
        />
        <button aria-label={submitSearchLabel} title={submitSearchLabel} type="submit">
          Go
        </button>
      </form>
      <p className="sidebar-command-helper" id={searchHelperId}>
        {hasSearchValue
          ? "Open matching list shortcuts for this search."
          : "Use page-level New buttons for contacts, organizations, leads, deals, and activities."}
      </p>
      {hasSearchValue ? (
        <div aria-label="Active workspace search" className="sidebar-current-query">
          <span>
            <small>Searching</small>
            <strong>{searchValue}</strong>
          </span>
          <Link
            aria-label={clearSearchActionLabel}
            className="sidebar-current-query-clear"
            href={"/search" as Route}
            title={clearSearchActionLabel}
          >
            <X size={13} aria-hidden="true" />
            <span>Clear</span>
          </Link>
        </div>
      ) : null}
      <ActionGroup className="sidebar-quick-actions" label={quickActionsLabel}>
        {sidebarQuickActionGroups.map((group) => {
          const headingId = `sidebar-quick-actions-${group.label.toLowerCase()}`;
          return (
            <section className="sidebar-quick-action-group" aria-labelledby={headingId} key={group.label} role="group">
              <p className="sidebar-quick-action-label" id={headingId}>
                {group.label}
              </p>
              <div className="sidebar-quick-action-grid">
                {group.actions.map((action) => {
                  const Icon = action.icon;
                  const actionTitle = `${action.label}: ${action.helper}`;
                  const isActive = quickActionMatchesPathname(pathname, action.href);
                  return (
                    <Link
                      aria-current={isActive ? "page" : undefined}
                      aria-label={isActive ? `Current shortcut: ${actionTitle}` : actionTitle}
                      className={isActive ? "sidebar-quick-action sidebar-quick-action-active" : "sidebar-quick-action"}
                      href={action.href}
                      key={`${group.label}-${action.href}`}
                      title={actionTitle}
                    >
                      <span className="sidebar-quick-action-icon">
                        <Icon size={14} aria-hidden="true" />
                      </span>
                      <span>
                        <strong>{action.label}</strong>
                        <small>{action.helper}</small>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </ActionGroup>
    </section>
  );
}

function clearSearchLabel(searchValue: string) {
  return `Clear workspace search for ${searchValue}`;
}

function sidebarSearchListHelper(label: string, searchValue: string) {
  return `Find "${searchValue}" in ${label.toLowerCase()}`;
}

function quickActionMatchesPathname(pathname: string, href: Route) {
  const hrefPath = String(href).split("?")[0];
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}
