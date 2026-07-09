import { ActivityType, AssistantActionRequestStatus, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { redactSensitiveText } from "@/lib/security/redaction";
import type { AssistantDraftAction } from "@/lib/services/assistant/assistant-draft-action-service";
import { createActivity } from "@/lib/services/activity-service";
import { createNote } from "@/lib/services/note-service";
import { ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "@/lib/services/workspace-access";

const maxStoredTextLength = 600;
const maxStoredSourceLength = 320;
const maxStoredArrayItems = 12;

export type AssistantActionRequestView = {
  actionType: string;
  canApply: boolean;
  confidence: string;
  createdAt: string;
  evidence: string[];
  id: string;
  missingInfo: string[];
  objectType: string;
  proposedFields: Array<{ currentValue?: string | null; label: string; value: string }>;
  riskLevel: string;
  sourceSummary: string | null;
  status: "APPLIED" | "PENDING" | "REJECTED";
  targetHref: string | null;
  targetLabel: string;
  title: string;
  warnings: string[];
};

export async function createAssistantActionRequest(
  actor: WorkspaceActor,
  input: { draftAction: AssistantDraftAction; sourceCommand?: string }
): Promise<AssistantActionRequestView> {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeDraftActionRequest(input.draftAction, input.sourceCommand);
  const request = await prisma.assistantActionRequest.create({
    data: {
      ...normalized,
      createdById: actor.actorUserId,
      status: AssistantActionRequestStatus.PENDING,
      workspaceId: actor.workspaceId
    }
  });
  await writeAuditLog(actor, "assistant_action_request.created", "AssistantActionRequest", request.id, {
    actionType: request.actionType,
    confidence: request.confidence,
    objectType: request.objectType,
    riskLevel: request.riskLevel,
    status: request.status
  });
  return assistantActionRequestView(request);
}

export async function listPendingAssistantActionRequests(actor: WorkspaceActor): Promise<AssistantActionRequestView[]> {
  await ensureWorkspaceAccess(actor);
  const requests = await prisma.assistantActionRequest.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 25,
    where: {
      createdById: actor.actorUserId,
      status: AssistantActionRequestStatus.PENDING,
      workspaceId: actor.workspaceId
    }
  });
  return requests.map(assistantActionRequestView);
}

export async function listAssistantActionRequests(actor: WorkspaceActor): Promise<AssistantActionRequestView[]> {
  await ensureWorkspaceAccess(actor);
  const requests = await prisma.assistantActionRequest.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 25,
    where: {
      createdById: actor.actorUserId,
      workspaceId: actor.workspaceId
    }
  });
  return requests.map(assistantActionRequestView);
}

export async function rejectAssistantActionRequest(
  actor: WorkspaceActor,
  requestId: string
): Promise<AssistantActionRequestView> {
  await ensureWorkspaceAccess(actor);
  const id = normalizeId(requestId);
  const existing = await prisma.assistantActionRequest.findFirst({
    where: {
      createdById: actor.actorUserId,
      id,
      status: AssistantActionRequestStatus.PENDING,
      workspaceId: actor.workspaceId
    }
  });
  if (!existing) throw new ApiError("NOT_FOUND", "Assistant action request was not found or is no longer pending.", 404);

  const request = await prisma.assistantActionRequest.update({
    data: {
      rejectedAt: new Date(),
      status: AssistantActionRequestStatus.REJECTED
    },
    where: { id: existing.id }
  });
  await writeAuditLog(actor, "assistant_action_request.rejected", "AssistantActionRequest", request.id, {
    actionType: request.actionType,
    objectType: request.objectType,
    status: request.status
  });
  return assistantActionRequestView(request);
}

