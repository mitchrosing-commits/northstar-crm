import type { Route } from "next";

export type AppNavigationGroup = "Work" | "System";

export type AppNavigationIconName =
  | "BarChart3"
  | "BrainCircuit"
  | "Building2"
  | "CalendarCheck"
  | "CircleDollarSign"
  | "Contact"
  | "FileText"
  | "Inbox"
  | "LayoutDashboard"
  | "Package"
  | "PanelsTopLeft"
  | "Search"
  | "Settings"
  | "SlidersHorizontal";

export type AppNavigationItem = {
  commandJump?: boolean;
  group: AppNavigationGroup;
  helper?: string;
  href: Route;
  icon: AppNavigationIconName;
  label: string;
  listDescription?: string;
  listSearchDescription?: string;
  primary?: boolean;
  searchDescription?: string;
  searchJump?: boolean;
  searchListOrder?: number;
};

export const appShellNavigationManifest: readonly AppNavigationItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    group: "Work",
    helper: "Command center",
    commandJump: true,
    searchDescription: "Return to the command center.",
    searchJump: true
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    icon: "PanelsTopLeft",
    group: "Work",
    helper: "Deal board",
    commandJump: true,
    searchDescription: "Review deal stages.",
    searchJump: true
  },
  {
    href: "/deals",
    label: "Deals",
    icon: "CircleDollarSign",
    group: "Work",
    helper: "List view",
    commandJump: true,
    listDescription: "Review open and closed opportunities.",
    listSearchDescription: "Open the deals list with this query.",
    searchListOrder: 10
  },
  {
    href: "/quotes" as Route,
    label: "Quotes",
    icon: "FileText",
    group: "Work",
    helper: "Quote review",
    commandJump: true,
    searchDescription: "Review quote snapshots and their related deals.",
    searchJump: true
  },
  {
    href: "/contacts",
    label: "Contacts",
    icon: "Contact",
    group: "Work",
    helper: "People",
    commandJump: true,
    listDescription: "Browse people and relationships.",
    listSearchDescription: "Open people matching this query.",
    searchListOrder: 30
  },
  {
    href: "/organizations",
    label: "Organizations",
    icon: "Building2",
    group: "Work",
    helper: "Accounts",
    commandJump: true,
    listDescription: "Browse accounts and companies.",
    listSearchDescription: "Open accounts matching this query.",
    searchListOrder: 40
  },
  {
    href: "/leads",
    label: "Leads",
    icon: "Contact",
    group: "Work",
    helper: "Prospects",
    commandJump: true,
    listDescription: "Review early opportunities.",
    listSearchDescription: "Open lead records matching this query.",
    searchListOrder: 50
  },
  {
    href: "/activities",
    label: "Activities",
    icon: "CalendarCheck",
    group: "Work",
    helper: "Work queue",
    commandJump: true,
    listDescription: "Browse follow-ups and tasks.",
    listSearchDescription: "Open the work queue with this query.",
    searchDescription: "Open the work queue.",
    searchJump: true,
    searchListOrder: 20
  },
  {
    href: "/email",
    label: "Inbox",
    icon: "Inbox",
    group: "Work",
    helper: "Mailbox + priority",
    commandJump: true,
    searchDescription: "Open synced email, Relationship Inbox priorities, Smart Labels, AI reply drafts, and follow-ups.",
    searchJump: true
  },
  {
    href: "/meeting-intelligence" as Route,
    label: "Meeting Intelligence",
    icon: "BrainCircuit",
    group: "Work",
    helper: "File to CRM",
    commandJump: true,
    searchDescription: "Analyze meeting notes into reviewable CRM updates.",
    searchJump: true
  },
  {
    href: "/reports",
    label: "Reports",
    icon: "BarChart3",
    group: "Work",
    helper: "Metrics",
    commandJump: false,
    primary: false,
    searchDescription: "Review sales operating metrics.",
    searchJump: true
  },
  { href: "/products", label: "Products", icon: "Package", group: "Work", primary: false },
  { href: "/search", label: "Search", icon: "Search", group: "System", primary: false },
  { href: "/custom-fields", label: "Custom Fields", icon: "SlidersHorizontal", group: "System", primary: false },
  {
    href: "/settings",
    label: "Settings",
    icon: "Settings",
    group: "System",
    helper: "Admin",
    commandJump: true,
    searchDescription: "Manage workspace setup and data tools.",
    searchJump: true
  }
] as const;

export const appNavigationGroups: AppNavigationGroup[] = ["Work", "System"];

export type SidebarJumpNavigationItem = AppNavigationItem & {
  commandJump: true;
  helper: string;
};

export const sidebarJumpNavigationItems = appShellNavigationManifest.filter(
  (item): item is SidebarJumpNavigationItem =>
    "commandJump" in item &&
    item.commandJump === true &&
    "helper" in item &&
    typeof item.helper === "string" &&
    item.helper.length > 0
);

export type SearchListNavigationItem = AppNavigationItem & {
  listDescription: string;
  listSearchDescription: string;
  searchListOrder: number;
};

export type SearchJumpNavigationItem = AppNavigationItem & {
  searchDescription: string;
  searchJump: true;
};

export const searchListNavigationItems = appShellNavigationManifest
  .filter(
    (item): item is SearchListNavigationItem =>
      "listDescription" in item &&
      typeof item.listDescription === "string" &&
      item.listDescription.length > 0 &&
      "listSearchDescription" in item &&
      typeof item.listSearchDescription === "string" &&
      item.listSearchDescription.length > 0 &&
      "searchListOrder" in item &&
      typeof item.searchListOrder === "number"
  )
  .sort((a, b) => a.searchListOrder - b.searchListOrder);

export const searchJumpNavigationItems = appShellNavigationManifest.filter(
  (item): item is SearchJumpNavigationItem =>
    "searchJump" in item &&
    item.searchJump === true &&
    "searchDescription" in item &&
    typeof item.searchDescription === "string" &&
    item.searchDescription.length > 0
);
