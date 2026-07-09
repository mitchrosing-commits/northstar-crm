import { extractSections } from "./markdown-normalizer";
import { targetFromMatch } from "./match-records";
import type {
  MatchedCrmObject,
  MeetingProposalFactCategory,
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
  /\b(wms|oms|erp|tms|warehouse|warehouses|dc|dcs|distribution center|distribution|facility|facilities|site|sites|go-live|go live|uat|integration|integrations|data migration|vendor|system|pain|pain point|throughput|inventory|labor|slotting|implementation|implementation phase|hypercare|support|optimization|selection process)\b/i;
const personalFactPattern =
  /\b(birthday|hobby|hobbies|family|spouse|child|children|kid|kids|vacation|trip|travel|fan|sports|game|prefers|preference|likes|communication preference)\b/i;
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
const stakeholderPattern = /\b(stakeholder|sponsor|champion|decision maker|economic buyer|influencer|buyer committee|buying committee)\b/i;
const actionLinePattern = /^(action|action item|todo|to do|next step|follow[- ]?up)\s*:/i;
const rawSpeakerPrefixPattern = /^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s*:\s+(.+)$/;
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
      const lineFacts = safeLines.map((line) => ({ line, category: classifyLineForMatch(line, match) }));
      const proposed: RelationshipBriefFields = {
        relationshipPersonalContext: summarizeRelationshipLines(
          lineFacts.filter(({ category, line }) => category === "personFact" && personalFactPattern.test(line)).map(({ line }) => line),
          match,
          "personFact"
        ),
        relationshipCommunicationStyle: summarizeRelationshipLines(
          lineFacts.filter(({ category, line }) => category === "personFact" && communicationStylePattern.test(line)).map(({ line }) => line),
          match,
          "personFact"
        ),
        relationshipBusinessConcerns: summarizeRelationshipLines(
          lineFacts.filter(({ category, line }) => category === "personFact" && businessConcernPattern.test(line)).map(({ line }) => line),
          match,
          "personFact"
        ),
        relationshipFollowUpReminders: summarizeRelationshipLines(
          lineFacts.filter(({ category, line }) => category === "personFact" && relationshipReminderPattern.test(line)).map(({ line }) => line),
          match,
          "personFact"
        ),
        relationshipInternalGuidance: summarizeInternalGuidance(safeLines)
      };
      const populated = compactRelationshipFields(proposed);
      if (Object.keys(populated).length === 0) return null;
      return {
        confidence: match.confidence,
        evidence: [match.evidenceExcerpt, ...safeLines].filter(Boolean).slice(0, 5),
        existing: {},
        facts: relationshipFactsFromProposedFields(populated, {
          evidence: [match.evidenceExcerpt, ...safeLines].filter(Boolean).slice(0, 5),
          id: `relationship-brief-${match.id}`,
          warnings: relationshipFactWarnings(lineFacts)
        }),
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
      const category = classifyLineForMatch(line, match);
      if (category !== "personFact") return false;
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

function summarizeRelationshipLines(
  lines: string[],
  match?: MatchedCrmObject,
  category: MeetingProposalFactCategory = "personFact"
) {
  const unique = uniqueNormalizedLines(lines.map((line) => summarizeFactLine(line, { category, match }))).slice(0, 3);
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

function relationshipFactsFromProposedFields(
  fields: RelationshipBriefFields,
  proposal: { evidence: string[]; id: string; warnings?: string[] }
) {
  return Object.entries(fields).flatMap(([field, value]) =>
    splitFactText(value).map((text, index) => ({
      category: "personFact" as const,
      evidence: proposal.evidence,
      field: field as keyof RelationshipBriefFields,
      id: `${proposal.id}-${field}-${index + 1}`,
      include: true,
      text,
      warnings: proposal.warnings
    }))
  );
}

function relationshipFactWarnings(lines: Array<{ category: MeetingProposalFactCategory; line: string }>) {
  const warnings = new Set<string>();
  if (lines.some(({ category }) => category === "stakeholderNote")) {
    warnings.add("Stakeholder context was kept out of Relationship Memory unless a reviewer explicitly rewrites it as contact-specific context.");
  }
  if (lines.some(({ category }) => category === "organizationFact" || category === "dealFact")) {
    warnings.add("Company, deal, and opportunity facts were excluded from contact Relationship Memory.");
  }
  if (lines.some(({ category }) => category === "followUpAction")) {
    warnings.add("Follow-up actions were excluded from Relationship Memory and should be reviewed as activities.");
  }
  return Array.from(warnings);
}

function splitFactText(value: string | undefined) {
  if (!value) return [];
  return value
    .split(/\n{1,}|\s[•]\s/g)
    .map((item) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
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
    const factGroups = noteFactGroups(match, lines, { objectCounts, primaryTarget });
    if (factGroups.length === 0 && sameTarget(target, primaryTarget)) {
      factGroups.push({ category: "ambiguousNeedsReview", lines: [] });
    }
    for (const group of factGroups) {
      const factLines = group.lines;
      const category = group.category;
      const kind = noteKind(match.objectType, factLines, category);
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
      category,
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
      category: "followUpAction" as const,
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

function noteFactGroups(
  match: MatchedCrmObject,
  lines: string[],
  options: { objectCounts: Map<MatchedCrmObject["objectType"], number>; primaryTarget: ReturnType<typeof pickPrimaryTarget> }
) {
  const groups = new Map<MeetingProposalFactCategory, { category: MeetingProposalFactCategory; lines: string[] }>();
  for (const item of noteFactItems(match, lines, options)) {
    const existing = groups.get(item.category) ?? { category: item.category, lines: [] };
    existing.lines.push(item.line);
    groups.set(item.category, existing);
  }
  return Array.from(groups.values());
}

function noteFactItems(
  match: MatchedCrmObject,
  lines: string[],
  options: { objectCounts: Map<MatchedCrmObject["objectType"], number>; primaryTarget: ReturnType<typeof pickPrimaryTarget> }
) {
  const pattern = factPatternForObject(match.objectType);
  const items: Array<{ category: MeetingProposalFactCategory; line: string }> = [];
  for (const line of lines
    .filter((line) => !isMeetingMetadataLine(line))
    .filter((line) => !protectedTraitPattern.test(line))
    .filter((line) => pattern.test(line))
    .filter((line) => lineBelongsToMatch(line, match, options))) {
    const category = classifyLineForMatch(line, match);
    const summarized = summarizeFactLine(line, { category, match });
    if (!summarized) continue;
    items.push({ category, line: summarized });
    if (items.length >= 8) break;
  }
  return items;
}

function noteKind(
  objectType: MatchedCrmObject["objectType"],
  factLines: string[],
  category: MeetingProposalFactCategory
) {
  if (category === "stakeholderNote") return "stakeholder_note" as const;
  if (objectType === "person" && category === "personFact") return "personal_fact" as const;
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
      : kind === "stakeholder_note"
        ? "Meeting intelligence stakeholder notes"
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
  if (objectType === "person") return new RegExp(`${personalFactPattern.source}|${stakeholderPattern.source}|${communicationStylePattern.source}|${businessConcernPattern.source}`, "i");
  if (objectType === "organization") return companyFactPattern;
  if (objectType === "lead") return new RegExp(`${dealFactPattern.source}|${leadFactPattern.source}`, "i");
  return dealFactPattern;
}

function lineBelongsToMatch(
  line: string,
  match: MatchedCrmObject,
  options: { objectCounts: Map<MatchedCrmObject["objectType"], number>; primaryTarget: ReturnType<typeof pickPrimaryTarget> }
) {
  const category = classifyLineForMatch(line, match);
  if (match.objectType === "person" && category !== "personFact" && category !== "stakeholderNote") return false;
  if (match.objectType === "organization" && category !== "organizationFact" && category !== "stakeholderNote") return false;
  if ((match.objectType === "deal" || match.objectType === "lead") && category !== "dealFact" && category !== "stakeholderNote") {
    return false;
  }
  if (lineMentionsMatch(line, match)) return true;
  if ((match.objectType === "deal" || match.objectType === "lead") && companyFactPattern.test(line)) return false;
  if (sameTarget(targetFromMatch(match), options.primaryTarget)) return true;
  return (options.objectCounts.get(match.objectType) ?? 0) === 1;
}

function classifyLineForMatch(line: string, match?: MatchedCrmObject): MeetingProposalFactCategory {
  const cleaned = line.replace(/^[-*]\s*/, "").trim();
  const content = speakerContentForClassification(cleaned, match);
  if (!content) return "ambiguousNeedsReview";
  if (actionLinePattern.test(content)) return "followUpAction";

  const hasStakeholder = stakeholderPattern.test(content);
  const hasCompany = companyFactPattern.test(content);
  const hasDeal = dealFactPattern.test(content) || leadFactPattern.test(content);
  const hasPersonal = personalFactPattern.test(content) || communicationStylePattern.test(content) || relationshipReminderPattern.test(content);
  const hasContactConcern = contactConcernPattern(content, cleaned, match);

  if (hasStakeholder) return "stakeholderNote";
  if ((hasPersonal || hasContactConcern) && !hasCompany && !hasDeal) return "personFact";
  if (hasContactConcern && match?.objectType === "person") return "personFact";
  if (hasCompany) return "organizationFact";
  if (hasDeal) return "dealFact";
  if (businessConcernPattern.test(content)) return match?.objectType === "person" ? "personFact" : "dealFact";
  return "ambiguousNeedsReview";
}

function speakerContentForClassification(line: string, match?: MatchedCrmObject) {
  const speaker = line.match(rawSpeakerPrefixPattern);
  if (!speaker) return line;
  if (match && lineMentionsMatch(speaker[1], match)) return speaker[2].trim();
  return line;
}

function contactConcernPattern(content: string, fullLine: string, match?: MatchedCrmObject) {
  if (!businessConcernPattern.test(content)) return false;
  if (/\b(?:is|was|seems|sounds|feels|felt)\s+(?:concerned|worried)\b/i.test(content)) return true;
  return Boolean(match && lineMentionsMatch(fullLine, match) && match.objectType === "person" && /\bconcerned|worried|worry\b/i.test(content));
}

function summarizeFactLine(
  line: string,
  options: { category: MeetingProposalFactCategory; match?: MatchedCrmObject }
) {
  const cleaned = line
    .replace(/^[-*]\s*/, "")
    .replace(/^(decision|risk|note|fact|summary)\s*:\s*/i, "")
    .trim();
  const speaker = cleaned.match(rawSpeakerPrefixPattern);
  if (speaker) {
    const speakerName = speaker[1].trim();
    const content = speaker[2].trim();
    if (options.match && lineMentionsMatch(speakerName, options.match)) {
      return truncateFact(`${options.match.displayName} mentioned ${quoteToThirdPerson(content)}.`);
    }
    return truncateFact(`${speakerName} mentioned ${lowercaseFirst(content)}.`);
  }
  if (options.category === "followUpAction") {
    return truncateFact(cleaned.replace(/^(action|action item|todo|to do|next step|follow[- ]?up)\s*:\s*/i, ""));
  }
  return truncateFact(cleaned);
}

function quoteToThirdPerson(value: string) {
  return lowercaseFirst(value)
    .replace(/^i am\b/i, "they are")
    .replace(/^i'm\b/i, "they are")
    .replace(/^i will\b/i, "they will")
    .replace(/^i\b/i, "they")
    .replace(/\bmy\b/gi, "their")
    .replace(/\bme\b/gi, "them");
}

function lowercaseFirst(value: string) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function truncateFact(value: string) {
  const normalized = value.replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
  return normalized.length > 260 ? `${normalized.slice(0, 257)}...` : normalized;
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
