import { ActivityType, MeetingIntakeStatus, type Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api/responses";
import { startOfDay } from "@/lib/activity-due";
import { activityAttachmentRelationsWhere } from "@/lib/services/record-guards";
import { prisma } from "@/lib/db/prisma";
import type { MeetingIntelligenceDraft, RelationshipBriefChangeSummary } from "@/lib/meeting-intelligence/types";
import { formatPersonName } from "@/lib/person-name";
import { relationshipBriefFieldLabel } from "@/lib/relationship-brief-usage";
import { redactSensitiveText } from "@/lib/security/redaction";

import { userDisplaySelect } from "./user-select";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

export type MeetingPrepRecordType = "deal" | "organization" | "person";

export type MeetingPrepBrief = {
  activity: {
    completedAt: string | null;
    description: string | null;
    dueAt: string | null;
    href: string;
    id: string;
    ownerLabel: string;
    title: string;
  };
  attendees: MeetingPrepBriefItem[];
  attendeeConfidence: MeetingPrepAttendeeConfidence[];
  dealContext: MeetingPrepBriefItem[];
  generatedAt: string;
  linkedRecords: MeetingPrepBriefSourceRef[];
  meetingIntelligence: MeetingPrepBriefItem[];
  missingOrUncertain: MeetingPrepBriefItem[];
  openCommitments: MeetingPrepBriefItem[];
  organizationFacts: MeetingPrepBriefItem[];
  personFacts: MeetingPrepBriefItem[];
  quoteStatus: MeetingPrepBriefItem[];
  recentHistory: MeetingPrepBriefItem[];
  reviewFirst: true;
  suggestedTopics: MeetingPrepBriefItem[];
  title: string;
  workspaceScoped: true;
};

export type MeetingPrepBriefItem = {
  actions?: MeetingPrepManualAction[];
  label: string;
  source: MeetingPrepBriefSourceLabel;
  sourceRef?: MeetingPrepBriefSourceRef;
  value: string;
};

export type MeetingPrepBriefSourceLabel =
  | "Activity"
  | "CRM record"
  | "Deal record"
  | "Meeting Intelligence"
  | "Notes"
  | "Organization record"
  | "Person record"
  | "Quote record"
  | "Relationship Memory"
  | "Suggestion";

export type MeetingPrepBriefSourceRef = {
  detail?: string;
  excerpt?: string;
  href: string;
  label: string;
  occurredAt?: string;
  recordId: string;
  type: "activity" | "deal" | "meeting_intelligence" | "note" | "organization" | "person" | "quote";
};

export type MeetingPrepAttendeeState =
  | "matched_contact"
  | "multiple_contact_candidates"
  | "email_no_contact"
  | "name_only"
  | "unmatched"
  | "internal";

export type MeetingPrepAttendeeEvidence = {
  detail?: string;
  label: string;
  sourceRef?: MeetingPrepBriefSourceRef;
};

export type MeetingPrepAttendeeCandidate = {
  detail?: string;
  href: string;
  label: string;
  recordId: string;
  type: "person";
};

export type MeetingPrepManualAction = {
  href: string;
  label: string;
};

export type MeetingPrepAttendeeConfidence = {
  actions: MeetingPrepManualAction[];
  confirmedLinks: MeetingPrepAttendeeCandidate[];
  detail: string;
  evidence: MeetingPrepAttendeeEvidence[];
  id: string;
  internal: boolean;
  label: string;
  state: MeetingPrepAttendeeState;
  stateLabel: string;
  suggestedCandidates: MeetingPrepAttendeeCandidate[];
};

type BriefRecordRef = {
  id: string;
  type: MeetingPrepRecordType;
};

type BriefContext = {
  activity: MeetingActivityRecord;
  activeDeals: DealContextRecord[];
  attendeeConfidence?: MeetingPrepAttendeeConfidence[];
  contextIds: ContextIds;
  currentMeetingAssociations: CurrentMeetingAssociationRecord[];
  meetingSources: MeetingSourceRecord[];
  now: Date;
  openActivities: ActivityContextRecord[];
  people: PersonContextRecord[];
  organizations: OrganizationContextRecord[];
  quotes: QuoteContextRecord[];
  recentActivities: ActivityContextRecord[];
  recentNotes: NoteContextRecord[];
  workspaceMembers: WorkspaceMemberRecord[];
};

type ContextIds = {
  dealIds: string[];
  leadIds: string[];
  organizationIds: string[];
  personIds: string[];
};

const maxBriefTextLength = 220;
const maxSourceExcerptLength = 160;
const recentHistoryTake = 6;
const attendeeSearchLimit = 16;
const workspaceMemberUserSelect = {
  ...userDisplaySelect,
  deletedAt: true
} satisfies Prisma.UserSelect;

export async function buildMeetingPrepBrief(
  actor: WorkspaceActor,
  activityId: string,
  options: { now?: Date } = {}
): Promise<MeetingPrepBrief | null> {
  await ensureWorkspaceAccess(actor);
  const now = options.now ?? new Date();
  const activity = await prisma.activity.findFirst({
    where: {
      id: activityId,
      workspaceId: actor.workspaceId,
      ...activeWhere,
      ...activityAttachmentRelationsWhere(actor.workspaceId)
    },
    include: meetingActivityInclude
  });
  if (!activity) throw new ApiError("NOT_FOUND", "Activity was not found.", 404);
  if (!isMeetingPrepEligible(activity, now)) return null;
  return buildMeetingPrepBriefFromActivity(actor, activity, now);
}

export async function buildMeetingPrepBriefForRecord(
  actor: WorkspaceActor,
  record: BriefRecordRef,
  options: { now?: Date } = {}
): Promise<MeetingPrepBrief | null> {
  await ensureWorkspaceAccess(actor);
  const now = options.now ?? new Date();
  const activity = await prisma.activity.findFirst({
    where: {
      workspaceId: actor.workspaceId,
      type: ActivityType.MEETING,
      completedAt: null,
      ...activeWhere,
      ...activityAttachmentRelationsWhere(actor.workspaceId),
      ...recordActivityWhere(record),
      OR: [{ dueAt: { gte: startOfDay(now) } }, { dueAt: null }]
    },
    include: meetingActivityInclude,
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }]
  });

  if (!activity || !isMeetingPrepEligible(activity, now)) return null;
  return buildMeetingPrepBriefFromActivity(actor, activity, now);
}

