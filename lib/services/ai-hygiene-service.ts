import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";

import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

export type AiHygieneSuggestion = {
  detail: string;
  evidence: string[];
  id: string;
  recordHref?: string;
  reviewFirst: true;
  severity: "attention" | "info" | "warning";
  title: string;
  type:
    | "closed_deal_open_activity"
    | "duplicate_contact"
    | "duplicate_organization"
    | "meeting_intelligence_review"
    | "possible_contact_org_link"
    | "relationship_memory_placement"
    | "stale_deal"
    | "unlinked_email";
};

export async function listAiHygieneSuggestions(
  actor: WorkspaceActor,
  options: { limit?: number; now?: Date } = {}
): Promise<AiHygieneSuggestion[]> {
  await ensureWorkspaceAccess(actor);
  const limit = Math.min(Math.max(options.limit ?? 12, 1), 25);
  const now = options.now ?? new Date();
  const staleDate = new Date(now);
  staleDate.setDate(staleDate.getDate() - 30);

  const [people, organizations, deals, emailLogs, notes, meetingIntakes] = await Promise.all([
    prisma.person.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { email: true, firstName: true, id: true, lastName: true, organizationId: true },
      orderBy: { updatedAt: "desc" },
      take: 200
    }),
    prisma.organization.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      select: { domain: true, id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: 200
    }),
    prisma.deal.findMany({
      where: { workspaceId: actor.workspaceId, ...activeWhere },
      include: { activities: { where: { workspaceId: actor.workspaceId, ...activeWhere }, take: 5 } },
      orderBy: { updatedAt: "asc" },
      take: 100
    }),
    prisma.emailLog.findMany({
      where: {
        dealId: null,
        leadId: null,
        organizationId: null,
        personId: null,
        workspaceId: actor.workspaceId
      },
      select: { direction: true, id: true, occurredAt: true, subject: true },
      orderBy: { occurredAt: "desc" },
      take: 20
    }),
    prisma.note.findMany({
      where: {
        body: { contains: "prefers", mode: "insensitive" },
        workspaceId: actor.workspaceId,
        ...activeWhere
      },
      select: { body: true, id: true, organizationId: true, personId: true },
      orderBy: { updatedAt: "desc" },
      take: 20
    }),
    prisma.meetingIntake.findMany({
      where: { status: "READY_FOR_REVIEW", workspaceId: actor.workspaceId },
      select: { id: true, originalFilename: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 10
    })
  ]);

  return [
    ...duplicateContactSuggestions(people),
    ...duplicateOrganizationSuggestions(organizations),
    ...possibleContactOrgLinks(people, organizations),
    ...dealHealthSuggestions(deals, staleDate),
    ...unlinkedEmailSuggestions(emailLogs),
    ...relationshipMemoryPlacementSuggestions(notes),
    ...meetingIntelligenceReviewSuggestions(meetingIntakes)
  ].slice(0, limit);
}

function duplicateContactSuggestions(people: Array<{ email: string | null; firstName: string; id: string; lastName: string | null }>): AiHygieneSuggestion[] {
  const groups = groupBy(people.filter((person) => person.email), (person) => person.email!.toLowerCase());
  return Object.entries(groups).flatMap(([email, matches]) =>
    matches.length > 1
      ? [{
          detail: "Multiple active contacts share the same email. Review before merging or deleting anything.",
          evidence: matches.slice(0, 4).map((person) => formatPersonName(person) ?? person.email ?? "Unnamed contact"),
          id: `duplicate-contact-${email}`,
          recordHref: `/contacts/${matches[0].id}`,
          reviewFirst: true,
          severity: "warning" as const,
          title: "Possible duplicate contacts",
          type: "duplicate_contact" as const
        }]
      : []
  );
}

function duplicateOrganizationSuggestions(organizations: Array<{ domain: string | null; id: string; name: string }>): AiHygieneSuggestion[] {
  const groups = groupBy(organizations.filter((organization) => organization.domain), (organization) => organization.domain!.toLowerCase());
  return Object.entries(groups).flatMap(([domain, matches]) =>
    matches.length > 1
      ? [{
          detail: "Multiple active organizations share the same domain. Review account ownership and relationships before combining records.",
          evidence: matches.slice(0, 4).map((organization) => organization.name),
          id: `duplicate-organization-${domain}`,
          recordHref: `/organizations/${matches[0].id}`,
          reviewFirst: true,
          severity: "warning" as const,
          title: "Possible duplicate organizations",
          type: "duplicate_organization" as const
        }]
      : []
  );
}

