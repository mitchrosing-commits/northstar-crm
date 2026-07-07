import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSearchCreateActions,
  buildSearchJumpActions,
  buildSearchListActions,
  queryListHref,
  searchReturnHref
} from "@/lib/search-create-actions";
import { createSidebarHelperForQuery, crmCreateActionDefinitions } from "@/lib/create-record-actions";

const service = readFileSync(join(process.cwd(), "lib/services/search-service.ts"), "utf8");
const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const sidebarCommand = readFileSync(join(process.cwd(), "components/sidebar-command.tsx"), "utf8");
const sidebarSearchShortcut = readFileSync(join(process.cwd(), "components/sidebar-search-shortcut.tsx"), "utf8");
const searchPage = readFileSync(join(process.cwd(), "app/search/page.tsx"), "utf8");
const activityDueBadge = readFileSync(join(process.cwd(), "components/activity-due-badge.tsx"), "utf8");
const searchCreateActions = readFileSync(join(process.cwd(), "lib/search-create-actions.ts"), "utf8");
const createRecordActions = readFileSync(join(process.cwd(), "lib/create-record-actions.ts"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const recordOwnerLabel = readFileSync(join(process.cwd(), "lib/record-owner-label.ts"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("global workspace search", () => {
  it("adds a search entry point in the app shell", () => {
    expect(primaryNav).toContain("appShellNavigationManifest.filter((item) => item.group === group && item.primary !== false)");
    expect(primaryNav).toContain("navigationIcons[item.icon]");
    expect(navigation).toContain("href: \"/search\"");
    expect(navigation).toContain("label: \"Search\"");
    expect(navigation).toContain("primary: false");
    expect(primaryNav).not.toContain('label: "Search"');
    expect(appShell).toContain("<SidebarCommand globalSearchDefaultValue={globalSearchDefaultValue} />");
    expect(appShell).toContain("globalSearchDefaultValue");
    expect(sidebarCommand).toContain("action=\"/search\"");
    expect(sidebarCommand).toContain('import { useId } from "react"');
    expect(sidebarCommand).toContain("const generatedSearchId = useId()");
    expect(sidebarCommand).toContain("const searchInputId = `${generatedSearchId}-global-search`");
    expect(sidebarCommand).toContain("const searchHelperId = `${generatedSearchId}-sidebar-command-helper`");
    expect(sidebarCommand).toContain("aria-describedby={searchHelperId}");
    expect(sidebarCommand).toContain('const searchFormLabel = "Search workspace records"');
    expect(sidebarCommand).toContain("aria-label={searchFormLabel}");
    expect(sidebarCommand).toContain("title={searchFormLabel}");
    expect(sidebarCommand).toContain('const submitSearchLabel = "Submit workspace search"');
    expect(sidebarCommand).toContain("aria-label={submitSearchLabel}");
    expect(sidebarCommand).toContain("title={submitSearchLabel}");
    expect(sidebarCommand).toContain("role=\"search\"");
    expect(sidebarCommand).toContain("Search workspace");
    expect(sidebarCommand).toContain("type=\"search\"");
    expect(sidebarCommand).toContain("<SidebarSearchShortcut inputId={searchInputId} />");
    expect(sidebarCommand).toContain("aria-keyshortcuts=\"/ Meta+K Control+K\"");
    expect(sidebarSearchShortcut).toContain("\"use client\"");
    expect(sidebarSearchShortcut).toContain("window.addEventListener(\"keydown\", onKeyDown)");
    expect(sidebarSearchShortcut).toContain("event.key === \"/\"");
    expect(sidebarSearchShortcut).toContain("event.key.toLowerCase() === \"k\" && (event.metaKey || event.ctrlKey)");
    expect(sidebarSearchShortcut).toContain("input.focus()");
    expect(sidebarSearchShortcut).toContain("input.select()");
    expect(sidebarSearchShortcut).toContain("if (isSlash && isTextEntryTarget(event.target)) return;");
    expect(sidebarSearchShortcut).toContain("if (!isSlash && !isCommandSearch) return;");
    expect(sidebarSearchShortcut).toContain("target.isContentEditable");
    expect(sidebarCommand).toContain("Search and jump without leaving the workspace flow.");
    expect(sidebarCommand).toContain("defaultValue={globalSearchDefaultValue}");
    expect(sidebarCommand).toContain("htmlFor={searchInputId}");
    expect(sidebarCommand).toContain("id={searchInputId}");
    expect(sidebarCommand).toContain("id={searchHelperId}");
    expect(sidebarCommand).not.toContain("const isActive = quickActionMatchesPathname(pathname, action.href)");
    expect(sidebarCommand).not.toContain("aria-current={isActive ? \"page\" : undefined}");
    expect(sidebarCommand).toContain("aria-label={actionTitle}");
    expect(sidebarCommand).toContain("href={action.href}");
    expect(sidebarCommand).not.toContain("getCrmCreateActionDefinition(action.href)");
    expect(sidebarCommand).not.toContain("createSidebarHelperForQuery(createMetadata, searchValue)");
    expect(sidebarCommand).not.toContain("sidebarCreateActionIcons");
    expect(sidebarCommand).not.toContain("sidebarCreateActionMetadata");
    expect(sidebarCommand).not.toContain("function sidebarCreateActionPath");
    expect(sidebarCommand).not.toContain("map((action, index)");
    expect(sidebarCommand).toContain("const actionTitle = `${action.label}: ${action.helper}`");
    expect(sidebarCommand).toContain("title={actionTitle}");
    expect(sidebarCommand).not.toContain("function quickActionMatchesPathname(pathname: string, href: Route)");
    expect(sidebarCommand).toContain("Open matching list shortcuts for this search.");
    expect(sidebarCommand).toContain("Use page-level New buttons for contacts, organizations, leads, deals, and activities.");
    expect(sidebarCommand).toContain("aria-label=\"Active workspace search\"");
    expect(sidebarCommand).toContain("className=\"sidebar-current-query\"");
    expect(sidebarCommand).toContain("<strong>{searchValue}</strong>");
    expect(sidebarCommand).toContain("const clearSearchActionLabel = hasSearchValue ? clearSearchLabel(searchValue) : \"\"");
    expect(sidebarCommand).toContain("aria-label={clearSearchActionLabel}");
    expect(sidebarCommand).toContain("title={clearSearchActionLabel}");
    expect(sidebarCommand).toContain("function clearSearchLabel(searchValue: string)");
    expect(sidebarCommand).toContain("href={\"/search\" as Route}");
    expect(sidebarCommand).toContain("sidebar-quick-actions");
    expect(sidebarCommand).toContain('const quickActionsLabel = "Quick actions"');
    expect(sidebarCommand).toContain("import { ActionGroup }");
    expect(sidebarCommand).toContain('<ActionGroup className="sidebar-quick-actions" label={quickActionsLabel}>');
    expect(sidebarCommand).not.toContain('label: "Create"');
    expect(sidebarCommand).not.toContain("sidebarJumpNavigationItems.map((item) => ({");
    expect(sidebarCommand).toContain("sidebarSearchActionIcons[item.icon]");
    expect(sidebarCommand).toContain("searchListNavigationItems.map((item) => ({");
    expect(sidebarCommand).toContain("href: queryListHref(item.href, searchValue)");
    expect(sidebarCommand).toContain("helper: sidebarSearchListHelper(item.label, searchValue)");
    expect(sidebarCommand).toContain("function sidebarSearchListHelper(label: string, searchValue: string)");
    expect(sidebarCommand).toContain("return `Find \"${searchValue}\" in ${label.toLowerCase()}`;");
    expect(sidebarCommand).toContain("const findActions = hasSearchValue");
    expect(sidebarCommand).toContain('label: "Find"');
    expect(sidebarCommand).toContain("...(findActions.length > 0 ? [{ label: \"Find\", actions: findActions }] : [])");
    expect(sidebarCommand).toContain("aria-labelledby={headingId}");
    expect(sidebarCommand).toContain("className=\"sidebar-quick-action-group\" aria-labelledby={headingId} key={group.label} role=\"group\"");
    expect(navigation).toContain("label: \"Reports\"");
    expect(navigation).toContain("helper: \"Metrics\"");
    expect(navigation).toContain("label: \"Inbox\"");
    expect(navigation).toContain("helper: \"Mailbox + priority\"");
    expect(navigation).toContain("Open synced email, Relationship Inbox priorities, Smart Labels, AI reply drafts, and follow-ups.");
    expect(navigation).toContain("label: \"Settings\"");
    expect(navigation).toContain("helper: \"Admin\"");
    expect(navigation).toContain("export const sidebarJumpNavigationItems");
    expect(createRecordActions).toContain('href: "/activities/new"');
    expect(createRecordActions).toContain('sidebarLabel: "New activity"');
  });

  it("searches workspace-scoped CRM records with deterministic typo-tolerant ranking", () => {
    expect(service).toContain("export async function searchCrm");
    expect(service).toContain("await ensureWorkspaceAccess(actor)");
    expect(service).toContain("normalizeSearchQuery(rawQuery)");
    expect(service).toContain("const maxSearchQueryLength = 120");
    expect(service).toContain("const searchCandidateTake = 80");
    expect(service).toContain("typeof rawQuery === \"string\" ? rawQuery.trim().slice(0, maxSearchQueryLength) : \"\"");
    expect(service).toContain("mode: \"insensitive\"");
    expect(service).toContain("workspaceId: actor.workspaceId");
    expect(service).toContain("take: searchTake");
    expect(service).toContain("rankedSearchResults(query, deals");
    expect(service).toContain("rankedSearchResults(query, leads");
    expect(service).toContain("rankedSearchResults(query, people");
    expect(service).toContain("rankedSearchResults(query, organizations");
    expect(service).toContain("rankedSearchResults(");
    expect(service).toContain("recordSearchScore(query, fields(record))");
    expect(service).toContain("fuzzyTokenScore(queryTokens, searchTokens(normalizedField))");
    expect(service).toContain("damerauLevenshteinDistance(queryToken, fieldToken, typoTolerance(queryToken))");
    expect(service).toContain("workspaceRelationField(actor.workspaceId");
    expect(service).toContain("!relation.deletedAt");
    expect(service).toContain("const requiredMatches = queryTokens.length === 1 ? 1 : Math.ceil(queryTokens.length / 2);");
    expect(service).toContain("prisma.deal.findMany");
    expect(service).toContain("prisma.lead.findMany");
    expect(service).toContain("prisma.person.findMany");
    expect(service).toContain("prisma.organization.findMany");
    expect(service).toContain("prisma.activity.findMany");
    expect(service).toContain("prisma.note.findMany");
    expect(service).toContain("prisma.quote.findMany");
    expect(service).toContain("deal: { is: { workspaceId: actor.workspaceId, ...activeWhere } }");
    expect(service).toContain("scopeWorkspaceRelation");
    expect(service).toContain("activityAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("noteAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("emailLogAttachmentRelationsWhere(actor.workspaceId)");
    expect(service).toContain("prisma.emailLog.findMany");
    expect(service).toContain("owner: { select: userDisplaySelect }");
  });

  it("adds a query-driven grouped search page with useful empty states", () => {
    expect(searchPage).toContain("searchParams: Promise<ListSearchParams>");
    expect(searchPage).toContain("getSearchParam(params, \"q\")");
    expect(searchPage).toContain("searchCrm({ workspaceId: workspace.id, actorUserId }, q)");
    expect(searchPage).toContain("SearchSection id=\"search-deals\" title=\"Deals\"");
    expect(searchPage).toContain("SearchSection id=\"search-leads\" title=\"Leads\"");
    expect(searchPage).toContain("SearchSection id=\"search-contacts\" title=\"Contacts\"");
    expect(searchPage).toContain("SearchSection id=\"search-organizations\" title=\"Organizations\"");
    expect(searchPage).toContain("SearchSection id=\"search-activities\" title=\"Activities\"");
    expect(searchPage).toContain("SearchSection id=\"search-notes\" title=\"Notes\"");
    expect(searchPage).toContain("SearchSection id=\"search-quotes\" title=\"Quotes\"");
    expect(searchPage).toContain("SearchSection id=\"search-emails\" title=\"Emails\"");
    expect(searchPage).toContain("Search workspace records");
    expect(searchPage).toContain("aria-labelledby=\"workspace-search-heading\"");
    expect(searchPage).toContain("aria-describedby=\"workspace-search-helper\"");
    expect(searchPage).toContain("role=\"search\"");
    expect(searchPage).toContain("id=\"workspace-search-heading\"");
    expect(searchPage).toContain("id=\"workspace-search-helper\"");
    expect(searchPage).toContain("Submit an empty search to return to the unfiltered search page.");
    expect(searchPage).toContain("type=\"search\"");
    expect(searchPage).toContain("const searchSubmitLabel = hasQuery");
    expect(searchPage).toContain("Search workspace records for ${results.query}");
    expect(searchPage).toContain("aria-label={searchSubmitLabel}");
    expect(searchPage).toContain("title={searchSubmitLabel}");
    expect(searchPage).toContain("globalSearchDefaultValue={hasQuery ? results.query : undefined}");
    expect(searchPage).toContain("{!hasQuery ? <SearchActionPanel /> : null}");
    expect(searchPage).toContain("{hasQuery ? <SearchActionPanel query={results.query} /> : null}");
    expect(searchPage).toContain("const resultOverview = [");
    expect(searchPage).toContain("SearchResultOverview items={resultOverview}");
    expect(searchPage).toContain("quick ${shownResults === 1 ? \"match\" : \"matches\"} shown");
    expect(searchPage).toContain("aria-label=\"Search quick matches shown by record type\"");
    expect(searchPage).toContain("search-result-overview-item");
    expect(searchPage).toContain("aria-label={searchResultOverviewLabel(item)}");
    expect(searchPage).toContain("title={searchResultOverviewLabel(item)}");
    expect(searchPage).toContain("function searchResultOverviewLabel");
    expect(searchPage).toContain("${item.count} ${item.label.toLowerCase()} quick ${item.count === 1 ? \"match\" : \"matches\"} shown");
    expect(searchPage).toContain("href={`#${item.id}` as Route}");
    expect(searchPage).toContain("search-result-overview-item-muted");
    expect(searchPage).toContain('import { useId } from "react"');
    expect(searchPage).toContain("const titleId = `${useId()}-search-section-title`");
    expect(searchPage).toContain("<section aria-labelledby={titleId} className=\"data-card search-section\" id={id}>");
    expect(searchPage).toContain("buildSearchCreateActions,");
    expect(searchPage).toContain("buildSearchJumpActions,");
    expect(searchPage).toContain("buildSearchListActions,");
    expect(searchPage).toContain("queryListHref,");
    expect(searchPage).toContain("searchReturnHref");
    expect(searchCreateActions).toContain("export type SearchWorkflowAction");
    expect(searchPage).toContain("Find records, open filtered lists, and jump into common CRM actions.");
    expect(searchPage).toContain("ListViewStatus active={hasQuery}");
    expect(searchPage).toContain("Search active");
    expect(searchPage).toContain("resetHref=\"/search\"");
    expect(searchPage).toContain('resetLabel="Clear search"');
    expect(searchPage).toContain("PanelTitleRow");
    expect(searchPage).toContain("const countLabel = `${count} ${title.toLowerCase()} quick ${count === 1 ? \"match\" : \"matches\"} shown`");
    expect(searchPage).toContain("actionsLabel={countLabel}");
    expect(searchPage).toContain("aria-label={countLabel}");
    expect(searchPage).toContain("title={countLabel}");
    expect(searchPage).toContain("titleId={titleId}");
    expect(searchPage).not.toContain("<h2 className=\"panel-title\">{title}</h2>");
    expect(searchPage).toContain("className=\"table-primary-cell search-result-main\"");
    expect(searchPage).toContain("className=\"table-secondary-text search-result-meta\"");
    expect(searchPage).toContain("className=\"search-result-status\"");
    expect(searchPage).toContain("className=\"result-row-main-link\"");
    expect(searchPage).toContain("className=\"search-result-side\"");
    expect(searchPage).toContain("className=\"result-row-actions\"");
    expect(searchPage).toContain("import { ListRowActions } from \"@/components/list-row-actions\"");
    expect(searchPage).toContain("const rowActions = [");
    expect(searchPage).toContain('openLabel = "Open"');
    expect(searchPage).toContain("openLabel?: string");
    expect(searchPage).toContain('const openActionLabel = openLabel === "Open" ? `Open ${title}` : `${openLabel}: ${title}`');
    expect(searchPage).toContain("{ href, label: openLabel, ariaLabel: openActionLabel }");
    expect(searchPage).toContain("<ListRowActions aria-label={`${title} search result actions`} actions={rowActions} />");
    for (const openLabel of [
      "Open deal",
      "Open lead",
      "Open contact",
      "Open account",
      "Open activity",
      "Open note context",
      "Open quote",
      "Open email context"
    ]) {
      expect(searchPage).toContain(`openLabel="${openLabel}"`);
    }
    expect(searchPage).toContain('label: "Add activity"');
    expect(searchPage).toContain("ariaLabel: `Create follow-up activity for ${deal.title}`");
    expect(searchPage).toContain("ariaLabel: `Create follow-up activity for ${lead.title}`");
    expect(searchPage).toContain("ariaLabel: `Create follow-up activity for ${organization.name}`");
    expect(searchPage).toContain("ariaLabel: `${relatedLabel} matching ${title}`");
    expect(searchPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(searchPage).not.toContain("function formatPersonName");
    expect(searchPage).toContain("relatedHref={queryListHref(\"/deals\", deal.title)}");
    expect(searchPage).toContain("relatedHref={queryListHref(\"/contacts\", formatPersonName(person) ?? person.email ?? \"\")}");
    expect(searchPage).toContain('title={formatPersonName(person) ?? "Unnamed contact"}');
    expect(searchPage).toContain('return `Contact: ${formatPersonName(record.person) ?? "Unnamed contact"}`');
    expect(searchPage).toContain("relatedHref={queryListHref(\"/activities\", activity.title)}");
    expect(searchPage).toContain("relatedHref={queryListHref(\"/deals\", quote.deal.title)}");
    expect(searchPage).toContain("relatedHref={queryListHref(\"/contacts\", emailSearchContactQuery(emailLog))}");
    expect(searchPage).toContain("function emailSearchContactQuery");
    expect(searchPage).toContain("Find deals");
    expect(searchPage).toContain("Find contacts");
    expect(searchPage).toContain("Find activities");
    expect(searchPage).toContain("Find deal");
    expect(searchPage).toContain("Find contact");
    expect(searchPage).toContain("Open");
    expect(searchPage).toContain("import { buildActivityFollowUpHref } from \"@/lib/follow-up-links\"");
    expect(searchPage).toContain("actions={");
    expect(searchPage).toContain("deal.status === \"OPEN\"");
    expect(searchPage).toContain("lead.status !== \"CONVERTED\"");
    expect(searchPage).toContain("related: { type: \"deal\", id: deal.id }");
    expect(searchPage).toContain("related: { type: \"lead\", id: lead.id }");
    expect(searchPage).toContain("related: { type: \"person\", id: person.id }");
    expect(searchPage).toContain("related: { type: \"organization\", id: organization.id }");
    expect(searchPage).toContain("returnTo: searchReturnHref(results.query)");
    expect(searchPage).toContain("label: \"Add activity\"");
    expect(searchCreateActions).toContain("export function searchReturnHref");
    expect(searchPage).toContain('import { recordOwnerLabel } from "@/lib/record-owner-label"');
    expect(searchPage).toContain("recordOwnerLabel(deal.owner)");
    expect(searchPage).toContain("recordOwnerLabel(lead.owner)");
    expect(searchPage).toContain("recordOwnerLabel(person.owner)");
    expect(searchPage).toContain("recordOwnerLabel(organization.owner)");
    expect(searchPage).toContain("recordOwnerLabel(activity.owner)");
    expect(searchPage).toContain("recordOwnerLabel(quote.deal.owner)");
    expect(searchPage).not.toContain("function ownerLabel");
    expect(recordOwnerLabel).toContain("export function recordOwnerLabel");
    expect(recordOwnerLabel).toContain("Owner: Unassigned");
    expect(globalStyles).toContain(".search-action-panel");
    expect(globalStyles).toContain(".search-action-link-icon");
    expect(globalStyles).toContain(".search-action-link-copy");
    expect(globalStyles).toContain("grid-template-columns: auto minmax(0, 1fr);");
    expect(globalStyles).toContain(".search-result-overview");
    expect(globalStyles).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 104px), 1fr));");
    expect(globalStyles).toContain(".search-result-overview-item-muted");
    expect(globalStyles).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));");
    expect(globalStyles).toContain(".search-result-meta span");
    expect(globalStyles).toContain(".search-empty-create-actions > *");
    expect(globalStyles).toContain(".result-row-actions .button-compact");
    expect(globalStyles).toContain(".search-result-side {\n    width: 100%;");
    expect(globalStyles).not.toContain(".section-heading");
    expect(searchPage).toContain("Open filtered lists");
    expect(searchPage).toContain("Use this query elsewhere");
    expect(searchPage).toContain("Browse records");
    expect(searchPage).toContain("Jump to a CRM list");
    expect(searchPage).toContain('type SearchActionKind = "create" | "jump" | "list"');
    expect(searchPage).toContain('import { getCrmCreateActionDefinition, type CrmCreateActionPath } from "@/lib/create-record-actions"');
    expect(searchPage).toContain('import { appShellNavigationManifest, type AppNavigationIconName } from "@/lib/navigation"');
    expect(searchPage).toContain("type LucideIcon");
    expect(searchPage).toContain("const searchNavigationIcons: Record<AppNavigationIconName, LucideIcon>");
    expect(searchPage).toContain("const searchCreateActionIcons: Record<CrmCreateActionPath, LucideIcon>");
    expect(searchCreateActions).toContain('import { searchJumpNavigationItems, searchListNavigationItems } from "@/lib/navigation"');
    expect(sidebarCommand).toContain('import { queryListHref } from "@/lib/search-create-actions"');
    expect(sidebarCommand).not.toContain("import { buildSearchCreateActions, queryListHref }");
    expect(sidebarCommand).toContain("import { searchListNavigationItems, type AppNavigationIconName } from \"@/lib/navigation\"");
    expect(sidebarCommand).not.toContain("import { searchListNavigationItems, sidebarJumpNavigationItems");
    expect(navigation).toContain('listDescription: "Browse follow-ups and tasks."');
    expect(navigation).toContain("export const searchListNavigationItems");
    expect(navigation).toContain("export const searchJumpNavigationItems");
    expect(searchPage).toContain("headingId=\"search-list-actions-heading\"");
    expect(searchPage).toContain('kind="list"');
    expect(searchPage).toContain("buildSearchListActions(query)");
    expect(searchPage).toContain("buildSearchJumpActions()");
    expect(searchCreateActions).toContain("export function buildSearchListActions");
    expect(searchCreateActions).toContain("searchListNavigationItems.map((item) => ({");
    expect(searchCreateActions).toContain("queryListHref(item.href, cleanedQuery)");
    expect(searchCreateActions).toContain("encodeURIComponent(cleanedQuery)");
    expect(searchPage).toContain("Go to workspace areas");
    expect(searchPage).toContain("headingId=\"search-create-actions-heading\"");
    expect(searchPage).toContain('kind="create"');
    expect(searchPage).toContain("headingId=\"search-jump-actions-heading\"");
    expect(searchPage).toContain('kind="jump"');
    expect(searchPage).toContain("aria-labelledby={headingId}");
    expect(searchPage).toContain("<h2 id={headingId}>{title}</h2>");
    expect(searchPage).toContain("const actionLabel = `${action.label}: ${action.description}`");
    expect(searchPage).toContain("const Icon = searchActionIcon(kind, action.href)");
    expect(searchPage).toContain("className=\"search-action-link-icon\"");
    expect(searchPage).toContain("<Icon size={15} aria-hidden=\"true\" />");
    expect(searchPage).toContain("className=\"search-action-link-copy\"");
    expect(searchPage).toContain("function searchActionIcon(kind: SearchActionKind, href: Route)");
    expect(searchPage).toContain("if (kind === \"create\") return searchCreateActionIcons[getCrmCreateActionDefinition(href).href]");
    expect(searchPage).toContain("const navigationItem = appShellNavigationManifest.find((item) => item.href === basePath)");
    expect(searchPage).toContain("return navigationItem ? searchNavigationIcons[navigationItem.icon] : Search");
    expect(searchPage).toContain("aria-label={actionLabel}");
    expect(searchPage).toContain("title={actionLabel}");
    expect(searchCreateActions).toContain("searchJumpNavigationItems.map((item) => ({");
    expect(navigation).toContain("label: \"Reports\"");
    expect(navigation).toContain("Review sales operating metrics.");
    expect(navigation).toContain("label: \"Settings\"");
    expect(navigation).toContain("Manage workspace setup and data tools.");
    expect(searchCreateActions).toContain("label: `Search ${item.label.toLowerCase()}`");
    expect(navigation).toContain("Open the work queue with this query.");
    expect(searchPage).toContain("Search your workspace");
    expect(searchPage).toContain("Search names, titles, domains, quote numbers, email subjects...");
    expect(searchPage).toContain("quote number, email subject");
    expect(searchPage).toContain("No results found");
    expect(searchPage).toContain("Try a record name, email, domain, quote number");
    expect(searchPage).toContain("Clear search");
    expect(searchPage).toContain("<SearchEmptyActions query={results.query} />");
    expect(searchPage).toContain("function SearchEmptyActions");
    expect(searchPage).toContain("buildSearchCreateActions(query)");
    expect(searchPage).toContain("const listActions = buildSearchListActions(query)");
    expect(searchPage).not.toContain("buildSearchCreateActions(query).slice(0, 4)");
    expect(searchPage).toContain("const createActionsLabel = `Create CRM records from \"${query}\"`");
    expect(searchPage).toContain("const listActionsLabel = `Open filtered CRM lists for \"${query}\"`");
    expect(searchPage).toContain("import { ActionGroup }");
    expect(searchPage).toContain('<ActionGroup className="search-empty-create-actions" label={createActionsLabel}>');
    expect(searchPage).toContain('<ActionGroup className="search-empty-list-actions" label={listActionsLabel}>');
    expect(searchPage).toContain("<span>Search lists</span>");
    expect(searchPage).toContain("className=\"button-secondary button-compact\"");
    expect(searchPage).toContain("const actionLabel = `${action.label}: ${action.description}`");
    expect(searchPage).toContain("aria-label={actionLabel}");
    expect(searchPage).toContain("title={actionLabel}");
    expect(searchPage).toContain("const clearSearchLabel = \"Clear search and show workspace search actions\"");
    expect(searchPage).toContain("aria-label={clearSearchLabel}");
    expect(searchPage).toContain("title={clearSearchLabel}");
    expect(searchPage).toContain("className={index === 0 ? \"button-primary\" : \"button-secondary\"}");
    expect(globalStyles).toContain(".search-empty-create-actions");
    expect(globalStyles).toContain(".search-empty-list-actions");
    expect(searchPage).toContain("EmptyState");
    expect(searchPage).toContain("as=\"section\"");
    expect(searchPage).toContain("title=\"Search your workspace\"");
    expect(searchPage).toContain("title=\"No results found\"");
    expect(searchPage).toContain("titleLevel=\"h2\"");
    expect(searchPage).not.toContain("<section className=\"empty-state\">");
    expect(createRecordActions).toContain('searchLabel: "Create deal"');
    expect(createRecordActions).toContain('searchLabel: "Add contact"');
  });

  it("turns no-result searches into prefilled create actions without changing search behavior", () => {
    expect(searchPage).toContain("buildSearchCreateActions(query)");
    expect(searchCreateActions).toContain("export function buildSearchCreateActions");
    expect(searchCreateActions).toContain("crmCreateActionDefinitions.map((definition) => ({");
    expect(searchCreateActions).toContain("prefillCreateHref(definition.href, createPrefillKeyForQuery(definition, cleanedQuery), cleanedQuery)");
    expect(createRecordActions).toContain('href: "/deals/new"');
    expect(createRecordActions).toContain('href: "/contacts/new"');
    expect(createRecordActions).toContain('href: "/organizations/new"');
    expect(createRecordActions).toContain('href: "/leads/new"');
    expect(createRecordActions).toContain('href: "/activities/new"');
    expect(searchCreateActions).toContain("new URLSearchParams({ [key]: cleanedValue })");
    expect(searchCreateActions).toContain("export function looksLikeEmail");
    expect(createRecordActions).toContain("Start with this search as the deal title.");
    expect(createRecordActions).toContain("Start with this email address.");
    expect(createRecordActions).toContain("export function createSidebarHelperForQuery");
    expect(createRecordActions).toContain("const prefillKeyLabels");
  });

  it("builds reusable prefilled create links for search-driven creation", () => {
    expect(buildSearchCreateActions("Acme Expansion").map((action) => action.href)).toEqual([
      "/deals/new?title=Acme+Expansion",
      "/contacts/new?name=Acme+Expansion",
      "/organizations/new?name=Acme+Expansion",
      "/leads/new?title=Acme+Expansion",
      "/activities/new?title=Acme+Expansion"
    ]);
    expect(buildSearchCreateActions("avery@example.test")[1].href).toBe("/contacts/new?email=avery%40example.test");
    expect(buildSearchCreateActions()[0].href).toBe("/deals/new");
    expect(buildSearchCreateActions("   ")[0].href).toBe("/deals/new");
    expect(createSidebarHelperForQuery(crmCreateActionDefinitions[0], "Acme Expansion")).toBe("Prefills title");
    expect(createSidebarHelperForQuery(crmCreateActionDefinitions[1], "Avery Stone")).toBe("Prefills name");
    expect(createSidebarHelperForQuery(crmCreateActionDefinitions[1], "avery@example.test")).toBe("Prefills email");
    expect(createSidebarHelperForQuery(crmCreateActionDefinitions[2])).toBe("Account");
  });

  it("builds reusable search workflow links for filtered lists, returns, and jumps", () => {
    expect(buildSearchListActions("Acme Expansion").map((action) => action.href)).toEqual([
      "/deals?q=Acme%20Expansion",
      "/activities?q=Acme%20Expansion",
      "/contacts?q=Acme%20Expansion",
      "/organizations?q=Acme%20Expansion",
      "/leads?q=Acme%20Expansion"
    ]);
    expect(buildSearchListActions()[0]).toMatchObject({
      href: "/deals",
      label: "Deals"
    });
    expect(buildSearchListActions().map((action) => action.href)).toEqual([
      "/deals",
      "/activities",
      "/contacts",
      "/organizations",
      "/leads"
    ]);
    expect(buildSearchJumpActions().map((action) => action.href)).toEqual([
      "/dashboard",
      "/pipeline",
      "/quotes",
      "/activities",
      "/email",
      "/meeting-intelligence",
      "/reports",
      "/settings"
    ]);
    expect(queryListHref("/contacts", "avery@example.test")).toBe("/contacts?q=avery%40example.test");
    expect(queryListHref("/contacts", "   ")).toBe("/contacts");
    expect(searchReturnHref("Acme Expansion")).toBe("/search?q=Acme%20Expansion");
    expect(searchReturnHref("   ")).toBe("/search");
  });

  it("renders readable activity and note result context without raw internal labels", () => {
    expect(searchPage).toContain("formatActivityType(activity.type)");
    expect(searchPage).toContain("Activity: ${formatActivityType(activity.type)}");
    expect(searchPage).toContain("activityDueSearchLabel(activity)");
    expect(searchPage).toContain('import { formatActivityDueBadgeLabel } from "@/components/activity-due-badge"');
    expect(searchPage).toContain('import { classifyActivityDue } from "@/lib/activity-due"');
    expect(searchPage).toContain("formatActivityDueBadgeLabel(classifyActivityDue(activity), activity)");
    expect(activityDueBadge).toContain("No due date");
    expect(searchPage).not.toContain("function activityDueLabel");
    expect(searchPage).toContain("notePreview(note.body)");
    expect(searchPage).toContain("Note: ${preview(body)}");
    expect(searchPage).toContain("Internal note added");
    expect(searchPage).toContain("Author:");
    expect(searchPage).not.toContain("meta={[activity.type");
  });

  it("links results to the best available detail page", () => {
    expect(searchPage).toContain("href={`/deals/${deal.id}` as Route}");
    expect(searchPage).toContain("href={`/leads/${lead.id}` as Route}");
    expect(searchPage).toContain("href={`/contacts/${person.id}` as Route}");
    expect(searchPage).toContain("href={`/organizations/${organization.id}` as Route}");
    expect(searchPage).toContain("function attachmentTarget");
    expect(searchPage).toContain("activityTarget(activity, results.query)");
    expect(searchPage).toContain("const params = new URLSearchParams({ returnTo: searchReturnHref(query) })");
    expect(searchPage).toContain("return `/activities/${activity.id}/edit?${params.toString()}` as Route");
    expect(searchPage).toContain("id: string;");
    expect(searchPage).toContain("return attachmentTarget(note, \"#notes\")");
    expect(searchPage).toContain("return attachmentTarget(emailLog, \"#email-log\")");
    expect(searchPage).toContain("${fragment}` as Route");
    expect(searchPage).toContain("return \"/activities\"");
    expect(searchPage).toContain("href={`/deals/${quote.dealId}/quotes/${quote.id}` as Route}");
    expect(searchPage).toContain("emailLogTarget(emailLog)");
    expect(searchPage).toContain("actions?: Array<{ ariaLabel?: string; href: Route; label: string }>");
    expect(searchPage).toContain("<Link aria-label={openActionLabel}");
    expect(searchPage).toContain("title={openActionLabel}");
  });
});
