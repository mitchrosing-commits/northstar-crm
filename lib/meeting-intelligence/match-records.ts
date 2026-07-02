import { prisma } from "@/lib/db/prisma";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

import type { CrmObjectType, CrmTarget, MatchedCrmObject, UnmatchedEntity } from "./types";

export type MatchRecordHints = {
  dealId?: string | null;
  leadId?: string | null;
  organizationId?: string | null;
  personIds?: string[];
};

export async function matchMeetingCrmObjects(
  actor: WorkspaceActor,
  input: { contextText?: string | null; hints?: MatchRecordHints; markdownText: string }
) {
  await ensureWorkspaceAccess(actor);
  const haystack = `${input.contextText ?? ""}\n${input.markdownText}`;
  const normalized = normalize(haystack);
  const emails = extractEmails(haystack);
  const emailDomains = new Set(Array.from(emails).map((email) => email.split("@")[1]).filter(Boolean));
  const [people, organizations, deals, leads] = await Promise.all([
    prisma.person.findMany({ where: { workspaceId: actor.workspaceId, ...activeWhere }, include: { organization: true } }),
    prisma.organization.findMany({ where: { workspaceId: actor.workspaceId, ...activeWhere } }),
    prisma.deal.findMany({ where: { workspaceId: actor.workspaceId, ...activeWhere }, include: { organization: true, person: true } }),
    prisma.lead.findMany({ where: { workspaceId: actor.workspaceId, ...activeWhere }, include: { organization: true, person: true } })
  ]);

  const matches = [
    ...people.flatMap((person) => {
      const displayName = formatPersonName(person);
      return scoreMatch({
        displayName,
        emails,
        emailDomains,
        haystack,
        hint: input.hints?.personIds?.includes(person.id),
        id: person.id,
        normalized,
        objectType: "person",
        secondaryTerms: [person.email, person.organization?.name]
      });
    }),
    ...organizations.flatMap((organization) =>
      scoreMatch({
        displayName: organization.name,
        emailDomains,
        haystack,
        hint: input.hints?.organizationId === organization.id,
        id: organization.id,
        normalized,
        objectType: "organization",
        secondaryTerms: [organization.domain]
      })
    ),
    ...deals.flatMap((deal) =>
      scoreMatch({
        displayName: deal.title,
        emailDomains,
        haystack,
        hint: input.hints?.dealId === deal.id,
        id: deal.id,
        normalized,
        objectType: "deal",
        secondaryTerms: [deal.organization?.name, formatPersonName(deal.person)],
        status: deal.status
      })
    ),
    ...leads.flatMap((lead) =>
      scoreMatch({
        displayName: lead.title,
        emailDomains,
        haystack,
        hint: input.hints?.leadId === lead.id,
        id: lead.id,
        normalized,
        objectType: "lead",
        secondaryTerms: [lead.organization?.name, formatPersonName(lead.person), lead.source],
        status: lead.status
      })
    )
  ];
  const deduped = dedupeMatches(matches).slice(0, 16);
  const unmatchedEntities = buildUnmatchedEntities(haystack, deduped);

  return {
    matchedObjects: markAmbiguity(deduped),
    unmatchedEntities
  };
}

export function targetFromMatch(match: MatchedCrmObject): CrmTarget {
  return { id: match.id, label: match.displayName, type: match.objectType };
}

function scoreMatch(input: {
  displayName?: string | null;
  emailDomains?: Set<string>;
  emails?: Set<string>;
  haystack: string;
  hint?: boolean;
  id: string;
  normalized: string;
  objectType: CrmObjectType;
  secondaryTerms?: Array<string | null | undefined>;
  status?: string;
}): MatchedCrmObject[] {
  const displayName = input.displayName?.trim();
  if (!displayName) return [];
  const directPhrase = containsPhrase(input.normalized, displayName);
  const partialName = input.objectType === "person" ? containsPersonName(input.normalized, displayName) : false;
  const secondary = input.secondaryTerms?.find((term) => term && containsPhrase(input.normalized, term));
  const email = input.secondaryTerms?.find((term) => term && input.emails?.has(term.toLowerCase()));
  const domain = input.objectType === "organization" ? input.secondaryTerms?.find((term) => term && input.emailDomains?.has(term.toLowerCase())) : undefined;
  const hint = Boolean(input.hint);

  if (!hint && !directPhrase && !partialName && !secondary && !email && !domain) return [];
  const matchedReason = hint
    ? "Context hint match"
    : email
      ? "Exact email match"
      : domain
        ? "Email domain matched organization"
      : directPhrase
        ? exactReason(input.objectType)
        : partialName
          ? "Partial full-name match"
          : "Related name phrase";
  const confidence = hint || email || directPhrase ? "high" : partialName || domain ? "medium" : "medium";

  return [
    {
      confidence,
      displayName,
      evidenceExcerpt: evidenceExcerpt(input.haystack, String(email ?? domain ?? (directPhrase || partialName ? displayName : secondary))),
      id: input.id,
      matchedReason,
      objectType: input.objectType,
      status: input.status,
      warning: lifecycleWarning(input.objectType, input.status)
    }
  ];
}

