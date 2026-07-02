import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import {
  activityAttachmentRelationsWhere,
  assertRecordInWorkspace,
  emailLogAttachmentRelationsWhere,
  noteAttachmentRelationsWhere
} from "./record-guards";
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
      activityId: string;
      timestamp: Date | string;
      activityType: string;
      completedAt: Date | string | null;
      description: string | null;
      dueAt: Date | string | null;
      ownerName: string;
      associationLabels: string[];
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
  meetingAssociations?: TimelineMeetingAssociation[];
};

type TimelineMeetingAssociation = {
  deal?: { title: string } | null;
  lead?: { title: string } | null;
  person?: { email: string | null; firstName: string; lastName: string | null } | null;
  organization?: { name: string } | null;
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
  const recordType = normalizeTimelineRecordType(record.type);
  await assertRecordInWorkspace(recordModel(recordType), actor.workspaceId, record.id);

  const noteWhere = timelineNoteWhere(recordType, actor.workspaceId, record.id);
  const activityWhere = timelineActivityWhere(recordType, actor.workspaceId, record.id);
  const emailLogWhere = timelineEmailLogWhere(recordType, actor.workspaceId, record.id);

  const [notes, activities, emailLogs, auditLogs] = await prisma.$transaction([
    prisma.note.findMany({
      where: noteWhere,
      include: { author: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.activity.findMany({
      where: activityWhere,
      include: {
        owner: { select: userDisplaySelect },
        meetingAssociations: {
          where: { workspaceId: actor.workspaceId },
          include: {
            deal: { select: { title: true } },
            lead: { select: { title: true } },
            person: { select: { email: true, firstName: true, lastName: true } },
            organization: { select: { name: true } }
          }
        }
      },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.emailLog.findMany({
      where: emailLogWhere,
      include: { createdBy: { select: userDisplaySelect } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.auditLog.findMany({
      where: { workspaceId: actor.workspaceId, entityType: auditEntityType(recordType), entityId: record.id },
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
      activityId: activity.id,
      timestamp: activity.completedAt ?? activity.createdAt,
      activityType: activity.type,
      completedAt: activity.completedAt,
      description: activity.description,
      dueAt: activity.dueAt,
      ownerName: activity.owner?.name ?? activity.owner?.email ?? "Unassigned",
      associationLabels: activityAssociationLabels(activity.meetingAssociations ?? []),
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

function timelineNoteWhere(type: TimelineRecordType, workspaceId: string, id: string): Prisma.NoteWhereInput {
  return {
    workspaceId,
    ...activeWhere,
    ...noteAttachmentRelationsWhere(workspaceId),
    [attachmentField(type)]: id
  };
}

function timelineActivityWhere(type: TimelineRecordType, workspaceId: string, id: string): Prisma.ActivityWhereInput {
  return {
    workspaceId,
    ...activeWhere,
    ...activityAttachmentRelationsWhere(workspaceId),
    OR: [
      { [attachmentField(type)]: id },
      {
        meetingAssociations: {
          some: {
            workspaceId,
            [attachmentField(type)]: id
          }
        }
      }
    ]
  };
}

function timelineEmailLogWhere(type: TimelineRecordType, workspaceId: string, id: string): Prisma.EmailLogWhereInput {
  return {
    workspaceId,
    ...emailLogAttachmentRelationsWhere(workspaceId),
    [attachmentField(type)]: id
  };
}

function normalizeTimelineRecordType(value: unknown): TimelineRecordType {
  if (value === "DEAL" || value === "LEAD" || value === "PERSON" || value === "ORGANIZATION") return value;
  throw new ApiError("VALIDATION_ERROR", "Timeline record type must be DEAL, LEAD, PERSON, or ORGANIZATION.", 422);
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

function activityAssociationLabels(associations: TimelineMeetingAssociation[]) {
  return associations
    .map((association) => {
      if (association.deal) return `Deal: ${association.deal.title}`;
      if (association.lead) return `Lead: ${association.lead.title}`;
      if (association.person) return `Contact: ${formatPersonName(association.person) ?? association.person.email ?? "Unnamed contact"}`;
      if (association.organization) return `Organization: ${association.organization.name}`;
      return null;
    })
    .filter((label): label is string => Boolean(label));
}

function formatPersonName(person: { firstName: string | null; lastName: string | null }) {
  const name = [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
  return name || undefined;
}
