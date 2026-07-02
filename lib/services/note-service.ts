import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertNoteLinks, assertRecordInWorkspace, noteAttachmentRelationsWhere } from "./record-guards";
import { userDisplaySelect } from "./user-select";

type CreateNoteInput = {
  dealId?: unknown;
  leadId?: unknown;
  personId?: unknown;
  organizationId?: unknown;
  body: unknown;
};

export async function listNotes(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  return prisma.note.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere, ...noteAttachmentRelationsWhere(actor.workspaceId) },
    include: { author: { select: userDisplaySelect } },
    orderBy: { createdAt: "desc" }
  });
}

export async function createNote(actor: WorkspaceActor, data: unknown) {
  await ensureWorkspaceAccess(actor);
  const normalized = normalizeNoteInput(data);
  await assertNoteLinks(actor.workspaceId, normalized);
  const note = await prisma.note.create({
    data: { ...normalized, workspaceId: actor.workspaceId, authorId: actor.actorUserId }
  });
  await writeAuditLog(actor, "note.created", "Note", note.id);
  return note;
}

export async function softDeleteNote(actor: WorkspaceActor, noteId: string) {
  await ensureWorkspaceAccess(actor);
  await assertNoteDeletable(actor.workspaceId, noteId);
  await prisma.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "note.deleted", "Note", noteId);
}

async function assertNoteDeletable(workspaceId: string, noteId: string) {
  const note = await prisma.note.findFirst({
    where: { id: noteId, workspaceId, deletedAt: null, ...noteAttachmentRelationsWhere(workspaceId) },
    select: {
      id: true,
      deal: { select: { status: true } },
      lead: { select: { status: true } }
    }
  });

  if (!note) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
  if (note.deal?.status !== undefined && note.deal.status !== "OPEN") {
    throw new ApiError("DEAL_CLOSED", "Closed deals cannot be edited.", 409);
  }
  if (note.lead?.status === "CONVERTED") {
    throw new ApiError("LEAD_CONVERTED", "Converted lead notes cannot be removed. Update the converted deal instead.", 409);
  }
}

function normalizeNoteInput(data: unknown) {
  const input = objectInput(data);
  return {
    dealId: normalizeOptionalNoteId(input.dealId),
    leadId: normalizeOptionalNoteId(input.leadId),
    personId: normalizeOptionalNoteId(input.personId),
    organizationId: normalizeOptionalNoteId(input.organizationId),
    body: normalizeRequiredNoteBody(input.body)
  };
}

function normalizeOptionalNoteId(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Note attachment ids must be text.", 422);
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeRequiredNoteBody(body: unknown) {
  if (typeof body !== "string") {
    throw new ApiError("VALIDATION_ERROR", "Note body is required.", 422);
  }
  const trimmed = body.trim();
  if (!trimmed) throw new ApiError("VALIDATION_ERROR", "Note body is required.", 422);
  return trimmed;
}

function objectInput(input: unknown): Record<string, unknown> {
  if (typeof input === "object" && input !== null) return input as Record<string, unknown>;
  return {};
}
