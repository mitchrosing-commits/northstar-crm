import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  enumListViewFilter,
  hasActiveListViewFilters,
  paginationHref,
  parseListViewState,
  parsePagination,
  resolvePagination,
  serializeListViewState,
  serializedListViewStateToSearchParams
} from "@/lib/list-page-query";

const queryHelper = readFileSync(join(process.cwd(), "lib/list-page-query.ts"), "utf8");
const paginationControls = readFileSync(join(process.cwd(), "components/pagination-controls.tsx"), "utf8");
const filterPanel = readFileSync(join(process.cwd(), "components/filter-panel.tsx"), "utf8");
const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
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
    expect(queryHelper).toContain("export function enumListViewFilter");
    expect(queryHelper).toContain("export function hasActiveListViewFilters");
    expect(queryHelper).toContain("export function parsePagination");
    expect(queryHelper).toContain("export function resolvePagination");
    expect(queryHelper).toContain("export function paginationHref");
    expect(queryHelper).toContain("export const sortDirections");
  });

  it("parses and clamps pagination query parameters", () => {
    expect(parsePagination({ page: "3", pageSize: "20" })).toEqual({ page: 3, pageSize: 20 });
    expect(parsePagination({ page: "-5", pageSize: "500" })).toEqual({ page: 1, pageSize: 50 });
    expect(parsePagination({ page: "nope", pageSize: "nope" })).toEqual({ page: 1, pageSize: 10 });
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
    expect(services).toContain("if (filters.status) where.status = filters.status");
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
      expect(page).toContain("hasActiveListViewFilters");
      expect(page).toContain("No ");
      expect(page).toContain("match these filters");
    }
    expect(activitiesPage).toContain("hasActiveListFilters");
    expect(dealsPage).toContain("hasActiveListViewFilters");
    expect(filterPanel).toContain("filter-form");
    expect(filterPanel).toContain("filter-actions");
    expect(filterPanel).toContain("Clear filters");
    expect(leadsPage).toContain("name=\"status\"");
    expect(leadsPage).toContain("name=\"q\"");
    expect(leadsPage).toContain("name=\"source\"");
    expect(contactsPage).toContain("name=\"q\"");
    expect(contactsPage).toContain("name=\"organizationId\"");
    expect(organizationsPage).toContain("name=\"q\"");
    expect(organizationsPage).toContain("name=\"ownerId\"");
    expect(activitiesPage).toContain("name=\"due\"");
    expect(activitiesPage).toContain("name=\"related\"");
  });

  it("adds a simple deal list page without changing pipeline behavior", () => {
    expect(appShell).toContain("href: \"/deals\"");
    expect(dealsPage).toContain("export default async function DealsPage");
    expect(dealsPage).toContain("listDealsPage(actor");
    expect(dealsPage).toContain("name=\"q\"");
    expect(dealsPage).toContain("name=\"stageId\"");
    expect(dealsPage).toContain("name=\"personId\"");
    expect(dealsPage).toContain("name=\"organizationId\"");
    expect(dealsPage).toContain("href={`/deals/${deal.id}`}");
  });

  it("surfaces quick filter shortcuts on deal and lead lists using existing query state", () => {
    expect(dealsPage).toContain("DealQuickFilters");
    expect(dealsPage).toContain("Quick deal filters");
    expect(dealsPage).toContain("/deals?status=OPEN&ownerId=");
    expect(dealsPage).toContain("/deals?status=OPEN&sortBy=expectedCloseAt&sortDirection=asc");
    expect(dealsPage).toContain("/deals?status=OPEN&sortBy=valueCents&sortDirection=desc");
    expect(dealsPage).toContain("/deals?status=WON");
    expect(dealsPage).toContain("/deals?status=LOST");
    expect(leadsPage).toContain("LeadQuickFilters");
    expect(leadsPage).toContain("Quick lead filters");
    expect(leadsPage).toContain("/leads?status=NEW");
    expect(leadsPage).toContain("/leads?status=QUALIFIED");
    expect(leadsPage).toContain("/leads?status=CONVERTED");
  });

  it("supports basic sort controls for each list", () => {
    for (const page of [leadsPage, contactsPage, organizationsPage, activitiesPage, dealsPage]) {
      expect(page).toContain("name=\"sortBy\"");
      expect(page).toContain("name=\"sortDirection\"");
      expect(page).toContain("SortControls");
    }
    expect(services).toContain("function leadOrderBy");
    expect(services).toContain("function personOrderBy");
    expect(services).toContain("function organizationOrderBy");
    expect(services).toContain("function activityOrderBy");
    expect(services).toContain("function dealOrderBy");
  });

  it("renders pagination controls on paginated list pages", () => {
    expect(paginationControls).toContain("Previous");
    expect(paginationControls).toContain("Next");
    expect(paginationControls).toContain("Showing ${pageInfo.from}-${pageInfo.to} of ${pageInfo.total}");
    for (const page of [leadsPage, contactsPage, organizationsPage, dealsPage]) {
      expect(page).toContain("parseListViewState(params");
      expect(page).toContain("pageSize={listState.pagination.pageSize}");
      expect(page).toContain("PaginationControls");
    }
    expect(activitiesPage).toContain("parsePagination(params)");
    for (const page of [activitiesPage]) {
      expect(page).toContain("PaginationControls");
    }
  });
});
