export type ImportPreviewStatus = "valid" | "duplicate" | "invalid";

export type ImportPreviewCounts = {
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
};

export type ImportResultCounts = {
  createdCount: number;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
  errorCount: number;
};

export type ImportAuditRecordType = "organization" | "contact" | "lead" | "deal";

export function countImportPreviewRows(rows: Array<{ status: ImportPreviewStatus }>): ImportPreviewCounts {
  return {
    validRows: rows.filter((row) => row.status === "valid").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    invalidRows: rows.filter((row) => row.status === "invalid").length
  };
}

export function createImportResultCounts(preview: {
  parseErrors: string[];
  rows: Array<{ status: ImportPreviewStatus }>;
}): ImportResultCounts {
  const counts = countImportPreviewRows(preview.rows);

  return {
    createdCount: 0,
    skippedDuplicateCount: counts.duplicateRows,
    skippedInvalidCount: counts.invalidRows,
    errorCount: preview.parseErrors.length
  };
}

export function firstImportHeaderIndex(headers: string[], candidates: string[]) {
  return headers.findIndex((header) => candidates.includes(header));
}

export function listUnsupportedImportColumns(
  headers: string[],
  normalizedHeaders: string[],
  supportedColumns: ReadonlySet<string>
) {
  return headers
    .map((header, index) => ({ header: header.trim(), normalized: normalizedHeaders[index] }))
    .filter(({ header, normalized }) => header && !supportedColumns.has(normalized))
    .map(({ header }) => header);
}

export function normalizeImportHeader(header: string) {
  return header.trim().toLowerCase();
}

export function normalizeImportNameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeImportEmailKey(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

export function groupImportRecordsByName<TRecord extends { name: string }>(records: TRecord[]) {
  const groups = new Map<string, TRecord[]>();
  for (const record of records) {
    const key = normalizeImportNameKey(record.name);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return groups;
}

export function buildImportAuditMetadata(
  recordType: ImportAuditRecordType,
  displayName: string,
  details: Record<string, string | null> = {}
) {
  return {
    importSource: "csv",
    recordType,
    displayName,
    ...details
  };
}

export function stripCsvBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}
