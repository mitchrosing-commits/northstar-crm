import { prisma } from "@/lib/db/prisma";
import {
  buildImportAuditMetadata,
  countNonBlankImportRows,
  countImportPreviewRows,
  createEmptyImportPreview,
  createImportResultCounts,
  firstImportHeaderIndex,
  groupImportOwnersByEmail,
  groupImportPeopleByDisplayName,
  groupImportPeopleByEmail,
  groupImportRecordsByName,
  isValidImportEmail,
  listDuplicateImportColumnMessages,
  listUnsupportedImportColumns,
  normalizeImportEmailKey,
  normalizeImportNameKey,
  parseImportCsvPreviewInput,
  recordImportCreateFailure,
  resolveImportOwnerId,
  resolveImportPersonReference,
  type ImportFailedRow,
  type ImportPersonRecord,
  type ImportPreviewStatus
} from "./import-utils";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

export type LeadImportPreviewRow = {
  rowNumber: number;
  title: string;
  source: string;
  statusValue: string;
  contactEmail: string;
  contactName: string;
  personId: string | null;
  organizationName: string;
  organizationId: string | null;
  ownerEmail: string;
  ownerId: string | null;
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
  failedRows: ImportFailedRow[];
  createdLeads: Array<{ id: string; title: string; status: string }>;
};

type PersonImportRecord = ImportPersonRecord;

const supportedLeadColumns = new Set([
  "title",
  "lead title",
  "name",
  "lead name",
  "source",
  "status",
  "contactemail",
  "contact email",
  "contactname",
  "contact name",
  "organization",
  "organization name",
  "organizationname",
  "owneremail",
  "owner email"
]);
const supportedLeadStatuses = new Set(["NEW", "QUALIFIED", "DISQUALIFIED"]);
const leadImportMessages = {
  missingTitle: "Lead title is required.",
  unsupportedColumns: "Unsupported columns will be ignored.",
  duplicateExistingTitle: "Duplicate lead title in this workspace.",
  duplicateImportTitle: "Duplicate lead title in this CSV.",
  invalidStatus: "Lead status must be NEW, QUALIFIED, or DISQUALIFIED.",
  convertedStatus: "Converted leads cannot be imported through CSV.",
  contactNotFound: "Contact must already exist in this workspace; contacts are not auto-created.",
  contactAmbiguous: "Contact reference matches multiple contacts in this workspace.",
  invalidContactEmail: "Contact email must be a valid email address.",
  organizationNotFound: "Organization name was not found in this workspace.",
  organizationAmbiguous: "Organization name matches multiple organizations in this workspace."
} as const;

