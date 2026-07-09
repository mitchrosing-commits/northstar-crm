import type { Prisma } from "@prisma/client";

import { draftAiPreferenceChangesFromText, getAiPreferences } from "@/lib/services/ai-preferences-service";
import { prisma } from "@/lib/db/prisma";
import { formatPersonName } from "@/lib/person-name";
import { redactSensitiveText } from "@/lib/security/redaction";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "@/lib/services/workspace-access";

export type AssistantDraftActionKind =
  | "activity"
  | "ai_preference_update"
  | "contact_relationship_update"
  | "note"
  | "organization_contact_creation";

export type AssistantDraftActionConfidence = "high" | "low" | "medium" | "needs_clarification";

export type AssistantDraftActionField = {
  currentValue?: string | null;
  label: string;
  value: string;
};

export type AssistantDraftActionCandidate = {
  detail?: string;
  href: string;
  id: string;
  label: string;
  type: "deal" | "lead" | "organization" | "person";
};

export type AssistantDraftAction = {
  applyState: "disabled";
  candidates: AssistantDraftActionCandidate[];
  confidence: AssistantDraftActionConfidence;
  evidence: string[];
  fields: AssistantDraftActionField[];
  id: string;
  kind: AssistantDraftActionKind;
  missingInfo: string[];
  reviewLabel: "Draft only";
  targetHref?: string;
  targetKind: "AI preferences" | "Activity" | "Contact" | "Contact + organization" | "New record" | "Note";
  targetLabel: string;
  title: string;
  warnings: string[];
};

export type AssistantDraftCommandKind =
  | "draft_activity"
  | "draft_ai_preferences"
  | "draft_contact_relationship"
  | "draft_note"
  | "draft_record_creation";

export async function buildAssistantDraftActions(
  actor: WorkspaceActor,
  input: { kind: AssistantDraftCommandKind; query: string },
  now = new Date()
): Promise<AssistantDraftAction[]> {
  await ensureWorkspaceAccess(actor);
  if (input.kind === "draft_activity") return [await draftActivityAction(actor, input.query, now)];
  if (input.kind === "draft_note") return [await draftNoteAction(actor, input.query)];
  if (input.kind === "draft_contact_relationship") return [await draftContactRelationshipAction(actor, input.query)];
  if (input.kind === "draft_record_creation") return [await draftOrganizationContactCreationAction(actor, input.query)];
  return [await draftAiPreferenceAction(actor, input.query)];
}

async function draftActivityAction(actor: WorkspaceActor, query: string, now: Date): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const dueAt = parseDueDate(cleaned, now);
  const relatedTarget = extractActivityRelatedTarget(cleaned);
  const relationMatch = relatedTarget ? await matchAnyRecord(actor, relatedTarget) : emptyMatch();
  const title = activityTitle(cleaned, relatedTarget);
  const fields: AssistantDraftActionField[] = [
    { label: "Title", value: title || "Follow up" },
    { label: "Type", value: activityType(cleaned) },
    { label: "Due date", value: dueAt ? formatDraftDate(dueAt) : "Not detected" }
  ];
  if (relationMatch.selected) {
    fields.push({ label: "Related record", value: relationMatch.selected.label });
  }

  return {
    applyState: "disabled",
    candidates: relationMatch.candidates,
    confidence: dueAt && relationMatch.confidence === "high" ? "high" : relationMatch.confidence === "needs_clarification" ? "needs_clarification" : "medium",
    evidence: [cleaned],
    fields,
    id: "draft-activity",
    kind: "activity",
    missingInfo: [
      ...(dueAt ? [] : ["A due date was not confidently detected."]),
      ...(relatedTarget ? [] : ["A related person, organization, or deal was not detected."])
    ],
    reviewLabel: "Draft only",
    targetHref: relationMatch.selected?.href,
    targetKind: "Activity",
    targetLabel: relationMatch.selected ? relationMatch.selected.label : "New activity",
    title: "Draft activity",
    warnings: relationMatch.warnings
  };
}

