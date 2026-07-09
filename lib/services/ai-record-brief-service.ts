import type { AiPreferences } from "./ai-preferences-service";
import type {
  NorthstarAssistantContext,
  NorthstarAssistantFinding,
  NorthstarAssistantInsight,
  NorthstarAssistantSeverity
} from "./northstar-ai-service";

export type AiRecordHealthStatus = "attention" | "clean" | "stale" | "watch";

export type AiRecordHealthInsight = {
  confidence: "high" | "low" | "medium";
  evidence: string[];
  label: string;
  status: AiRecordHealthStatus;
  summary: string;
};

export type AiRecordBrief = {
  about: string;
  confidence: "high" | "low" | "medium";
  generatedAt: string;
  health: AiRecordHealthInsight;
  keyFacts: AiRecordBriefFact[];
  missingOrStale: string[];
  missingContext: string[];
  nextBestReview: string;
  nextActions: AiRecordBriefAction[];
  omittedOrNeedsReview: string[];
  recordLabel: string;
  reviewFirst: true;
  sourceBasis: string[];
  sourcesUsed: string[];
  title: string;
  risks: AiRecordBriefFact[];
  whatChanged: string[];
};

export type AiRecordBriefFact = {
  label: string;
  source: AiRecordBriefSourceLabel;
  sourceRef?: AiRecordBriefSourceRef;
  value: string;
};

export type AiRecordBriefAction = {
  label: string;
  source: AiRecordBriefSourceLabel;
  sourceRef?: AiRecordBriefSourceRef;
  value: string;
};

export type AiRecordBriefSourceLabel =
  | "Activities"
  | "Deal record"
  | "Email logs"
  | "Linked deals"
  | "Linked people"
  | "Meeting Intelligence"
  | "Notes"
  | "Organization record"
  | "Person fields"
  | "Relationship Memory";

export type AiRecordBriefSourceRef = {
  detail?: string;
  excerpt?: string;
  href?: string;
  label: string;
  occurredAt?: string;
  recordId?: string;
  targetRecordId?: string;
  type: AiRecordBriefSourceRefType;
  warning?: string;
};

export type AiRecordBriefSourceRefType =
  | "activity"
  | "current_record"
  | "email_log"
  | "linked_record_summary"
  | "meeting_intelligence"
  | "note"
  | "relationship_memory"
  | "source_summary";

export function buildAiRecordBrief(
  context: NorthstarAssistantContext,
  insight: NorthstarAssistantInsight,
  preferences?: AiPreferences
): AiRecordBrief {
  const recordLabel = context.record?.label ?? surfaceLabel(context.surface);
  const health = buildRecordHealthInsight(context, insight.findings);
  const maxItems = preferences?.recordSummaryStyle === "detailed" ? 5 : preferences?.recordSummaryStyle === "concise" ? 2 : 3;
  const attributed = buildSourceAttributedBrief(context, insight, maxItems);
  const missingOrStale = insight.findings
    .filter((finding) => finding.severity === "attention" || finding.severity === "warning")
    .map((finding) => finding.title)
    .slice(0, maxItems);
  const primaryAction = insight.suggestedActions[0];

  return {
    about: recordAbout(context, maxItems),
    confidence: insight.confidence,
    generatedAt: context.generatedAt,
    health,
    keyFacts: attributed.keyFacts,
    missingOrStale,
    missingContext: attributed.missingContext,
    nextBestReview: primaryAction
      ? `${primaryAction.label}: ${primaryAction.reason}`
      : "Review the source CRM context before deciding whether anything should change.",
    nextActions: attributed.nextActions,
    omittedOrNeedsReview: attributed.omittedOrNeedsReview,
    recordLabel,
    reviewFirst: true,
    sourceBasis: attributed.sourcesUsed,
    sourcesUsed: attributed.sourcesUsed,
    title: `AI brief for ${recordLabel}`,
    risks: attributed.risks,
    whatChanged: whatChanged(context).slice(0, maxItems)
  };
}

