import { Prisma, type EmailConnectionProvider, type EmailDirection } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { assertEmailLogLinks, assertRecordInWorkspace, emailLogAttachmentRelationsWhere } from "./record-guards";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export type EmailLogRecordType = "DEAL" | "LEAD" | "PERSON" | "ORGANIZATION";
export type EmailCrmLinkRecordType = "DEAL" | "LEAD" | "PERSON" | "ORGANIZATION";
export type EmailCrmLinkSuggestionConfidence = "high" | "medium";
export type EmailCrmLinkSuggestionSource =
  | "exact_email"
  | "organization_domain"
  | "participant_association"
  | "thread_context";

export type EmailCrmLinkSuggestion = {
  confidence: EmailCrmLinkSuggestionConfidence;
  evidence: string;
  href: string;
  id: string;
  label: string;
  recordId: string;
  source: EmailCrmLinkSuggestionSource;
  type: EmailCrmLinkRecordType;
  why: string;
};

export type EmailCrmLinkSuggestionResult = {
  alternativeSuggestions: EmailCrmLinkSuggestion[];
  alreadyLinked: boolean;
  emailLogId: string;
  noReliableMatchReason: string | null;
  primarySuggestion: EmailCrmLinkSuggestion | null;
};

export const emailCrmLinkReviewFilters = [
  { id: "all", label: "All unlinked" },
  { id: "suggested", label: "Ready to link" },
  { id: "ambiguous", label: "Needs decision" },
  { id: "no-match", label: "No match" }
] as const;

export type EmailCrmLinkReviewFilterId = (typeof emailCrmLinkReviewFilters)[number]["id"];
export type EmailCrmLinkReviewState = "ambiguous" | "linked" | "no_match" | "ready";

export type EmailCrmLinkReviewItem = {
  alternativeSuggestions: EmailCrmLinkSuggestion[];
  emailLog: EmailCrmLinkSuggestionEmailLog;
  highConfidenceSuggestionCount: number;
  primarySuggestion: EmailCrmLinkSuggestion | null;
  state: EmailCrmLinkReviewState;
  stateLabel: string;
};

export type EmailCrmLinkReviewSummaryItem = {
  count: number;
  highConfidenceCount: number;
  id: EmailCrmLinkReviewFilterId;
  label: string;
};

type EmailCrmLinkSuggestionEmailLog = {
  ccText?: string | null;
  dealId: string | null;
  direction: EmailDirection | "INBOUND" | "OUTBOUND";
  emailConnectionId?: string | null;
  fromText: string | null;
  id: string;
  leadId: string | null;
  occurredAt?: Date | string;
  organizationId: string | null;
  personId: string | null;
  provider?: EmailConnectionProvider | null;
  providerThreadId?: string | null;
  subject: string;
  toText: string | null;
};

const emailLogInclude = {
  createdBy: { select: userDisplaySelect },
  deal: true,
  emailConnection: true,
  lead: true,
  person: true,
  organization: true
} satisfies Prisma.EmailLogInclude;

const defaultEmailLogListLimit = 25;
const maxEmailLogListLimit = 100;

export async function listEmailLogs(actor: WorkspaceActor, options: { limit?: number } = {}) {
  await ensureWorkspaceAccess(actor);
  const take = normalizeEmailLogListLimit(options.limit ?? defaultEmailLogListLimit);
  return prisma.emailLog.findMany({
    where: { workspaceId: actor.workspaceId, ...emailLogAttachmentRelationsWhere(actor.workspaceId) },
    include: emailLogInclude,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take
  });
}

