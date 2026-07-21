import { Prisma } from "@prisma/client";

import { classifyActivityDue, startOfDay } from "@/lib/activity-due";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { redactSensitiveText } from "@/lib/security/redaction";
import {
  actionableActivityRelationsWhere,
  activityAttachmentRelationsWhere,
  emailLogAttachmentRelationsWhere
} from "@/lib/services/record-guards";
import { scopeWorkspaceRelation } from "@/lib/services/relation-scope";
import { userDisplaySelect } from "@/lib/services/user-select";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

const assistantTodayActivityLimit = 30;
const assistantDealRiskLimit = 50;
const assistantDealBriefActivityLimit = 12;
const assistantDealBriefAuditLimit = 8;
const assistantDealBriefEmailLimit = 8;
const assistantDealBriefMeetingLimit = 5;
const assistantDealBriefNoteLimit = 8;
const assistantDealBriefQuoteLimit = 8;
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

export type AssistantDealBriefCandidate = {
  href: string;
  id: string;
  label: string;
  relatedLabel: string | null;
  stageName: string;
  status: string;
};

export type AssistantDealBriefActivity = {
  completedAt: string | null;
  createdAt: string;
  description: string | null;
  dueAt: string | null;
  href: string;
  id: string;
  ownerLabel: string | null;
  title: string;
  type: string;
  updatedAt: string;
};

