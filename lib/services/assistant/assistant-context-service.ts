import { Prisma } from "@prisma/client";

import { classifyActivityDue, startOfDay } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import {
  actionableActivityRelationsWhere,
  activityAttachmentRelationsWhere,
  emailLogAttachmentRelationsWhere
} from "@/lib/services/record-guards";
import { scopeWorkspaceRelation } from "@/lib/services/relation-scope";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

const assistantTodayActivityLimit = 30;
const assistantDealRiskLimit = 50;
const assistantEmailLookbackDays = 30;
const assistantEmailLimit = 30;

export type AssistantActivityContextItem = {
  bucket: "overdue" | "today" | "upcoming" | "unscheduled";
  completedAt: string | null;
  dueAt: string | null;
  href: string;
  id: string;
  relatedLabel: string | null;
  title: string;
  type: string;
};

export type AssistantTodayContext = {
  activities: AssistantActivityContextItem[];
  counts: {
    overdue: number;
    today: number;
    upcoming: number;
    unscheduled: number;
  };
  generatedAt: string;
  lookedAt: string[];
};

export type AssistantDealRiskActivity = {
  bucket: "overdue" | "today" | "upcoming" | "unscheduled";
  dueAt: string | null;
  title: string;
};

export type AssistantDealRiskContextItem = {
  activities: AssistantDealRiskActivity[];
  currency: string;
  expectedCloseAt: string | null;
  href: string;
  id: string;
  ownerLabel: string;
  relatedLabel: string | null;
  stageName: string;
  title: string;
  updatedAt: string;
  valueCents: number | null;
};

export type AssistantDealRiskContext = {
  deals: AssistantDealRiskContextItem[];
  generatedAt: string;
  lookedAt: string[];
};

export type AssistantEmailReplyMessage = {
  accountLabel: string | null;
  direction: string;
  fromText: string | null;
  occurredAt: string;
  providerLabel: string | null;
  subject: string;
  toText: string | null;
};

export type AssistantEmailReplyContext = {
  generatedAt: string;
  lookedAt: string[];
  matchedPeople: Array<{
    email: string | null;
    id: string;
    label: string;
  }>;
  messages: AssistantEmailReplyMessage[];
  target: string;
};

export async function buildAssistantTodayContext(
  actor: WorkspaceActor,
  now = new Date()
): Promise<AssistantTodayContext> {
  await ensureWorkspaceAccess(actor);
  const today = startOfDay(now);
  const nextWeek = addDays(today, 7);
  const activities = await prisma.activity.findMany({
    where: {
      workspaceId: actor.workspaceId,
      completedAt: null,
      ...activeWhere,
      ...actionableActivityRelationsWhere(actor.workspaceId),
      OR: [
        { dueAt: null },
        { dueAt: { lt: nextWeek } }
      ]
    },
    include: assistantActivityInclude,
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: assistantTodayActivityLimit
  });
  const items = activities.map((activity) => assistantActivityItem(actor.workspaceId, activity, now));

  return {
    activities: items,
    counts: {
      overdue: items.filter((item) => item.bucket === "overdue").length,
      today: items.filter((item) => item.bucket === "today").length,
      upcoming: items.filter((item) => item.bucket === "upcoming").length,
      unscheduled: items.filter((item) => item.bucket === "unscheduled").length
    },
    generatedAt: now.toISOString(),
    lookedAt: ["Open workspace activities", "Activity due dates", "Linked CRM record labels"]
  };
}

export async function buildAssistantDealRiskContext(
  actor: WorkspaceActor,
  now = new Date()
): Promise<AssistantDealRiskContext> {
  await ensureWorkspaceAccess(actor);
  const deals = await prisma.deal.findMany({
    where: { workspaceId: actor.workspaceId, status: "OPEN", ...activeWhere },
    include: {
      activities: {
        where: {
          workspaceId: actor.workspaceId,
          completedAt: null,
          ...activityAttachmentRelationsWhere(actor.workspaceId),
          ...activeWhere
        },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        take: 5
      },
      organization: true,
      owner: { select: { email: true, name: true } },
      person: true,
      stage: { select: { name: true } }
    },
    orderBy: [{ valueCents: "desc" }, { expectedCloseAt: "asc" }, { updatedAt: "asc" }],
    take: assistantDealRiskLimit
  });

  return {
    deals: deals.map((deal) => {
      const person = scopeWorkspaceRelation(actor.workspaceId, deal.person);
      const organization = scopeWorkspaceRelation(actor.workspaceId, deal.organization);
      return {
        activities: deal.activities.map((activity) => ({
          bucket: openActivityBucket(activity, now),
          dueAt: serializeDate(activity.dueAt),
          title: activity.title
        })),
        currency: deal.currency,
        expectedCloseAt: serializeDate(deal.expectedCloseAt),
        href: `/deals/${deal.id}`,
        id: deal.id,
        ownerLabel: deal.owner?.name ?? deal.owner?.email ?? "Unassigned",
        relatedLabel: organization?.name ?? formatPersonName(person),
        stageName: deal.stage.name,
        title: deal.title,
        updatedAt: deal.updatedAt.toISOString(),
        valueCents: deal.valueCents
      };
    }),
    generatedAt: now.toISOString(),
    lookedAt: ["Open deals", "Open follow-up activities", "Expected close dates", "Deal value", "Last updated date"]
  };
}