export async function listEmailLogsForRecord(
  actor: WorkspaceActor,
  record: { type: EmailLogRecordType; id: string }
) {
  await ensureWorkspaceAccess(actor);
  const recordType = normalizeEmailLogRecordType(record.type);
  await assertRecordInWorkspace(recordModel(recordType), actor.workspaceId, record.id);

  return prisma.emailLog.findMany({
    where: {
      workspaceId: actor.workspaceId,
      ...emailLogAttachmentRelationsWhere(actor.workspaceId),
      [attachmentField(recordType)]: record.id
    },
    include: emailLogInclude,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function listEmailCrmLinkSuggestions(
  actor: WorkspaceActor,
  emailLogs: EmailCrmLinkSuggestionEmailLog[]
): Promise<Map<string, EmailCrmLinkSuggestionResult>> {
  await ensureWorkspaceAccess(actor);
  const unlinkedEmailLogs = emailLogs.filter((emailLog) => !emailLogHasCrmLink(emailLog));
  const results = new Map<string, EmailCrmLinkSuggestionResult>(
    emailLogs.map((emailLog) => [
      emailLog.id,
      {
        alternativeSuggestions: [],
        alreadyLinked: emailLogHasCrmLink(emailLog),
        emailLogId: emailLog.id,
        noReliableMatchReason: emailLogHasCrmLink(emailLog) ? null : "No reliable CRM match found.",
        primarySuggestion: null
      }
    ])
  );

  if (unlinkedEmailLogs.length === 0) return results;

  const participantEmailsByLogId = new Map<string, string[]>();
  const participantDomainsByLogId = new Map<string, string[]>();
  const allParticipantEmails = new Set<string>();
  const allParticipantDomains = new Set<string>();

  for (const emailLog of unlinkedEmailLogs) {
    const participantEmails = extractEmailLogParticipantEmails(emailLog);
    const participantDomains = participantEmails.map(emailDomain).filter((domain): domain is string => Boolean(domain));
    participantEmailsByLogId.set(emailLog.id, participantEmails);
    participantDomainsByLogId.set(emailLog.id, Array.from(new Set(participantDomains)));
    participantEmails.forEach((email) => allParticipantEmails.add(email));
    participantDomains.forEach((domain) => allParticipantDomains.add(domain));
  }

  const people = allParticipantEmails.size
    ? await prisma.person.findMany({
        where: {
          workspaceId: actor.workspaceId,
          ...activeWhere,
          OR: Array.from(allParticipantEmails).map((email) => ({ email: { equals: email, mode: "insensitive" } }))
        },
        select: {
          deals: {
            where: { workspaceId: actor.workspaceId, status: "OPEN", ...activeWhere },
            orderBy: [{ updatedAt: "desc" }],
            select: { id: true, title: true },
            take: 5
          },
          email: true,
          firstName: true,
          id: true,
          lastName: true,
          leads: {
            where: { workspaceId: actor.workspaceId, status: { not: "CONVERTED" }, ...activeWhere },
            orderBy: [{ updatedAt: "desc" }],
            select: { id: true, title: true },
            take: 5
          },
          organization: { select: { domain: true, id: true, name: true } }
        }
      })
    : [];
  const peopleByEmail = new Map<string, typeof people>();
  for (const person of people) {
    const normalized = normalizeEmailAddress(person.email);
    if (!normalized) continue;
    peopleByEmail.set(normalized, [...(peopleByEmail.get(normalized) ?? []), person]);
  }

  const organizations = allParticipantDomains.size
    ? await prisma.organization.findMany({
        where: {
          workspaceId: actor.workspaceId,
          ...activeWhere,
          domain: { not: null }
        },
        select: { domain: true, id: true, name: true }
      })
    : [];
  const organizationsWithDomain = organizations.flatMap((organization) => {
    const normalizedDomain = normalizeDomain(organization.domain);
    return normalizedDomain ? [{ ...organization, normalizedDomain }] : [];
  });

  const threadLinkedRecords = await listThreadContextCrmLinkSuggestions(actor, unlinkedEmailLogs);

  for (const emailLog of unlinkedEmailLogs) {
    const candidates: RankedEmailCrmLinkSuggestion[] = [];
    const participantEmails = participantEmailsByLogId.get(emailLog.id) ?? [];
    const participantDomains = participantDomainsByLogId.get(emailLog.id) ?? [];

    for (const participantEmail of participantEmails) {
      const exactMatches = peopleByEmail.get(participantEmail) ?? [];
      for (const person of exactMatches) {
        candidates.push(
          rankedEmailCrmLinkSuggestion(
            {
              confidence: "high",
              evidence: participantEmail,
              href: `/contacts/${person.id}`,
              label: formatEmailCrmPersonName(person),
              recordId: person.id,
              source: "exact_email",
              type: "PERSON",
              why: "Exact participant email matched an existing contact."
            },
            100
          )
        );
        if (person.organization) {
          candidates.push(
            rankedEmailCrmLinkSuggestion(
              {
                confidence: "high",
                evidence: `${formatEmailCrmPersonName(person)} is associated with ${person.organization.name}.`,
                href: `/organizations/${person.organization.id}`,
                label: person.organization.name,
                recordId: person.organization.id,
                source: "participant_association",
                type: "ORGANIZATION",
                why: "Exact-matched contact is already associated with this organization."
              },
              91
            )
          );
        }
        for (const deal of person.deals) {
          candidates.push(
            rankedEmailCrmLinkSuggestion(
              {
                confidence: "high",
                evidence: `${formatEmailCrmPersonName(person)} is associated with this open deal.`,
                href: `/deals/${deal.id}`,
                label: deal.title,
                recordId: deal.id,
                source: "participant_association",
                type: "DEAL",
                why: "Exact-matched contact is already associated with this open deal."
              },
              92
            )
          );
        }
        for (const lead of person.leads) {
          candidates.push(
            rankedEmailCrmLinkSuggestion(
              {
                confidence: "high",
                evidence: `${formatEmailCrmPersonName(person)} is associated with this lead.`,
                href: `/leads/${lead.id}`,
                label: lead.title,
                recordId: lead.id,
                source: "participant_association",
                type: "LEAD",
                why: "Exact-matched contact is already associated with this active lead."
              },
              90
            )
          );
        }
      }
    }

    for (const participantDomain of participantDomains) {
      for (const organization of organizationsWithDomain) {
        if (!emailDomainMatchesOrganizationDomain(participantDomain, organization.normalizedDomain)) continue;
        candidates.push(
          rankedEmailCrmLinkSuggestion(
            {
              confidence: "medium",
              evidence: participantDomain,
              href: `/organizations/${organization.id}`,
              label: organization.name,
              recordId: organization.id,
              source: "organization_domain",
              type: "ORGANIZATION",
              why: "Participant email domain matches a confirmed organization domain in this workspace."
            },
            participantDomain === organization.normalizedDomain ? 86 : 82
          )
        );
      }
    }

    candidates.push(...(threadLinkedRecords.get(emailLog.id) ?? []));
    results.set(emailLog.id, emailCrmLinkSuggestionResult(emailLog.id, candidates));
  }

  return results;
}

export function normalizeEmailCrmLinkReviewFilter(value: unknown): EmailCrmLinkReviewFilterId {
  if (typeof value !== "string") return "all";
  return emailCrmLinkReviewFilters.some((filter) => filter.id === value) ? (value as EmailCrmLinkReviewFilterId) : "all";
}

export function buildEmailCrmLinkReviewQueue({
  emailLogs,
  filter = "all",
  suggestions
}: {
  emailLogs: EmailCrmLinkSuggestionEmailLog[];
  filter?: EmailCrmLinkReviewFilterId;
  suggestions: Map<string, EmailCrmLinkSuggestionResult>;
}) {
  const normalizedFilter = normalizeEmailCrmLinkReviewFilter(filter);
  return emailLogs
    .map((emailLog) => emailCrmLinkReviewItem(emailLog, suggestions.get(emailLog.id)))
    .filter((item): item is EmailCrmLinkReviewItem => Boolean(item))
    .filter((item) => emailCrmLinkReviewItemMatchesFilter(item, normalizedFilter))
    .sort(compareEmailCrmLinkReviewItems);
}

export function buildEmailCrmLinkReviewSummary({
  emailLogs,
  suggestions
}: {
  emailLogs: EmailCrmLinkSuggestionEmailLog[];
  suggestions: Map<string, EmailCrmLinkSuggestionResult>;
}) {
  const items = buildEmailCrmLinkReviewQueue({ emailLogs, suggestions });
  return emailCrmLinkReviewFilters.map((filter) => {
    const matchingItems = filter.id === "all" ? items : items.filter((item) => emailCrmLinkReviewItemMatchesFilter(item, filter.id));
    return {
      count: matchingItems.length,
      highConfidenceCount: matchingItems.reduce((sum, item) => sum + item.highConfidenceSuggestionCount, 0),
      id: filter.id,
      label: filter.label
    } satisfies EmailCrmLinkReviewSummaryItem;
  });
}

export async function linkEmailLogToCrmRecord(
  actor: WorkspaceActor,
  data: { emailLogId: unknown; recordId: unknown; recordType: unknown }
) {
  await ensureWorkspaceAccess(actor);
  const emailLogId = normalizeEmailAttachmentId(data.emailLogId);
  const recordId = normalizeEmailAttachmentId(data.recordId);
  const recordType = normalizeEmailLogRecordType(data.recordType);
  if (!emailLogId || !recordId) {
    throw new ApiError("VALIDATION_ERROR", "Choose an email log and CRM record to link.", 422);
  }

  const existingEmailLog = await prisma.emailLog.findFirst({
    where: { id: emailLogId, workspaceId: actor.workspaceId },
    include: emailLogInclude
  });
  if (!existingEmailLog) throw new ApiError("NOT_FOUND", "Email log was not found in this workspace.", 404);

  const field = attachmentField(recordType);
  if (existingEmailLog[field] === recordId) return existingEmailLog;
  if (emailLogHasCrmLink(existingEmailLog)) {
    throw new ApiError("EMAIL_LOG_ALREADY_LINKED", "This email is already linked to a CRM record.", 409);
  }

  await assertEmailLogLinks(actor.workspaceId, {
    dealId: recordType === "DEAL" ? recordId : null,
    leadId: recordType === "LEAD" ? recordId : null,
    organizationId: recordType === "ORGANIZATION" ? recordId : null,
    personId: recordType === "PERSON" ? recordId : null
  });

  const emailLog = await prisma.emailLog.update({
    where: { id: existingEmailLog.id },
    data: { [field]: recordId },
    include: emailLogInclude
  });

  await writeAuditLog(actor, "email_log.linked", "EmailLog", emailLog.id, {
    recordId,
    recordType,
    subject: emailLog.subject
  });

  return emailLog;
}

export async function createEmailLog(actor: WorkspaceActor, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeEmailLogInput(data);
  await assertEmailLogLinks(actor.workspaceId, normalized);

  const emailLog = await prisma.emailLog.create({
    data: {
      ...normalized,
      workspaceId: actor.workspaceId,
      createdById: actor.actorUserId
    },
    include: emailLogInclude
  });

  await writeAuditLog(actor, "email_log.created", "EmailLog", emailLog.id, {
    subject: emailLog.subject,
    direction: emailLog.direction,
    occurredAt: emailLog.occurredAt.toISOString()
  });

  return emailLog;
}

export async function listEmailTemplates(actor: WorkspaceActor, options: { activeOnly?: boolean } = {}) {
  await ensureWorkspaceAccess(actor);
  const activeOnly = normalizeEmailTemplateActiveOnlyFilter(options.activeOnly);
  return prisma.emailTemplate.findMany({
    where: {
      workspaceId: actor.workspaceId,
      ...(activeOnly ? { active: true } : {})
    },
    orderBy: [{ active: "desc" }, { name: "asc" }]
  });
}

export async function createEmailTemplate(actor: WorkspaceActor, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeEmailTemplateCreateInput(data, { defaultActive: true });
  const template = await prisma.emailTemplate.create({
    data: { ...normalized, workspaceId: actor.workspaceId }
  });

  await writeAuditLog(actor, "email_template.created", "EmailTemplate", template.id, { name: template.name });
  return template;
}

export async function updateEmailTemplate(actor: WorkspaceActor, templateId: string, data: unknown) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("emailTemplate", actor.workspaceId, templateId);

  const normalized = normalizeEmailTemplateUpdateInput(data);
  const existing = await prisma.emailTemplate.findFirstOrThrow({
    where: { id: templateId, workspaceId: actor.workspaceId }
  });
  if (Object.keys(normalized).length === 0 || !emailTemplateUpdateChanges(normalized, existing)) {
    return existing;
  }

  const template = await prisma.emailTemplate.update({
    where: { id: templateId },
    data: normalized
  });

  await writeAuditLog(actor, "email_template.updated", "EmailTemplate", template.id, { name: template.name });
  return template;
}

export async function setEmailTemplateActive(actor: WorkspaceActor, templateId: string, active: boolean) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("emailTemplate", actor.workspaceId, templateId);
  const activeFlag = normalizeEmailTemplateActiveFlag(active);
  const existing = await prisma.emailTemplate.findFirstOrThrow({
    where: { id: templateId, workspaceId: actor.workspaceId }
  });
  if (existing.active === activeFlag) return existing;

  const template = await prisma.emailTemplate.update({
    where: { id: templateId },
    data: { active: activeFlag }
  });

  await writeAuditLog(actor, activeFlag ? "email_template.reactivated" : "email_template.deactivated", "EmailTemplate", template.id, {
    name: template.name
  });
  return template;
}

function normalizeEmailLogInput(data: unknown) {
  const input = objectInput(data);
  const subject = normalizeRequiredEmailText(input.subject, "Email subject is required.");
  const body = normalizeRequiredEmailText(input.body, "Email body is required.");
  const occurredAt = normalizeEmailOccurredAt(input.occurredAt);

  if (input.direction !== "INBOUND" && input.direction !== "OUTBOUND") {
    throw new ApiError("VALIDATION_ERROR", "Email direction must be INBOUND or OUTBOUND.", 422);
  }

  return {
    dealId: normalizeEmailAttachmentId(input.dealId),
    leadId: normalizeEmailAttachmentId(input.leadId),
    personId: normalizeEmailAttachmentId(input.personId),
    organizationId: normalizeEmailAttachmentId(input.organizationId),
    subject,
    body,
    direction: input.direction as EmailDirection,
    occurredAt,
    fromText: normalizeOptionalEmailParticipantText(input.fromText),
    toText: normalizeOptionalEmailParticipantText(input.toText),
    ccText: normalizeOptionalEmailParticipantText(input.ccText),
    provider: normalizeEmailProvider(input.provider),
    providerMessageId: optionalProviderText(input.providerMessageId, "Email provider message id must be text."),
    providerThreadId: optionalProviderText(input.providerThreadId, "Email provider thread id must be text.")
  };
}

function normalizeEmailTemplateCreateInput(data: unknown, options: { defaultActive?: boolean } = {}) {
  const input = objectInput(data);
  const name = normalizeRequiredEmailText(input.name, "Template name is required.");
  const subject = normalizeRequiredEmailText(input.subject, "Template subject is required.");
  const body = normalizeRequiredEmailText(input.body, "Template body is required.");
  const active = input.active === undefined ? undefined : normalizeEmailTemplateActiveFlag(input.active);

  return {
    name,
    subject,
    body,
    ...(active !== undefined ? { active } : {}),
    ...(active === undefined && options.defaultActive !== undefined ? { active: options.defaultActive } : {})
  };
}

function normalizeEmailTemplateUpdateInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Email template update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    name: hasInputKey(input, "name") ? normalizeRequiredEmailText(input.name, "Template name is required.") : undefined,
    subject: hasInputKey(input, "subject")
      ? normalizeRequiredEmailText(input.subject, "Template subject is required.")
      : undefined,
    body: hasInputKey(input, "body") ? normalizeRequiredEmailText(input.body, "Template body is required.") : undefined,
    active: hasInputKey(input, "active") ? normalizeEmailTemplateActiveFlag(input.active) : undefined
  });
}

