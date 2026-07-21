import { extractSections } from "./markdown-normalizer";
import { targetFromMatch } from "./match-records";
import type {
  MatchedCrmObject,
  MeetingProposalFactCategory,
  MeetingIntelligenceDraft,
  MeetingAssociationReview,
  MeetingSummarySection,
  MeetingSourceMetadata,
  TranscriptSegment,
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
const decisionPattern = /\b(decision|decided|approved|selected|confirmed|agreed to|signed off|go forward|move forward)\b/i;
const commitmentPattern = /\b(committed|commitment|promised|confirmed|will|agreed to|by\s+(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2}|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const openQuestionPattern = /\b(open question|question|confirm whether|needs clarification|who owns|unclear|tbd|to be confirmed)\b/i;
const titleTopicPattern = /\b(?:about|for|on|regarding|review(?:ed|ing)?|discuss(?:ed|ing)?|focused on|goal:?|objective:?|agenda:?)\s+([^.;\n]{8,90})/i;
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
  const meetingDate = parseMeetingDate(input.contextText ?? text);
  const participants = parseParticipants(`${input.contextText ?? ""}\n${text}`);
  const transcriptSegments = buildTranscriptSegments(text, input.sourceMetadata);
  const summarySections = buildStructuredSummary(lines, sections, { meetingDate, participants });
  const summary = buildSummary(summarySections, lines);
  const actionItems = extractActionCandidates(lines, sections.actionItems);
  const warnings = buildWarnings(input.matchedObjects, input.unmatchedEntities, actionItems, lines, meetingDate);
  const primaryTarget = pickPrimaryTarget(input.matchedObjects);
  const primaryMatch = primaryTarget ? input.matchedObjects.find((match) => match.id === primaryTarget.id && match.objectType === primaryTarget.type) : undefined;
  const associatedTargets = buildAssociatedTargets(input.matchedObjects);
  const meetingActivity = primaryTarget
    ? {
        associatedTargets,
        confidence: primaryMatch?.confidence,
        completedAt: meetingDate?.toISOString() ?? new Date().toISOString(),
        description: [
          "Structured meeting summary:",
          ...summarySections.flatMap((section) => [
            `${section.title}:`,
            ...section.items.map((item) => `- ${item}`)
          ]),
          "",
          "Associated CRM records:",
          ...associatedTargets.map((target) => `- ${targetTypeLabel(target.type)}: ${target.label ?? target.id}`),
          "",
          "Source attribution: Meeting Intelligence reviewed intake."
        ].join("\n"),
        evidence: lines.slice(0, 3),
        include: true,
        matchedReason: primaryMatch?.matchedReason,
        target: primaryTarget,
        targetWarning: primaryMatch?.warning,
        title: buildMeetingTitle(`${input.contextText ?? ""}\n${text}`, primaryTarget.label ?? "CRM record", summarySections)
      }
    : null;

  return {
    associationReviews: buildAssociationReviews(input.matchedObjects, input.unmatchedEntities),
    markdown: text,
    matchedObjects: input.matchedObjects,
    meetingActivity,
    notes: buildNotes(input.matchedObjects, primaryTarget, summary, lines, { meetingDate, participants }),
    nextStepActivities: buildNextSteps(input.matchedObjects, actionItems, meetingDate),
    relationshipBriefUpdates: buildRelationshipBriefUpdates(input.matchedObjects, lines),
    sourceMetadata: input.sourceMetadata,
    summary,
    summarySections,
    transcriptSegments,
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

function buildNotes(
  matches: MatchedCrmObject[],
  primaryTarget: ReturnType<typeof pickPrimaryTarget>,
  summary: string,
  lines: string[],
  context: { meetingDate?: Date; participants: string[] }
) {
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
      `Source: Meeting Intelligence reviewed intake${context.meetingDate ? ` (${context.meetingDate.toISOString().slice(0, 10)})` : ""}.`,
      context.participants.length > 0 ? `Participants: ${context.participants.join(", ")}` : null,
      "",
      "Summary:",
      noteSummary,
      factLines.length > 0 ? "" : null,
      factLines.length > 0 ? "Facts to save:" : null,
      ...factLines.map((line) => `- ${line}`),
      "",
      "Evidence:",
      ...uniqueNormalizedLines([match.evidenceExcerpt, ...factLines]).slice(0, 3).map((line) => `- ${line}`)
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
      .trim();
    notes.push({
      body,
      category,
      confidence: match.confidence,
      evidence: [match.evidenceExcerpt, ...factLines].filter(Boolean).slice(0, 4),
      id: `note-${match.objectType}-${match.id}-${category}`,
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

function buildNextSteps(matches: MatchedCrmObject[], actionItems: string[], meetingDate?: Date) {
  const target = pickPrimaryTarget(matches);
  if (!target) return [];
  const match = matches.find((candidate) => candidate.id === target.id && candidate.objectType === target.type);
  const associatedTargets = buildAssociatedTargets(matches);
  const deduped = dedupeActionItems(actionItems.filter(isActionableNextStep)).slice(0, 6);
  return deduped.map((item, index) => {
    const dueAt = parseDueDate(item, meetingDate);
    const ownerHint = parseOwnerHint(item);
    const title = actionTitle(item);
    return {
      category: "followUpAction" as const,
      confidence: match?.confidence,
      description: [
        `Action evidence: ${cleanActionEvidence(item)}`,
        ownerHint ? `Owner hint: ${ownerHint}` : "",
        dueAt ? `Due date supported by source: ${dueAt.toISOString().slice(0, 10)}` : "Due date not stated clearly; reviewer should set one if needed.",
        associatedTargets.length > 1
          ? `Related records: ${associatedTargets.map((related) => `${targetTypeLabel(related.type)}: ${related.label ?? related.id}`).join("; ")}`
          : ""
      ]
        .filter(Boolean)
        .join("\n"),
      dueAt: dueAt?.toISOString(),
      evidence: [item],
      id: `next-step-${stableActionId(item, index)}`,
      include: true,
      matchedReason: match?.matchedReason,
      ownerId: null,
      target,
      targetWarning: match?.warning,
      title,
      type: inferActivityType(title)
    };
  });
}

function buildWarnings(
  matches: MatchedCrmObject[],
  unmatched: UnmatchedEntity[],
  actionItems: string[],
  lines: string[],
  meetingDate?: Date
) {
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
  if (actionItems.some((item) => !parseDueDate(item, meetingDate))) warnings.add("Some next steps do not include a clear due date.");
  if (lines.some((line) => /^(?:-\s*)?Transcription confidence:\s*low\b/i.test(line))) {
    warnings.add("Transcription confidence is low. Review speaker labels and source snippets before applying CRM updates.");
  }
  if (matches.length > 0 && lines.some((line) => protectedTraitPattern.test(line))) {
    warnings.add("Protected or sensitive trait details were excluded from curated Relationship Brief and fact-note suggestions.");
  }
  return Array.from(warnings);
}

function buildAssociationReviews(matches: MatchedCrmObject[], unmatched: UnmatchedEntity[]): MeetingAssociationReview[] {
  return [
    ...matches.map((match) => ({
      confidence: match.confidence,
      evidence: match.evidenceExcerpt,
      id: `matched-${match.objectType}-${match.id}`,
      matchedReason: match.matchedReason,
      mention: match.displayName,
      originalTarget: targetFromMatch(match),
      resolutionStatus: match.confidence === "ambiguous" || match.confidence === "low" ? "ambiguous" as const : "confirmed" as const,
      selectedTarget: match.confidence === "ambiguous" || match.confidence === "low" ? null : targetFromMatch(match),
      targetType: match.objectType,
      warning: match.warning
    })),
    ...unmatched.map((entity, index) => ({
      confidence: "unmatched" as const,
      evidence: entity.evidenceExcerpt,
      id: `unmatched-${entity.entityType}-${index + 1}`,
      matchedReason: entity.reason,
      mention: entity.name,
      originalTarget: null,
      resolutionStatus: "unmatched" as const,
      selectedTarget: null,
      targetType: associationTargetType(entity.entityType),
      warning: "No CRM record is selected for this mention."
    }))
  ];
}

function associationTargetType(entityType: UnmatchedEntity["entityType"]): MeetingAssociationReview["targetType"] {
  return entityType === "person" || entityType === "organization" ? entityType : "unknown";
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

function buildSummary(summarySections: MeetingSummarySection[], lines: string[]) {
  const overview = summarySections.find((section) => section.key === "context");
  if (overview?.items.length) return overview.items.join(" ").slice(0, 700);
  const candidates = lines
    .filter((line) => !isMeetingMetadataLine(line))
    .filter((line) => !isStructuralMeetingLine(line))
    .filter((line) => !protectedTraitPattern.test(line))
    .slice(0, 4);
  if (candidates.length === 0) return "Meeting notes were captured for CRM review.";
  return candidates.join(" ").slice(0, 700);
}

function buildStructuredSummary(
  lines: string[],
  sections: ReturnType<typeof extractSections>,
  context: { meetingDate?: Date; participants: string[] }
): MeetingSummarySection[] {
  const safeLines = uniqueNormalizedLines(lines)
    .filter((line) => !isMeetingMetadataLine(line))
    .filter((line) => !protectedTraitPattern.test(line));
  const nextSteps = dedupeActionItems(extractActionCandidates(safeLines, sections.actionItems).filter(isActionableNextStep)).map(cleanSummaryItem).slice(0, 5);
  const decisionItems = uniqueNormalizedLines([
    ...sections.decisions,
    ...safeLines.filter((line) => decisionPattern.test(line) && !lineLooksLikeAction(line))
  ].map(cleanSummaryItem)).slice(0, 5);
  const concerns = uniqueNormalizedLines([
    ...sections.risks,
    ...safeLines.filter((line) => (businessConcernPattern.test(line) || /\b(blocker|blocked|concern|risk|worried|challenge|issue)\b/i.test(line)) && !lineLooksLikeAction(line))
  ].map(cleanSummaryItem))
    .filter((item) => !decisionItems.includes(item))
    .slice(0, 5);
  const openQuestions = uniqueNormalizedLines([
    ...sections.openQuestions,
    ...safeLines.filter((line) => openQuestionPattern.test(line) || /\?\s*$/.test(line))
  ].map(cleanSummaryItem)).slice(0, 5);
  const commitments = summaryLinesMatching(safeLines, commitmentPattern)
    .filter((item) => !nextSteps.includes(item))
    .filter((item) => !openQuestions.includes(item))
    .slice(0, 5);
  const keyFacts = safeLines
    .filter((line) => !isStructuralMeetingLine(line))
    .filter((line) => !lineLooksLikeAction(line))
    .filter((line) => !lineLooksLikeImplicitAction(line))
    .filter((line) => !stakeholderPattern.test(line))
    .filter((line) => !personalFactPattern.test(line) && !communicationStylePattern.test(line) && !relationshipReminderPattern.test(line))
    .map(cleanSummaryItem)
    .filter(Boolean)
    .filter((item) => !decisionItems.includes(item))
    .filter((item) => !concerns.includes(item))
    .filter((item) => !openQuestions.includes(item))
    .filter((item) => !commitments.includes(item))
    .slice(0, 5);
  const overview = buildContextItems(safeLines, context);
  return [
    summarySection("context", "Context", overview, "inferred"),
    summarySection("participants", "Participants", context.participants, "explicit"),
    summarySection("key_facts", "Key facts", keyFacts, "explicit"),
    summarySection("decisions", "Decisions", decisionItems, "explicit"),
    summarySection("concerns_or_risks", "Concerns or risks", concerns, "explicit"),
    summarySection("commitments", "Commitments", commitments, "explicit"),
    summarySection("open_questions", "Open questions", openQuestions, "explicit"),
    summarySection("next_steps", "Next steps", nextSteps, "explicit")
  ].filter((section) => section.items.length > 0);
}

function buildTranscriptSegments(markdown: string, metadata?: MeetingSourceMetadata): TranscriptSegment[] {
  const confidence = metadata?.transcriptionConfidence;
  const warnings = [
    ...(confidence === "low" ? ["Low transcription confidence. Verify this segment before using it as CRM evidence."] : []),
    ...(metadata?.warnings?.filter((warning) => /confidence|speaker|transcript|audio|ocr/i.test(warning)) ?? [])
  ].slice(0, 3);
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isMeetingMetadataLine(line))
    .filter((line) => !/^#+\s/.test(line));
  const segments: TranscriptSegment[] = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s*/, "").trim();
    const timestamped = cleaned.match(/^\[?(?<time>\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:[-–]\s*)?(?:(?<speaker>[A-Z][A-Za-z0-9 .'-]{1,60}):\s*)?(?<text>.+)$/);
    const speakerOnly = cleaned.match(/^(?<speaker>[A-Z][A-Za-z0-9 .'-]{1,60}):\s*(?<text>.+)$/);
    const parsed = timestamped?.groups
      ? { speaker: timestamped.groups.speaker, startTime: timestamped.groups.time, text: timestamped.groups.text }
      : speakerOnly?.groups
        ? { speaker: speakerOnly.groups.speaker, startTime: undefined, text: speakerOnly.groups.text }
        : { speaker: undefined, startTime: undefined, text: cleaned };
    if (!parsed.text || isStructuralMeetingLine(parsed.text)) continue;
    segments.push({
      confidence,
      id: `segment-${segments.length + 1}`,
      speaker: parsed.speaker?.trim(),
      startTime: parsed.startTime,
      text: parsed.text.trim().slice(0, 1000),
      warnings: warnings.length > 0 ? warnings : undefined
    });
    if (segments.length >= 120) break;
  }
  return segments;
}

function summarySection(
  key: MeetingSummarySection["key"],
  title: string,
  items: string[],
  evidenceType: MeetingSummarySection["evidenceType"]
): MeetingSummarySection {
  return {
    evidenceType,
    items: uniqueNormalizedLines(items.map(cleanSummaryItem)).filter(Boolean).slice(0, 5),
    key,
    title
  };
}

function buildContextItems(lines: string[], context: { meetingDate?: Date; participants: string[] }) {
  const first = lines
    .filter((line) => !isStructuralMeetingLine(line))
    .filter((line) => !lineLooksLikeAction(line))
    .map(cleanSummaryItem)
    .find(Boolean);
  const pieces = [
    context.meetingDate ? `Meeting date: ${context.meetingDate.toISOString().slice(0, 10)}.` : "",
    context.participants.length > 0 ? `Participants: ${context.participants.join(", ")}.` : "",
    first ?? "Meeting notes were captured for CRM review."
  ].filter(Boolean);
  return [pieces.join(" ")];
}

function summaryLinesMatching(lines: string[], pattern: RegExp) {
  return uniqueNormalizedLines(
    lines
      .filter((line) => pattern.test(line))
      .filter((line) => !lineLooksLikeAction(line))
      .map(cleanSummaryItem)
  ).slice(0, 5);
}

function cleanSummaryItem(value: string) {
  return value
    .replace(/^[-*]\s*/, "")
    .replace(/^(decision|risk|concern|blocker|open question|question|objective|goal|summary|note|action item|action|next step|follow[- ]?up)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function buildMeetingTitle(text: string, targetLabel: string, summarySections: MeetingSummarySection[] = []) {
  const date = parseMeetingDate(text);
  const topic = extractMeetingTopic(text, summarySections);
  const datePrefix = date ? `${date.toISOString().slice(0, 10)} - ` : "";
  const base = topic ? `${topic} with ${targetLabel}` : `Meeting with ${targetLabel}`;
  return compactTitle(`${datePrefix}${base}`, 120);
}

function actionTitle(item: string) {
  const cleaned = item
    .replace(/^(todo|to do|action item|action|next step|follow[- ]?up)\s*:?\s*/i, "")
    .replace(/\bowner\s*:\s*[^.;\n]+[.;]?\s*/gi, "")
    .replace(/^\s*[A-Z][A-Za-z .'-]{1,60}\s+(?:to|will)\s+/i, "")
    .replace(/^.*?\b(?:needs? to|should|will)\s+(?=send|schedule|share|follow up|call|email|review|prepare|confirm|update|create|draft|provide|book|set up|assign)\b/i, "")
    .replace(/\bby\s+(?:20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2}|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[A-Z][a-z]+\s+\d{1,2}(?:,\s*20\d{2})?)\.?/gi, "")
    .replace(/^\[[ x]\]\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.;,\s]+$/g, "")
    .trim();
  return compactTitle(cleaned ? uppercaseFirst(cleaned) : "Follow up from meeting", 120);
}

function parseDueDate(text: string, meetingDate?: Date): Date | undefined {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return safeDate(`${iso[1]}T00:00:00.000Z`);
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (slash) return safeDate(`${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}T00:00:00.000Z`);
  const baseDate: Date | undefined = meetingDate ?? parseMeetingDate(text);
  const monthDate = text.match(/\b(?:by|on|before|due)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,\s*(20\d{2}))?\b/i);
  if (monthDate) {
    const year = monthDate[3] ?? baseDate?.getUTCFullYear().toString();
    const month = monthIndex(monthDate[1]);
    if (year && month >= 0) return safeDate(`${year}-${String(month + 1).padStart(2, "0")}-${monthDate[2].padStart(2, "0")}T00:00:00.000Z`);
  }
  if (!baseDate) return undefined;
  const shortSlash = text.match(/\b(?:by|on|before|due)\s+(\d{1,2})\/(\d{1,2})\b/i);
  if (shortSlash) {
    return safeDate(`${baseDate.getUTCFullYear()}-${shortSlash[1].padStart(2, "0")}-${shortSlash[2].padStart(2, "0")}T00:00:00.000Z`);
  }
  if (/\b(?:by|due|on)\s+tomorrow\b/i.test(text)) return addDays(baseDate, 1);
  if (/\b(?:by|due)\s+next week\b/i.test(text)) return addDays(baseDate, 7);
  const weekday = text.match(/\b(?:by|on|before|due)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) return nextWeekday(baseDate, weekday[1]);
  return undefined;
}

function parseParticipants(text: string) {
  const line = text.split("\n").find((candidate) => /^(attendees|participants)\s*:/i.test(candidate.trim()));
  if (!line) return [];
  return uniqueNormalizedLines(
    line
      .replace(/^(attendees|participants)\s*:\s*/i, "")
      .split(/[,;]|\band\b/i)
      .map((item) => item.trim())
      .filter(Boolean)
  ).slice(0, 12);
}

function dedupeActionItems(items: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of items) {
    const key = actionDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function extractActionCandidates(lines: string[], sectionActionItems: string[]) {
  return uniqueNormalizedLines([
    ...sectionActionItems,
    ...lines.filter((line) => lineLooksLikeAction(line) || lineLooksLikeImplicitAction(line))
  ]);
}

function actionDedupeKey(item: string) {
  return actionTitle(item)
    .replace(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/20\d{2})\b/g, "")
    .replace(/\bby\s+(tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\bowner\s*:\s*[^.;\n]+[.;]?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stableActionId(item: string, index: number) {
  const slug = actionDedupeKey(item)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || String(index + 1);
}

function cleanActionEvidence(item: string) {
  return item
    .replace(/^(todo|to do|action item|action|next step|follow[- ]?up)\s*:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferActivityType(title: string): "CALL" | "EMAIL" | "MEETING" | "TASK" {
  if (/\b(call|phone)\b/i.test(title)) return "CALL";
  if (/\b(email|send|share|forward)\b/i.test(title)) return "EMAIL";
  if (/\b(meeting|workshop|demo|session|schedule|book|set up)\b/i.test(title)) return "MEETING";
  return "TASK";
}

function isActionableNextStep(item: string) {
  if (/^(decision|risk|concern|blocker|open question|question|note|summary)\s*:/i.test(item.replace(/^[-*]\s*/, "").trim())) return false;
  const cleaned = actionTitle(item);
  if (!cleaned) return false;
  if (/\b(maybe|possibly|consider|think about|explore whether|discuss options|nice to have)\b/i.test(cleaned)) return false;
  return /\b(send|schedule|share|follow up|follow-up|call|email|review|prepare|confirm|update|create|draft|provide|book|set up|assign)\b/i.test(cleaned);
}

function lineLooksLikeAction(line: string) {
  return actionLinePattern.test(line) || /^next step\s*:/i.test(line);
}

function lineLooksLikeImplicitAction(line: string) {
  const cleaned = line.replace(/^[-*]\s*/, "").trim();
  if (/^(decision|risk|open question|question|note|summary)\s*:/i.test(cleaned)) return false;
  if (/\b(maybe|possibly|consider|think about|explore whether|nice to have)\b/i.test(cleaned)) return false;
  if (/^[A-Z][A-Za-z .'-]{1,60}\s+(?:to|will)\s+(send|schedule|share|follow up|call|email|review|prepare|confirm|update|create|draft|provide|book|set up|assign)\b/i.test(cleaned)) return true;
  return /\b(?:needs? to|should|will)\s+(send|schedule|share|follow up|call|email|review|prepare|confirm|update|create|draft|provide|book|set up|assign)\b/i.test(cleaned);
}

function isStructuralMeetingLine(line: string) {
  return /^#|^(attendees|participants|meeting date|date|source type|original file|mime type|extracted words|extraction method|conversion|processor|provider|warning):/i.test(
    line.replace(/^[-*]\s*/, "").trim()
  );
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
  return text.match(/\bowner\s*:\s*([^.;\n]+)/i)?.[1]?.trim()
    ?? text.match(/^(?:action|action item|todo|to do|next step|follow[- ]?up)\s*:\s*([A-Z][A-Za-z .'-]{1,60})\s+(?:to|will)\s+/i)?.[1]?.trim()
    ?? text.match(/^([A-Z][A-Za-z .'-]{1,60})\s+(?:to|will)\s+/i)?.[1]?.trim();
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

function monthIndex(value: string) {
  return [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december"
  ].indexOf(value.toLowerCase());
}

function extractMeetingTopic(text: string, summarySections: MeetingSummarySection[]) {
  const contextItem = summarySections.find((section) => section.key === "key_facts")?.items[0] ??
    summarySections.find((section) => section.key === "context")?.items[0];
  const explicit = [text, contextItem ?? ""].join("\n").match(titleTopicPattern)?.[1];
  const candidate = explicit ?? contextItem;
  if (!candidate) return null;
  return compactTitle(
    candidate
      .replace(/\bmeeting date:\s*20\d{2}-\d{2}-\d{2}\.?\s*/i, "")
      .replace(/\bparticipants?:[^.]+\.?\s*/i, "")
      .replace(/^(decision|risk|open question|question|objective|goal|summary|note)\s*:\s*/i, "")
      .replace(/\b(meeting|call|discussion)\b/gi, "")
      .trim(),
    64
  ) || null;
}

function compactTitle(value: string, maxLength: number) {
  const compacted = value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[.;,\s]+$/g, "")
    .trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength - 3).replace(/\s+\S*$/, "")}...`;
}

function uppercaseFirst(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function meaningfulLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && line.length < 500);
}