async function draftNoteAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const parsed = parseNoteCommand(cleaned);
  const relationMatch = parsed.target ? await matchAnyRecord(actor, parsed.target) : emptyMatch();
  const body = parsed.body || noteBodyFallback(cleaned, parsed.target);
  const fields: AssistantDraftActionField[] = [
    { label: "Body", value: body || "No clear note body detected." }
  ];
  if (relationMatch.selected) {
    fields.push({ label: "Related record", value: relationMatch.selected.label });
  }

  return {
    applyState: "disabled",
    candidates: relationMatch.candidates,
    confidence: body && relationMatch.confidence === "high" ? "high" : relationMatch.confidence === "needs_clarification" ? "needs_clarification" : "medium",
    evidence: [cleaned],
    fields,
    id: "draft-note",
    kind: "note",
    missingInfo: [
      ...(body ? [] : ["A note body was not confidently detected."]),
      ...(parsed.target ? [] : ["A related person, organization, lead, or deal was not detected."])
    ],
    reviewLabel: "Draft only",
    targetHref: relationMatch.selected?.href,
    targetKind: "Note",
    targetLabel: relationMatch.selected ? relationMatch.selected.label : "New note",
    title: "Draft note",
    warnings: relationMatch.warnings
  };
}

async function draftContactRelationshipAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const parsed = parseContactRelationshipCommand(cleaned);
  const personMatch = parsed.target ? await matchPeople(actor, parsed.target) : emptyMatch();
  const selectedPerson = personMatch.selected;
  const summary = summarizeRelationshipFact(parsed.fact, selectedPerson?.label ?? parsed.target);
  const fields: AssistantDraftActionField[] = [
    { label: "Relationship Memory field", value: "Personal context" },
    { label: "Proposed summary", value: summary || "No clear relationship fact detected." }
  ];

  return {
    applyState: "disabled",
    candidates: personMatch.candidates,
    confidence: summary && personMatch.confidence === "high" ? "high" : personMatch.confidence,
    evidence: [parsed.fact ? `User-provided fact: ${parsed.fact}` : cleaned],
    fields,
    id: "draft-contact-relationship",
    kind: "contact_relationship_update",
    missingInfo: [
      ...(parsed.target ? [] : ["A contact name was not detected."]),
      ...(summary ? [] : ["A relationship/profile fact was not detected."])
    ],
    reviewLabel: "Draft only",
    targetHref: selectedPerson?.href,
    targetKind: "Contact",
    targetLabel: selectedPerson?.label ?? parsed.target ?? "Contact requires review",
    title: "Draft contact relationship update",
    warnings: [
      ...personMatch.warnings,
      "Review for sensitivity before saving. Do not store protected traits, confidential health details, or private facts that are not useful for customer relationship context."
    ]
  };
}

async function draftOrganizationContactCreationAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const parsed = parseOrganizationContactCommand(cleaned);
  const [organizationMatch, personMatch] = await Promise.all([
    parsed.organizationName ? matchOrganizations(actor, parsed.organizationName) : Promise.resolve(emptyMatch()),
    parsed.personName ? matchPeople(actor, parsed.personName) : Promise.resolve(emptyMatch())
  ]);
  const fields: AssistantDraftActionField[] = [
    { label: "Organization name", value: parsed.organizationName || "Missing" },
    { label: "Contact name", value: parsed.personName || "Missing" },
    { label: "Contact role/title", value: parsed.role || "Missing" },
    { label: "Relationship", value: parsed.organizationName && parsed.personName ? `${parsed.personName} at ${parsed.organizationName}` : "Missing" }
  ];

  return {
    applyState: "disabled",
    candidates: [...organizationMatch.candidates, ...personMatch.candidates],
    confidence: parsed.organizationName && parsed.personName && parsed.role && organizationMatch.candidates.length === 0 && personMatch.candidates.length === 0 ? "medium" : "needs_clarification",
    evidence: [parsed.note ? `Provided note: ${parsed.note}` : cleaned],
    fields,
    id: "draft-organization-contact-creation",
    kind: "organization_contact_creation",
    missingInfo: [
      ...(parsed.organizationName ? [] : ["Organization name is missing."]),
      ...(parsed.personName ? [] : ["Contact name is missing."]),
      ...(parsed.role ? [] : ["Contact role/title is missing."])
    ],
    reviewLabel: "Draft only",
    targetKind: "Contact + organization",
    targetLabel: "New records for review",
    title: "Draft organization/contact creation",
    warnings: [
      ...organizationMatch.candidates.map((candidate) => `Possible existing organization: ${candidate.label}. Review before creating a duplicate.`),
      ...personMatch.candidates.map((candidate) => `Possible existing contact: ${candidate.label}. Review before creating a duplicate.`),
      "No records will be created until an apply workflow exists and a user confirms it."
    ]
  };
}

