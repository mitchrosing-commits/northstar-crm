import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  contactSavedViewHref,
  dealSavedViewHref,
  leadSavedViewHref,
  organizationSavedViewHref
} from "@/lib/services/saved-view-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(join(process.cwd(), "prisma/migrations/0002_saved_views/migration.sql"), "utf8");
const contactListState = readFileSync(join(process.cwd(), "lib/contact-list-state.ts"), "utf8");
const dealListState = readFileSync(join(process.cwd(), "lib/deal-list-state.ts"), "utf8");
const leadListState = readFileSync(join(process.cwd(), "lib/lead-list-state.ts"), "utf8");
const organizationListState = readFileSync(join(process.cwd(), "lib/organization-list-state.ts"), "utf8");
const listQuery = readFileSync(join(process.cwd(), "lib/list-page-query.ts"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/services/saved-view-service.ts"), "utf8");
const barrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const contactsPage = readFileSync(join(process.cwd(), "app/contacts/page.tsx"), "utf8");
const dealsPage = readFileSync(join(process.cwd(), "app/deals/page.tsx"), "utf8");
const leadsPage = readFileSync(join(process.cwd(), "app/leads/page.tsx"), "utf8");
const organizationsPage = readFileSync(join(process.cwd(), "app/organizations/page.tsx"), "utf8");
const dealSavedViewsPanel = readFileSync(join(process.cwd(), "components/deal-saved-views-panel.tsx"), "utf8");
const contactActions = readFileSync(join(process.cwd(), "app/contacts/actions.ts"), "utf8");
const dealActions = readFileSync(join(process.cwd(), "app/deals/actions.ts"), "utf8");
const leadActions = readFileSync(join(process.cwd(), "app/leads/actions.ts"), "utf8");
const organizationActions = readFileSync(join(process.cwd(), "app/organizations/actions.ts"), "utf8");

describe("Deals, Leads, Contacts, and Organizations saved views MVP", () => {
  it("adds a workspace-scoped saved view table for record-type list state", () => {
    expect(schema).toContain("model SavedView");
    expect(schema).toMatch(/savedViews\s+SavedView\[\]/);
    expect(schema).toMatch(/recordType\s+SavedViewRecordType/);
    expect(schema).toMatch(/state\s+Json/);
    expect(schema).toContain("@@index([workspaceId, recordType])");
    expect(schema).toContain("enum SavedViewRecordType");
    expect(migration).toContain("CREATE TABLE \"SavedView\"");
    expect(migration).toContain("\"state\" JSONB NOT NULL");
    expect(migration).toContain("\"SavedViewRecordType\" AS ENUM");
    expect(schema).toContain("enum SavedViewRecordType");
    expect(schema).toContain("DEAL");
    expect(schema).toContain("LEAD");
    expect(schema).toContain("PERSON");
    expect(schema).toContain("ORGANIZATION");
  });

  it("serializes normalized list-view state into stable query params", () => {
    expect(listQuery).toContain("export type SerializedListViewState");
    expect(listQuery).toContain("SerializedListViewState<TSortBy extends string = string, TFilterKey extends string = string>");
    expect(listQuery).toContain("filters: Partial<Record<TFilterKey, string>>");
    expect(listQuery).toContain("export function serializeListViewState");
    expect(listQuery).toContain("export function serializedListViewStateToSearchParams");
    expect(listQuery).toContain("params.set(\"sortBy\", state.sortBy)");
    expect(listQuery).toContain("params.set(\"pageSize\", String(state.pageSize))");
  });

  it("builds Deal saved-view hrefs from persisted list state without preserving transient page numbers", () => {
    expect(
      dealSavedViewHref({
        q: "Needle",
        filters: {
          status: "OPEN",
          stageId: "stage_123",
          ownerId: "user_123",
          personId: "person_123",
          organizationId: "org_123",
          customFieldId: "field_123",
          customFieldOperator: "contains",
          customFieldValue: "High"
        },
        sortBy: "valueCents",
        sortDirection: "asc",
        pageSize: 25
      })
    ).toBe(
      "/deals?q=Needle&status=OPEN&stageId=stage_123&ownerId=user_123&personId=person_123&organizationId=org_123&customFieldId=field_123&customFieldOperator=contains&customFieldValue=High&sortBy=valueCents&sortDirection=asc&pageSize=25"
    );
    expect(
      dealSavedViewHref({
        filters: {},
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 10
      })
    ).toBe("/deals?sortBy=updatedAt&sortDirection=desc&pageSize=10");
    expect(
      dealSavedViewHref({
        filters: {
          customFieldId: "field_123",
          customFieldValue: "High"
        },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 10
      })
    ).toBe("/deals?customFieldId=field_123&customFieldValue=High&sortBy=updatedAt&sortDirection=desc&pageSize=10");
  });

  it("keeps saved view services deal-first and workspace-scoped", () => {
    expect(barrel).toContain("export * from \"./saved-view-service\"");
    expect(service).toContain("export async function listDealSavedViews");
    expect(service).toContain("export async function createDealSavedView");
    expect(service).toContain("export async function deleteDealSavedView");
    expect(service).toContain("export async function listLeadSavedViews");
    expect(service).toContain("export async function createLeadSavedView");
    expect(service).toContain("export async function deleteLeadSavedView");
    expect(service).toContain("export async function listContactSavedViews");
    expect(service).toContain("export async function createContactSavedView");
    expect(service).toContain("export async function deleteContactSavedView");
    expect(service).toContain("export async function listOrganizationSavedViews");
    expect(service).toContain("export async function createOrganizationSavedView");
    expect(service).toContain("export async function deleteOrganizationSavedView");
    expect(service).toContain("export function dealSavedViewHref");
    expect(service).toContain("export function leadSavedViewHref");
    expect(service).toContain("export function contactSavedViewHref");
    expect(service).toContain("export function organizationSavedViewHref");
    expect(service).toContain("function listSavedViews");
    expect(service).toContain("function createSavedView");
    expect(service).toContain("function deleteSavedView");
    expect(service).toContain("ensureWorkspaceAccess(actor)");
    expect(service).toContain("recordType: \"DEAL\"");
    expect(service).toContain("recordType: \"LEAD\"");
    expect(service).toContain("recordType: \"PERSON\"");
    expect(service).toContain("recordType: \"ORGANIZATION\"");
    expect(service).toContain("workspaceId: actor.workspaceId");
    expect(service).toContain("normalizeSavedViewState");
    expect(service).toContain("type SerializedDealListState");
    expect(service).toContain("type SerializedLeadListState");
    expect(service).toContain("type SerializedContactListState");
    expect(service).toContain("type SerializedOrganizationListState");
    expect(service).toContain("const q = typeof value.q === \"string\" && value.q.trim() ? value.q.trim() : undefined");
    expect(service).toContain("stringIn(value.sortBy, config.sortByValues) ?? config.defaultState.sortBy");
    expect(service).toContain("boundedPositiveInt(value.pageSize, config.defaultState.pageSize, 1, 50)");
    expect(service).toContain("for (const key of filterKeys)");
    expect(dealListState).toContain("export const dealListStateOptions");
    expect(dealListState).toContain("\"customFieldOperator\"");
    expect(dealListState).toContain("export type DealListFilterKey");
    expect(dealListState).toContain("export type DealListSort");
    expect(leadListState).toContain("export const leadListStateOptions");
    expect(leadListState).toContain("\"customFieldOperator\"");
    expect(leadListState).toContain("export type LeadListFilterKey");
    expect(leadListState).toContain("export type LeadListSort");
    expect(contactListState).toContain("export const contactListStateOptions");
    expect(contactListState).toContain("\"organizationId\"");
    expect(contactListState).toContain("\"customFieldOperator\"");
    expect(contactListState).toContain("export type ContactListFilterKey");
    expect(contactListState).toContain("export type ContactListSort");
    expect(organizationListState).toContain("export const organizationListStateOptions");
    expect(organizationListState).toContain("\"ownerId\"");
    expect(organizationListState).toContain("\"customFieldOperator\"");
    expect(organizationListState).toContain("export type OrganizationListFilterKey");
    expect(organizationListState).toContain("export type OrganizationListSort");
  });

  it("builds Lead saved-view hrefs from persisted list state without preserving transient page numbers", () => {
    expect(
      leadSavedViewHref({
        q: "Needle",
        filters: {
          status: "QUALIFIED",
          source: "Referral",
          ownerId: "user_123",
          customFieldId: "field_123",
          customFieldOperator: "is_not_empty",
          customFieldValue: "High"
        },
        sortBy: "title",
        sortDirection: "asc",
        pageSize: 25
      })
    ).toBe(
      "/leads?q=Needle&status=QUALIFIED&source=Referral&ownerId=user_123&customFieldId=field_123&customFieldOperator=is_not_empty&customFieldValue=High&sortBy=title&sortDirection=asc&pageSize=25"
    );
    expect(
      leadSavedViewHref({
        filters: {
          customFieldId: "field_123",
          customFieldValue: "High"
        },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 10
      })
    ).toBe("/leads?customFieldId=field_123&customFieldValue=High&sortBy=updatedAt&sortDirection=desc&pageSize=10");
    expect(
      leadSavedViewHref({
        filters: {},
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 10
      })
    ).toBe("/leads?sortBy=updatedAt&sortDirection=desc&pageSize=10");
  });

  it("builds Contact saved-view hrefs from persisted list state without preserving transient page numbers", () => {
    expect(
      contactSavedViewHref({
        q: "Needle",
        filters: {
          organizationId: "org_123",
          ownerId: "user_123",
          customFieldId: "field_123",
          customFieldOperator: "contains",
          customFieldValue: "Decision maker"
        },
        sortBy: "name",
        sortDirection: "asc",
        pageSize: 25
      })
    ).toBe(
      "/contacts?q=Needle&organizationId=org_123&ownerId=user_123&customFieldId=field_123&customFieldOperator=contains&customFieldValue=Decision+maker&sortBy=name&sortDirection=asc&pageSize=25"
    );
    expect(
      contactSavedViewHref({
        filters: {
          customFieldId: "field_123",
          customFieldValue: "High"
        },
        sortBy: "name",
        sortDirection: "asc",
        pageSize: 10
      })
    ).toBe("/contacts?customFieldId=field_123&customFieldValue=High&sortBy=name&sortDirection=asc&pageSize=10");
    expect(
      contactSavedViewHref({
        filters: {},
        sortBy: "name",
        sortDirection: "asc",
        pageSize: 10
      })
    ).toBe("/contacts?sortBy=name&sortDirection=asc&pageSize=10");
  });

  it("builds Organization saved-view hrefs from persisted list state without preserving transient page numbers", () => {
    expect(
      organizationSavedViewHref({
        q: "Needle",
        filters: {
          ownerId: "user_123",
          customFieldId: "field_123",
          customFieldOperator: "contains",
          customFieldValue: "Enterprise"
        },
        sortBy: "updatedAt",
        sortDirection: "desc",
        pageSize: 25
      })
    ).toBe(
      "/organizations?q=Needle&ownerId=user_123&customFieldId=field_123&customFieldOperator=contains&customFieldValue=Enterprise&sortBy=updatedAt&sortDirection=desc&pageSize=25"
    );
    expect(
      organizationSavedViewHref({
        filters: {
          customFieldId: "field_123",
          customFieldValue: "High"
        },
        sortBy: "name",
        sortDirection: "asc",
        pageSize: 10
      })
    ).toBe(
      "/organizations?customFieldId=field_123&customFieldValue=High&sortBy=name&sortDirection=asc&pageSize=10"
    );
    expect(
      organizationSavedViewHref({
        filters: {},
        sortBy: "name",
        sortDirection: "asc",
        pageSize: 10
      })
    ).toBe("/organizations?sortBy=name&sortDirection=asc&pageSize=10");
  });

  it("wires Deals, Leads, Contacts, and Organizations saved views through server actions and their list pages only", () => {
    expect(contactsPage).toContain("ContactSavedViewsPanel");
    expect(contactsPage).toContain("listContactSavedViews(actor)");
    expect(contactsPage).toContain("<ContactSavedViewsPanel listState={listState} savedViews={savedViews} />");
    expect(organizationsPage).toContain("OrganizationSavedViewsPanel");
    expect(organizationsPage).toContain("listOrganizationSavedViews(actor)");
    expect(organizationsPage).toContain("<OrganizationSavedViewsPanel listState={listState} savedViews={savedViews} />");
    expect(dealsPage).toContain("DealSavedViewsPanel");
    expect(dealsPage).toContain("listDealSavedViews(actor)");
    expect(dealsPage).toContain("<DealSavedViewsPanel listState={listState} savedViews={savedViews} />");
    expect(leadsPage).toContain("LeadSavedViewsPanel");
    expect(leadsPage).toContain("listLeadSavedViews(actor)");
    expect(leadsPage).toContain("<LeadSavedViewsPanel listState={listState} savedViews={savedViews} />");
    expect(dealSavedViewsPanel).toContain("createDealSavedViewAction");
    expect(dealSavedViewsPanel).toContain("deleteDealSavedViewAction");
    expect(dealSavedViewsPanel).toContain("createContactSavedViewAction");
    expect(dealSavedViewsPanel).toContain("deleteContactSavedViewAction");
    expect(dealSavedViewsPanel).toContain("createOrganizationSavedViewAction");
    expect(dealSavedViewsPanel).toContain("deleteOrganizationSavedViewAction");
    expect(dealSavedViewsPanel).toContain("createLeadSavedViewAction");
    expect(dealSavedViewsPanel).toContain("deleteLeadSavedViewAction");
    expect(dealSavedViewsPanel).toContain("serializeListViewState(listState)");
    expect(dealSavedViewsPanel).toContain("href={view.href as Route}");
    expect(dealSavedViewsPanel).toContain("Delete view");
    expect(dealSavedViewsPanel).toContain("Saved contact views");
    expect(dealSavedViewsPanel).toContain("Saved deal views");
    expect(dealSavedViewsPanel).toContain("Saved lead views");
    expect(dealSavedViewsPanel).toContain("Saved organization views");
    expect(dealSavedViewsPanel).toContain("No contact views saved yet.");
    expect(dealSavedViewsPanel).toContain("No deal views saved yet.");
    expect(dealSavedViewsPanel).toContain("No lead views saved yet.");
    expect(dealSavedViewsPanel).toContain("No organization views saved yet.");
    expect(dealSavedViewsPanel).not.toContain("Saved views are available for Deals and Leads");
    expect(contactActions).toContain("\"use server\"");
    expect(contactActions).toContain("parseListViewState(formDataToSearchParams(formData)");
    expect(contactActions).toContain("contactListStateOptions");
    expect(contactActions).toContain("createContactSavedView(actor");
    expect(contactActions).toContain("const { actor } = await getCurrentWorkspaceContext()");
    expect(contactActions).toContain("deleteContactSavedView(actor, savedViewId)");
    expect(contactActions).toContain("revalidatePath(\"/contacts\")");
    expect(organizationActions).toContain("\"use server\"");
    expect(organizationActions).toContain("parseListViewState(formDataToSearchParams(formData)");
    expect(organizationActions).toContain("organizationListStateOptions");
    expect(organizationActions).toContain("createOrganizationSavedView(actor");
    expect(organizationActions).toContain("const { actor } = await getCurrentWorkspaceContext()");
    expect(organizationActions).toContain("deleteOrganizationSavedView(actor, savedViewId)");
    expect(organizationActions).toContain("revalidatePath(\"/organizations\")");
    expect(dealActions).toContain("\"use server\"");
    expect(dealActions).toContain("parseListViewState(formDataToSearchParams(formData)");
    expect(dealActions).toContain("createDealSavedView(actor");
    expect(dealActions).toContain("const { actor } = await getCurrentWorkspaceContext()");
    expect(dealActions).toContain("deleteDealSavedView(actor, savedViewId)");
    expect(leadActions).toContain("\"use server\"");
    expect(leadActions).toContain("parseListViewState(formDataToSearchParams(formData)");
    expect(leadActions).toContain("leadListStateOptions");
    expect(leadActions).toContain("createLeadSavedView(actor");
    expect(leadActions).toContain("const { actor } = await getCurrentWorkspaceContext()");
    expect(leadActions).toContain("deleteLeadSavedView(actor, savedViewId)");
  });
});