function emailTemplateUpdateChanges(
  input: ReturnType<typeof normalizeEmailTemplateUpdateInput>,
  existing: { name: string; subject: string; body: string; active: boolean }
) {
  if (input.name !== undefined && input.name !== existing.name) return true;
  if (input.subject !== undefined && input.subject !== existing.subject) return true;
  if (input.body !== undefined && input.body !== existing.body) return true;
  if (input.active !== undefined && input.active !== existing.active) return true;
  return false;
}

function normalizeRequiredEmailText(value: unknown, message: string) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeEmailOccurredAt(value: unknown) {
  if (value === null || value === undefined) {
    throw new ApiError("VALIDATION_ERROR", "Email occurred date is required.", 422);
  }

  const occurredAt = value instanceof Date || typeof value === "string" || typeof value === "number" ? new Date(value) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) {
    throw new ApiError("VALIDATION_ERROR", "Email occurred date is required.", 422);
  }

  return occurredAt;
}

function normalizeEmailAttachmentId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Email log attachment ids must be text.", 422);
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmailProvider(value: unknown): EmailConnectionProvider | null {
  if (value === undefined || value === null) return null;
  if (value === "GOOGLE_WORKSPACE" || value === "MICROSOFT_365" || value === "IMAP_SMTP") return value;
  throw new ApiError("VALIDATION_ERROR", "Email provider must be Google Workspace, Microsoft 365, or IMAP/SMTP.", 422);
}