async function draftAiPreferenceAction(actor: WorkspaceActor, query: string): Promise<AssistantDraftAction> {
  const cleaned = sanitizeEvidence(query);
  const [current, draft] = await Promise.all([
    getAiPreferences(actor),
    Promise.resolve(draftAiPreferenceChangesFromText(cleaned))
  ]);
  const proposedChanges = { ...draft.proposedChanges };
  if (/\b(casual|conversational)\b/i.test(cleaned)) {
    proposedChanges.naturalLanguageInstructions = "Email replies should be casual and concise.";
  }
  const fields = Object.entries(proposedChanges).map(([key, value]) => ({
    currentValue: formatPreferenceValue(current[key as keyof typeof current]),
    label: preferenceLabel(key),
    value: formatPreferenceValue(value)
  }));

  return {
    applyState: "disabled",
    candidates: [],
    confidence: fields.length > 0 ? "medium" : "needs_clarification",
    evidence: [cleaned],
    fields: fields.length > 0 ? fields : [{ label: "Requested guidance", value: "No clear supported AI preference change detected." }],
    id: "draft-ai-preference-update",
    kind: "ai_preference_update",
    missingInfo: fields.length > 0 ? [] : ["Specify the tone, summary length, detail level, memory usage, diagnostics detail, or suggestion level to change."],
    reviewLabel: "Draft only",
    targetKind: "AI preferences",
    targetLabel: "Current user's AI preferences",
    title: "Draft AI preference change",
    warnings: ["Settings are not saved from Assistant drafts in this slice."]
  };
}

