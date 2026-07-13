import { createHash } from "node:crypto";

import { CrmChangeProposalStatus, CrmChangeProposalType, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import {
  assistantActionPermissionKeyForRequest,
  decideAssistantActionPermission,
  permissionActionLabel,
  permissionLevelLabel,
  type AiActionPermissionKey,
  type AssistantActionPermissionDecision
} from "@/lib/services/ai-action-permissions";
import { getAiPreferences } from "@/lib/services/ai-preferences-service";
import { createOrganization, updateOrganization } from "@/lib/services/organization-service";
import { createPerson, updatePerson } from "@/lib/services/contact-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "@/lib/services/workspace-access";

type ProposalCreateInput = {
  confidence?: unknown;
  evidence?: unknown;
  idempotencyKey?: unknown;
  proposedPayload?: unknown;
  rationale?: unknown;
  sourceId?: unknown;
  sourceLabel?: unknown;
  sourceType?: unknown;
  targetEntityId?: unknown;
  proposalType?: unknown;
  warnings?: unknown;
};

type CrmProposalPayload = {
  fields?: Record<string, string>;
  organizationId?: string;
};

type DuplicateCandidate = {
  href: string;
  id: string;
  label: string;
  reason: string;
  type: "organization" | "person";
};

type ConflictInfo = {
  code: string;
  message: string;
  candidates?: DuplicateCandidate[];
};

const proposalLimit = 50;
const supportedPersonFields = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "organizationId",
  "ownerId",
  "relationshipPersonalContext",
  "relationshipCommunicationStyle",
  "relationshipBusinessConcerns",
  "relationshipFollowUpReminders",
  "relationshipInternalGuidance"
] as const;
const supportedOrganizationFields = ["name", "domain", "ownerId"] as const;
const relationshipFields = new Set([
  "relationshipPersonalContext",
  "relationshipCommunicationStyle",
  "relationshipBusinessConcerns",
  "relationshipFollowUpReminders",
  "relationshipInternalGuidance"
]);

export type CrmChangeProposalView = {
  appliedAt: string | null;
  appliedHref: string | null;
  appliedLabel: string | null;
  canApply: boolean;
  confidence: string | null;
  conflictInfo: ConflictInfo | null;
  createdAt: string;
  duplicateCandidates: DuplicateCandidate[];
  editableFields: Array<{ currentValue: string | null; key: string; label: string; proposedValue: string }>;
  evidence: string[];
  id: string;
  permissionActionKey: AiActionPermissionKey | null;
  permissionLabel: string;
  permissionLevel: string;
  permissionReason: string;
  permissionState: AssistantActionPermissionDecision["state"];
  proposalType: CrmChangeProposalType;
  rationale: string | null;
  rejectedAt: string | null;
  sourceId: string | null;
  sourceLabel: string | null;
  sourceType: string;
  status: CrmChangeProposalStatus;
  targetHref: string | null;
  targetLabel: string;
  title: string;
  warnings: string[];
};

export async function createCrmChangeProposal(actor: WorkspaceActor, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const input = normalizeCreateProposalInput(data);
  const permission = await proposalPermissionDecision(actor, input.proposalType, "PENDING");
  if (permission.level === "never_allow") {
    throw new ApiError("FORBIDDEN", `AI Preferences currently never allow ${permissionActionLabel(permission.actionKey ?? "update_contact_or_organization")}.`, 403);
  }

  const existing = await prisma.crmChangeProposal.findFirst({
    where: { workspaceId: actor.workspaceId, idempotencyKey: input.idempotencyKey }
  });
  if (existing) return crmChangeProposalView(existing, permission);

  const currentSnapshot = await currentSnapshotForProposal(actor, input);
  const duplicateCandidates = await duplicateCandidatesForProposal(actor, input.proposalType, input.proposedPayload);
  const proposal = await prisma.crmChangeProposal.create({
    data: {
      confidence: input.confidence,
      createdById: actor.actorUserId,
      currentSnapshot: currentSnapshot ? toJson(currentSnapshot) : Prisma.JsonNull,
      duplicateCandidates: toJson(duplicateCandidates),
      evidence: toJson(input.evidence),
      idempotencyKey: input.idempotencyKey,
      proposedPayload: toJson(input.proposedPayload),
      proposalType: input.proposalType,
      rationale: input.rationale,
      sourceId: input.sourceId,
      sourceLabel: input.sourceLabel,
      sourceType: input.sourceType,
      targetEntityId: input.targetEntityId,
      targetEntityType: targetEntityType(input.proposalType),
      warnings: toJson([...input.warnings, ...duplicateWarnings(duplicateCandidates)]),
      workspaceId: actor.workspaceId
    }
  });
  await writeAuditLog(actor, "crm_change_proposal.created", "CrmChangeProposal", proposal.id, {
    duplicateCandidates: duplicateCandidates.length,
    permissionActionKey: permission.actionKey,
    proposalType: proposal.proposalType,
    sourceType: proposal.sourceType,
    targetEntityId: proposal.targetEntityId
  });
  return crmChangeProposalView(proposal, permission);
}