function optionalProviderText(value: unknown, message: string) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmailTemplateActiveFlag(value: unknown) {
  if (typeof value === "boolean") return value;
  throw new ApiError("VALIDATION_ERROR", "Email template active flag must be true or false.", 422);
}

type RankedEmailCrmLinkSuggestion = EmailCrmLinkSuggestion & { score: number };

function emailLogHasCrmLink(emailLog: Pick<EmailCrmLinkSuggestionEmailLog, "dealId" | "leadId" | "personId" | "organizationId">) {
  return Boolean(emailLog.dealId || emailLog.leadId || emailLog.personId || emailLog.organizationId);
}

function extractEmailLogParticipantEmails(emailLog: EmailCrmLinkSuggestionEmailLog) {
  const fields =
    emailLog.direction === "INBOUND"
      ? [emailLog.fromText, emailLog.toText, emailLog.ccText]
      : [emailLog.toText, emailLog.ccText, emailLog.fromText];
  const emails = fields.flatMap((field) => extractEmailAddresses(field));
  return Array.from(new Set(emails));
}

function extractEmailAddresses(value: string | null | undefined) {
  if (!value) return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi) ?? [];
  return matches.map(normalizeEmailAddress).filter((email): email is string => Boolean(email));
}

function normalizeEmailAddress(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().replace(/^mailto:/i, "").toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function emailDomain(value: string | null | undefined) {
  const normalized = normalizeEmailAddress(value);
  if (!normalized) return null;
  return normalizeDomain(normalized.split("@")[1]);
}

function normalizeDomain(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return normalized.includes(".") ? normalized : null;
}

function emailDomainMatchesOrganizationDomain(participantDomain: string, organizationDomain: string) {
  return participantDomain === organizationDomain || participantDomain.endsWith(`.${organizationDomain}`);
}

function rankedEmailCrmLinkSuggestion(suggestion: Omit<EmailCrmLinkSuggestion, "id">, score: number): RankedEmailCrmLinkSuggestion {
  return {
    ...suggestion,
    id: `${suggestion.type}:${suggestion.recordId}:${suggestion.source}:${suggestion.evidence}`,
    score
  };
}

function emailCrmLinkSuggestionResult(emailLogId: string, candidates: RankedEmailCrmLinkSuggestion[]): EmailCrmLinkSuggestionResult {
  const suggestions = dedupeEmailCrmLinkSuggestions(candidates).sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.type !== right.type) return emailCrmLinkTypeRank(left.type) - emailCrmLinkTypeRank(right.type);
    return left.label.localeCompare(right.label);
  });

  if (suggestions.length === 0) {
    return {
      alternativeSuggestions: [],
      alreadyLinked: false,
      emailLogId,
      noReliableMatchReason: "No reliable CRM match found.",
      primarySuggestion: null
    };
  }

  const topScore = suggestions[0]?.score ?? 0;
  const topSuggestions = suggestions.filter((suggestion) => suggestion.score === topScore);
  const primarySuggestion = topSuggestions.length === 1 ? stripEmailCrmLinkScore(topSuggestions[0]) : null;
  const alternativeSuggestions = suggestions
    .filter((suggestion) => !primarySuggestion || suggestion.recordId !== primarySuggestion.recordId || suggestion.type !== primarySuggestion.type)
    .map(stripEmailCrmLinkScore);

  return {
    alternativeSuggestions,
    alreadyLinked: false,
    emailLogId,
    noReliableMatchReason: null,
    primarySuggestion
  };
}