async function buildMeetingPrepBriefFromActivity(actor: WorkspaceActor, activity: MeetingActivityRecord, now: Date) {
  const contextIds = await meetingContextIds(actor.workspaceId, activity);
  const [people, organizations, activeDeals, recentNotes, recentActivities, openActivities, meetingSources, currentMeetingAssociations, workspaceMembers] = await Promise.all([
    contextIds.personIds.length > 0
      ? prisma.person.findMany({
          where: { id: { in: contextIds.personIds }, workspaceId: actor.workspaceId, ...activeWhere },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }]
        })
      : [],
    contextIds.organizationIds.length > 0
      ? prisma.organization.findMany({
          where: { id: { in: contextIds.organizationIds }, workspaceId: actor.workspaceId, ...activeWhere },
          orderBy: { name: "asc" }
        })
      : [],
    prisma.deal.findMany({
      where: activeDealWhere(actor.workspaceId, contextIds),
      include: {
        organization: true,
        person: true,
        quotes: {
          orderBy: { updatedAt: "desc" },
          take: 3
        },
        stage: true
      },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.note.findMany({
      where: relatedNoteWhere(actor.workspaceId, contextIds),
      include: { author: { select: userDisplaySelect } },
      orderBy: { createdAt: "desc" },
      take: recentHistoryTake
    }),
    prisma.activity.findMany({
      where: {
        ...relatedActivityWhere(actor.workspaceId, contextIds),
        completedAt: { not: null },
        id: { not: activity.id }
      },
      include: { owner: { select: userDisplaySelect } },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: recentHistoryTake
    }),
    prisma.activity.findMany({
      where: {
        ...relatedActivityWhere(actor.workspaceId, contextIds),
        completedAt: null,
        id: { not: activity.id }
      },
      include: { owner: { select: userDisplaySelect } },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      take: recentHistoryTake
    }),
    prisma.meetingIntake.findMany({
      where: {
        workspaceId: actor.workspaceId,
        status: { in: [MeetingIntakeStatus.READY_FOR_REVIEW, MeetingIntakeStatus.APPLIED] },
        meetingActivityAssociations: {
          some: relatedMeetingAssociationWhere(actor.workspaceId, contextIds, activity.id)
        }
      },
      include: {
        meetingActivityAssociations: {
          where: { workspaceId: actor.workspaceId },
          include: { activity: { select: { completedAt: true, dueAt: true, id: true, title: true } } }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 5
    }),
    prisma.meetingActivityAssociation.findMany({
      where: { activityId: activity.id, workspaceId: actor.workspaceId },
      include: {
        deal: true,
        meetingIntake: { select: { id: true, status: true, updatedAt: true } },
        organization: true,
        person: true
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.user.findMany({
      where: {
        memberships: {
          some: { workspaceId: actor.workspaceId }
        }
      },
      select: workspaceMemberUserSelect,
      orderBy: { createdAt: "asc" }
    })
  ]);

  const fullContext: BriefContext = {
    activity,
    activeDeals,
    contextIds,
    currentMeetingAssociations,
    meetingSources,
    now,
    openActivities,
    people,
    organizations,
    quotes: activeDeals.flatMap((deal) => deal.quotes),
    recentActivities,
    recentNotes,
    workspaceMembers
  };
  const attendeeConfidence = await attendeeConfidenceItems(actor, fullContext);
  fullContext.attendeeConfidence = attendeeConfidence;

  return {
    activity: {
      completedAt: toIso(activity.completedAt),
      description: briefSafeText(activity.description),
      dueAt: toIso(activity.dueAt),
      href: activityHref(activity.id),
      id: activity.id,
      ownerLabel: userLabel(activity.owner),
      title: activity.title
    },
    attendees: attendeeItems(fullContext),
    attendeeConfidence,
    dealContext: dealContextItems(fullContext),
    generatedAt: now.toISOString(),
    linkedRecords: linkedRecordRefs(fullContext),
    meetingIntelligence: meetingIntelligenceItems(fullContext),
    missingOrUncertain: missingItems(fullContext),
    openCommitments: openCommitmentItems(fullContext),
    organizationFacts: organizationFactItems(fullContext),
    personFacts: personFactItems(fullContext),
    quoteStatus: quoteItems(fullContext),
    recentHistory: recentHistoryItems(fullContext),
    reviewFirst: true,
    suggestedTopics: suggestionItems(fullContext),
    title: `Meeting prep for ${activity.title}`,
    workspaceScoped: true
  } satisfies MeetingPrepBrief;
}

function isMeetingPrepEligible(activity: { completedAt: Date | null; dueAt: Date | null; type: ActivityType }, now: Date) {
  if (activity.type !== ActivityType.MEETING || activity.completedAt) return false;
  if (!activity.dueAt) return true;
  return activity.dueAt.getTime() >= startOfDay(now).getTime();
}

async function meetingContextIds(workspaceId: string, activity: MeetingActivityRecord): Promise<ContextIds> {
  const personIds = uniqueStrings([activity.personId, activity.deal?.personId, activity.lead?.personId]);
  const organizationIds = uniqueStrings([
    activity.organizationId,
    activity.deal?.organizationId,
    activity.lead?.organizationId,
    activity.person?.organizationId,
    activity.deal?.person?.organizationId,
    activity.lead?.person?.organizationId
  ]);
  const dealIds = uniqueStrings([activity.dealId]);
  const leadIds = uniqueStrings([activity.leadId]);
  const associations = await prisma.meetingActivityAssociation.findMany({
    where: { activityId: activity.id, workspaceId },
    select: { dealId: true, leadId: true, organizationId: true, personId: true }
  });
  personIds.push(...uniqueStrings(associations.map((association) => association.personId)));
  organizationIds.push(...uniqueStrings(associations.map((association) => association.organizationId)));
  dealIds.push(...uniqueStrings(associations.map((association) => association.dealId)));
  leadIds.push(...uniqueStrings(associations.map((association) => association.leadId)));

  if (personIds.length > 0) {
    const people = await prisma.person.findMany({
      where: { id: { in: personIds }, workspaceId, ...activeWhere },
      select: { organizationId: true }
    });
    organizationIds.push(...uniqueStrings(people.map((person) => person.organizationId)));
  }

  return {
    dealIds: uniqueStrings(dealIds),
    leadIds: uniqueStrings(leadIds),
    organizationIds: uniqueStrings(organizationIds),
    personIds: uniqueStrings(personIds)
  };
}

function attendeeItems(context: BriefContext): MeetingPrepBriefItem[] {
  return context.people.map((person) => ({
    label: "Matched attendee",
    source: "Person record",
    sourceRef: personRef(person),
    value: formatPersonName(person) ?? person.email ?? "Unnamed contact"
  }));
}

async function attendeeConfidenceItems(actor: WorkspaceActor, context: BriefContext): Promise<MeetingPrepAttendeeConfidence[]> {
  const mentions = attendeeMentions(context.activity);
  const candidatePeople = await attendeeCandidatePeople(actor.workspaceId, mentions);
  const candidatePeopleByEmail = peopleByEmail(candidatePeople);
  const candidatePeopleByName = peopleByName(candidatePeople);
  const itemsByPersonId = new Map<string, MeetingPrepAttendeeConfidence>();
  const looseItems: MeetingPrepAttendeeConfidence[] = [];

  const addConfirmedPerson = (person: PersonContextRecord | PersonCandidateRecord, evidence: MeetingPrepAttendeeEvidence) => {
    if (!isActiveRecord(person)) return;
    const existing = itemsByPersonId.get(person.id);
    if (existing) {
      existing.evidence.push(evidence);
      return existing;
    }
    const candidate = attendeeCandidate(person);
    const item: MeetingPrepAttendeeConfidence = {
      actions: [
        { href: candidate.href, label: "Open matched contact" },
        { href: contactsSearchHref(candidate.label), label: "Search contacts" },
        { href: activityHref(context.activity.id), label: "Open activity" }
      ],
      confirmedLinks: [candidate],
      detail: person.email ? person.email : "Linked CRM contact",
      evidence: [evidence],
      id: `person:${person.id}`,
      internal: false,
      label: candidate.label,
      state: "matched_contact",
      stateLabel: "Matched to one CRM contact",
      suggestedCandidates: []
    };
    itemsByPersonId.set(person.id, item);
    return item;
  };

  if (context.activity.person) {
    addConfirmedPerson(context.activity.person, { label: "Linked activity person", sourceRef: personRef(context.activity.person) });
  }
  if (context.activity.deal?.person) {
    addConfirmedPerson(context.activity.deal.person, { label: "Linked deal contact", sourceRef: personRef(context.activity.deal.person) });
  }
  if (context.activity.lead?.person) {
    addConfirmedPerson(context.activity.lead.person, { label: "Linked lead contact", sourceRef: personRef(context.activity.lead.person) });
  }
  for (const association of context.currentMeetingAssociations) {
    if (!association.person || !isActiveRecord(association.person)) continue;
    addConfirmedPerson(association.person, {
      label: association.meetingIntakeId ? "Existing Meeting Intelligence association" : "Existing meeting association",
      sourceRef: association.meetingIntake ? meetingAssociationIntakeRef(association) : personRef(association.person)
    });
  }

  for (const email of mentions.emails) {
    const internalMember = workspaceMemberForEmail(context.workspaceMembers, email);
    if (internalMember) {
      looseItems.push(internalAttendeeItem(email, internalMember, context.activity.id));
      continue;
    }
    const candidates = candidatePeopleByEmail.get(normalizeEmail(email)) ?? [];
    if (candidates.length === 1) {
      const item = addConfirmedPerson(candidates[0], { detail: email, label: "Exact email match", sourceRef: personRef(candidates[0]) });
      if (item) item.detail = candidates[0].email ?? email;
    } else if (candidates.length > 1) {
      looseItems.push(candidateAmbiguityItem({
        activityId: context.activity.id,
        candidates,
        detail: email,
        evidenceLabel: "Exact email matched multiple contacts",
        id: `email:${normalizeEmail(email)}`,
        label: email
      }));
    } else {
      looseItems.push({
        actions: [
          { href: contactsSearchHref(email), label: "Search contacts" },
          { href: activityHref(context.activity.id), label: "Open activity" }
        ],
        confirmedLinks: [],
        detail: "Email appears in meeting context, but no workspace contact has this exact email.",
        evidence: [{ detail: email, label: "Email in meeting details" }],
        id: `email:${normalizeEmail(email)}`,
        internal: false,
        label: email,
        state: "email_no_contact",
        stateLabel: "Email known, no CRM contact match",
        suggestedCandidates: []
      });
    }
  }

  for (const name of mentions.names) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) continue;
    const alreadyConfirmed = Array.from(itemsByPersonId.values()).find((item) => normalizeName(item.label) === normalizedName);
    if (alreadyConfirmed) {
      alreadyConfirmed.evidence.push({ detail: name, label: "Name appears in meeting details" });
      continue;
    }
    const candidates = candidatePeopleByName.get(normalizedName) ?? [];
    if (candidates.length > 1) {
      looseItems.push(candidateAmbiguityItem({
        activityId: context.activity.id,
        candidates,
        detail: name,
        evidenceLabel: "Name-only candidate",
        id: `name:${normalizedName}`,
        label: name
      }));
    } else if (candidates.length === 1) {
      const candidate = attendeeCandidate(candidates[0]);
      looseItems.push({
        actions: [
          { href: candidate.href, label: "Open candidate contact" },
          { href: contactsSearchHref(name), label: "Search contacts" },
          { href: activityHref(context.activity.id), label: "Open activity" }
        ],
        confirmedLinks: [],
        detail: "One contact has this name, but name-only evidence is not treated as a confirmed attendee link.",
        evidence: [{ detail: name, label: "Name-only candidate" }],
        id: `name:${normalizedName}`,
        internal: false,
        label: name,
        state: "name_only",
        stateLabel: "Attendee name only",
        suggestedCandidates: [candidate]
      });
    } else {
      looseItems.push({
        actions: [
          { href: contactsSearchHref(name), label: "Search contacts" },
          { href: activityHref(context.activity.id), label: "Open activity" }
        ],
        confirmedLinks: [],
        detail: "Name appears in meeting context without an exact CRM contact match.",
        evidence: [{ detail: name, label: "Attendee name only" }],
        id: `name:${normalizedName}`,
        internal: false,
        label: name,
        state: "name_only",
        stateLabel: "Attendee name only",
        suggestedCandidates: []
      });
    }
  }

  const items = [...itemsByPersonId.values(), ...dedupeLooseAttendeeItems(looseItems)];
  if (items.length === 0) {
    items.push({
      actions: [
        { href: contactsSearchHref(context.activity.title), label: "Search contacts" },
        { href: activityHref(context.activity.id), label: "Open activity" }
      ],
      confirmedLinks: [],
      detail: "No linked contact, attendee email, attendee name, or reviewed Meeting Intelligence association is available.",
      evidence: [{ label: "No attendee metadata found" }],
      id: `unmatched:${context.activity.id}`,
      internal: false,
      label: "Attendee details unavailable",
      state: "unmatched",
      stateLabel: "Unmatched or ambiguous",
      suggestedCandidates: []
    });
  }
  return items.slice(0, 12);
}

type AttendeeMentions = {
  emails: string[];
  names: string[];
};

function attendeeMentions(activity: MeetingActivityRecord): AttendeeMentions {
  const text = [activity.title, activity.description].filter(Boolean).join("\n");
  const emails = uniqueStrings(
    Array.from(text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map((match) => normalizeEmail(match[0]))
  );
  const names = uniqueStrings(
    attendeeNameLines(text)
      .flatMap((line) => line.split(/[,;]|\band\b/gi))
      .map((part) => part.replace(/<[^>]+>/g, " ").replace(/[()[\]]/g, " ").replace(/\s+/g, " ").trim())
      .filter((part) => Boolean(part) && !looksLikeEmailText(part) && /\p{L}/u.test(part))
  ).slice(0, attendeeSearchLimit);
  return { emails: emails.slice(0, attendeeSearchLimit), names };
}

function attendeeNameLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      const match = /^(?:attendees?|participants?|with)\s*:\s*(.+)$/i.exec(line);
      return match?.[1] ? [match[1]] : [];
    });
}

async function attendeeCandidatePeople(workspaceId: string, mentions: AttendeeMentions): Promise<PersonCandidateRecord[]> {
  const emailFilters = mentions.emails.map((email) => ({ email: { equals: email, mode: "insensitive" as const } }));
  const nameFilters = mentions.names.flatMap(nameCandidateFilters);
  const filters: Prisma.PersonWhereInput[] = [...emailFilters, ...nameFilters];
  if (filters.length === 0) return [];
  const people = await prisma.person.findMany({
    where: {
      workspaceId,
      ...activeWhere,
      OR: filters
    },
    include: { organization: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: attendeeSearchLimit * 2
  });
  const mentionNames = new Set(mentions.names.map(normalizeName).filter(Boolean));
  const mentionEmails = new Set(mentions.emails.map(normalizeEmail));
  return people.filter((person) => {
    const email = person.email ? normalizeEmail(person.email) : "";
    const name = normalizeName(formatPersonName(person));
    return (email && mentionEmails.has(email)) || (name && mentionNames.has(name));
  });
}

function nameCandidateFilters(name: string): Prisma.PersonWhereInput[] {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    return [{
      AND: [
        { firstName: { equals: firstName, mode: "insensitive" as const } },
        { lastName: { equals: lastName, mode: "insensitive" as const } }
      ]
    }];
  }
  if (parts.length === 1) {
    return [
      { firstName: { equals: parts[0], mode: "insensitive" as const } },
      { lastName: { equals: parts[0], mode: "insensitive" as const } }
    ];
  }
  return [];
}

function peopleByEmail(people: PersonCandidateRecord[]) {
  const byEmail = new Map<string, PersonCandidateRecord[]>();
  for (const person of people) {
    if (!person.email) continue;
    const key = normalizeEmail(person.email);
    byEmail.set(key, [...(byEmail.get(key) ?? []), person]);
  }
  return byEmail;
}

function peopleByName(people: PersonCandidateRecord[]) {
  const byName = new Map<string, PersonCandidateRecord[]>();
  for (const person of people) {
    const key = normalizeName(formatPersonName(person));
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), person]);
  }
  return byName;
}