function possibleContactOrgLinks(
  people: Array<{ email: string | null; firstName: string; id: string; lastName: string | null; organizationId: string | null }>,
  organizations: Array<{ domain: string | null; id: string; name: string }>
): AiHygieneSuggestion[] {
  const orgByDomain = new Map(organizations.flatMap((organization) => organization.domain ? [[organization.domain.toLowerCase(), organization]] : []));
  return people.flatMap((person): AiHygieneSuggestion[] => {
    const domain = person.email?.split("@")[1]?.toLowerCase();
    const organization = domain ? orgByDomain.get(domain) : null;
    if (!domain || !organization || person.organizationId) return [];
    return [{
      detail: "A contact email domain matches an organization domain, but the contact is not linked to that organization.",
      evidence: [formatPersonName(person) ?? person.email ?? "Unnamed contact", organization.name, domain],
      id: `possible-contact-org-link-${person.id}`,
      recordHref: `/contacts/${person.id}`,
      reviewFirst: true as const,
      severity: "info" as const,
      title: "Contact may belong to an organization",
      type: "possible_contact_org_link" as const
    }];
  }).slice(0, 5);
}

function dealHealthSuggestions(deals: Array<{ activities: Array<{ completedAt: Date | null }>; id: string; status: string; title: string; updatedAt: Date }>, staleDate: Date): AiHygieneSuggestion[] {
  return deals.flatMap((deal): AiHygieneSuggestion[] => {
    const openActivities = deal.activities.filter((activity) => !activity.completedAt);
    if (deal.status !== "OPEN" && openActivities.length > 0) {
      return [{
        detail: "A closed deal still has open activity. Review whether the follow-up should be completed or moved.",
        evidence: [`Open activities: ${openActivities.length}`, `Status: ${deal.status}`],
        id: `closed-deal-open-activity-${deal.id}`,
        recordHref: `/deals/${deal.id}#activities`,
        reviewFirst: true as const,
        severity: "attention" as const,
        title: "Closed deal has open activity",
        type: "closed_deal_open_activity" as const
      }];
    }
    if (deal.status === "OPEN" && openActivities.length === 0 && deal.updatedAt < staleDate) {
      return [{
        detail: "An open deal has no visible open follow-up and has not changed recently.",
        evidence: [`Last updated ${deal.updatedAt.toISOString().slice(0, 10)}`],
        id: `stale-deal-${deal.id}`,
        recordHref: `/deals/${deal.id}#add-activity`,
        reviewFirst: true as const,
        severity: "warning" as const,
        title: "Open deal may be stale",
        type: "stale_deal" as const
      }];
    }
    return [];
  }).slice(0, 6);
}

function unlinkedEmailSuggestions(emailLogs: Array<{ direction: string; id: string; occurredAt: Date; subject: string }>): AiHygieneSuggestion[] {
  return emailLogs.slice(0, 4).map((email) => ({
    detail: "A stored email is not linked to a contact, organization, lead, or deal. Review links before creating follow-ups from it.",
    evidence: [email.subject, email.direction, email.occurredAt.toISOString().slice(0, 10)],
    id: `unlinked-email-${email.id}`,
    reviewFirst: true,
    severity: "warning",
    title: "Stored email is unlinked",
    type: "unlinked_email"
  }));
}

function relationshipMemoryPlacementSuggestions(notes: Array<{ body: string; id: string; organizationId: string | null; personId: string | null }>): AiHygieneSuggestion[] {
  return notes
    .filter((note) => note.organizationId && !note.personId && /\b(prefers|family|spouse|birthday|personal|communication style)\b/i.test(note.body))
    .slice(0, 4)
    .map((note) => ({
      detail: "A note on an organization looks like contact-level Relationship Memory. Review placement before moving or copying it.",
      evidence: [note.body.slice(0, 180)],
      id: `relationship-memory-placement-${note.id}`,
      recordHref: `/organizations/${note.organizationId}`,
      reviewFirst: true,
      severity: "info",
      title: "Possible Relationship Memory placement issue",
      type: "relationship_memory_placement"
    }));
}

function meetingIntelligenceReviewSuggestions(intakes: Array<{ id: string; originalFilename: string | null; updatedAt: Date }>): AiHygieneSuggestion[] {
  return intakes.map((intake) => ({
    detail: "A Meeting Intelligence intake is ready for review. Apply only selected updates after checking targets.",
    evidence: [intake.originalFilename ?? `Intake ${intake.id.slice(0, 8)}`, intake.updatedAt.toISOString().slice(0, 10)],
    id: `meeting-intelligence-review-${intake.id}`,
    recordHref: `/meeting-intelligence/${intake.id}`,
    reviewFirst: true,
    severity: "attention",
    title: "Meeting Intelligence proposal waiting",
    type: "meeting_intelligence_review"
  }));
}

function groupBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = keyFor(item);
    groups[key] = [...(groups[key] ?? []), item];
    return groups;
  }, {});
}