function emailCrmLinkReviewItem(
  emailLog: EmailCrmLinkSuggestionEmailLog,
  suggestion: EmailCrmLinkSuggestionResult | undefined
): EmailCrmLinkReviewItem | null {
  if (emailLogHasCrmLink(emailLog)) {
    return {
      alternativeSuggestions: [],
      emailLog,
      highConfidenceSuggestionCount: 0,
      primarySuggestion: null,
      state: "linked",
      stateLabel: "Linked"
    };
  }
  const alternativeSuggestions = suggestion?.alternativeSuggestions ?? [];
  const primarySuggestion = suggestion?.primarySuggestion ?? null;
  const allSuggestions = [primarySuggestion, ...alternativeSuggestions].filter(
    (candidate): candidate is EmailCrmLinkSuggestion => Boolean(candidate)
  );
  const state: EmailCrmLinkReviewState = primarySuggestion
    ? "ready"
    : alternativeSuggestions.length > 0
      ? "ambiguous"
      : "no_match";
  return {
    alternativeSuggestions,
    emailLog,
    highConfidenceSuggestionCount: allSuggestions.filter((candidate) => candidate.confidence === "high").length,
    primarySuggestion,
    state,
    stateLabel: emailCrmLinkReviewStateLabel(state)
  };
}