export function buildRecordHealthInsight(
  context: NorthstarAssistantContext,
  findings: NorthstarAssistantFinding[] = []
): AiRecordHealthInsight {
  const attention = findings.filter((finding) => finding.severity === "attention");
  const warnings = findings.filter((finding) => finding.severity === "warning");
  const evidence = [...attention, ...warnings].flatMap((finding) => finding.evidence.length > 0 ? finding.evidence : [finding.detail]).slice(0, 4);

  if (attention.length > 0) {
    return {
      confidence: "high",
      evidence,
      label: "Needs review",
      status: "attention",
      summary: `${attention[0].title}. Review the source context before applying any update.`
    };
  }
  if (warnings.length > 0) {
    return {
      confidence: "medium",
      evidence,
      label: "Watch",
      status: "watch",
      summary: `${warnings[0].title}. Nothing changes automatically.`
    };
  }

  const openActivities = context.related.activities.filter((activity) => !activity.completedAt);
  if (context.record && openActivities.length === 0 && context.record.type !== "lead") {
    return {
      confidence: "medium",
      evidence: ["No open follow-up in the reviewed context."],
      label: "Stale risk",
      status: "stale",
      summary: "No clear next activity is visible in the reviewed context."
    };
  }

  return {
    confidence: "medium",
    evidence: context.lookedAt.slice(0, 3),
    label: "Clean",
    status: "clean",
    summary: "No obvious link, follow-up, or placement issue was found in the reviewed context."
  };
}

function buildSourceAttributedBrief(
  context: NorthstarAssistantContext,
  insight: NorthstarAssistantInsight,
  maxItems: number
) {
  const factLimit = Math.max(maxItems + 3, 5);
  const keyFacts = keyFactsForRecord(context, factLimit);
  const risks = insight.findings
    .filter((finding) => finding.severity === "attention" || finding.severity === "warning")
    .flatMap((finding): AiRecordBriefFact[] => {
      const value = briefSafeText(finding.evidence[0] ?? finding.detail);
      const source = sourceForFinding(finding);
      return value ? [{ label: finding.title, source, sourceRef: sourceRefForFinding(context, finding, source, value), value }] : [];
    })
    .slice(0, maxItems);
  const nextActions = insight.suggestedActions.flatMap((action): AiRecordBriefAction[] => {
    const value = briefSafeText(action.reason);
    if (!value) return [];
    const source = sourceForAction(context, action);
    return [{
      label: action.label,
      source,
      sourceRef: sourceRefForAction(context, action, source, value),
      value
    }];
  }).slice(0, maxItems);
  const missingContext = missingContextForRecord(context).slice(0, maxItems + 1);
  const omittedOrNeedsReview = omittedOrNeedsReviewForRecord(context).slice(0, maxItems);
  const sourcesUsed = sourceLabelsForRecord(context, keyFacts, risks);

  return {
    keyFacts,
    missingContext,
    nextActions,
    omittedOrNeedsReview,
    risks,
    sourcesUsed
  };
}

function keyFactsForRecord(context: NorthstarAssistantContext, maxItems: number): AiRecordBriefFact[] {
  if (context.surface === "meeting_intelligence") return meetingIntelligenceKeyFacts(context, maxItems);
  if (!context.record) return [];
  if (context.record.type === "contact") return contactKeyFacts(context, maxItems);
  if (context.record.type === "organization") return organizationKeyFacts(context, maxItems);
  if (context.record.type === "deal") return dealKeyFacts(context, maxItems);
  if (context.record.type === "lead") return leadKeyFacts(context, maxItems);
  return [];
}