function markAmbiguity(matches: MatchedCrmObject[]) {
  const nameCounts = matches.reduce((map, match) => {
    const key = `${match.objectType}:${normalize(match.displayName)}`;
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  return matches.map((match) => {
    const key = `${match.objectType}:${normalize(match.displayName)}`;
    if ((nameCounts.get(key) ?? 0) <= 1) return match;
    return {
      ...match,
      confidence: "ambiguous" as const,
      warning: `Multiple ${match.objectType} records matched "${match.displayName}".`
    };
  });
}

function dedupeMatches(matches: MatchedCrmObject[]) {
  const rank = { high: 3, medium: 2, low: 1, ambiguous: 0 };
  const byKey = new Map<string, MatchedCrmObject>();
  for (const match of matches) {
    const key = `${match.objectType}:${match.id}`;
    const existing = byKey.get(key);
    if (!existing || rank[match.confidence] > rank[existing.confidence]) byKey.set(key, match);
  }
  return Array.from(byKey.values()).sort((a, b) => rank[b.confidence] - rank[a.confidence] || a.displayName.localeCompare(b.displayName));
}

function buildUnmatchedEntities(text: string, matches: MatchedCrmObject[]): UnmatchedEntity[] {
  const matchedNames = new Set(matches.map((match) => normalize(match.displayName)));
  const candidates = Array.from(text.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g))
    .map((match) => match[0].trim())
    .filter((name) => !commonEntityName(name) && !matchedNames.has(normalize(name)));
  return unique(candidates)
    .slice(0, 8)
    .map((name) => ({
      entityType: "unknown" as const,
      evidenceExcerpt: evidenceExcerpt(text, name),
      name,
      reason: "Mentioned in meeting text but not matched to a CRM record."
    }));
}

function lifecycleWarning(objectType: CrmObjectType, status?: string) {
  if (objectType === "deal" && status && status !== "OPEN") return "Closed deals are locked for new notes and activities.";
  if (objectType === "lead" && status === "CONVERTED") return "Converted leads are locked for new notes and activities.";
  return undefined;
}

function containsPhrase(haystack: string, phrase: string) {
  const normalizedPhrase = normalize(phrase);
  if (normalizedPhrase.length < 3) return false;
  return haystack.includes(normalizedPhrase);
}

function containsPersonName(haystack: string, displayName: string) {
  const tokens = normalize(displayName)
    .split(" ")
    .filter((token) => token.length > 2);
  if (tokens.length < 2) return false;
  return tokens.every((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(haystack));
}

function exactReason(objectType: CrmObjectType) {
  if (objectType === "organization") return "Exact organization match";
  if (objectType === "deal") return "Deal title match";
  if (objectType === "lead") return "Lead title match";
  return "Exact name match";
}

function evidenceExcerpt(text: string, term: string) {
  const index = normalize(text).indexOf(normalize(term));
  if (index < 0) return text.trim().split("\n").find(Boolean)?.slice(0, 180) ?? "";
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + term.length + 110);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function extractEmails(text: string) {
  return new Set(Array.from(text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map((match) => match[0].toLowerCase()));
}

function commonEntityName(name: string) {
  return /^(Meeting Intake|User Context|Meeting Notes|Action Items|Open Questions|Risks|Source|CRM|Northstar)$/i.test(name);
}

function formatPersonName(person: { firstName: string | null; lastName: string | null } | null) {
  if (!person) return "";
  return [person.firstName, person.lastName].filter(Boolean).join(" ").trim();
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co)\b\.?/g, " ")
    .replace(/[^a-z0-9@.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
