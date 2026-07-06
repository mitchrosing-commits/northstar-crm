import { extractSections } from "./markdown-normalizer";
import { targetFromMatch } from "./match-records";
import type {
  MatchedCrmObject,
  MeetingIntelligenceDraft,
  MeetingSourceMetadata,
  RelationshipBriefFields,
  UnmatchedEntity
} from "./types";

type AnalyzeMeetingInput = {
  contextText?: string | null;
  markdown: string;
  matchedObjects: MatchedCrmObject[];
  sourceMetadata?: MeetingSourceMetadata;
  unmatchedEntities: UnmatchedEntity[];
};

const companyFactPattern =
  /\b(wms|oms|erp|tms|warehouse|warehouses|dc|dcs|distribution center|distribution|facility|facilities|site|sites|go-live|go live|uat|integration|integrations|data migration|vendor|system|pain|pain point|throughput|inventory|labor|slotting|implementation|implementation phase|hypercare|support|optimization|selection process|sponsor|stakeholder|decision maker)\b/i;
const personalFactPattern =
  /\b(birthday|hobby|hobbies|family|spouse|child|children|kid|kids|vacation|trip|travel|fan|sports|game|prefers|preference|likes|communication preference|sponsor|stakeholder|decision maker)\b/i;
const communicationStylePattern =
  /\b(prefers?|preference|communication style|concise|short|brief|detailed|email|emails|call|calls|phone|text|morning|afternoon|reply|replies|responds)\b/i;
const businessConcernPattern =
  /\b(concerned|concern|worried|worry|switching cost|switching costs|implementation disruption|disruption|risk|risks|blocker|pain|pain point|budget|approval|legal|procurement|timeline)\b/i;
const relationshipReminderPattern =
  /\b(next personal follow[- ]?up|personal follow[- ]?up|ask (?:him|her|them|about|how)|remember to ask|follow up .*trip|follow up .*vacation|check in .*family|check in .*kids)\b/i;
