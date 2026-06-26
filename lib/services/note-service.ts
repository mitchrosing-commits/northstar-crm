import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor, writeAuditLog } from "./workspace-access";
import { assertNoteLinks, assertRecordInWorkspace } from "./record-guards";
import { userDisplaySelect } from "./user-select";

export async function listNotes(actor: WorkspaceActor) {
  await ensureWorkspaceAccess(actor);
  return prisma.note.findMany({
    where: { workspaceId: actor.workspaceId, ...activeWhere },
    include: { author: { select: userDisplaySelect } },
    orderBy: { createdAt: "desc" }
  });
}

export async function createNote(actor: WorkspaceActor, data: Omit<Prisma.NoteUncheckedCreateInput, "workspaceId" | "authorId">) {
  await ensureWorkspaceAccess(actor);
  await assertNoteLinks(actor.workspaceId, data);
  const note = await prisma.note.create({
    data: { ...data, workspaceId: actor.workspaceId, authorId: actor.actorUserId }
  });
  await writeAuditLog(actor, "note.created", "Note", note.id);
  return note;
}

export async function softDeleteNote(actor: WorkspaceActor, noteId: string) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace("note", actor.workspaceId, noteId);
  await prisma.note.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
  await writeAuditLog(actor, "note.deleted", "Note", noteId);
}