export async function listCrmChangeProposals(actor: WorkspaceActor, filters: { status?: unknown } = {}) {
  await ensureWorkspaceAccess(actor);
  const status = normalizeStatusFilter(filters.status);
  const proposals = await prisma.crmChangeProposal.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: proposalLimit,
    where: {
      workspaceId: actor.workspaceId,
      ...(status ? { status } : {})
    }
  });
  const permissions = await permissionMapForProposalTypes(actor, proposals.map((proposal) => proposal.proposalType));
  return {
    proposalLimit,
    proposals: proposals.map((proposal) => crmChangeProposalView(proposal, permissions.get(proposal.proposalType) ?? blockedPermission())),
    status
  };
}

export async function getCrmChangeProposal(actor: WorkspaceActor, proposalId: string) {
  await ensureWorkspaceAccess(actor);
  const proposal = await prisma.crmChangeProposal.findFirst({
    where: { id: normalizeId(proposalId), workspaceId: actor.workspaceId }
  });
  if (!proposal) throw new ApiError("NOT_FOUND", "CRM change proposal was not found.", 404);
  return crmChangeProposalView(proposal, await proposalPermissionDecision(actor, proposal.proposalType, proposal.status));
}

export async function rejectCrmChangeProposal(actor: WorkspaceActor, proposalId: string) {
  await ensureWorkspaceAccess(actor);
  const existing = await prisma.crmChangeProposal.findFirst({
    where: { id: normalizeId(proposalId), status: CrmChangeProposalStatus.PENDING, workspaceId: actor.workspaceId }
  });
  if (!existing) throw new ApiError("NOT_FOUND", "CRM change proposal was not found or is no longer pending.", 404);
  const proposal = await prisma.crmChangeProposal.update({
    data: { rejectedAt: new Date(), status: CrmChangeProposalStatus.REJECTED },
    where: { id: existing.id }
  });
  await writeAuditLog(actor, "crm_change_proposal.rejected", "CrmChangeProposal", proposal.id, {
    proposalType: proposal.proposalType,
    sourceType: proposal.sourceType
  });
  return crmChangeProposalView(proposal, await proposalPermissionDecision(actor, proposal.proposalType, proposal.status));
}