export async function applyAssistantActionRequest(
  actor: WorkspaceActor,
  requestId: string
): Promise<{ activityId?: string; noteId?: string; request: AssistantActionRequestView }> {
  await ensureWorkspaceAccess(actor);
  const id = normalizeId(requestId);
  const existing = await prisma.assistantActionRequest.findFirst({
    where: {
      createdById: actor.actorUserId,
      id,
      status: AssistantActionRequestStatus.PENDING,
      workspaceId: actor.workspaceId
    }
  });
  if (!existing) throw new ApiError("NOT_FOUND", "Assistant action request was not found or is no longer pending.", 404);

  let applyPlan: ApplyPlan;
  try {
    applyPlan = applyPlanFromRequest(existing);
  } catch (error) {
    await writeAuditLog(actor, "assistant_action_request.apply_rejected", "AssistantActionRequest", existing.id, {
      actionType: existing.actionType,
      objectType: existing.objectType,
      reason: error instanceof Error ? safeText(error.message, 160) : "Unsupported Assistant action request.",
      status: existing.status
    });
    throw error;
  }

  const appliedAt = new Date();
  const claimed = await prisma.assistantActionRequest.updateMany({
    data: {
      appliedAt,
      status: AssistantActionRequestStatus.APPLIED
    },
    where: {
      createdById: actor.actorUserId,
      id: existing.id,
      status: AssistantActionRequestStatus.PENDING,
      workspaceId: actor.workspaceId
    }
  });
  if (claimed.count !== 1) {
    throw new ApiError("CONFLICT", "Assistant action request is no longer pending.", 409);
  }

  try {
    const appliedRecord = await applyPlan.apply(actor);
    const request = await prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: existing.id } });
    await writeAuditLog(actor, "assistant_action_request.applied", "AssistantActionRequest", request.id, {
      actionType: request.actionType,
      ...appliedRecord.auditMetadata,
      objectType: request.objectType,
      status: request.status
    });
    return { ...appliedRecord.result, request: assistantActionRequestView(request) };
  } catch (error) {
    await prisma.assistantActionRequest.update({
      data: {
        appliedAt: null,
        status: AssistantActionRequestStatus.PENDING
      },
      where: { id: existing.id }
    });
    await writeAuditLog(actor, "assistant_action_request.apply_failed", "AssistantActionRequest", existing.id, {
      actionType: existing.actionType,
      objectType: existing.objectType,
      reason: error instanceof Error ? safeText(error.message, 160) : "Assistant action request apply failed.",
      status: AssistantActionRequestStatus.PENDING
    });
    throw error;
  }
}

export function isSupportedAssistantActionApply(request: {
  actionType: string;
  confidence: string;
  proposedPayload?: Prisma.JsonValue;
  riskLevel: string;
  status: AssistantActionRequestStatus | "APPLIED" | "PENDING" | "REJECTED";
  targetHref: string | null;
}) {
  if (String(request.status) !== "PENDING") return false;
  if (request.confidence !== "high") return false;
  if ((request.actionType !== "activity" && request.actionType !== "note") || request.riskLevel !== "low") return false;
  return Boolean(crmRelationFromHref(targetHrefForRequest(request)));
}

function normalizeDraftActionRequest(draft: AssistantDraftAction, sourceCommand: string | undefined) {
  const fields = draft.fields.map((field) => ({
    currentValue: field.currentValue ? safeText(field.currentValue) : field.currentValue,
    label: safeText(field.label),
    value: safeText(field.value)
  }));
  const evidence = safeTextArray(draft.evidence);
  const warnings = safeTextArray(draft.warnings);
  const missingInfo = safeTextArray(draft.missingInfo);
  const candidates = draft.candidates.slice(0, maxStoredArrayItems).map((candidate) => ({
    detail: candidate.detail ? safeText(candidate.detail) : undefined,
    href: safeHref(candidate.href),
    id: safeText(candidate.id),
    label: safeText(candidate.label),
    type: safeText(candidate.type)
  }));
  return {
    actionType: draft.kind,
    confidence: draft.confidence,
    evidence: jsonOrNull(evidence),
    missingInfo: jsonOrNull(missingInfo),
    objectType: draft.targetKind,
    proposedPayload: {
      applyState: "disabled",
      candidates,
      fields,
      targetHref: draft.targetHref ? safeHref(draft.targetHref) : null,
      targetKind: safeText(draft.targetKind),
      targetLabel: safeText(draft.targetLabel)
    } satisfies Prisma.InputJsonObject,
    riskLevel: riskLevelForDraft(draft),
    sourceSummary: sourceCommand ? safeSourceSummary(sourceCommand) : null,
    targetHref: draft.targetHref ? safeHref(draft.targetHref) : null,
    targetLabel: safeText(draft.targetLabel),
    title: safeText(draft.title),
    warnings: jsonOrNull(warnings)
  };
}

