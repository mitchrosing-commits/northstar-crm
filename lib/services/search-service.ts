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
const searchCandidateTake = 80;
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
      where: scoped,
      include: { stage: true, organization: true, person: true, owner: { select: userDisplaySelect } },
      orderBy: { updatedAt: "desc" },
      take: searchCandidateTake
    }),
    prisma.lead.findMany({
      where: scoped,
      include: { person: true, organization: true, owner: { select: userDisplaySelect } },
      orderBy: { updatedAt: "desc" },
      take: searchCandidateTake
    }),
    prisma.person.findMany({
      where: scoped,
      include: { organization: true, owner: { select: userDisplaySelect } },
      orderBy: [{ updatedAt: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
      take: searchCandidateTake
    }),
    prisma.organization.findMany({
      where: scoped,
      include: { owner: { select: userDisplaySelect } },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: searchCandidateTake
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
        deal: { is: { workspaceId: actor.workspaceId, ...activeWhere } }
      },
      include: { deal: { include: { organization: true, person: true, owner: { select: userDisplaySelect } } } },
      orderBy: { updatedAt: "desc" },
      take: searchCandidateTake
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
    deals: rankedSearchResults(query, deals, (deal) => [
      deal.title,
      workspaceRelationField(actor.workspaceId, deal.organization, "name"),
      workspaceRelationField(actor.workspaceId, deal.person, "email"),
      workspaceRelationField(actor.workspaceId, deal.person, "firstName"),
      workspaceRelationField(actor.workspaceId, deal.person, "lastName")
    ], {
      open: (deal) => deal.status === "OPEN",
      updatedAt: (deal) => deal.updatedAt
    }).map((deal) => scopeDealSearchRelations(actor.workspaceId, deal)),
    leads: rankedSearchResults(query, leads, (lead) => [
      lead.title,
      lead.source,
      workspaceRelationField(actor.workspaceId, lead.organization, "name"),
      workspaceRelationField(actor.workspaceId, lead.person, "email"),
      workspaceRelationField(actor.workspaceId, lead.person, "firstName"),
      workspaceRelationField(actor.workspaceId, lead.person, "lastName")
    ], {
      open: (lead) => lead.status !== "DISQUALIFIED" && lead.status !== "CONVERTED",
      updatedAt: (lead) => lead.updatedAt
    }).map((lead) => scopeLeadSearchRelations(actor.workspaceId, lead)),
    people: rankedSearchResults(query, people, (person) => [
      person.firstName,
      person.lastName,
      person.email,
      person.phone,
      workspaceRelationField(actor.workspaceId, person.organization, "name")
    ], {
      updatedAt: (person) => person.updatedAt
    }).map((person) => scopePersonSearchRelations(actor.workspaceId, person)),
    organizations: rankedSearchResults(query, organizations, (organization) => [organization.name, organization.domain], {
      updatedAt: (organization) => organization.updatedAt
    }),
    activities: activities.map((activity) => scopeAttachedSearchRelations(actor.workspaceId, activity)),
    notes: notes.map((note) => scopeAttachedSearchRelations(actor.workspaceId, note)),
    quotes: rankedSearchResults(
      query,
      quotes,
      (quote) => [
        quote.number,
        quote.deal.title,
        workspaceRelationField(actor.workspaceId, quote.deal.organization, "name"),
        workspaceRelationField(actor.workspaceId, quote.deal.person, "email"),
        workspaceRelationField(actor.workspaceId, quote.deal.person, "firstName"),
        workspaceRelationField(actor.workspaceId, quote.deal.person, "lastName")
      ],
      {
        open: (quote) => quote.deal.status === "OPEN",
        updatedAt: (quote) => quote.updatedAt
      }
    ).map((quote) => ({
      ...quote,
      deal: scopeDealSearchRelations(actor.workspaceId, quote.deal)
    })),
    emailLogs: emailLogs.map((emailLog) => scopeAttachedSearchRelations(actor.workspaceId, emailLog))
  };
}

function normalizeSearchQuery(rawQuery: unknown) {
  return typeof rawQuery === "string" ? rawQuery.trim().slice(0, maxSearchQueryLength) : "";
}

function workspaceRelationField(
  workspaceId: string,
  relation: ({ deletedAt?: Date | string | null; workspaceId?: string | null } & Record<string, unknown>) | null | undefined,
  field: string
) {
  const value = relation?.workspaceId === workspaceId && !relation.deletedAt ? relation[field] : null;
  return typeof value === "string" ? value : null;
}

function rankedSearchResults<T>(
  query: string,
  records: T[],
  fields: (record: T) => Array<string | null | undefined>,
  options: {
    open?: (record: T) => boolean;
    updatedAt?: (record: T) => Date | string | null | undefined;
  } = {}
) {
  return records
    .map((record) => {
      const score = recordSearchScore(query, fields(record));
      if (score == null) return null;
      const openBoost = options.open?.(record) ? 20 : 0;
      return {
        record,
        score: score + openBoost,
        updatedAt: normalizeTimestamp(options.updatedAt?.(record))
      };
    })
    .filter((item): item is { record: T; score: number; updatedAt: number } => Boolean(item))
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
    .slice(0, searchTake)
    .map((item) => item.record);
}

function recordSearchScore(query: string, fields: Array<string | null | undefined>) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return null;
  const queryTokens = searchTokens(normalizedQuery);
  let bestScore: number | null = null;

  for (const field of fields) {
    const normalizedField = normalizeSearchText(field);
    if (!normalizedField) continue;
    let score: number | null = null;
    if (normalizedField === normalizedQuery) score = 1000;
    else if (normalizedField.startsWith(normalizedQuery)) score = 900;
    else if (normalizedField.includes(normalizedQuery)) score = 800;
    else score = fuzzyTokenScore(queryTokens, searchTokens(normalizedField));
    if (score != null && (bestScore == null || score > bestScore)) bestScore = score;
  }

  return bestScore;
}

