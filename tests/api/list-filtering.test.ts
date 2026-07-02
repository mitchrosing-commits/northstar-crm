import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  findMatchingSavedViewName,
  hasExplicitListStateParams,
  ListViewStatus,
  ListViewStatusForState
} from "@/components/list-view-status";
import { quickLinkActionLabel, quickLinkIsActive } from "@/components/list-quick-links-panel";
import { listResultsAnnouncement, listResultsPageLabel, listResultsScopeLabel, listResultsSummaryText } from "@/components/list-results-summary";
import {
  enumListViewFilter,
  getSearchParam,
  hasActiveListViewFilters,
  listPageHref,
  listServiceFiltersFromSearchParams,
  paginationHref,
  parseListViewState,
  parsePagination,
  resolvePagination,
  searchParamsToListSearchParams,
  serializeListViewState,
  serializedListViewStateToSearchParams
} from "@/lib/list-page-query";
import {
  listResourceCreateActionLabel,
  listResourcePluralLabel,
  listResourceSearchPlaceholder,
  listResourceSingularLabel
} from "@/lib/list-resource-labels";
import { formatPersonName } from "@/lib/person-name";

const queryHelper = readFileSync(join(process.cwd(), "lib/list-page-query.ts"), "utf8");
const listViewStatus = readFileSync(join(process.cwd(), "components/list-view-status.tsx"), "utf8");
const savedViewsPanel = readFileSync(join(process.cwd(), "components/saved-views-panel.tsx"), "utf8");
const listRowActions = readFileSync(join(process.cwd(), "components/list-row-actions.tsx"), "utf8");
const listNextActivitySummary = readFileSync(join(process.cwd(), "components/list-next-activity-summary.tsx"), "utf8");
const inlineEmptyStateText = readFileSync(join(process.cwd(), "components/inline-empty-state-text.tsx"), "utf8");
const listEmptyStateActions = readFileSync(join(process.cwd(), "components/list-empty-state-actions.tsx"), "utf8");
const listResourceLabels = readFileSync(join(process.cwd(), "lib/list-resource-labels.ts"), "utf8");
const personName = readFileSync(join(process.cwd(), "lib/person-name.ts"), "utf8");
const listQuickLinksPanel = readFileSync(join(process.cwd(), "components/list-quick-links-panel.tsx"), "utf8");
const listResultsSummary = readFileSync(join(process.cwd(), "components/list-results-summary.tsx"), "utf8");
const listSortControls = readFileSync(join(process.cwd(), "components/list-sort-controls.tsx"), "utf8");
const customFieldListSummary = readFileSync(join(process.cwd(), "components/custom-field-list-summary.tsx"), "utf8");
const paginationControls = readFileSync(join(process.cwd(), "components/pagination-controls.tsx"), "utf8");
const tableScroll = readFileSync(join(process.cwd(), "components/table-scroll.tsx"), "utf8");
const tableLinkedRecordCell = readFileSync(join(process.cwd(), "components/table-linked-record-cell.tsx"), "utf8");
const tableOwnerCell = readFileSync(join(process.cwd(), "components/table-owner-cell.tsx"), "utf8");
const tableOptionalValueCell = readFileSync(join(process.cwd(), "components/table-optional-value-cell.tsx"), "utf8");
const tablePrimaryRecordCell = readFileSync(join(process.cwd(), "components/table-primary-record-cell.tsx"), "utf8");
const filterPanel = readFileSync(join(process.cwd(), "components/filter-panel.tsx"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const relatedRecordsTable = readFileSync(join(process.cwd(), "components/related-records-table.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const leadsPage = readFileSync(join(process.cwd(), "app/leads/page.tsx"), "utf8");
const contactsPage = readFileSync(join(process.cwd(), "app/contacts/page.tsx"), "utf8");
const organizationsPage = readFileSync(join(process.cwd(), "app/organizations/page.tsx"), "utf8");
const activitiesPage = readFileSync(join(process.cwd(), "app/activities/page.tsx"), "utf8");
const dealsPage = readFileSync(join(process.cwd(), "app/deals/page.tsx"), "utf8");
const services = [
  readFileSync(join(process.cwd(), "lib/services/lead-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/contact-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/organization-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/activity-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/deal-service.ts"), "utf8")
].join("\n");

describe("query-driven list filtering and sorting", () => {
  it("adds shared query parsing helpers for list pages", () => {
    expect(queryHelper).toContain("export type ListSearchParams");
    expect(queryHelper).toContain("export type ListViewState<TSortBy extends string = string, TFilterKey extends string = string>");
    expect(queryHelper).toContain("export function getSearchParam");
    expect(queryHelper).toContain("export function enumSearchParam");
    expect(queryHelper).toContain("export function hasActiveListFilters");
    expect(queryHelper).toContain("export type ListViewState");
    expect(queryHelper).toContain("export function parseListViewState");
    expect(queryHelper).toContain("export function listServiceFiltersFromSearchParams");
    expect(queryHelper).toContain("export function enumListViewFilter");
    expect(queryHelper).toContain("export function hasActiveListViewFilters");
    expect(queryHelper).toContain("export function parsePagination");
    expect(queryHelper).toContain("export function resolvePagination");
    expect(queryHelper).toContain("export function paginationHref");
    expect(queryHelper).toContain("export function listPageHref");
    expect(queryHelper).toContain("export const sortDirections");
  });

  it("parses and clamps pagination query parameters", () => {
    expect(parsePagination({ page: "3", pageSize: "20" })).toEqual({ page: 3, pageSize: 20 });
    expect(parsePagination({ page: "-5", pageSize: "500" })).toEqual({ page: 1, pageSize: 50 });
    expect(parsePagination({ page: "nope", pageSize: "nope" })).toEqual({ page: 1, pageSize: 10 });
    expect(parsePagination({ page: "2abc", pageSize: "25px" })).toEqual({ page: 1, pageSize: 10 });
    expect(parsePagination({ page: "2.5", pageSize: "1e2" })).toEqual({ page: 1, pageSize: 10 });
    expect(resolvePagination(37, { page: Number.NaN, pageSize: Number.POSITIVE_INFINITY })).toMatchObject({
      page: 1,
      pageSize: 10,
      skip: 0,
      from: 1,
      to: 10
    });
    expect(resolvePagination(37, { page: 2.9, pageSize: 7.8 })).toMatchObject({
      page: 2,
      pageSize: 7,
      skip: 7,
      from: 8,
      to: 14
    });
    expect(resolvePagination(Number.NaN, { page: 2, pageSize: 10 })).toMatchObject({
      page: 1,
      total: 0,
      totalPages: 1,
      skip: 0
    });
  });

  it("normalizes repeated search params before pages pass them into services", () => {
    const params = searchParamsToListSearchParams(new URLSearchParams("q=first&q=second&page=2&page=3"));

    expect(params).toEqual({ q: ["first", "second"], page: ["2", "3"] });
    expect(getSearchParam(params, "q")).toBe("first");
    expect(parsePagination(params)).toEqual({ page: 2, pageSize: 10 });
  });

  it("ignores malformed search param values before parsing filters, pagination, and hrefs", () => {
    const malformedParams = {
      q: { value: "needle" } as never,
      status: [{ value: "WON" }, "OPEN"] as never,
      page: { value: "3" } as never,
      pageSize: ["25", { value: "50" }] as never,
      sortBy: ["title"],
      sortDirection: { value: "asc" } as never
    };
    const state = parseListViewState(malformedParams, {
      defaultSortBy: "updatedAt",
      defaultSortDirection: "desc",
      filterKeys: ["status"],
      sortByValues: ["updatedAt", "title"] as const
    });

    expect(getSearchParam(malformedParams, "q")).toBe("");
    expect(parsePagination(malformedParams)).toEqual({ page: 1, pageSize: 25 });
    expect(state).toEqual({
      q: undefined,
      filters: { status: "OPEN" },
      sortBy: "title",
      sortDirection: "desc",
      pagination: { page: 1, pageSize: 25 }
    });
    expect(listPageHref("/deals", malformedParams)).toBe("/deals?status=OPEN&pageSize=25&sortBy=title");
    expect(paginationHref("/deals", malformedParams, 2, 25)).toBe("/deals?status=OPEN&sortBy=title&page=2&pageSize=25");
  });

  it("normalizes list-view state for future saved-view storage", () => {
    const state = parseListViewState(
      {
        q: " needle ",
        status: "OPEN",
        ownerId: "user_123",
        customFieldId: "field_123",
        customFieldOperator: "contains",
        customFieldValue: "High",
        sortBy: "title",
        sortDirection: "asc",
        page: "2",
        pageSize: "25"
      },
      {
        defaultSortBy: "updatedAt",
        defaultSortDirection: "desc",
        filterKeys: ["status", "ownerId", "customFieldId", "customFieldOperator", "customFieldValue"],
        sortByValues: ["updatedAt", "title"] as const
      }
    );

    expect(state).toEqual({
      q: "needle",
      filters: {
        status: "OPEN",
        ownerId: "user_123",
        customFieldId: "field_123",
        customFieldOperator: "contains",
        customFieldValue: "High"
      },
      sortBy: "title",
      sortDirection: "asc",
      pagination: { page: 2, pageSize: 25 }
    });
    expect(enumListViewFilter(state, "status", ["OPEN", "WON", "LOST"] as const)).toBe("OPEN");
    expect(hasActiveListViewFilters(state)).toBe(true);
    expect(serializedListViewStateToSearchParams(serializeListViewState(state)).toString()).toBe(
      "q=needle&status=OPEN&ownerId=user_123&customFieldId=field_123&customFieldOperator=contains&customFieldValue=High&sortBy=title&sortDirection=asc&pageSize=25"
    );
    expect(
      listServiceFiltersFromSearchParams(
        {
          q: " needle ",
          status: "INVALID",
          ownerId: "user_123",
          sortBy: "title",
          sortDirection: "asc"
        },
        {
          defaultSortBy: "updatedAt",
          defaultSortDirection: "desc",
          filterKeys: ["status", "ownerId"],
          sortByValues: ["updatedAt", "title"] as const
        },
        { status: ["OPEN", "WON", "LOST"] }
      )
    ).toEqual({
      q: "needle",
      ownerId: "user_123",
      sortBy: "title",
      sortDirection: "asc"
    });
  });

  it("matches normalized current list state to a saved view for header status", () => {
    const state = parseListViewState(
      {
        q: " needle ",
        status: "OPEN",
        ownerId: "user_123",
        sortBy: "title",
        sortDirection: "asc",
        page: "4",
        pageSize: "25"
      },
      {
        defaultSortBy: "updatedAt",
        defaultSortDirection: "desc",
        filterKeys: ["status", "ownerId"],
        sortByValues: ["updatedAt", "title"] as const
      }
    );

    expect(
      findMatchingSavedViewName(state, [
        { name: "Open mine", href: "/deals?pageSize=25&sortDirection=asc&ownerId=user_123&status=OPEN&sortBy=title&q=needle" }
      ])
    ).toBe("Open mine");
    expect(
      findMatchingSavedViewName(state, [{ name: "Won deals", href: "/deals?status=WON&sortBy=title&sortDirection=asc&pageSize=25" }])
    ).toBeUndefined();
    expect(hasExplicitListStateParams({ page: "2" }, ["status", "ownerId"])).toBe(false);
    expect(hasExplicitListStateParams({ unrelated: "1" }, ["status", "ownerId"])).toBe(false);
    expect(hasExplicitListStateParams({ ownerId: "user_123" }, ["status", "ownerId"])).toBe(true);
    expect(hasExplicitListStateParams({ sortBy: "title" })).toBe(true);
    expect(ListViewStatus).toBeTypeOf("function");
    expect(ListViewStatusForState).toBeTypeOf("function");
  });

  it("clamps out-of-range pages and builds filter-preserving pagination links", () => {
    expect(resolvePagination(37, { page: 99, pageSize: 10 })).toMatchObject({
      page: 4,
      pageSize: 10,
      total: 37,
      totalPages: 4,
      skip: 30,
      from: 31,
      to: 37
    });
    expect(paginationHref("/deals", { status: "OPEN", sortBy: "valueCents", page: "3" }, 2, 10)).toBe(
      "/deals?status=OPEN&sortBy=valueCents&page=2&pageSize=10"
    );
    expect(listPageHref("/deals", { q: "needle", status: "OPEN", page: "2", empty: "" })).toBe(
      "/deals?q=needle&status=OPEN&page=2"
    );
  });

  it("keeps list filtering workspace-scoped in service functions", () => {
    expect(services).toContain("export type LeadListFilters");
    expect(services).toContain("export type PersonListFilters");
    expect(services).toContain("export type OrganizationListFilters");
    expect(services).toContain("export type ActivityListFilters");
    expect(services).toContain("export type DealListFilters");
    expect(services).toContain("workspaceId: actor.workspaceId");
    expect(services).toContain("q?: string");
    expect(services).toContain("contains: filters.q");
    expect(services).toContain("if (filters.ownerId) where.ownerId = filters.ownerId");
    expect(services).toContain("normalizeDealListStatus(filters.status)");
    expect(services).toContain("normalizeLeadListStatus(filters.status)");
    expect(services).toContain("normalizeDealFollowUpFilter(followUp)");
    expect(services).toContain("normalizeDealCommercialFilter(commercial)");
    expect(services).toContain("normalizeLeadFollowUpFilter(followUp)");
    expect(services).toContain("normalizeDealSortBy(filters.sortBy)");
    expect(services).toContain("normalizeDealSortDirection(filters.sortDirection)");
    expect(services).toContain("normalizeLeadSortBy(filters.sortBy)");
    expect(services).toContain("normalizeLeadSortDirection(filters.sortDirection)");
    expect(services).toContain("normalizePersonSortBy(filters.sortBy)");
    expect(services).toContain("normalizePersonSortDirection(filters.sortDirection)");
    expect(services).toContain("normalizeOrganizationSortBy(filters.sortBy)");
    expect(services).toContain("normalizeOrganizationSortDirection(filters.sortDirection)");
    expect(services).toContain("normalizeActivitySortBy(filters.sortBy)");
    expect(services).toContain("normalizeActivitySortDirection(filters.sortDirection)");
    expect(services).toContain("normalizeActivityStatusFilter(status)");
    expect(services).toContain("normalizeActivityDueFilter(due)");
    expect(services).toContain("normalizeActivityCompletedFilter(completed)");
    expect(services).toContain("Deal status filter must be OPEN, WON, or LOST.");
    expect(services).toContain("Lead status filter must be NEW, QUALIFIED, DISQUALIFIED, or CONVERTED.");
    expect(services).toContain("Activity status filter must be open or completed.");
    expect(services).toContain("Activity due filter must be overdue, today, upcoming, or unscheduled.");
    expect(services).toContain("Activity completed filter must be recent.");
    expect(services).toContain("Deal follow-up filter must be missing, overdue, today, upcoming, or unscheduled.");
    expect(services).toContain("Deal commercial filter must be noQuote, hasQuote, acceptedQuote, or valueNoLineItems.");
    expect(services).toContain("Lead follow-up filter must be missing, overdue, today, upcoming, or unscheduled.");
    expect(services).toContain("Deal sort field must be createdAt, updatedAt, title, valueCents, or expectedCloseAt.");
    expect(services).toContain("Lead sort direction must be asc or desc.");
    expect(services).toContain("Contact sort field must be createdAt, updatedAt, or name.");
    expect(services).toContain("Organization sort direction must be asc or desc.");
    expect(services).toContain("Activity sort field must be createdAt, updatedAt, title, dueAt, or completedAt.");
  });

  it("adds paginated list service variants with count, skip, and take", () => {
    for (const functionName of [
      "listDealsPage",
      "listLeadsPage",
      "listPeoplePage",
      "listOrganizationsPage",
      "listActivitiesPage"
    ]) {
      expect(services).toContain(`export async function ${functionName}`);
    }
    expect(services).toContain("prisma.deal.count");
    expect(services).toContain("prisma.lead.count");
    expect(services).toContain("prisma.person.count");
    expect(services).toContain("prisma.organization.count");
    expect(services).toContain("prisma.activity.count");
    expect(services).toContain("skip: pageInfo.skip");
    expect(services).toContain("take: pageInfo.pageSize");
  });

  it("adds filter forms to existing list pages with active-filter empty states", () => {
    for (const page of [leadsPage, contactsPage, organizationsPage]) {
      expect(page).toContain("searchParams: Promise<ListSearchParams>");
      expect(page).toContain("FilterPanel");
      expect(page).toContain("import { FormFieldLabel }");
      expect(page).toContain("<FormFieldLabel>Search</FormFieldLabel>");
      expect(page).toContain("hasActiveListViewFilters");
      expect(page).toContain("EmptyState");
      expect(page).toContain("as=\"section\"");
      expect(page).toContain("titleLevel=\"h2\"");
      expect(page).toContain("titleId=");
      expect(page).toContain("No ");
      expect(page).toContain("match these filters");
      expect(page).not.toContain("<section className=\"empty-state\">");
    }
    expect(activitiesPage).toContain("hasActiveListFilters");
    expect(activitiesPage).toContain("import { FormFieldLabel }");
    expect(activitiesPage).toContain("<FormFieldLabel>Search</FormFieldLabel>");
    expect(activitiesPage).toContain("<FormFieldLabel>Related record</FormFieldLabel>");
    expect(activitiesPage).toContain("hasActiveListFilters(params, [\"q\", \"status\", \"ownerId\", \"related\", \"due\", \"completed\"])");
    expect(activitiesPage).toContain("EmptyState");
    expect(activitiesPage).toContain("className=\"empty-state-compact\"");
    expect(activitiesPage).toContain("title={hasActiveFilters ? \"No activities match these filters\" : \"No activities yet\"}");
    expect(activitiesPage).toContain("titleId=\"activities-empty-title\"");
    expect(activitiesPage).not.toContain("<div className=\"empty-state empty-state-compact\">");
    expect(dealsPage).toContain("hasActiveListViewFilters");
    expect(dealsPage).toContain("import { FormFieldLabel }");
    expect(dealsPage).toContain("<FormFieldLabel>Search</FormFieldLabel>");
    expect(dealsPage).toContain('placeholder={listResourceSearchPlaceholder("deals")}');
    expect(contactsPage).toContain('placeholder={listResourceSearchPlaceholder("contacts")}');
    expect(organizationsPage).toContain('placeholder={listResourceSearchPlaceholder("organizations")}');
    expect(leadsPage).toContain('placeholder={listResourceSearchPlaceholder("leads")}');
    expect(listResourceLabels).toContain("export type ListResourceKey");
    expect(listResourceLabels).toContain("export function listResourceSearchPlaceholder");
    expect(listResourceLabels).not.toContain('import type { ExportResource }');
    expect(listResourceLabels).toContain("searchPlaceholder");
    expect(listResourceSearchPlaceholder("deals")).toBe("Deal title, contact, or organization");
    expect(listResourceSearchPlaceholder("contacts")).toBe("Name, email, phone, or organization");
    expect(listResourceSearchPlaceholder("organizations")).toBe("Organization name or domain");
    expect(listResourceSearchPlaceholder("leads")).toBe("Lead title, source, contact, or organization");
    expect(listResourceSearchPlaceholder("accounts")).toBe("Search records");
    expect(listResourcePluralLabel("accounts")).toBe("records");
    expect(listResourceSingularLabel("accounts")).toBe("Record");
    expect(listResourceCreateActionLabel("accounts", "New account")).toBe("New account");
    expect(dealsPage).toContain("<FormFieldLabel>Commercial</FormFieldLabel>");
    expect(dealsPage).toContain("EmptyState");
    expect(dealsPage).toContain("as=\"section\"");
    expect(dealsPage).toContain("titleLevel=\"h2\"");
    expect(dealsPage).toContain("titleId=\"deals-empty-title\"");
    expect(contactsPage).toContain("titleId=\"contacts-empty-title\"");
    expect(organizationsPage).toContain("titleId=\"organizations-empty-title\"");
    expect(leadsPage).toContain("titleId=\"leads-empty-title\"");
    expect(dealsPage).toContain("className=\"button-secondary\"");
    expect(dealsPage).toContain("View pipeline");
    expect(dealsPage).not.toContain("className=\"text-link\"");
    expect(dealsPage).not.toContain("<section className=\"empty-state\">");
    expect(filterPanel).toContain("aria-label={legend}");
    expect(globalStyles).toContain(".empty-state h3");
    expect(globalStyles).toContain(".empty-state h1");
    expect(globalStyles).toContain(".empty-state h2");
    expect(globalStyles).toContain(".empty-state p");
    expect(globalStyles).toContain(".empty-copy");
    expect(globalStyles).toContain("line-height: 1.5");
    expect(globalStyles).toContain("overflow-wrap: anywhere");
    expect(filterPanel).toContain("import { useId, type ReactNode } from \"react\"");
    expect(filterPanel).toContain("const generatedHelperId = useId()");
    expect(filterPanel).toContain("const helperId = `${generatedHelperId}-filter-help`");
    expect(filterPanel).toContain("aria-describedby={helperId}");
    expect(filterPanel).toContain("Apply filters to update this list. Clear filters returns to the full list.");
    expect(filterPanel).not.toContain("function filterPanelIdPrefix");
    expect(filterPanel).toContain("filter-form");
    expect(filterPanel).toContain("filter-actions");
    expect(filterPanel).toContain("const actionsLabel = `${legend} actions`");
    expect(filterPanel).toContain("import { ActionGroup }");
    expect(filterPanel).toContain("<ActionGroup className=\"filter-actions\" label={actionsLabel}>");
    expect(filterPanel).toContain("const applyLabel = `Apply ${legend.toLowerCase()}`");
    expect(filterPanel).toContain("const clearLabel = `Clear ${legend.toLowerCase()} and show all results`");
    expect(filterPanel).toContain("aria-label={applyLabel}");
    expect(filterPanel).toContain("title={applyLabel}");
    expect(filterPanel).toContain("aria-label={clearLabel}");
    expect(filterPanel).toContain("title={clearLabel}");
    expect(filterPanel).toContain("Clear filters");
    expect(leadsPage).toContain("name=\"status\"");
    expect(leadsPage).toContain("name=\"q\"");
    expect(leadsPage).toContain("name=\"source\"");
    expect(leadsPage).toContain("name=\"followUp\"");
    expect(leadsPage).toContain('legend="Lead filters"');
    expect(contactsPage).toContain("name=\"q\"");
    expect(contactsPage).toContain("name=\"organizationId\"");
    expect(contactsPage).toContain('legend="Contact filters"');
    expect(organizationsPage).toContain("name=\"q\"");
    expect(organizationsPage).toContain("name=\"ownerId\"");
    expect(organizationsPage).toContain('legend="Organization filters"');
    expect(dealsPage).toContain('legend="Deal filters"');
    expect(activitiesPage).toContain("name=\"q\"");
    expect(activitiesPage).toContain('legend="Activity filters"');
    expect(activitiesPage).toContain('placeholder={listResourceSearchPlaceholder("activities")}');
    expect(activitiesPage).toContain("name=\"due\"");
    expect(activitiesPage).toContain("name=\"related\"");
    expect(listViewStatus).toContain("export function ListViewStatusForState");
    expect(listViewStatus).toContain("label?: string");
    expect(listViewStatus).toContain("label={label}");
    expect(listViewStatus).toContain("findMatchingSavedViewName");
    expect(listViewStatus).toContain("Filtered view active");
    expect(listViewStatus).toContain("const statusLabel = savedViewName ? `Saved view: ${savedViewName}` : label");
    expect(listViewStatus).toContain("resetLabel = \"Clear filters\"");
    expect(listViewStatus).toContain("const resolvedResetLabel = savedViewName ? \"Clear saved view\" : resetLabel");
    expect(listViewStatus).toContain("const resetActionLabel = `${resolvedResetLabel}: ${statusLabel}`");
    expect(listViewStatus).toContain("const statusAnnouncement = `${statusLabel}. ${resolvedResetLabel} available.`");
    expect(listViewStatus).toContain("aria-atomic=\"true\"");
    expect(listViewStatus).toContain("aria-label={statusAnnouncement}");
    expect(listViewStatus).toContain("aria-live=\"polite\"");
    expect(listViewStatus).toContain("role=\"status\"");
    expect(listViewStatus).toContain("title={statusAnnouncement}");
    expect(listViewStatus).toContain('import { Badge } from "@/components/badge"');
    expect(listViewStatus).toContain("<Badge label={statusLabel}>{statusLabel}</Badge>");
    expect(globalStyles).toContain(".badge");
    expect(globalStyles).toContain("max-width: 100%");
    expect(globalStyles).toContain("white-space: normal");
    expect(listViewStatus).toContain("aria-label={resetActionLabel}");
    expect(listViewStatus).toContain("title={resetActionLabel}");
    for (const page of [leadsPage, contactsPage, organizationsPage, dealsPage]) {
      expect(page).toContain("ListViewStatusForState");
      expect(page).toContain("searchParams={params}");
      expect(page).toContain("savedViews={savedViews}");
      expect(page).toContain("TableScroll");
    }
    expect(dealsPage).toContain('label="Filtered deals view active"');
    expect(contactsPage).toContain('label="Filtered contacts view active"');
    expect(organizationsPage).toContain('label="Filtered organizations view active"');
    expect(leadsPage).toContain('label="Filtered leads view active"');
    expect(tableScroll).toContain("className={[\"table-scroll\", className].filter(Boolean).join(\" \")}");
    expect(tableScroll).toContain("hintId?: string");
    expect(tableScroll).toContain("import { useId, type ReactNode } from \"react\"");
    expect(tableScroll).toContain("const generatedHintId = useId()");
    expect(tableScroll).toContain("const resolvedHintId = hintId ?? `${generatedHintId}-table-scroll-hint`");
    expect(tableScroll).toContain("Use horizontal scrolling or keyboard arrow keys while focused to review every column.");
    expect(tableScroll).toContain("aria-describedby={resolvedHintId}");
    expect(tableScroll).toContain("className=\"sr-only table-scroll-hint\"");
    expect(tableScroll).toContain("id={resolvedHintId}");
    expect(tableScroll).toContain("{resolvedHint}");
    expect(tableScroll).toContain("role=\"region\"");
    expect(tableScroll).toContain("title={resolvedHint}");
    expect(tableScroll).toContain("tabIndex={0}");
    expect(globalStyles).toContain("scrollbar-gutter: stable;");
    expect(globalStyles).toContain("background-attachment: local, local, scroll, scroll;");
    expect(globalStyles).toContain("background-size:");
    expect(globalStyles).toContain("rgba(31, 41, 55, 0.12)");
    expect(globalStyles).toContain(".table-scroll:focus-visible");
    expect(globalStyles).toContain("outline-offset: 2px;");
    expect(leadsPage).toContain("<TableScroll aria-label=\"Leads list table\">");
    expect(contactsPage).toContain("<TableScroll aria-label=\"Contacts list table\">");
    expect(organizationsPage).toContain("<TableScroll aria-label=\"Organizations list table\">");
    expect(dealsPage).toContain("<TableScroll aria-label=\"Deals list table\">");
    expect(globalStyles).toContain(".table.crm-list-table");
    expect(globalStyles).toContain(".crm-list-table td::before");
    expect(globalStyles).toContain("content: attr(data-label)");
    expect(globalStyles).toContain(".crm-list-table tbody tr");
    expect(globalStyles).toContain(".table-primary-cell");
    expect(globalStyles).toContain(".table-primary-cell strong");
    expect(globalStyles).toContain(".table-secondary-text");
    expect(globalStyles).toContain(".inline-link:focus-visible");
    expect(globalStyles).toContain("text-underline-offset: 3px;");
    expect(globalStyles).toContain("min-width: 0");
    expect(globalStyles).toContain("overflow-wrap: anywhere");
    expect(tablePrimaryRecordCell).toContain("export function TablePrimaryRecordCell");
    expect(tablePrimaryRecordCell).toContain("\"table-primary-cell\"");
    expect(tablePrimaryRecordCell).toContain("linkLabel?: string");
    expect(tablePrimaryRecordCell).toContain("aria-label={linkLabel}");
    expect(tablePrimaryRecordCell).toContain("title={linkLabel}");
    expect(tablePrimaryRecordCell).toContain("className=\"inline-link\"");
    expect(tablePrimaryRecordCell).toContain("<strong>{title}</strong>");
    expect(tablePrimaryRecordCell).toContain("className=\"table-secondary-text\"");
    expect(tableLinkedRecordCell).toContain("export function TableLinkedRecordCell");
    expect(tableLinkedRecordCell).toContain("InlineEmptyStateText");
    expect(tableLinkedRecordCell).toContain("emptyLabel = \"No linked record\"");
    expect(tableLinkedRecordCell).toContain("className=\"inline-link\"");
    expect(tableLinkedRecordCell).toContain("href={href as Route}");
    expect(tableOwnerCell).toContain("export function TableOwnerCell");
    expect(tableOwnerCell).toContain("emptyLabel = \"Unassigned\"");
    expect(tableOwnerCell).toContain("const label = owner?.name ?? owner?.email");
    expect(tableOwnerCell).toContain("<InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>");
    expect(tableOptionalValueCell).toContain("export function TableOptionalValueCell");
    expect(tableOptionalValueCell).toContain("emptyLabel = \"Not set\"");
    expect(tableOptionalValueCell).toContain("const label = value?.trim()");
    expect(tableOptionalValueCell).toContain("<InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>");
    for (const page of [leadsPage, contactsPage, organizationsPage, dealsPage]) {
      expect(page).toContain("TablePrimaryRecordCell");
      expect(page).toContain("TableOwnerCell");
      expect(page).toContain("className=\"table crm-list-table\"");
      expect(page).toContain("data-label=\"Owner\"");
      expect(page).toContain("data-label=\"Next activity\"");
      expect(page).toContain("data-label=\"Custom fields\"");
      expect(page).toContain("data-label=\"Actions\"");
      expect(page).not.toContain('<span className="table-primary-cell">');
      expect(page).not.toContain('owner?.name ?? owner?.email ?? "Unassigned"');
    }
    expect(activitiesPage).toContain("ListViewStatus active={hasActiveFilters}");
    expect(activitiesPage).toContain("Filtered activities view active");
    expect(services).toContain("function applyActivitySearchFilter");
    expect(services).toContain("{ title: { contains: query, mode: \"insensitive\" } }");
    expect(services).toContain("{ description: { contains: query, mode: \"insensitive\" } }");
    expect(services).toContain("where.AND = [...existingAnd, searchFilter]");
  });

  it("mirrors active list searches into the global command search", () => {
    for (const page of [leadsPage, contactsPage, organizationsPage, dealsPage]) {
      expect(page).toContain("globalSearchDefaultValue={listState.q}");
    }

    expect(activitiesPage).toContain("const activityQuery = getSearchParam(params, \"q\")");
    expect(activitiesPage).toContain("globalSearchDefaultValue={activityQuery || undefined}");
  });

  it("adds activity-driven follow-up filters and next-activity columns to CRM lists", () => {
    expect(services).toContain("followUp?: \"missing\" | \"overdue\" | \"today\" | \"upcoming\" | \"unscheduled\"");
    expect(services).toContain("commercial?: \"noQuote\" | \"hasQuote\" | \"acceptedQuote\" | \"valueNoLineItems\"");
    expect(services).toContain("applyDealFollowUpFilter");
    expect(services).toContain("applyDealCommercialFilter");
    expect(services).toContain("applyLeadFollowUpFilter");
    expect(services).toContain("none: { workspaceId, completedAt: null");
    expect(services).toContain("activities: {");
    expect(dealsPage).toContain("name=\"followUp\"");
    expect(dealsPage).toContain("name=\"commercial\"");
    expect(dealsPage).toContain("Open deals missing next activity");
    expect(dealsPage).toContain("Open deals without quotes");
    expect(dealsPage).toContain("/deals?followUp=missing");
    expect(dealsPage).toContain("/deals?followUp=overdue");
    expect(dealsPage).toContain("/deals?commercial=noQuote");
    expect(dealsPage).toContain("<th>Commercial</th>");
    expect(dealsPage).toContain("<th>Next activity</th>");
    expect(leadsPage).toContain("Active leads missing next activity");
    expect(leadsPage).toContain("/leads?followUp=missing");
    expect(leadsPage).toContain("/leads?followUp=overdue");
    expect(leadsPage).toContain("<th>Next activity</th>");
    expect(contactsPage).toContain("<th>Next activity</th>");
    expect(organizationsPage).toContain("<th>Next activity</th>");
    for (const page of [dealsPage, leadsPage, contactsPage, organizationsPage]) {
      expect(page).toContain("ListNextActivitySummary");
    }
    expect(dealsPage).toContain('<ListNextActivitySummary activity={deal.activities[0]} emptyLabel="No deal follow-up" />');
    expect(contactsPage).toContain('<ListNextActivitySummary activity={person.activities[0]} emptyLabel="No contact follow-up" />');
    expect(organizationsPage).toContain('<ListNextActivitySummary activity={organization.activities[0]} emptyLabel="No organization follow-up" />');
    expect(leadsPage).toContain('<ListNextActivitySummary activity={lead.activities[0]} emptyLabel="No lead follow-up" />');
    expect(listNextActivitySummary).toContain("export function ListNextActivitySummary");
    expect(listNextActivitySummary).toContain("id?: string");
    expect(listNextActivitySummary).toContain("No open activity");
    expect(listNextActivitySummary).toContain("InlineEmptyStateText");
    expect(listNextActivitySummary).toContain("<InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>");
    expect(listNextActivitySummary).not.toContain('<span className="muted">{emptyLabel}</span>');
    expect(inlineEmptyStateText).toContain("export function InlineEmptyStateText");
    expect(inlineEmptyStateText).toContain("\"muted inline-empty-state-text\"");
    expect(listNextActivitySummary).toContain("const activityLabel = `Open next activity ${activity.title}`");
    expect(listNextActivitySummary).toContain("href={`/activities/${activity.id}/edit` as Route}");
    expect(listNextActivitySummary).toContain("aria-label={activityLabel}");
    expect(listNextActivitySummary).toContain("title={activityLabel}");
    expect(listNextActivitySummary).toContain("next-activity-summary-link");
    expect(listNextActivitySummary).toContain("ActivityDueBadge");
    expect(globalStyles).toContain(".next-activity-summary-link");
    expect(globalStyles).toContain(".inline-empty-state-text");
    expect(globalStyles).toContain("overflow-wrap: anywhere");
    expect(contactsPage).toContain("person.activities[0]");
    expect(organizationsPage).toContain("organization.activities[0]");
  });

  it("gives filtered empty states an explicit clear-filter action", () => {
    expect(listEmptyStateActions).toContain("export function ListEmptyStateActions");
    expect(listEmptyStateActions).toContain("createFromQueryHref");
    expect(listEmptyStateActions).toContain("createFromQueryLabel");
    expect(listEmptyStateActions).toContain("resultLabel");
    expect(listEmptyStateActions).toContain("Clear filters");
    expect(listEmptyStateActions).toContain("const clearActionLabel = `Clear filters and show all ${resultLabel}`");
    expect(listEmptyStateActions).toContain("const createFromQueryActionLabel = createFromQueryLabel");
    expect(listEmptyStateActions).toContain("const createActionLabel = `${createLabel}: add a new ${listResultSingularLabel(resultLabel)} record`");
    expect(listEmptyStateActions).toContain("const fallbackCreateAction = createFromQueryHref && createFromQueryLabel ? null : (");
    expect(listEmptyStateActions).toContain("{fallbackCreateAction}");
    expect(listEmptyStateActions).toContain('import { listResultSingularLabel } from "@/lib/list-resource-labels"');
    expect(listEmptyStateActions).toContain("aria-label={clearActionLabel}");
    expect(listEmptyStateActions).toContain("title={clearActionLabel}");
    expect(listEmptyStateActions).toContain("aria-label={createFromQueryActionLabel}");
    expect(listEmptyStateActions).toContain("title={createFromQueryActionLabel}");
    expect(listEmptyStateActions).toContain("aria-label={createActionLabel}");
    expect(listEmptyStateActions).toContain("title={createActionLabel}");
    expect(listEmptyStateActions).toContain("createLabel");
    expect(listEmptyStateActions).not.toContain("function singularResultLabel");
    expect(listResourceLabels).toContain("export function listResultSingularLabel");
    expect(listResourceLabels).toContain("return singular ? singular.toLowerCase() : resultLabel.replace(/s$/, \"\")");
    expect(listEmptyStateActions).toContain("className=\"button-primary\"");
    expect(listEmptyStateActions).toContain("className=\"button-secondary\"");
    expect(listEmptyStateActions).not.toContain("className=\"text-link\"");

    for (const [page, href, resultLabel, createFromSearchLabel] of [
      [dealsPage, "/deals", "deals", "Create deal from search"],
      [contactsPage, "/contacts", "contacts", "Create contact from search"],
      [organizationsPage, "/organizations", "organizations", "Create organization from search"],
      [leadsPage, "/leads", "leads", "Create lead from search"],
      [activitiesPage, "/activities", "activities", "Create activity from search"]
    ]) {
      expect(page).toContain("ListEmptyStateActions");
      expect(page).toContain("actions={");
      expect(page).toContain(`clearHref="${href}"`);
      expect(page).toContain("createFromQueryHref={createFromQueryHref}");
      expect(page).toContain(`createFromQueryLabel="${createFromSearchLabel}"`);
      expect(page).toContain(`resultLabel="${resultLabel}"`);
    }

    expect(dealsPage).toContain("prefillCreateHref(\"/deals/new\", \"title\", listState.q)");
    expect(contactsPage).toContain("prefillCreateHref(\"/contacts/new\", looksLikeEmail(listState.q) ? \"email\" : \"name\", listState.q)");
    expect(organizationsPage).toContain("prefillCreateHref(\"/organizations/new\", \"name\", listState.q)");
    expect(leadsPage).toContain("prefillCreateHref(\"/leads/new\", \"title\", listState.q)");
    expect(activitiesPage).toContain("prefillCreateHref(\"/activities/new\", \"title\", activityQuery)");
  });

  it("adds a simple deal list page without changing pipeline behavior", () => {
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(navigation).toContain("href: \"/deals\"");
    expect(dealsPage).toContain("export default async function DealsPage");
    expect(dealsPage).toContain("listDealsPage(actor");
    expect(dealsPage).toContain("name=\"q\"");
    expect(dealsPage).toContain("name=\"stageId\"");
    expect(dealsPage).toContain("name=\"personId\"");
    expect(dealsPage).toContain("name=\"organizationId\"");
    expect(dealsPage).toContain("href={`/deals/${deal.id}`}");
    expect(dealsPage).toContain("Track pipeline value, next activity, ownership, and customer relationships in one list.");
  });

  it("surfaces quick filter shortcuts on core CRM lists using existing query state", () => {
    expect(listQuickLinksPanel).toContain("export function ListQuickLinksPanel");
    expect(listQuickLinksPanel).toContain("PanelTitleRow");
    expect(listQuickLinksPanel).toContain('import { Badge } from "@/components/badge"');
    expect(listQuickLinksPanel).toContain("const quickLinkCountLabel = `${links.length} ${links.length === 1 ? \"shortcut\" : \"shortcuts\"} in ${title.toLowerCase()}`");
    expect(listQuickLinksPanel).toContain('<Badge className="count-badge" label={quickLinkCountLabel}>');
    expect(listQuickLinksPanel).toContain("actionsLabel={`${title} shortcut count`}");
    expect(listQuickLinksPanel).toContain("description={hint}");
    expect(listQuickLinksPanel).toContain("titleId={headingId}");
    expect(listQuickLinksPanel).toContain("list-quick-links-panel");
    expect(listQuickLinksPanel).toContain("list-quick-link-list");
    expect(listQuickLinksPanel).toContain("currentPath");
    expect(listQuickLinksPanel).toContain("searchParams");
    expect(listQuickLinksPanel).toContain("quickLinkIsActive(link.href, currentPath, searchParams)");
    expect(listQuickLinksPanel).toContain("quickLinkActionLabel(title, link.label, active)");
    expect(listQuickLinksPanel).toContain("const currentBadgeLabel = `${title}: ${link.label} is the current shortcut`");
    expect(listQuickLinksPanel).toContain("export function quickLinkActionLabel");
    expect(listQuickLinksPanel).toContain("aria-current={active ? \"page\" : undefined}");
    expect(listQuickLinksPanel).toContain("list-quick-link-item-active");
    expect(listQuickLinksPanel).toContain("<Badge label={currentBadgeLabel}>");
    expect(listQuickLinksPanel).toContain("current shortcut");
    expect(listQuickLinksPanel).toContain("aria-label={quickLinkLabel}");
    expect(listQuickLinksPanel).toContain("title={quickLinkLabel}");
    expect(globalStyles).toContain(".list-quick-links-panel");
    expect(globalStyles).toContain(".list-quick-link-item");
    expect(globalStyles).toContain(".list-quick-link-item-active");
    expect(globalStyles).toContain(".list-quick-link-item a");
    expect(globalStyles).not.toContain(".list-quick-links-header");
    expect(dealsPage).toContain("ListQuickLinksPanel");
    expect(dealsPage).toContain("DealQuickFilters");
    expect(dealsPage).toContain("<DealQuickFilters actorUserId={actorUserId} searchParams={params} />");
    expect(dealsPage).toContain("currentPath=\"/deals\"");
    expect(dealsPage).toContain("searchParams={searchParams}");
    expect(dealsPage).toContain("Quick deal filters");
    expect(dealsPage).toContain("/deals?status=OPEN&ownerId=");
    expect(dealsPage).toContain("/deals?followUp=missing");
    expect(dealsPage).toContain("/deals?followUp=today");
    expect(dealsPage).toContain("/deals?commercial=valueNoLineItems");
    expect(dealsPage).toContain("/deals?status=OPEN&sortBy=expectedCloseAt&sortDirection=asc");
    expect(dealsPage).toContain("/deals?status=OPEN&sortBy=valueCents&sortDirection=desc");
    expect(dealsPage).toContain("/deals?status=WON");
    expect(dealsPage).toContain("/deals?status=LOST");
    expect(leadsPage).toContain("ListQuickLinksPanel");
    expect(leadsPage).toContain("LeadQuickFilters");
    expect(leadsPage).toContain("<LeadQuickFilters searchParams={params} />");
    expect(leadsPage).toContain("currentPath=\"/leads\"");
    expect(leadsPage).toContain("Quick lead filters");
    expect(leadsPage).toContain("/leads?status=NEW");
    expect(leadsPage).toContain("/leads?status=QUALIFIED");
    expect(leadsPage).toContain("/leads?followUp=missing");
    expect(leadsPage).toContain("/leads?followUp=today");
    expect(leadsPage).toContain("/leads?status=CONVERTED");
    expect(contactsPage).toContain("ListQuickLinksPanel");
    expect(contactsPage).toContain("ContactQuickFilters");
    expect(contactsPage).toContain("<ContactQuickFilters actorUserId={actorUserId} searchParams={params} />");
    expect(contactsPage).toContain("currentPath=\"/contacts\"");
    expect(contactsPage).toContain("Quick contact filters");
    expect(contactsPage).toContain("/contacts?ownerId=");
    expect(contactsPage).toContain("/contacts?sortBy=updatedAt&sortDirection=desc");
    expect(contactsPage).toContain("/contacts?sortBy=createdAt&sortDirection=desc");
    expect(contactsPage).toContain("/contacts?sortBy=name&sortDirection=asc");
    expect(organizationsPage).toContain("ListQuickLinksPanel");
    expect(organizationsPage).toContain("OrganizationQuickFilters");
    expect(organizationsPage).toContain("<OrganizationQuickFilters actorUserId={actorUserId} searchParams={params} />");
    expect(organizationsPage).toContain("currentPath=\"/organizations\"");
    expect(organizationsPage).toContain("Quick organization filters");
    expect(organizationsPage).toContain("/organizations?ownerId=");
    expect(organizationsPage).toContain("/organizations?sortBy=updatedAt&sortDirection=desc");
    expect(organizationsPage).toContain("/organizations?sortBy=createdAt&sortDirection=desc");
    expect(organizationsPage).toContain("/organizations?sortBy=name&sortDirection=asc");
    expect(activitiesPage).toContain("ListQuickLinksPanel");
    expect(activitiesPage).toContain("<ActivityQuickLinks links={quickLinks} searchParams={params} />");
    expect(activitiesPage).toContain("currentPath=\"/activities\"");
    expect(activitiesPage).toContain("Quick activity links");
    expect(activitiesPage).toContain("Due quick links show open activities only.");
    for (const page of [dealsPage, contactsPage, organizationsPage, leadsPage, activitiesPage]) {
      expect(page).not.toContain("className=\"saved-view-item\" key={link.href}");
    }
    expect(savedViewsPanel).toContain("<section aria-labelledby={headingId} className=\"panel saved-views-panel\">");
    expect(savedViewsPanel).toContain("titleId={headingId}");
    expect(quickLinkIsActive("/deals?status=OPEN&ownerId=user_123", "/deals", { status: "OPEN", ownerId: "user_123", page: "2" })).toBe(true);
    expect(quickLinkIsActive("/contacts?sortBy=name&sortDirection=asc", "/contacts", { sortBy: "name", sortDirection: "asc" })).toBe(true);
    expect(quickLinkIsActive("/activities?status=open&due=today", "/activities", { status: "open", due: "today", pageSize: "25" })).toBe(true);
    expect(quickLinkIsActive("/dashboard", "/deals", {})).toBe(false);
    expect(quickLinkIsActive("/leads?status=NEW", "/leads", { status: "QUALIFIED" })).toBe(false);
    expect(quickLinkActionLabel("Quick deal filters", "My open deals")).toBe("Apply quick deal filters: My open deals");
    expect(quickLinkActionLabel("Quick lead filters", "New leads", true)).toBe("Quick lead filters: New leads, current shortcut");
  });

  it("adds compact row actions to core CRM list tables", () => {
    expect(listRowActions).toContain("export function ListRowActions");
    expect(listRowActions).toContain("\"aria-label\"?: string");
    expect(listRowActions).toContain("\"aria-label\": ariaLabel = \"Row actions\"");
    expect(listRowActions).toContain("if (actions.length === 0) return null");
    expect(listRowActions).toContain("const groupLabel = `${ariaLabel}: ${actions.length} ${actions.length === 1 ? \"action\" : \"actions\"}`");
    expect(listRowActions).toContain("import { ActionGroup }");
    expect(listRowActions).toContain('<ActionGroup className="table-row-actions" label={groupLabel}>');
    expect(listRowActions).toContain("const actionLabel = action.ariaLabel ?? action.label");
    expect(listRowActions).toContain("aria-label={actionLabel}");
    expect(listRowActions).toContain("title={actionLabel}");
    expect(listRowActions).toContain("button-secondary button-compact");
    expect(globalStyles).toContain(".table-actions-cell");
    expect(globalStyles).toContain(".table-row-actions");
    expect(globalStyles).toContain("justify-content: flex-end");
    expect(globalStyles).toContain(".crm-list-table .table-row-actions");
    expect(globalStyles).toContain("justify-content: flex-start");

    for (const page of [dealsPage, contactsPage, organizationsPage, leadsPage]) {
      expect(page).toContain("ListRowActions");
      expect(page).toContain("buildActivityFollowUpHref");
      expect(page).toContain("<th>Actions</th>");
      expect(page).toContain("className=\"table-actions-cell\"");
      expect(page).toContain("label: \"Add activity\"");
      expect(page).toContain("label: \"Edit\"");
    }

    expect(dealsPage).toContain("href: `/deals/${deal.id}`");
    expect(dealsPage).toContain('label: "Open deal"');
    expect(dealsPage).toContain("aria-label={`${deal.title} deal row actions`}");
    expect(dealsPage).toContain("deal.status === \"OPEN\"");
    expect(dealsPage).toContain("related: { type: \"deal\", id: deal.id }");
    expect(dealsPage).toContain("returnTo: listPageHref(\"/deals\", params)");
    expect(dealsPage).toContain("href: `/deals/${deal.id}/edit`");
    expect(contactsPage).toContain("href: `/contacts/${person.id}`");
    expect(contactsPage).toContain('label: "Open contact"');
    expect(personName).toContain("export function formatPersonName");
    expect(personName).toContain("return name || null");
    expect(formatPersonName({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
    expect(formatPersonName({ firstName: "Ada", lastName: null })).toBe("Ada");
    expect(formatPersonName({ firstName: "", lastName: null })).toBeNull();
    expect(contactsPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(contactsPage).toContain('const contactName = formatPersonName(person) ?? person.email ?? "Unnamed contact"');
    expect(contactsPage).toContain("aria-label={`${contactName} contact row actions`}");
    expect(contactsPage).toContain("related: { type: \"person\", id: person.id }");
    expect(contactsPage).toContain("returnTo: listPageHref(\"/contacts\", params)");
    expect(contactsPage).toContain("href: `/contacts/${person.id}/edit`");
    expect(organizationsPage).toContain("href: `/organizations/${organization.id}`");
    expect(organizationsPage).toContain('label: "Open account"');
    expect(organizationsPage).toContain("aria-label={`${organization.name} organization row actions`}");
    expect(organizationsPage).toContain("related: { type: \"organization\", id: organization.id }");
    expect(organizationsPage).toContain("returnTo: listPageHref(\"/organizations\", params)");
    expect(organizationsPage).toContain("href: `/organizations/${organization.id}/edit`");
    expect(leadsPage).toContain("href: `/leads/${lead.id}`");
    expect(leadsPage).toContain('label: "Open lead"');
    expect(leadsPage).toContain("aria-label={`${lead.title} lead row actions`}");
    expect(leadsPage).toContain("lead.status !== \"CONVERTED\"");
    expect(leadsPage).toContain("related: { type: \"lead\", id: lead.id }");
    expect(leadsPage).toContain("returnTo: listPageHref(\"/leads\", params)");
    expect(leadsPage).toContain("href: `/leads/${lead.id}/edit`");
    expect(dealsPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(dealsPage).not.toContain("function formatPersonName");
    expect(leadsPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(leadsPage).not.toContain("function formatPersonName");
    expect(relatedRecordsTable).toContain("aria-label={`${deal.title} related deal actions`}");
    expect(relatedRecordsTable).toContain("aria-label={`${personName} related contact actions`}");
  });

  it("uses a shared optional related-record cell in core CRM lists", () => {
    expect(tableLinkedRecordCell).toContain("export function TableLinkedRecordCell");
    expect(tableLinkedRecordCell).toContain("<InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>");
    expect(tableLinkedRecordCell).toContain("linkLabel?: string");
    expect(tableLinkedRecordCell).toContain("<Link aria-label={linkLabel} className=\"inline-link\" href={href as Route} title={linkLabel}>");

    expect(contactsPage).toContain("TableLinkedRecordCell");
    expect(contactsPage).toContain('emptyLabel="No organization"');
    expect(contactsPage).toContain('linkLabel={person.organization ? `Open organization ${person.organization.name}` : undefined}');
    expect(contactsPage).toContain("{person.organization?.name}");
    expect(contactsPage).not.toContain("<Link className=\"inline-link\" href={`/organizations/${person.organization.id}`}>");

    expect(leadsPage).toContain("TableLinkedRecordCell");
    expect(leadsPage).toContain('emptyLabel="No contact"');
    expect(leadsPage).toContain('emptyLabel="No organization"');
    expect(leadsPage).toContain('linkLabel={lead.person ? `Open contact ${formatPersonName(lead.person) ?? "Unnamed contact"}` : undefined}');
    expect(leadsPage).toContain('linkLabel={lead.organization ? `Open organization ${lead.organization.name}` : undefined}');
    expect(leadsPage).not.toContain("<Link className=\"inline-link\" href={`/contacts/${lead.person.id}`}>");
    expect(leadsPage).not.toContain("<Link className=\"inline-link\" href={`/organizations/${lead.organization.id}`}>");

    expect(dealsPage).toContain("TableLinkedRecordCell");
    expect(dealsPage).toContain("linkLabel={`Open deal ${deal.title}`}");
    expect(dealsPage).toContain('emptyLabel="No contact"');
    expect(dealsPage).toContain('emptyLabel="No organization"');
    expect(dealsPage).toContain('linkLabel={deal.person ? `Open contact ${formatPersonName(deal.person) ?? "Unnamed contact"}` : undefined}');
    expect(dealsPage).toContain('linkLabel={deal.organization ? `Open organization ${deal.organization.name}` : undefined}');
    expect(dealsPage).not.toContain("<Link className=\"inline-link\" href={`/contacts/${deal.person.id}`}>");
    expect(dealsPage).not.toContain("<Link className=\"inline-link\" href={`/organizations/${deal.organization.id}`}>");
  });

  it("uses a shared owner cell in core CRM list tables", () => {
    expect(tableOwnerCell).toContain("export function TableOwnerCell");
    expect(tableOwnerCell).toContain("owner?: TableOwner");
    expect(tableOwnerCell).toContain("return <span>{label}</span>;");

    expect(contactsPage).toContain("<TableOwnerCell owner={person.owner} />");
    expect(contactsPage).toContain("linkLabel={`Open contact ${contactName}`}");
    expect(organizationsPage).toContain("<TableOwnerCell owner={organization.owner} />");
    expect(organizationsPage).toContain("linkLabel={`Open organization ${organization.name}`}");
    expect(leadsPage).toContain("<TableOwnerCell owner={lead.owner} />");
    expect(leadsPage).toContain("linkLabel={`Open lead ${lead.title}`}");
    expect(dealsPage).toContain("<TableOwnerCell owner={deal.owner} />");
  });

  it("uses a shared optional-value cell for sparse list table fields", () => {
    expect(tableOptionalValueCell).toContain("export function TableOptionalValueCell");
    expect(tableOptionalValueCell).toContain("value?: string | null");
    expect(tableOptionalValueCell).toContain("return <span>{label}</span>;");

    expect(contactsPage).toContain('<TableOptionalValueCell emptyLabel="No email" value={person.email} />');
    expect(contactsPage).toContain('<TableOptionalValueCell emptyLabel="No phone" value={person.phone} />');
    expect(contactsPage).not.toContain('person.email ?? "None"');
    expect(contactsPage).not.toContain('person.phone ?? "None"');

    expect(organizationsPage).toContain('<TableOptionalValueCell emptyLabel="No domain" value={organization.domain} />');
    expect(organizationsPage).not.toContain('organization.domain ?? "None"');

    expect(leadsPage).toContain('<TableOptionalValueCell emptyLabel="No source" value={lead.source} />');
    expect(leadsPage).not.toContain('lead.source ?? "None"');
    expect(dealsPage).toContain("import { TableOptionalValueCell }");
    expect(dealsPage).toContain('emptyLabel="No expected close"');
    expect(dealsPage).toContain("value={deal.expectedCloseAt ? formatDate(deal.expectedCloseAt) : null}");
    expect(dealsPage).toContain('emptyConfiguredLabel="No deal fields"');
    expect(contactsPage).toContain('emptyConfiguredLabel="No contact fields"');
    expect(organizationsPage).toContain('emptyConfiguredLabel="No organization fields"');
    expect(leadsPage).toContain('emptyConfiguredLabel="No lead fields"');
  });

  it("supports basic sort controls for each list", () => {
    for (const page of [leadsPage, contactsPage, organizationsPage, activitiesPage, dealsPage]) {
      expect(page).toContain("ListSortControls");
    }
    expect(listSortControls).toContain("export function ListSortControls");
    expect(listSortControls).toContain("import { FormFieldLabel }");
    expect(listSortControls).toContain("<FormFieldLabel>Sort by</FormFieldLabel>");
    expect(listSortControls).toContain("<FormFieldLabel>Direction</FormFieldLabel>");
    expect(listSortControls).toContain("name=\"sortBy\"");
    expect(listSortControls).toContain("name=\"sortDirection\"");
    expect(listSortControls).toContain('const sortBySelectLabel = "Choose list sort field"');
    expect(listSortControls).toContain('const sortDirectionSelectLabel = "Choose list sort direction"');
    expect(listSortControls).toContain("aria-label={sortBySelectLabel}");
    expect(listSortControls).toContain("title={sortBySelectLabel}");
    expect(listSortControls).toContain("aria-label={sortDirectionSelectLabel}");
    expect(listSortControls).toContain("title={sortDirectionSelectLabel}");
    expect(listSortControls).toContain("function sortDirectionLabel");
    expect(listSortControls).toContain("Ascending (A-Z, oldest, low to high)");
    expect(listSortControls).toContain("Descending (Z-A, newest, high to low)");
    expect(listSortControls).toContain("directionOptions");
    expect(dealsPage).toContain("dealSortOptions");
    expect(dealsPage).toContain("value: \"expectedCloseAt\"");
    expect(contactsPage).toContain("contactSortOptions");
    expect(contactsPage).toContain("directionOptions={[\"asc\", \"desc\"]}");
    expect(organizationsPage).toContain("organizationSortOptions");
    expect(leadsPage).toContain("leadSortOptions");
    expect(activitiesPage).toContain("activitySortOptions");
    expect(activitiesPage).toContain("enumSearchParam(params, \"sortBy\", activitySorts) ?? \"dueAt\"");
    expect(services).toContain("function leadOrderBy");
    expect(services).toContain("function personOrderBy");
    expect(services).toContain("function organizationOrderBy");
    expect(services).toContain("function activityOrderBy");
    expect(services).toContain("function dealOrderBy");
  });

  it("uses shared form labels on reusable list filter controls", () => {
    expect(customFieldListSummary).toContain("import { FormFieldLabel }");
    expect(customFieldListSummary).toContain("aria-label={summaryLabel}");
    expect(customFieldListSummary).toContain("title={summaryLabel}");
    expect(customFieldListSummary).toContain("<FormFieldLabel>Custom field</FormFieldLabel>");
    expect(customFieldListSummary).toContain("<FormFieldLabel>Custom operator</FormFieldLabel>");
    expect(customFieldListSummary).toContain("<FormFieldLabel>Custom value</FormFieldLabel>");
    expect(listSortControls).toContain("<FormFieldLabel>Sort by</FormFieldLabel>");
    expect(listSortControls).toContain("<FormFieldLabel>Direction</FormFieldLabel>");
    expect(listSortControls).toContain("aria-label={sortBySelectLabel}");
    expect(listSortControls).toContain("aria-label={sortDirectionSelectLabel}");
  });

  it("renders pagination controls on paginated list pages", () => {
    expect(paginationControls).toContain("ariaLabel = \"Pagination\"");
    expect(paginationControls).toContain("aria-label={ariaLabel}");
    expect(paginationControls).toContain("const currentPageLabel = `Page ${pageInfo.page} of ${pageInfo.totalPages}`");
    expect(paginationControls).toContain("const actionsLabel = `${ariaLabel} actions for ${currentPageLabel.toLowerCase()}`");
    expect(paginationControls).toContain("import { ActionGroup }");
    expect(paginationControls).toContain('<ActionGroup className="pagination-actions" label={actionsLabel}>');
    expect(paginationControls).toContain("Previous");
    expect(paginationControls).toContain("Next");
    expect(paginationControls).toContain("export function paginationSummaryLabel");
    expect(paginationControls).toContain("const summaryLabel = paginationSummaryLabel(pageInfo)");
    expect(paginationControls).toContain("Showing ${pageInfo.from}-${pageInfo.to} of ${pageInfo.total}");
    expect(paginationControls).toContain("aria-atomic=\"true\"");
    expect(paginationControls).toContain("aria-label={`${summaryLabel}. ${currentPageLabel}.`}");
    expect(paginationControls).toContain("const previousLabel = pageInfo.hasPreviousPage");
    expect(paginationControls).toContain("const nextLabel = pageInfo.hasNextPage");
    expect(paginationControls).toContain("`Go to page ${pageInfo.page - 1}`");
    expect(paginationControls).toContain("`Go to page ${pageInfo.page + 1}`");
    expect(paginationControls).toContain("Previous page unavailable");
    expect(paginationControls).toContain("Next page unavailable");
    expect(paginationControls).toContain("aria-label={previousLabel}");
    expect(paginationControls).toContain("aria-label={nextLabel}");
    expect(paginationControls).toContain("role=\"status\"");
    expect(paginationControls).toContain("title={`${summaryLabel}. ${currentPageLabel}.`}");
    expect(paginationControls).toContain("title={previousLabel}");
    expect(paginationControls).toContain("title={nextLabel}");
    expect(paginationControls).toContain("aria-current=\"page\"");
    expect(paginationControls).toContain("title={currentPageLabel}");
    expect(listResultsSummary).toContain("export function ListResultsSummary");
    expect(listResultsSummary).toContain("ariaLabel = \"List results summary\"");
    expect(listResultsSummary).toContain("const resolvedAriaLabel");
    expect(listResultsSummary).toContain("aria-label={resolvedAriaLabel}");
    expect(listResultsSummary).toContain("aria-atomic=\"true\"");
    expect(listResultsSummary).toContain("role=\"status\"");
    expect(listResultsSummary).toContain("Showing ${pageInfo.from}-${pageInfo.to} of ${pageInfo.total} ${label}");
    expect(listResultsSummary).toContain("activeFilters ? `No matching ${label} to show` : `No ${label} to show`");
    expect(listResultsSummary).toContain("export function listResultsAnnouncement");
    expect(listResultsSummary).toContain("export function listResultsPageLabel");
    expect(listResultsSummary).toContain("const pageLabel = listResultsPageLabel(pageInfo)");
    expect(listResultsSummary).toContain('className="list-results-meta"');
    expect(listResultsSummary).toContain("aria-label={`${scopeLabel}. ${pageLabel}.`}");
    expect(listResultsSummary).toContain('import { Badge } from "@/components/badge"');
    expect(listResultsSummary).toContain("<Badge label={scopeLabel}>{scopeLabel}</Badge>");
    expect(listResultsSummary).toContain("<Badge label={pageLabel}>{pageLabel}</Badge>");
    expect(listResultsSummary).toContain("Page ${pageInfo.page} of ${pageInfo.totalPages}");
    expect(listResultsSummary).toContain("listResultsSummaryText(pageInfo, label, activeFilters)}. ${listResultsScopeLabel(pageInfo, label, activeFilters)}. ${listResultsPageLabel(pageInfo)}.");
    expect(listResultsSummary).toContain("listResultsScopeLabel(pageInfo, label, activeFilters)");
    expect(listResultsSummary).toContain("title={resolvedAriaLabel}");
    expect(listResultsSummary).toContain("No matching ${label}");
    expect(listResultsSummary).toContain("No ${label} yet");
    expect(listResultsSummary).toContain("Filtered ${label}");
    expect(listResultsSummary).toContain("All ${label}");
    expect(
      listResultsSummaryText(
        {
          from: 11,
          hasNextPage: true,
          hasPreviousPage: true,
          page: 2,
          pageSize: 10,
          skip: 10,
          to: 20,
          total: 34,
          totalPages: 4
        },
        "deals"
      )
    ).toBe("Showing 11-20 of 34 deals");
    expect(
      listResultsScopeLabel(
        {
          from: 0,
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 10,
          skip: 0,
          to: 0,
          total: 0,
          totalPages: 1
        },
        "deals",
        true
      )
    ).toBe("No matching deals");
    expect(
      listResultsSummaryText(
        {
          from: 0,
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 10,
          skip: 0,
          to: 0,
          total: 0,
          totalPages: 1
        },
        "deals",
        true
      )
    ).toBe("No matching deals to show");
    expect(
      listResultsSummaryText(
        {
          from: 0,
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 10,
          skip: 0,
          to: 0,
          total: 0,
          totalPages: 1
        },
        "deals"
      )
    ).toBe("No deals to show");
    expect(
      listResultsScopeLabel(
        {
          from: 1,
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 10,
          skip: 0,
          to: 4,
          total: 4,
          totalPages: 1
        },
        "contacts",
        false
      )
    ).toBe("All contacts");
    expect(
      listResultsPageLabel({
        from: 11,
        hasNextPage: true,
        hasPreviousPage: true,
        page: 2,
        pageSize: 10,
        skip: 10,
        to: 20,
        total: 34,
        totalPages: 4
      })
    ).toBe("Page 2 of 4");
    expect(
      listResultsPageLabel({
        from: 0,
        hasNextPage: false,
        hasPreviousPage: false,
        page: 1,
        pageSize: 10,
        skip: 0,
        to: 0,
        total: 0,
        totalPages: 1
      })
    ).toBe("Page 0 of 0");
    expect(
      listResultsAnnouncement(
        {
          from: 1,
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 10,
          skip: 0,
          to: 4,
          total: 4,
          totalPages: 1
        },
        "contacts",
        true
      )
    ).toBe("Showing 1-4 of 4 contacts. Filtered contacts. Page 1 of 1.");
    expect(
      listResultsAnnouncement(
        {
          from: 0,
          hasNextPage: false,
          hasPreviousPage: false,
          page: 1,
          pageSize: 10,
          skip: 0,
          to: 0,
          total: 0,
          totalPages: 1
        },
        "contacts",
        true
      )
    ).toBe("No matching contacts to show. No matching contacts. Page 0 of 0.");
    for (const page of [leadsPage, contactsPage, organizationsPage, dealsPage]) {
      expect(page).toContain("parseListViewState(params");
      expect(page).toContain("pageSize={listState.pagination.pageSize}");
      expect(page).toContain("ListResultsSummary");
      expect(page).toContain("activeFilters={hasActiveFilters}");
      expect(page).toContain("PaginationControls");
    }
    expect(activitiesPage).toContain("parsePagination(params)");
    for (const page of [activitiesPage]) {
      expect(page).toContain("pageSize={pagination.pageSize}");
      expect(page).toContain("ListResultsSummary");
      expect(page).toContain("activeFilters={hasActiveFilters}");
      expect(page).toContain("PaginationControls");
    }
  });
});