const internalGuidancePattern =
  /\b(use .*naturally|do not overdo|don't overdo|avoid over-personal|avoid creepy|personalization guidance|internal guidance|use for personalization)\b/i;
const protectedTraitPattern =
  /\b(race|ethnicity|religion|religious|church|mosque|synagogue|political|politics|party affiliation|disability|disabled|medical diagnosis|pregnant|pregnancy|sexual orientation|gender identity)\b/i;
const dealFactPattern = /\b(budget|scope|sow|proposal|buying signal|decision|decision process|stakeholder|risk|timeline|procurement|legal|approval|pilot|renewal|expansion)\b/i;
const leadFactPattern = /\b(discovery|qualification|qualify|lead source|source|interest|interested|evaluation|pilot|timeline|budget|approval|stakeholder|decision process|next step|pain|risk)\b/i;
const genericTargetTerms = new Set([
  "account",
  "company",
  "contact",
  "deal",
  "lead",
  "opportunity",
  "org",
  "organization",
  "person",
  "project",
  "prospect"
]);

export function analyzeMeetingIntelligence(input: AnalyzeMeetingInput): MeetingIntelligenceDraft {
  const text = input.markdown;
  const lines = meaningfulLines(text);
  const sections = extractSections(`${input.contextText ?? ""}\n${text}`);
  const summary = buildSummary(lines);
  const warnings = buildWarnings(input.matchedObjects, input.unmatchedEntities, sections.actionItems, lines);
  const primaryTarget = pickPrimaryTarget(input.matchedObjects);
  const primaryMatch = primaryTarget ? input.matchedObjects.find((match) => match.id === primaryTarget.id && match.objectType === primaryTarget.type) : undefined;
  const associatedTargets = buildAssociatedTargets(input.matchedObjects);
  const meetingActivity = primaryTarget
    ? {
        associatedTargets,
        confidence: primaryMatch?.confidence,
        completedAt: parseMeetingDate(input.contextText ?? text)?.toISOString() ?? new Date().toISOString(),
        description: [
          `Summary: ${summary}`,
          "",
          "Associated CRM records:",
          ...associatedTargets.map((target) => `- ${targetTypeLabel(target.type)}: ${target.label ?? target.id}`),
          "",
          "Source meeting markdown:",
          text
        ].join("\n"),
        evidence: lines.slice(0, 3),
        include: true,
        matchedReason: primaryMatch?.matchedReason,
        target: primaryTarget,
        targetWarning: primaryMatch?.warning,
        title: buildMeetingTitle(input.contextText ?? text, primaryTarget.label ?? "CRM record")
      }
    : null;

  return {
    markdown: text,
    matchedObjects: input.matchedObjects,
    meetingActivity,
    notes: buildNotes(input.matchedObjects, primaryTarget, summary, lines),
    nextStepActivities: buildNextSteps(input.matchedObjects, sections.actionItems),
    relationshipBriefUpdates: buildRelationshipBriefUpdates(input.matchedObjects, lines),
    sourceMetadata: input.sourceMetadata,
    summary,
    unmatchedEntities: input.unmatchedEntities,
    warnings
  };
}

function buildRelationshipBriefUpdates(matches: MatchedCrmObject[], lines: string[]) {
  const personCount = confidentObjectCount(matches, "person");
  return matches
    .filter((match) => match.objectType === "person" && match.confidence !== "ambiguous")
    .slice(0, 8)
    .map((match) => {
      const target = targetFromMatch(match);
      const safeLines = relationshipLinesForTarget(lines, match, personCount);
      const proposed: RelationshipBriefFields = {
        relationshipPersonalContext: summarizeRelationshipLines(safeLines.filter((line) => personalFactPattern.test(line))),
        relationshipCommunicationStyle: summarizeRelationshipLines(safeLines.filter((line) => communicationStylePattern.test(line))),
        relationshipBusinessConcerns: summarizeRelationshipLines(safeLines.filter((line) => businessConcernPattern.test(line))),
        relationshipFollowUpReminders: summarizeRelationshipLines(safeLines.filter((line) => relationshipReminderPattern.test(line))),
        relationshipInternalGuidance: summarizeInternalGuidance(safeLines)
      };
      const populated = compactRelationshipFields(proposed);
      if (Object.keys(populated).length === 0) return null;
      return {
        confidence: match.confidence,
        evidence: [match.evidenceExcerpt, ...safeLines].filter(Boolean).slice(0, 5),
        existing: {},
        id: `relationship-brief-${match.id}`,
        include: true,
        matchedReason: match.matchedReason,
        proposed: populated,
        target,
        targetWarning: match.warning
      };
    })
    .filter((proposal): proposal is NonNullable<typeof proposal> => Boolean(proposal));
}

function relationshipLinesForTarget(lines: string[], match: MatchedCrmObject, personCount: number) {
  return lines
    .filter((line) => !isMeetingMetadataLine(line))
    .filter((line) => !protectedTraitPattern.test(line))
    .filter((line) => {
      if (lineMentionsMatch(line, match)) return true;
      if (personCount <= 1) {
        return (
          personalFactPattern.test(line) ||
          communicationStylePattern.test(line) ||
          businessConcernPattern.test(line) ||
          relationshipReminderPattern.test(line) ||
          internalGuidancePattern.test(line)
        );
      }
      return (
        personalFactPattern.test(line) ||
        communicationStylePattern.test(line) ||
        businessConcernPattern.test(line) ||
        relationshipReminderPattern.test(line) ||
        internalGuidancePattern.test(line)
      ) && lineMentionsMatch(line, match);
    })
    .slice(0, 12);
}

function isMeetingMetadataLine(line: string) {
  return /^(source type|original file|mime type|extracted words|extraction method|conversion|processor|provider|warning):/i.test(
    line.replace(/^[-*]\s*/, "").trim()
  );
}

function summarizeRelationshipLines(lines: string[]) {
  const unique = uniqueNormalizedLines(lines).slice(0, 3);
  return unique.length > 0 ? unique.join("\n") : undefined;
}

function summarizeInternalGuidance(lines: string[]) {
  const explicit = summarizeRelationshipLines(lines.filter((line) => internalGuidancePattern.test(line)));
  if (explicit) return explicit;
  if (lines.some((line) => personalFactPattern.test(line))) {
    return "Use personal context naturally for thoughtful follow-up; do not overdo personal references.";
  }
  return undefined;
}

function compactRelationshipFields(fields: RelationshipBriefFields) {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, value?.trim()])
      .filter((entry): entry is [keyof RelationshipBriefFields, string] => Boolean(entry[1]))
  ) as RelationshipBriefFields;
}