function contactKeyFacts(context: NorthstarAssistantContext, maxItems: number) {
  const linkedDealFacts = linkedDealSourceRecords(context).length > 0
    ? linkedDealSourceRecords(context).slice(0, 2).map((record): AiRecordBriefFact => ({
        label: "Linked deal context",
        source: "Linked deals",
        sourceRef: linkedRecordSourceRef(record),
        value: `Linked deal: ${record.label}${record.status ? ` (${record.status})` : ""}`
      }))
    : context.related.proposalSummaries.slice(0, 2).flatMap((summary): AiRecordBriefFact[] => {
        const value = briefSafeText(summary);
        return value ? [{ label: "Linked deal context", source: "Linked deals", sourceRef: summarySourceRef("Linked deal summary", value, "linked_record_summary"), value }] : [];
      });

  return [
    ...context.related.relationshipFacts.flatMap((fact): AiRecordBriefFact[] => {
      const value = briefSafeText(fact.value);
      return value ? [{ label: fact.label, source: "Relationship Memory", sourceRef: relationshipMemorySourceRef(context, fact, value), value }] : [];
    }),
    ...context.related.notes.flatMap((note, index): AiRecordBriefFact[] => {
      const value = briefSafeText(note.body);
      return value ? [{ label: index === 0 ? "Recent contact note" : "Contact note", source: "Notes", sourceRef: noteSourceRef(note, value), value }] : [];
    }),
    ...context.related.activities.flatMap((activity): AiRecordBriefFact[] =>
      activity.completedAt ? [] : [{ label: "Open follow-up", source: "Activities", sourceRef: activitySourceRef(activity), value: activityLabel(activity) }]
    ),
    ...context.related.emails.slice(0, 1).map((email): AiRecordBriefFact => ({
      label: "Recent stored email",
      source: "Email logs",
      sourceRef: emailSourceRef(email),
      value: `${email.direction.toLowerCase()} stored email reviewed`
    })),
    ...linkedDealFacts
  ].slice(0, maxItems);
}

function organizationKeyFacts(context: NorthstarAssistantContext, maxItems: number) {
  return [
    ...context.related.proposalSummaries.flatMap((summary): AiRecordBriefFact[] => {
      const value = briefSafeText(summary);
      return value ? [{ label: organizationSummaryLabel(summary), source: "Organization record", sourceRef: currentRecordSourceRef(context, "Organization record", value), value }] : [];
    }),
    ...context.related.notes.flatMap((note, index): AiRecordBriefFact[] => {
      const value = briefSafeText(note.body);
      return value ? [{ label: index === 0 ? "Recent organization note" : "Organization note", source: "Notes", sourceRef: noteSourceRef(note, value), value }] : [];
    }),
    ...context.related.activities.flatMap((activity): AiRecordBriefFact[] =>
      activity.completedAt ? [] : [{ label: "Open organization follow-up", source: "Activities", sourceRef: activitySourceRef(activity), value: activityLabel(activity) }]
    ),
    ...context.related.emails.slice(0, 1).map((email): AiRecordBriefFact => ({
      label: "Recent stored email",
      source: "Email logs",
      sourceRef: emailSourceRef(email),
      value: `${email.direction.toLowerCase()} stored email reviewed`
    }))
  ].slice(0, maxItems);
}

function dealKeyFacts(context: NorthstarAssistantContext, maxItems: number) {
  return [
    ...context.related.proposalSummaries.flatMap((summary): AiRecordBriefFact[] => {
      const value = briefSafeText(summary);
      return value ? [{ label: dealSummaryLabel(summary), source: "Deal record", sourceRef: currentRecordSourceRef(context, "Deal record", value), value }] : [];
    }),
    ...context.related.notes.flatMap((note, index): AiRecordBriefFact[] => {
      const value = briefSafeText(note.body);
      return value ? [{ label: index === 0 ? "Recent deal note" : "Deal note", source: "Notes", sourceRef: noteSourceRef(note, value), value }] : [];
    }),
    ...context.related.activities.flatMap((activity): AiRecordBriefFact[] =>
      activity.completedAt ? [] : [{ label: "Open deal follow-up", source: "Activities", sourceRef: activitySourceRef(activity), value: activityLabel(activity) }]
    ),
    ...context.related.emails.slice(0, 1).map((email): AiRecordBriefFact => ({
      label: "Recent stored email",
      source: "Email logs",
      sourceRef: emailSourceRef(email),
      value: `${email.direction.toLowerCase()} stored email reviewed`
    }))
  ].slice(0, maxItems);
}