function assistantActionRequestView<T extends {
  actionType: string;
  confidence: string;
  createdAt: Date;
  evidence: Prisma.JsonValue | null;
  id: string;
  missingInfo: Prisma.JsonValue | null;
  objectType: string;
  proposedPayload: Prisma.JsonValue;
  riskLevel: string;
  sourceSummary: string | null;
  status: AssistantActionRequestStatus;
  targetHref: string | null;
  targetLabel: string;
  title: string;
  warnings: Prisma.JsonValue | null;
}>(request: T): AssistantActionRequestView {
  const payload = proposedPayloadObject(request.proposedPayload);
  return {
    actionType: request.actionType,
    canApply: isSupportedAssistantActionApply(request),
    confidence: request.confidence,
    createdAt: request.createdAt.toISOString(),
    evidence: jsonStringArray(request.evidence),
    id: request.id,
    missingInfo: jsonStringArray(request.missingInfo),
    objectType: request.objectType,
    proposedFields: proposedPayloadFields(payload.fields),
    riskLevel: request.riskLevel,
    sourceSummary: request.sourceSummary,
    status: request.status,
    targetHref: request.targetHref,
    targetLabel: request.targetLabel,
    title: request.title,
    warnings: jsonStringArray(request.warnings)
  };
}

type ApplyActivityInput = {
  dealId?: string;
  dueAt?: Date;
  leadId?: string;
  organizationId?: string;
  personId?: string;
  title: string;
  type: ActivityType;
};

type ApplyNoteInput = {
  body: string;
  dealId?: string;
  leadId?: string;
  organizationId?: string;
  personId?: string;
};

type ApplyPlan = {
  apply: (actor: WorkspaceActor) => Promise<{
    auditMetadata: { activityId?: string; noteId?: string };
    result: { activityId?: string; noteId?: string };
  }>;
};

function applyPlanFromRequest(request: {
  actionType: string;
  confidence: string;
  proposedPayload: Prisma.JsonValue;
  riskLevel: string;
  status: AssistantActionRequestStatus;
  targetHref: string | null;
}): ApplyPlan {
  if (request.actionType === "activity") {
    const activityInput = activityInputFromRequest(request);
    return {
      apply: async (actor) => {
        const activity = await createActivity(actor, activityInput);
        return {
          auditMetadata: { activityId: activity.id },
          result: { activityId: activity.id }
        };
      }
    };
  }
  if (request.actionType === "note") {
    const noteInput = noteInputFromRequest(request);
    return {
      apply: async (actor) => {
        const note = await createNote(actor, noteInput);
        return {
          auditMetadata: { noteId: note.id },
          result: { noteId: note.id }
        };
      }
    };
  }
  throw new ApiError("VALIDATION_ERROR", "Apply is only available for low-risk pending activity or note requests with a clear target.", 422);
}

function activityInputFromRequest(request: {
  actionType: string;
  confidence: string;
  proposedPayload: Prisma.JsonValue;
  riskLevel: string;
  status: AssistantActionRequestStatus;
  targetHref: string | null;
}): ApplyActivityInput {
  if (!isSupportedAssistantActionApply(request)) {
    throw new ApiError("VALIDATION_ERROR", "Apply is only available for low-risk pending activity requests with a clear target.", 422);
  }
  const payload = proposedPayloadObject(request.proposedPayload);
  const fields = proposedPayloadFields(payload.fields);
  const title = fieldValue(fields, "Title");
  const type = normalizeApplyActivityType(fieldValue(fields, "Type"));
  const dueAt = normalizeApplyDueDate(fieldValue(fields, "Due date"));
  const relation = crmRelationFromHref(targetHrefForRequest(request));
  if (!title || !relation) {
    throw new ApiError("VALIDATION_ERROR", "Assistant needs a clear activity title and related record before applying.", 422);
  }
  if (!dueAt) {
    throw new ApiError("VALIDATION_ERROR", "Assistant needs a reviewed due date before applying this activity.", 422);
  }
  return {
    ...relation,
    dueAt,
    title,
    type
  };
}