function parseContactRelationshipCommand(input: string) {
  const match = input.match(/\bupdate\s+(.+?)(?:'s|’s)?\s+(?:profile|relationship(?:\s+memory)?|contact profile)\s+(?:to include|with|that)\s+(.+)$/i);
  if (match) {
    return {
      fact: cleanTrailingPunctuation(match[2] ?? ""),
      target: cleanPossessive(match[1] ?? "")
    };
  }
  const fallback = input.match(/\b(?:profile|relationship(?:\s+memory)?)\s+for\s+(.+?)\s+(?:to include|with|that)\s+(.+)$/i);
  return {
    fact: cleanTrailingPunctuation(fallback?.[2] ?? ""),
    target: cleanPossessive(fallback?.[1] ?? "")
  };
}

function parseOrganizationContactCommand(input: string) {
  const noteSplit = input.split(/\bfrom\s+(?:this\s+)?note:\s*/i);
  const command = noteSplit[0] ?? input;
  const note = sanitizeEvidence(noteSplit.slice(1).join(" from note: "));
  const organizationName = cleanTrailingPunctuation(
    command.match(/\borganization\s+(?:for|called|named)\s+(.+?)(?:\s+and\s+add|\s+with|\s*$)/i)?.[1] ?? ""
  );
  const addMatch = command.match(/\badd\s+(.+?)(?:\s+as\s+(.+?))?(?:\s+from\b|\s+to\b|\s*$)/i);
  return {
    note,
    organizationName,
    personName: cleanTrailingPunctuation(addMatch?.[1] ?? ""),
    role: cleanTrailingPunctuation(addMatch?.[2] ?? "")
  };
}

function parseNoteCommand(input: string) {
  const colonMatch = input.match(/\b(?:add|create|draft|log|save)\s+(?:a\s+)?note\s+(?:for|to|on|about)\s+(.+?)\s*:\s*(.+)$/i);
  if (colonMatch) {
    return {
      body: cleanTrailingPunctuation(colonMatch[2] ?? ""),
      target: cleanTrailingPunctuation(colonMatch[1] ?? "")
    };
  }
  const thatMatch = input.match(/\b(?:add|create|draft|log|save)\s+(?:a\s+)?note\s+(?:for|to|on|about)\s+(.+?)\s+(?:that|saying|with)\s+(.+)$/i);
  if (thatMatch) {
    return {
      body: cleanTrailingPunctuation(thatMatch[2] ?? ""),
      target: cleanTrailingPunctuation(thatMatch[1] ?? "")
    };
  }
  const fromMatch = input.match(/\b(?:add|create|draft|log|save)\s+(?:this\s+)?note\s+(.+?)\s+(?:for|to|on|about)\s+(.+)$/i);
  if (fromMatch) {
    return {
      body: cleanTrailingPunctuation(fromMatch[1] ?? ""),
      target: cleanTrailingPunctuation(fromMatch[2] ?? "")
    };
  }
  return { body: "", target: "" };
}

function extractActivityRelatedTarget(input: string) {
  const followUpMatch = input.match(/\bfollow\s+up\s+with\s+(.+?)(?:\s+(?:next|tomorrow|today|in\s+\d+|on\s+\d|by\s+\d|this\s+\w+)|[.!?]|$)/i);
  if (followUpMatch) return cleanTrailingPunctuation(followUpMatch[1] ?? "");
  const match = input.match(/\b(?:with|for|to)\s+(.+?)(?:\s+(?:next|tomorrow|today|in\s+\d+|on\s+\d|by\s+\d|this\s+\w+)|[.!?]|$)/i);
  return cleanTrailingPunctuation(match?.[1] ?? "");
}

function activityTitle(input: string, relatedTarget: string) {
  const withoutPrefix = input
    .replace(/^\s*(?:please\s+)?(?:remind me to|create (?:a )?(?:task|activity) to|draft (?:a )?(?:task|activity) to)\s+/i, "")
    .replace(/\s+(?:next\s+\w+|tomorrow|today|in\s+\d+\s+(?:day|days|week|weeks)|on\s+\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?).*$/i, "")
    .trim();
  const title = withoutPrefix || (relatedTarget ? `Follow up with ${relatedTarget}` : "Follow up");
  return sentenceCase(cleanTrailingPunctuation(title)).slice(0, 120);
}

function activityType(input: string) {
  if (/\b(call|phone)\b/i.test(input)) return "Call";
  if (/\b(email|reply|message)\b/i.test(input)) return "Email";
  return "Task";
}

function noteBodyFallback(input: string, target: string) {
  const withoutPrefix = input.replace(/^\s*(?:please\s+)?(?:add|create|draft|log|save)\s+(?:a\s+|this\s+)?note\s*/i, "");
  const withoutTarget = target
    ? withoutPrefix.replace(new RegExp(`\\b(?:for|to|on|about)\\s+${escapeRegExp(target)}\\b`, "i"), "")
    : withoutPrefix;
  return cleanTrailingPunctuation(withoutTarget.replace(/^(?:that|saying|with)\s+/i, "")).slice(0, 600);
}

function parseDueDate(input: string, now: Date) {
  const lower = input.toLowerCase();
  if (/\btoday\b/.test(lower)) return startOfLocalDay(now);
  if (/\btomorrow\b/.test(lower)) return addDays(startOfLocalDay(now), 1);
  const inMatch = lower.match(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/);
  if (inMatch) {
    const amount = Number(inMatch[1]);
    const multiplier = inMatch[2].startsWith("week") ? 7 : 1;
    return addDays(startOfLocalDay(now), amount * multiplier);
  }
  const weekdayMatch = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (weekdayMatch) return nextWeekday(now, weekdayMatch[1]);
  const dateMatch = lower.match(/\bon\s+(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (dateMatch) {
    const month = Number(dateMatch[1]) - 1;
    const day = Number(dateMatch[2]);
    const year = dateMatch[3] ? normalizeYear(Number(dateMatch[3])) : now.getFullYear();
    return new Date(year, month, day);
  }
  return null;
}

async function matchAnyRecord(actor: WorkspaceActor, target: string) {
  const [people, organizations, deals, leads] = await Promise.all([
    matchPeople(actor, target),
    matchOrganizations(actor, target),
    matchDeals(actor, target),
    matchLeads(actor, target)
  ]);
  const candidates = [...people.candidates, ...organizations.candidates, ...deals.candidates, ...leads.candidates];
  const highCandidates = candidates.filter((candidate) => normalize(candidate.label) === normalize(target));
  if (highCandidates.length === 1) {
    return { candidates, confidence: "high" as const, selected: highCandidates[0], warnings: [] };
  }
  if (candidates.length === 1) {
    return { candidates, confidence: "medium" as const, selected: candidates[0], warnings: [] };
  }
  if (candidates.length > 1) {
    return {
      candidates,
      confidence: "needs_clarification" as const,
      selected: undefined,
      warnings: ["Multiple possible related records matched. Pick the target before applying this draft."]
    };
  }
  return { candidates, confidence: "low" as const, selected: undefined, warnings: ["No confident related CRM record match was found."] };
}

async function matchPeople(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const terms = searchTerms(cleaned);
  const people = await prisma.person.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      email: true,
      firstName: true,
      id: true,
      lastName: true,
      organization: { select: { name: true } }
    },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      OR: personSearchWhere(cleaned, terms)
    }
  });
  const candidates = people.map((person): AssistantDraftActionCandidate => {
    const label = formatPersonName(person) ?? person.email ?? "Unnamed contact";
    return {
      detail: [person.email, person.organization?.name].filter(Boolean).join(" · ") || undefined,
      href: `/contacts/${person.id}`,
      id: person.id,
      label,
      type: "person"
    };
  });
  return matchResult(candidates, cleaned, "contact");
}

