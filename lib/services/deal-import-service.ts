import type { DealStatus } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { dealValueCentsMax } from "@/lib/product-limits";
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

export type DealImportPreviewRow = {
  rowNumber: number;
  title: string;
  pipelineName: string;
  pipelineId: string | null;
  stageName: string;
  stageId: string | null;
  statusValue: DealStatus;
  value: string;
  valueCents: number | null;
  currency: string;
  expectedCloseAt: Date | null;
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

export type DealImportPreview = {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  unsupportedColumns: string[];
  parseErrors: string[];
  rows: DealImportPreviewRow[];
};

export type DealImportResult = {
  preview: DealImportPreview;
  createdCount: number;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
  errorCount: number;
  failedRows: ImportFailedRow[];
  createdDeals: Array<{ id: string; title: string; status: DealStatus }>;
};

type PersonImportRecord = ImportPersonRecord;

const supportedDealColumns = new Set([
  "title",
  "deal title",
  "name",
  "pipeline",
  "pipelinename",
  "pipeline name",
  "stage",
  "stagename",
  "stage name",
  "status",
  "value",
  "currency",
  "expectedcloseat",
  "expected close at",
  "contactemail",
  "contact email",
  "contactname",
  "contact name",
  "organization",
  "organizationname",
  "organization name",
  "owneremail",
  "owner email"
]);
const supportedDealStatuses = new Set<DealStatus>(["OPEN", "WON", "LOST"]);
const dealImportMessages = {
  missingTitle: "Deal title is required.",
  missingPipeline: "Pipeline is required.",
  missingStage: "Stage is required.",
  unsupportedColumns: "Unsupported columns are ignored and not imported.",
  pipelineNotFound: "Pipeline must already exist in this workspace; no default pipeline is inferred.",
  pipelineAmbiguous: "Pipeline name matches multiple pipelines in this workspace.",
  stageNotFound: "Stage must already exist in the resolved pipeline; stages from other pipelines are not used.",
  stageAmbiguous: "Stage name matches multiple stages in the resolved pipeline.",
  contactNotFound: "Contact must already exist in this workspace; contacts are not auto-created.",
  contactAmbiguous: "Contact reference matches multiple contacts in this workspace.",
  invalidContactEmail: "Contact email must be a valid email address.",
  organizationNotFound: "Organization must already exist in this workspace; organizations are not auto-created.",
  organizationAmbiguous: "Organization name matches multiple organizations in this workspace.",
  invalidStatus: "Deal status must be OPEN, WON, or LOST.",
  invalidValue: "Deal value must be a non-negative amount with at most two decimal places and fit current storage limits.",
  invalidCurrency: "Currency must be a 3-letter code.",
  invalidExpectedCloseAt: "Expected close date must be a valid ISO datetime or YYYY-MM-DD date.",
  closedStatusCaveat:
    "Imported WON/LOST status does not set wonAt/lostAt or lost reason; Goals v1 progress excludes imported won deals until closed in-app.",
  duplicateExistingDeal:
    "Duplicate skipped: a deal with the same title, pipeline, stage, contact, and organization already exists in this workspace.",
  duplicateImportDeal:
    "Duplicate skipped: another CSV row has the same title, pipeline, stage, contact, and organization."
} as const;

export async function previewDealImport(actor: WorkspaceActor, csvText: unknown): Promise<DealImportPreview> {
  await ensureWorkspaceAccess(actor);

  const input = parseImportCsvPreviewInput(csvText);
  if ("parseErrors" in input) return createEmptyImportPreview<DealImportPreviewRow>(input.parseErrors);
  const { parsed, headers } = input;
  const titleIndex = firstImportHeaderIndex(headers, ["title", "deal title", "name"]);
  const pipelineIndex = firstImportHeaderIndex(headers, ["pipeline", "pipelinename", "pipeline name"]);
  const stageIndex = firstImportHeaderIndex(headers, ["stage", "stagename", "stage name"]);
  const statusIndex = firstImportHeaderIndex(headers, ["status"]);
  const valueIndex = firstImportHeaderIndex(headers, ["value"]);
  const currencyIndex = firstImportHeaderIndex(headers, ["currency"]);
  const expectedCloseAtIndex = firstImportHeaderIndex(headers, ["expectedcloseat", "expected close at"]);
  const contactEmailIndex = firstImportHeaderIndex(headers, ["contactemail", "contact email"]);
  const contactNameIndex = firstImportHeaderIndex(headers, ["contactname", "contact name"]);
  const organizationNameIndex = firstImportHeaderIndex(headers, ["organization", "organizationname", "organization name"]);
  const ownerEmailIndex = firstImportHeaderIndex(headers, ["owneremail", "owner email"]);
  const unsupportedColumns = listUnsupportedImportColumns(parsed.headers, headers, supportedDealColumns);
  const duplicateColumnErrors = listDuplicateImportColumnMessages(headers, [
    { label: "deal title", candidates: ["title", "deal title", "name"] },
    { label: "pipeline", candidates: ["pipeline", "pipelinename", "pipeline name"] },
    { label: "stage", candidates: ["stage", "stagename", "stage name"] },
    { label: "status", candidates: ["status"] },
    { label: "value", candidates: ["value"] },
    { label: "currency", candidates: ["currency"] },
    { label: "expected close date", candidates: ["expectedcloseat", "expected close at"] },
    { label: "contact email", candidates: ["contactemail", "contact email"] },
    { label: "contact name", candidates: ["contactname", "contact name"] },
    { label: "organization name", candidates: ["organization", "organizationname", "organization name"] },
    { label: "owner email", candidates: ["owneremail", "owner email"] }
  ]);

  const headerErrors = [...duplicateColumnErrors];
  if (titleIndex === -1) headerErrors.push("CSV must include a deal title, title, or name column.");
  if (pipelineIndex === -1) headerErrors.push("CSV must include a pipeline, pipelineName, or pipeline name column.");
  if (stageIndex === -1) headerErrors.push("CSV must include a stage, stageName, or stage name column.");
  if (headerErrors.length > 0) {
    return {
      ...createEmptyImportPreview<DealImportPreviewRow>(headerErrors),
      totalRows: countNonBlankImportRows(parsed.rows),
      unsupportedColumns
    };
  }

  const [pipelines, organizations, people, owners, existingDeals] = await Promise.all([
    prisma.pipeline.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      include: { stages: { where: { workspaceId: actor.workspaceId, ...activeWhere }, orderBy: [{ name: "asc" }, { id: "asc" }] } },
      orderBy: [{ name: "asc" }, { id: "asc" }]
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
    }),
    prisma.deal.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { title: true, pipelineId: true, stageId: true, personId: true, organizationId: true }
    })
  ]);
  const pipelinesByName = groupImportRecordsByName(pipelines);
  const organizationsByName = groupImportRecordsByName(organizations);
  const peopleByEmail = groupImportPeopleByEmail(people);
  const peopleByName = groupImportPeopleByDisplayName(people);
  const ownersByEmail = groupImportOwnersByEmail(owners);
  const existingDealKeys = new Set(
    existingDeals.map((deal) =>
      dealDuplicateKey(deal.title, deal.pipelineId, deal.stageId, deal.personId ?? null, deal.organizationId ?? null)
    )
  );
  const seenImportDealKeys = new Set<string>();

  const rows = parsed.rows
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(({ row }) => row.some((cell) => cell.trim()))
    .map(({ row, rowNumber }): DealImportPreviewRow => {
      const title = (row[titleIndex] ?? "").trim();
      const pipelineName = (row[pipelineIndex] ?? "").trim();
      const stageName = (row[stageIndex] ?? "").trim();
      const rawStatus = statusIndex === -1 ? "" : (row[statusIndex] ?? "").trim();
      const statusValue = rawStatus ? rawStatus.toUpperCase() : "OPEN";
      const value = valueIndex === -1 ? "" : (row[valueIndex] ?? "").trim();
      const currency = (currencyIndex === -1 ? "" : (row[currencyIndex] ?? "").trim()).toUpperCase() || "USD";
      const rawExpectedCloseAt = expectedCloseAtIndex === -1 ? "" : (row[expectedCloseAtIndex] ?? "").trim();
      const contactEmail = contactEmailIndex === -1 ? "" : (row[contactEmailIndex] ?? "").trim();
      const contactName = contactNameIndex === -1 ? "" : (row[contactNameIndex] ?? "").trim();
      const organizationName = organizationNameIndex === -1 ? "" : (row[organizationNameIndex] ?? "").trim();
      const ownerEmail = ownerEmailIndex === -1 ? "" : (row[ownerEmailIndex] ?? "").trim();
      const errors: string[] = [];
      const warnings: string[] = [];
      const skipReasons: string[] = [];

      if (!title) addIssue(errors, skipReasons, dealImportMessages.missingTitle);
      if (!pipelineName) addIssue(errors, skipReasons, dealImportMessages.missingPipeline);
      if (!stageName) addIssue(errors, skipReasons, dealImportMessages.missingStage);
      if (unsupportedColumns.length > 0) warnings.push(dealImportMessages.unsupportedColumns);

      const pipelineMatches = pipelineName ? pipelinesByName.get(normalizeImportNameKey(pipelineName)) ?? [] : [];
      if (pipelineName && pipelineMatches.length === 0) addIssue(errors, skipReasons, dealImportMessages.pipelineNotFound);
      if (pipelineMatches.length > 1) addIssue(errors, skipReasons, dealImportMessages.pipelineAmbiguous);
      const pipeline = pipelineMatches.length === 1 ? pipelineMatches[0] : null;

      const stageMatches = pipeline && stageName ? pipeline.stages.filter((stage) => normalizeImportNameKey(stage.name) === normalizeImportNameKey(stageName)) : [];
      if (pipeline && stageName && stageMatches.length === 0) addIssue(errors, skipReasons, dealImportMessages.stageNotFound);
      if (stageMatches.length > 1) addIssue(errors, skipReasons, dealImportMessages.stageAmbiguous);
      const stage = stageMatches.length === 1 ? stageMatches[0] : null;

      const validContactEmail = !contactEmail || isValidImportEmail(contactEmail);
      if (!validContactEmail) addIssue(errors, skipReasons, dealImportMessages.invalidContactEmail);
      const ownerResolution = resolveImportOwnerId(ownersByEmail, ownerEmail);
      if (ownerResolution.error) addIssue(errors, skipReasons, ownerResolution.error);

      const personResolution = validContactEmail
        ? resolvePersonReference(peopleByEmail, peopleByName, contactEmail, contactName)
        : { personId: null, error: null };
      if (personResolution.error) addIssue(errors, skipReasons, personResolution.error);

      const organizationMatches = organizationName ? organizationsByName.get(normalizeImportNameKey(organizationName)) ?? [] : [];
      if (organizationName && organizationMatches.length === 0) addIssue(errors, skipReasons, dealImportMessages.organizationNotFound);
      if (organizationMatches.length > 1) addIssue(errors, skipReasons, dealImportMessages.organizationAmbiguous);
      const organizationId = organizationMatches.length === 1 ? organizationMatches[0].id : null;

      if (!supportedDealStatuses.has(statusValue as DealStatus)) addIssue(errors, skipReasons, dealImportMessages.invalidStatus);
      if (statusValue === "WON" || statusValue === "LOST") warnings.push(dealImportMessages.closedStatusCaveat);
      const valueCents = parseImportValueCents(value);
      if (valueCents === undefined) addIssue(errors, skipReasons, dealImportMessages.invalidValue);
      if (!/^[A-Z]{3}$/.test(currency)) addIssue(errors, skipReasons, dealImportMessages.invalidCurrency);
      const expectedCloseAt = parseImportDate(rawExpectedCloseAt);
      if (expectedCloseAt === undefined) addIssue(errors, skipReasons, dealImportMessages.invalidExpectedCloseAt);

      const duplicateKey =
        title && pipeline && stage
          ? dealDuplicateKey(title, pipeline.id, stage.id, personResolution.personId, organizationId)
          : null;
      const duplicatesExisting = errors.length === 0 && duplicateKey ? existingDealKeys.has(duplicateKey) : false;
      const duplicatesImport = errors.length === 0 && duplicateKey ? seenImportDealKeys.has(duplicateKey) : false;
      if (errors.length === 0 && duplicateKey && !duplicatesExisting && !duplicatesImport) {
        seenImportDealKeys.add(duplicateKey);
      }

      if (duplicatesExisting) {
        warnings.push(dealImportMessages.duplicateExistingDeal);
        skipReasons.push(dealImportMessages.duplicateExistingDeal);
      }
      if (duplicatesImport) {
        warnings.push(dealImportMessages.duplicateImportDeal);
        skipReasons.push(dealImportMessages.duplicateImportDeal);
      }

      return {
        rowNumber,
        title,
        pipelineName,
        pipelineId: pipeline?.id ?? null,
        stageName,
        stageId: stage?.id ?? null,
        statusValue: supportedDealStatuses.has(statusValue as DealStatus) ? (statusValue as DealStatus) : "OPEN",
        value,
        valueCents: valueCents ?? null,
        currency,
        expectedCloseAt: expectedCloseAt ?? null,
        contactEmail,
        contactName,
        personId: personResolution.personId,
        organizationName,
        organizationId,
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

export async function importDealsFromCsv(actor: WorkspaceActor, csvText: unknown): Promise<DealImportResult> {
  const preview = await previewDealImport(actor, csvText);
  const result: DealImportResult = {
    preview,
    ...createImportResultCounts(preview),
    createdDeals: []
  };

  if (preview.parseErrors.length > 0) return result;

  for (const row of preview.rows) {
    if (row.status !== "valid") continue;
    if (!row.pipelineId || !row.stageId) {
      recordImportCreateFailure(result, row.rowNumber);
      continue;
    }

    try {
      const deal = await prisma.deal.create({
        data: {
          workspaceId: actor.workspaceId,
          pipelineId: row.pipelineId,
          stageId: row.stageId,
          ownerId: row.ownerId,
          personId: row.personId,
          organizationId: row.organizationId,
          title: row.title,
          valueCents: row.valueCents,
          currency: row.currency,
          status: row.statusValue,
          expectedCloseAt: row.expectedCloseAt
        },
        select: { id: true, title: true, status: true }
      });
      await writeAuditLog(
        actor,
        "deal.imported",
        "Deal",
        deal.id,
        buildImportAuditMetadata("deal", deal.title, {
          title: deal.title,
          status: deal.status,
          pipelineId: row.pipelineId,
          stageId: row.stageId,
          personId: row.personId,
          organizationId: row.organizationId
        })
      );
      result.createdDeals.push(deal);
      result.createdCount += 1;
    } catch {
      recordImportCreateFailure(result, row.rowNumber);
    }
  }

  return result;
}

function addIssue(errors: string[], skipReasons: string[], message: string) {
  errors.push(message);
  skipReasons.push(message);
}

function resolvePersonReference(
  peopleByEmail: Map<string, PersonImportRecord[]>,
  peopleByName: Map<string, PersonImportRecord[]>,
  contactEmail: string,
  contactName: string
) {
  return resolveImportPersonReference(peopleByEmail, peopleByName, contactEmail, contactName, {
    ambiguous: dealImportMessages.contactAmbiguous,
    notFound: dealImportMessages.contactNotFound
  });
}

function parseImportValueCents(value: string) {
  if (!value) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return undefined;

  const [dollars, cents = ""] = value.split(".");
  const amountCents = Number(dollars) * 100 + Number(cents.padEnd(2, "0"));
  if (!Number.isSafeInteger(amountCents)) return undefined;
  if (amountCents > dealValueCentsMax) return undefined;
  return amountCents;
}

function parseImportDate(value: string) {
  if (!value) return null;
  const calendarDate = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (calendarDate && !isValidCalendarDate(calendarDate)) return undefined;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function isValidCalendarDate(match: RegExpMatchArray) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dealDuplicateKey(
  title: string,
  pipelineId: string,
  stageId: string,
  personId: string | null,
  organizationId: string | null
) {
  return [
    normalizeImportNameKey(title),
    pipelineId,
    stageId,
    personId ?? "null",
    organizationId ?? "null"
  ].join(":");
}