function noteInputFromRequest(request: {
  actionType: string;
  confidence: string;
  proposedPayload: Prisma.JsonValue;
  riskLevel: string;
  status: AssistantActionRequestStatus;
  targetHref: string | null;
}): ApplyNoteInput {
  if (!isSupportedAssistantActionApply(request)) {
    throw new ApiError("VALIDATION_ERROR", "Apply is only available for low-risk pending note requests with a clear target.", 422);
  }
  const payload = proposedPayloadObject(request.proposedPayload);
  const fields = proposedPayloadFields(payload.fields);
  const body = fieldValue(fields, "Body");
  const relation = crmRelationFromHref(targetHrefForRequest(request));
  if (!body || !relation) {
    throw new ApiError("VALIDATION_ERROR", "Assistant needs a clear note body and related record before applying.", 422);
  }
  return {
    ...relation,
    body
  };
}

function targetHrefForRequest(request: { proposedPayload?: Prisma.JsonValue; targetHref: string | null }) {
  const payload = request.proposedPayload ? proposedPayloadObject(request.proposedPayload) : {};
  const payloadTargetHref = typeof payload.targetHref === "string" ? payload.targetHref : "";
  return payloadTargetHref || request.targetHref || "";
}

function crmRelationFromHref(href: string) {
  const match = href.match(/^\/(contacts|deals|leads|organizations)\/([A-Za-z0-9_-]{1,80})$/);
  if (!match) return null;
  const id = match[2];
  if (match[1] === "contacts") return { personId: id };
  if (match[1] === "deals") return { dealId: id };
  if (match[1] === "leads") return { leadId: id };
  return { organizationId: id };
}

function fieldValue(fields: AssistantActionRequestView["proposedFields"], label: string) {
  return fields.find((field) => field.label.toLowerCase() === label.toLowerCase())?.value.trim() ?? "";
}

function normalizeApplyActivityType(value: string): ActivityType {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CALL") return ActivityType.CALL;
  if (normalized === "EMAIL") return ActivityType.EMAIL;
  if (normalized === "MEETING") return ActivityType.MEETING;
  if (normalized === "TASK") return ActivityType.TASK;
  throw new ApiError("VALIDATION_ERROR", "Assistant activity type requires review before applying.", 422);
}

function normalizeApplyDueDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^not detected$/i.test(trimmed)) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("VALIDATION_ERROR", "Assistant activity due date requires review before applying.", 422);
  }
  return date;
}

function proposedPayloadObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function proposedPayloadFields(value: unknown): AssistantActionRequestView["proposedFields"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxStoredArrayItems).flatMap((field) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return [];
    const item = field as Record<string, unknown>;
    const label = typeof item.label === "string" ? item.label : "";
    const fieldValue = typeof item.value === "string" ? item.value : "";
    if (!label || !fieldValue) return [];
    return [{
      currentValue: typeof item.currentValue === "string" ? item.currentValue : null,
      label,
      value: fieldValue
    }];
  });
}

function riskLevelForDraft(draft: AssistantDraftAction) {
  if (draft.kind === "organization_contact_creation") return "high";
  if (draft.kind === "contact_relationship_update") return "medium";
  if (draft.confidence === "needs_clarification" || draft.missingInfo.length > 0 || draft.warnings.length > 1) return "medium";
  return "low";
}

function safeText(value: string, maxLength = maxStoredTextLength) {
  return redactSensitiveText(value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function safeSourceSummary(value: string) {
  return safeText(value, maxStoredSourceLength)
    .replace(
      /\b(?:access_token|accessToken|authorization|client_secret|clientSecret|id_token|idToken|refresh_token|refreshToken|session_token|sessionToken|token)\s*[:=]\s*\[redacted\]/gi,
      "[redacted credential]"
    )
    .replace(/\bAuthorization\s*:\s*Bearer\s+\[redacted\]/gi, "[redacted credential]")
    .slice(0, maxStoredSourceLength);
}

function safeTextArray(values: string[]) {
  return values.map((value) => safeText(value)).filter(Boolean).slice(0, maxStoredArrayItems);
}

function safeHref(value: string) {
  const href = safeText(value, 240);
  return href.startsWith("/") && !href.startsWith("//") ? href : "";
}

function jsonOrNull(values: string[]): Prisma.InputJsonValue | undefined {
  return values.length > 0 ? values : undefined;
}

function jsonStringArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeId(value: string) {
  const id = value.trim();
  if (!id || id.length > 80) throw new ApiError("VALIDATION_ERROR", "Assistant action request id is invalid.", 422);
  return id;
}