export async function buildAssistantEmailReplyContext(
  actor: WorkspaceActor,
  target: string,
  now = new Date()
): Promise<AssistantEmailReplyContext> {
  await ensureWorkspaceAccess(actor);
  const normalizedTarget = normalizeTarget(target);
  const since = addDays(now, -assistantEmailLookbackDays);
  const matchedPeople = normalizedTarget
    ? await prisma.person.findMany({
        where: {
          workspaceId: actor.workspaceId,
          ...activeWhere,
          OR: [
            { email: { contains: normalizedTarget, mode: "insensitive" } },
            { firstName: { contains: normalizedTarget, mode: "insensitive" } },
            { lastName: { contains: normalizedTarget, mode: "insensitive" } }
          ]
        },
        select: { email: true, firstName: true, id: true, lastName: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 8
      })
    : [];
  const terms = emailSearchTerms(normalizedTarget, matchedPeople);
  const messages = terms.length > 0
    ? await prisma.emailLog.findMany({
        where: {
          workspaceId: actor.workspaceId,
          occurredAt: { gte: since },
          ...emailLogAttachmentRelationsWhere(actor.workspaceId),
          OR: [
            ...terms.flatMap((term): Prisma.EmailLogWhereInput[] => [
              { fromText: { contains: term, mode: "insensitive" } },
              { toText: { contains: term, mode: "insensitive" } },
              { ccText: { contains: term, mode: "insensitive" } },
              { subject: { contains: term, mode: "insensitive" } }
            ]),
            ...(matchedPeople.length > 0 ? [{ personId: { in: matchedPeople.map((person) => person.id) } }] : [])
          ]
        },
        select: {
          direction: true,
          emailConnection: { select: { accountEmail: true, displayName: true, provider: true } },
          fromText: true,
          occurredAt: true,
          provider: true,
          subject: true,
          toText: true
        },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: assistantEmailLimit
      })
    : [];

  return {
    generatedAt: now.toISOString(),
    lookedAt: ["Stored workspace email logs", "Email dates and direction", "Safe participant text", "Source account labels"],
    matchedPeople: matchedPeople.map((person) => ({
      email: person.email,
      id: person.id,
      label: formatPersonName(person) ?? person.email ?? "Unnamed contact"
    })),
    messages: messages.map((message) => ({
      accountLabel: message.emailConnection?.displayName ?? message.emailConnection?.accountEmail ?? null,
      direction: message.direction,
      fromText: message.fromText,
      occurredAt: message.occurredAt.toISOString(),
      providerLabel: providerLabel(message.emailConnection?.provider ?? message.provider),
      subject: message.subject,
      toText: message.toText
    })),
    target: normalizedTarget || target.trim()
  };
}

const assistantActivityInclude = {
  deal: true,
  lead: true,
  organization: true,
  person: true
} satisfies Prisma.ActivityInclude;

type AssistantDealRelation = { deletedAt?: Date | string | null; title: string; workspaceId: string } | null;
type AssistantLeadRelation = { deletedAt?: Date | string | null; title: string; workspaceId: string } | null;
type AssistantOrganizationRelation = { deletedAt?: Date | string | null; name: string; workspaceId: string } | null;
type AssistantPersonRelation = {
  deletedAt?: Date | string | null;
  firstName: string | null;
  lastName: string | null;
  workspaceId: string;
} | null;

function assistantActivityItem<
  T extends {
    completedAt: Date | null;
    deal: AssistantDealRelation;
    dueAt: Date | null;
    id: string;
    lead: AssistantLeadRelation;
    organization: AssistantOrganizationRelation;
    person: AssistantPersonRelation;
    title: string;
    type: string;
  }
>(workspaceId: string, activity: T, now: Date): AssistantActivityContextItem {
  const deal = scopeWorkspaceRelation(workspaceId, activity.deal);
  const lead = scopeWorkspaceRelation(workspaceId, activity.lead);
  const person = scopeWorkspaceRelation(workspaceId, activity.person);
  const organization = scopeWorkspaceRelation(workspaceId, activity.organization);
  return {
    bucket: openActivityBucket(activity, now),
    completedAt: serializeDate(activity.completedAt),
    dueAt: serializeDate(activity.dueAt),
    href: `/activities/${activity.id}/edit`,
    id: activity.id,
    relatedLabel: deal?.title ?? lead?.title ?? organization?.name ?? formatPersonName(person),
    title: activity.title,
    type: activity.type
  };
}

function openActivityBucket(activity: { completedAt?: Date | string | null; dueAt?: Date | string | null }, now: Date) {
  const bucket = classifyActivityDue(activity, now);
  return bucket === "completed" ? "unscheduled" : bucket;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function serializeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

function normalizeTarget(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function emailSearchTerms(
  target: string,
  people: Array<{ email: string | null; firstName: string | null; lastName: string | null }>
) {
  const terms = new Set<string>();
  if (target) terms.add(target);
  for (const person of people) {
    if (person.email) terms.add(person.email);
    const name = formatPersonName(person);
    if (name) terms.add(name);
    if (person.firstName) terms.add(person.firstName);
    if (person.lastName) terms.add(person.lastName);
  }
  return Array.from(terms).filter((term) => term.length >= 2).slice(0, 10);
}

function providerLabel(provider: unknown) {
  if (provider === "GOOGLE_WORKSPACE") return "Gmail / Google Workspace";
  if (provider === "MICROSOFT_365") return "Microsoft 365";
  if (provider === "IMAP_SMTP") return "IMAP / SMTP";
  return null;
}
