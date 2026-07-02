import { prisma } from "@/lib/db/prisma";
import {
  buildImportAuditMetadata,
  countNonBlankImportRows,
  countImportPreviewRows,
  createEmptyImportPreview,
  createImportResultCounts,
  firstImportHeaderIndex,
  groupImportOwnersByEmail,
  groupImportRecordsByName,
  isValidImportEmail,
  listDuplicateImportColumnMessages,
  listUnsupportedImportColumns,
  normalizeImportEmailKey,
  normalizeImportNameKey,
  parseImportCsvPreviewInput,
  recordImportCreateFailure,
  resolveImportOwnerId,
  type ImportFailedRow,
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
  ownerEmail: string;
  ownerId: string | null;
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
  failedRows: ImportFailedRow[];
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
  "organizationname",
  "owneremail",
  "owner email"
]);
const contactImportMessages = {
  missingName: "Contact name is required.",
  unsupportedColumns: "Unsupported columns will be ignored.",
  invalidEmail: "Contact email must be a valid email address.",
  duplicateExistingEmail: "Duplicate contact email in this workspace.",
  duplicateImportEmail: "Duplicate contact email in this CSV.",
  organizationNotFound: "Organization name was not found in this workspace.",
  organizationAmbiguous: "Organization name matches multiple organizations in this workspace."
} as const;

export async function previewContactImport(actor: WorkspaceActor, csvText: unknown): Promise<ContactImportPreview> {
  await ensureWorkspaceAccess(actor);

  const input = parseImportCsvPreviewInput(csvText);
  if ("parseErrors" in input) return createEmptyImportPreview<ContactImportPreviewRow>(input.parseErrors);
  const { parsed, headers } = input;
  const nameIndex = firstImportHeaderIndex(headers, ["name", "contact name", "full name"]);
  const firstNameIndex = firstImportHeaderIndex(headers, ["first name", "firstname"]);
  const lastNameIndex = firstImportHeaderIndex(headers, ["last name", "lastname"]);
  const emailIndex = firstImportHeaderIndex(headers, ["email"]);
  const phoneIndex = firstImportHeaderIndex(headers, ["phone"]);
  const organizationNameIndex = firstImportHeaderIndex(headers, ["organization", "organization name", "organizationname"]);
  const ownerEmailIndex = firstImportHeaderIndex(headers, ["owneremail", "owner email"]);
  const unsupportedColumns = listUnsupportedImportColumns(parsed.headers, headers, supportedContactColumns);
  const duplicateColumnErrors = listDuplicateImportColumnMessages(headers, [
    { label: "contact name", candidates: ["name", "contact name", "full name"] },
    { label: "first name", candidates: ["first name", "firstname"] },
    { label: "last name", candidates: ["last name", "lastname"] },
    { label: "email", candidates: ["email"] },
    { label: "phone", candidates: ["phone"] },
    { label: "organization name", candidates: ["organization", "organization name", "organizationname"] },
    { label: "owner email", candidates: ["owneremail", "owner email"] }
  ]);

  const headerErrors = [...duplicateColumnErrors];
  if (nameIndex === -1 && firstNameIndex === -1) headerErrors.push("CSV must include a contact name or firstName column.");
  if (headerErrors.length > 0) {
    return {
      ...createEmptyImportPreview<ContactImportPreviewRow>(headerErrors),
      totalRows: countNonBlankImportRows(parsed.rows),
      unsupportedColumns
    };
  }

  const [existingContacts, organizations, owners] = await Promise.all([
    prisma.person.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere, email: { not: null } },
      select: { email: true }
    }),
    prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    }),
    prisma.user.findMany({
      where: { deletedAt: null, memberships: { some: { workspaceId: actor.workspaceId } } },
      select: { id: true, email: true },
      orderBy: [{ email: "asc" }, { id: "asc" }]
    })
  ]);
  const existingEmails = new Set(existingContacts.map((contact) => normalizeImportEmailKey(contact.email)).filter(Boolean));
  const organizationsByName = groupImportRecordsByName(organizations);
  const ownersByEmail = groupImportOwnersByEmail(owners);
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
      const ownerEmail = ownerEmailIndex === -1 ? "" : (row[ownerEmailIndex] ?? "").trim();
      const normalizedEmail = normalizeImportEmailKey(email);
      const normalizedOrganizationName = normalizeImportNameKey(organizationName);
      const organizationMatches = normalizedOrganizationName ? organizationsByName.get(normalizedOrganizationName) ?? [] : [];
      const ownerResolution = resolveImportOwnerId(ownersByEmail, ownerEmail);
      const errors: string[] = [];
      const warnings: string[] = [];
      const skipReasons: string[] = [];

      if (!parsedName.firstName) {
        errors.push(contactImportMessages.missingName);
        skipReasons.push(contactImportMessages.missingName);
      }
      const validEmail = !email || isValidImportEmail(email);
      if (!validEmail) {
        errors.push(contactImportMessages.invalidEmail);
        skipReasons.push(contactImportMessages.invalidEmail);
      }
      if (unsupportedColumns.length > 0) warnings.push(contactImportMessages.unsupportedColumns);

      if (normalizedOrganizationName && organizationMatches.length === 0) {
        errors.push(contactImportMessages.organizationNotFound);
        skipReasons.push(contactImportMessages.organizationNotFound);
      }
      if (organizationMatches.length > 1) {
        errors.push(contactImportMessages.organizationAmbiguous);
        skipReasons.push(contactImportMessages.organizationAmbiguous);
      }
      if (ownerResolution.error) {
        errors.push(ownerResolution.error);
        skipReasons.push(ownerResolution.error);
      }
      const duplicatesExistingEmail =
        errors.length === 0 && validEmail && normalizedEmail ? existingEmails.has(normalizedEmail) : false;
      const duplicatesImportEmail =
        errors.length === 0 && validEmail && normalizedEmail && !duplicatesExistingEmail
          ? seenImportEmails.has(normalizedEmail)
          : false;
      if (errors.length === 0 && validEmail && normalizedEmail && !duplicatesExistingEmail && !duplicatesImportEmail) {
        seenImportEmails.add(normalizedEmail);
      }

      if (duplicatesExistingEmail) {
        warnings.push(contactImportMessages.duplicateExistingEmail);
        skipReasons.push(contactImportMessages.duplicateExistingEmail);
      }
      if (duplicatesImportEmail) {
        warnings.push(contactImportMessages.duplicateImportEmail);
        skipReasons.push(contactImportMessages.duplicateImportEmail);
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
        ownerEmail,
        ownerId: ownerResolution.ownerId,
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

export async function importContactsFromCsv(actor: WorkspaceActor, csvText: unknown): Promise<ContactImportResult> {
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
          organizationId: row.organizationId,
          ownerId: row.ownerId
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
      recordImportCreateFailure(result, row.rowNumber);
    }
  }

  return result;
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
