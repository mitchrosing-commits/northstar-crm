import { prisma } from "@/lib/db/prisma";
import {
  activityAttachmentRelationsWhere,
  emailLogAttachmentRelationsWhere,
  noteAttachmentRelationsWhere
} from "./record-guards";
import { scopeWorkspaceRelation, type WorkspaceScopedRelation } from "./relation-scope";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";
import { userDisplaySelect } from "./user-select";

const searchTake = 6;
const maxSearchQueryLength = 120;

export async function searchCrm(actor: WorkspaceActor, rawQuery: unknown) {
  await ensureWorkspaceAccess(actor);
  const query = normalizeSearchQuery(rawQuery);
  if (!query) {
    return {
      query,
      deals: [],
      leads: [],
      people: [],
      organizations: [],
      activities: [],
      notes: [],
      quotes: [],
      emailLogs: []
    };
  }

  const contains = { contains: query, mode: "insensitive" as const };
  const scoped = { workspaceId: actor.workspaceId, ...activeWhere };
  const [deals, leads, people, organizations, activities, notes, quotes, emailLogs] = await Promise.all([
    prisma.deal.findMany({
      where: { ...scoped, title: contains },
      include: { stage: true, organization: true, person: true, owner: { select: userDisplaySelect } },
      orderBy: { updatedAt: "desc" },
      take: searchTake
    }),
    prisma.lead.findMany({
      where: { ...scoped, OR: [{ title: contains }, { source: contains }] },
      include: { person: true, organization: true, owner: { select: userDisplaySelect } },
      orderBy: { updatedAt: "desc" },
      take: searchTake
    }),
    prisma.person.findMany({
      where: {
        ...scoped,
        OR: [{ firstName: contains }, { lastName: contains }, { email: contains }, { phone: contains }]
      },
      include: { organization: true, owner: { select: userDisplaySelect } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: searchTake
    }),
    prisma.organization.findMany({
      where: { ...scoped, OR: [{ name: contains }, { domain: contains }] },
      include: { owner: { select: userDisplaySelect } },
      orderBy: { name: "asc" },
      take: searchTake
    }),
    prisma.activity.findMany({
      where: { ...scoped, ...activityAttachmentRelationsWhere(actor.workspaceId), OR: [{ title: contains }, { description: contains }] },
      include: { deal: true, lead: true, person: true, organization: true, owner: { select: userDisplaySelect } },
      orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }],
      take: searchTake
    }),
    prisma.note.findMany({
      where: { ...scoped, ...noteAttachmentRelationsWhere(actor.workspaceId), body: contains },
      include: { deal: true, lead: true, person: true, organization: true, author: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: searchTake
    }),
    prisma.quote.findMany({
      where: {
        workspaceId: actor.workspaceId,
        deal: { is: { workspaceId: actor.workspaceId, ...activeWhere } },
        OR: [
          { number: contains },
          { deal: { is: { workspaceId: actor.workspaceId, ...activeWhere, title: contains } } },
          {
            deal: {
              is: {
                workspaceId: actor.workspaceId,
                ...activeWhere,
                organization: { is: { workspaceId: actor.workspaceId, ...activeWhere, name: contains } }
              }
            }
          },
          {
            deal: {
              is: {
                workspaceId: actor.workspaceId,
                ...activeWhere,
                person: {
                  is: {
                    workspaceId: actor.workspaceId,
                    ...activeWhere,
                    OR: [{ firstName: contains }, { lastName: contains }, { email: contains }]
                  }
                }
              }
            }
          }
        ]
      },
      include: { deal: { include: { organization: true, person: true, owner: { select: userDisplaySelect } } } },
      orderBy: { updatedAt: "desc" },
      take: searchTake
    }),
    prisma.emailLog.findMany({
      where: {
        workspaceId: actor.workspaceId,
        ...emailLogAttachmentRelationsWhere(actor.workspaceId),
        OR: [{ subject: contains }, { body: contains }, { fromText: contains }, { toText: contains }]
      },
      include: { deal: true, lead: true, person: true, organization: true },
      orderBy: { occurredAt: "desc" },
      take: searchTake
    })
  ]);

  return {
    query,
    deals: deals.map((deal) => scopeDealSearchRelations(actor.workspaceId, deal)),
    leads: leads.map((lead) => scopeLeadSearchRelations(actor.workspaceId, lead)),
    people: people.map((person) => scopePersonSearchRelations(actor.workspaceId, person)),
    organizations,
    activities: activities.map((activity) => scopeAttachedSearchRelations(actor.workspaceId, activity)),
    notes: notes.map((note) => scopeAttachedSearchRelations(actor.workspaceId, note)),
    quotes: quotes.map((quote) => ({
      ...quote,
      deal: scopeDealSearchRelations(actor.workspaceId, quote.deal)
    })),
    emailLogs: emailLogs.map((emailLog) => scopeAttachedSearchRelations(actor.workspaceId, emailLog))
  };
}

function normalizeSearchQuery(rawQuery: unknown) {
  return typeof rawQuery === "string" ? rawQuery.trim().slice(0, maxSearchQueryLength) : "";
}

function scopeDealSearchRelations<T extends { organization: WorkspaceScopedRelation; person: WorkspaceScopedRelation }>(
  workspaceId: string,
  deal: T
) {
  return {
    ...deal,
    organization: scopeWorkspaceRelation(workspaceId, deal.organization),
    person: scopeWorkspaceRelation(workspaceId, deal.person)
  };
}

function scopeLeadSearchRelations<T extends { organization: WorkspaceScopedRelation; person: WorkspaceScopedRelation }>(
  workspaceId: string,
  lead: T
) {
  return {
    ...lead,
    organization: scopeWorkspaceRelation(workspaceId, lead.organization),
    person: scopeWorkspaceRelation(workspaceId, lead.person)
  };
}

function scopePersonSearchRelations<T extends { organization: WorkspaceScopedRelation }>(workspaceId: string, person: T) {
  return {
    ...person,
    organization: scopeWorkspaceRelation(workspaceId, person.organization)
  };
}

function scopeAttachedSearchRelations<
  T extends {
    deal: WorkspaceScopedRelation;
    lead: WorkspaceScopedRelation;
    person: WorkspaceScopedRelation;
    organization: WorkspaceScopedRelation;
  }
>(workspaceId: string, record: T) {
  return {
    ...record,
    deal: scopeWorkspaceRelation(workspaceId, record.deal),
    lead: scopeWorkspaceRelation(workspaceId, record.lead),
    person: scopeWorkspaceRelation(workspaceId, record.person),
    organization: scopeWorkspaceRelation(workspaceId, record.organization)
  };
}
