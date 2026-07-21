import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildListExportHref,
  exportRowCountLabel,
  exportHelperText,
  fullWorkspaceExportHelperText,
  hasExportScopeSearchParams,
  hasExportSearchParams,
  hasExportSortParams,
} from "@/lib/list-export-href";
import { formatCsv, parseCsv } from "@/lib/csv";
import {
  formatImportParseError,
  listUnsupportedImportColumns,
  normalizeImportHeader,
} from "@/lib/services/import-utils";
import { searchParamsToListSearchParams } from "@/lib/list-page-query";

const csvHelper = readFileSync(join(process.cwd(), "lib/csv.ts"), "utf8");
const exportService = readFileSync(
  join(process.cwd(), "lib/services/export-service.ts"),
  "utf8",
);
const importUtils = readFileSync(
  join(process.cwd(), "lib/services/import-utils.ts"),
  "utf8",
);
const dealImportService = readFileSync(
  join(process.cwd(), "lib/services/deal-import-service.ts"),
  "utf8",
);
const goalService = readFileSync(
  join(process.cwd(), "lib/services/goal-service.ts"),
  "utf8",
);
const contactImportService = readFileSync(
  join(process.cwd(), "lib/services/contact-import-service.ts"),
  "utf8",
);
const leadImportService = readFileSync(
  join(process.cwd(), "lib/services/lead-import-service.ts"),
  "utf8",
);
const organizationImportService = readFileSync(
  join(process.cwd(), "lib/services/organization-import-service.ts"),
  "utf8",
);
const crmBarrel = readFileSync(
  join(process.cwd(), "lib/services/crm.ts"),
  "utf8",
);
const workspaceRoute = readFileSync(
  join(
    process.cwd(),
    "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts",
  ),
  "utf8",
);
const settingsPage = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);
const importExportPage = readFileSync(
  join(process.cwd(), "app/settings/import-export/page.tsx"),
  "utf8",
);
const pipelinePage = readFileSync(
  join(process.cwd(), "app/pipeline/page.tsx"),
  "utf8",
);
const compactTitleRow = readFileSync(
  join(process.cwd(), "components/compact-title-row.tsx"),
  "utf8",
);
const badge = readFileSync(join(process.cwd(), "components/badge.tsx"), "utf8");
const fieldMetric = readFileSync(
  join(process.cwd(), "components/field-metric.tsx"),
  "utf8",
);
const pageHeader = readFileSync(
  join(process.cwd(), "components/page-header.tsx"),
  "utf8",
);
const tableScroll = readFileSync(
  join(process.cwd(), "components/table-scroll.tsx"),
  "utf8",
);
const formCallout = readFileSync(
  join(process.cwd(), "components/form-callout.tsx"),
  "utf8",
);
const dealsPage = readFileSync(
  join(process.cwd(), "app/deals/page.tsx"),
  "utf8",
);
const contactsPage = readFileSync(
  join(process.cwd(), "app/contacts/page.tsx"),
  "utf8",
);
const organizationsPage = readFileSync(
  join(process.cwd(), "app/organizations/page.tsx"),
  "utf8",
);
const leadsPage = readFileSync(
  join(process.cwd(), "app/leads/page.tsx"),
  "utf8",
);
const activitiesPage = readFileSync(
  join(process.cwd(), "app/activities/page.tsx"),
  "utf8",
);
const listExportLink = readFileSync(
  join(process.cwd(), "components/list-export-link.tsx"),
  "utf8",
);
const listExportHref = readFileSync(
  join(process.cwd(), "lib/list-export-href.ts"),
  "utf8",
);
const downloadAction = readFileSync(
  join(process.cwd(), "components/download-action.tsx"),
  "utf8",
);
const listPageHeaderActions = readFileSync(
  join(process.cwd(), "components/list-page-header-actions.tsx"),
  "utf8",
);
const listResourceLabels = readFileSync(
  join(process.cwd(), "lib/list-resource-labels.ts"),
  "utf8",
);
const dealImportForm = readFileSync(
  join(process.cwd(), "app/settings/import-export/deal-import-form.tsx"),
  "utf8",
);
const contactImportForm = readFileSync(
  join(process.cwd(), "app/settings/import-export/contact-import-form.tsx"),
  "utf8",
);
const leadImportForm = readFileSync(
  join(process.cwd(), "app/settings/import-export/lead-import-form.tsx"),
  "utf8",
);
const organizationImportForm = readFileSync(
  join(
    process.cwd(),
    "app/settings/import-export/organization-import-form.tsx",
  ),
  "utf8",
);
const importFormShared = readFileSync(
  join(process.cwd(), "app/settings/import-export/import-form-shared.tsx"),
  "utf8",
);
const importExportActions = readFileSync(
  join(process.cwd(), "app/settings/import-export/actions.ts"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
const routeMap = readFileSync(
  join(process.cwd(), "docs/api-route-map.md"),
  "utf8",
);
const currentStatus = readFileSync(
  join(process.cwd(), "docs/current-status.md"),
  "utf8",
);
const deploymentReadiness = readFileSync(
  join(process.cwd(), "docs/deployment-readiness.md"),
  "utf8",
);
const architecture = readFileSync(
  join(process.cwd(), "docs/architecture.md"),
  "utf8",
);
const dealsImportDesign = readFileSync(
  join(process.cwd(), "docs/deals-csv-import-design.md"),
  "utf8",
);

function compactSourceText(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

describe("Import/export MVP", () => {
  it("formats CSV with deterministic columns and proper escaping", () => {
    expect(
      formatCsv(
        [
          { header: "name", value: (row: { name: string }) => row.name },
          { header: "note", value: (row: { note: string | null }) => row.note },
          {
            header: "createdAt",
            value: (row: { createdAt: Date }) => row.createdAt,
          },
        ],
        [
          {
            name: "Orbit, Labs",
            note: 'Said "yes"\nNext quarter',
            createdAt: new Date("2030-01-02T03:04:05.000Z"),
          },
          {
            name: "Canopy",
            note: null,
            createdAt: new Date("2030-02-03T04:05:06.000Z"),
          },
          {
            name: '=HYPERLINK("https://example.test")',
            note: " @SUM(1,1)",
            createdAt: new Date("2030-03-04T05:06:07.000Z"),
          },
        ],
      ),
    ).toBe(
      [
        "name,note,createdAt",
        '"Orbit, Labs","Said ""yes""\nNext quarter",2030-01-02T03:04:05.000Z',
        "Canopy,,2030-02-03T04:05:06.000Z",
        '"\'=HYPERLINK(""https://example.test"")","\' @SUM(1,1)",2030-03-04T05:06:07.000Z',
      ].join("\n"),
    );
    expect(csvHelper).toContain("escapeCsvCell");
    expect(csvHelper).toContain("neutralizeSpreadsheetFormula");
  });

  it("neutralizes spreadsheet formulas in exported headers and values", () => {
    expect(
      formatCsv(
        [
          { header: "=Name", value: (row: { name: string }) => row.name },
          { header: " +Note", value: (row: { note: string }) => row.note },
          { header: "\tRisk", value: (row: { risk: string }) => row.risk },
        ],
        [{ name: "+Founder", note: "-Pipeline", risk: "@Forecast" }],
      ),
    ).toBe("'=Name,' +Note,'\tRisk\n'+Founder,'-Pipeline,'@Forecast");
  });

  it("parses CSV with quoted values, CRLF/LF newlines, and deterministic malformed errors", () => {
    expect(
      parseCsv(
        'name,domain\r\n"Orbit, Labs","orbit.example"\n"Quoted ""Name""","line\nbreak"',
      ),
    ).toEqual({
      headers: ["name", "domain"],
      rows: [
        ["Orbit, Labs", "orbit.example"],
        ['Quoted "Name"', "line\nbreak"],
      ],
    });
    expect(parseCsv("name,domain\nAcme,")).toEqual({
      headers: ["name", "domain"],
      rows: [["Acme", ""]],
    });
    expect(() => parseCsv('name\n"Acme')).toThrow("Unclosed quoted field");
    expect(() => parseCsv('name\n"Acme"x')).toThrow(
      "Unexpected character after closing quote",
    );
  });

  it("normalizes readable import headers from pasted spreadsheet text", () => {
    expect(normalizeImportHeader(" Owner Email ")).toBe("owner email");
    expect(normalizeImportHeader("Owner   Email")).toBe("owner email");
    expect(normalizeImportHeader("Owner\u00A0Email")).toBe("owner email");
    expect(normalizeImportHeader("Pipeline\tName")).toBe("pipeline name");
    expect(normalizeImportHeader("ownerEmail")).toBe("owneremail");
  });

  it("redacts sensitive parser diagnostics before import previews display them", () => {
    expect(
      formatImportParseError(
        new Error(
          "CSV parser failed for founder@example.test with Bearer raw-import-token at /reset-password?token=raw-reset-token",
        ),
      ),
    ).toBe(
      "CSV parser failed for [redacted email] with Bearer [redacted] at [redacted reset url]",
    );
    expect(formatImportParseError("not an error")).toBe(
      "CSV could not be parsed.",
    );
  });

  it("redacts sensitive unsupported CSV column labels before import previews display them", () => {
    expect(
      listUnsupportedImportColumns(
        [
          "name",
          "apiKey=raw-import-api-key",
          "resetToken",
          "webhookUrl=https://hooks.example.test/import?token=raw-import-webhook-token",
        ],
        [
          "name",
          "apikey=raw-import-api-key",
          "resettoken",
          "webhookurl=https://hooks.example.test/import?token=raw-import-webhook-token",
        ],
        new Set(["name"]),
      ),
    ).toEqual([
      "apiKey=[redacted]",
      "[redacted]",
      "webhookUrl=[redacted]",
    ]);
  });

  it("adds workspace-scoped CSV exports for core CRM records", () => {
    expect(crmBarrel).toContain('export * from "./export-service"');
    expect(exportService).toContain(
      'export const exportResources = ["deals", "contacts", "organizations", "leads", "activities", "products", "quotes"]',
    );
    expect(exportService).toContain("export const exportResourceDetails");
    expect(exportService).toContain(
      "satisfies Record<ExportResource, { title: string; description: string }>",
    );
    expect(exportService).toContain("export async function exportWorkspaceCsv");
    expect(exportService).toContain("export type WorkspaceExportOverviewItem");
    expect(exportService).toContain("export type WorkspaceExportOverview");
    expect(exportService).toContain("export async function getWorkspaceExportOverview");
    expect(exportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(exportService).toContain("workspaceId: actor.workspaceId");
    expect(exportService).toContain("searchParams: ListSearchParams = {}");
    expect(exportService).toContain("dealExportFilters(searchParams)");
    expect(exportService).toContain("contactExportFilters(searchParams)");
    expect(exportService).toContain("organizationExportFilters(searchParams)");
    expect(exportService).toContain("leadExportFilters(searchParams)");
    expect(exportService).toContain(
      "listServiceFiltersFromSearchParams(searchParams, dealListStateOptions",
    );
    expect(exportService).toContain(
      "listServiceFiltersFromSearchParams(searchParams, contactListStateOptions)",
    );
    expect(exportService).toContain(
      "listServiceFiltersFromSearchParams(searchParams, organizationListStateOptions)",
    );
    expect(exportService).toContain(
      "listServiceFiltersFromSearchParams(searchParams, leadListStateOptions",
    );
    expect(exportService).toContain("status: dealStatuses");
    expect(exportService).toContain("status: leadStatuses");
    expect(exportService).toContain("listDeals(actor, filters)");
    expect(exportService).toContain("listPeople(actor, filters)");
    expect(exportService).toContain("listOrganizations(actor, filters)");
    expect(exportService).toContain("listLeads(actor, filters)");
    expect(exportService).toContain("activityExportFilters(searchParams)");
    expect(exportService).toContain("listActivities(actor, filters)");
    expect(exportService).toContain("parseActivityRelatedFilter");
    expect(exportService).toContain(
      'enumSearchParam(searchParams, "due", activityDueBuckets)',
    );
    expect(exportService).toContain("listCustomFieldExportColumns");
    expect(exportService).toContain("countExportCustomFields(actor, \"DEAL\")");
    expect(exportService).toContain("countExportCustomFields(actor, \"PERSON\")");
    expect(exportService).toContain("countExportCustomFields(actor, \"ORGANIZATION\")");
    expect(exportService).toContain("countExportCustomFields(actor, \"LEAD\")");
    expect(exportService).toContain("prisma.quote.count");
    expect(exportService).toContain("deal: { workspaceId: actor.workspaceId, ...activeWhere }");
    expect(exportService).toContain("customFieldExportHeader");
    expect(exportService).toContain("workspacePersonName");
    expect(exportService).toContain("workspacePersonEmail");
    expect(exportService).toContain("workspaceOrganizationName");
    expect(exportService).toContain(
      "items: { where: { workspaceId: actor.workspaceId } }",
    );
    expect(exportService).toContain("Custom: ${field.name} (${field.key})");
    expect(exportService).toContain("normalizeCustomFieldExportName");
    expect(exportService).toContain(
      'orderBy: [{ name: "asc" }, { key: "asc" }, { id: "asc" }]',
    );
    expect(exportService).toContain("northstar-deals.csv");
    expect(exportService).toContain("northstar-contacts.csv");
    expect(exportService).toContain("northstar-organizations.csv");
    expect(exportService).toContain("northstar-leads.csv");
    expect(exportService).toContain("northstar-activities.csv");
    expect(exportService).toContain("northstar-products.csv");
    expect(exportService).toContain("northstar-quotes.csv");
    expect(exportService).toContain('{ header: "Deal Title"');
    expect(exportService).toContain('{ header: "Status"');
    expect(exportService).toContain('{ header: "Deal Value"');
    expect(exportService).toContain('{ header: "Currency"');
    expect(exportService).toContain('{ header: "Pipeline"');
    expect(exportService).toContain('{ header: "Stage"');
    expect(exportService).toContain('{ header: "Expected Close"');
    expect(exportService).toContain('{ header: "Contact Name"');
    expect(exportService).toContain('{ header: "Contact Email"');
    expect(exportService).toContain('{ header: "Organization Name"');
    expect(exportService).toContain('{ header: "Owner Email"');
    expect(exportService).toContain('{ header: "Line Item Count"');
    expect(exportService).toContain('{ header: "Quote Count"');
    expect(exportService).toContain('{ header: "Latest Quote Number"');
    expect(exportService).toContain('{ header: "Latest Quote Status"');
    expect(exportService).toContain('{ header: "Created At"');
    expect(exportService).toContain('{ header: "Updated At"');
    expect(exportService).toContain('{ header: "Due At"');
    expect(exportService).toContain('{ header: "Completed At"');
    expect(exportService).toContain('{ header: "Unit Price"');
    expect(exportService).toContain('{ header: "Quote Number"');
    expect(exportService).toContain('{ header: "Total"');
    expect(exportService).toContain('{ header: "Item Count"');
    expect(exportService).toContain("formatExportDate");
    expect(exportService).toContain("formatExportDateTime");
    expect(exportService).toContain("formatExportStatus");
    expect(exportService).toContain('activity.completedAt ? "Completed" : "Open"');
    expect(exportService).toContain('product.active ? "Yes" : "No"');
    expect(exportService).not.toContain("authorId");
    expect(exportService).not.toContain("membership");
  });

  it("wires export routes and settings UI with aligned import wording", () => {
    expect(workspaceRoute).toContain('resource === "exports"');
    expect(workspaceRoute).toContain("searchParamsToListSearchParams");
    expect(workspaceRoute).toContain("exportWorkspaceCsv(");
    expect(workspaceRoute).toContain(
      "searchParamsToListSearchParams(new URL(request.url).searchParams)",
    );
    expect(workspaceRoute).toContain(
      '"content-type": "text/csv; charset=utf-8"',
    );
    expect(listExportLink).toContain('from "@/lib/list-export-href"');
    expect(listExportHref).toContain("export function buildListExportHref");
    expect(listExportLink).toContain('"use client";');
    expect(listExportLink).toContain('import { useId } from "react";');
    expect(listExportLink).toContain('import { DownloadAction } from "@/components/download-action"');
    expect(listExportHref).toContain("ignoredExportParams");
    expect(listExportHref).toContain("ignoredExportScopeParams");
    expect(listExportHref).toContain('"page", "pageSize"');
    expect(listExportHref).toContain(
      "/api/v1/workspaces/${encodeURIComponent(workspaceId)}/exports/${resource}",
    );
    expect(listExportLink).toContain("matchingCount");
    expect(listExportLink).toContain(
      "hasExportScopeSearchParams(searchParams)",
    );
    expect(listExportLink).toContain(
      "const helperText = exportHelperText(resource, matchingCount, hasExportScopeParams, hasExportSortParams(searchParams))",
    );
    expect(listExportLink).toContain(
      "const helperId = `${generatedHelperId}-${resource}-export-helper`",
    );
    expect(listExportLink).toContain("listResourcePluralLabel");
    expect(listExportHref).toContain("listResultSingularLabel");
    expect(listResourceLabels).toContain("export function listResourcePluralLabel");
    expect(listResourceLabels).toContain("export function listResultSingularLabel");
    expect(listResourceLabels).toContain("createNoun: \"a deal\"");
    expect(listResourceLabels).toContain("plural: \"deals\"");
    expect(listResourceLabels).toContain("singular: \"Deal\"");
    expect(listResourceLabels).toContain("searchPlaceholder: \"Deal title, contact, or organization\"");
    expect(listExportLink).toContain(
      "const exportActionLabel = `${label} for ${listResourcePluralLabel(resource)}: ${helperText}`",
    );
    expect(listExportLink).toContain("helperId={helperId}");
    expect(listExportLink).toContain("actionLabel={exportActionLabel}");
    expect(listExportLink).toContain('pendingLabel="Preparing CSV..."');
    expect(listExportLink).toContain('preparedLabel="Export prepared"');
    expect(listExportLink).toContain('className="list-export-helper"');
    expect(listExportLink).toContain("id={helperId}");
    expect(downloadAction).toContain("export function DownloadAction");
    expect(downloadAction).toContain("if (disabled || isPreparing) return");
    expect(downloadAction).toContain('fetch(href, { method: "GET" })');
    expect(downloadAction).toContain("filenameFromContentDisposition");
    expect(downloadAction).toContain("downloadFailureMessage(response.status)");
    expect(downloadAction).toContain("You do not have permission to download this file.");
    expect(downloadAction).toContain("This download is no longer available.");
    expect(downloadAction).toContain("Download started");
    expect(downloadAction).toContain("Could not start the download. Try again.");
    expect(downloadAction).toContain('aria-live="polite"');
    expect(downloadAction).toContain('role="alert"');
    expect(listExportHref).toContain("No ${pluralLabel} yet; downloads a header-only CSV");
    expect(listExportHref).toContain("No matching ${pluralLabel}; downloads a header-only CSV");
    expect(listExportHref).toContain("export function fullWorkspaceExportHelperText");
    expect(listExportHref).toContain("export function exportRowCountLabel");
    expect(listExportHref).toContain(
      "Downloads a CSV of all matching ${pluralLabel}${sortCopy}, not just this page",
    );
    expect(listExportHref).toContain("Downloads a CSV with 1 matching ${singularLabel}");
    expect(listExportHref).toContain("Downloads a CSV with 1 ${singularLabel}");
    expect(listExportHref).toContain(
      "Downloads a CSV with all ${matchingCount} matching ${pluralLabel}${sortCopy}, not just this page",
    );
    expect(listExportHref).toContain("Downloads a CSV with all ${matchingCount} ${pluralLabel}${sortCopy}");
    expect(listPageHeaderActions).toContain(
      "export function ListPageHeaderActions",
    );
    expect(listPageHeaderActions).toContain("<ListExportLink");
    expect(listPageHeaderActions).toContain("matchingCount={matchingCount}");
    expect(listPageHeaderActions).toContain("resource={resource}");
    expect(listPageHeaderActions).toContain("searchParams={searchParams}");
    expect(listPageHeaderActions).toContain("workspaceId={workspaceId}");
    expect(listPageHeaderActions).toContain(
      "const createActionLabel = listResourceCreateActionLabel(resource, createLabel)",
    );
    expect(listPageHeaderActions).toContain(
      "const listActionsLabel = `${listResourceSingularLabel(resource)} list actions`",
    );
    expect(listResourceLabels).toContain("export function listResourceSingularLabel");
    expect(listResourceLabels).toContain("export function listResourceCreateActionLabel");
    expect(listPageHeaderActions).toContain("import { ActionGroup }");
    expect(listPageHeaderActions).toContain('<ActionGroup className="list-page-header-actions" label={listActionsLabel}>');
    expect(listPageHeaderActions).toContain("aria-label={createActionLabel}");
    expect(listPageHeaderActions).toContain("title={createActionLabel}");
    expect(listPageHeaderActions).toContain("importHref?: Route");
    expect(listPageHeaderActions).toContain('importLabel = "Import CSV"');
    expect(listPageHeaderActions).toContain(
      "const importActionLabel = importHref",
    );
    expect(listPageHeaderActions).toContain("aria-label={importActionLabel}");
    expect(listPageHeaderActions).toContain("title={importActionLabel}");
    expect(listPageHeaderActions.indexOf("aria-label={createActionLabel}")).toBeLessThan(
      listPageHeaderActions.indexOf("aria-label={importActionLabel}"),
    );
    expect(listPageHeaderActions.indexOf("aria-label={importActionLabel}")).toBeLessThan(
      listPageHeaderActions.indexOf("<ListExportLink"),
    );
    expect(listPageHeaderActions).toContain('className="button-primary"');
    expect(listPageHeaderActions).toContain('className="button-secondary"');
    for (const [page, resource] of [
      [dealsPage, "deals"],
      [contactsPage, "contacts"],
      [organizationsPage, "organizations"],
      [leadsPage, "leads"],
      [activitiesPage, "activities"],
    ]) {
      expect(page).toContain("ListPageHeaderActions");
      expect(page).toContain(`resource="${resource}"`);
      expect(page).toContain("searchParams={params}");
      expect(page).toContain("workspaceId={workspace.id}");
    }
    expect(pipelinePage).toContain("ListPageHeaderActions");
    expect(pipelinePage).toContain('resource="deals"');
    expect(pipelinePage).toContain('importHref="/settings/import-export#deals-import"');
    expect(pipelinePage).toContain("matchingCount={dealExportCount}");
    expect(pipelinePage).toContain("searchParams={{}}");
    expect(pipelinePage).toContain("workspaceId={workspace.id}");
    expect(dealsPage).toContain("matchingCount={dealPage.total}");
    expect(contactsPage).toContain("matchingCount={peoplePage.total}");
    expect(organizationsPage).toContain(
      "matchingCount={organizationPage.total}",
    );
    expect(leadsPage).toContain("matchingCount={leadPage.total}");
    expect(activitiesPage).toContain("matchingCount={activityPage.total}");
    expect(dealsPage).toContain('importHref="/settings/import-export#deals-import"');
    expect(contactsPage).toContain('importHref="/settings/import-export#contacts-import"');
    expect(organizationsPage).toContain('importHref="/settings/import-export#organizations-import"');
    expect(leadsPage).toContain('importHref="/settings/import-export#leads-import"');
    expect(activitiesPage).not.toContain('importHref="/settings/import-export');
    expect(settingsPage).toContain('href="/settings/import-export"');
    expect(importExportPage).toContain("CSV Exports");
    expect(importExportPage).toContain("PanelTitleRow");
    expect(importExportPage).toContain("CompactTitleRow");
    expect(importExportPage).toContain("getWorkspaceExportOverview");
    expect(importExportPage).toContain(
      "const exportOverview = await getWorkspaceExportOverview(actor)",
    );
    expect(importExportPage).toContain(
      'const backToSettingsLabel = "Back to settings from import and export"',
    );
    expect(importExportPage).toContain('id: "organizations-import"');
    expect(importExportPage).toContain('id: "contacts-import"');
    expect(importExportPage).toContain('id: "leads-import"');
    expect(importExportPage).toContain('id: "deals-import"');
    expect(importExportPage).toContain('<section className="panel" id={id}>');
    expect(importExportPage).toContain("aria-label={backToSettingsLabel}");
    expect(importExportPage).toContain("title={backToSettingsLabel}");
    expect(importExportPage).toContain("function DataTransferCard");
    expect(importExportPage).toContain('className = "export-item"');
    expect(importExportPage).toContain(
      "<CompactTitleRow actions={action} description={description} title={title} />",
    );
    expect(importExportPage).toContain("{meta}");
    expect(importExportPage).toContain(
      'helper ? <p className="export-scope-note">{helper}</p> : null',
    );
    expect(importExportPage).toContain("function ExportCardMeta");
    expect(importExportPage).toContain("fullWorkspaceExportHelperText");
    expect(importExportPage).toContain("exportRowCountLabel(rowCount)");
    expect(importExportPage).toContain("import { Badge }");
    expect(badge).toContain("export function Badge");
    expect(badge).toContain('className = "badge"');
    expect(badge).toContain("aria-label={label}");
    expect(badge).toContain("title={title}");
    expect(importExportPage).toContain(
      "const rowCountBadgeLabel = `Export row count: ${rowCountLabel}`;",
    );
    expect(importExportPage).toContain(
      'const customFieldBadgeLabel = `Export includes ${customFieldCount} custom ${customFieldCount === 1 ? "field" : "fields"}`;',
    );
    expect(importExportPage).toContain(
      "<Badge label={rowCountBadgeLabel}>{rowCountLabel}</Badge>",
    );
    expect(importExportPage).toContain(
      "<Badge label={customFieldBadgeLabel}>",
    );
    expect(importExportPage).toContain('className="import-export-card-meta"');
    expect(listExportHref).toContain('if (rowCount === 0) return "No rows"');
    expect(listExportHref).toContain('if (rowCount === 1) return "1 row"');
    expect(listExportHref).toContain("`${rowCount} rows`");
    expect(importExportPage).toContain("description={label.description}");
    expect(importExportPage).toContain("title={label.title}");
    expect(importExportPage).toContain(
      "const exportActionLabel = `Download ${label.title} full workspace CSV`;",
    );
    expect(importExportPage).toContain("actionLabel={exportActionLabel}");
    expect(importExportPage).toContain('pendingLabel="Preparing CSV..."');
    expect(importExportPage).toContain('preparedLabel="Export prepared"');
    expect(importExportPage).toContain(
      "helper={fullWorkspaceExportHelperText(overview)}",
    );
    expect(importExportPage).toContain("meta={");
    expect(importExportPage).toContain("customFieldCount={overview.customFieldCount}");
    expect(importExportPage).toContain("rowCount={overview.rowCount}");
    expect(importExportPage).toContain('className="sample-csv-card"');
    expect(importExportPage).toContain("title={sample.title}");
    expect(importExportPage).toContain(
      'actions={<Badge label="Sample CSV templates are copy references only">Reference only</Badge>}',
    );
    expect(importExportPage).not.toContain("<h3>{label.title}</h3>");
    expect(importExportPage).not.toContain("<h3>{sample.title}</h3>");
    expect(compactTitleRow).toContain("export function CompactTitleRow");
    expect(globalStyles).toContain(".export-item .panel-title-row");
    expect(globalStyles).toContain(".sample-csv-card .panel-title-row");
    expect(importExportPage).toContain('title="CSV Exports"');
    expect(importExportPage).toContain('title="Import Safety Rules"');
    expect(importExportPage).toContain(
      'actions={<Badge label="CSV exports are scoped to the active workspace">Workspace scoped</Badge>}',
    );
    expect(importExportPage).toContain(
      'actions={<Badge label="CSV imports require preview and validation before records are created">Preview first</Badge>}',
    );
    expect(importExportPage).toContain(
      "Move CRM data safely with filter-aware exports and preview-first CSV imports.",
    );
    expect(importExportPage).toContain(
      "Settings exports download full workspace snapshots with core columns and workspace custom fields.",
    );
    expect(listExportHref).toContain(
      "Full workspace export. List-page exports preserve search, filters, and sort.",
    );
    for (const [formSource, tableLabel, dataLabels] of [
      [
        contactImportForm,
        "Contacts import preview table",
        ["Row", "Name", "Email", "Organization", "Import status", "Notes"],
      ],
      [
        organizationImportForm,
        "Organizations import preview table",
        ["Row", "Name", "Domain", "Import status", "Notes"],
      ],
      [
        leadImportForm,
        "Leads import preview table",
        ["Row", "Title", "Source", "Lead status", "Organization", "Import status", "Notes"],
      ],
      [
        dealImportForm,
        "Deals import preview table",
        [
          "Row",
          "Title",
          "Pipeline",
          "Stage",
          "Deal status",
          "Value",
          "Organization",
          "Import status",
          "Notes",
        ],
      ],
    ] as const) {
      expect(formSource).toContain(`ariaLabel="${tableLabel}"`);
      expect(formSource).toContain('className="table crm-list-table"');
      for (const dataLabel of dataLabels) {
        expect(formSource).toContain(`data-label="${dataLabel}"`);
      }
    }
    expect(globalStyles).toContain(".export-scope-note");
    expect(globalStyles).toContain(".import-export-card-meta");
    expect(importExportPage).toContain("FieldMetric");
    expect(importExportPage).toContain(
      '<FieldMetric label="Preview first" value="No records are created until you choose an import action after validation." />',
    );
    expect(importExportPage).toContain(
      '<FieldMetric label="Custom fields" value="Exports include custom fields; custom-field import remains deferred until mapping is explicit." />',
    );
    expect(fieldMetric).toContain('className="field-label"');
    expect(fieldMetric).toContain(
      'className={["field-value", valueClassName].filter(Boolean).join(" ")}',
    );
    expect(importExportPage).toContain("PageHeader");
    expect(pageHeader).toContain('className="header-actions"');
    expect(importExportPage).toContain("exportResourceDetails");
    expect(importExportPage).toContain(
      "const label = exportResourceDetails[resource]",
    );
    expect(importExportPage).toContain("Download CSV");
    expect(importExportPage).toContain(
      "buildListExportHref(workspace.id, resource, {})",
    );
    expect(importExportPage).toContain("workspace custom fields");
    expect(exportService).toContain('title: "Activities"');
    expect(exportService).toContain('title: "Products"');
    expect(exportService).toContain('title: "Quotes"');
    expect(importExportPage).toContain("Deals Import Preview");
    expect(importExportPage).toContain("Organizations Import Preview");
    expect(importExportPage).toContain("Contacts Import Preview");
    expect(importExportPage).toContain("Leads Import Preview");
    expect(importExportPage.indexOf("Organizations Import Preview")).toBeLessThan(
      importExportPage.indexOf("Deals Import Preview"),
    );
    expect(importExportPage.indexOf("Contacts Import Preview")).toBeLessThan(
      importExportPage.indexOf("Deals Import Preview"),
    );
    expect(importExportPage).toContain("const importPreviewPanels");
    expect(importExportPage).toContain("function ImportPreviewSection");
    expect(importExportPage).toContain("importPreviewPanels.map");
    expect(importExportPage).toContain(
      "const importPreviewBadgeLabel = `${title}: preview required before import`",
    );
    expect(importExportPage).toContain(
      'actions={<Badge label={importPreviewBadgeLabel}>Preview first</Badge>}',
    );
    expect(importExportPage).toContain("Import Safety Rules");
    expect(importExportPage).toContain(
      "No records are created until you choose an import action after validation.",
    );
    expect(importExportPage).toContain(
      "Valid, duplicate, invalid, and unsupported-column outcomes are shown before import.",
    );
    expect(importExportPage).toContain(
      "Owners and related records must already exist in the active workspace.",
    );
    expect(importExportPage).toContain(
      "custom-field import remains deferred until mapping is explicit",
    );
    expect(importFormShared).toContain("ImportFormShell");
    expect(importFormShared).toContain("export function isImportReady");
    expect(importFormShared).toContain(
      "preview.parseErrors.length === 0 && preview.validRows > 0",
    );
    expect(importFormShared).toContain("previewContent");
    expect(importFormShared).toContain("previewButtonLabel");
    expect(importFormShared).toContain("importButtonLabel");
    expect(importFormShared).toContain(
      "result ? <ImportResultSummary result={result} />",
    );
    expect(importFormShared).toContain("recordPluralLabel?: string");
    expect(importFormShared).toContain("const resolvedRecordPluralLabel");
    expect(importFormShared).toContain("defaultImportRecordPluralLabel");
    expect(importFormShared).toContain(
      "recordPluralLabel={resolvedRecordPluralLabel}",
    );
    expect(importFormShared).toContain("ImportSubmitButton");
    expect(importFormShared).toContain("useFormStatus");
    expect(importFormShared).toContain(
      'intent === "import" ? "button-secondary" : "button-primary"',
    );
    expect(importFormShared).toContain("ImportResultSummary");
    expect(importFormShared).toContain("createdCount");
    expect(importFormShared).toContain("duplicates skipped");
    expect(importFormShared).toContain("invalid rows skipped");
    expect(importFormShared).toContain("failedRows");
    expect(formCallout).toContain("export function FormCallout");
    expect(importFormShared).toContain("import { FormCallout }");
    expect(importFormShared).toContain('className="import-result-warning"');
    expect(importFormShared).toContain('role="alert"');
    expect(importFormShared).toContain("Some validated rows were not created");
    expect(importFormShared).toContain(
      "These rows were valid in preview but were not created during import.",
    );
    expect(importFormShared).toContain("Row {row.rowNumber}: {row.reason}");
    expect(importFormShared).toContain("ImportPreviewSummary");
    expect(importFormShared).toContain("CompactTitleRow");
    expect(importFormShared).toContain('title="Preview results"');
    expect(importFormShared).toContain("ImportUnsupportedColumnsNotice");
    expect(importFormShared).toContain('className="import-unsupported-columns-notice"');
    expect(importFormShared).toContain("title={message}");
    expect(importFormShared).toContain("{columns.join(\", \")}");
    expect(importFormShared).not.toContain(
      "{unsupportedColumnsMessage} {unsupportedColumns.join(\", \")}",
    );
    expect(importFormShared).toContain("ImportCsvInputGroup");
    expect(importFormShared).toContain("import { FormFieldLabel }");
    expect(importFormShared).toContain(
      "<FormFieldLabel required>{label}</FormFieldLabel>",
    );
    expect(importFormShared).toContain('className="import-textarea"');
    expect(importFormShared).toContain("defaultValue={defaultValue}");
    expect(importFormShared).toContain("placeholder={placeholder}");
    expect(importFormShared).toContain("rows={rows}");
    expect(importFormShared).toContain("ImportFormGuidance");
    expect(importFormShared).toContain("FormIntroCallout");
    expect(importFormShared).toContain('className="import-form-guidance"');
    expect(importFormShared).toContain('title="Preview before import"');
    expect(importFormShared).toContain("ImportColumnGuidance");
    expect(importFormShared).toContain('requiredLabel = "Required columns"');
    expect(importFormShared).toContain('optionalLabel = "Optional columns"');
    expect(importFormShared).toContain("ImportPreviewTable");
    expect(importFormShared).toContain("TableScroll");
    expect(importFormShared).toContain("aria-label={ariaLabel}");
    expect(importFormShared).toContain("import { EmptyState }");
    expect(importFormShared).toContain("ImportPreviewEmptyState");
    expect(importFormShared).toContain("No ${recordLabel} rows found");
    expect(importFormShared).toContain(
      "did not include any data rows to review",
    );
    expect(importFormShared).toContain(
      "empty-state-compact empty-state-panel import-preview-empty",
    );
    expect(tableScroll).toContain('role="region"');
    expect(importFormShared).toContain("ImportReadyNotice");
    expect(importFormShared).toContain("validRows");
    expect(importFormShared).toMatch(
      /\{canImport && preview \? \(\s*<ImportReadyNotice\s+recordLabel=\{recordLabel\}\s+recordPluralLabel=\{resolvedRecordPluralLabel\}\s+validRows=\{preview\.validRows\}\s*\/>\s*\) : null\}/,
    );
    expect(importFormShared).toContain(
      "const importActionsLabel = `${recordLabel} import actions`",
    );
    expect(importFormShared).toContain("import { ActionGroup }");
    expect(importFormShared).toContain(
      '<ActionGroup className="import-actions" label={importActionsLabel}>',
    );
    expect(importFormShared).toContain("recordLabel={recordLabel}");
    expect(importFormShared).toContain("function importSubmitActionLabel");
    expect(importFormShared).toContain("organization records");
    expect(importFormShared).toContain(
      "Create validated ${recordNoun} from CSV",
    );
    expect(importFormShared).toContain(
      "Preview ${recordLabel} CSV without creating records",
    );
    expect(importFormShared).toContain("aria-label={actionLabel}");
    expect(importFormShared).toContain("title={actionLabel}");
    expect(importFormShared.indexOf("<ImportReadyNotice")).toBeLessThan(
      importFormShared.indexOf('<ActionGroup className="import-actions"'),
    );
    expect(importFormShared).toContain(
      "Ready to create ${validRows} valid ${importLabel}",
    );
    expect(importFormShared).toContain('role="status"');
    expect(importFormShared).toContain("Import creates only validated rows.");
    expect(importFormShared).toContain("import-ready-notice");
    expect(importFormShared).toContain('className="import-action-helper"');
    expect(importFormShared).toContain(
      "Preview validates rows without creating records.",
    );
    expect(compactSourceText(importFormShared)).toContain(
      "The import action appears after a parsed preview finds valid rows.",
    );
    expect(globalStyles).toContain(".import-action-helper");
    expect(globalStyles).toContain(".import-result-warning");
    expect(importFormShared).toContain("ImportPreviewIssues");
    expect(importFormShared).toContain("Preview issues");
    expect(importFormShared).toContain("ImportPreviewRowNotes");
    expect(importFormShared).toContain("skipReasons.length > 0");
    expect(importFormShared).toContain('className="table-secondary-text"');
    expect(importFormShared).toContain("ImportPreviewStatusBadge");
    expect(importFormShared).toContain('import { StatusBadge }');
    expect(importFormShared).toContain("<StatusBadge status={status} />");
    expect(importFormShared).not.toContain("<h3>Preview results</h3>");
    expect(importFormShared).not.toContain("<h3>Import results</h3>");
    expect(importFormShared).not.toContain("<h3>Preview issues</h3>");
    expect(globalStyles).toContain(".import-preview .panel-title-row");
    expect(globalStyles).toContain(".import-ready-notice .form-callout-copy");
    expect(globalStyles).not.toContain(".import-preview h3");
    expect(dealImportForm).toContain("Deals preview and import");
    expect(dealImportForm).toContain("ImportColumnGuidance");
    expect(dealImportForm).toContain("ImportFormShell");
    expect(dealImportForm).toContain("ImportCsvInputGroup");
    expect(dealImportForm).toContain("preview={state.preview}");
    expect(dealImportForm).toContain("previewContent={");
    expect(dealImportForm).toContain("<DealImportPreview state={state} />");
    expect(dealImportForm).toContain('recordLabel="deal"');
    expect(dealImportForm).toContain('recordPluralLabel="deals"');
    expect(dealImportForm).toContain("result={state.result}");
    expect(dealImportForm).toContain(
      "const canImport = isImportReady(state.preview)",
    );
    expect(dealImportForm).toContain("ImportPreviewIssues");
    expect(dealImportForm).toContain("ImportPreviewSummary");
    expect(dealImportForm).toContain("ImportPreviewTable");
    expect(dealImportForm).toContain("ImportPreviewEmptyState");
    expect(dealImportForm).toContain("preview.rows.length > 0 ? (");
    expect(dealImportForm).toContain(
      '<ImportPreviewEmptyState recordLabel="deal" />',
    );
    expect(dealImportForm).toContain('name="dealCsv"');
    expect(dealImportForm).toContain("Preview deals");
    expect(dealImportForm).toContain("Import valid deals");
    expect(dealImportForm).toContain('ariaLabel="Deals import preview table"');
    expect(dealImportForm).toContain("duplicates to skip");
    expect(dealImportForm).toContain("invalid rows to skip");
    expect(dealImportForm).toContain("skipReasons");
    expect(dealImportForm).toContain("ImportPreviewRowNotes");
    expect(dealImportForm).toContain("ImportPreviewStatusBadge");
    expect(dealImportForm).toContain('<th>Deal status</th>');
    expect(dealImportForm).toContain('<th>Import status</th>');
    expect(dealImportForm).toContain('data-label="Deal status"');
    expect(dealImportForm).toContain('data-label="Import status"');
    expect(dealImportForm).toContain("total rows");
    expect(dealImportForm).toContain("unsupported columns");
    expect(dealImportForm).toContain(
      "Ignored unsupported columns, not imported",
    );
    expect(dealImportForm).toContain('className="table-primary-cell"');
    expect(dealImportForm).toContain(
      '<strong>{row.title || "Missing"}</strong>',
    );
    expect(dealImportForm).toContain('label="Deals CSV"');
    expect(dealImportForm).not.toContain(
      '<p className="empty-copy">\n        Deals preview and import',
    );
    expect(dealImportForm).not.toContain(
      '<p className="empty-copy">No deal rows found.</p>',
    );
    expect(organizationImportForm).toContain(
      "Organizations preview and import",
    );
    expect(organizationImportForm).toContain("ImportColumnGuidance");
    expect(organizationImportForm).toContain("ImportFormShell");
    expect(organizationImportForm).toContain("ImportCsvInputGroup");
    expect(organizationImportForm).toContain("preview={state.preview}");
    expect(organizationImportForm).toContain("previewContent={");
    expect(organizationImportForm).toContain(
      "<OrganizationImportPreview state={state} />",
    );
    expect(organizationImportForm).toContain('recordLabel="organization"');
    expect(organizationImportForm).toContain(
      'recordPluralLabel="organizations"',
    );
    expect(organizationImportForm).toContain("result={state.result}");
    expect(organizationImportForm).toContain(
      "const canImport = isImportReady(state.preview)",
    );
    expect(organizationImportForm).toContain("ImportPreviewIssues");
    expect(organizationImportForm).toContain("ImportPreviewSummary");
    expect(organizationImportForm).toContain("ImportPreviewTable");
    expect(organizationImportForm).toContain("ImportPreviewEmptyState");
    expect(organizationImportForm).toContain("preview.rows.length > 0 ? (");
    expect(organizationImportForm).toContain(
      '<ImportPreviewEmptyState recordLabel="organization" />',
    );
    expect(organizationImportForm).toContain('name="organizationCsv"');
    expect(organizationImportForm).toContain("Import valid organizations");
    expect(organizationImportForm).toContain(
      'ariaLabel="Organizations import preview table"',
    );
    expect(organizationImportForm).toContain("duplicates to skip");
    expect(organizationImportForm).toContain("invalid rows to skip");
    expect(organizationImportForm).toContain("total rows");
    expect(organizationImportForm).toContain("unsupported columns");
    expect(organizationImportForm).toContain("skipReasons");
    expect(organizationImportForm).toContain(
      "Ignored unsupported columns, not imported",
    );
    expect(organizationImportForm).toContain("ImportPreviewRowNotes");
    expect(organizationImportForm).toContain("ImportPreviewStatusBadge");
    expect(organizationImportForm).toContain('<th>Import status</th>');
    expect(organizationImportForm).toContain('data-label="Import status"');
    expect(organizationImportForm).toContain('className="table-primary-cell"');
    expect(organizationImportForm).toContain(
      '<strong>{row.name || "Missing"}</strong>',
    );
    expect(organizationImportForm).toContain('label="Organizations CSV"');
    expect(organizationImportForm).not.toContain(
      '<p className="empty-copy">\n        Organizations preview and import',
    );
    expect(organizationImportForm).not.toContain(
      '<p className="empty-copy">No organization rows found.</p>',
    );
    expect(contactImportForm).toContain("ImportFormShell");
    expect(contactImportForm).toContain("ImportColumnGuidance");
    expect(contactImportForm).toContain("ImportCsvInputGroup");
    expect(contactImportForm).toContain("preview={state.preview}");
    expect(contactImportForm).toContain("previewContent={");
    expect(contactImportForm).toContain(
      "<ContactImportPreview state={state} />",
    );
    expect(contactImportForm).toContain('recordLabel="contact"');
    expect(contactImportForm).toContain('recordPluralLabel="contacts"');
    expect(contactImportForm).toContain("result={state.result}");
    expect(contactImportForm).toContain(
      "const canImport = isImportReady(state.preview)",
    );
    expect(contactImportForm).toContain("ImportPreviewIssues");
    expect(contactImportForm).toContain("ImportPreviewSummary");
    expect(contactImportForm).toContain("ImportPreviewTable");
    expect(contactImportForm).toContain("ImportPreviewEmptyState");
    expect(contactImportForm).toContain("preview.rows.length > 0 ? (");
    expect(contactImportForm).toContain(
      '<ImportPreviewEmptyState recordLabel="contact" />',
    );
    expect(contactImportForm).toContain(
      'ariaLabel="Contacts import preview table"',
    );
    expect(contactImportForm).toContain("duplicates to skip");
    expect(contactImportForm).toContain("invalid rows to skip");
    expect(contactImportForm).toContain("total rows");
    expect(contactImportForm).toContain("unsupported columns");
    expect(contactImportForm).toContain("skipReasons");
    expect(contactImportForm).toContain(
      "Ignored unsupported columns, not imported",
    );
    expect(contactImportForm).toContain("ImportPreviewRowNotes");
    expect(contactImportForm).toContain("ImportPreviewStatusBadge");
    expect(contactImportForm).toContain('<th>Import status</th>');
    expect(contactImportForm).toContain('data-label="Import status"');
    expect(contactImportForm).toContain('className="table-primary-cell"');
    expect(contactImportForm).toContain(
      '<strong>{row.name || "Missing"}</strong>',
    );
    expect(contactImportForm).toContain('label="Contacts CSV"');
    expect(contactImportForm).not.toContain(
      '<p className="empty-copy">\n        Contacts preview and import',
    );
    expect(contactImportForm).not.toContain(
      '<p className="empty-copy">No contact rows found.</p>',
    );
    expect(leadImportForm).toContain("Leads preview and import");
    expect(leadImportForm).toContain("ImportColumnGuidance");
    expect(leadImportForm).toContain("ImportFormShell");
    expect(leadImportForm).toContain("ImportCsvInputGroup");
    expect(leadImportForm).toContain("preview={state.preview}");
    expect(leadImportForm).toContain("previewContent={");
    expect(leadImportForm).toContain("<LeadImportPreview state={state} />");
    expect(leadImportForm).toContain('recordLabel="lead"');
    expect(leadImportForm).toContain('recordPluralLabel="leads"');
    expect(leadImportForm).toContain("result={state.result}");
    expect(leadImportForm).toContain(
      "const canImport = isImportReady(state.preview)",
    );
    expect(leadImportForm).toContain("ImportPreviewIssues");
    expect(leadImportForm).toContain("ImportPreviewSummary");
    expect(leadImportForm).toContain("ImportPreviewTable");
    expect(leadImportForm).toContain("ImportPreviewEmptyState");
    expect(leadImportForm).toContain("preview.rows.length > 0 ? (");
    expect(leadImportForm).toContain(
      '<ImportPreviewEmptyState recordLabel="lead" />',
    );
    expect(leadImportForm).toContain("Preview leads");
    expect(leadImportForm).toContain("Import valid leads");
    expect(leadImportForm).toContain('ariaLabel="Leads import preview table"');
    expect(leadImportForm).toContain("duplicates to skip");
    expect(leadImportForm).toContain("invalid rows to skip");
    expect(leadImportForm).toContain("total rows");
    expect(leadImportForm).toContain("unsupported columns");
    expect(leadImportForm).toContain("skipReasons");
    expect(leadImportForm).toContain(
      "Ignored unsupported columns, not imported",
    );
    expect(leadImportForm).toContain("ImportPreviewRowNotes");
    expect(leadImportForm).toContain("ImportPreviewStatusBadge");
    expect(leadImportForm).toContain('<th>Lead status</th>');
    expect(leadImportForm).toContain('<th>Import status</th>');
    expect(leadImportForm).toContain('data-label="Lead status"');
    expect(leadImportForm).toContain('data-label="Import status"');
    expect(leadImportForm).toContain('className="table-primary-cell"');
    expect(leadImportForm).toContain(
      '<strong>{row.title || "Missing"}</strong>',
    );
    expect(leadImportForm).toContain('label="Leads CSV"');
    expect(leadImportForm).not.toContain(
      '<p className="empty-copy">\n        Leads preview and import',
    );
    expect(leadImportForm).not.toContain(
      '<p className="empty-copy">No lead rows found.</p>',
    );
    expect(dealImportForm).not.toContain('type="file"');
    expect(organizationImportForm).not.toContain('type="file"');
    expect(contactImportForm).not.toContain('type="file"');
    expect(leadImportForm).not.toContain('type="file"');
    expect(importExportActions).toContain("previewDealImportAction");
    expect(importExportActions).toContain("previewOrganizationImportAction");
    expect(importExportActions).toContain("previewContactImportAction");
    expect(importExportActions).toContain("previewLeadImportAction");
    expect(importExportActions).toContain("previewDealImport(actor, csvText)");
    expect(importExportActions).toContain(
      "previewOrganizationImport(actor, csvText)",
    );
    expect(importExportActions).toContain(
      "previewContactImport(actor, csvText)",
    );
    expect(importExportActions).toContain("previewLeadImport(actor, csvText)");
    expect(importExportActions).toContain("importDealsFromCsv(actor, csvText)");
    expect(importExportActions).toContain(
      "importOrganizationsFromCsv(actor, csvText)",
    );
    expect(importExportActions).toContain(
      "importContactsFromCsv(actor, csvText)",
    );
    expect(importExportActions).toContain("importLeadsFromCsv(actor, csvText)");
    expect(importExportActions).toContain("type ImportActionConfig");
    expect(importExportActions).toContain(
      "async function runImportPreviewAction",
    );
    expect(importExportActions).toContain('csvFieldName: "dealCsv"');
    expect(importExportActions).toContain('csvFieldName: "organizationCsv"');
    expect(importExportActions).toContain('csvFieldName: "contactCsv"');
    expect(importExportActions).toContain('csvFieldName: "leadCsv"');
    expect(importExportActions).toContain(
      'revalidatePaths: ["/deals", "/pipeline", "/settings/import-export"]',
    );
    expect(importExportActions).toContain(
      'revalidatePaths: ["/organizations", "/settings/import-export"]',
    );
    expect(importExportActions).toContain(
      'revalidatePaths: ["/contacts", "/settings/import-export"]',
    );
    expect(importExportActions).toContain(
      'revalidatePaths: ["/leads", "/settings/import-export"]',
    );
    expect(importExportActions).toContain('intent === "import"');
    expect(importExportActions).toContain(
      "const result = await config.importCsv(actor, csvText)",
    );
    expect(importExportActions).toContain(
      "for (const path of config.revalidatePaths) revalidatePath(path)",
    );
    expect(importExportActions).toContain("preview: result.preview");
    expect(importExportActions).toContain(
      "preview: await config.preview(actor, csvText)",
    );
    expect(importExportActions).toContain(
      'import { redactSensitiveText } from "@/lib/security/redaction";',
    );
    expect(importExportActions).toContain("function formatImportActionError");
    expect(importExportActions).toContain(
      "return redactSensitiveText(error.message) || fallback;",
    );
    expect(importExportActions).toContain(
      'failureMessage: "Deal import preview failed."',
    );
    expect(importExportActions).toContain(
      'failureMessage: "Organization import preview failed."',
    );
    expect(importExportActions).toContain(
      'failureMessage: "Contact import preview failed."',
    );
    expect(importExportActions).toContain(
      'failureMessage: "Lead import preview failed."',
    );
    expect(importExportActions).toContain(
      "formatImportActionError(error, config.failureMessage)",
    );
    expect(importExportActions).not.toContain(
      "error: error instanceof Error ? error.message",
    );
    expect(importExportPage).not.toContain('type="file"');
    expect(routeMap).toContain(
      "GET  /api/v1/workspaces/:workspaceId/exports/deals",
    );
    expect(routeMap).toContain(
      "GET  /api/v1/workspaces/:workspaceId/exports/products",
    );
    expect(routeMap).toContain(
      "GET  /api/v1/workspaces/:workspaceId/exports/quotes",
    );
    expect(routeMap).toContain(
      "Activity, note, product, quote, saved-view, user, membership, and custom-field import are intentionally deferred.",
    );
    expect(currentStatus).toContain("workspace-scoped CSV export");
    expect(currentStatus).toContain(
      "CSV import creation does not support Activities, Notes, Products, Quotes",
    );
    expect(readme).toContain(
      "Deal, Contact, Organization, Lead, Activity, Product, and Quote CSV export",
    );
    expect(readme).toContain("Activities/Notes/Products/Quotes import");
    expect(readme).toContain("quotes, and email logs");
    expect(deploymentReadiness).toContain(
      "Deals, Contacts/People, Organizations, Leads, Activities, Products, and Quotes",
    );
    expect(deploymentReadiness).toContain(
      "imports for activities/notes/products/quotes",
    );
    expect(architecture).toContain(
      "Deals, Contacts/People, Organizations, Leads, Activities, Products, and Quotes can be downloaded",
    );
    expect(architecture).toContain(
      "Product and Quote exports are full workspace-scoped snapshots",
    );
    expect(architecture).toContain(
      "CSV import creation is intentionally limited to Deals, Organizations, Contacts/People, and Leads",
    );
    expect(dealsImportDesign).toContain(
      "Deals, Contacts/People, Organizations, Leads, Activities, Products, and Quotes",
    );
    expect(dealsImportDesign).toContain("latestQuoteTotal");
  });

  it("labels list exports as all rows or matching rows without counting pagination as a filter", () => {
    expect(
      buildListExportHref("workspace_1", "deals", {
        page: "3",
        pageSize: "50",
      }),
    ).toBe("/api/v1/workspaces/workspace_1/exports/deals");
    expect(
      buildListExportHref("workspace_1", "deals", {
        sortBy: "title",
        sortDirection: "asc",
      }),
    ).toBe(
      "/api/v1/workspaces/workspace_1/exports/deals?sortBy=title&sortDirection=asc",
    );
    expect(
      buildListExportHref("workspace_1", "deals", {
        q: "acme",
        page: "3",
        status: "OPEN",
      }),
    ).toBe("/api/v1/workspaces/workspace_1/exports/deals?q=acme&status=OPEN");
    expect(
      buildListExportHref("workspace/../other", "deals", { q: "acme" }),
    ).toBe("/api/v1/workspaces/workspace%2F..%2Fother/exports/deals?q=acme");
    expect(
      buildListExportHref("workspace_1", "deals", {
        ownerId: { id: "user_1" } as never,
        q: ["acme", { bad: true } as never, ""],
        status: undefined,
      }),
    ).toBe("/api/v1/workspaces/workspace_1/exports/deals?q=acme");
    expect(
      hasExportSearchParams({ sortBy: "title", sortDirection: "asc" }),
    ).toBe(true);
    expect(
      hasExportScopeSearchParams({ sortBy: "title", sortDirection: "asc" }),
    ).toBe(false);
    expect(
      hasExportSortParams({ sortBy: "title", sortDirection: "asc" }),
    ).toBe(true);
    expect(hasExportSortParams({ q: "acme", sortBy: "" })).toBe(false);
    expect(
      hasExportScopeSearchParams({
        q: "acme",
        sortBy: "title",
        sortDirection: "asc",
      }),
    ).toBe(true);
    expect(
      hasExportScopeSearchParams({ q: { value: "acme" } as never, status: "" }),
    ).toBe(false);
    expect(listExportHref).toContain("ignoredExportParams.has(key)");
    expect(listExportHref).toContain("ignoredExportScopeParams");
    expect(listExportHref).toContain("stringSearchParamValues(rawValue)");
    expect(listExportHref).toContain('typeof value === "string"');
    expect(listExportHref).toContain(
      "Downloads a CSV with all ${matchingCount} matching ${pluralLabel}${sortCopy}, not just this page",
    );
    expect(exportHelperText("deals", undefined, false)).toBe("Downloads a CSV of all deals");
    expect(exportHelperText("deals", undefined, false, true)).toBe(
      "Downloads a CSV of all deals in the current sort order",
    );
    expect(exportHelperText("deals", undefined, true)).toBe(
      "Downloads a CSV of all matching deals, not just this page",
    );
    expect(exportHelperText("deals", undefined, true, true)).toBe(
      "Downloads a CSV of all matching deals in the current sort order, not just this page",
    );
    expect(exportHelperText("contacts", 0, false)).toBe(
      "No contacts yet; downloads a header-only CSV",
    );
    expect(exportHelperText("contacts", 0, true)).toBe(
      "No matching contacts; downloads a header-only CSV",
    );
    expect(exportHelperText("organizations", 1, false)).toBe(
      "Downloads a CSV with 1 organization",
    );
    expect(exportHelperText("organizations", 1, true)).toBe(
      "Downloads a CSV with 1 matching organization",
    );
    expect(exportHelperText("organizations", 1, false, true)).toBe(
      "Downloads a CSV with 1 organization in the current sort order",
    );
    expect(exportHelperText("activities", 12, true)).toBe(
      "Downloads a CSV with all 12 matching activities, not just this page",
    );
    expect(exportHelperText("activities", 12, true, true)).toBe(
      "Downloads a CSV with all 12 matching activities in the current sort order, not just this page",
    );
    expect(exportRowCountLabel(0)).toBe("No rows");
    expect(exportRowCountLabel(1)).toBe("1 row");
    expect(exportRowCountLabel(12)).toBe("12 rows");
    expect(fullWorkspaceExportHelperText({ customFieldCount: 0, rowCount: 0 })).toBe(
      "No rows yet; downloads a header-only CSV.",
    );
    expect(fullWorkspaceExportHelperText({ customFieldCount: 2, rowCount: 0 })).toBe(
      "No rows yet; downloads a header-only CSV with configured custom field columns.",
    );
    expect(fullWorkspaceExportHelperText({ customFieldCount: 0, rowCount: 4 })).toBe(
      "Full workspace export. List-page exports preserve search, filters, and sort.",
    );
    expect(fullWorkspaceExportHelperText({ customFieldCount: 2, rowCount: 4 })).toBe(
      "Full workspace export with configured custom field columns. List-page exports preserve search, filters, and sort.",
    );
  });

  it("builds list export links with filters and sort while omitting pagination", () => {
    const routeParams = new URLSearchParams();
    routeParams.append("organizationId", "org_1");
    routeParams.append("organizationId", "org_2");
    routeParams.set("q", "Ada");

    expect(searchParamsToListSearchParams(routeParams)).toEqual({
      organizationId: ["org_1", "org_2"],
      q: "Ada",
    });

    expect(
      buildListExportHref("workspace_123", "deals", {
        customFieldId: "field_123",
        customFieldOperator: "contains",
        customFieldValue: "Enterprise",
        page: "3",
        pageSize: "25",
        q: "Needle",
        sortBy: "title",
        sortDirection: "asc",
        status: "OPEN",
      }),
    ).toBe(
      "/api/v1/workspaces/workspace_123/exports/deals?customFieldId=field_123&customFieldOperator=contains&customFieldValue=Enterprise&q=Needle&sortBy=title&sortDirection=asc&status=OPEN",
    );

    expect(
      buildListExportHref("workspace_123", "contacts", {
        organizationId: ["org_1", "org_2"],
        page: "2",
        q: "Ada",
      }),
    ).toBe(
      "/api/v1/workspaces/workspace_123/exports/contacts?organizationId=org_1&organizationId=org_2&q=Ada",
    );

    expect(
      buildListExportHref("workspace_123", "activities", {
        due: "today",
        ownerId: "user_123",
        page: "4",
        related: "deal:deal_123",
        sortBy: "dueAt",
        sortDirection: "asc",
        status: "open",
      }),
    ).toBe(
      "/api/v1/workspaces/workspace_123/exports/activities?due=today&ownerId=user_123&related=deal%3Adeal_123&sortBy=dueAt&sortDirection=asc&status=open",
    );
  });

  it("adds Deals import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain('export * from "./deal-import-service"');
    expect(importUtils).toContain('"deal"');
    expect(dealImportService).toContain(
      "export async function previewDealImport",
    );
    expect(importUtils).toContain("export function parseImportCsvPreviewInput");
    expect(importUtils).toContain("normalizeImportCsvText(csvText)");
    expect(importUtils).toContain("formatImportParseError(error)");
    expect(dealImportService).toContain("parseImportCsvPreviewInput(csvText)");
    expect(dealImportService).toContain(
      "export async function importDealsFromCsv",
    );
    expect(dealImportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(dealImportService).toContain("Deal title is required.");
    expect(dealImportService).toContain("Pipeline is required.");
    expect(dealImportService).toContain("Stage is required.");
    expect(dealImportService).toContain(
      "Pipeline must already exist in this workspace; no default pipeline is inferred.",
    );
    expect(dealImportService).toContain(
      "Stage must already exist in the resolved pipeline; stages from other pipelines are not used.",
    );
    expect(importUtils).toContain(
      "Owner email must match an active user who belongs to this workspace.",
    );
    expect(dealImportService).toContain("groupImportOwnersByEmail");
    expect(dealImportService).toContain("resolveImportOwnerId");
    expect(dealImportService).toContain(
      "Contact must already exist in this workspace; contacts are not auto-created.",
    );
    expect(dealImportService).toContain(
      "Contact reference matches multiple contacts in this workspace.",
    );
    expect(dealImportService).toContain(
      "Organization must already exist in this workspace; organizations are not auto-created.",
    );
    expect(dealImportService).toContain(
      "Deal value must be a non-negative amount with at most two decimal places and fit current storage limits.",
    );
    expect(dealImportService).toContain(
      "Unsupported columns are ignored and not imported.",
    );
    expect(dealImportService).toContain(
      "Imported WON/LOST status does not set wonAt/lostAt or lost reason",
    );
    expect(dealImportService).toContain(
      "Duplicate skipped: a deal with the same title, pipeline, stage, contact, and organization already exists in this workspace.",
    );
    expect(dealImportService).toContain(
      "Duplicate skipped: another CSV row has the same title, pipeline, stage, contact, and organization.",
    );
    expect(dealImportService).toContain("countImportPreviewRows");
    expect(dealImportService).toContain("groupImportPeopleByEmail");
    expect(dealImportService).toContain("resolveImportPersonReference");
    expect(dealImportService).not.toContain(
      "normalizeImportEmailKey(owner.email)",
    );
    expect(dealImportService).toContain("listUnsupportedImportColumns");
    expect(dealImportService).toContain(
      "const preview = await previewDealImport(actor, csvText)",
    );
    expect(dealImportService).toContain('row.status !== "valid"');
    expect(dealImportService).toContain(
      "recordImportCreateFailure(result, row.rowNumber)",
    );
    expect(dealImportService).toContain("prisma.deal.create");
    expect(dealImportService).toContain("status: row.statusValue");
    expect(dealImportService).not.toContain("wonAt:");
    expect(dealImportService).not.toContain("lostAt:");
    expect(dealImportService).toContain("writeAuditLog");
    expect(dealImportService).toContain("deal.imported");
    expect(dealImportService).toContain('buildImportAuditMetadata("deal"');
    expect(dealImportService).toContain("workspaceId: actor.workspaceId");
    expect(dealImportService).not.toContain("upsert");
    expect(dealImportService).not.toContain("createMany");
    expect(dealImportForm).toContain("Deals preview and import");
    expect(dealImportForm).toContain("Preview deals");
    expect(dealImportForm).toContain("Import valid deals");
    expect(compactSourceText(dealImportForm)).toContain(
      "contacts, organizations, and leads are not auto-created",
    );
    expect(compactSourceText(dealImportForm)).toContain(
      "Deal custom field import is deferred",
    );
    expect(compactSourceText(dealImportForm)).toContain(
      "Imported WON and LOST status does not set",
    );
    expect(compactSourceText(dealImportForm)).toContain(
      "imported won deals do not count toward Goals v1 until closed in-app",
    );
    expect(goalService).toContain("status: DealStatus.WON");
    expect(goalService).toContain("wonAt: {");
    expect(goalService).toContain("gte: periodStart");
    expect(goalService).toContain("lt: periodEnd");
    expect(importExportActions).toContain("importDealsFromCsv(actor, csvText)");
    expect(currentStatus).toContain("Deals import creation is conservative");
    expect(currentStatus).toContain(
      "Imported won deals with null `wonAt` are excluded from Goals v1 progress",
    );
    expect(routeMap).toContain("Deals import validates");
  });

  it("adds Contacts import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain('export * from "./contact-import-service"');
    expect(importUtils).toContain("export function countImportPreviewRows");
    expect(importUtils).toContain("export function createEmptyImportPreview");
    expect(importUtils).toContain("export function formatImportParseError");
    expect(importUtils).toContain(
      "redactSensitiveText(error.message) || fallback",
    );
    expect(importUtils).toContain("export function createImportResultCounts");
    expect(importUtils).toContain("failedRows: []");
    expect(importUtils).toContain("export function recordImportCreateFailure");
    expect(importUtils).toContain("export function normalizeImportCsvText");
    expect(importUtils).toContain(
      'typeof csvText === "string" ? csvText.trim() : ""',
    );
    expect(importUtils).toContain("Row could not be created after validation.");
    expect(importUtils).toContain("export function buildImportAuditMetadata");
    expect(importUtils).toContain("export function groupImportRecordsByName");
    expect(importUtils).toContain("export function groupImportOwnersByEmail");
    expect(importUtils).toContain("export function resolveImportOwnerId");
    expect(importUtils).toContain("export function groupImportPeopleByEmail");
    expect(importUtils).toContain(
      "export function groupImportPeopleByDisplayName",
    );
    expect(importUtils).toContain(
      "export function resolveImportPersonReference",
    );
    expect(importUtils).toContain(
      "export function listUnsupportedImportColumns",
    );
    expect(importUtils).toContain("export function isValidImportEmail");
    expect(importUtils).toContain("export function normalizeImportEmailKey");
    expect(importUtils).toContain("export function normalizeImportNameKey");
    expect(contactImportService).toContain(
      "export async function previewContactImport",
    );
    expect(contactImportService).toContain("parseImportCsvPreviewInput(csvText)");
    expect(contactImportService).toContain(
      "export async function importContactsFromCsv",
    );
    expect(contactImportService).toContain(
      "await ensureWorkspaceAccess(actor)",
    );
    expect(contactImportService).toContain("Contact name is required.");
    expect(contactImportService).toContain(
      "Contact email must be a valid email address.",
    );
    expect(contactImportService).toContain(
      "Duplicate contact email in this workspace.",
    );
    expect(contactImportService).toContain(
      "Duplicate contact email in this CSV.",
    );
    expect(contactImportService).toContain(
      "Organization name was not found in this workspace.",
    );
    expect(contactImportService).toContain(
      "Organization name matches multiple organizations in this workspace.",
    );
    expect(contactImportService).toContain('"owneremail"');
    expect(contactImportService).toContain("resolveImportOwnerId");
    expect(contactImportService).toContain("ownerId: row.ownerId");
    expect(contactImportService).toContain("countImportPreviewRows");
    expect(contactImportService).toContain("listUnsupportedImportColumns");
    expect(contactImportService).toContain(
      "const preview = await previewContactImport(actor, csvText)",
    );
    expect(contactImportService).toContain('row.status !== "valid"');
    expect(contactImportService).toContain(
      "recordImportCreateFailure(result, row.rowNumber)",
    );
    expect(contactImportService).toContain("prisma.person.create");
    expect(contactImportService).toContain("writeAuditLog");
    expect(contactImportService).toContain("contact.imported");
    expect(contactImportService).toContain(
      'buildImportAuditMetadata("contact"',
    );
    expect(contactImportService).not.toContain("upsert");
    expect(contactImportForm).toContain("Contacts preview and import");
    expect(contactImportForm).toContain("Preview contacts");
    expect(contactImportForm).toContain("Import valid contacts");
    expect(contactImportForm).toContain("ImportFormShell");
    expect(contactImportForm).toContain("result={state.result}");
    expect(contactImportForm).toContain('name="contactCsv"');
    expect(compactSourceText(contactImportForm)).toContain(
      "organizationName, plus ownerEmail",
    );
    expect(compactSourceText(contactImportForm)).toContain(
      "Contact custom field import is deferred",
    );
    expect(contactImportForm).toContain("duplicates to skip");
    expect(contactImportForm).not.toContain('type="file"');
    expect(importExportActions).toContain(
      "importContactsFromCsv(actor, csvText)",
    );
    expect(importExportActions).toContain('intent === "import"');
  });

  it("adds Leads import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain('export * from "./lead-import-service"');
    expect(leadImportService).toContain(
      "export async function previewLeadImport",
    );
    expect(leadImportService).toContain("parseImportCsvPreviewInput(csvText)");
    expect(leadImportService).toContain(
      "export async function importLeadsFromCsv",
    );
    expect(leadImportService).toContain("await ensureWorkspaceAccess(actor)");
    expect(leadImportService).toContain("Lead title is required.");
    expect(leadImportService).toContain(
      "Duplicate lead title in this workspace.",
    );
    expect(leadImportService).toContain("Duplicate lead title in this CSV.");
    expect(leadImportService).toContain(
      "Lead status must be NEW, QUALIFIED, or DISQUALIFIED.",
    );
    expect(leadImportService).toContain(
      "Converted leads cannot be imported through CSV.",
    );
    expect(leadImportService).toContain(
      "Contact must already exist in this workspace; contacts are not auto-created.",
    );
    expect(leadImportService).toContain(
      "Contact reference matches multiple contacts in this workspace.",
    );
    expect(leadImportService).toContain(
      "Contact email must be a valid email address.",
    );
    expect(leadImportService).toContain(
      "Organization name was not found in this workspace.",
    );
    expect(leadImportService).toContain(
      "Organization name matches multiple organizations in this workspace.",
    );
    expect(leadImportService).toContain('"contactemail"');
    expect(leadImportService).toContain('"contactname"');
    expect(leadImportService).toContain('"owneremail"');
    expect(leadImportService).toContain("resolvePersonReference");
    expect(leadImportService).toContain("groupImportPeopleByEmail");
    expect(leadImportService).toContain("resolveImportPersonReference");
    expect(leadImportService).toContain("resolveImportOwnerId");
    expect(leadImportService).toContain("countImportPreviewRows");
    expect(leadImportService).toContain("listUnsupportedImportColumns");
    expect(leadImportService).toContain(
      "const preview = await previewLeadImport(actor, csvText)",
    );
    expect(leadImportService).toContain('row.status !== "valid"');
    expect(leadImportService).toContain(
      "recordImportCreateFailure(result, row.rowNumber)",
    );
    expect(leadImportService).toContain("prisma.lead.create");
    expect(leadImportService).toContain("personId: row.personId");
    expect(leadImportService).toContain("ownerId: row.ownerId");
    expect(leadImportService).toContain("writeAuditLog");
    expect(leadImportService).toContain("lead.imported");
    expect(leadImportService).toContain('buildImportAuditMetadata("lead"');
    expect(leadImportService).not.toContain("upsert");
    expect(leadImportForm).toContain("Leads preview and import");
    expect(leadImportForm).toContain("Preview leads");
    expect(leadImportForm).toContain("Import valid leads");
    expect(leadImportForm).toContain("ImportFormShell");
    expect(leadImportForm).toContain("result={state.result}");
    expect(leadImportForm).toContain('name="leadCsv"');
    expect(leadImportForm).toContain("contactEmail");
    expect(leadImportForm).toContain("ownerEmail");
    expect(leadImportForm).toContain("Lead custom field");
    expect(leadImportForm).toContain("duplicates to skip");
    expect(importExportActions).toContain("importLeadsFromCsv(actor, csvText)");
  });

  it("adds Organizations import validation and conservative creation behavior", () => {
    expect(crmBarrel).toContain(
      'export * from "./organization-import-service"',
    );
    expect(organizationImportService).toContain(
      "export async function previewOrganizationImport",
    );
    expect(organizationImportService).toContain(
      "parseImportCsvPreviewInput(csvText)",
    );
    expect(organizationImportService).toContain(
      "export async function importOrganizationsFromCsv",
    );
    expect(organizationImportService).toContain(
      "await ensureWorkspaceAccess(actor)",
    );
    expect(organizationImportService).toContain(
      "CSV must include a name column.",
    );
    expect(organizationImportService).toContain("unsupportedColumns");
    expect(organizationImportService).toContain(
      "Duplicate organization name in this workspace.",
    );
    expect(organizationImportService).toContain(
      "Duplicate organization name in this CSV.",
    );
    expect(organizationImportService).toContain('"owneremail"');
    expect(organizationImportService).toContain("resolveImportOwnerId");
    expect(organizationImportService).toContain("countImportPreviewRows");
    expect(organizationImportService).toContain("listUnsupportedImportColumns");
    expect(organizationImportService).toContain(
      "const preview = await previewOrganizationImport(actor, csvText)",
    );
    expect(organizationImportService).toContain('row.status !== "valid"');
    expect(organizationImportService).toContain(
      "recordImportCreateFailure(result, row.rowNumber)",
    );
    expect(organizationImportService).toContain("organization.imported");
    expect(organizationImportService).toContain(
      'buildImportAuditMetadata("organization"',
    );
    expect(organizationImportService).toContain(
      "workspaceId: actor.workspaceId",
    );
    expect(organizationImportService).toContain("ownerId: row.ownerId");
    expect(organizationImportService).not.toContain("upsert");
    expect(organizationImportForm).toContain(
      'optionalColumns="domain and ownerEmail"',
    );
    expect(importFormShared).toContain("{optionalLabel}: {optionalColumns}");
  });
});