async function matchOrganizations(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const organizations = await prisma.organization.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { domain: true, id: true, name: true },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      OR: [
        { name: { contains: cleaned, mode: "insensitive" } },
        { domain: { contains: cleaned, mode: "insensitive" } }
      ]
    }
  });
  const candidates = organizations.map((organization): AssistantDraftActionCandidate => ({
    detail: organization.domain ?? undefined,
    href: `/organizations/${organization.id}`,
    id: organization.id,
    label: organization.name,
    type: "organization"
  }));
  return matchResult(candidates, cleaned, "organization");
}

async function matchDeals(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const deals = await prisma.deal.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, title: true },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      title: { contains: cleaned, mode: "insensitive" }
    }
  });
  const candidates = deals.map((deal): AssistantDraftActionCandidate => ({
    href: `/deals/${deal.id}`,
    id: deal.id,
    label: deal.title,
    type: "deal"
  }));
  return matchResult(candidates, cleaned, "deal");
}

async function matchLeads(actor: WorkspaceActor, target: string) {
  const cleaned = normalizeTarget(target);
  if (!cleaned) return emptyMatch();
  const leads = await prisma.lead.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, source: true, title: true },
    take: 6,
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      title: { contains: cleaned, mode: "insensitive" }
    }
  });
  const candidates = leads.map((lead): AssistantDraftActionCandidate => ({
    detail: lead.source ?? undefined,
    href: `/leads/${lead.id}`,
    id: lead.id,
    label: lead.title,
    type: "lead"
  }));
  return matchResult(candidates, cleaned, "lead");
}

