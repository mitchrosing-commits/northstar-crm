import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { assertRecordInWorkspace } from "./record-guards";
import type { AuditDisplayEntry } from "@/lib/audit-format";
import { userDisplaySelect } from "./user-select";

export type TimelineRecordType = "DEAL" | "LEAD" | "PERSON" | "ORGANIZATION";

export type RecordTimelineItem =
  | {
      id: string;
      type: "note";
      timestamp: Date | string;
      body: string;
      authorName: string;
    }
  | {
      id: string;
      type: "activity";
      timestamp: Date | string;
      activityType: string;
      completedAt: Date | string | null;
      description: string | null;
      dueAt: Date | string | null;
      ownerName: string;
      title: string;
    }
  | {
      id: string;
      type: "email";
      timestamp: Date | string;
      body: string;
      ccText: string | null;
      createdByName: string;
      direction: string;
      fromText: string | null;
      subject: string;
      toText: string | null;
    }
  | {
      id: string;
      type: "audit";
      timestamp: Date | string;
      event: AuditDisplayEntry;
    };

type TimelineNote = {
  id: string;
  body: string;
  createdAt: Date | string;
  author?: { name: string | null; email: string } | null;
};

type TimelineActivity = {
  id: string;
  title: string;
  type: string;
  description: string | null;
  dueAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  owner?: { name: string | null; email: string } | null;
};

type TimelineEmailLog = {
  id: string;
  subject: string;
  body: string;
  direction: string;
  occurredAt: Date | string;
  fromText: string | null;
  toText: string | null;
  ccText: string | null;
  createdBy?: { name: string | null; email: string } | null;
};

type TimelineAuditLog = AuditDisplayEntry & {
  id: string;
  createdAt: Date | string;
};

type BuildRecordTimelineInput = {
  activities: TimelineActivity[];
  auditLogs: TimelineAuditLog[];
  emailLogs?: TimelineEmailLog[];
  notes: TimelineNote[];
};

export async function getRecordTimeline(
  actor: WorkspaceActor,
  record: { type: TimelineRecordType; id: string }
) {
  await ensureWorkspaceAccess(actor);
  await assertRecordInWorkspace(recordModel(record.type), actor.workspaceId, record.id);

  const noteWhere = attachmentWhere<Prisma.NoteWhereInput>(record.type, actor.workspaceId, record.id);
  const activityWhere = attachmentWhere<Prisma.ActivityWhereInput>(record.type, actor.workspaceId, record.id);
  const emailLogWhere = emailLogAttachmentWhere(record.type, actor.workspaceId, record.id);

  const [notes, activities, emailLogs, auditLogs] = await prisma.$transaction([
    prisma.note.findMany({
      where: noteWhere,
      include: { author: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.activity.findMany({
      where: activityWhere,
      include: { owner: { select: userDisplaySelect } },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.emailLog.findMany({
      where: emailLogWhere,
      include: { createdBy: { select: userDisplaySelect } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: auditEntityType(record.type), entityId: record.id },
      include: { actor: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  return buildRecordTimeline({ notes, activities, emailLogs, auditLogs });
}

export function buildRecordTimeline({ notes, activities, emailLogs, auditLogs }: BuildRecordTimelineInput) {
  const items: RecordTimelineItem[] = [
    ...notes.map((note) => ({
      id: `note-${note.id}`,
      type: "note" as const,
      timestamp: note.createdAt,
      body: note.body,
      authorName: note.author?.name ?? note.author?.email ?? "Unknown"
    })),
    ...activities.map((activity) => ({
      id: `activity-${activity.id}`,
      type: "activity" as const,
      timestamp: activity.completedAt ?? activity.createdAt,
      activityType: activity.type,
      completedAt: activity.completedAt,
      description: activity.description,
      dueAt: activity.dueAt,
      ownerName: activity.owner?.name ?? activity.owner?.email ?? "Unassigned",
      title: activity.title
    })),
    ...(emailLogs ?? []).map((emailLog) => ({
      id: `email-${emailLog.id}`,
      type: "email" as const,
      timestamp: emailLog.occurredAt,
      body: emailLog.body,
      ccText: emailLog.ccText,
      createdByName: emailLog.createdBy?.name ?? emailLog.createdBy?.email ?? "Unknown",
      direction: emailLog.direction,
      fromText: emailLog.fromText,
      subject: emailLog.subject,
      toText: emailLog.toText
    })),
    ...auditLogs.map((auditLog) => ({
      id: `audit-${auditLog.id}`,
      type: "audit" as const,
      timestamp: auditLog.createdAt,
      event: auditLog
    }))
  ];

  return items.sort((a, b) => {
    const byTimestamp = toTime(b.timestamp) - toTime(a.timestamp);
    if (byTimestamp !== 0) return byTimestamp;

    const byType = timelineTieRank(a.type) - timelineTieRank(b.type);
    if (byType !== 0) return byType;

    return a.id.localeCompare(b.id);
  });
}

function attachmentWhere<T extends Prisma.NoteWhereInput | Prisma.ActivityWhereInput>(
  type: TimelineRecordType,
  workspaceId: string,
  id: string
) {
  return {
    workspaceId,
    ...activeWhere,
    [attachmentField(type)]: id
  } as T;
}

function emailLogAttachmentWhere(type: TimelineRecordType, workspaceId: string, id: string): Prisma.EmailLogWhereInput {
  return {
    workspaceId,
    [attachmentField(type)]: id
  };
}

function attachmentField(type: TimelineRecordType) {
  if (type === "DEAL") return "dealId";
  if (type === "LEAD") return "leadId";
  if (type === "PERSON") return "personId";
  return "organizationId";
}

function recordModel(type: TimelineRecordType) {
  if (type === "DEAL") return "deal";
  if (type === "LEAD") return "lead";
  if (type === "PERSON") return "person";
  return "organization";
}

function auditEntityType(type: TimelineRecordType) {
  if (type === "DEAL") return "Deal";
  if (type === "LEAD") return "Lead";
  if (type === "PERSON") return "Person";
  return "Organization";
}

function toTime(value: Date | string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function timelineTieRank(type: RecordTimelineItem["type"]) {
  if (type === "note") return 0;
  if (type === "activity") return 1;
  if (type === "email") return 2;
  return 3;
}
