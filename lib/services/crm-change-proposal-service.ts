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

type CompoundContactOrganizationProposalInput = Omit<ProposalCreateInput, "proposalType" | "proposedPayload" | "targetEntityId"> & {
  contact?: unknown;
  linkContactToOrganization?: unknown;
  organization?: unknown;
};

type CrmProposalPayload = {
  fields?: Record<string, string>;
  organizationId?: string;
};

type CompoundCrmProposalPayload = {
  contact: CompoundContactStep;
  linkContactToOrganization: boolean;
  organization: CompoundOrganizationStep;
};

type CompoundContactStep = {
  action: "create" | "existing" | "update";
  fields?: Record<string, string>;
  id?: string;
};

type CompoundOrganizationStep = {
  action: "create" | "existing" | "update";
  fields?: Record<string, string>;
  id?: string;
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

type ProposalPermissionDecision = AssistantActionPermissionDecision & {
  checks: AssistantActionPermissionDecision[];
};

const proposalLimit = 50;
const supportedPersonFields = [
  "firstName",
  "lastName",
  "title",
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
  changeGroups: Array<{
    description: string | null;
    fields: Array<{ currentValue: string | null; inputName: string; key: string; label: string; proposedValue: string }>;
    key: string;
    targetHref: string | null;
    targetLabel: string;
    title: string;
  }>;
  editableFields: Array<{ currentValue: string | null; inputName: string; key: string; label: string; proposedValue: string }>;
  evidence: string[];
  id: string;
  idempotencyKey: string;
  permissionActionKey: AiActionPermissionKey | null;
  permissionChecks: Array<{
    actionKey: AiActionPermissionKey | null;
    canApply: boolean;
    label: string;
    level: string;
    reason: string;
    state: AssistantActionPermissionDecision["state"];
  }>;
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
  const permission = await proposalPermissionDecisionForPayload(actor, input.proposalType, "PENDING", input.proposedPayload);
  const blockedCheck = permission.checks.find((check) => check.level === "never_allow");
  if (blockedCheck) {
    throw new ApiError("FORBIDDEN", `AI Preferences currently never allow ${permissionActionLabel(blockedCheck.actionKey ?? "update_contact_or_organization")}.`, 403);
  }

  const existing = await prisma.crmChangeProposal.findFirst({
    where: { workspaceId: actor.workspaceId, idempotencyKey: input.idempotencyKey }
  });
  if (existing) return crmChangeProposalView(existing, permission);

  const currentSnapshot = await currentSnapshotForProposal(actor, input);
  const duplicateCandidates = await duplicateCandidatesForProposal(actor, input.proposalType, input.proposedPayload, {
    targetEntityId: input.targetEntityId
  });
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
    permissionActionKeys: permission.checks.map((check) => check.actionKey).filter(Boolean),
    proposalType: proposal.proposalType,
    sourceType: proposal.sourceType,
    targetEntityId: proposal.targetEntityId
  });
  return crmChangeProposalView(proposal, permission);
}

export async function createContactOrganizationChangeProposal(
  actor: WorkspaceActor,
  data: CompoundContactOrganizationProposalInput
) {
  return createCrmChangeProposal(actor, {
    ...data,
    proposedPayload: {
      contact: data.contact,
      linkContactToOrganization: data.linkContactToOrganization,
      organization: data.organization
    },
    proposalType: CrmChangeProposalType.COMPOUND_PERSON_ORGANIZATION,
    targetEntityId: undefined
  });
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
  const permissions = await Promise.all(proposals.map((proposal) => permissionDecisionForStoredProposal(actor, proposal)));
  return {
    proposalLimit,
    proposals: proposals.map((proposal, index) => crmChangeProposalView(proposal, permissions[index] ?? blockedPermission())),
    status
  };
}