export async function applyCrmChangeProposal(actor: WorkspaceActor, proposalId: string, data: unknown = {}) {
  await ensureWorkspaceAccess(actor);
  const existing = await prisma.crmChangeProposal.findFirst({
    where: { id: normalizeId(proposalId), workspaceId: actor.workspaceId }
  });
  if (!existing) throw new ApiError("NOT_FOUND", "CRM change proposal was not found.", 404);
  if (existing.status === CrmChangeProposalStatus.APPLIED) {
    return {
      appliedEntityId: existing.appliedEntityId,
      appliedEntityType: existing.appliedEntityType,
      proposal: crmChangeProposalView(existing, await proposalPermissionDecision(actor, existing.proposalType, existing.status))
    };
  }
  if (existing.status !== CrmChangeProposalStatus.PENDING) {
    throw new ApiError("CONFLICT", "CRM change proposal is no longer pending.", 409);
  }

  const permission = await proposalPermissionDecision(actor, existing.proposalType, existing.status);
  if (!permission.canApply || permission.level !== "require_confirmation") {
    await writeAuditLog(actor, "crm_change_proposal.apply_rejected", "CrmChangeProposal", existing.id, {
      permissionActionKey: permission.actionKey,
      permissionLevel: permission.level,
      proposalType: existing.proposalType,
      reason: permission.reason
    });
    throw new ApiError("FORBIDDEN", permission.reason, 403);
  }

  const editedPayload = normalizeApplyPayload(existing.proposalType, existing.proposedPayload, data);
  const duplicateCandidates = await duplicateCandidatesForProposal(actor, existing.proposalType, editedPayload);
  if (duplicateCandidates.length > 0) {
    const proposal = await failProposal(actor, existing.id, {
      candidates: duplicateCandidates,
      code: "DUPLICATE_CANDIDATES",
      message: "Strong duplicate candidates must be reviewed manually before this proposal can be applied."
    });
    throw new ApiError("CONFLICT", crmChangeProposalView(proposal, permission).conflictInfo?.message ?? "CRM change proposal has duplicate candidates.", 409);
  }

  const staleConflict = await staleConflictForProposal(actor, existing, editedPayload);
  if (staleConflict) {
    const proposal = await failProposal(actor, existing.id, staleConflict);
    throw new ApiError("CONFLICT", crmChangeProposalView(proposal, permission).conflictInfo?.message ?? "CRM change proposal is stale.", 409);
  }

  const applied = await applyProposalPayload(actor, existing.proposalType, existing.targetEntityId, editedPayload, existing.id);
  const proposal = await prisma.crmChangeProposal.update({
    data: {
      appliedAt: new Date(),
      appliedById: actor.actorUserId,
      appliedEntityId: applied.id,
      appliedEntityType: applied.entityType,
      conflictInfo: Prisma.JsonNull,
      proposedPayload: toJson(editedPayload),
      status: CrmChangeProposalStatus.APPLIED
    },
    where: { id: existing.id }
  });
  await writeAuditLog(actor, "crm_change_proposal.applied", "CrmChangeProposal", proposal.id, {
    appliedEntityId: applied.id,
    appliedEntityType: applied.entityType,
    permissionActionKey: permission.actionKey,
    proposalType: proposal.proposalType,
    sourceType: proposal.sourceType
  });
  return {
    appliedEntityId: applied.id,
    appliedEntityType: applied.entityType,
    proposal: crmChangeProposalView(proposal, await proposalPermissionDecision(actor, proposal.proposalType, proposal.status))
  };
}

function normalizeCreateProposalInput(data: unknown) {
  const input = objectInput(data) as ProposalCreateInput;
  const proposalType = normalizeProposalType(input.proposalType);
  const proposedPayload = normalizePayloadForProposal(proposalType, input.proposedPayload, { creating: true });
  const targetEntityId = normalizeTargetEntityId(proposalType, input.targetEntityId);
  const sourceType = normalizeRequiredText(input.sourceType, "Proposal source type is required.", 80);
  const sourceId = normalizeOptionalText(input.sourceId, 160);
  const base = {
    confidence: normalizeOptionalText(input.confidence, 80),
    evidence: normalizeStringArray(input.evidence),
    idempotencyKey: "",
    proposedPayload,
    proposalType,
    rationale: normalizeOptionalText(input.rationale, 1000),
    sourceId,
    sourceLabel: normalizeOptionalText(input.sourceLabel, 200),
    sourceType,
    targetEntityId,
    warnings: normalizeStringArray(input.warnings)
  };
  return {
    ...base,
    idempotencyKey: normalizeOptionalText(input.idempotencyKey, 200) ?? derivedIdempotencyKey(base)
  };
}