function leadKeyFacts(context: NorthstarAssistantContext, maxItems: number) {
  return [
    ...context.related.proposalSummaries.flatMap((summary): AiRecordBriefFact[] => {
      const value = briefSafeText(summary);
      return value ? [{ label: "Lead context", source: "Deal record", sourceRef: currentRecordSourceRef(context, "Lead record", value), value }] : [];
    }),
    ...context.related.notes.flatMap((note): AiRecordBriefFact[] => {
      const value = briefSafeText(note.body);
      return value ? [{ label: "Lead note", source: "Notes", sourceRef: noteSourceRef(note, value), value }] : [];
    })
  ].slice(0, maxItems);
}

function meetingIntelligenceKeyFacts(context: NorthstarAssistantContext, maxItems: number) {
  const source = context.related.meetingIntelligenceSources?.[0];
  return context.related.proposalSummaries.flatMap((summary): AiRecordBriefFact[] => {
    const value = briefSafeText(summary);
    return value ? [{
      label: meetingIntelligenceSummaryLabel(summary),
      source: "Meeting Intelligence",
      sourceRef: source ? meetingIntelligenceSourceRef(source, value) : summarySourceRef("Meeting Intelligence proposal", value, "meeting_intelligence"),
      value
    }] : [];
  }).slice(0, maxItems);
}

function missingContextForRecord(context: NorthstarAssistantContext) {
  const openActivities = context.related.activities.filter((activity) => !activity.completedAt);
  const missing: string[] = [];
  if (!context.record) return missing;
  if (openActivities.length === 0 && context.record.type !== "lead") missing.push("No recent activities are scheduled.");
  if (context.related.notes.length === 0) missing.push(recordTypeLabel(context.record.type, "No current-record notes were reviewed."));
  if (context.record.type === "contact") {
    if (context.related.relationshipFacts.length === 0) missing.push("No contact-specific relationship memory has been saved yet.");
    if (context.related.proposalSummaries.length === 0) missing.push("No open deals are linked to this contact.");
  }
  if (context.record.type === "organization") {
    if (!context.related.proposalSummaries.some((summary) => /^Contacts:\s*[1-9]/i.test(summary))) missing.push("No people are linked to this organization.");
    if (!context.related.proposalSummaries.some((summary) => /^Deals:\s*[1-9]/i.test(summary))) missing.push("No active deals are linked to this organization.");
  }
  if (context.record.type === "deal") {
    if (context.related.proposalSummaries.some((summary) => summary === "Customer: not linked")) missing.push("No contact or organization is linked to this deal.");
    if (context.related.emails.length === 0) missing.push("No stored emails are linked to this deal.");
  }
  return missing;
}

function omittedOrNeedsReviewForRecord(context: NorthstarAssistantContext) {
  const omitted: string[] = [];
  if (context.record?.type === "organization" && context.related.relationshipFacts.length > 0) {
    omitted.push("Linked contacts' Relationship Memory was omitted from organization facts; review stakeholders on their contact records.");
  }
  if (context.record?.type === "deal" && context.related.relationshipFacts.length > 0) {
    omitted.push("Linked contact Relationship Memory was omitted from deal facts; use it only as stakeholder context after review.");
  }
  if (context.related.possibleLinks.length > 0) {
    omitted.push("Possible record links are shown as review candidates, not treated as confirmed context.");
  }
  return omitted;
}

function sourceLabelsForRecord(
  context: NorthstarAssistantContext,
  keyFacts: AiRecordBriefFact[],
  risks: AiRecordBriefFact[]
) {
  const labels = new Set<AiRecordBriefSourceLabel>();
  for (const item of [...keyFacts, ...risks]) labels.add(item.source);
  if (context.record?.type === "contact") labels.add("Person fields");
  if (context.record?.type === "organization") labels.add("Organization record");
  if (context.record?.type === "deal") labels.add("Deal record");
  if (context.related.notes.length > 0) labels.add("Notes");
  if (context.related.activities.length > 0) labels.add("Activities");
  if (context.related.emails.length > 0) labels.add("Email logs");
  if (context.related.proposalSummaries.some((summary) => /meeting intelligence/i.test(summary))) labels.add("Meeting Intelligence");
  return Array.from(labels);
}