function fuzzyTokenScore(queryTokens: string[], fieldTokens: string[]) {
  if (queryTokens.length === 0 || fieldTokens.length === 0) return null;
  const matchedScores: number[] = [];
  for (const queryToken of queryTokens) {
    const bestTokenScore = fieldTokens.reduce<number | null>((best, fieldToken) => {
      const distance = damerauLevenshteinDistance(queryToken, fieldToken, typoTolerance(queryToken));
      if (distance == null) return best;
      const score = 680 - distance * 80 + Math.min(queryToken.length, fieldToken.length);
      return best == null || score > best ? score : best;
    }, null);
    if (bestTokenScore != null) matchedScores.push(bestTokenScore);
  }
  const requiredMatches = queryTokens.length === 1 ? 1 : Math.ceil(queryTokens.length / 2);
  if (matchedScores.length < requiredMatches) return null;
  const coveragePenalty = (queryTokens.length - matchedScores.length) * 120;
  return Math.min(...matchedScores) - coveragePenalty;
}

function normalizeSearchText(value: unknown) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9@.]+/g, " ").trim() : "";
}

function searchTokens(value: string) {
  return value.split(/\s+/).filter((token) => token.length >= 3);
}

function typoTolerance(token: string) {
  if (token.length <= 4) return 1;
  if (token.length <= 8) return 2;
  return 3;
}

function damerauLevenshteinDistance(left: string, right: string, maxDistance: number) {
  if (Math.abs(left.length - right.length) > maxDistance) return null;
  const rows = left.length + 1;
  const cols = right.length + 1;
  const distances = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let row = 0; row < rows; row += 1) distances[row][0] = row;
  for (let col = 0; col < cols; col += 1) distances[0][col] = col;

  for (let row = 1; row < rows; row += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let col = 1; col < cols; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      let value = Math.min(
        distances[row - 1][col] + 1,
        distances[row][col - 1] + 1,
        distances[row - 1][col - 1] + cost
      );
      if (row > 1 && col > 1 && left[row - 1] === right[col - 2] && left[row - 2] === right[col - 1]) {
        value = Math.min(value, distances[row - 2][col - 2] + 1);
      }
      distances[row][col] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return null;
  }

  const distance = distances[left.length][right.length];
  return distance <= maxDistance ? distance : null;
}

function normalizeTimestamp(value: Date | string | null | undefined) {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
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