function normalizeApplyPayload(proposalType: CrmChangeProposalType, storedPayload: Prisma.JsonValue, data: unknown) {
  const input = objectInput(data);
  const editedFields = objectInput(input.fields);
  if (Object.keys(editedFields).length === 0 && input.organizationId === undefined) {
    return normalizePayloadForProposal(proposalType, storedPayload, { creating: false });
  }
  if (proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
    return normalizePayloadForProposal(proposalType, { organizationId: input.organizationId }, { creating: false });
  }
  return normalizePayloadForProposal(proposalType, { fields: editedFields }, { creating: false });
}

function normalizePayloadForProposal(
  proposalType: CrmChangeProposalType,
  payload: unknown,
  options: { creating: boolean }
): CrmProposalPayload {
  const input = objectInput(payload);
  if (proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
    return { organizationId: normalizeRequiredText(input.organizationId, "Organization id is required for contact linking.", 160) };
  }

  const fields = objectInput(input.fields);
  const allowed = proposalType === CrmChangeProposalType.CREATE_PERSON || proposalType === CrmChangeProposalType.UPDATE_PERSON
    ? supportedPersonFields
    : supportedOrganizationFields;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!(allowed as readonly string[]).includes(key)) {
      throw new ApiError("VALIDATION_ERROR", `${fieldLabel(key)} is not supported for this CRM proposal.`, 422);
    }
    const text = normalizeFieldValue(key, value);
    if (!text) {
      throw new ApiError("VALIDATION_ERROR", "CRM change proposals cannot blank existing fields.", 422);
    }
    normalized[key] = text;
  }
  if (Object.keys(normalized).length === 0) throw new ApiError("VALIDATION_ERROR", "CRM change proposal must include at least one supported field.", 422);
  if (proposalType === CrmChangeProposalType.CREATE_PERSON && !normalized.firstName) {
    throw new ApiError("VALIDATION_ERROR", "Contact first name is required.", 422);
  }
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION && !normalized.name) {
    throw new ApiError("VALIDATION_ERROR", "Organization name is required.", 422);
  }
  if (!options.creating && proposalType === CrmChangeProposalType.UPDATE_PERSON && normalized.firstName === undefined && "firstName" in fields && !normalized.firstName) {
    throw new ApiError("VALIDATION_ERROR", "Contact first name cannot be blank.", 422);
  }
  return { fields: normalized };
}

async function currentSnapshotForProposal(actor: WorkspaceActor, input: ReturnType<typeof normalizeCreateProposalInput>) {
  if (input.proposalType === CrmChangeProposalType.CREATE_PERSON || input.proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return null;
  if (input.proposalType === CrmChangeProposalType.UPDATE_PERSON || input.proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
    const person = await prisma.person.findFirst({
      where: { id: input.targetEntityId ?? "", workspaceId: actor.workspaceId, ...activeWhere },
      select: personSnapshotSelect
    });
    if (!person) throw new ApiError("NOT_FOUND", "Target contact was not found.", 404);
    if (input.proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
      await assertActiveOrganization(actor.workspaceId, input.proposedPayload.organizationId ?? "");
    }
    return personSnapshot(person);
  }
  const organization = await prisma.organization.findFirst({
    where: { id: input.targetEntityId ?? "", workspaceId: actor.workspaceId, ...activeWhere },
    select: organizationSnapshotSelect
  });
  if (!organization) throw new ApiError("NOT_FOUND", "Target organization was not found.", 404);
  return organizationSnapshot(organization);
}

async function duplicateCandidatesForProposal(actor: WorkspaceActor, proposalType: CrmChangeProposalType, payload: CrmProposalPayload): Promise<DuplicateCandidate[]> {
  const candidates: DuplicateCandidate[] = [];
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) {
    const email = payload.fields?.email;
    if (email) {
      const people = await prisma.person.findMany({
        where: { email: { equals: email, mode: "insensitive" }, workspaceId: actor.workspaceId, ...activeWhere },
        select: { email: true, firstName: true, id: true, lastName: true },
        take: 5
      });
      candidates.push(...people.map((person) => ({
        href: `/contacts/${person.id}`,
        id: person.id,
        label: [person.firstName, person.lastName].filter(Boolean).join(" "),
        reason: `Exact email match: ${person.email}`,
        type: "person" as const
      })));
    }
  }
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) {
    const fields = payload.fields ?? {};
    const OR: Prisma.OrganizationWhereInput[] = [];
    if (fields.domain) OR.push({ domain: { equals: normalizeDomain(fields.domain), mode: "insensitive" } });
    if (fields.name) OR.push({ name: { equals: fields.name, mode: "insensitive" } });
    if (OR.length > 0) {
      const organizations = await prisma.organization.findMany({
        where: { OR, workspaceId: actor.workspaceId, ...activeWhere },
        select: { domain: true, id: true, name: true },
        take: 5
      });
      candidates.push(...organizations.map((organization) => ({
        href: `/organizations/${organization.id}`,
        id: organization.id,
        label: organization.name,
        reason: organization.domain ? `Domain/name match: ${organization.domain}` : "Normalized organization name match",
        type: "organization" as const
      })));
    }
  }
  return candidates;
}

