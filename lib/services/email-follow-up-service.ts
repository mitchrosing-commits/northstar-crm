import type { ActivityType, Prisma } from "@prisma/client";
import type { Route } from "next";

import { ApiError } from "@/lib/api/responses";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import {
  emailSmartClassificationLabels,
  readEmailSmartClassification,
  type EmailSmartClassification
} from "./email-classification-service";
import { createActivity } from "./activity-service";
import { emailLogAttachmentRelationsWhere } from "./record-guards";
import { ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

type EmailFollowUpTarget = {
  field: "dealId" | "leadId" | "personId" | "organizationId";
  href: Route;
  id: string;
  label: string;
  type: "deal" | "lead" | "person" | "organization";
};

export type EmailFollowUpDraft = {
  description: string;
  dueAt: string;
  emailLogId: string;
  hasSavedLabels: boolean;
  labels: string[];
  target: EmailFollowUpTarget | null;
  title: string;
  type: ActivityType;
};

type EmailFollowUpDraftOptions = {
  now?: Date;
};

type EmailFollowUpCreateInput = {
  description?: unknown;
  dueAt?: unknown;
  emailLogId: unknown;
  title?: unknown;
  type?: unknown;
};

type EmailFollowUpEmailLogInput = {
  body: string;
  deal?: { id: string; title: string } | null;
  dealId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  fromText: string | null;
  id: string;
  lead?: { id: string; title: string } | null;
  leadId: string | null;
  occurredAt: Date | string;
  organization?: { id: string; name: string } | null;
  organizationId: string | null;
  person?: { email: string | null; firstName: string; id: string; lastName: string | null } | null;
  personId: string | null;
  smartLabelGeneratedAt?: Date | string | null;
  smartLabelJson?: Prisma.JsonValue | null;
  smartLabelProvider?: string | null;
  subject: string;
  toText: string | null;
};

export async function buildEmailFollowUpDraft(
  actor: WorkspaceActor,
  input: { emailLogId: unknown },
  options: EmailFollowUpDraftOptions = {}
): Promise<EmailFollowUpDraft> {
  await ensureWorkspaceAccess(actor);
  const emailLogId = normalizeEmailLogId(input.emailLogId);
  const emailLog = await prisma.emailLog.findFirst({
    where: {
      id: emailLogId,
      workspaceId: actor.workspaceId,
      ...emailLogAttachmentRelationsWhere(actor.workspaceId)
    },
    include: {
      deal: true,
      lead: true,
      organization: true,
      person: true
    }
  });

  if (!emailLog) {
    throw new ApiError("NOT_FOUND", "Email log was not found.", 404);
  }

  return buildEmailFollowUpDraftFromEmailLog(emailLog, options);
}

export function buildEmailFollowUpDraftFromEmailLog(
  emailLog: EmailFollowUpEmailLogInput,
  options: EmailFollowUpDraftOptions = {}
): EmailFollowUpDraft {
  const classification = readEmailSmartClassification({
    smartLabelGeneratedAt: emailLog.smartLabelGeneratedAt,
    smartLabelJson: emailLog.smartLabelJson,
    smartLabelProvider: emailLog.smartLabelProvider
  });
  const labels = classification ? emailSmartClassificationLabels(classification) : [];
  const target = emailFollowUpTarget(emailLog);
  const title = followUpTitle(emailLog.subject, classification);
  const dueAt = suggestedFollowUpDueDate(classification, options.now);

  return {
    description: followUpDescription({ classification, emailLog, labels, target }),
    dueAt,
    emailLogId: emailLog.id,
    hasSavedLabels: Boolean(classification),
    labels,
    target,
    title,
    type: "EMAIL"
  };
}

export async function createEmailFollowUpActivity(
  actor: WorkspaceActor,
  input: EmailFollowUpCreateInput
) {
  const draft = await buildEmailFollowUpDraft(actor, { emailLogId: input.emailLogId });
  if (!draft.target) {
    throw new ApiError("EMAIL_FOLLOW_UP_REQUIRES_LINK", "Link this email to a CRM record before creating a follow-up.", 422);
  }

  const activity = await createActivity(actor, {
    [draft.target.field]: draft.target.id,
    description: normalizeEditableText(input.description, draft.description, 4000),
    dueAt: normalizeEditableDueDate(input.dueAt, draft.dueAt),
    ownerId: actor.actorUserId,
    title: normalizeEditableText(input.title, draft.title, 200),
    type: normalizeEditableActivityType(input.type, draft.type)
  });

  await prisma.emailLogActivityLink.create({
    data: {
      activityId: activity.id,
      emailLogId: draft.emailLogId,
      workspaceId: actor.workspaceId
    }
  });

  return {
    activity,
    activityHref: `/activities/${activity.id}/edit?returnTo=${encodeURIComponent("/email")}` as Route,
    target: draft.target
  };
}

function emailFollowUpTarget(emailLog: EmailFollowUpEmailLogInput): EmailFollowUpTarget | null {
  if (emailLog.dealId && emailLog.deal) {
    return {
      field: "dealId",
      href: `/deals/${emailLog.dealId}` as Route,
      id: emailLog.dealId,
      label: `Deal: ${emailLog.deal.title}`,
      type: "deal"
    };
  }
  if (emailLog.leadId && emailLog.lead) {
    return {
      field: "leadId",
      href: `/leads/${emailLog.leadId}` as Route,
      id: emailLog.leadId,
      label: `Lead: ${emailLog.lead.title}`,
      type: "lead"
    };
  }
  if (emailLog.personId && emailLog.person) {
    return {
      field: "personId",
      href: `/contacts/${emailLog.personId}` as Route,
      id: emailLog.personId,
      label: `Contact: ${formatPersonName(emailLog.person) ?? emailLog.person.email ?? "Unnamed contact"}`,
      type: "person"
    };
  }
  if (emailLog.organizationId && emailLog.organization) {
    return {
      field: "organizationId",
      href: `/organizations/${emailLog.organizationId}` as Route,
      id: emailLog.organizationId,
      label: `Organization: ${emailLog.organization.name}`,
      type: "organization"
    };
  }
  return null;
}

function followUpTitle(subject: string, classification: EmailSmartClassification | null) {
  const prefix = classification?.signals.includes("PRICING_QUOTE")
    ? "Follow up on pricing"
    : classification?.signals.includes("CONTRACT_LEGAL")
      ? "Follow up on contract"
      : classification?.signals.includes("RELATIONSHIP_RISK")
        ? "Follow up on relationship risk"
        : classification?.signals.includes("NEEDS_REPLY")
          ? "Reply"
          : "Follow up";
  return truncate(`${prefix}: ${subject}`, 160);
}

function followUpDescription({
  classification,
  emailLog,
  labels,
  target
}: {
  classification: EmailSmartClassification | null;
  emailLog: EmailFollowUpEmailLogInput;
  labels: string[];
  target: EmailFollowUpTarget | null;
}) {
  const lines = [
    `Source email: ${emailLog.subject}`,
    `${emailLog.direction === "INBOUND" ? "From" : "To"}: ${
      emailLog.direction === "INBOUND" ? emailLog.fromText ?? "Not recorded" : emailLog.toText ?? "Not recorded"
    }`,
    `Email date: ${formatDateOnly(emailLog.occurredAt)}`,
    target ? `Linked CRM record: ${target.label}` : "Linked CRM record: none yet",
    labels.length ? `Saved labels: ${labels.join(", ")}` : "Saved labels: none yet; using conservative manual follow-up defaults.",
    classification?.summary ? `Why: ${classification.summary}` : null,
    ...(classification?.evidence.length ? ["Evidence:", ...classification.evidence.slice(0, 3).map((item) => `- ${item}`)] : []),
    `Email preview: ${truncate(stripImportedSnippetPrefix(emailLog.body), 280)}`
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

function suggestedFollowUpDueDate(classification: EmailSmartClassification | null, now = new Date()) {
  const signals = new Set(classification?.signals ?? []);
  const today = startOfUtcDay(now);
  if (signals.has("URGENT") || signals.has("RELATIONSHIP_RISK")) return formatDateParam(nextBusinessDay(today, 0));
  if (signals.has("WAITING_ON_CUSTOMER")) return formatDateParam(nextBusinessDay(today, 3));
  return formatDateParam(nextBusinessDay(today, 1));
}

function nextBusinessDay(value: Date, daysFromNow: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function formatDateParam(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDateOnly(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toISOString().slice(0, 10);
}

function normalizeEmailLogId(value: unknown) {
  const normalized = readNonEmpty(value);
  if (!normalized) {
    throw new ApiError("VALIDATION_ERROR", "Email log id is required.", 422);
  }
  return normalized;
}

function normalizeEditableText(value: unknown, fallback: string, maxLength: number) {
  const text = readNonEmpty(value) ?? fallback;
  return truncate(text, maxLength);
}

function normalizeEditableDueDate(value: unknown, fallback: string) {
  const text = readNonEmpty(value) ?? fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${fallback}T00:00:00.000Z`;
  return `${text}T00:00:00.000Z`;
}

function normalizeEditableActivityType(value: unknown, fallback: ActivityType): ActivityType {
  if (value === "CALL" || value === "EMAIL" || value === "MEETING" || value === "TASK") return value;
  return fallback;
}

function stripImportedSnippetPrefix(value: string) {
  return value.replace(/^(Gmail|Microsoft) snippet:\s*/i, "");
}

function truncate(value: string, maxLength: number) {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
