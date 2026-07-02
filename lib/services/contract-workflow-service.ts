import { ContractStepStatus, ContractStepType, DealStatus, Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { assertRecordInWorkspace, assertUserInWorkspace } from "./record-guards";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

export const contractStepTypes = ["NDA", "MSA", "SOW"] as const satisfies readonly ContractStepType[];
export const contractStepStatuses = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "SENT",
  "SIGNED",
  "BLOCKED",
  "SKIPPED"
] as const satisfies readonly ContractStepStatus[];

type ContractStepInput = {
  type: unknown;
  status?: unknown;
  ownerId?: unknown;
  dueAt?: unknown;
  sentAt?: unknown;
  signedAt?: unknown;
  notes?: unknown;
  externalReference?: unknown;
};

type ContractStepUpdateInput = Partial<Omit<ContractStepInput, "type">>;
type NormalizedContractStepData = {
  status: ContractStepStatus;
  ownerId?: string | null;
  dueAt?: Date | null;
  sentAt?: Date | null;
  signedAt?: Date | null;
  notes?: string | null;
  externalReference?: string | null;
};

const contractStepInclude = {
  owner: { select: userDisplaySelect }
} satisfies Prisma.DealContractStepInclude;

export async function listDealContractSteps(actor: WorkspaceActor, dealId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("deal", actor.workspaceId, dealId);

  const steps = await prisma.dealContractStep.findMany({
    where: { workspaceId: actor.workspaceId, dealId, ...activeWhere },
    include: contractStepInclude
  });

  return sortContractSteps(steps);
}

export async function listDealContractStepsForDeals(actor: WorkspaceActor, dealIds: string[]) {
  await ensureWorkspaceAccess(actor);
  const uniqueDealIds = normalizeContractStepDealIds(dealIds);
  if (uniqueDealIds.length === 0) return new Map<string, Awaited<ReturnType<typeof listDealContractSteps>>>();

  const visibleDeals = await prisma.deal.findMany({
    where: { id: { in: uniqueDealIds }, workspaceId: actor.workspaceId, ...activeWhere },
    select: { id: true }
  });
  const visibleDealIds = visibleDeals.map((deal) => deal.id);
  const stepsByDeal = new Map<string, Awaited<ReturnType<typeof listDealContractSteps>>>(
    visibleDealIds.map((dealId) => [dealId, []])
  );
  if (visibleDealIds.length === 0) return stepsByDeal;

  const steps = await prisma.dealContractStep.findMany({
    where: { workspaceId: actor.workspaceId, dealId: { in: visibleDealIds }, ...activeWhere },
    include: contractStepInclude
  });

  for (const step of sortContractSteps(steps)) {
    stepsByDeal.get(step.dealId)?.push(step);
  }
  return stepsByDeal;
}

function normalizeContractStepDealIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value)).filter(
    (dealId): dealId is string => typeof dealId === "string" && dealId.trim().length > 0
  );
}

export async function createDealContractStep(actor: WorkspaceActor, dealId: string, input: unknown) {
  await ensureWorkspaceAccess(actor);
  await assertDealContractStepsEditable(actor.workspaceId, dealId);
  const contractInput = objectInput(input);
  assertContractStepDateValues(contractInput);
  const type = normalizeContractStepType(contractInput.type);
  const status = normalizeContractStepStatus(contractInput.status ?? "NOT_STARTED");
  const data = normalizeContractStepData({ ...contractInput, status }, undefined);
  await assertContractStepLinks(actor.workspaceId, data);
  await assertContractSequence(actor, dealId, type, status);

  const existing = await prisma.dealContractStep.findFirst({
    where: { workspaceId: actor.workspaceId, dealId, type },
    select: { id: true }
  });
  if (existing) throw duplicateContractStepError();

  const step = await prisma.dealContractStep
    .create({
      data: {
        ...data,
        workspaceId: actor.workspaceId,
        dealId,
        type
      },
      include: contractStepInclude
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error)) {
        throw duplicateContractStepError();
      }
      throw error;
    });

  await writeAuditLog(actor, "contract_step.created", "DealContractStep", step.id, {
    dealId,
    type: step.type,
    status: step.status
  });
  return step;
}