function candidateAmbiguityItem({
  activityId,
  candidates,
  detail,
  evidenceLabel,
  id,
  label
}: {
  activityId: string;
  candidates: PersonCandidateRecord[];
  detail: string;
  evidenceLabel: string;
  id: string;
  label: string;
}): MeetingPrepAttendeeConfidence {
  return {
    actions: [
      { href: contactsSearchHref(detail), label: "Search contacts" },
      { href: activityHref(activityId), label: "Open activity" }
    ],
    confirmedLinks: [],
    detail: "Multiple contacts could match this attendee. Review the candidates before linking anything manually.",
    evidence: [{ detail, label: evidenceLabel }],
    id,
    internal: false,
    label,
    state: "multiple_contact_candidates",
    stateLabel: "Matched to multiple possible contacts",
    suggestedCandidates: candidates.map(attendeeCandidate)
  };
}

function internalAttendeeItem(email: string, member: WorkspaceMemberRecord, activityId: string): MeetingPrepAttendeeConfidence {
  const label = member.name ?? member.email;
  return {
    actions: [{ href: activityHref(activityId), label: "Open activity" }],
    confirmedLinks: [],
    detail: member.email,
    evidence: [{ detail: email, label: "Workspace member email" }],
    id: `internal:${member.id}`,
    internal: true,
    label,
    state: "internal",
    stateLabel: "Internal attendee",
    suggestedCandidates: []
  };
}