async function staleConflictForProposal(
  actor: WorkspaceActor,
  proposal: { currentSnapshot: Prisma.JsonValue; proposalType: CrmChangeProposalType; targetEntityId: string | null },
  payload: CrmProposalPayload
): Promise<ConflictInfo | null> {
  if (proposal.proposalType === CrmChangeProposalType.CREATE_PERSON || proposal.proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return null;
  const snapshot = objectInput(proposal.currentSnapshot);
  const updatedAt = typeof snapshot.updatedAt === "string" ? snapshot.updatedAt : null;
  if (!updatedAt) return null;
  if (proposal.proposalType === CrmChangeProposalType.UPDATE_PERSON || proposal.proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
    const current = await prisma.person.findFirst({
      where: { id: proposal.targetEntityId ?? "", workspaceId: actor.workspaceId, ...activeWhere },
      select: { updatedAt: true }
    });
    if (!current) return { code: "TARGET_UNAVAILABLE", message: "Target contact is unavailable or deleted." };
    if (current.updatedAt.toISOString() !== updatedAt) return { code: "STALE_TARGET", message: "Target contact changed after this proposal was created." };
    if (proposal.proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) await assertActiveOrganization(actor.workspaceId, payload.organizationId ?? "");
    return null;
  }
  const current = await prisma.organization.findFirst({
    where: { id: proposal.targetEntityId ?? "", workspaceId: actor.workspaceId, ...activeWhere },
    select: { updatedAt: true }
  });
  if (!current) return { code: "TARGET_UNAVAILABLE", message: "Target organization is unavailable or deleted." };
  if (current.updatedAt.toISOString() !== updatedAt) return { code: "STALE_TARGET", message: "Target organization changed after this proposal was created." };
  return null;
}

async function applyProposalPayload(
  actor: WorkspaceActor,
  proposalType: CrmChangeProposalType,
  targetEntityId: string | null,
  payload: CrmProposalPayload,
  proposalId: string
) {
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) {
    const person = await createPerson(actor, payload.fields ?? {});
    return { entityType: "Person", id: person.id };
  }
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON) {
    const person = await updatePerson(actor, targetEntityId ?? "", payload.fields ?? {}, {
      auditMetadata: { source: "crm_change_proposal", proposalId }
    });
    return { entityType: "Person", id: person.id };
  }
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) {
    const organization = await createOrganization(actor, payload.fields ?? {});
    return { entityType: "Organization", id: organization.id };
  }
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) {
    const organization = await updateOrganization(actor, targetEntityId ?? "", payload.fields ?? {}, {
      auditMetadata: { source: "crm_change_proposal", proposalId }
    });
    return { entityType: "Organization", id: organization.id };
  }
  const person = await updatePerson(actor, targetEntityId ?? "", { organizationId: payload.organizationId }, {
    auditMetadata: { linkedOrganizationId: payload.organizationId, source: "crm_change_proposal", proposalId }
  });
  return { entityType: "Person", id: person.id };
}

async function failProposal(actor: WorkspaceActor, proposalId: string, conflict: ConflictInfo) {
  const proposal = await prisma.crmChangeProposal.update({
    data: { conflictInfo: toJson(conflict), status: CrmChangeProposalStatus.FAILED },
    where: { id: proposalId }
  });
  await writeAuditLog(actor, "crm_change_proposal.apply_failed", "CrmChangeProposal", proposal.id, {
    conflictCode: conflict.code,
    proposalType: proposal.proposalType
  });
  return proposal;
}