export type AssistantDealBriefContext = {
  candidates: AssistantDealBriefCandidate[];
  deal: {
    activities: AssistantDealBriefActivity[];
    auditEvents: Array<{
      action: string;
      actorLabel: string | null;
      createdAt: string;
    }>;
    commercial: {
      currency: string;
      expectedCloseAt: string | null;
      lineItems: Array<{
        createdAt: string;
        description: string | null;
        lineTotalCents: number;
        productName: string;
        quantity: number;
        updatedAt: string;
      }>;
      quotes: Array<{
        createdAt: string;
        href: string;
        number: string;
        status: string;
        totalCents: number;
        updatedAt: string;
      }>;
      valueCents: number | null;
    };
    createdAt: string;
    emails: Array<{
      direction: string;
      href: string;
      occurredAt: string;
      participantSummary: string;
      snippet: string;
      subject: string;
    }>;
    expectedCloseAt: string | null;
    href: string;
    id: string;
    meetings: Array<{
      activityHref: string | null;
      activityTitle: string | null;
      detail: string;
      status: string;
      updatedAt: string;
    }>;
    notes: Array<{
      body: string;
      createdAt: string;
      id: string;
    }>;
    organization: {
      domain: string | null;
      href: string;
      id: string;
      name: string;
      ownerLabel: string | null;
      updatedAt: string;
    } | null;
    ownerLabel: string;
    person: {
      email: string | null;
      href: string;
      id: string;
      label: string;
      organizationLabel: string | null;
      phone: string | null;
      relationshipBusinessConcerns: string | null;
      relationshipCommunicationStyle: string | null;
      relationshipFollowUpReminders: string | null;
      title: string | null;
      updatedAt: string;
    } | null;
    stageName: string;
    status: string;
    title: string;
    updatedAt: string;
  } | null;
  generatedAt: string;
  lookedAt: string[];
  missingInfo: string[];
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

export async function buildAssistantDealBriefContext(
  actor: WorkspaceActor,
  target: string,
  now = new Date()
): Promise<AssistantDealBriefContext> {
  await ensureWorkspaceAccess(actor);
  const normalizedTarget = normalizeTarget(target);
  const candidates = await resolveDealBriefCandidates(actor, normalizedTarget);
  const selected = candidates.length === 1 ? candidates[0] : null;
  const missingInfo = [
    ...(normalizedTarget ? [] : ["No deal target was provided. Ask from a deal page or include a deal name/link."]),
    ...(normalizedTarget && candidates.length === 0 ? ["No matching open or historical deal was found in this workspace."] : []),
    ...(candidates.length > 1 ? ["Multiple matching deals were found. Open the intended deal or include the exact deal link."] : [])
  ];
  if (!selected) {
    return {
      candidates,
      deal: null,
      generatedAt: now.toISOString(),
      lookedAt: ["Workspace-scoped deal lookup"],
      missingInfo,
      target: normalizedTarget
    };
  }

  const deal = await prisma.deal.findFirst({
    include: {
      activities: {
        orderBy: [{ completedAt: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
        select: {
          completedAt: true,
          createdAt: true,
          description: true,
          dueAt: true,
          id: true,
          owner: { select: userDisplaySelect },
          title: true,
          type: true,
          updatedAt: true
        },
        take: assistantDealBriefActivityLimit,
        where: { workspaceId: actor.workspaceId, ...activeWhere, ...activityAttachmentRelationsWhere(actor.workspaceId) }
      },
      lineItems: {
        orderBy: { createdAt: "desc" },
        select: {
          createdAt: true,
          description: true,
          lineTotalCents: true,
          productName: true,
          quantity: true,
          updatedAt: true
        },
        take: 8
      },
      notes: {
        orderBy: { createdAt: "desc" },
        select: { body: true, createdAt: true, id: true },
        take: assistantDealBriefNoteLimit,
        where: { workspaceId: actor.workspaceId, ...activeWhere }
      },
      organization: {
        select: {
          deletedAt: true,
          domain: true,
          id: true,
          name: true,
          owner: { select: userDisplaySelect },
          updatedAt: true,
          workspaceId: true
        }
      },
      owner: { select: userDisplaySelect },
      person: {
        select: {
          deletedAt: true,
          email: true,
          firstName: true,
          id: true,
          lastName: true,
          organization: { select: { deletedAt: true, name: true, workspaceId: true } },
          phone: true,
          relationshipBusinessConcerns: true,
          relationshipCommunicationStyle: true,
          relationshipFollowUpReminders: true,
          title: true,
          updatedAt: true,
          workspaceId: true
        }
      },
      quotes: {
        orderBy: { updatedAt: "desc" },
        select: { createdAt: true, id: true, number: true, status: true, totalCents: true, updatedAt: true },
        take: assistantDealBriefQuoteLimit
      },
      stage: { select: { name: true } }
    },
    where: { id: selected.id, workspaceId: actor.workspaceId, ...activeWhere }
  });
  if (!deal) {
    return {
      candidates: [],
      deal: null,
      generatedAt: now.toISOString(),
      lookedAt: ["Workspace-scoped deal lookup"],
      missingInfo: ["The selected deal is no longer available in this workspace."],
      target: normalizedTarget
    };
  }

  const [emails, meetings, auditEvents] = await Promise.all([
    prisma.emailLog.findMany({
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      select: {
        body: true,
        direction: true,
        fromText: true,
        id: true,
        occurredAt: true,
        providerSnippet: true,
        subject: true,
        toText: true
      },
      take: assistantDealBriefEmailLimit,
      where: {
        workspaceId: actor.workspaceId,
        dealId: deal.id,
        ...emailLogAttachmentRelationsWhere(actor.workspaceId)
      }
    }),
    prisma.meetingActivityAssociation.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        activity: { select: { id: true, title: true } },
        meetingIntake: {
          select: {
            contextText: true,
            markdownText: true,
            status: true,
            updatedAt: true
          }
        }
      },
      take: assistantDealBriefMeetingLimit,
      where: { workspaceId: actor.workspaceId, dealId: deal.id, meetingIntakeId: { not: null } }
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        action: true,
        actor: { select: userDisplaySelect },
        createdAt: true
      },
      take: assistantDealBriefAuditLimit,
      where: { workspaceId: actor.workspaceId, entityType: "Deal", entityId: deal.id }
    })
  ]);

  const person = scopeWorkspaceRelation(actor.workspaceId, deal.person);
  const organization = scopeWorkspaceRelation(actor.workspaceId, deal.organization);
  const personOrganization = scopeWorkspaceRelation(actor.workspaceId, person?.organization ?? null);

  return {
    candidates,
    deal: {
      activities: deal.activities.map((activity) => ({
        completedAt: serializeDate(activity.completedAt),
        createdAt: activity.createdAt.toISOString(),
        description: safeSnippet(activity.description, 220),
        dueAt: serializeDate(activity.dueAt),
        href: `/activities/${activity.id}/edit`,
        id: activity.id,
        ownerLabel: displayUserLabel(activity.owner),
        title: safeSnippet(activity.title, 160) || "Untitled activity",
        type: activity.type,
        updatedAt: activity.updatedAt.toISOString()
      })),
      auditEvents: auditEvents.map((event) => ({
        action: safeSnippet(event.action, 120) || "deal.updated",
        actorLabel: displayUserLabel(event.actor),
        createdAt: event.createdAt.toISOString()
      })),
      commercial: {
        currency: deal.currency,
        expectedCloseAt: serializeDate(deal.expectedCloseAt),
        lineItems: deal.lineItems.map((item) => ({
          createdAt: item.createdAt.toISOString(),
          description: safeSnippet(item.description, 160),
          lineTotalCents: item.lineTotalCents,
          productName: safeSnippet(item.productName, 140) || "Line item",
          quantity: item.quantity,
          updatedAt: item.updatedAt.toISOString()
        })),
        quotes: deal.quotes.map((quote) => ({
          createdAt: quote.createdAt.toISOString(),
          href: `/deals/${deal.id}/quotes/${quote.id}`,
          number: safeSnippet(quote.number, 80) || quote.id,
          status: quote.status,
          totalCents: quote.totalCents,
          updatedAt: quote.updatedAt.toISOString()
        })),
        valueCents: deal.valueCents
      },
      createdAt: deal.createdAt.toISOString(),
      emails: emails.map((email) => ({
        direction: email.direction,
        href: `/email#email-card-${email.id}`,
        occurredAt: email.occurredAt.toISOString(),
        participantSummary: emailParticipantSummary(email),
        snippet: safeSnippet(email.providerSnippet || email.body, 220) || "No safe email snippet stored",
        subject: safeSnippet(email.subject, 160) || "Stored email"
      })),
      expectedCloseAt: serializeDate(deal.expectedCloseAt),
      href: `/deals/${deal.id}`,
      id: deal.id,
      meetings: meetings.flatMap((association) => {
        const meeting = association.meetingIntake;
        if (!meeting) return [];
        return [{
          activityHref: association.activity ? `/activities/${association.activity.id}/edit` : null,
          activityTitle: association.activity ? safeSnippet(association.activity.title, 160) || "Meeting activity" : null,
          detail: safeSnippet(meeting.markdownText || meeting.contextText, 260) || "Meeting context stored without a safe summary snippet.",
          status: meeting.status,
          updatedAt: meeting.updatedAt.toISOString()
        }];
      }),
      notes: deal.notes.map((note) => ({
        body: safeSnippet(note.body, 360) || "Empty note",
        createdAt: note.createdAt.toISOString(),
        id: note.id
      })),
      organization: organization ? {
        domain: safeSnippet(organization.domain, 120),
        href: `/organizations/${organization.id}`,
        id: organization.id,
        name: safeSnippet(organization.name, 140) || "Unnamed organization",
        ownerLabel: displayUserLabel(organization.owner),
        updatedAt: organization.updatedAt.toISOString()
      } : null,
      ownerLabel: displayUserLabel(deal.owner) ?? "Unassigned",
      person: person ? {
        email: safeSnippet(person.email, 160),
        href: `/contacts/${person.id}`,
        id: person.id,
        label: formatPersonName(person) ?? person.email ?? "Unnamed contact",
        organizationLabel: personOrganization?.name ?? null,
        phone: safeSnippet(person.phone, 80),
        relationshipBusinessConcerns: safeSnippet(person.relationshipBusinessConcerns, 220),
        relationshipCommunicationStyle: safeSnippet(person.relationshipCommunicationStyle, 160),
        relationshipFollowUpReminders: safeSnippet(person.relationshipFollowUpReminders, 220),
        title: safeSnippet(person.title, 120),
        updatedAt: person.updatedAt.toISOString()
      } : null,
      stageName: deal.stage.name,
      status: deal.status,
      title: safeSnippet(deal.title, 160) || "Untitled deal",
      updatedAt: deal.updatedAt.toISOString()
    },
    generatedAt: now.toISOString(),
    lookedAt: [
      "Deal fields",
      "Linked contact and organization",
      "Open and completed activities",
      "Recent notes",
      "Stored email context",
      "Quotes and line items",
      "Meeting Intelligence summaries",
      "Relationship Memory fields",
      "Recent deal audit events"
    ],
    missingInfo,
    target: normalizedTarget
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

async function resolveDealBriefCandidates(actor: WorkspaceActor, target: string): Promise<AssistantDealBriefCandidate[]> {
  if (!target) return [];
  const explicitId = target.match(/(?:^|\/deals\/)([A-Za-z0-9_-]{8,80})(?:\b|$)/)?.[1];
  const where: Prisma.DealWhereInput = explicitId
    ? { id: explicitId, workspaceId: actor.workspaceId, ...activeWhere }
    : { workspaceId: actor.workspaceId, ...activeWhere, title: { contains: target, mode: "insensitive" } };
  const deals = await prisma.deal.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      organization: { select: { deletedAt: true, name: true, workspaceId: true } },
      person: { select: { deletedAt: true, firstName: true, lastName: true, workspaceId: true } },
      stage: { select: { name: true } },
      status: true,
      title: true
    },
    take: 6,
    where
  });
  const exact = explicitId
    ? deals
    : deals.filter((deal) => deal.title.trim().toLowerCase() === target.trim().toLowerCase());
  const selectedDeals = exact.length === 1 ? exact : deals;
  return selectedDeals.map((deal) => {
    const person = scopeWorkspaceRelation(actor.workspaceId, deal.person);
    const organization = scopeWorkspaceRelation(actor.workspaceId, deal.organization);
    return {
      href: `/deals/${deal.id}`,
      id: deal.id,
      label: deal.title,
      relatedLabel: organization?.name ?? formatPersonName(person),
      stageName: deal.stage.name,
      status: deal.status
    };
  });
}

function displayUserLabel(user: { email: string | null; name: string | null } | null | undefined) {
  return user?.name ?? user?.email ?? null;
}

function safeSnippet(value: string | null | undefined, maxLength: number) {
  const redacted = redactSensitiveText(value ?? "").trim().replace(/\s+/g, " ");
  return redacted ? redacted.slice(0, maxLength) : null;
}

function emailParticipantSummary(email: { fromText: string | null; toText: string | null }) {
  const from = safeSnippet(email.fromText, 80);
  const to = safeSnippet(email.toText, 80);
  if (from && to) return `From ${from} to ${to}`;
  if (from) return `From ${from}`;
  if (to) return `To ${to}`;
  return "No safe participant text";
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