export async function upsertDealContractStep(actor: WorkspaceActor, dealId: string, input: unknown) {
  await ensureWorkspaceAccess(actor);
  const contractInput = objectInput(input);
  const type = normalizeContractStepType(contractInput.type);
  const existing = await prisma.dealContractStep.findFirst({
    where: { workspaceId: actor.workspaceId, dealId, type, ...activeWhere },
    select: { id: true }
  });

  if (existing) return updateDealContractStep(actor, existing.id, contractInput);
  return createDealContractStep(actor, dealId, contractInput);
}

export async function updateDealContractStep(actor: WorkspaceActor, contractStepId: string, input: unknown) {
  await ensureWorkspaceAccess(actor);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ApiError("VALIDATION_ERROR", "Contract step update must be an object.", 422);
  }
  const contractInput = objectInput(input);
  const existing = await prisma.dealContractStep.findFirst({
    where: { id: contractStepId, workspaceId: actor.workspaceId, ...activeWhere },
    include: contractStepInclude
  });

  if (!existing) throw new ApiError("NOT_FOUND", "Contract step was not found.", 404);
  await assertDealContractStepsEditable(actor.workspaceId, existing.dealId);
  assertContractStepDateValues(contractInput);
  const status = normalizeContractStepStatus(contractInput.status ?? existing.status);
  const data = normalizeContractStepData({ ...contractInput, status }, existing);
  await assertContractStepLinks(actor.workspaceId, data);
  await assertContractSequence(actor, existing.dealId, existing.type, status);

  if (!contractStepDataChanges(data, existing)) {
    return existing;
  }

  const step = await prisma.dealContractStep.update({
    where: { id: existing.id },
    data,
    include: contractStepInclude
  });

  const statusChanged = step.status !== existing.status;
  await writeAuditLog(actor, statusChanged ? "contract_step.status_changed" : "contract_step.updated", "DealContractStep", step.id, {
    dealId: step.dealId,
    type: step.type,
    previousStatus: statusChanged ? existing.status : undefined,
    nextStatus: statusChanged ? step.status : undefined
  });
  return step;
}

function contractStepDataChanges(
  data: NormalizedContractStepData,
  existing: {
    status: ContractStepStatus;
    ownerId: string | null;
    dueAt: Date | null;
    sentAt: Date | null;
    signedAt: Date | null;
    notes: string | null;
    externalReference: string | null;
  }
) {
  if (data.status !== existing.status) return true;
  if (data.ownerId !== undefined && data.ownerId !== existing.ownerId) return true;
  if (data.dueAt !== undefined && !nullableDatesEqual(data.dueAt, existing.dueAt)) return true;
  if (data.sentAt !== undefined && !nullableDatesEqual(data.sentAt, existing.sentAt)) return true;
  if (data.signedAt !== undefined && !nullableDatesEqual(data.signedAt, existing.signedAt)) return true;
  if (data.notes !== undefined && data.notes !== existing.notes) return true;
  if (data.externalReference !== undefined && data.externalReference !== existing.externalReference) return true;
  return false;
}

function nullableDatesEqual(left: Date | null, right: Date | null) {
  if (left === null || right === null) return left === right;
  return left.getTime() === right.getTime();
}

export function nextContractStepAction(steps: Array<{ type: ContractStepType; status: ContractStepStatus }>) {
  const byType = new Map(steps.map((step) => [step.type, step.status]));
  for (const type of contractStepTypes) {
    const status = byType.get(type) ?? "NOT_STARTED";
    if (status !== "SIGNED" && status !== "SKIPPED") {
      return { type, status };
    }
  }
  return null;
}

function normalizeContractStepData(
  input: ContractStepUpdateInput,
  existing?: { status: ContractStepStatus; sentAt: Date | null; signedAt: Date | null }
): NormalizedContractStepData {
  const status = normalizeContractStepStatus(input.status ?? existing?.status ?? "NOT_STARTED");
  const now = new Date();
  const sentAt = input.sentAt === undefined ? existing?.sentAt : input.sentAt;
  const signedAt = input.signedAt === undefined ? existing?.signedAt : input.signedAt;
  const canHaveSentAt = status === "SENT" || status === "SIGNED" || status === "BLOCKED";

  return {
    status,
    ownerId: input.ownerId === undefined ? undefined : normalizeOptionalContractStepId(input.ownerId),
    dueAt: input.dueAt === undefined ? undefined : normalizeNullableContractDate(input.dueAt, "Contract due date is invalid."),
    sentAt:
      status === "SENT" || status === "SIGNED"
        ? (normalizeNullableContractDate(sentAt, "Contract sent date is invalid.") ?? now)
        : canHaveSentAt
          ? normalizeNullableContractDate(sentAt, "Contract sent date is invalid.")
          : null,
    signedAt:
      status === "SIGNED"
        ? (normalizeNullableContractDate(signedAt, "Contract signed date is invalid.") ?? now)
        : null,
    notes: normalizeOptionalContractStepText(input.notes, "Contract notes must be text."),
    externalReference: normalizeOptionalContractStepText(
      input.externalReference,
      "Contract external reference must be text."
    )
  };
}