async function proposalPermissionDecision(
  actor: WorkspaceActor,
  proposalType: CrmChangeProposalType,
  status: CrmChangeProposalStatus | "PENDING"
) {
  const preferences = await getAiPreferences(actor);
  return decideAssistantActionPermission({
    actionType: actionTypeForProposal(proposalType),
    permissions: preferences.assistantActionPermissions,
    status,
    technicallyCanApply: true
  });
}

async function permissionMapForProposalTypes(actor: WorkspaceActor, proposalTypes: CrmChangeProposalType[]) {
  const uniqueTypes = Array.from(new Set(proposalTypes));
  const entries = await Promise.all(uniqueTypes.map(async (proposalType) => [proposalType, await proposalPermissionDecision(actor, proposalType, "PENDING")] as const));
  return new Map(entries);
}

function crmChangeProposalView(
  proposal: {
    appliedAt: Date | null;
    appliedEntityId: string | null;
    appliedEntityType: string | null;
    confidence: string | null;
    conflictInfo: Prisma.JsonValue;
    createdAt: Date;
    currentSnapshot: Prisma.JsonValue;
    duplicateCandidates: Prisma.JsonValue;
    evidence: Prisma.JsonValue;
    id: string;
    proposedPayload: Prisma.JsonValue;
    proposalType: CrmChangeProposalType;
    rationale: string | null;
    rejectedAt: Date | null;
    sourceId: string | null;
    sourceLabel: string | null;
    sourceType: string;
    status: CrmChangeProposalStatus;
    targetEntityId: string | null;
    warnings: Prisma.JsonValue;
  },
  permission: AssistantActionPermissionDecision
): CrmChangeProposalView {
  const payload = normalizePayloadForProposal(proposal.proposalType, proposal.proposedPayload, { creating: false });
  const snapshot = objectInput(proposal.currentSnapshot);
  return {
    appliedAt: proposal.appliedAt?.toISOString() ?? null,
    appliedHref: appliedHref(proposal.appliedEntityType, proposal.appliedEntityId),
    appliedLabel: appliedLabel(proposal.appliedEntityType),
    canApply: proposal.status === CrmChangeProposalStatus.PENDING && permission.canApply && permission.level === "require_confirmation",
    confidence: proposal.confidence,
    conflictInfo: conflictFromJson(proposal.conflictInfo),
    createdAt: proposal.createdAt.toISOString(),
    duplicateCandidates: duplicateCandidatesFromJson(proposal.duplicateCandidates),
    editableFields: editableFields(proposal.proposalType, payload, snapshot),
    evidence: normalizeStringArray(proposal.evidence),
    id: proposal.id,
    permissionActionKey: permission.actionKey,
    permissionLabel: permission.actionKey ? permissionActionLabel(permission.actionKey) : "Unsupported CRM action",
    permissionLevel: permissionLevelLabel(permission.level),
    permissionReason: permission.reason,
    permissionState: permission.state,
    proposalType: proposal.proposalType,
    rationale: proposal.rationale,
    rejectedAt: proposal.rejectedAt?.toISOString() ?? null,
    sourceId: proposal.sourceId,
    sourceLabel: proposal.sourceLabel,
    sourceType: proposal.sourceType,
    status: proposal.status,
    targetHref: targetHref(proposal.proposalType, proposal.targetEntityId),
    targetLabel: targetLabel(proposal.proposalType, snapshot),
    title: titleForProposal(proposal.proposalType, payload, snapshot),
    warnings: normalizeStringArray(proposal.warnings)
  };
}

function editableFields(proposalType: CrmChangeProposalType, payload: CrmProposalPayload, snapshot: Record<string, unknown>) {
  if (proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
    return [{
      currentValue: snapshot.organizationId ? String(snapshot.organizationId) : null,
      key: "organizationId",
      label: "Organization",
      proposedValue: payload.organizationId ?? ""
    }];
  }
  return Object.entries(payload.fields ?? {}).map(([key, value]) => ({
    currentValue: currentFieldValue(snapshot, key),
    key,
    label: fieldLabel(key),
    proposedValue: value
  }));
}

