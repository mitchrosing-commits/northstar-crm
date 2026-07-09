import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";

type CreateWebFormInput = {
  name?: unknown;
  publicTitle?: unknown;
  publicDescription?: unknown;
  sourceLabel?: unknown;
  requireLeadTitle?: unknown;
};
type UpdateWebFormInput = Partial<CreateWebFormInput> & {
  isEnabled?: unknown;
};

type PublicSubmissionInput = {
  leadTitle?: unknown;
  personName?: unknown;
  email?: unknown;
  phone?: unknown;
  organizationName?: unknown;
  message?: unknown;
  website?: unknown;
};

const WEB_FORM_TOKEN_ATTEMPTS = 3;
const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export async function listWebForms(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  return prisma.webForm.findMany({
    where: { workspaceId: actor.workspaceId, deletedAt: null },
    include: {
      _count: { select: { submissions: true } }
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
  });
}

export async function createWebForm(actor: WorkspaceActor, data: CreateWebFormInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeCreateWebFormInput(data);
  const webForm = await createUniqueWebForm({
    ...normalized,
    workspaceId: actor.workspaceId,
    createdById: actor.actorUserId
  });

  await writeAuditLog(actor, "web_form.created", "WebForm", webForm.id, {
    name: webForm.name,
    isEnabled: webForm.isEnabled,
    requireLeadTitle: webForm.requireLeadTitle
  });

  return webForm;
}

export async function updateWebForm(actor: WorkspaceActor, webFormId: string, data: UpdateWebFormInput) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeUpdateWebFormInput(data);
  const existing = await prisma.webForm.findFirst({
    where: { id: webFormId, workspaceId: actor.workspaceId, deletedAt: null }
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Web form was not found.", 404);
  if (Object.keys(normalized).length === 0 || !webFormChanges(normalized, existing)) return existing;

  const webForm = await prisma.webForm.update({ where: { id: existing.id }, data: normalized });
  await writeAuditLog(actor, "web_form.updated", "WebForm", webForm.id, {
    name: webForm.name,
    isEnabled: webForm.isEnabled,
    requireLeadTitle: webForm.requireLeadTitle
  });
  return webForm;
}

export async function getPublicWebFormByToken(token: string) {
  if (!isPublicWebFormTokenShape(token)) {
    throw new ApiError("NOT_FOUND", "Form was not found.", 404);
  }

  const webForm = await prisma.webForm.findFirst({
    where: {
      token,
      isEnabled: true,
      deletedAt: null,
      workspace: { deletedAt: null }
    },
    select: {
      token: true,
      publicTitle: true,
      publicDescription: true,
      requireLeadTitle: true
    }
  });

  if (!webForm) throw new ApiError("NOT_FOUND", "Form was not found.", 404);
  return webForm;
}

export async function submitPublicWebForm(token: string, data: PublicSubmissionInput) {
  if (!isPublicWebFormTokenShape(token)) {
    throw new ApiError("NOT_FOUND", "Form was not found.", 404);
  }

  const webForm = await prisma.webForm.findFirst({
    where: {
      token,
      isEnabled: true,
      deletedAt: null,
      workspace: { deletedAt: null }
    },
    select: {
      id: true,
      workspaceId: true,
      name: true,
      sourceLabel: true,
      requireLeadTitle: true
    }
  });

  if (!webForm) throw new ApiError("NOT_FOUND", "Form was not found.", 404);

  const normalized = normalizePublicSubmissionInput(data, webForm.requireLeadTitle);
  if (normalized.honeypotFilled) {
    return { blocked: true, created: false, duplicate: false, leadId: null };
  }

  const fingerprint = submissionFingerprint(webForm.id, normalized);
  const duplicateAfter = new Date(Date.now() - DUPLICATE_WINDOW_MS);
  const duplicate = await prisma.webFormSubmission.findFirst({
    where: {
      workspaceId: webForm.workspaceId,
      webFormId: webForm.id,
      fingerprint,
      submittedAt: { gte: duplicateAfter }
    },
    select: { leadId: true }
  });

  if (duplicate) {
    return { blocked: false, created: false, duplicate: true, leadId: duplicate.leadId };
  }

  const leadTitle = normalized.leadTitle || inferLeadTitle(webForm.name, normalized);
  const noteBody = buildSubmissionNoteBody(webForm.name, leadTitle, normalized);

  const result = await prisma.$transaction(async (tx) => {
    const lead = await tx.lead.create({
      data: {
        workspaceId: webForm.workspaceId,
        title: leadTitle,
        source: webForm.sourceLabel,
        status: "NEW"
      }
    });

    await tx.note.create({
      data: {
        workspaceId: webForm.workspaceId,
        leadId: lead.id,
        body: noteBody
      }
    });

    await tx.webFormSubmission.create({
      data: {
        workspaceId: webForm.workspaceId,
        webFormId: webForm.id,
        leadId: lead.id,
        fingerprint
      }
    });

    await tx.auditLog.createMany({
      data: [
        {
          workspaceId: webForm.workspaceId,
          action: "lead.created_from_web_form",
          entityType: "Lead",
          entityId: lead.id,
          metadata: serializePublicAuditMetadata({
            webFormId: webForm.id,
            webFormName: webForm.name,
            sourceLabel: webForm.sourceLabel
          })
        },
        {
          workspaceId: webForm.workspaceId,
          action: "web_form.submission_received",
          entityType: "WebForm",
          entityId: webForm.id,
          metadata: serializePublicAuditMetadata({
            leadId: lead.id,
            sourceLabel: webForm.sourceLabel
          })
        }
      ]
    });

    return lead;
  });

  return { blocked: false, created: true, duplicate: false, leadId: result.id };
}

export function generatePublicWebFormToken() {
  return randomBytes(32).toString("base64url");
}

export function isPublicWebFormTokenShape(token: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

async function createUniqueWebForm(data: {
  workspaceId: string;
  createdById: string;
  name: string;
  publicTitle: string;
  publicDescription: string | null;
  sourceLabel: string;
  requireLeadTitle: boolean;
}) {
  for (let attempt = 0; attempt < WEB_FORM_TOKEN_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.webForm.create({
        data: {
          ...data,
          token: generatePublicWebFormToken()
        }
      });
    } catch (error) {
      if (!isUniqueTokenCollision(error) || attempt === WEB_FORM_TOKEN_ATTEMPTS - 1) throw error;
    }
  }

  throw new ApiError("INTERNAL_ERROR", "Could not create a public form link.", 500);
}

function normalizeCreateWebFormInput(data: unknown) {
  const input = objectInput(data);
  const name = normalizeRequiredSingleLine(input.name, "Form name is required.", 120);
  const sourceLabel = normalizeOptionalSingleLine(input.sourceLabel, "Source label must be text.", 120);
  return {
    name,
    publicTitle: normalizeRequiredSingleLine(input.publicTitle, "Public title is required.", 160),
    publicDescription: normalizeOptionalMultiline(input.publicDescription, "Public description must be text.", 500),
    sourceLabel: sourceLabel || `Web Form / ${name}`,
    requireLeadTitle: normalizeBoolean(input.requireLeadTitle)
  };
}

function normalizeUpdateWebFormInput(data: unknown) {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ApiError("VALIDATION_ERROR", "Web form update must be an object.", 422);
  }
  const input = objectInput(data);
  return omitUndefined({
    name: hasInputKey(input, "name") ? normalizeRequiredSingleLine(input.name, "Form name is required.", 120) : undefined,
    publicTitle: hasInputKey(input, "publicTitle")
      ? normalizeRequiredSingleLine(input.publicTitle, "Public title is required.", 160)
      : undefined,
    publicDescription: hasInputKey(input, "publicDescription")
      ? normalizeOptionalMultiline(input.publicDescription, "Public description must be text.", 500)
      : undefined,
    sourceLabel: hasInputKey(input, "sourceLabel")
      ? normalizeRequiredSingleLine(input.sourceLabel, "Source label is required.", 120)
      : undefined,
    requireLeadTitle: hasInputKey(input, "requireLeadTitle") ? normalizeBoolean(input.requireLeadTitle) : undefined,
    isEnabled: hasInputKey(input, "isEnabled") ? normalizeBoolean(input.isEnabled) : undefined
  });
}

function webFormChanges(
  input: ReturnType<typeof normalizeUpdateWebFormInput>,
  existing: {
    name: string;
    publicTitle: string;
    publicDescription: string | null;
    sourceLabel: string;
    requireLeadTitle: boolean;
    isEnabled: boolean;
  }
) {
  if (input.name !== undefined && input.name !== existing.name) return true;
  if (input.publicTitle !== undefined && input.publicTitle !== existing.publicTitle) return true;
  if (input.publicDescription !== undefined && input.publicDescription !== existing.publicDescription) return true;
  if (input.sourceLabel !== undefined && input.sourceLabel !== existing.sourceLabel) return true;
  if (input.requireLeadTitle !== undefined && input.requireLeadTitle !== existing.requireLeadTitle) return true;
  if (input.isEnabled !== undefined && input.isEnabled !== existing.isEnabled) return true;
  return false;
}

function normalizePublicSubmissionInput(data: unknown, requireLeadTitle: boolean) {
  const input = objectInput(data);
  const leadTitle = requireLeadTitle
    ? normalizeRequiredSingleLine(input.leadTitle, "Lead title is required.", 160)
    : normalizeOptionalSingleLine(input.leadTitle, "Lead title must be text.", 160);
  const normalized = {
    leadTitle,
    personName: normalizeOptionalSingleLine(input.personName, "Name must be text.", 120),
    email: normalizeOptionalEmail(input.email),
    phone: normalizeOptionalSingleLine(input.phone, "Phone must be text.", 40),
    organizationName: normalizeOptionalSingleLine(input.organizationName, "Organization must be text.", 120),
    message: normalizeOptionalMultiline(input.message, "Message must be text.", 2000),
    honeypotFilled: Boolean(normalizeOptionalSingleLine(input.website, "Website must be text.", 200))
  };

  if (!normalized.honeypotFilled && !hasSubmissionDetails(normalized)) {
    throw new ApiError("VALIDATION_ERROR", "Add a name, email, phone, company, message, or lead title before submitting.", 422);
  }

  return normalized;
}

function hasSubmissionDetails(input: {
  leadTitle: string | null;
  personName: string | null;
  email: string | null;
  phone: string | null;
  organizationName: string | null;
  message: string | null;
}) {
  return Boolean(input.leadTitle || input.personName || input.email || input.phone || input.organizationName || input.message);
}

function inferLeadTitle(
  formName: string,
  input: {
    personName: string | null;
    email: string | null;
    phone: string | null;
    organizationName: string | null;
  }
) {
  const subject = input.organizationName || input.personName || input.email || input.phone;
  return truncateSingleLine(subject ? `Website inquiry from ${subject}` : `Website inquiry from ${formName}`, 160);
}

function buildSubmissionNoteBody(
  formName: string,
  leadTitle: string,
  input: {
    personName: string | null;
    email: string | null;
    phone: string | null;
    organizationName: string | null;
    message: string | null;
  }
) {
  const lines = [
    `Web form submission: ${formName}`,
    "",
    `Lead title: ${leadTitle}`,
    input.personName ? `Name: ${input.personName}` : null,
    input.email ? `Email: ${input.email}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    input.organizationName ? `Organization: ${input.organizationName}` : null,
    input.message ? "" : null,
    input.message ? "Message:" : null,
    input.message
  ].filter((line): line is string => line !== null);

  return lines.join("\n").slice(0, 5000);
}

function submissionFingerprint(
  webFormId: string,
  input: {
    leadTitle: string | null;
    personName: string | null;
    email: string | null;
    phone: string | null;
    organizationName: string | null;
    message: string | null;
  }
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        webFormId,
        leadTitle: normalizeFingerprintValue(input.leadTitle),
        personName: normalizeFingerprintValue(input.personName),
        email: normalizeFingerprintValue(input.email),
        phone: normalizeFingerprintValue(input.phone),
        organizationName: normalizeFingerprintValue(input.organizationName),
        message: normalizeFingerprintValue(input.message)
      })
    )
    .digest("hex");
}

function normalizeFingerprintValue(value: string | null) {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 500);
}

function normalizeRequiredSingleLine(value: unknown, message: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = truncateSingleLine(value, maxLength);
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalSingleLine(value: unknown, message: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  return truncateSingleLine(value, maxLength) || null;
}

function truncateSingleLine(value: string, maxLength: number) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeOptionalMultiline(value: unknown, message: string, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  const trimmed = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
  return trimmed || null;
}

function normalizeOptionalEmail(value: unknown) {
  const email = normalizeOptionalSingleLine(value, "Email must be text.", 254);
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ApiError("VALIDATION_ERROR", "Enter a valid email address.", 422);
  }
  return normalized;
}

function normalizeBoolean(value: unknown) {
  if (value === true || value === "true" || value === "on" || value === "1") return true;
  if (value === false || value === undefined || value === null || value === "" || value === "false" || value === "0") {
    return false;
  }
  throw new ApiError("VALIDATION_ERROR", "Boolean fields must be true or false.", 422);
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

function isUniqueTokenCollision(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function serializePublicAuditMetadata(metadata: unknown) {
  return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;
}