function sourceForFinding(finding: NorthstarAssistantFinding): AiRecordBriefSourceLabel {
  if (/meeting intelligence|proposal|intake/i.test(`${finding.title} ${finding.detail}`)) return "Meeting Intelligence";
  if (/activity|follow-up|overdue/i.test(`${finding.title} ${finding.detail}`)) return "Activities";
  if (/relationship memory|company facts/i.test(`${finding.title} ${finding.detail}`)) return "Relationship Memory";
  if (/link|customer/i.test(`${finding.title} ${finding.detail}`)) return "Deal record";
  if (/email/i.test(`${finding.title} ${finding.detail}`)) return "Email logs";
  return "Notes";
}

function sourceForAction(
  context: NorthstarAssistantContext,
  action: NorthstarAssistantInsight["suggestedActions"][number]
): AiRecordBriefSourceLabel {
  if (action.kind === "create_activity_proposal" || action.kind === "mark_activity_complete_proposal") return "Activities";
  if (action.kind === "move_fact_proposal") return "Relationship Memory";
  if (action.kind === "reconnect_guidance" || action.kind === "retry_sync_proposal") return "Email logs";
  if (action.kind === "link_record_proposal" || action.kind === "review_record") {
    if (context.record?.type === "contact") return "Person fields";
    if (context.record?.type === "organization") return "Organization record";
    return "Deal record";
  }
  return "Notes";
}

function sourceRefForFinding(
  context: NorthstarAssistantContext,
  finding: NorthstarAssistantFinding,
  source: AiRecordBriefSourceLabel,
  value: string
): AiRecordBriefSourceRef | undefined {
  if (source === "Activities") {
    const openActivity = context.related.activities.find((activity) => !activity.completedAt);
    return openActivity ? activitySourceRef(openActivity) : panelSourceRef("Activities", "#activities", "source_summary", value);
  }
  if (source === "Relationship Memory") {
    const fact = context.related.relationshipFacts[0];
    return fact ? relationshipMemorySourceRef(context, fact, value) : panelSourceRef("Relationship Memory", "#relationship-brief", "relationship_memory", value);
  }
  if (source === "Email logs") {
    const email = context.related.emails[0];
    return email ? emailSourceRef(email) : panelSourceRef("Email logs", "#email-log", "source_summary", value);
  }
  if (source === "Meeting Intelligence") {
    const meetingSource = context.related.meetingIntelligenceSources?.[0];
    return {
      excerpt: sourceExcerpt(value),
      href: meetingIntelligenceHref(context) ?? safeInternalHref("/meeting-intelligence"),
      label: "Meeting Intelligence review",
      recordId: meetingSource?.id,
      type: "meeting_intelligence",
      warning: meetingSource ? undefined : "Exact intake link was not available in this brief context."
    };
  }
  if (source === "Deal record" || source === "Organization record" || source === "Person fields") {
    return currentRecordSourceRef(context, source, value);
  }
  const note = context.related.notes[0];
  return note ? noteSourceRef(note, value) : summarySourceRef(finding.title, value);
}