function currentFieldValue(snapshot: Record<string, unknown>, key: string) {
  const fields = objectInput(snapshot.fields);
  const value = fields[key];
  return value === null || value === undefined ? null : String(value);
}

function normalizeProposalType(value: unknown) {
  if (Object.values(CrmChangeProposalType).includes(value as CrmChangeProposalType)) return value as CrmChangeProposalType;
  throw new ApiError("VALIDATION_ERROR", "CRM change proposal type is unsupported.", 422);
}

function normalizeStatusFilter(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  if (Object.values(CrmChangeProposalStatus).includes(value as CrmChangeProposalStatus)) return value as CrmChangeProposalStatus;
  throw new ApiError("VALIDATION_ERROR", "CRM change proposal status is unsupported.", 422);
}

function normalizeTargetEntityId(proposalType: CrmChangeProposalType, value: unknown) {
  if (proposalType === CrmChangeProposalType.CREATE_PERSON || proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return null;
  return normalizeRequiredText(value, "Target record id is required.", 160);
}

function normalizeFieldValue(key: string, value: unknown) {
  const text = normalizeRequiredText(value, `${fieldLabel(key)} must be text.`, relationshipFields.has(key) ? 2000 : 320);
  if (key === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    throw new ApiError("VALIDATION_ERROR", "Contact email must be a valid email address.", 422);
  }
  if (key === "domain") return normalizeDomain(text);
  return text;
}

function normalizeDomain(value: string) {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
}

function normalizeRequiredText(value: unknown, message: string, maxLength: number) {
  if (typeof value !== "string") throw new ApiError("VALIDATION_ERROR", message, 422);
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", message, 422);
  return trimmed;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new ApiError("VALIDATION_ERROR", "CRM change proposal text fields must be text.", 422);
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return trimmed || null;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim().slice(0, 400)] : []).slice(0, 12);
}

function objectInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function normalizeId(value: string) {
  const id = value.trim();
  if (!id) throw new ApiError("VALIDATION_ERROR", "CRM change proposal id is required.", 422);
  return id;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function derivedIdempotencyKey(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function actionTypeForProposal(proposalType: CrmChangeProposalType) {
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) return "crm_change_create_person";
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON) return "crm_change_update_person";
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return "crm_change_create_organization";
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) return "crm_change_update_organization";
  return "crm_change_link_person_organization";
}

function blockedPermission(): AssistantActionPermissionDecision {
  return {
    actionKey: assistantActionPermissionKeyForRequest("crm_change_update_person"),
    canApply: false,
    level: "suggest_only",
    reason: "CRM change proposal permission is unavailable.",
    state: "blocked"
  };
}

function targetEntityType(proposalType: CrmChangeProposalType) {
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON || proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) return "Person";
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) return "Organization";
  return null;
}

function targetHref(proposalType: CrmChangeProposalType, targetEntityId: string | null) {
  if (!targetEntityId) return null;
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON || proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) return `/contacts/${targetEntityId}`;
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) return `/organizations/${targetEntityId}`;
  return null;
}

function appliedHref(entityType: string | null, entityId: string | null) {
  if (!entityId) return null;
  if (entityType === "Person") return `/contacts/${entityId}`;
  if (entityType === "Organization") return `/organizations/${entityId}`;
  return null;
}

function appliedLabel(entityType: string | null) {
  if (entityType === "Person") return "Applied contact";
  if (entityType === "Organization") return "Applied organization";
  return null;
}

function targetLabel(proposalType: CrmChangeProposalType, snapshot: Record<string, unknown>) {
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) return "New contact";
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return "New organization";
  const label = typeof snapshot.label === "string" ? snapshot.label : "";
  return label || "Existing CRM record";
}