function matchResult(candidates: AssistantDraftActionCandidate[], target: string, label: string) {
  const exactCandidates = candidates.filter((candidate) => normalize(candidate.label) === normalize(target));
  if (exactCandidates.length === 1) return { candidates, confidence: "high" as const, selected: exactCandidates[0], warnings: [] };
  if (candidates.length === 1) return { candidates, confidence: "medium" as const, selected: candidates[0], warnings: [] };
  if (candidates.length > 1) {
    return {
      candidates,
      confidence: "needs_clarification" as const,
      selected: undefined,
      warnings: [`Multiple ${label} matches found. Review candidates before applying this draft.`]
    };
  }
  return { candidates, confidence: "low" as const, selected: undefined, warnings: [] };
}

function personSearchWhere(target: string, terms: string[]): Prisma.PersonWhereInput[] {
  return [
    { email: { contains: target, mode: "insensitive" } },
    { firstName: { contains: target, mode: "insensitive" } },
    { lastName: { contains: target, mode: "insensitive" } },
    ...terms.flatMap((term): Prisma.PersonWhereInput[] => [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } }
    ])
  ];
}

function summarizeRelationshipFact(fact: string, target: string | undefined) {
  const cleaned = cleanTrailingPunctuation(fact.replace(/^that\s+/i, ""));
  if (!cleaned) return "";
  const firstName = target?.split(/\s+/)[0] ?? "They";
  const lower = cleaned.toLowerCase();
  const travelMatch = lower.match(/\b(?:she|he|they|is|are)?\s*(?:is|are)?\s*going\s+on\s+vacation\s+to\s+(.+?)(?:\s+in\s+(\d+)\s+weeks?)?(?:\s+with\s+(?:her|his|their)\s+family)?$/i);
  if (travelMatch) {
    const place = sentenceCase(travelMatch[1] ?? "").replace(/\s+with\s+family$/i, "");
    const weeks = travelMatch[2] ? ` in about ${numberWord(Number(travelMatch[2]))} weeks` : "";
    const family = /\bwith\s+(?:her|his|their)\s+family\b/i.test(cleaned) ? " with family" : "";
    return `${firstName} mentioned ${pronounFor(cleaned)} will be traveling to ${place}${family}${weeks}.`;
  }
  const normalized = cleaned
    .replace(/\bI\s+/g, `${firstName} `)
    .replace(/\bmy\s+/g, "their ")
    .replace(/\s+/g, " ");
  return `${firstName} mentioned ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}.`;
}

function emptyMatch() {
  return {
    candidates: [] as AssistantDraftActionCandidate[],
    confidence: "low" as const,
    selected: undefined as AssistantDraftActionCandidate | undefined,
    warnings: [] as string[]
  };
}

function sanitizeEvidence(value: string) {
  return redactSensitiveText(value).trim().replace(/\s+/g, " ").slice(0, 500);
}

function normalizeTarget(value: string) {
  return sanitizeEvidence(value).slice(0, 120);
}

function searchTerms(value: string) {
  return value.split(/\s+/).map((term) => cleanTrailingPunctuation(term)).filter((term) => term.length >= 2).slice(0, 5);
}

function cleanPossessive(value: string) {
  return cleanTrailingPunctuation(value.replace(/(?:'s|’s)$/i, ""));
}

function cleanTrailingPunctuation(value: string) {
  return value.trim().replace(/^[\s"'“”]+|[\s"'“”.!?;:,]+$/g, "");
}

function sentenceCase(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function nextWeekday(now: Date, weekday: string) {
  const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(weekday);
  const start = startOfLocalDay(now);
  const delta = ((target - start.getDay() + 7) % 7) || 7;
  return addDays(start, delta);
}

function normalizeYear(value: number) {
  return value < 100 ? 2000 + value : value;
}

function formatDraftDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" }).format(value);
}

function formatPreferenceValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";
  return String(value).replace(/_/g, " ");
}

function preferenceLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function pronounFor(value: string) {
  if (/\bhe\b/i.test(value)) return "he";
  if (/\bthey\b/i.test(value)) return "they";
  return "she";
}

function numberWord(value: number) {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][value] ?? String(value);
}