function emailCrmLinkReviewStateLabel(state: EmailCrmLinkReviewState) {
  if (state === "ready") return "Ready to review";
  if (state === "ambiguous") return "Unresolved";
  if (state === "linked") return "Linked";
  return "No reliable match";
}

function emailCrmLinkReviewItemMatchesFilter(item: EmailCrmLinkReviewItem, filter: EmailCrmLinkReviewFilterId) {
  if (item.state === "linked") return false;
  if (filter === "all") return true;
  if (filter === "suggested") return item.state === "ready";
  if (filter === "ambiguous") return item.state === "ambiguous";
  return item.state === "no_match";
}

function compareEmailCrmLinkReviewItems(left: EmailCrmLinkReviewItem, right: EmailCrmLinkReviewItem) {
  const stateDelta = emailCrmLinkReviewStateRank(left.state) - emailCrmLinkReviewStateRank(right.state);
  if (stateDelta !== 0) return stateDelta;
  if (right.highConfidenceSuggestionCount !== left.highConfidenceSuggestionCount) {
    return right.highConfidenceSuggestionCount - left.highConfidenceSuggestionCount;
  }
  return emailLogReviewTime(right.emailLog) - emailLogReviewTime(left.emailLog);
}

function emailCrmLinkReviewStateRank(state: EmailCrmLinkReviewState) {
  if (state === "ready") return 0;
  if (state === "ambiguous") return 1;
  if (state === "no_match") return 2;
  return 3;
}