export async function previewLeadImport(actor: WorkspaceActor, csvText: unknown): Promise<LeadImportPreview> {
  await ensureWorkspaceAccess(actor);

  const input = parseImportCsvPreviewInput(csvText);
  if ("parseErrors" in input) return createEmptyImportPreview<LeadImportPreviewRow>(input.parseErrors);
  const { parsed, headers } = input;
  const titleIndex = firstImportHeaderIndex(headers, ["title", "lead title", "name", "lead name"]);
  const sourceIndex = firstImportHeaderIndex(headers, ["source"]);
  const statusIndex = firstImportHeaderIndex(headers, ["status"]);
  const contactEmailIndex = firstImportHeaderIndex(headers, ["contactemail", "contact email"]);
  const contactNameIndex = firstImportHeaderIndex(headers, ["contactname", "contact name"]);
  const organizationNameIndex = firstImportHeaderIndex(headers, ["organization", "organization name", "organizationname"]);
  const ownerEmailIndex = firstImportHeaderIndex(headers, ["owneremail", "owner email"]);
  const unsupportedColumns = listUnsupportedImportColumns(parsed.headers, headers, supportedLeadColumns);
  const duplicateColumnErrors = listDuplicateImportColumnMessages(headers, [
    { label: "lead title", candidates: ["title", "lead title", "name", "lead name"] },
    { label: "source", candidates: ["source"] },
    { label: "status", candidates: ["status"] },
    { label: "contact email", candidates: ["contactemail", "contact email"] },
    { label: "contact name", candidates: ["contactname", "contact name"] },
    { label: "organization name", candidates: ["organization", "organization name", "organizationname"] },
    { label: "owner email", candidates: ["owneremail", "owner email"] }
  ]);

  const headerErrors = [...duplicateColumnErrors];
  if (titleIndex === -1) headerErrors.push("CSV must include a lead title or name column.");
  if (headerErrors.length > 0) {
    return {
      ...createEmptyImportPreview<LeadImportPreviewRow>(headerErrors),
      totalRows: countNonBlankImportRows(parsed.rows),
      unsupportedColumns
    };
  }

  const [existingLeads, organizations, people, owners] = await Promise.all([
    prisma.lead.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { title: true }
    }),
    prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }]
    }),
    prisma.person.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }]
    }),
    prisma.user.findMany({
      where: { deletedAt: null, memberships: { some: { workspaceId: actor.workspaceId } } },
      select: { id: true, email: true },
      orderBy: [{ email: "asc" }, { id: "asc" }]
    })
  ]);
  const existingTitles = new Set(existingLeads.map((lead) => normalizeImportNameKey(lead.title)));
  const organizationsByName = groupImportRecordsByName(organizations);
  const peopleByEmail = groupImportPeopleByEmail(people);
  const peopleByName = groupImportPeopleByDisplayName(people);
  const ownersByEmail = groupImportOwnersByEmail(owners);
  const seenImportTitles = new Set<string>();

  const rows = parsed.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim()))
    .map(({ row, rowNumber }): LeadImportPreviewRow => {
      const title = (row[titleIndex] ?? "").trim();
      const source = sourceIndex === -1 ? "" : (row[sourceIndex] ?? "").trim();
      const rawStatus = statusIndex === -1 ? "" : (row[statusIndex] ?? "").trim();
      const statusValue = rawStatus ? rawStatus.toUpperCase() : "NEW";
      const contactEmail = contactEmailIndex === -1 ? "" : (row[contactEmailIndex] ?? "").trim();
      const contactName = contactNameIndex === -1 ? "" : (row[contactNameIndex] ?? "").trim();
      const organizationName = organizationNameIndex === -1 ? "" : (row[organizationNameIndex] ?? "").trim();
      const ownerEmail = ownerEmailIndex === -1 ? "" : (row[ownerEmailIndex] ?? "").trim();
      const normalizedTitle = normalizeImportNameKey(title);
      const normalizedOrganizationName = normalizeImportNameKey(organizationName);
      const organizationMatches = normalizedOrganizationName ? organizationsByName.get(normalizedOrganizationName) ?? [] : [];
      const validContactEmail = !contactEmail || isValidImportEmail(contactEmail);
      const personResolution = validContactEmail
        ? resolvePersonReference(peopleByEmail, peopleByName, contactEmail, contactName)
        : { personId: null, error: leadImportMessages.invalidContactEmail };
      const ownerResolution = resolveImportOwnerId(ownersByEmail, ownerEmail);
      const errors: string[] = [];
      const warnings: string[] = [];
      const skipReasons: string[] = [];

      if (!title) {
        errors.push(leadImportMessages.missingTitle);
        skipReasons.push(leadImportMessages.missingTitle);
      }
      if (unsupportedColumns.length > 0) warnings.push(leadImportMessages.unsupportedColumns);

      if (statusValue === "CONVERTED") {
        errors.push(leadImportMessages.convertedStatus);
        skipReasons.push(leadImportMessages.convertedStatus);
      } else if (!supportedLeadStatuses.has(statusValue)) {
        errors.push(leadImportMessages.invalidStatus);
        skipReasons.push(leadImportMessages.invalidStatus);
      }
      if (personResolution.error) {
        errors.push(personResolution.error);
        skipReasons.push(personResolution.error);
      }

      if (normalizedOrganizationName && organizationMatches.length === 0) {
        errors.push(leadImportMessages.organizationNotFound);
        skipReasons.push(leadImportMessages.organizationNotFound);
      }
      if (organizationMatches.length > 1) {
        errors.push(leadImportMessages.organizationAmbiguous);
        skipReasons.push(leadImportMessages.organizationAmbiguous);
      }
      if (ownerResolution.error) {
        errors.push(ownerResolution.error);
        skipReasons.push(ownerResolution.error);
      }
      const duplicatesExistingTitle = errors.length === 0 && normalizedTitle ? existingTitles.has(normalizedTitle) : false;
      const duplicatesImportTitle =
        errors.length === 0 && normalizedTitle && !duplicatesExistingTitle ? seenImportTitles.has(normalizedTitle) : false;
      if (errors.length === 0 && normalizedTitle && !duplicatesExistingTitle && !duplicatesImportTitle) {
        seenImportTitles.add(normalizedTitle);
      }

      if (duplicatesExistingTitle) {
        warnings.push(leadImportMessages.duplicateExistingTitle);
        skipReasons.push(leadImportMessages.duplicateExistingTitle);
      }
      if (duplicatesImportTitle) {
        warnings.push(leadImportMessages.duplicateImportTitle);
        skipReasons.push(leadImportMessages.duplicateImportTitle);
      }

      return {
        rowNumber,
        title,
        source,
        statusValue,
        contactEmail,
        contactName,
        personId: personResolution.personId,
        organizationName,
        organizationId: organizationMatches.length === 1 ? organizationMatches[0].id : null,
        ownerEmail,
        ownerId: ownerResolution.ownerId,
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

export async function importLeadsFromCsv(actor: WorkspaceActor, csvText: unknown): Promise<LeadImportResult> {
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
          personId: row.personId,
          organizationId: row.organizationId,
          ownerId: row.ownerId
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
      recordImportCreateFailure(result, row.rowNumber);
    }
  }

  return result;
}

function resolvePersonReference(
  peopleByEmail: Map<string, PersonImportRecord[]>,
  peopleByName: Map<string, PersonImportRecord[]>,
  contactEmail: string,
  contactName: string
) {
  return resolveImportPersonReference(peopleByEmail, peopleByName, contactEmail, contactName, {
    ambiguous: leadImportMessages.contactAmbiguous,
    notFound: leadImportMessages.contactNotFound
  });
}