function attendeeCandidate(person: PersonContextRecord | PersonCandidateRecord): MeetingPrepAttendeeCandidate {
  return {
    detail: person.email ?? undefined,
    href: `/contacts/${person.id}`,
    label: formatPersonName(person) ?? person.email ?? "Unnamed contact",
    recordId: person.id,
    type: "person"
  };
}

function dedupeLooseAttendeeItems(items: MeetingPrepAttendeeConfidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function workspaceMemberForEmail(members: WorkspaceMemberRecord[], email: string) {
  const normalized = normalizeEmail(email);
  return members.find((member) => !member.deletedAt && normalizeEmail(member.email) === normalized);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function looksLikeEmailText(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function personFactItems(context: BriefContext): MeetingPrepBriefItem[] {
  return context.people.flatMap((person) => {
    const name = formatPersonName(person) ?? person.email ?? "Unnamed contact";
    return relationshipFacts(person).map((fact) => ({
      label: `${name}: ${fact.label}`,
      source: "Relationship Memory" as const,
      sourceRef: personRef(person, "Relationship Memory"),
      value: fact.value
    }));
  }).slice(0, 6);
}

function organizationFactItems(context: BriefContext): MeetingPrepBriefItem[] {
  return context.organizations.flatMap((organization) => [
    {
      label: "Organization",
      source: "Organization record" as const,
      sourceRef: organizationRef(organization),
      value: organization.name
    },
    ...(organization.domain
      ? [{
          label: "Domain",
          source: "Organization record" as const,
          sourceRef: organizationRef(organization),
          value: organization.domain
        }]
      : [])
  ]).slice(0, 6);
}

function dealContextItems(context: BriefContext): MeetingPrepBriefItem[] {
  return context.activeDeals.map((deal) => ({
    label: deal.id === context.activity.dealId ? "Linked active deal" : "Related active deal",
    source: "Deal record",
    sourceRef: dealRef(deal),
    value: `${deal.title} - ${deal.stage.name}${deal.valueCents ? ` - ${formatCurrency(deal.valueCents, deal.currency)}` : ""}`
  }));
}

function recentHistoryItems(context: BriefContext): MeetingPrepBriefItem[] {
  const notes = context.recentNotes.map((note) => ({
    label: "Recent note",
    source: "Notes" as const,
    sourceRef: noteRef(note),
    value: briefSafeText(note.body) ?? "Stored note"
  }));
  const activities = context.recentActivities.map((activity) => ({
    label: "Completed activity",
    source: "Activity" as const,
    sourceRef: activityRef(activity),
    value: `${activity.title}${activity.completedAt ? ` - completed ${activity.completedAt.toISOString().slice(0, 10)}` : ""}`
  }));
  return [...notes, ...activities].slice(0, 6);
}

function openCommitmentItems(context: BriefContext): MeetingPrepBriefItem[] {
  return context.openActivities.map((activity) => {
    const due = activity.dueAt ? activity.dueAt.toISOString().slice(0, 10) : "No due date";
    const overdue = activity.dueAt && activity.dueAt.getTime() < startOfDay(context.now).getTime();
    return {
      label: overdue ? "Overdue follow-up" : "Open follow-up",
      source: "Activity" as const,
      sourceRef: activityRef(activity),
      value: `${activity.title} - ${due}`
    };
  }).slice(0, 6);
}

function quoteItems(context: BriefContext): MeetingPrepBriefItem[] {
  const activeDealIds = new Set(context.activeDeals.map((deal) => deal.id));
  return context.quotes
    .filter((quote) => activeDealIds.has(quote.dealId) || context.contextIds.dealIds.includes(quote.dealId))
    .map((quote) => ({
      label: `${quote.status.toLowerCase()} quote`,
      source: "Quote record" as const,
      sourceRef: quoteRef(quote),
      value: `${quote.number} - ${formatCurrency(quote.totalCents, quote.currency)}`
    }))
    .slice(0, 4);
}

function meetingIntelligenceItems(context: BriefContext): MeetingPrepBriefItem[] {
  return context.meetingSources.flatMap((intake) => {
    const draft = parseMeetingDraft(intake.proposedChangesJson);
    const changes = parseRelationshipBriefChanges(intake.applyResultJson);
    const title = meetingSourceTitle(intake);
    const sourceRef = meetingIntakeRef(intake);
    const summary = briefSafeText(draft?.summary);
    const relationshipFact = draft?.relationshipBriefUpdates
      ?.flatMap((update) => update.facts ?? [])
      .find((fact) => fact.include && fact.text);
    const appliedFact = changes[0]?.acceptedFacts?.[0];

    return [
      ...(summary ? [{ label: title, source: "Meeting Intelligence" as const, sourceRef, value: summary }] : []),
      ...(relationshipFact
        ? [{ label: "Reviewed relationship finding", source: "Meeting Intelligence" as const, sourceRef, value: relationshipFact.text }]
        : []),
      ...(appliedFact ? [{ label: "Applied Relationship Brief fact", source: "Meeting Intelligence" as const, sourceRef, value: appliedFact }] : [])
    ];
  }).slice(0, 6);
}

function missingItems(context: BriefContext): MeetingPrepBriefItem[] {
  const missing: MeetingPrepBriefItem[] = [];
  const attendeeQuery = attendeeSearchQuery(context);
  if (!context.activity.dueAt) {
    missing.push(suggestion("Meeting time missing", "This meeting activity does not have a scheduled date/time.", [
      { href: activityHref(context.activity.id), label: "Open activity" }
    ]));
  }
  if (context.people.length === 0) {
    missing.push(suggestion("Linked contact missing", "No confirmed contact is linked to this meeting; review attendee candidates before using person-specific facts.", [
      { href: contactsSearchHref(attendeeQuery), label: "Search contacts" },
      { href: activityHref(context.activity.id), label: "Open activity" }
    ]));
  }
  if (context.organizations.length === 0) {
    missing.push(suggestion("Linked organization missing", "No organization is linked through the meeting, contact, lead, deal, or reviewed association.", [
      { href: organizationsSearchHref(organizationSearchQuery(context)), label: "Search organizations" },
      { href: activityHref(context.activity.id), label: "Open activity" }
    ]));
  }
  if (context.activeDeals.length === 0) {
    missing.push(suggestion("Linked deal context missing", "No open deal is linked to this meeting context.", [
      { href: dealsSearchHref(dealSearchQuery(context)), label: "Search deals" },
      { href: activityHref(context.activity.id), label: "Open activity" }
    ]));
  }
  if ((context.attendeeConfidence ?? []).every((attendee) => attendee.internal || attendee.state !== "matched_contact")) {
    missing.push(suggestion("Attendee confidence incomplete", "Customer or prospect attendees are not confirmed from CRM links or exact email matches.", [
      { href: contactsSearchHref(attendeeQuery), label: "Search contacts" },
      { href: activityHref(context.activity.id), label: "Open activity" }
    ]));
  }
  if (context.recentNotes.length === 0 && context.recentActivities.length === 0) {
    missing.push(suggestion("Recent history missing", "No recent notes or completed activities were found for the linked CRM records."));
  }
  if (context.meetingSources.length === 0) missing.push(suggestion("Prior Meeting Intelligence missing", "No prior reviewed Meeting Intelligence source is linked to these CRM records."));
  return missing;
}

function suggestionItems(context: BriefContext): MeetingPrepBriefItem[] {
  const suggestions: MeetingPrepBriefItem[] = [];
  if (context.openActivities.length > 0) {
    suggestions.push(suggestion("Start with open commitments", "Confirm status of overdue or open follow-ups before introducing new asks."));
  }
  const sentQuote = context.quotes.find((quote) => quote.status === "SENT");
  if (sentQuote) {
    suggestions.push({
      label: "Discuss active quote",
      source: "Suggestion",
      sourceRef: quoteRef(sentQuote),
      value: `Ask whether quote ${sentQuote.number} needs changes, approval steps, or timing help.`
    });
  }
  const primaryDeal = context.activeDeals[0];
  if (primaryDeal) {
    suggestions.push({
      label: "Confirm deal movement",
      source: "Suggestion",
      sourceRef: dealRef(primaryDeal),
      value: `Validate next steps for ${primaryDeal.title} in ${primaryDeal.stage.name}.`
    });
  }
  if (context.people.length === 0) {
    suggestions.push(suggestion("Confirm attendees", "Ask who should be included before relying on relationship-specific personalization."));
  }
  if (suggestions.length === 0) {
    suggestions.push(suggestion("Use discovery mode", "Open by confirming goals, decision process, blockers, and next follow-up owner."));
  }
  return suggestions.slice(0, 5);
}

function linkedRecordRefs(context: BriefContext): MeetingPrepBriefSourceRef[] {
  return [
    ...context.people.map((person) => personRef(person)),
    ...context.organizations.map((organization) => organizationRef(organization)),
    ...context.activeDeals.map((deal) => dealRef(deal))
  ].slice(0, 8);
}

function relationshipFacts(person: PersonContextRecord) {
  return [
    { label: relationshipBriefFieldLabel("relationshipPersonalContext"), value: briefSafeText(person.relationshipPersonalContext) },
    { label: relationshipBriefFieldLabel("relationshipCommunicationStyle"), value: briefSafeText(person.relationshipCommunicationStyle) },
    { label: relationshipBriefFieldLabel("relationshipBusinessConcerns"), value: briefSafeText(person.relationshipBusinessConcerns) },
    { label: relationshipBriefFieldLabel("relationshipFollowUpReminders"), value: briefSafeText(person.relationshipFollowUpReminders) },
    { label: relationshipBriefFieldLabel("relationshipInternalGuidance"), value: briefSafeText(person.relationshipInternalGuidance) }
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));
}

function recordActivityWhere(record: BriefRecordRef): Prisma.ActivityWhereInput {
  if (record.type === "deal") return { dealId: record.id };
  if (record.type === "organization") return { organizationId: record.id };
  return { personId: record.id };
}

function activeDealWhere(workspaceId: string, contextIds: ContextIds): Prisma.DealWhereInput {
  const related: Prisma.DealWhereInput[] = [];
  if (contextIds.dealIds.length > 0) related.push({ id: { in: contextIds.dealIds } });
  if (contextIds.personIds.length > 0) related.push({ personId: { in: contextIds.personIds } });
  if (contextIds.organizationIds.length > 0) related.push({ organizationId: { in: contextIds.organizationIds } });
  return {
    workspaceId,
    status: "OPEN",
    ...activeWhere,
    OR: related.length > 0 ? related : [{ id: "__none__" }]
  };
}

function relatedNoteWhere(workspaceId: string, contextIds: ContextIds): Prisma.NoteWhereInput {
  return {
    workspaceId,
    ...activeWhere,
    OR: relatedWhere<Prisma.NoteWhereInput>(contextIds)
  };
}

function relatedActivityWhere(workspaceId: string, contextIds: ContextIds): Prisma.ActivityWhereInput {
  return {
    workspaceId,
    ...activeWhere,
    ...activityAttachmentRelationsWhere(workspaceId),
    OR: relatedWhere<Prisma.ActivityWhereInput>(contextIds)
  };
}

function relatedMeetingAssociationWhere(
  workspaceId: string,
  contextIds: ContextIds,
  currentActivityId: string
): Prisma.MeetingActivityAssociationWhereInput {
  return {
    workspaceId,
    activityId: { not: currentActivityId },
    OR: relatedWhere<Prisma.MeetingActivityAssociationWhereInput>(contextIds)
  };
}

function relatedWhere<T>(contextIds: ContextIds): T[] {
  const filters: Array<Record<string, unknown>> = [];
  if (contextIds.dealIds.length > 0) filters.push({ dealId: { in: contextIds.dealIds } });
  if (contextIds.leadIds.length > 0) filters.push({ leadId: { in: contextIds.leadIds } });
  if (contextIds.personIds.length > 0) filters.push({ personId: { in: contextIds.personIds } });
  if (contextIds.organizationIds.length > 0) filters.push({ organizationId: { in: contextIds.organizationIds } });
  return (filters.length > 0 ? filters : [{ id: "__none__" }]) as T[];
}

function parseMeetingDraft(value: unknown): MeetingIntelligenceDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<MeetingIntelligenceDraft>;
  if (typeof draft.summary !== "string") return null;
  return draft as MeetingIntelligenceDraft;
}

function parseRelationshipBriefChanges(value: unknown): RelationshipBriefChangeSummary[] {
  if (!value || typeof value !== "object") return [];
  const result = value as { relationshipBriefChanges?: unknown };
  return Array.isArray(result.relationshipBriefChanges)
    ? result.relationshipBriefChanges.filter((change): change is RelationshipBriefChangeSummary => {
        const input = change as Partial<RelationshipBriefChangeSummary>;
        return Boolean(input && typeof input.fieldLabel === "string" && Array.isArray(input.acceptedFacts));
      })
    : [];
}

function meetingSourceTitle(intake: MeetingSourceRecord) {
  const associationTitle = intake.meetingActivityAssociations[0]?.activity?.title;
  return associationTitle ? `Prior meeting: ${associationTitle}` : `Meeting Intelligence ${intake.id.slice(0, 8)}`;
}

function briefSafeText(value: string | null | undefined, maxLength = maxBriefTextLength) {
  const text = redactSensitiveText(value ?? "")
    .replace(/^#+\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?:\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}...` : text;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function suggestion(label: string, value: string, actions?: MeetingPrepManualAction[]): MeetingPrepBriefItem {
  return { actions, label, source: "Suggestion", value };
}

function activityHref(id: string) {
  return `/activities/${id}/edit`;
}

function contactsSearchHref(query: string) {
  return searchHref("/contacts", query);
}

function organizationsSearchHref(query: string) {
  return searchHref("/organizations", query);
}

function dealsSearchHref(query: string) {
  return searchHref("/deals", query);
}

function searchHref(path: "/contacts" | "/organizations" | "/deals", query: string) {
  const params = new URLSearchParams();
  const safeQuery = safeSearchQuery(query);
  if (safeQuery) params.set("q", safeQuery);
  const serialized = params.toString();
  return serialized ? `${path}?${serialized}` : path;
}

function safeSearchQuery(query: string) {
  const value = query.replace(/\s+/g, " ").trim();
  return value.length > 80 ? value.slice(0, 80).trimEnd() : value;
}

function attendeeSearchQuery(context: BriefContext) {
  const mentions = attendeeMentions(context.activity);
  return mentions.emails[0] ?? mentions.names[0] ?? context.people[0]?.email ?? formatPersonName(context.people[0]) ?? context.activity.title;
}

function organizationSearchQuery(context: BriefContext) {
  const mentions = attendeeMentions(context.activity);
  const firstExternalDomain = mentions.emails.map((email) => email.split("@")[1]).find(Boolean);
  return context.organizations[0]?.name ?? firstExternalDomain ?? context.activity.title;
}

function dealSearchQuery(context: BriefContext) {
  return context.activeDeals[0]?.title ?? context.organizations[0]?.name ?? context.activity.title;
}

function isActiveRecord(record: { deletedAt?: Date | string | null }) {
  return !record.deletedAt;
}

function activityRef(activity: Pick<ActivityContextRecord, "completedAt" | "dueAt" | "id" | "title">): MeetingPrepBriefSourceRef {
  return {
    href: activityHref(activity.id),
    label: activity.title,
    occurredAt: toIso(activity.completedAt ?? activity.dueAt) ?? undefined,
    recordId: activity.id,
    type: "activity"
  };
}

function personRef(person: PersonContextRecord, detail?: string): MeetingPrepBriefSourceRef {
  return {
    detail,
    href: `/contacts/${person.id}`,
    label: formatPersonName(person) ?? person.email ?? "Unnamed contact",
    recordId: person.id,
    type: "person"
  };
}

function organizationRef(organization: OrganizationContextRecord): MeetingPrepBriefSourceRef {
  return {
    href: `/organizations/${organization.id}`,
    label: organization.name,
    recordId: organization.id,
    type: "organization"
  };
}

function dealRef(deal: DealContextRecord): MeetingPrepBriefSourceRef {
  return {
    href: `/deals/${deal.id}`,
    label: deal.title,
    recordId: deal.id,
    type: "deal"
  };
}

function noteRef(note: NoteContextRecord): MeetingPrepBriefSourceRef {
  const author = userLabel(note.author);
  return {
    excerpt: briefSafeText(note.body, maxSourceExcerptLength) ?? undefined,
    href: `#note-${note.id}`,
    label: author === "Unassigned" ? "Record note" : `Record note by ${author}`,
    occurredAt: note.createdAt.toISOString(),
    recordId: note.id,
    type: "note"
  };
}

function quoteRef(quote: QuoteContextRecord): MeetingPrepBriefSourceRef {
  return {
    href: `/deals/${quote.dealId}/quotes/${quote.id}`,
    label: `Quote ${quote.number}`,
    occurredAt: quote.updatedAt.toISOString(),
    recordId: quote.id,
    type: "quote"
  };
}

function meetingIntakeRef(intake: MeetingSourceRecord): MeetingPrepBriefSourceRef {
  const activity = intake.meetingActivityAssociations[0]?.activity;
  return {
    detail: `Status: ${intake.status}`,
    href: `/meeting-intelligence/${intake.id}`,
    label: meetingSourceTitle(intake),
    occurredAt: toIso(activity?.completedAt ?? activity?.dueAt ?? intake.updatedAt) ?? undefined,
    recordId: intake.id,
    type: "meeting_intelligence"
  };
}

function meetingAssociationIntakeRef(association: CurrentMeetingAssociationRecord): MeetingPrepBriefSourceRef {
  const intake = association.meetingIntake;
  return {
    detail: intake ? `Status: ${intake.status}` : undefined,
    href: intake ? `/meeting-intelligence/${intake.id}` : activityHref(association.activityId),
    label: intake ? `Meeting Intelligence ${intake.id.slice(0, 8)}` : "Meeting association",
    occurredAt: toIso(intake?.updatedAt) ?? undefined,
    recordId: intake?.id ?? association.activityId,
    type: intake ? "meeting_intelligence" : "activity"
  };
}

function userLabel(user: { email: string; name: string | null } | null | undefined) {
  return user?.name ?? user?.email ?? "Unassigned";
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatCurrency(valueCents: number | null, currency: string) {
  if (valueCents === null) return "No value";
  return new Intl.NumberFormat("en-US", { currency, style: "currency" }).format(valueCents / 100);
}

const meetingActivityInclude = {
  deal: { include: { organization: true, person: true } },
  lead: { include: { organization: true, person: true } },
  organization: true,
  owner: { select: userDisplaySelect },
  person: { include: { organization: true } }
} satisfies Prisma.ActivityInclude;

type MeetingActivityRecord = Prisma.ActivityGetPayload<{ include: typeof meetingActivityInclude }>;
type PersonContextRecord = Prisma.PersonGetPayload<{}>;
type PersonCandidateRecord = Prisma.PersonGetPayload<{ include: { organization: true } }>;
type OrganizationContextRecord = Prisma.OrganizationGetPayload<{}>;
type DealContextRecord = Prisma.DealGetPayload<{ include: { organization: true; person: true; quotes: true; stage: true } }>;
type NoteContextRecord = Prisma.NoteGetPayload<{ include: { author: { select: typeof userDisplaySelect } } }>;
type ActivityContextRecord = Prisma.ActivityGetPayload<{ include: { owner: { select: typeof userDisplaySelect } } }>;
type QuoteContextRecord = Prisma.QuoteGetPayload<{}>;
type CurrentMeetingAssociationRecord = Prisma.MeetingActivityAssociationGetPayload<{
  include: {
    deal: true;
    meetingIntake: { select: { id: true; status: true; updatedAt: true } };
    organization: true;
    person: true;
  };
}>;
type MeetingSourceRecord = Prisma.MeetingIntakeGetPayload<{
  include: {
    meetingActivityAssociations: {
      include: { activity: { select: { completedAt: true; dueAt: true; id: true; title: true } } };
      where: { workspaceId: string };
    };
  };
}>;
type WorkspaceMemberRecord = Prisma.UserGetPayload<{ select: typeof workspaceMemberUserSelect }>;