function sourceRefForAction(
  context: NorthstarAssistantContext,
  action: NorthstarAssistantInsight["suggestedActions"][number],
  source: AiRecordBriefSourceLabel,
  value: string
): AiRecordBriefSourceRef {
  const href = safeInternalHref(action.href);
  if (source === "Activities") {
    return {
      excerpt: sourceExcerpt(value),
      href: href ?? safeInternalHref("#activities"),
      label: "Activities review",
      type: "activity"
    };
  }
  if (source === "Relationship Memory") {
    const fact = context.related.relationshipFacts[0];
    return fact ? relationshipMemorySourceRef(context, fact, value, href) : panelSourceRef("Relationship Memory review", "#relationship-brief", "relationship_memory", value);
  }
  if (source === "Email logs") {
    return {
      excerpt: sourceExcerpt(value),
      href: href ?? safeInternalHref("#email-log"),
      label: action.kind === "reconnect_guidance" ? "Email connection settings" : "Email log review",
      type: "email_log"
    };
  }
  return currentRecordSourceRef(context, source, value, href) ?? summarySourceRef(action.label, value);
}

function noteSourceRef(
  note: NorthstarAssistantContext["related"]["notes"][number],
  value: string
): AiRecordBriefSourceRef {
  return {
    excerpt: sourceExcerpt(value),
    href: safeInternalHref(`#note-${note.id}`) ?? safeInternalHref("#notes"),
    label: note.authorLabel ? `Record note by ${note.authorLabel}` : "Record note",
    occurredAt: note.createdAt,
    recordId: note.id,
    type: "note"
  };
}

function activitySourceRef(activity: NorthstarAssistantContext["related"]["activities"][number]): AiRecordBriefSourceRef {
  return {
    detail: activity.completedAt ? "Completed activity" : "Open activity",
    excerpt: sourceExcerpt(activity.title),
    href: safeInternalHref(`/activities/${activity.id}/edit`),
    label: "Activity record",
    occurredAt: activity.completedAt ?? activity.dueAt ?? undefined,
    recordId: activity.id,
    type: "activity"
  };
}

function emailSourceRef(email: NorthstarAssistantContext["related"]["emails"][number]): AiRecordBriefSourceRef {
  return {
    detail: email.sourceAccountLabel ? `Source account: ${email.sourceAccountLabel}` : undefined,
    excerpt: sourceExcerpt(email.excerpt ?? email.subject),
    href: safeInternalHref(`#email-${email.id}`) ?? safeInternalHref("#email-log"),
    label: "Stored email log",
    occurredAt: email.occurredAt,
    recordId: email.id,
    type: "email_log"
  };
}

function relationshipMemorySourceRef(
  context: NorthstarAssistantContext,
  fact: NorthstarAssistantContext["related"]["relationshipFacts"][number],
  value: string,
  href = "#relationship-brief"
): AiRecordBriefSourceRef {
  const source = fact.source;
  const sourceHref = source?.sourceIntakeId ? safeInternalHref(`/meeting-intelligence/${source.sourceIntakeId}`) : undefined;
  if (source) {
    return {
      detail: source.sourceType === "meeting_intelligence" ? "Meeting Intelligence source" : source.sourceType === "manual" ? "Manual Relationship Memory update" : undefined,
      excerpt: sourceExcerpt(value),
      href: sourceHref ?? (context.record?.type === "contact" ? safeInternalHref(href) : undefined),
      label: source.sourceTitle ? `Relationship Memory history: ${source.sourceTitle}` : "Relationship Memory history",
      occurredAt: source.changedAt,
      recordId: source.sourceIntakeId ?? source.auditId,
      targetRecordId: context.record?.type === "contact" ? context.record.id : undefined,
      type: "relationship_memory",
      warning: sourceHref ? undefined : "Exact Relationship Memory history route is not available; showing the contact memory panel."
    };
  }
  return {
    excerpt: sourceExcerpt(value),
    href: context.record?.type === "contact" ? safeInternalHref(href) : undefined,
    label: fact.label,
    recordId: context.record?.type === "contact" ? context.record.id : undefined,
    type: "relationship_memory",
    warning: context.record?.type === "contact"
      ? "Exact Relationship Memory history was not available in this context; showing the contact memory panel."
      : "Review the linked contact record for Relationship Memory history."
  };
}

