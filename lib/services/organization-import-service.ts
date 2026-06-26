import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/db/prisma";
import {
  buildImportAuditMetadata,
  countImportPreviewRows,
  createImportResultCounts,
  firstImportHeaderIndex,
  listUnsupportedImportColumns,
  normalizeImportHeader,
  normalizeImportNameKey,
  stripCsvBom,
  type ImportPreviewStatus
} from "./import-utils";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type OrganizationImportPreviewRow = {
  rowNumber: number;
  name: string;
  domain: string;
  status: ImportPreviewStatus;
  skipReasons: string[];
  errors: string[];
  warnings: string[];
};

export type OrganizationImportPreview = {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  unsupportedColumns: string[];
  parseErrors: string[];
  rows: OrganizationImportPreviewRow[];
};

export type OrganizationImportResult = {
  preview: OrganizationImportPreview;
  createdCount: number;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
  errorCount: number;
  createdOrganizations: Array<{ id: string; name: string }>;
};

const supportedOrganizationColumns = new Set(["name", "organization name", "domain"]);
const organizationImportMessages = {
  missingName: "Organization name is required.",
  unsupportedColumns: "Unsupported columns will be ignored.",
  duplicateExisting: "Duplicate organization name in this workspace.",
  duplicateImport: "Duplicate organization name in this CSV."
} as const;

export async function previewOrganizationImport(
  actor: WorkspaceActor,
  csvText: string
): Promise<OrganizationImportPreview> {
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
  const nameIndex = firstImportHeaderIndex(headers, ["name", "organization name"]);
  const domainIndex = firstImportHeaderIndex(headers, ["domain"]);
  const unsupportedColumns = listUnsupportedImportColumns(parsed.headers, headers, supportedOrganizationColumns);

  if (nameIndex === -1) {
    return {
      ...emptyPreview(["CSV must include a name column."]),
      totalRows: parsed.rows.length,
      unsupportedColumns
    };
  }

  const existingOrganizations = await prisma.organization.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    select: { name: true }
  });
  const existingNames = new Set(existingOrganizations.map((organization) => normalizeImportNameKey(organization.name)));
  const seenImportNames = new Set<string>();

  const rows = parsed.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim()))
    .map(({ row, rowNumber }): OrganizationImportPreviewRow => {
      const name = (row[nameIndex] ?? "").trim();
      const domain = domainIndex === -1 ? "" : (row[domainIndex] ?? "").trim();
      const normalizedName = normalizeImportNameKey(name);
      const errors: string[] = [];
      const warnings: string[] = [];
      const skipReasons: string[] = [];

      if (!name) {
        errors.push(organizationImportMessages.missingName);
        skipReasons.push(organizationImportMessages.missingName);
      }
      if (unsupportedColumns.length > 0) warnings.push(organizationImportMessages.unsupportedColumns);

      const duplicatesExisting = normalizedName ? existingNames.has(normalizedName) : false;
      const duplicatesImport = normalizedName ? seenImportNames.has(normalizedName) : false;
      if (normalizedName) seenImportNames.add(normalizedName);

      if (duplicatesExisting) {
        warnings.push(organizationImportMessages.duplicateExisting);
        skipReasons.push(organizationImportMessages.duplicateExisting);
      }
      if (duplicatesImport) {
        warnings.push(organizationImportMessages.duplicateImport);
        skipReasons.push(organizationImportMessages.duplicateImport);
      }

      return {
        rowNumber,
        name,
        domain,
        status: errors.length > 0 ? "invalid" : duplicatesExisting || duplicatesImport ? "duplicate" : "valid",
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

export async function importOrganizationsFromCsv(
  actor: WorkspaceActor,
  csvText: string
): Promise<OrganizationImportResult> {
  const preview = await previewOrganizationImport(actor, csvText);
  const result: OrganizationImportResult = {
    preview,
    ...createImportResultCounts(preview),
    createdOrganizations: []
  };

  if (preview.parseErrors.length > 0) return result;

  for (const row of preview.rows) {
    if (row.status !== "valid") continue;

    try {
      const organization = await prisma.organization.create({
        data: {
          workspaceId: actor.workspaceId,
          name: row.name,
          domain: row.domain || null
        },
        select: { id: true, name: true }
      });
      await writeAuditLog(
        actor,
        "organization.imported",
        "Organization",
        organization.id,
        buildImportAuditMetadata("organization", organization.name, { name: organization.name })
      );
      result.createdOrganizations.push(organization);
      result.createdCount += 1;
    } catch {
      result.errorCount += 1;
    }
  }

  return result;
}

function emptyPreview(parseErrors: string[]): OrganizationImportPreview {
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