function uniqueNormalizedLines(lines: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    const normalized = line.replace(/^[-*]\s*/, "").trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized.slice(0, 600));
  }
  return unique;
}

function buildNotes(matches: MatchedCrmObject[], primaryTarget: ReturnType<typeof pickPrimaryTarget>, summary: string, lines: string[]) {
  const notes = [];
  const usableMatches = matches.filter((match) => match.confidence !== "ambiguous");
  const objectCounts = objectTypeCounts(usableMatches);
  for (const match of usableMatches.slice(0, 8)) {
    const target = targetFromMatch(match);
    const factLines = relevantFactLines(match, lines, { objectCounts, primaryTarget });
    if (factLines.length === 0 && !sameTarget(target, primaryTarget)) continue;
    const kind = noteKind(match.objectType, factLines);
    const noteSummary = kind === "meeting_summary" || factLines.length === 0 ? summary : factLines.slice(0, 3).join(" ");
    const body = [
      noteTitle(kind, target.label ?? match.displayName),
      "",
      `Target: ${targetTypeLabel(target.type)} - ${target.label ?? target.id}`,
      "",
      "Summary:",
      noteSummary,
      factLines.length > 0 ? "" : null,
      factLines.length > 0 ? "Facts to save:" : null,
      ...factLines.map((line) => `- ${line}`)
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trim();
    notes.push({
      body,
      confidence: match.confidence,
      evidence: [match.evidenceExcerpt, ...factLines].filter(Boolean).slice(0, 4),
      id: `note-${match.objectType}-${match.id}`,
      include: true,
      kind,
      matchedReason: match.matchedReason,
      targetWarning: match.warning,
      target
    });
  }
  return notes;
}

function buildNextSteps(matches: MatchedCrmObject[], actionItems: string[]) {
  const target = pickPrimaryTarget(matches);
  if (!target) return [];
  const match = matches.find((candidate) => candidate.id === target.id && candidate.objectType === target.type);
  const associatedTargets = buildAssociatedTargets(matches);
  return actionItems.slice(0, 6).map((item, index) => {
    const dueAt = parseDueDate(item);
    const ownerHint = parseOwnerHint(item);
    return {
      confidence: match?.confidence,
      description: [
        `Source: ${item}`,
        ownerHint ? `Owner hint: ${ownerHint}` : "",
        associatedTargets.length > 1
          ? `Related records: ${associatedTargets.map((related) => `${targetTypeLabel(related.type)}: ${related.label ?? related.id}`).join("; ")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n"),
      dueAt: dueAt?.toISOString(),
      evidence: [item],
      id: `next-step-${index + 1}`,
      include: true,
      matchedReason: match?.matchedReason,
      ownerId: null,
      target,
      targetWarning: match?.warning,
      title: actionTitle(item),
      type: "TASK" as const
    };
  });
}

function buildWarnings(matches: MatchedCrmObject[], unmatched: UnmatchedEntity[], actionItems: string[], lines: string[]) {
  const warnings = new Set<string>();
  if (!matches.some((match) => match.objectType === "organization")) warnings.add("No organization was confidently matched.");
  if (!matches.some((match) => match.objectType === "deal" || match.objectType === "lead")) {
    warnings.add("No deal or lead was confidently matched.");
  }
  for (const match of matches) {
    if (match.warning) warnings.add(match.warning);
    if (match.confidence === "ambiguous") warnings.add(`Ambiguous ${match.objectType} match: ${match.displayName}.`);
  }
  if (unmatched.length > 0) warnings.add("Some mentioned entities were not matched to CRM records.");
  if (actionItems.some((item) => !parseDueDate(item))) warnings.add("Some next steps do not include a clear due date.");
  if (matches.length > 0 && lines.some((line) => protectedTraitPattern.test(line))) {
    warnings.add("Protected or sensitive trait details were excluded from curated Relationship Brief and fact-note suggestions.");
  }
  return Array.from(warnings);
}

function pickPrimaryTarget(matches: MatchedCrmObject[]) {
  const usable = matches.filter((match) => match.confidence !== "ambiguous");
  const ranked = [
    usable.find((match) => match.objectType === "deal" && match.status === "OPEN"),
    usable.find((match) => match.objectType === "lead" && match.status !== "CONVERTED"),
    usable.find((match) => match.objectType === "organization"),
    usable.find((match) => match.objectType === "person")
  ].find(Boolean);
  return ranked ? targetFromMatch(ranked) : null;
}

function buildAssociatedTargets(matches: MatchedCrmObject[]) {
  const seen = new Set<string>();
  const targets = [];
  for (const match of matches.filter((candidate) => candidate.confidence !== "ambiguous")) {
    const target = targetFromMatch(match);
    const key = `${target.type}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

function sameTarget(left: ReturnType<typeof targetFromMatch> | null, right: ReturnType<typeof pickPrimaryTarget>) {
  return Boolean(left && right && left.id === right.id && left.type === right.type);
}

function relevantFactLines(
  match: MatchedCrmObject,
  lines: string[],
  options: { objectCounts: Map<MatchedCrmObject["objectType"], number>; primaryTarget: ReturnType<typeof pickPrimaryTarget> }
) {
  const pattern = factPatternForObject(match.objectType);
  return lines
    .filter((line) => !isMeetingMetadataLine(line))
    .filter((line) => !protectedTraitPattern.test(line))
    .filter((line) => pattern.test(line))
    .filter((line) => lineBelongsToMatch(line, match, options))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function noteKind(objectType: MatchedCrmObject["objectType"], factLines: string[]) {
  if (objectType === "person" && factLines.some((line) => personalFactPattern.test(line))) return "personal_fact" as const;
  if (objectType === "organization" && factLines.some((line) => companyFactPattern.test(line))) return "company_fact" as const;
  if (objectType === "lead" && factLines.some((line) => leadFactPattern.test(line) || dealFactPattern.test(line))) return "lead_fact" as const;
  if (objectType === "deal" && factLines.some((line) => dealFactPattern.test(line))) return "deal_fact" as const;
  return "meeting_summary" as const;
}

function noteTitle(kind: ReturnType<typeof noteKind>, targetLabel: string) {
  const label =
    kind === "personal_fact"
      ? "Meeting intelligence personal facts"
      : kind === "company_fact"
        ? "Meeting intelligence company facts"
        : kind === "deal_fact"
          ? "Meeting intelligence deal facts"
          : kind === "lead_fact"
            ? "Meeting intelligence lead facts"
            : "Meeting intelligence summary";
  return `${label} for ${targetLabel}`;
}

function factPatternForObject(objectType: MatchedCrmObject["objectType"]) {
  if (objectType === "person") return personalFactPattern;
  if (objectType === "organization") return companyFactPattern;
  if (objectType === "lead") return new RegExp(`${dealFactPattern.source}|${leadFactPattern.source}`, "i");
  return dealFactPattern;
}

function lineBelongsToMatch(
  line: string,
  match: MatchedCrmObject,
  options: { objectCounts: Map<MatchedCrmObject["objectType"], number>; primaryTarget: ReturnType<typeof pickPrimaryTarget> }
) {
  if (lineMentionsMatch(line, match)) return true;
  if ((match.objectType === "deal" || match.objectType === "lead") && companyFactPattern.test(line)) return false;
  if (sameTarget(targetFromMatch(match), options.primaryTarget)) return true;
  return (options.objectCounts.get(match.objectType) ?? 0) === 1;
}

function lineMentionsMatch(line: string, match: MatchedCrmObject) {
  const lower = line.toLowerCase();
  const terms = matchTerms(match.displayName);
  return terms.some((term) => lower.includes(term));
}

function matchTerms(displayName: string) {
  const full = displayName.trim().toLowerCase();
  const parts = full
    .split(/[^a-z0-9]+/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 2 && !genericTargetTerms.has(part));
  return uniqueNormalizedLines([full, ...parts]).map((term) => term.toLowerCase());
}

function objectTypeCounts(matches: MatchedCrmObject[]) {
  const counts = new Map<MatchedCrmObject["objectType"], number>();
  for (const match of matches) {
    counts.set(match.objectType, (counts.get(match.objectType) ?? 0) + 1);
  }
  return counts;
}

function confidentObjectCount(matches: MatchedCrmObject[], objectType: MatchedCrmObject["objectType"]) {
  return matches.filter((match) => match.objectType === objectType && match.confidence !== "ambiguous").length;
}

function targetTypeLabel(type: MatchedCrmObject["objectType"]) {
  if (type === "deal") return "Deal";
  if (type === "lead") return "Lead";
  if (type === "person") return "Contact";
  return "Organization";
}

function buildSummary(lines: string[]) {
  const candidates = lines
    .filter((line) => !/^#|^- source type:|^- original file:/i.test(line))
    .filter((line) => !protectedTraitPattern.test(line))
    .slice(0, 4);
  if (candidates.length === 0) return "Meeting notes were captured for CRM review.";
  return candidates.join(" ").slice(0, 700);
}

function buildMeetingTitle(text: string, targetLabel: string) {
  const date = parseMeetingDate(text);
  const datePrefix = date ? `${date.toISOString().slice(0, 10)} ` : "";
  return `${datePrefix}Meeting: ${targetLabel}`.slice(0, 160);
}

function actionTitle(item: string) {
  return item
    .replace(/^(todo|to do|action item|action|next step|follow[- ]?up)\s*:?\s*/i, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .trim()
    .slice(0, 160) || "Follow up from meeting";
}

function parseDueDate(text: string): Date | undefined {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return safeDate(`${iso[1]}T00:00:00.000Z`);
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (slash) return safeDate(`${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}T00:00:00.000Z`);
  const meetingDate: Date | undefined = parseMeetingDate(text);
  const baseDate: Date = meetingDate ?? new Date();
  if (/\bby tomorrow\b/i.test(text)) return addDays(baseDate, 1);
  if (/\bby next week\b/i.test(text)) return addDays(baseDate, 7);
  const weekday = text.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) return nextWeekday(baseDate, weekday[1]);
  return undefined;
}

function parseMeetingDate(text: string): Date | undefined {
  const explicit = text.match(/\b(?:meeting date|date)\s*:\s*(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})/i);
  if (!explicit) return undefined;
  const value = explicit[1];
  const iso = value.match(/^(20\d{2}-\d{2}-\d{2})$/);
  if (iso) return safeDate(`${iso[1]}T00:00:00.000Z`);
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  if (slash) return safeDate(`${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}T00:00:00.000Z`);
  return undefined;
}

function safeDate(value: string): Date | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseOwnerHint(text: string) {
  return text.match(/\bowner\s*:\s*([^.;\n]+)/i)?.[1]?.trim();
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function nextWeekday(baseDate: Date, weekday: string): Date | undefined {
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const target = weekdays.indexOf(weekday.toLowerCase());
  if (target < 0) return undefined;
  const date = new Date(baseDate);
  const delta = (target - date.getUTCDay() + 7) % 7 || 7;
  return addDays(date, delta);
}

function meaningfulLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && line.length < 500);
}
