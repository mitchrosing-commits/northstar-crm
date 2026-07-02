import { parseCsv, type ParsedCsv } from "@/lib/csv";
import { isSensitiveRedactionKey, redactSensitiveText } from "@/lib/security/redaction";

export type ImportPreviewStatus = "valid" | "duplicate" | "invalid";

export type ImportPreviewCounts = {
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
};

export type EmptyImportPreview<TRow> = ImportPreviewCounts & {
  totalRows: number;
  unsupportedColumns: string[];
  parseErrors: string[];
  rows: TRow[];
};
export type ParsedImportCsvPreviewInput = {
  parsed: ParsedCsv;
  headers: string[];
};

export type ImportResultCounts = {
  createdCount: number;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
  errorCount: number;
  failedRows: ImportFailedRow[];
};

export type ImportFailedRow = {
  rowNumber: number;
  reason: string;
};

export type ImportAuditRecordType = "organization" | "contact" | "lead" | "deal";
export type ImportOwnerRecord = {
  id: string;
  email: string | null;
};
export type ImportPersonRecord = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
};

export const importOwnerEmailMessages = {
  invalidOwnerEmail: "Owner email must be a valid email address.",
  ownerNotFound: "Owner email must match an active user who belongs to this workspace."
} as const;
export const importCreateFailureMessage =
  "Row could not be created after validation. The record may now duplicate existing data or reference data changed since preview.";

export function countImportPreviewRows(rows: Array<{ status: ImportPreviewStatus }>): ImportPreviewCounts {
  return {
    validRows: rows.filter((row) => row.status === "valid").length,
    duplicateRows: rows.filter((row) => row.status === "duplicate").length,
    invalidRows: rows.filter((row) => row.status === "invalid").length
  };
}

export function countNonBlankImportRows(rows: string[][]) {
  return rows.filter((row) => row.some((cell) => cell.trim())).length;
}

export function createEmptyImportPreview<TRow>(parseErrors: string[]): EmptyImportPreview<TRow> {
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

export function createImportResultCounts(preview: {
  parseErrors: string[];
  rows: Array<{ status: ImportPreviewStatus }>;
}): ImportResultCounts {
  const counts = countImportPreviewRows(preview.rows);

  return {
    createdCount: 0,
    skippedDuplicateCount: counts.duplicateRows,
    skippedInvalidCount: counts.invalidRows,
    errorCount: preview.parseErrors.length,
    failedRows: []
  };
}

export function normalizeImportCsvText(csvText: unknown) {
  return typeof csvText === "string" ? csvText.trim() : "";
}

export function parseImportCsvPreviewInput(csvText: unknown): ParsedImportCsvPreviewInput | { parseErrors: string[] } {
  const text = normalizeImportCsvText(csvText);
  if (!text) return { parseErrors: ["CSV text is required."] };

  try {
    const parsed = parseCsv(text);
    return {
      parsed,
      headers: parsed.headers.map((header, index) =>
        normalizeImportHeader(index === 0 ? stripCsvBom(header) : header)
      )
    };
  } catch (error) {
    return { parseErrors: [formatImportParseError(error)] };
  }
}

export function formatImportParseError(error: unknown, fallback = "CSV could not be parsed.") {
  if (!(error instanceof Error)) {
    return fallback;
  }

  return redactSensitiveText(error.message) || fallback;
}

export function recordImportCreateFailure(
  result: { errorCount: number; failedRows: ImportFailedRow[] },
  rowNumber: number,
  reason = importCreateFailureMessage
) {
  result.errorCount += 1;
  result.failedRows.push({ rowNumber, reason });
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
    .map(({ header, normalized }) => formatUnsupportedImportColumnHeader(header, normalized));
}

export function listDuplicateImportColumnMessages(
  normalizedHeaders: string[],
  groups: ReadonlyArray<{ label: string; candidates: readonly string[] }>
) {
  const messages: string[] = [];

  for (const group of groups) {
    const count = normalizedHeaders.filter((header) => header && group.candidates.includes(header)).length;
    if (count > 1) {
      messages.push(`CSV includes duplicate ${group.label} columns. Keep one ${group.label} column before importing.`);
    }
  }

  return messages;
}

export function normalizeImportHeader(header: string) {
  return header.trim().replace(/[\s\u00A0]+/g, " ").toLowerCase();
}

export function normalizeImportNameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeImportEmailKey(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

export function isValidImportEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function groupImportOwnersByEmail(owners: ImportOwnerRecord[]) {
  const entries: Array<[string, string]> = [];

  for (const owner of owners) {
    const email = normalizeImportEmailKey(owner.email);
    if (email) entries.push([email, owner.id]);
  }

  return new Map(entries);
}

export function resolveImportOwnerId(ownersByEmail: Map<string, string>, ownerEmail: string) {
  if (!ownerEmail) return { ownerId: null, error: null };
  if (!isValidImportEmail(ownerEmail)) {
    return { ownerId: null, error: importOwnerEmailMessages.invalidOwnerEmail };
  }

  const ownerId = ownersByEmail.get(normalizeImportEmailKey(ownerEmail)) ?? null;
  return ownerId ? { ownerId, error: null } : { ownerId: null, error: importOwnerEmailMessages.ownerNotFound };
}

export function groupImportRecordsByName<TRecord extends { name: string }>(records: TRecord[]) {
  const groups = new Map<string, TRecord[]>();
  for (const record of records) {
    const key = normalizeImportNameKey(record.name);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return groups;
}

export function groupImportPeopleByEmail<TRecord extends ImportPersonRecord>(people: TRecord[]) {
  const groups = new Map<string, TRecord[]>();
  for (const person of people) {
    const key = normalizeImportEmailKey(person.email);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), person]);
  }
  return groups;
}

export function groupImportPeopleByDisplayName<TRecord extends ImportPersonRecord>(people: TRecord[]) {
  const groups = new Map<string, TRecord[]>();
  for (const person of people) {
    const key = normalizeImportNameKey(importPersonDisplayName(person));
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), person]);
  }
  return groups;
}

export function resolveImportPersonReference<TRecord extends ImportPersonRecord>(
  peopleByEmail: Map<string, TRecord[]>,
  peopleByName: Map<string, TRecord[]>,
  contactEmail: string,
  contactName: string,
  messages: { ambiguous: string; notFound: string }
) {
  const emailKey = normalizeImportEmailKey(contactEmail);
  if (emailKey) {
    const matches = peopleByEmail.get(emailKey) ?? [];
    if (matches.length === 0) return { personId: null, error: messages.notFound };
    if (matches.length > 1) return { personId: null, error: messages.ambiguous };
    return { personId: matches[0].id, error: null };
  }

  const nameKey = normalizeImportNameKey(contactName);
  if (nameKey) {
    const matches = peopleByName.get(nameKey) ?? [];
    if (matches.length === 0) return { personId: null, error: messages.notFound };
    if (matches.length > 1) return { personId: null, error: messages.ambiguous };
    return { personId: matches[0].id, error: null };
  }

  return { personId: null, error: null };
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

function importPersonDisplayName(person: ImportPersonRecord) {
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function formatUnsupportedImportColumnHeader(header: string, normalized: string) {
  if (isSensitiveRedactionKey(header) || isSensitiveRedactionKey(normalized)) return "[redacted]";
  return redactSensitiveText(header);
}