function emailLogReviewTime(emailLog: EmailCrmLinkSuggestionEmailLog) {
  const occurredAt = emailLog.occurredAt ? new Date(emailLog.occurredAt).getTime() : 0;
  return Number.isFinite(occurredAt) ? occurredAt : 0;
}

function dedupeEmailCrmLinkSuggestions(candidates: RankedEmailCrmLinkSuggestion[]) {
  const byRecord = new Map<string, RankedEmailCrmLinkSuggestion>();
  for (const candidate of candidates) {
    const key = `${candidate.type}:${candidate.recordId}`;
    const existing = byRecord.get(key);
    if (!existing || candidate.score > existing.score) {
      byRecord.set(key, candidate);
    }
  }
  return Array.from(byRecord.values());
}

function stripEmailCrmLinkScore(suggestion: RankedEmailCrmLinkSuggestion): EmailCrmLinkSuggestion {
  const { score: _score, ...rest } = suggestion;
  return rest;
}

function emailCrmLinkTypeRank(type: EmailCrmLinkRecordType) {
  if (type === "PERSON") return 0;
  if (type === "DEAL") return 1;
  if (type === "LEAD") return 2;
  return 3;
}

function formatEmailCrmPersonName(person: { email: string | null; firstName: string; lastName: string | null }) {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || person.email || "Unnamed contact";
}

