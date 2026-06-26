import { Prisma, type EmailDirection } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { assertEmailLogLinks, assertRecordInWorkspace } from "./record-guards";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export type EmailLogRecordType = "DEAL" | "LEAD" | "PERSON" | "ORGANIZATION";

type CreateEmailLogInput = Omit<Prisma.EmailLogUncheckedCreateInput, "workspaceId" | "createdById">;
type CreateEmailTemplateInput = Omit<Prisma.EmailTemplateUncheckedCreateInput, "workspaceId" | "active"> & {
  active?: boolean;
};

const emailLogInclude = {
  createdBy: { select: userDisplaySelect },
  deal: true,
  lead: true,
  person: true,
  organization: true
} satisfies Prisma.EmailLogInclude;

export async function listEmailLogs(actor: WorkspaceActor, options: { limit?: number } = {}) {
  await ensureWorkspaceAccess(actor);
  const take = options.limit ? Math.min(Math.max(options.limit, 1), 100) : undefined;
  return prisma.emailLog.findMany({
    where: { workspaceId: actor.workspaceId },
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
  await assertRecordInWorkspace(recordModel(record.type), actor.workspaceId, record.id);

  return prisma.emailLog.findMany({
    where: {
      workspaceId: actor.workspaceId,
      [attachmentField(record.type)]: record.id
    },
    include: emailLogInclude,
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function createEmailLog(actor: WorkspaceActor, data: CreateEmailLogInput) {
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
  return prisma.emailTemplate.findMany({
    where: {
      workspaceId: actor.workspaceId,
      ...(options.activeOnly ? { active: true } : {})
    },
    orderBy: [{ active: "desc" }, { name: "asc" }]
  });
}

export async function createEmailTemplate(actor: WorkspaceActor, data: CreateEmailTemplateInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeEmailTemplateInput(data, { defaultActive: true });
  const template = await prisma.emailTemplate.create({
    data: { ...normalized, workspaceId: actor.workspaceId }
  });

  await writeAuditLog(actor, "email_template.created", "EmailTemplate", template.id, { name: template.name });
  return template;
}

export async function updateEmailTemplate(actor: WorkspaceActor, templateId: string, data: CreateEmailTemplateInput) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("emailTemplate", actor.workspaceId, templateId);

  const normalized = normalizeEmailTemplateInput(data);
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

  const template = await prisma.emailTemplate.update({
    where: { id: templateId },
    data: { active }
  });

  await writeAuditLog(actor, active ? "email_template.reactivated" : "email_template.deactivated", "EmailTemplate", template.id, {
    name: template.name
  });
  return template;
}

function normalizeEmailLogInput(data: CreateEmailLogInput) {
  const subject = data.subject.trim();
  const body = data.body.trim();
  const occurredAt = data.occurredAt instanceof Date ? data.occurredAt : new Date(data.occurredAt);

  if (!subject) throw new ApiError("VALIDATION_ERROR", "Email subject is required.", 422);
  if (!body) throw new ApiError("VALIDATION_ERROR", "Email body is required.", 422);
  if (!["INBOUND", "OUTBOUND"].includes(data.direction)) {
    throw new ApiError("VALIDATION_ERROR", "Email direction must be INBOUND or OUTBOUND.", 422);
  }
  if (Number.isNaN(occurredAt.getTime())) {
    throw new ApiError("VALIDATION_ERROR", "Email occurred date is required.", 422);
  }

  return {
    ...data,
    subject,
    body,
    direction: data.direction as EmailDirection,
    occurredAt,
    fromText: optionalText(data.fromText),
    toText: optionalText(data.toText),
    ccText: optionalText(data.ccText)
  };
}

function normalizeEmailTemplateInput(data: CreateEmailTemplateInput, options: { defaultActive?: boolean } = {}) {
  const name = data.name.trim();
  const subject = data.subject.trim();
  const body = data.body.trim();

  if (!name) throw new ApiError("VALIDATION_ERROR", "Template name is required.", 422);
  if (!subject) throw new ApiError("VALIDATION_ERROR", "Template subject is required.", 422);
  if (!body) throw new ApiError("VALIDATION_ERROR", "Template body is required.", 422);

  return {
    name,
    subject,
    body,
    ...(data.active !== undefined ? { active: data.active } : {}),
    ...(data.active === undefined && options.defaultActive !== undefined ? { active: options.defaultActive } : {})
  };
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
