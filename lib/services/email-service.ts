import { Prisma, type EmailConnectionProvider, type EmailDirection } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { assertEmailLogLinks, assertRecordInWorkspace, emailLogAttachmentRelationsWhere } from "./record-guards";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export type EmailLogRecordType = "DEAL" | "LEAD" | "PERSON" | "ORGANIZATION";

const emailLogInclude = {
  createdBy: { select: userDisplaySelect },
  deal: true,
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