function linkedRecordSourceRef(record: NonNullable<NorthstarAssistantContext["related"]["linkedRecords"]>[number]): AiRecordBriefSourceRef {
  return {
    detail: record.status ? `Status: ${record.status}` : undefined,
    href: safeInternalHref(linkedRecordHref(record)),
    label: record.label,
    recordId: record.id,
    type: "linked_record_summary"
  };
}

function meetingIntelligenceSourceRef(
  source: NonNullable<NorthstarAssistantContext["related"]["meetingIntelligenceSources"]>[number],
  value: string
): AiRecordBriefSourceRef {
  return {
    detail: source.categories.length > 0 ? `Categories: ${source.categories.join(", ")}` : `Status: ${source.status}`,
    excerpt: sourceExcerpt(value),
    href: safeInternalHref(source.href) ?? safeInternalHref("/meeting-intelligence"),
    label: source.label,
    recordId: source.id,
    type: "meeting_intelligence"
  };
}

function currentRecordSourceRef(
  context: NorthstarAssistantContext,
  label: string,
  value: string,
  preferredHref?: string
): AiRecordBriefSourceRef | undefined {
  if (!context.record) return undefined;
  return {
    excerpt: sourceExcerpt(value),
    href: safeInternalHref(preferredHref) ?? safeInternalHref(recordHref(context.record)),
    label,
    recordId: context.record.id,
    type: "current_record"
  };
}

function panelSourceRef(
  label: string,
  href: string,
  type: AiRecordBriefSourceRefType,
  value: string
): AiRecordBriefSourceRef {
  return {
    excerpt: sourceExcerpt(value),
    href: safeInternalHref(href),
    label,
    type
  };
}

function summarySourceRef(
  label: string,
  value: string,
  type: AiRecordBriefSourceRefType = "source_summary"
): AiRecordBriefSourceRef {
  return {
    excerpt: sourceExcerpt(value),
    label,
    type,
    warning: "Exact source link was not available in this brief context."
  };
}

function linkedDealSourceRecords(context: NorthstarAssistantContext) {
  return (context.related.linkedRecords ?? []).filter((record) => record.type === "deal" && record.relationship === "linked_deal");
}

function linkedRecordHref(record: NonNullable<NorthstarAssistantContext["related"]["linkedRecords"]>[number]) {
  if (record.type === "deal") return `/deals/${record.id}`;
  if (record.type === "lead") return `/leads/${record.id}`;
  if (record.type === "person") return `/contacts/${record.id}`;
  return `/organizations/${record.id}`;
}

function meetingIntelligenceHref(context: NorthstarAssistantContext) {
  const source = context.related.meetingIntelligenceSources?.[0];
  return safeInternalHref(source?.href);
}

