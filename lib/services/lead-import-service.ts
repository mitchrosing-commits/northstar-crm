import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/db/prisma";
import {
  buildImportAuditMetadata,
  countImportPreviewRows,
  createImportResultCounts,
  firstImportHeaderIndex,
  groupImportRecordsByName,
  listUnsupportedImportColumns,
  normalizeImportHeader,
  normalizeImportNameKey,
  stripCsvBom,
  type ImportPreviewStatus
} from "./import-utils";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type LeadImportPreviewRow = {
  rowNumber: number;
  title: string;
  source: string;
  statusValue: string;
  organizationName: string;
  organizationId: string | null;
  status: ImportPreviewStatus;
  skipReasons: string[];
  errors: string[];
  warnings: string[];
};

export type LeadImportPreview = {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  unsupportedColumns: string[];
  parseErrors: string[];
  rows: LeadImportPreviewRow[];
};

export type LeadImportResult = {
  preview: LeadImportPreview;
  createdCount: number;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
  errorCount: number;
  createdLeads: Array<{ id: string; title: string; status: string }>;
};

const supportedLeadColumns = new Set(["title", "lead title", "name", "lead name", "source", "status", "organization", "organization name", "organizationname"]);
const supportedLeadStatuses = new Set(["NEW", "QUALIFIED", "DISQUALIFIED"]);
const leadImportMessages = {
  missingTitle: "Lead title is required.",
  unsupportedColumns: "Unsupported columns will be ignored.",
  duplicateExistingTitle: "Duplicate lead title in this workspace.",
  duplicateImportTitle: "Duplicate lead title in this CSV.",
  invalidStatus: "Lead status must be NEW, QUALIFIED, or DISQUALIFIED.",
  convertedStatus: "Converted leads cannot be imported through CSV.",
  organizationNotFound: "Organization name was not found in this workspace.",
  organizationAmbiguous: "Organization name matches multiple organizations in this workspace."
} as const;