function titleForProposal(proposalType: CrmChangeProposalType, payload: CrmProposalPayload, snapshot: Record<string, unknown>) {
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) return `Create contact: ${payload.fields?.firstName ?? "Unnamed contact"}`;
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON) return `Update contact: ${targetLabel(proposalType, snapshot)}`;
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return `Create organization: ${payload.fields?.name ?? "Unnamed organization"}`;
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) return `Update organization: ${targetLabel(proposalType, snapshot)}`;
  return `Link contact to organization: ${targetLabel(proposalType, snapshot)}`;
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    domain: "Domain",
    email: "Email",
    firstName: "First name",
    lastName: "Last name",
    organizationId: "Organization",
    ownerId: "Owner",
    phone: "Phone",
    relationshipBusinessConcerns: "Business concerns",
    relationshipCommunicationStyle: "Communication style",
    relationshipFollowUpReminders: "Follow-up reminders",
    relationshipInternalGuidance: "Internal guidance",
    relationshipPersonalContext: "Personal context",
    name: "Name"
  };
  return labels[key] ?? key;
}

function duplicateWarnings(candidates: DuplicateCandidate[]) {
  return candidates.length > 0 ? [`${candidates.length} strong duplicate candidate${candidates.length === 1 ? "" : "s"} found. Apply is blocked until reviewed manually.`] : [];
}

function duplicateCandidatesFromJson(value: Prisma.JsonValue): DuplicateCandidate[] {
  return Array.isArray(value) ? value.filter(isDuplicateCandidate) : [];
}

function conflictFromJson(value: Prisma.JsonValue): ConflictInfo | null {
  const input = objectInput(value);
  if (typeof input.code !== "string" || typeof input.message !== "string") return null;
  return {
    candidates: duplicateCandidatesFromJson(input.candidates as Prisma.JsonValue),
    code: input.code,
    message: input.message
  };
}

function isDuplicateCandidate(value: unknown): value is DuplicateCandidate {
  const input = objectInput(value);
  return typeof input.id === "string" && typeof input.href === "string" && typeof input.label === "string" && typeof input.reason === "string";
}

async function assertActiveOrganization(workspaceId: string, organizationId: string) {
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId, workspaceId, ...activeWhere },
    select: { id: true }
  });
  if (!organization) throw new ApiError("NOT_FOUND", "Target organization was not found.", 404);
}

const personSnapshotSelect = {
  email: true,
  firstName: true,
  id: true,
  lastName: true,
  organizationId: true,
  ownerId: true,
  phone: true,
  relationshipBusinessConcerns: true,
  relationshipCommunicationStyle: true,
  relationshipFollowUpReminders: true,
  relationshipInternalGuidance: true,
  relationshipPersonalContext: true,
  updatedAt: true
} satisfies Prisma.PersonSelect;

const organizationSnapshotSelect = {
  domain: true,
  id: true,
  name: true,
  ownerId: true,
  updatedAt: true
} satisfies Prisma.OrganizationSelect;

function personSnapshot(person: Prisma.PersonGetPayload<{ select: typeof personSnapshotSelect }>) {
  return {
    fields: {
      email: person.email,
      firstName: person.firstName,
      lastName: person.lastName,
      organizationId: person.organizationId,
      ownerId: person.ownerId,
      phone: person.phone,
      relationshipBusinessConcerns: person.relationshipBusinessConcerns,
      relationshipCommunicationStyle: person.relationshipCommunicationStyle,
      relationshipFollowUpReminders: person.relationshipFollowUpReminders,
      relationshipInternalGuidance: person.relationshipInternalGuidance,
      relationshipPersonalContext: person.relationshipPersonalContext
    },
    id: person.id,
    label: [person.firstName, person.lastName].filter(Boolean).join(" "),
    organizationId: person.organizationId,
    updatedAt: person.updatedAt.toISOString()
  };
}

function organizationSnapshot(organization: Prisma.OrganizationGetPayload<{ select: typeof organizationSnapshotSelect }>) {
  return {
    fields: {
      domain: organization.domain,
      name: organization.name,
      ownerId: organization.ownerId
    },
    id: organization.id,
    label: organization.name,
    updatedAt: organization.updatedAt.toISOString()
  };
}
