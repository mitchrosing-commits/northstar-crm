import type { Route } from "next";

export type CrmCreateActionPath = "/deals/new" | "/contacts/new" | "/organizations/new" | "/leads/new" | "/activities/new";

type CreatePrefillKey = "email" | "name" | "title";
const prefillKeyLabels: Record<CreatePrefillKey, string> = {
  email: "email",
  name: "name",
  title: "title"
};

export type CrmCreateActionDefinition = {
  defaultDescription: string;
  href: CrmCreateActionPath;
  prefillDescription: string;
  prefillKey: CreatePrefillKey;
  searchLabel: string;
  sidebarHelper: string;
  sidebarLabel: string;
};

export const crmCreateActionDefinitions: readonly CrmCreateActionDefinition[] = [
  {
    href: "/deals/new",
    searchLabel: "Create deal",
    sidebarLabel: "New deal",
    sidebarHelper: "Opportunity",
    defaultDescription: "Start a new opportunity.",
    prefillKey: "title",
    prefillDescription: "Start with this search as the deal title."
  },
  {
    href: "/contacts/new",
    searchLabel: "Add contact",
    sidebarLabel: "New contact",
    sidebarHelper: "Person",
    defaultDescription: "Add a person to the workspace.",
    prefillKey: "name",
    prefillDescription: "Start with this contact name."
  },
  {
    href: "/organizations/new",
    searchLabel: "Add organization",
    sidebarLabel: "New organization",
    sidebarHelper: "Account",
    defaultDescription: "Create a company/account.",
    prefillKey: "name",
    prefillDescription: "Start with this account name."
  },
  {
    href: "/leads/new",
    searchLabel: "Add lead",
    sidebarLabel: "New lead",
    sidebarHelper: "Prospect",
    defaultDescription: "Capture an early opportunity.",
    prefillKey: "title",
    prefillDescription: "Start with this lead title."
  },
  {
    href: "/activities/new",
    searchLabel: "New activity",
    sidebarLabel: "New activity",
    sidebarHelper: "Follow-up",
    defaultDescription: "Schedule a follow-up.",
    prefillKey: "title",
    prefillDescription: "Start a follow-up using this search."
  }
] as const;

export function getCrmCreateActionDefinition(path: Route) {
  const basePath = String(path).split("?")[0];
  return crmCreateActionDefinitions.find((definition) => definition.href === basePath) ?? crmCreateActionDefinitions[4];
}

export function createPrefillKeyForQuery(definition: CrmCreateActionDefinition, query: string) {
  return definition.href === "/contacts/new" && looksLikeEmail(query) ? "email" : definition.prefillKey;
}

export function createPrefillDescriptionForQuery(definition: CrmCreateActionDefinition, query: string) {
  return definition.href === "/contacts/new" && looksLikeEmail(query) ? "Start with this email address." : definition.prefillDescription;
}

export function createSidebarHelperForQuery(definition: CrmCreateActionDefinition, query?: string) {
  const cleanedQuery = query?.trim();
  if (!cleanedQuery) return definition.sidebarHelper;

  const prefillKey = createPrefillKeyForQuery(definition, cleanedQuery);
  return `Prefills ${prefillKeyLabels[prefillKey]}`;
}

export function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