export async function previewLeadImport(actor: WorkspaceActor, csvText: string): Promise<LeadImportPreview> {
  await ensureWorkspaceAccess(actor);

  const text = csvText.trim();
  if (!text) return emptyPreview(["CSV text is required."]);

  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(text);
  } catch (error) {
    return emptyPreview([error instanceof Error ? error.message : "CSV could not be parsed."]);
  }

  const headers = parsed.headers.map((header, index) => normalizeImportHeader(index === 0 ? stripCsvBom(header) : header));
  const titleIndex = firstImportHeaderIndex(headers, ["title", "lead title", "name", "lead name"]);
  const sourceIndex = firstImportHeaderIndex(headers, ["source"]);
  const statusIndex = firstImportHeaderIndex(headers, ["status"]);
  const organizationNameIndex = firstImportHeaderIndex(headers, ["organization", "organization name", "organizationname"]);
  const unsupportedColumns = listUnsupportedImportColumns(parsed.headers, headers, supportedLeadColumns);

  if (titleIndex === -1) {
    return {
      ...emptyPreview(["CSV must include a lead title or name column."]),
      totalRows: parsed.rows.length,
      unsupportedColumns
    };
  }

  const [existingLeads, organizations] = await Promise.all([
    prisma.lead.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { title: true }
    }),
    prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    })
  ]);
  const existingTitles = new Set(existingLeads.map((lead) => normalizeImportNameKey(lead.title)));
  const organizationsByName = groupImportRecordsByName(organizations);
  const seenImportTitles = new Set<string>();

  const rows = parsed.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim()))
    .map(({ row, rowNumber }): LeadImportPreviewRow => {
      const title = (row[titleIndex] ?? "").trim();
      const source = sourceIndex === -1 ? "" : (row[sourceIndex] ?? "").trim();
      const rawStatus = statusIndex === -1 ? "" : (row[statusIndex] ?? "").trim();
      const statusValue = rawStatus ? rawStatus.toUpperCase() : "NEW";
      const organizationName = organizationNameIndex === -1 ? "" : (row[organizationNameIndex] ?? "").trim();
      const normalizedTitle = normalizeImportNameKey(title);
      const normalizedOrganizationName = normalizeImportNameKey(organizationName);
      const organizationMatches = normalizedOrganizationName ? organizationsByName.get(normalizedOrganizationName) ?? [] : [];
      const errors: string[] = [];
      const warnings: string[] = [];
      const skipReasons: string[] = [];

      if (!title) {
        errors.push(leadImportMessages.missingTitle);
        skipReasons.push(leadImportMessages.missingTitle);
      }
      if (unsupportedColumns.length > 0) warnings.push(leadImportMessages.unsupportedColumns);

      const duplicatesExistingTitle = normalizedTitle ? existingTitles.has(normalizedTitle) : false;
      const duplicatesImportTitle = normalizedTitle ? seenImportTitles.has(normalizedTitle) : false;
      if (normalizedTitle) seenImportTitles.add(normalizedTitle);

      if (duplicatesExistingTitle) {
        warnings.push(leadImportMessages.duplicateExistingTitle);
        skipReasons.push(leadImportMessages.duplicateExistingTitle);
      }
      if (duplicatesImportTitle) {
        warnings.push(leadImportMessages.duplicateImportTitle);
        skipReasons.push(leadImportMessages.duplicateImportTitle);
      }

      if (statusValue === "CONVERTED") {
        errors.push(leadImportMessages.convertedStatus);
        skipReasons.push(leadImportMessages.convertedStatus);
      } else if (!supportedLeadStatuses.has(statusValue)) {
        errors.push(leadImportMessages.invalidStatus);
        skipReasons.push(leadImportMessages.invalidStatus);
      }

      if (normalizedOrganizationName && organizationMatches.length === 0) {
        errors.push(leadImportMessages.organizationNotFound);
        skipReasons.push(leadImportMessages.organizationNotFound);
      }
      if (organizationMatches.length > 1) {
        errors.push(leadImportMessages.organizationAmbiguous);
        skipReasons.push(leadImportMessages.organizationAmbiguous);
      }

      return {
        rowNumber,
        title,
        source,
        statusValue,
        organizationName,
        organizationId: organizationMatches.length === 1 ? organizationMatches[0].id : null,
        status: errors.length > 0 ? "invalid" : duplicatesExistingTitle || duplicatesImportTitle ? "duplicate" : "valid",
        skipReasons,
        errors,
        warnings
      };
    });
  const counts = countImportPreviewRows(rows);

  return {
    totalRows: rows.length,
    validRows: counts.validRows,
    duplicateRows: counts.duplicateRows,
    invalidRows: counts.invalidRows,
    unsupportedColumns,
    parseErrors: [],
    rows
  };
}

export async function importLeadsFromCsv(actor: WorkspaceActor, csvText: string): Promise<LeadImportResult> {
  const preview = await previewLeadImport(actor, csvText);
  const result: LeadImportResult = {
    preview,
    ...createImportResultCounts(preview),
    createdLeads: []
  };

  if (preview.parseErrors.length > 0) return result;

  for (const row of preview.rows) {
    if (row.status !== "valid") continue;

    try {
      const lead = await prisma.lead.create({
        data: {
          workspaceId: actor.workspaceId,
          title: row.title,
          source: row.source || null,
          status: row.statusValue as "NEW" | "QUALIFIED" | "DISQUALIFIED",
          organizationId: row.organizationId
        },
        select: { id: true, title: true, status: true }
      });
      await writeAuditLog(
        actor,
        "lead.imported",
        "Lead",
        lead.id,
        buildImportAuditMetadata("lead", lead.title, { title: lead.title, status: lead.status })
      );
      result.createdLeads.push(lead);
      result.createdCount += 1;
    } catch {
      result.errorCount += 1;
    }
  }

  return result;
}

function emptyPreview(parseErrors: string[]): LeadImportPreview {
  return {
    totalRows: 0,
    validRows: 0,
    duplicateRows: 0,
    invalidRows: 0,
    unsupportedColumns: [],
    parseErrors,
    rows: []
  };
}