export async function getCrmChangeProposal(actor: WorkspaceActor, proposalId: string) {
  await ensureWorkspaceAccess(actor);
  const proposal = await prisma.crmChangeProposal.findFirst({
    where: { id: normalizeId(proposalId), workspaceId: actor.workspaceId }
  });
  if (!proposal) throw new ApiError("NOT_FOUND", "CRM change proposal was not found.", 404);
  return crmChangeProposalView(proposal, await permissionDecisionForStoredProposal(actor, proposal));
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
  return crmChangeProposalView(proposal, await permissionDecisionForStoredProposal(actor, proposal));
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
      proposal: crmChangeProposalView(existing, await permissionDecisionForStoredProposal(actor, existing))
    };
  }
  if (existing.status !== CrmChangeProposalStatus.PENDING) {
    throw new ApiError("CONFLICT", "CRM change proposal is no longer pending.", 409);
  }

  const permission = await permissionDecisionForStoredProposal(actor, existing);
  if (!permission.canApply || permission.level !== "require_confirmation") {
    await writeAuditLog(actor, "crm_change_proposal.apply_rejected", "CrmChangeProposal", existing.id, {
      permissionActionKeys: permission.checks.map((check) => check.actionKey).filter(Boolean),
      permissionLevel: permission.level,
      proposalType: existing.proposalType,
      reason: permission.reason
    });
    throw new ApiError("FORBIDDEN", permission.reason, 403);
  }

  const editedPayload = normalizeApplyPayload(existing.proposalType, existing.proposedPayload, data);
  const duplicateCandidates = await duplicateCandidatesForProposal(actor, existing.proposalType, editedPayload, {
    targetEntityId: existing.targetEntityId
  });
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

  if (isCompoundProposalType(existing.proposalType)) {
    return applyCompoundProposalPayload(actor, existing, editedPayload as CompoundCrmProposalPayload, permission);
  }

  const applied = await applyProposalPayload(actor, existing.proposalType, existing.targetEntityId, editedPayload as CrmProposalPayload, existing.id);
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
    proposal: crmChangeProposalView(proposal, await permissionDecisionForStoredProposal(actor, proposal))
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
  if (isCompoundProposalType(proposalType)) {
    return normalizeCompoundApplyPayload(storedPayload, editedFields);
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
): CrmProposalPayload | CompoundCrmProposalPayload {
  const input = objectInput(payload);
  if (isCompoundProposalType(proposalType)) {
    return normalizeCompoundPayload(input, options);
  }
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

function normalizeCompoundApplyPayload(storedPayload: Prisma.JsonValue, editedFields: Record<string, unknown>) {
  const payload = normalizeCompoundPayload(objectInput(storedPayload), { creating: false });
  const contactFields = payload.contact.fields ? { ...payload.contact.fields } : undefined;
  const organizationFields = payload.organization.fields ? { ...payload.organization.fields } : undefined;

  for (const [key, value] of Object.entries(editedFields)) {
    const [scope, fieldKey] = key.split(".");
    if (scope === "contact" && contactFields && fieldKey) {
      contactFields[fieldKey] = normalizeFieldValue(fieldKey, value);
    }
    if (scope === "organization" && organizationFields && fieldKey) {
      organizationFields[fieldKey] = normalizeFieldValue(fieldKey, value);
    }
  }

  return normalizeCompoundPayload({
    contact: { ...payload.contact, fields: contactFields },
    linkContactToOrganization: payload.linkContactToOrganization,
    organization: { ...payload.organization, fields: organizationFields }
  }, { creating: false });
}

function normalizeCompoundPayload(payload: Record<string, unknown>, _options: { creating: boolean }): CompoundCrmProposalPayload {
  const contact = normalizeCompoundContactStep(payload.contact);
  const organization = normalizeCompoundOrganizationStep(payload.organization);
  const linkContactToOrganization = payload.linkContactToOrganization === undefined ? true : payload.linkContactToOrganization === true;
  if (payload.linkContactToOrganization !== undefined && typeof payload.linkContactToOrganization !== "boolean") {
    throw new ApiError("VALIDATION_ERROR", "Compound proposal link flag must be true or false.", 422);
  }
  if (
    contact.action === "existing" &&
    organization.action === "existing" &&
    !linkContactToOrganization
  ) {
    throw new ApiError("VALIDATION_ERROR", "Compound proposal must include at least one reviewed CRM change.", 422);
  }
  if (linkContactToOrganization && contact.action === "existing" && organization.action === "existing") {
    return { contact, linkContactToOrganization, organization };
  }
  return { contact, linkContactToOrganization, organization };
}

function normalizeCompoundContactStep(value: unknown): CompoundContactStep {
  const input = objectInput(value);
  const action = normalizeCompoundAction(input.action, "Contact compound action is required.");
  const id = action === "create" ? undefined : normalizeRequiredText(input.id, "Contact id is required for this compound proposal.", 160);
  const fields = action === "existing"
    ? undefined
    : normalizeFieldsForProposal(CrmChangeProposalType.UPDATE_PERSON, input.fields, {
      creating: action === "create",
      entityLabel: "Contact"
    });
  if (action === "create" && !fields?.firstName) throw new ApiError("VALIDATION_ERROR", "Contact first name is required.", 422);
  return omitUndefined({ action, fields, id });
}

function normalizeCompoundOrganizationStep(value: unknown): CompoundOrganizationStep {
  const input = objectInput(value);
  const action = normalizeCompoundAction(input.action, "Organization compound action is required.");
  const id = action === "create" ? undefined : normalizeRequiredText(input.id, "Organization id is required for this compound proposal.", 160);
  const fields = action === "existing"
    ? undefined
    : normalizeFieldsForProposal(CrmChangeProposalType.UPDATE_ORGANIZATION, input.fields, {
      creating: action === "create",
      entityLabel: "Organization"
    });
  if (action === "create" && !fields?.name) throw new ApiError("VALIDATION_ERROR", "Organization name is required.", 422);
  return omitUndefined({ action, fields, id });
}

function normalizeCompoundAction(value: unknown, message: string): "create" | "existing" | "update" {
  if (value === "create" || value === "existing" || value === "update") return value;
  throw new ApiError("VALIDATION_ERROR", message, 422);
}

function normalizeFieldsForProposal(
  proposalType: CrmChangeProposalType,
  fieldsInput: unknown,
  _options: { creating: boolean; entityLabel: string }
) {
  const fields = objectInput(fieldsInput);
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
  return normalized;
}

async function currentSnapshotForProposal(actor: WorkspaceActor, input: ReturnType<typeof normalizeCreateProposalInput>) {
  if (input.proposalType === CrmChangeProposalType.CREATE_PERSON || input.proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return null;
  if (isCompoundProposalType(input.proposalType)) {
    return currentSnapshotForCompoundProposal(actor, input.proposedPayload as CompoundCrmProposalPayload);
  }
  if (input.proposalType === CrmChangeProposalType.UPDATE_PERSON || input.proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
    const person = await prisma.person.findFirst({
      where: { id: input.targetEntityId ?? "", workspaceId: actor.workspaceId, ...activeWhere },
      select: personSnapshotSelect
    });
    if (!person) throw new ApiError("NOT_FOUND", "Target contact was not found.", 404);
    if (input.proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
      await assertActiveOrganization(actor.workspaceId, (input.proposedPayload as CrmProposalPayload).organizationId ?? "");
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

async function currentSnapshotForCompoundProposal(actor: WorkspaceActor, payload: CompoundCrmProposalPayload) {
  const [person, organization] = await Promise.all([
    payload.contact.action === "create"
      ? null
      : prisma.person.findFirst({
        where: { id: payload.contact.id ?? "", workspaceId: actor.workspaceId, ...activeWhere },
        select: personSnapshotSelect
      }),
    payload.organization.action === "create"
      ? null
      : prisma.organization.findFirst({
        where: { id: payload.organization.id ?? "", workspaceId: actor.workspaceId, ...activeWhere },
        select: organizationSnapshotSelect
      })
  ]);
  if (payload.contact.action !== "create" && !person) throw new ApiError("NOT_FOUND", "Target contact was not found.", 404);
  if (payload.organization.action !== "create" && !organization) throw new ApiError("NOT_FOUND", "Target organization was not found.", 404);
  return {
    contact: person ? personSnapshot(person) : null,
    organization: organization ? organizationSnapshot(organization) : null
  };
}

async function duplicateCandidatesForProposal(
  actor: WorkspaceActor,
  proposalType: CrmChangeProposalType,
  payload: CrmProposalPayload | CompoundCrmProposalPayload,
  options: { targetEntityId?: string | null } = {}
): Promise<DuplicateCandidate[]> {
  if (isCompoundProposalType(proposalType)) {
    return duplicateCandidatesForCompoundProposal(actor, payload as CompoundCrmProposalPayload);
  }
  const simplePayload = payload as CrmProposalPayload;
  const candidates: DuplicateCandidate[] = [];
  if (proposalType === CrmChangeProposalType.CREATE_PERSON || proposalType === CrmChangeProposalType.UPDATE_PERSON) {
    const email = simplePayload.fields?.email;
    if (email) {
      const people = await prisma.person.findMany({
        where: {
          email: { equals: email, mode: "insensitive" },
          id: options.targetEntityId ? { not: options.targetEntityId } : undefined,
          workspaceId: actor.workspaceId,
          ...activeWhere
        },
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
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION || proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) {
    const fields = simplePayload.fields ?? {};
    const OR: Prisma.OrganizationWhereInput[] = [];
    if (fields.domain) OR.push({ domain: { equals: normalizeDomain(fields.domain), mode: "insensitive" } });
    if (fields.name) OR.push({ name: { equals: fields.name, mode: "insensitive" } });
    if (OR.length > 0) {
      const organizations = await prisma.organization.findMany({
        where: {
          OR,
          id: options.targetEntityId ? { not: options.targetEntityId } : undefined,
          workspaceId: actor.workspaceId,
          ...activeWhere
        },
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

async function duplicateCandidatesForCompoundProposal(actor: WorkspaceActor, payload: CompoundCrmProposalPayload) {
  const contactTargetId = payload.contact.action === "create" ? null : payload.contact.id ?? null;
  const organizationTargetId = payload.organization.action === "create" ? null : payload.organization.id ?? null;
  const [contactCandidates, organizationCandidates] = await Promise.all([
    payload.contact.action === "existing"
      ? Promise.resolve([])
      : duplicateCandidatesForProposal(actor, payload.contact.action === "create" ? CrmChangeProposalType.CREATE_PERSON : CrmChangeProposalType.UPDATE_PERSON, {
        fields: payload.contact.fields ?? {}
      }, { targetEntityId: contactTargetId }),
    payload.organization.action === "existing"
      ? Promise.resolve([])
      : duplicateCandidatesForProposal(actor, payload.organization.action === "create" ? CrmChangeProposalType.CREATE_ORGANIZATION : CrmChangeProposalType.UPDATE_ORGANIZATION, {
        fields: payload.organization.fields ?? {}
      }, { targetEntityId: organizationTargetId })
  ]);
  return [...contactCandidates, ...organizationCandidates];
}

async function staleConflictForProposal(
  actor: WorkspaceActor,
  proposal: { currentSnapshot: Prisma.JsonValue; proposalType: CrmChangeProposalType; targetEntityId: string | null },
  payload: CrmProposalPayload | CompoundCrmProposalPayload
): Promise<ConflictInfo | null> {
  if (proposal.proposalType === CrmChangeProposalType.CREATE_PERSON || proposal.proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return null;
  if (isCompoundProposalType(proposal.proposalType)) {
    return staleConflictForCompoundProposal(actor, proposal.currentSnapshot, payload as CompoundCrmProposalPayload);
  }
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
    if (proposal.proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) await assertActiveOrganization(actor.workspaceId, (payload as CrmProposalPayload).organizationId ?? "");
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

async function staleConflictForCompoundProposal(
  actor: WorkspaceActor,
  currentSnapshot: Prisma.JsonValue,
  payload: CompoundCrmProposalPayload
): Promise<ConflictInfo | null> {
  const snapshot = objectInput(currentSnapshot);
  const contactSnapshot = objectInput(snapshot.contact);
  const organizationSnapshot = objectInput(snapshot.organization);
  if (payload.contact.action !== "create") {
    const updatedAt = typeof contactSnapshot.updatedAt === "string" ? contactSnapshot.updatedAt : null;
    const current = await prisma.person.findFirst({
      where: { id: payload.contact.id ?? "", workspaceId: actor.workspaceId, ...activeWhere },
      select: { updatedAt: true }
    });
    if (!current) return { code: "TARGET_UNAVAILABLE", message: "Target contact is unavailable or deleted." };
    if (updatedAt && current.updatedAt.toISOString() !== updatedAt) {
      return { code: "STALE_TARGET", message: "Target contact changed after this proposal was created." };
    }
  }
  if (payload.organization.action !== "create") {
    const updatedAt = typeof organizationSnapshot.updatedAt === "string" ? organizationSnapshot.updatedAt : null;
    const current = await prisma.organization.findFirst({
      where: { id: payload.organization.id ?? "", workspaceId: actor.workspaceId, ...activeWhere },
      select: { updatedAt: true }
    });
    if (!current) return { code: "TARGET_UNAVAILABLE", message: "Target organization is unavailable or deleted." };
    if (updatedAt && current.updatedAt.toISOString() !== updatedAt) {
      return { code: "STALE_TARGET", message: "Target organization changed after this proposal was created." };
    }
  }
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

async function applyCompoundProposalPayload(
  actor: WorkspaceActor,
  existing: {
    id: string;
    proposalType: CrmChangeProposalType;
    sourceType: string;
  },
  payload: CompoundCrmProposalPayload,
  permission: ProposalPermissionDecision
) {
  const applied = await prisma.$transaction(async (tx) => {
    let organizationId = payload.organization.id ?? "";
    let organizationChanged = false;

    if (payload.organization.action === "create") {
      await assertOwnerInWorkspaceTx(tx, actor.workspaceId, payload.organization.fields?.ownerId);
      const organization = await tx.organization.create({
        data: { ...(payload.organization.fields ?? {}), workspaceId: actor.workspaceId } as Prisma.OrganizationUncheckedCreateInput
      });
      organizationId = organization.id;
      organizationChanged = true;
      await writeAuditLogTx(tx, actor, "organization.created", "Organization", organization.id, {
        name: organization.name,
        source: "crm_change_proposal",
        proposalId: existing.id
      });
    } else if (payload.organization.action === "update") {
      await assertOwnerInWorkspaceTx(tx, actor.workspaceId, payload.organization.fields?.ownerId);
      const organization = await tx.organization.update({
        data: payload.organization.fields ?? {},
        where: { id: payload.organization.id }
      });
      organizationId = organization.id;
      organizationChanged = true;
      await writeAuditLogTx(tx, actor, "organization.updated", "Organization", organization.id, {
        changedFields: Object.keys(payload.organization.fields ?? {}),
        source: "crm_change_proposal",
        proposalId: existing.id
      });
    }

    let contactId = payload.contact.id ?? "";
    const contactFields = { ...(payload.contact.fields ?? {}) };
    if (payload.linkContactToOrganization) contactFields.organizationId = organizationId;

    if (payload.contact.action === "create") {
      await assertOwnerInWorkspaceTx(tx, actor.workspaceId, contactFields.ownerId);
      if (contactFields.organizationId) await assertOrganizationInWorkspaceTx(tx, actor.workspaceId, contactFields.organizationId);
      const person = await tx.person.create({
        data: { ...contactFields, workspaceId: actor.workspaceId } as Prisma.PersonUncheckedCreateInput
      });
      contactId = person.id;
      await writeAuditLogTx(tx, actor, "person.created", "Person", person.id, {
        email: person.email,
        linkedOrganizationId: payload.linkContactToOrganization ? organizationId : undefined,
        source: "crm_change_proposal",
        proposalId: existing.id
      });
    } else if (payload.contact.action === "update" || payload.linkContactToOrganization) {
      await assertOwnerInWorkspaceTx(tx, actor.workspaceId, contactFields.ownerId);
      if (contactFields.organizationId) await assertOrganizationInWorkspaceTx(tx, actor.workspaceId, contactFields.organizationId);
      const person = await tx.person.update({
        data: contactFields,
        where: { id: payload.contact.id }
      });
      contactId = person.id;
      await writeAuditLogTx(tx, actor, "person.updated", "Person", person.id, {
        changedFields: Object.keys(contactFields),
        linkedOrganizationId: payload.linkContactToOrganization ? organizationId : undefined,
        source: "crm_change_proposal",
        proposalId: existing.id
      });
    }

    const proposal = await tx.crmChangeProposal.update({
      data: {
        appliedAt: new Date(),
        appliedById: actor.actorUserId,
        appliedEntityId: contactId || (organizationChanged ? organizationId : null),
        appliedEntityType: contactId ? "Person" : organizationChanged ? "Organization" : null,
        conflictInfo: Prisma.JsonNull,
        proposedPayload: toJson(payload),
        status: CrmChangeProposalStatus.APPLIED
      },
      where: { id: existing.id }
    });
    await writeAuditLogTx(tx, actor, "crm_change_proposal.applied", "CrmChangeProposal", proposal.id, {
      appliedContactId: contactId || null,
      appliedOrganizationId: organizationId || null,
      permissionActionKeys: permission.checks.map((check) => check.actionKey).filter(Boolean),
      proposalType: proposal.proposalType,
      sourceType: proposal.sourceType
    });
    return { contactId, organizationId, proposal };
  });

  return {
    appliedEntityId: applied.proposal.appliedEntityId,
    appliedEntityType: applied.proposal.appliedEntityType,
    proposal: crmChangeProposalView(applied.proposal, await permissionDecisionForStoredProposal(actor, applied.proposal))
  };
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

async function permissionDecisionForStoredProposal(
  actor: WorkspaceActor,
  proposal: { proposedPayload: Prisma.JsonValue; proposalType: CrmChangeProposalType; status: CrmChangeProposalStatus | "PENDING" }
) {
  const payload = normalizePayloadForProposal(proposal.proposalType, proposal.proposedPayload, { creating: false });
  return proposalPermissionDecisionForPayload(actor, proposal.proposalType, proposal.status, payload);
}

async function proposalPermissionDecisionForPayload(
  actor: WorkspaceActor,
  proposalType: CrmChangeProposalType,
  status: CrmChangeProposalStatus | "PENDING",
  payload: CrmProposalPayload | CompoundCrmProposalPayload
): Promise<ProposalPermissionDecision> {
  const preferences = await getAiPreferences(actor);
  const actionTypes = actionTypesForProposal(proposalType, payload);
  const checks = actionTypes.map((actionType) => decideAssistantActionPermission({
    actionType,
    permissions: preferences.assistantActionPermissions,
    status,
    technicallyCanApply: true
  }));
  return aggregatePermissionDecision(checks);
}

function aggregatePermissionDecision(checks: AssistantActionPermissionDecision[]): ProposalPermissionDecision {
  const firstBlocked = checks.find((check) => !check.canApply || check.level !== "require_confirmation");
  const primary = firstBlocked ?? checks[0] ?? blockedPermission();
  const allRequireConfirmation = checks.length > 0 && checks.every((check) => check.canApply && check.level === "require_confirmation");
  return {
    actionKey: checks.length === 1 ? checks[0].actionKey : null,
    canApply: allRequireConfirmation,
    checks,
    level: allRequireConfirmation ? "require_confirmation" : primary.level,
    reason: allRequireConfirmation
      ? "All included CRM actions require explicit confirmation and can be applied after review."
      : primary.reason,
    state: allRequireConfirmation ? "requires_confirmation" : primary.state
  };
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
    idempotencyKey: string;
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
  permission: ProposalPermissionDecision
): CrmChangeProposalView {
  const payload = normalizePayloadForProposal(proposal.proposalType, proposal.proposedPayload, { creating: false });
  const snapshot = objectInput(proposal.currentSnapshot);
  const changeGroups = editableChangeGroups(proposal.proposalType, payload, snapshot);
  const permissionChecks = permission.checks.map((check) => ({
    actionKey: check.actionKey,
    canApply: check.canApply,
    label: check.actionKey ? permissionActionLabel(check.actionKey) : "Unsupported CRM action",
    level: permissionLevelLabel(check.level),
    reason: check.reason,
    state: check.state
  }));
  return {
    appliedAt: proposal.appliedAt?.toISOString() ?? null,
    appliedHref: appliedHref(proposal.appliedEntityType, proposal.appliedEntityId),
    appliedLabel: appliedLabel(proposal.appliedEntityType),
    canApply: proposal.status === CrmChangeProposalStatus.PENDING && permission.canApply && permission.level === "require_confirmation",
    confidence: proposal.confidence,
    conflictInfo: conflictFromJson(proposal.conflictInfo),
    createdAt: proposal.createdAt.toISOString(),
    duplicateCandidates: duplicateCandidatesFromJson(proposal.duplicateCandidates),
    changeGroups,
    editableFields: changeGroups.flatMap((group) => group.fields),
    evidence: normalizeStringArray(proposal.evidence),
    id: proposal.id,
    idempotencyKey: proposal.idempotencyKey,
    permissionActionKey: permission.actionKey,
    permissionChecks,
    permissionLabel: permissionChecks.length > 1 ? permissionChecks.map((check) => check.label).join(", ") : permissionChecks[0]?.label ?? "Unsupported CRM action",
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

function editableChangeGroups(
  proposalType: CrmChangeProposalType,
  payload: CrmProposalPayload | CompoundCrmProposalPayload,
  snapshot: Record<string, unknown>
) {
  if (isCompoundProposalType(proposalType)) {
    return compoundChangeGroups(payload as CompoundCrmProposalPayload, snapshot);
  }
  if (proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) {
    return [{
      description: "Existing contact will be linked to the reviewed organization.",
      fields: [{
        currentValue: snapshot.organizationId ? String(snapshot.organizationId) : null,
        inputName: "organizationId",
        key: "organizationId",
        label: "Organization",
        proposedValue: (payload as CrmProposalPayload).organizationId ?? ""
      }],
      key: "contact-link",
      targetHref: targetHref(proposalType, typeof snapshot.id === "string" ? snapshot.id : null),
      targetLabel: targetLabel(proposalType, snapshot),
      title: "Contact link"
    }];
  }
  return [{
    description: null,
    fields: Object.entries((payload as CrmProposalPayload).fields ?? {}).map(([key, value]) => ({
      currentValue: currentFieldValue(snapshot, key),
      inputName: `field.${key}`,
      key,
      label: fieldLabel(key),
      proposedValue: value
    })),
    key: "record",
    targetHref: targetHref(proposalType, typeof snapshot.id === "string" ? snapshot.id : null),
    targetLabel: targetLabel(proposalType, snapshot),
    title: targetLabel(proposalType, snapshot)
  }];
}

function compoundChangeGroups(payload: CompoundCrmProposalPayload, snapshot: Record<string, unknown>) {
  const contactSnapshot = objectInput(snapshot.contact);
  const organizationSnapshot = objectInput(snapshot.organization);
  const groups: CrmChangeProposalView["changeGroups"] = [];
  if (payload.organization.action !== "existing") {
    groups.push({
      description: payload.organization.action === "create" ? "Create the reviewed organization first." : "Update the existing organization.",
      fields: Object.entries(payload.organization.fields ?? {}).map(([key, value]) => ({
        currentValue: payload.organization.action === "create" ? null : currentFieldValue(organizationSnapshot, key),
        inputName: `field.organization.${key}`,
        key,
        label: fieldLabel(key),
        proposedValue: value
      })),
      key: "organization",
      targetHref: payload.organization.id ? `/organizations/${payload.organization.id}` : null,
      targetLabel: payload.organization.action === "create" ? "New organization" : targetLabel(CrmChangeProposalType.UPDATE_ORGANIZATION, organizationSnapshot),
      title: payload.organization.action === "create" ? "Create organization" : "Update organization"
    });
  }
  if (payload.contact.action !== "existing") {
    groups.push({
      description: payload.contact.action === "create" ? "Create the reviewed contact." : "Update the existing contact.",
      fields: Object.entries(payload.contact.fields ?? {}).map(([key, value]) => ({
        currentValue: payload.contact.action === "create" ? null : currentFieldValue(contactSnapshot, key),
        inputName: `field.contact.${key}`,
        key,
        label: fieldLabel(key),
        proposedValue: value
      })),
      key: "contact",
      targetHref: payload.contact.id ? `/contacts/${payload.contact.id}` : null,
      targetLabel: payload.contact.action === "create" ? "New contact" : targetLabel(CrmChangeProposalType.UPDATE_PERSON, contactSnapshot),
      title: payload.contact.action === "create" ? "Create contact" : "Update contact"
    });
  }
  if (payload.linkContactToOrganization) {
    groups.push({
      description: "Link the reviewed contact and organization after both records are available.",
      fields: [{
        currentValue: payload.contact.action === "create" ? null : currentFieldValue(contactSnapshot, "organizationId"),
        inputName: "",
        key: "organizationId",
        label: "Organization",
        proposedValue: payload.organization.id ?? "Created organization"
      }],
      key: "link",
      targetHref: payload.contact.id ? `/contacts/${payload.contact.id}` : null,
      targetLabel: payload.contact.action === "create" ? "New contact" : targetLabel(CrmChangeProposalType.UPDATE_PERSON, contactSnapshot),
      title: "Link contact to organization"
    });
  }
  return groups;
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
  if (proposalType === CrmChangeProposalType.CREATE_PERSON || proposalType === CrmChangeProposalType.CREATE_ORGANIZATION || isCompoundProposalType(proposalType)) return null;
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

function omitUndefined<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
  };
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

function isCompoundProposalType(proposalType: CrmChangeProposalType) {
  return proposalType === CrmChangeProposalType.COMPOUND_PERSON_ORGANIZATION;
}

function actionTypesForProposal(proposalType: CrmChangeProposalType, payload: CrmProposalPayload | CompoundCrmProposalPayload) {
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) return ["crm_change_create_person"];
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON) return ["crm_change_update_person"];
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return ["crm_change_create_organization"];
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) return ["crm_change_update_organization"];
  if (proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) return ["crm_change_link_person_organization"];
  const compound = payload as CompoundCrmProposalPayload;
  return Array.from(new Set([
    ...(compound.organization.action === "create" ? ["crm_change_create_organization"] : []),
    ...(compound.organization.action === "update" ? ["crm_change_update_organization"] : []),
    ...(compound.contact.action === "create" ? ["crm_change_create_person"] : []),
    ...(compound.contact.action === "update" ? ["crm_change_update_person"] : []),
    ...(compound.linkContactToOrganization ? ["crm_change_link_person_organization"] : [])
  ]));
}

function blockedPermission(): ProposalPermissionDecision {
  const check = {
    actionKey: assistantActionPermissionKeyForRequest("crm_change_update_person"),
    canApply: false,
    level: "suggest_only" as const,
    reason: "CRM change proposal permission is unavailable.",
    state: "blocked" as const
  };
  return {
    ...check,
    checks: [check]
  };
}

function targetEntityType(proposalType: CrmChangeProposalType) {
  if (isCompoundProposalType(proposalType)) return "PersonOrganization";
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON || proposalType === CrmChangeProposalType.LINK_PERSON_ORGANIZATION) return "Person";
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) return "Organization";
  return null;
}

function targetHref(proposalType: CrmChangeProposalType, targetEntityId: string | null) {
  if (!targetEntityId) return null;
  if (isCompoundProposalType(proposalType)) return null;
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
  if (isCompoundProposalType(proposalType)) return "Related contact and organization";
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) return "New contact";
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return "New organization";
  const label = typeof snapshot.label === "string" ? snapshot.label : "";
  return label || "Existing CRM record";
}

function titleForProposal(proposalType: CrmChangeProposalType, payload: CrmProposalPayload | CompoundCrmProposalPayload, snapshot: Record<string, unknown>) {
  if (isCompoundProposalType(proposalType)) return titleForCompoundProposal(payload as CompoundCrmProposalPayload, snapshot);
  const simplePayload = payload as CrmProposalPayload;
  if (proposalType === CrmChangeProposalType.CREATE_PERSON) return `Create contact: ${simplePayload.fields?.firstName ?? "Unnamed contact"}`;
  if (proposalType === CrmChangeProposalType.UPDATE_PERSON) return `Update contact: ${targetLabel(proposalType, snapshot)}`;
  if (proposalType === CrmChangeProposalType.CREATE_ORGANIZATION) return `Create organization: ${simplePayload.fields?.name ?? "Unnamed organization"}`;
  if (proposalType === CrmChangeProposalType.UPDATE_ORGANIZATION) return `Update organization: ${targetLabel(proposalType, snapshot)}`;
  return `Link contact to organization: ${targetLabel(proposalType, snapshot)}`;
}

function titleForCompoundProposal(payload: CompoundCrmProposalPayload, snapshot: Record<string, unknown>) {
  const contactSnapshot = objectInput(snapshot.contact);
  const organizationSnapshot = objectInput(snapshot.organization);
  const contactLabel = payload.contact.action === "create"
    ? [payload.contact.fields?.firstName, payload.contact.fields?.lastName].filter(Boolean).join(" ") || "new contact"
    : targetLabel(CrmChangeProposalType.UPDATE_PERSON, contactSnapshot);
  const organizationLabel = payload.organization.action === "create"
    ? payload.organization.fields?.name ?? "new organization"
    : targetLabel(CrmChangeProposalType.UPDATE_ORGANIZATION, organizationSnapshot);
  return `Review contact + organization: ${contactLabel} at ${organizationLabel}`;
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    domain: "Domain",
    email: "Email",
    firstName: "First name",
    lastName: "Last name",
    title: "Title",
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

async function assertOwnerInWorkspaceTx(tx: Prisma.TransactionClient, workspaceId: string, ownerId: string | undefined) {
  if (!ownerId) return;
  const membership = await tx.workspaceMembership.findFirst({
    where: { userId: ownerId, user: { deletedAt: null }, workspaceId },
    select: { id: true }
  });
  if (!membership) throw new ApiError("NOT_FOUND", "User was not found in this workspace.", 404);
}

async function assertOrganizationInWorkspaceTx(tx: Prisma.TransactionClient, workspaceId: string, organizationId: string | undefined) {
  if (!organizationId) return;
  const organization = await tx.organization.findFirst({
    where: { id: organizationId, workspaceId, ...activeWhere },
    select: { id: true }
  });
  if (!organization) throw new ApiError("NOT_FOUND", "Target organization was not found.", 404);
}

async function writeAuditLogTx(
  tx: Prisma.TransactionClient,
  actor: WorkspaceActor,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: unknown
) {
  await tx.auditLog.create({
    data: {
      action,
      actorId: actor.actorUserId,
      entityId,
      entityType,
      metadata: metadata === undefined ? undefined : toJson(metadata),
      workspaceId: actor.workspaceId
    }
  });
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
  title: true,
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
      relationshipPersonalContext: person.relationshipPersonalContext,
      title: person.title
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
