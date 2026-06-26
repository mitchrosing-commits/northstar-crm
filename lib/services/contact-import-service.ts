import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/db/prisma";
import {
  buildImportAuditMetadata,
  countImportPreviewRows,
  createImportResultCounts,
  firstImportHeaderIndex,
  groupImportRecordsByName,
  listUnsupportedImportColumns,
  normalizeImportEmailKey,
  normalizeImportHeader,
  normalizeImportNameKey,
  stripCsvBom,
  type ImportPreviewStatus
} from "./import-utils";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type ContactImportPreviewRow = {
  rowNumber: number;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  organizationName: string;
  organizationId: string | null;
  status: ImportPreviewStatus;
  skipReasons: string[];
  errors: string[];
  warnings: string[];
};

export type ContactImportPreview = {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  unsupportedColumns: string[];
  parseErrors: string[];
  rows: ContactImportPreviewRow[];
};

export type ContactImportResult = {
  preview: ContactImportPreview;
  createdCount: number;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
  errorCount: number;
  createdContacts: Array<{ id: string; name: string; email: string | null }>;
};

const supportedContactColumns = new Set([
  "name",
  "contact name",
  "full name",
  "first name",
  "firstname",
  "last name",
  "lastname",
  "email",
  "phone",
  "organization",
  "organization name",
  "organizationname"
]);
const contactImportMessages = {
  missingName: "Contact name is required.",
  unsupportedColumns: "Unsupported columns will be ignored.",
  duplicateExistingEmail: "Duplicate contact email in this workspace.",
  duplicateImportEmail: "Duplicate contact email in this CSV.",
  organizationNotFound: "Organization name was not found in this workspace.",
  organizationAmbiguous: "Organization name matches multiple organizations in this workspace."
} as const;

export async function previewContactImport(actor: WorkspaceActor, csvText: string): Promise<ContactImportPreview> {
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
  const nameIndex = firstImportHeaderIndex(headers, ["name", "contact name", "full name"]);
  const firstNameIndex = firstImportHeaderIndex(headers, ["first name", "firstname"]);
  const lastNameIndex = firstImportHeaderIndex(headers, ["last name", "lastname"]);
  const emailIndex = firstImportHeaderIndex(headers, ["email"]);
  const phoneIndex = firstImportHeaderIndex(headers, ["phone"]);
  const organizationNameIndex = firstImportHeaderIndex(headers, ["organization", "organization name", "organizationname"]);
  const unsupportedColumns = listUnsupportedImportColumns(parsed.headers, headers, supportedContactColumns);

  if (nameIndex === -1 && firstNameIndex === -1) {
    return {
      ...emptyPreview(["CSV must include a contact name or firstName column."]),
      totalRows: parsed.rows.length,
      unsupportedColumns
    };
  }

  const [existingContacts, organizations] = await Promise.all([
    prisma.person.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere, email: { not: null } },
      select: { email: true }
    }),
    prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    })
  ]);
  const existingEmails = new Set(existingContacts.map((contact) => normalizeImportEmailKey(contact.email)).filter(Boolean));
  const organizationsByName = groupImportRecordsByName(organizations);
  const seenImportEmails = new Set<string>();

  const rows = parsed.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim()))
    .map(({ row, rowNumber }): ContactImportPreviewRow => {
      const parsedName = parseContactName(
        nameIndex === -1 ? "" : row[nameIndex] ?? "",
        firstNameIndex === -1 ? "" : row[firstNameIndex] ?? "",
        lastNameIndex === -1 ? "" : row[lastNameIndex] ?? ""
      );
      const email = emailIndex === -1 ? "" : (row[emailIndex] ?? "").trim();
      const phone = phoneIndex === -1 ? "" : (row[phoneIndex] ?? "").trim();
      const organizationName = organizationNameIndex === -1 ? "" : (row[organizationNameIndex] ?? "").trim();
      const normalizedEmail = normalizeImportEmailKey(email);
      const normalizedOrganizationName = normalizeImportNameKey(organizationName);
      const organizationMatches = normalizedOrganizationName ? organizationsByName.get(normalizedOrganizationName) ?? [] : [];
      const errors: string[] = [];
      const warnings: string[] = [];
      const skipReasons: string[] = [];

      if (!parsedName.firstName) {
        errors.push(contactImportMessages.missingName);
        skipReasons.push(contactImportMessages.missingName);
      }
      if (unsupportedColumns.length > 0) warnings.push(contactImportMessages.unsupportedColumns);

      const duplicatesExistingEmail = normalizedEmail ? existingEmails.has(normalizedEmail) : false;
      const duplicatesImportEmail = normalizedEmail ? seenImportEmails.has(normalizedEmail) : false;
      if (normalizedEmail) seenImportEmails.add(normalizedEmail);

      if (duplicatesExistingEmail) {
        warnings.push(contactImportMessages.duplicateExistingEmail);
        skipReasons.push(contactImportMessages.duplicateExistingEmail);
      }
      if (duplicatesImportEmail) {
        warnings.push(contactImportMessages.duplicateImportEmail);
        skipReasons.push(contactImportMessages.duplicateImportEmail);
      }

      if (normalizedOrganizationName && organizationMatches.length === 0) {
        errors.push(contactImportMessages.organizationNotFound);
        skipReasons.push(contactImportMessages.organizationNotFound);
      }
      if (organizationMatches.length > 1) {
        errors.push(contactImportMessages.organizationAmbiguous);
        skipReasons.push(contactImportMessages.organizationAmbiguous);
      }

      return {
        rowNumber,
        name: [parsedName.firstName, parsedName.lastName].filter(Boolean).join(" "),
        firstName: parsedName.firstName,
        lastName: parsedName.lastName,
        email,
        phone,
        organizationName,
        organizationId: organizationMatches.length === 1 ? organizationMatches[0].id : null,
        status: errors.length > 0 ? "invalid" : duplicatesExistingEmail || duplicatesImportEmail ? "duplicate" : "valid",
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

export async function importContactsFromCsv(actor: WorkspaceActor, csvText: string): Promise<ContactImportResult> {
  const preview = await previewContactImport(actor, csvText);
  const result: ContactImportResult = {
    preview,
    ...createImportResultCounts(preview),
    createdContacts: []
  };

  if (preview.parseErrors.length > 0) return result;

  for (const row of preview.rows) {
    if (row.status !== "valid") continue;

    try {
      const contact = await prisma.person.create({
        data: {
          workspaceId: actor.workspaceId,
          firstName: row.firstName,
          lastName: row.lastName || null,
          email: row.email || null,
          phone: row.phone || null,
          organizationId: row.organizationId
        },
        select: { id: true, firstName: true, lastName: true, email: true }
      });
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
      await writeAuditLog(
        actor,
        "contact.imported",
        "Person",
        contact.id,
        buildImportAuditMetadata("contact", name, { name, email: contact.email })
      );
      result.createdContacts.push({ id: contact.id, name, email: contact.email });
      result.createdCount += 1;
    } catch {
      result.errorCount += 1;
    }
  }

  return result;
}

function emptyPreview(parseErrors: string[]): ContactImportPreview {
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

function parseContactName(fullName: string, firstName: string, lastName: string) {
  const explicitFirstName = firstName.trim();
  const explicitLastName = lastName.trim();
  if (explicitFirstName || explicitLastName) {
    return { firstName: explicitFirstName, lastName: explicitLastName };
  }

  const parts = fullName.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ")
  };
}
