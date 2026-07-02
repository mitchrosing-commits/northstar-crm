import type { Route } from "next";

import {
  createPrefillDescriptionForQuery,
  createPrefillKeyForQuery,
  crmCreateActionDefinitions,
  looksLikeEmail as looksLikeEmailValue
} from "@/lib/create-record-actions";
import { searchJumpNavigationItems, searchListNavigationItems } from "@/lib/navigation";

export type SearchWorkflowAction = {
  description: string;
  href: Route;
  label: string;
};

export type SearchCreateAction = SearchWorkflowAction;

type SearchListPath = (typeof searchListNavigationItems)[number]["href"];

export function buildSearchCreateActions(query?: string): SearchCreateAction[] {
  const cleanedQuery = query?.trim();
  if (!cleanedQuery) {
    return crmCreateActionDefinitions.map((definition) => ({
      href: definition.href as Route,
      label: definition.searchLabel,
      description: definition.defaultDescription
    }));
  }

  return crmCreateActionDefinitions.map((definition) => ({
    href: prefillCreateHref(definition.href, createPrefillKeyForQuery(definition, cleanedQuery), cleanedQuery),
    label: definition.searchLabel,
    description: createPrefillDescriptionForQuery(definition, cleanedQuery)
  }));
}

export function buildSearchListActions(query?: string): SearchWorkflowAction[] {
  const cleanedQuery = query?.trim();

  if (!cleanedQuery) {
    return searchListNavigationItems.map((item) => ({
      href: item.href,
      label: item.label,
      description: item.listDescription
    }));
  }

  return searchListNavigationItems.map((item) => ({
    href: queryListHref(item.href, cleanedQuery),
    label: `Search ${item.label.toLowerCase()}`,
    description: item.listSearchDescription
  }));
}

export function buildSearchJumpActions(): SearchWorkflowAction[] {
  return searchJumpNavigationItems.map((item) => ({
    href: item.href,
    label: item.label,
    description: item.searchDescription
  }));
}

export function prefillCreateHref(
  path: "/deals/new" | "/contacts/new" | "/organizations/new" | "/leads/new" | "/activities/new",
  key: string,
  value: string
) {
  const cleanedValue = value.trim();
  if (!cleanedValue) return path as Route;

  const params = new URLSearchParams({ [key]: cleanedValue });
  return `${path}?${params.toString()}` as Route;
}

export function queryListHref(path: SearchListPath, query: string) {
  const cleanedQuery = query.trim();
  return cleanedQuery ? (`${path}?q=${encodeURIComponent(cleanedQuery)}` as Route) : (path as Route);
}

export function searchReturnHref(query: string) {
  const cleanedQuery = query.trim();
  return cleanedQuery ? (`/search?q=${encodeURIComponent(cleanedQuery)}` as Route) : ("/search" as Route);
}

export function looksLikeEmail(value: string) {
  return looksLikeEmailValue(value);
}
