import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";

export async function assertDealPipelineAndStage(workspaceId: string, pipelineId: string, stageId: string) {
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: stageId, pipelineId, workspaceId, deletedAt: null },
    select: { id: true }
  });

  if (!stage) {
    throw new ApiError("INVALID_STAGE", "The stage must belong to the selected pipeline and workspace.", 422);
  }
}

export async function assertActivityLinks(
  workspaceId: string,
  data: Pick<
    Prisma.ActivityUncheckedCreateInput | Prisma.ActivityUncheckedUpdateInput,
    "ownerId" | "dealId" | "leadId" | "personId" | "organizationId"
  >
) {
  if (typeof data.ownerId === "string") await assertUserInWorkspace(workspaceId, data.ownerId);
  if (typeof data.dealId === "string") await assertRecordInWorkspace("deal", workspaceId, data.dealId);
  if (typeof data.personId === "string") await assertRecordInWorkspace("person", workspaceId, data.personId);
  if (typeof data.organizationId === "string") {
    await assertRecordInWorkspace("organization", workspaceId, data.organizationId);
  }
  if (typeof data.leadId === "string") {
    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, workspaceId, deletedAt: null },
      select: { id: true, status: true }
    });

    if (!lead) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
    if (lead.status === "CONVERTED") {
      throw new ApiError("LEAD_CONVERTED", "Create follow-up activities on the converted deal.", 409);
    }
  }
}

export function assertActivityAttachmentNotChanged(
  data: Pick<Prisma.ActivityUncheckedUpdateInput, "dealId" | "leadId" | "personId" | "organizationId">
) {
  if (
    data.dealId !== undefined ||
    data.leadId !== undefined ||
    data.personId !== undefined ||
    data.organizationId !== undefined
  ) {
    throw new ApiError("ACTIVITY_ATTACHMENT_LOCKED", "Activity attachments cannot be changed.", 422);
  }
}

export async function assertNoteLinks(
  workspaceId: string,
  data: Pick<Prisma.NoteUncheckedCreateInput, "dealId" | "leadId" | "personId" | "organizationId">
) {
  if (typeof data.dealId === "string") await assertRecordInWorkspace("deal", workspaceId, data.dealId);
  if (typeof data.personId === "string") await assertRecordInWorkspace("person", workspaceId, data.personId);
  if (typeof data.organizationId === "string") {
    await assertRecordInWorkspace("organization", workspaceId, data.organizationId);
  }
  if (typeof data.leadId === "string") {
    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, workspaceId, deletedAt: null },
      select: { id: true, status: true }
    });

    if (!lead) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
    if (lead.status === "CONVERTED") {
      throw new ApiError("LEAD_CONVERTED", "Add new context on the converted deal.", 409);
    }
  }
}

export async function assertEmailLogLinks(
  workspaceId: string,
  data: Pick<Prisma.EmailLogUncheckedCreateInput, "dealId" | "leadId" | "personId" | "organizationId">
) {
  const hasAttachment = Boolean(data.dealId || data.leadId || data.personId || data.organizationId);
  if (!hasAttachment) {
    throw new ApiError("VALIDATION_ERROR", "Attach the email log to a CRM record.", 422);
  }

  if (typeof data.dealId === "string") await assertRecordInWorkspace("deal", workspaceId, data.dealId);
  if (typeof data.personId === "string") await assertRecordInWorkspace("person", workspaceId, data.personId);
  if (typeof data.organizationId === "string") {
    await assertRecordInWorkspace("organization", workspaceId, data.organizationId);
  }
  if (typeof data.leadId === "string") {
    const lead = await prisma.lead.findFirst({
      where: { id: data.leadId, workspaceId, deletedAt: null },
      select: { id: true, status: true }
    });

    if (!lead) throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
    if (lead.status === "CONVERTED") {
      throw new ApiError("LEAD_CONVERTED", "Log email context on the converted deal.", 409);
    }
  }
}

export async function assertRecordInWorkspace(
  model: "pipeline" | "pipelineStage" | "deal" | "lead" | "person" | "organization" | "activity" | "note" | "emailLog" | "emailTemplate",
  workspaceId: string,
  id: string
) {
  const where = { id, workspaceId, deletedAt: null };
  const simpleWhere = { id, workspaceId };
  const record =
    model === "pipeline"
      ? await prisma.pipeline.findFirst({ where, select: { id: true } })
      : model === "pipelineStage"
        ? await prisma.pipelineStage.findFirst({ where, select: { id: true } })
        : model === "deal"
          ? await prisma.deal.findFirst({ where, select: { id: true } })
          : model === "lead"
            ? await prisma.lead.findFirst({ where, select: { id: true } })
            : model === "person"
              ? await prisma.person.findFirst({ where, select: { id: true } })
              : model === "organization"
                ? await prisma.organization.findFirst({ where, select: { id: true } })
                : model === "activity"
                  ? await prisma.activity.findFirst({ where, select: { id: true } })
                  : model === "note"
                    ? await prisma.note.findFirst({ where, select: { id: true } })
                    : model === "emailLog"
                      ? await prisma.emailLog.findFirst({ where: simpleWhere, select: { id: true } })
                      : await prisma.emailTemplate.findFirst({ where: simpleWhere, select: { id: true } });

  if (!record) {
    throw new ApiError("NOT_FOUND", "Record was not found in this workspace.", 404);
  }
}

export async function assertUserInWorkspace(workspaceId: string, userId: string) {
  const membership = await prisma.workspaceMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId,
        userId
      }
    },
    select: { id: true }
  });

  if (!membership) {
    throw new ApiError("NOT_FOUND", "User was not found in this workspace.", 404);
  }
}