function normalizeOptionalContractStepText(value: unknown, message: string) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  return value.trim() || null;
}

function normalizeOptionalContractStepId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Contract step owner id must be text.", 422);
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeContractStepType(value: unknown): ContractStepType {
  if (contractStepTypes.includes(value as ContractStepType)) return value as ContractStepType;
  throw new ApiError("VALIDATION_ERROR", "Contract step type must be NDA, MSA, or SOW.", 422);
}

function normalizeContractStepStatus(value: unknown): ContractStepStatus {
  if (contractStepStatuses.includes(value as ContractStepStatus)) return value as ContractStepStatus;
  throw new ApiError(
    "VALIDATION_ERROR",
    "Contract step status must be NOT_STARTED, IN_PROGRESS, SENT, SIGNED, BLOCKED, or SKIPPED.",
    422
  );
}

function assertContractStepDateValues(input: ContractStepUpdateInput) {
  assertNullableContractDate(input.dueAt, "Contract due date is invalid.");
  assertNullableContractDate(input.sentAt, "Contract sent date is invalid.");
  assertNullableContractDate(input.signedAt, "Contract signed date is invalid.");
}

function assertNullableContractDate(value: unknown, message: string) {
  normalizeNullableContractDate(value, message);
}

function normalizeNullableContractDate(value: unknown, message: string) {
  if (value === undefined) return;
  if (value === null) return null;
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new ApiError("VALIDATION_ERROR", message, 422);
  }
  return date;
}

async function assertContractStepLinks(workspaceId: string, input: ContractStepUpdateInput) {
  if (typeof input.ownerId === "string") await assertUserInWorkspace(workspaceId, input.ownerId);
}

async function assertDealContractStepsEditable(workspaceId: string, dealId: string) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, workspaceId, ...activeWhere },
    select: { status: true }
  });

  if (!deal) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
  if (deal.status !== DealStatus.OPEN) {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }
}

async function assertContractSequence(
  actor: WorkspaceActor,
  dealId: string,
  type: ContractStepType,
  nextStatus: ContractStepStatus
) {
  if (!["IN_PROGRESS", "SENT", "SIGNED"].includes(nextStatus)) return;

  const requiredPreviousTypes = contractStepTypes.slice(0, contractStepTypes.indexOf(type));
  if (requiredPreviousTypes.length === 0) return;

  const previousSteps = await prisma.dealContractStep.findMany({
    where: { workspaceId: actor.workspaceId, dealId, type: { in: requiredPreviousTypes }, ...activeWhere },
    select: { type: true, status: true }
  });
  const previousByType = new Map(previousSteps.map((step) => [step.type, step.status]));
  const incomplete = requiredPreviousTypes.find((previousType) => {
    const status = previousByType.get(previousType);
    return status !== "SIGNED" && status !== "SKIPPED";
  });

  if (incomplete) {
    throw new ApiError(
      "CONTRACT_SEQUENCE_BLOCKED",
      `${contractStepLabel(type)} cannot move forward until ${contractStepLabel(incomplete)} is signed or skipped.`,
      409
    );
  }
}

function sortContractSteps<T extends { type: ContractStepType }>(steps: T[]) {
  return [...steps].sort((left, right) => contractStepTypes.indexOf(left.type) - contractStepTypes.indexOf(right.type));
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) return input as Record<string, unknown>;
  return {};
}

function contractStepLabel(type: ContractStepType) {
  if (type === "NDA") return "NDA";
  if (type === "MSA") return "MSA";
  return "SOW";
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function duplicateContractStepError() {
  return new ApiError("CONTRACT_STEP_EXISTS", "This contract step already exists for the deal.", 409);
}