function briefSafeText(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (/source meeting markdown|raw transcript|oauth|refresh token|refresh_token|access token|access_token|authorization:|bearer\s+|client_secret|provider payload|gmail\.metadata|gmail header/i.test(trimmed)) return undefined;
  const firstLine = trimmed.split(/\n+/).map((line) => line.trim()).find(Boolean) ?? "";
  const speaker = firstLine.match(/^([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s*:\s+(.+)$/);
  const normalized = speaker && speaker[1].includes(" ")
    ? `${speaker[1]} mentioned ${withTerminalPunctuation(lowercaseFirst(toThirdPerson(speaker[2])))}`
    : firstLine;
  return truncateBriefText(normalized.replace(/^[-*]\s*/, "").replace(/\s+/g, " ").trim());
}

function toThirdPerson(value: string) {
  return value
    .replace(/^I am\b/i, "they are")
    .replace(/^I'm\b/i, "they are")
    .replace(/^I will\b/i, "they will")
    .replace(/^I\b/i, "they")
    .replace(/\bmy\b/gi, "their")
    .replace(/\bme\b/gi, "them");
}

function lowercaseFirst(value: string) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

function withTerminalPunctuation(value: string) {
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function truncateBriefText(value: string) {
  return value.length > 220 ? `${value.slice(0, 217)}...` : value;
}

function sourceExcerpt(value: string) {
  const safe = briefSafeText(value);
  if (!safe) return undefined;
  return safe.length > 140 ? `${safe.slice(0, 137)}...` : safe;
}

function safeInternalHref(value: string | undefined) {
  if (!value) return undefined;
  if (/^#[a-z0-9_-]+$/i.test(value)) return value;
  if (/^\/activities\/[a-z0-9_-]+\/edit$/i.test(value)) return value;
  if (/^\/(?:contacts|deals|leads|organizations)\/[a-z0-9_-]+(?:#[a-z0-9_-]+)?$/i.test(value)) return value;
  if (/^\/settings#[a-z0-9_-]+$/i.test(value)) return value;
  if (/^\/meeting-intelligence(?:\/[a-z0-9_-]+)?(?:#[a-z0-9_-]+)?$/i.test(value)) return value;
  return undefined;
}

function activityLabel(activity: NorthstarAssistantContext["related"]["activities"][number]) {
  return `${activity.title}${activity.dueAt ? ` due ${activity.dueAt.slice(0, 10)}` : ""}`;
}

function organizationSummaryLabel(summary: string) {
  if (summary.startsWith("Contacts:")) return "Linked people";
  if (summary.startsWith("Deals:")) return "Linked deals";
  if (summary.startsWith("Domain:")) return "Domain";
  return "Organization context";
}

function dealSummaryLabel(summary: string) {
  if (summary.startsWith("Stage:")) return "Stage";
  if (summary.startsWith("Customer:")) return "Customer";
  if (summary.startsWith("Line items:")) return "Line items";
  if (summary.startsWith("Quotes:")) return "Quotes";
  return "Deal context";
}

function meetingIntelligenceSummaryLabel(summary: string) {
  if (summary.startsWith("Status:")) return "Intake status";
  if (summary.startsWith("Source type:")) return "Source type";
  if (summary.startsWith("Note proposal")) return "Note proposals";
  if (summary.startsWith("Activity proposal")) return "Activity proposals";
  if (summary.startsWith("Relationship Memory")) return "Relationship Memory proposals";
  if (/warning|uncertain|failed|error|required/i.test(summary)) return "Review warning";
  return "Meeting Intelligence context";
}

function recordTypeLabel(type: string, fallback: string) {
  if (type === "contact") return "No contact-specific notes were reviewed.";
  if (type === "organization") return "No organization-specific notes were reviewed.";
  if (type === "deal") return "No deal-specific notes were reviewed.";
  return fallback;
}

function recordHref(record: NorthstarAssistantContext["record"]) {
  if (!record) return undefined;
  if (record.type === "contact") return `/contacts/${record.id}`;
  if (record.type === "deal") return `/deals/${record.id}`;
  if (record.type === "lead") return `/leads/${record.id}`;
  return `/organizations/${record.id}`;
}

function recordAbout(context: NorthstarAssistantContext, maxItems: number) {
  const pieces = [
    context.record?.status ? `Status ${context.record.status}` : null,
    context.related.proposalSummaries[0],
    context.related.activities.length > 0 ? `${context.related.activities.length} recent activities reviewed` : null,
    context.related.emails.length > 0 ? `${context.related.emails.length} stored emails reviewed` : null,
    context.related.notes.length > 0 ? `${context.related.notes.length} notes reviewed` : null,
    context.related.relationshipFacts.length > 0 ? `${context.related.relationshipFacts.length} Relationship Memory fields reviewed` : null
  ].filter((piece): piece is string => Boolean(piece));
  return pieces.slice(0, maxItems).join(". ") || "Northstar reviewed the available workspace-scoped CRM context.";
}

function whatChanged(context: NorthstarAssistantContext) {
  if (context.audits.length === 0) return ["No recent audit history was available in this context snapshot."];
  return context.audits.map((audit) =>
    `${audit.action.replaceAll(".", " ")} on ${audit.createdAt.slice(0, 10)}${audit.actorLabel ? ` by ${audit.actorLabel}` : ""}`
  );
}

function surfaceLabel(surface: string) {
  return surface
    .replace("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
