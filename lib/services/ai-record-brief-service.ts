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
  missingOrStale: string[];
  nextBestReview: string;
  recordLabel: string;
  reviewFirst: true;
  sourceBasis: string[];
  title: string;
  whatChanged: string[];
};

export function buildAiRecordBrief(
  context: NorthstarAssistantContext,
  insight: NorthstarAssistantInsight,
  preferences?: AiPreferences
): AiRecordBrief {
  const recordLabel = context.record?.label ?? surfaceLabel(context.surface);
  const health = buildRecordHealthInsight(context, insight.findings);
  const maxItems = preferences?.recordSummaryStyle === "detailed" ? 5 : preferences?.recordSummaryStyle === "concise" ? 2 : 3;
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
    missingOrStale,
    nextBestReview: primaryAction
      ? `${primaryAction.label}: ${primaryAction.reason}`
      : "Review the source CRM context before deciding whether anything should change.",
    recordLabel,
    reviewFirst: true,
    sourceBasis: context.lookedAt.slice(0, maxItems + 2),
    title: `AI brief for ${recordLabel}`,
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
