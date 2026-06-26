import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { formatCsv, parseCsv } from "@/lib/csv";

const csvHelper = readFileSync(join(process.cwd(), "lib/csv.ts"), "utf8");
const exportService = readFileSync(join(process.cwd(), "lib/services/export-service.ts"), "utf8");
const importUtils = readFileSync(join(process.cwd(), "lib/services/import-utils.ts"), "utf8");
const dealImportService = readFileSync(join(process.cwd(), "lib/services/deal-import-service.ts"), "utf8");
const goalService = readFileSync(join(process.cwd(), "lib/services/goal-service.ts"), "utf8");
const contactImportService = readFileSync(join(process.cwd(), "lib/services/contact-import-service.ts"), "utf8");
const leadImportService = readFileSync(join(process.cwd(), "lib/services/lead-import-service.ts"), "utf8");
const organizationImportService = readFileSync(join(process.cwd(), "lib/services/organization-import-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const workspaceRoute = readFileSync(join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const importExportPage = readFileSync(join(process.cwd(), "app/settings/import-export/page.tsx"), "utf8");
const dealImportForm = readFileSync(join(process.cwd(), "app/settings/import-export/deal-import-form.tsx"), "utf8");
const contactImportForm = readFileSync(join(process.cwd(), "app/settings/import-export/contact-import-form.tsx"), "utf8");
const leadImportForm = readFileSync(join(process.cwd(), "app/settings/import-export/lead-import-form.tsx"), "utf8");
const organizationImportForm = readFileSync(join(process.cwd(), "app/settings/import-export/organization-import-form.tsx"), "utf8");
const importExportActions = readFileSync(join(process.cwd(), "app/settings/import-export/actions.ts"), "utf8");
const routeMap = readFileSync(join(process.cwd(), "docs/api-route-map.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("Import/export MVP", () => {
  it("formats CSV with deterministic columns and proper escaping", () => {
    expect(
      formatCsv(
        [
          { header: "name", value: (row: { name: string }) => row.name },
          { header: "note", value: (row: { note: string | null }) => row.note },
          { header: "createdAt", value: (row: { createdAt: Date }) => row.createdAt }
        ],
        [
          {
            name: "Orbit, Labs",
            note: "Said \"yes\"\nNext quarter",
            createdAt: new Date("2030-01-02T03:04:05.000Z")
          },
          {
            name: "Canopy",
            note: null,
            createdAt: new Date("2030-02-03T04:05:06.000Z")
          }
        ]
      )
    ).toBe(
      [
        "name,note,createdAt",
        "\"Orbit, Labs\",\"Said \"\"yes\"\"\nNext quarter\",2030-01-02T03:04:05.000Z",
        "Canopy,,2030-02-03T04:05:06.000Z"
      ].join("\n")
    );
    expect(csvHelper).toContain("escapeCsvCell");
  });

  it("parses CSV with quoted values, CRLF/LF newlines, and deterministic malformed errors", () => {
    expect(parseCsv("name,domain\r\n\"Orbit, Labs\",\"orbit.example\"\n\"Quoted \"\"Name\"\"\",\"line\nbreak\"")).toEqual({
      headers: ["name", "domain"],
      rows: [
        ["Orbit, Labs", "orbit.example"],
        ["Quoted \"Name\"", "line\nbreak"]
      ]
    });
    expect(parseCsv("name,domain\nAcme,")).toEqual({
      headers: ["name", "domain"],
      rows: [["Acme", ""]]
    });
    expect(() => parseCsv("name\n\"Acme")).toThrow("Unclosed quoted field");
    expect(() => parseCsv("name\n\"Acme\"x")).toThrow("Unexpected character after closing quote");
  });

  it("adds workspace-scoped CSV exports for core CRM records", () => {
    expect(crmBarrel).toContain("export * from \"./export-service\"");
    expect(exportService).toContain("export const exportResources = [\"deals\", \"contacts\", \"organizations\", \"leads\", \"activities\", \"quotes\"]");
    expect(exportService).toContain("export async function exportWorkspaceCsv");
    expect(exportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(exportService).toContain("workspaceId: actor.workspaceId");
    expect(exportService).toContain("listCustomFieldExportColumns");
    expect(exportService).toContain("header: `Custom: ${field.name}`");
    expect(exportService).toContain("orderBy: [{ name: \"asc\" }, { key: \"asc\" }, { id: \"asc\" }]");
    expect(exportService).toContain("northstar-deals.csv");
    expect(exportService).toContain("northstar-contacts.csv");
    expect(exportService).toContain("northstar-organizations.csv");
    expect(exportService).toContain("northstar-leads.csv");
    expect(exportService).toContain("northstar-activities.csv");
    expect(exportService).toContain("northstar-quotes.csv");
    expect(exportService).toContain("{ header: \"title\"");
    expect(exportService).toContain("{ header: \"status\"");
    expect(exportService).toContain("{ header: \"value\"");
    expect(exportService).toContain("{ header: \"currency\"");
    expect(exportService).toContain("{ header: \"pipeline\"");
    expect(exportService).toContain("{ header: \"stage\"");
    expect(exportService).toContain("{ header: \"expectedCloseAt\"");
    expect(exportService).toContain("{ header: \"contactName\"");
    expect(exportService).toContain("{ header: \"contactEmail\"");
    expect(exportService).toContain("{ header: \"organizationName\"");
    expect(exportService).toContain("{ header: \"ownerEmail\"");
    expect(exportService).toContain("{ header: \"createdAt\"");
    expect(exportService).toContain("{ header: \"updatedAt\"");
    expect(exportService).toContain("{ header: \"dueAt\"");
    expect(exportService).toContain("{ header: \"completedAt\"");
    expect(exportService).toContain("{ header: \"number\"");
    expect(exportService).toContain("{ header: \"total\"");
    expect(exportService).toContain("{ header: \"itemCount\"");
    expect(exportService).not.toContain("authorId");
    expect(exportService).not.toContain("membership");
  });

  it("wires export routes and settings UI with aligned import wording", () => {
    expect(workspaceRoute).toContain("resource === \"exports\"");
    expect(workspaceRoute).toContain("exportWorkspaceCsv(actor, idOrNested)");
    expect(workspaceRoute).toContain("\"content-type\": \"text/csv; charset=utf-8\"");
    expect(settingsPage).toContain("href=\"/settings/import-export\"");
    expect(importExportPage).toContain("CSV Exports");
    expect(importExportPage).toContain("Download CSV");
    expect(importExportPage).toContain("/exports/${resource}");
    expect(importExportPage).toContain("workspace custom fields");
    expect(importExportPage).toContain("Activities");
    expect(importExportPage).toContain("Quotes");
    expect(importExportPage).toContain("Deals Import Preview");
    expect(importExportPage).toContain("Organizations Import Preview");
    expect(importExportPage).toContain("Contacts Import Preview");
    expect(importExportPage).toContain("Leads Import Preview");
    expect(dealImportForm).toContain("Deals preview and import");
    expect(dealImportForm).toContain("name=\"dealCsv\"");
    expect(dealImportForm).toContain("Preview deals");
    expect(dealImportForm).toContain("Import valid deals");
    expect(dealImportForm).toContain("createdCount");
    expect(dealImportForm).toContain("duplicates skipped");
    expect(dealImportForm).toContain("duplicates to skip");
    expect(dealImportForm).toContain("invalid rows skipped");
    expect(dealImportForm).toContain("invalid rows to skip");
    expect(dealImportForm).toContain("skipReasons");
    expect(dealImportForm).toContain("total rows");
    expect(dealImportForm).toContain("unsupported columns");
    expect(dealImportForm).toContain("Ignored unsupported columns, not imported");
    expect(organizationImportForm).toContain("Organizations preview and import");
    expect(organizationImportForm).toContain("name=\"organizationCsv\"");
    expect(organizationImportForm).toContain("Import valid organizations");
    expect(organizationImportForm).toContain("createdCount");
    expect(organizationImportForm).toContain("duplicates skipped");
    expect(organizationImportForm).toContain("duplicates to skip");
    expect(organizationImportForm).toContain("invalid rows skipped");
    expect(organizationImportForm).toContain("invalid rows to skip");
    expect(organizationImportForm).toContain("skipReasons");
    expect(contactImportForm).toContain("createdCount");
    expect(contactImportForm).toContain("duplicates skipped");
    expect(contactImportForm).toContain("duplicates to skip");
    expect(contactImportForm).toContain("invalid rows skipped");
    expect(contactImportForm).toContain("invalid rows to skip");
    expect(contactImportForm).toContain("skipReasons");
    expect(leadImportForm).toContain("Leads preview and import");
    expect(leadImportForm).toContain("Preview leads");
    expect(leadImportForm).toContain("Import valid leads");
    expect(leadImportForm).toContain("createdCount");
    expect(leadImportForm).toContain("duplicates skipped");
    expect(leadImportForm).toContain("duplicates to skip");
    expect(leadImportForm).toContain("invalid rows to skip");
    expect(leadImportForm).toContain("skipReasons");
    expect(dealImportForm).not.toContain("type=\"file\"");
    expect(organizationImportForm).not.toContain("type=\"file\"");
    expect(contactImportForm).not.toContain("type=\"file\"");
    expect(leadImportForm).not.toContain("type=\"file\"");
    expect(importExportActions).toContain("previewDealImportAction");
    expect(importExportActions).toContain("previewOrganizationImportAction");
    expect(importExportActions).toContain("previewContactImportAction");
    expect(importExportActions).toContain("previewLeadImportAction");
    expect(importExportActions).toContain("previewDealImport(actor, csvText)");
    expect(importExportActions).toContain("previewOrganizationImport(actor, csvText)");
    expect(importExportActions).toContain("previewContactImport(actor, csvText)");
    expect(importExportActions).toContain("previewLeadImport(actor, csvText)");
    expect(importExportActions).toContain("importDealsFromCsv(actor, csvText)");
    expect(importExportActions).toContain("importOrganizationsFromCsv(actor, csvText)");
    expect(importExportActions).toContain("intent === \"import\"");
    expect(importExportPage).not.toContain("type=\"file\"");
    expect(routeMap).toContain("GET  /api/v1/workspaces/:workspaceId/exports/deals");
    expect(currentStatus).toContain("workspace-scoped CSV export");
  });

  it("adds Deals import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain("export * from \"./deal-import-service\"");
    expect(importUtils).toContain("\"deal\"");
    expect(dealImportService).toContain("export async function previewDealImport");
    expect(dealImportService).toContain("export async function importDealsFromCsv");
    expect(dealImportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(dealImportService).toContain("Deal title is required.");
    expect(dealImportService).toContain("Pipeline is required.");
    expect(dealImportService).toContain("Stage is required.");
    expect(dealImportService).toContain("Pipeline must already exist in this workspace; no default pipeline is inferred.");
    expect(dealImportService).toContain("Stage must already exist in the resolved pipeline; stages from other pipelines are not used.");
    expect(dealImportService).toContain("Owner email must match an active user who belongs to this workspace.");
    expect(dealImportService).toContain("Contact must already exist in this workspace; contacts are not auto-created.");
    expect(dealImportService).toContain("Contact reference matches multiple contacts in this workspace.");
    expect(dealImportService).toContain("Organization must already exist in this workspace; organizations are not auto-created.");
    expect(dealImportService).toContain("Deal value must be a non-negative amount with at most two decimal places.");
    expect(dealImportService).toContain("Unsupported columns are ignored and not imported.");
    expect(dealImportService).toContain("Imported WON/LOST status does not set wonAt/lostAt or lost reason");
    expect(dealImportService).toContain("Duplicate skipped: a deal with the same title, pipeline, stage, contact, and organization already exists in this workspace.");
    expect(dealImportService).toContain("Duplicate skipped: another CSV row has the same title, pipeline, stage, contact, and organization.");
    expect(dealImportService).toContain("countImportPreviewRows");
    expect(dealImportService).toContain("listUnsupportedImportColumns");
    expect(dealImportService).toContain("const preview = await previewDealImport(actor, csvText)");
    expect(dealImportService).toContain("row.status !== \"valid\"");
    expect(dealImportService).toContain("prisma.deal.create");
    expect(dealImportService).toContain("status: row.statusValue");
    expect(dealImportService).not.toContain("wonAt:");
    expect(dealImportService).not.toContain("lostAt:");
    expect(dealImportService).toContain("writeAuditLog");
    expect(dealImportService).toContain("deal.imported");
    expect(dealImportService).toContain("buildImportAuditMetadata(\"deal\"");
    expect(dealImportService).toContain("workspaceId: actor.workspaceId");
    expect(dealImportService).not.toContain("upsert");
    expect(dealImportService).not.toContain("createMany");
    expect(dealImportForm).toContain("Deals preview and import");
    expect(dealImportForm).toContain("Preview deals");
    expect(dealImportForm).toContain("Import valid deals");
    expect(dealImportForm).toContain("contacts, organizations, and leads are not auto-created");
    expect(dealImportForm).toContain("Deal custom field import is deferred");
    expect(dealImportForm).toContain("Imported WON and LOST status does not set");
    expect(dealImportForm).toContain("imported won deals do not count toward Goals v1 until closed in-app");
    expect(goalService).toContain("status: DealStatus.WON");
    expect(goalService).toContain("wonAt: {");
    expect(goalService).toContain("gte: periodStart");
    expect(goalService).toContain("lt: periodEnd");
    expect(importExportActions).toContain("importDealsFromCsv(actor, csvText)");
    expect(currentStatus).toContain("Deals import creation is conservative");
    expect(currentStatus).toContain("Imported won deals with null `wonAt` are excluded from Goals v1 progress");
    expect(routeMap).toContain("Deals import validates");
  });

  it("adds Contacts import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain("export * from \"./contact-import-service\"");
    expect(importUtils).toContain("export function countImportPreviewRows");
    expect(importUtils).toContain("export function createImportResultCounts");
    expect(importUtils).toContain("export function buildImportAuditMetadata");
    expect(importUtils).toContain("export function groupImportRecordsByName");
    expect(importUtils).toContain("export function listUnsupportedImportColumns");
    expect(importUtils).toContain("export function normalizeImportEmailKey");
    expect(importUtils).toContain("export function normalizeImportNameKey");
    expect(contactImportService).toContain("export async function previewContactImport");
    expect(contactImportService).toContain("export async function importContactsFromCsv");
    expect(contactImportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(contactImportService).toContain("Contact name is required.");
    expect(contactImportService).toContain("Duplicate contact email in this workspace.");
    expect(contactImportService).toContain("Duplicate contact email in this CSV.");
    expect(contactImportService).toContain("Organization name was not found in this workspace.");
    expect(contactImportService).toContain("Organization name matches multiple organizations in this workspace.");
    expect(contactImportService).toContain("countImportPreviewRows");
    expect(contactImportService).toContain("listUnsupportedImportColumns");
    expect(contactImportService).toContain("const preview = await previewContactImport(actor, csvText)");
    expect(contactImportService).toContain("row.status !== \"valid\"");
    expect(contactImportService).toContain("prisma.person.create");
    expect(contactImportService).toContain("writeAuditLog");
    expect(contactImportService).toContain("contact.imported");
    expect(contactImportService).toContain("buildImportAuditMetadata(\"contact\"");
    expect(contactImportService).not.toContain("upsert");
    expect(contactImportForm).toContain("Contacts preview and import");
    expect(contactImportForm).toContain("Preview contacts");
    expect(contactImportForm).toContain("Import valid contacts");
    expect(contactImportForm).toContain("createdCount");
    expect(contactImportForm).toContain("duplicates skipped");
    expect(contactImportForm).toContain("name=\"contactCsv\"");
    expect(contactImportForm).toContain("duplicates to skip");
    expect(contactImportForm).not.toContain("type=\"file\"");
    expect(importExportActions).toContain("importContactsFromCsv(actor, csvText)");
    expect(importExportActions).toContain("intent === \"import\"");
  });

  it("adds Leads import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain("export * from \"./lead-import-service\"");
    expect(leadImportService).toContain("export async function previewLeadImport");
    expect(leadImportService).toContain("export async function importLeadsFromCsv");
    expect(leadImportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(leadImportService).toContain("Lead title is required.");
    expect(leadImportService).toContain("Duplicate lead title in this workspace.");
    expect(leadImportService).toContain("Duplicate lead title in this CSV.");
    expect(leadImportService).toContain("Lead status must be NEW, QUALIFIED, or DISQUALIFIED.");
    expect(leadImportService).toContain("Converted leads cannot be imported through CSV.");
    expect(leadImportService).toContain("Organization name was not found in this workspace.");
    expect(leadImportService).toContain("Organization name matches multiple organizations in this workspace.");
    expect(leadImportService).toContain("countImportPreviewRows");
    expect(leadImportService).toContain("listUnsupportedImportColumns");
    expect(leadImportService).toContain("const preview = await previewLeadImport(actor, csvText)");
    expect(leadImportService).toContain("row.status !== \"valid\"");
    expect(leadImportService).toContain("prisma.lead.create");
    expect(leadImportService).toContain("writeAuditLog");
    expect(leadImportService).toContain("lead.imported");
    expect(leadImportService).toContain("buildImportAuditMetadata(\"lead\"");
    expect(leadImportService).not.toContain("upsert");
    expect(leadImportForm).toContain("Leads preview and import");
    expect(leadImportForm).toContain("Preview leads");
    expect(leadImportForm).toContain("Import valid leads");
    expect(leadImportForm).toContain("createdCount");
    expect(leadImportForm).toContain("duplicates skipped");
    expect(leadImportForm).toContain("name=\"leadCsv\"");
    expect(leadImportForm).toContain("duplicates to skip");
    expect(importExportActions).toContain("importLeadsFromCsv(actor, csvText)");
  });

  it("adds Organizations import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain("export * from \"./organization-import-service\"");
    expect(organizationImportService).toContain("export async function previewOrganizationImport");
    expect(organizationImportService).toContain("export async function importOrganizationsFromCsv");
    expect(organizationImportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(organizationImportService).toContain("CSV must include a name column.");
    expect(organizationImportService).toContain("unsupportedColumns");
    expect(organizationImportService).toContain("Duplicate organization name in this workspace.");
    expect(organizationImportService).toContain("Duplicate organization name in this CSV.");
    expect(organizationImportService).toContain("countImportPreviewRows");
    expect(organizationImportService).toContain("listUnsupportedImportColumns");
    expect(organizationImportService).toContain("const preview = await previewOrganizationImport(actor, csvText)");
    expect(organizationImportService).toContain("row.status !== \"valid\"");
    expect(organizationImportService).toContain("organization.imported");
    expect(organizationImportService).toContain("buildImportAuditMetadata(\"organization\"");
    expect(organizationImportService).toContain("workspaceId: actor.workspaceId");
    expect(organizationImportService).not.toContain("upsert");
  });
});