async function listThreadContextCrmLinkSuggestions(
  actor: WorkspaceActor,
  emailLogs: EmailCrmLinkSuggestionEmailLog[]
): Promise<Map<string, RankedEmailCrmLinkSuggestion[]>> {
  const threadTargets = emailLogs.filter((emailLog) => emailLog.providerThreadId);
  const results = new Map<string, RankedEmailCrmLinkSuggestion[]>();
  if (threadTargets.length === 0) return results;

  for (const emailLog of threadTargets) {
    const threadLogs = await prisma.emailLog.findMany({
      where: {
        emailConnectionId: emailLog.emailConnectionId ?? undefined,
        id: { not: emailLog.id },
        provider: emailLog.provider ?? undefined,
        providerThreadId: emailLog.providerThreadId,
        workspaceId: actor.workspaceId,
        ...emailLogAttachmentRelationsWhere(actor.workspaceId)
      },
      include: {
        deal: true,
        lead: true,
        organization: true,
        person: true
      },
      take: 12
    });

    const candidates: RankedEmailCrmLinkSuggestion[] = [];
    for (const threadLog of threadLogs) {
      if (threadLog.deal) {
        candidates.push(
          rankedEmailCrmLinkSuggestion(
            {
              confidence: "high",
              evidence: `Thread ${emailLog.providerThreadId}`,
              href: `/deals/${threadLog.deal.id}`,
              label: threadLog.deal.title,
              recordId: threadLog.deal.id,
              source: "thread_context",
              type: "DEAL",
              why: "Another stored email in this same provider thread is already linked to this deal."
            },
            89
          )
        );
      }
      if (threadLog.lead) {
        candidates.push(
          rankedEmailCrmLinkSuggestion(
            {
              confidence: "high",
              evidence: `Thread ${emailLog.providerThreadId}`,
              href: `/leads/${threadLog.lead.id}`,
              label: threadLog.lead.title,
              recordId: threadLog.lead.id,
              source: "thread_context",
              type: "LEAD",
              why: "Another stored email in this same provider thread is already linked to this lead."
            },
            88
          )
        );
      }
      if (threadLog.person) {
        candidates.push(
          rankedEmailCrmLinkSuggestion(
            {
              confidence: "high",
              evidence: `Thread ${emailLog.providerThreadId}`,
              href: `/contacts/${threadLog.person.id}`,
              label: formatEmailCrmPersonName(threadLog.person),
              recordId: threadLog.person.id,
              source: "thread_context",
              type: "PERSON",
              why: "Another stored email in this same provider thread is already linked to this contact."
            },
            87
          )
        );
      }
      if (threadLog.organization) {
        candidates.push(
          rankedEmailCrmLinkSuggestion(
            {
              confidence: "high",
              evidence: `Thread ${emailLog.providerThreadId}`,
              href: `/organizations/${threadLog.organization.id}`,
              label: threadLog.organization.name,
              recordId: threadLog.organization.id,
              source: "thread_context",
              type: "ORGANIZATION",
              why: "Another stored email in this same provider thread is already linked to this organization."
            },
            86
          )
        );
      }
    }

    if (candidates.length > 0) results.set(emailLog.id, candidates);
  }

  return results;
}

function normalizeEmailTemplateActiveOnlyFilter(value: unknown) {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  throw new ApiError("VALIDATION_ERROR", "Email template active-only filter must be true or false.", 422);
}

function normalizeEmailLogListLimit(limit: number) {
  if (!Number.isFinite(limit)) return defaultEmailLogListLimit;
  const normalized = Math.trunc(limit);
  if (normalized < 1) return 1;
  if (normalized > maxEmailLogListLimit) return maxEmailLogListLimit;
  return normalized;
}

function normalizeOptionalEmailParticipantText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Email participant fields must be text.", 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeEmailLogRecordType(value: unknown): EmailLogRecordType {
  if (value === "DEAL" || value === "LEAD" || value === "PERSON" || value === "ORGANIZATION") return value;
  throw new ApiError("VALIDATION_ERROR", "Email log record type must be DEAL, LEAD, PERSON, or ORGANIZATION.", 422);
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null) return input as Record<string, unknown>;
  return {};
}

function hasInputKey(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
  };
}

function attachmentField(type: EmailLogRecordType) {
  if (type === "DEAL") return "dealId";
  if (type === "LEAD") return "leadId";
  if (type === "PERSON") return "personId";
  return "organizationId";
}

function recordModel(type: EmailLogRecordType) {
  if (type === "DEAL") return "deal";
  if (type === "LEAD") return "lead";
  if (type === "PERSON") return "person";
  return "organization";
}
