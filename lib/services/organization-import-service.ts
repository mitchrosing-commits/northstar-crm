import { prisma } from "@/lib/db/prisma";
import {
  buildImportAuditMetadata,
  countNonBlankImportRows,
  countImportPreviewRows,
  createEmptyImportPreview,
  createImportResultCounts,
  firstImportHeaderIndex,
  groupImportOwnersByEmail,
  listDuplicateImportColumnMessages,
  listUnsupportedImportColumns,
  normalizeImportNameKey,
  parseImportCsvPreviewInput,
  recordImportCreateFailure,
  resolveImportOwnerId,
  type ImportFailedRow,
  type ImportPreviewStatus
} from "./import-utils";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type OrganizationImportPreviewRow = {
  rowNumber: number;
  name: string;
  domain: string;
  ownerEmail: string;
  ownerId: string | null;
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
  failedRows: ImportFailedRow[];
  createdOrganizations: Array<{ id: string; name: string }>;
};

const supportedOrganizationColumns = new Set(["name", "organization name", "domain", "owneremail", "owner email"]);
const organizationImportMessages = {
  missingName: "Organization name is required.",
  unsupportedColumns: "Unsupported columns will be ignored.",
  duplicateExisting: "Duplicate organization name in this workspace.",
  duplicateImport: "Duplicate organization name in this CSV."
} as const;

export async function previewOrganizationImport(
  actor: WorkspaceActor,
  csvText: unknown
): Promise<OrganizationImportPreview> {
  await ensureWorkspaceAccess(actor);

  const input = parseImportCsvPreviewInput(csvText);
  if ("parseErrors" in input) return createEmptyImportPreview<OrganizationImportPreviewRow>(input.parseErrors);
  const { parsed, headers } = input;
  const nameIndex = firstImportHeaderIndex(headers, ["name", "organization name"]);
  const domainIndex = firstImportHeaderIndex(headers, ["domain"]);
  const ownerEmailIndex = firstImportHeaderIndex(headers, ["owneremail", "owner email"]);
  const unsupportedColumns = listUnsupportedImportColumns(parsed.headers, headers, supportedOrganizationColumns);
  const duplicateColumnErrors = listDuplicateImportColumnMessages(headers, [
    { label: "organization name", candidates: ["name", "organization name"] },
    { label: "domain", candidates: ["domain"] },
    { label: "owner email", candidates: ["owneremail", "owner email"] }
  ]);

  const headerErrors = [...duplicateColumnErrors];
  if (nameIndex === -1) headerErrors.push("CSV must include a name column.");
  if (headerErrors.length > 0) {
    return {
      ...createEmptyImportPreview<OrganizationImportPreviewRow>(headerErrors),
      totalRows: countNonBlankImportRows(parsed.rows),
      unsupportedColumns
    };
  }

  const [existingOrganizations, owners] = await Promise.all([
    prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { name: true }
    }),
    prisma.user.findMany({
      where: { deletedAt: null, memberships: { some: { workspaceId: actor.workspaceId } } },
      select: { id: true, email: true },
      orderBy: [{ email: "asc" }, { id: "asc" }]
    })
  ]);
  const existingNames = new Set(existingOrganizations.map((organization) => normalizeImportNameKey(organization.name)));
  const ownersByEmail = groupImportOwnersByEmail(owners);
  const seenImportNames = new Set<string>();

  const rows = parsed.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim()))
    .map(({ row, rowNumber }): OrganizationImportPreviewRow => {
      const name = (row[nameIndex] ?? "").trim();
      const domain = domainIndex === -1 ? "" : (row[domainIndex] ?? "").trim();
      const ownerEmail = ownerEmailIndex === -1 ? "" : (row[ownerEmailIndex] ?? "").trim();
      const normalizedName = normalizeImportNameKey(name);
      const ownerResolution = resolveImportOwnerId(ownersByEmail, ownerEmail);
      const errors: string[] = [];
      const warnings: string[] = [];
      const skipReasons: string[] = [];

      if (!name) {
        errors.push(organizationImportMessages.missingName);
        skipReasons.push(organizationImportMessages.missingName);
      }
      if (unsupportedColumns.length > 0) warnings.push(organizationImportMessages.unsupportedColumns);

      if (ownerResolution.error) {
        errors.push(ownerResolution.error);
        skipReasons.push(ownerResolution.error);
      }
      const duplicatesExisting = errors.length === 0 && normalizedName ? existingNames.has(normalizedName) : false;
      const duplicatesImport =
        errors.length === 0 && normalizedName && !duplicatesExisting ? seenImportNames.has(normalizedName) : false;
      if (errors.length === 0 && normalizedName && !duplicatesExisting && !duplicatesImport) {
        seenImportNames.add(normalizedName);
      }

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
        ownerEmail,
        ownerId: ownerResolution.ownerId,
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
  csvText: unknown
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
          domain: row.domain || null,
          ownerId: row.ownerId
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
      recordImportCreateFailure(result, row.rowNumber);
    }
  }

  return result;
}
