import type { Route } from "next";
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import {
  emailSmartCategoryLabel,
  emailSmartClassificationLabels,
  emailSmartSignalLabel,
  emailSmartSignalPriorityRank,
  readEmailSmartClassification,
  type EmailSmartCategory,
  type EmailSmartClassification,
  type EmailSmartSignal
} from "./email-classification-service";
import { activeWhere, ensureWorkspaceAccess, type WorkspaceActor } from "./workspace-access";

export const emailPriorityQueueFilters = [
  { id: "all", label: "All priority", type: "all" },
  { id: "urgent", label: "Urgent", signal: "URGENT", type: "signal" },
  { id: "needs-reply", label: "Needs reply", signal: "NEEDS_REPLY", type: "signal" },
  { id: "follow-up-needed", label: "Follow-up needed", signal: "FOLLOW_UP_NEEDED", type: "signal" },
  { id: "relationship-risk", label: "Relationship risk", signal: "RELATIONSHIP_RISK", type: "signal" },
  { id: "pricing-quote", label: "Pricing / quote", signal: "PRICING_QUOTE", type: "signal" },
  { id: "contract-legal", label: "Contract / legal", signal: "CONTRACT_LEGAL", type: "signal" },
  { id: "waiting-on-customer", label: "Waiting on customer", signal: "WAITING_ON_CUSTOMER", type: "signal" },
  { id: "potential-leads", label: "Potential leads", signal: "POTENTIAL_LEAD", type: "signal" },
  { id: "customers", category: "CUSTOMER", label: "Customers", type: "category" },
  { id: "prospects", category: "PROSPECT", label: "Prospects", type: "category" }
] as const satisfies readonly EmailPriorityQueueFilterDefinition[];

export type EmailPriorityQueueFilterId = (typeof emailPriorityQueueFilters)[number]["id"];
export type EmailFollowUpState = "created" | "completed" | "none" | "unknown";
export type EmailLinkedFollowUpSource = "durable" | "legacy";

type EmailPriorityQueueFilterDefinition =
  | { id: string; label: string; type: "all" }
  | { id: string; label: string; signal: EmailSmartSignal; type: "signal" }
  | { category: EmailSmartCategory; id: string; label: string; type: "category" };

export type EmailPriorityQueueEmailLog = {
  body: string;
  deal?: { id: string; title: string } | null;
  dealId: string | null;
  direction: "INBOUND" | "OUTBOUND";
  fromText: string | null;
  id: string;
  lead?: { id: string; title: string } | null;
  leadId: string | null;
  occurredAt: Date | string;
  organization?: { id: string; name: string } | null;
  organizationId: string | null;
  person?: { email: string | null; firstName: string; id: string; lastName: string | null } | null;
  personId: string | null;
  smartLabelGeneratedAt?: Date | string | null;
  smartLabelJson?: Prisma.JsonValue | null;
  smartLabelProvider?: string | null;
  subject: string;
  toText: string | null;
};

export type EmailPriorityQueueItem = {
  classification: EmailSmartClassification | null;
  emailLog: EmailPriorityQueueEmailLog;
  followUps: EmailLinkedFollowUpSummary[];
  followUpState: EmailFollowUpState;
  labels: string[];
  linkedRecord: {
    href: Route;
    label: string;
    type: "deal" | "lead" | "organization" | "person";
  } | null;
  nextBestAction: EmailPriorityNextBestAction;
  priorityLabel: string;
  explainer: EmailPriorityQueueExplainer;
  rank: number;
};

export type EmailPriorityQueueEvidenceSource = "crm_link" | "durable_follow_up" | "legacy_follow_up" | "smart_label";

export type EmailPriorityQueueEvidence = {
  label: string;
  source: EmailPriorityQueueEvidenceSource;
  tone: "attention" | "info" | "muted" | "success";
};

export type EmailPriorityQueueEvidenceType =
  | "category"
  | "crm_link"
  | "follow_up"
  | "next_best_action"
  | "saved_excerpt"
  | "signal"
  | "unclassified";

export type EmailPriorityQueueEvidenceTarget = {
  href: Route;
  kind: "crm_record" | "email_evidence" | "linked_follow_up";
  label: string;
};

export type EmailPriorityQueueEvidenceTrailItem = EmailPriorityQueueEvidence & {
  category?: EmailSmartCategory;
  excerpt?: string;
  excerpts?: string[];
  followUp?: Pick<EmailLinkedFollowUpSummary, "completedAt" | "dueAt" | "href" | "id" | "source" | "status" | "title">;
  id: string;
  reason: string;
  signal?: EmailSmartSignal;
  target?: EmailPriorityQueueEvidenceTarget;
  type: EmailPriorityQueueEvidenceType;
};

export type EmailPriorityQueueExplainer = {
  evidence: EmailPriorityQueueEvidence[];
  detailHref: Route;
  headline: string;
  severity: EmailPriorityNextBestAction["severity"];
  sources: EmailPriorityQueueEvidenceSource[];
  trail: EmailPriorityQueueEvidenceTrailItem[];
};

export type EmailPriorityNextBestAction = {
  action:
    | "classify_email"
    | "draft_reply"
    | "link_crm_record"
    | "mark_follow_up_complete"
    | "no_action_needed"
    | "open_follow_up"
    | "review_follow_up"
    | "review_potential_lead"
    | "review_relationship_risk";
  followUp?: EmailLinkedFollowUpSummary;
  href: Route;
  label: string;
  reason: string;
  severity: "high" | "low" | "medium";
  target: "email_card" | "linked_follow_up";
};

export type EmailLinkedFollowUpSummary = {
  completedAt: Date | string | null;
  dueAt: Date | string | null;
  href: Route;
  id: string;
  linkedRecord: EmailPriorityQueueItem["linkedRecord"];
  source: EmailLinkedFollowUpSource;
  status: "completed" | "open";
  title: string;
};

export type EmailPriorityFollowUpDetail = {
  followUps: EmailLinkedFollowUpSummary[];
  state: EmailFollowUpState;
};

export type EmailPriorityQueueSummaryItem = {
  count: number;
  href: Route;
  id: EmailPriorityQueueFilterId;
  label: string;
};

export function normalizeEmailPriorityQueueFilter(value: unknown): EmailPriorityQueueFilterId {
  if (typeof value !== "string") return "all";
  return emailPriorityQueueFilters.some((filter) => filter.id === value) ? (value as EmailPriorityQueueFilterId) : "all";
}

export function buildEmailPriorityQueue({
  emailLogs,
  filter = "all",
  followUpDetails = new Map<string, EmailPriorityFollowUpDetail>(),
  followUpStates = new Map<string, EmailFollowUpState>()
}: {
  emailLogs: EmailPriorityQueueEmailLog[];
  filter?: EmailPriorityQueueFilterId;
  followUpDetails?: Map<string, EmailPriorityFollowUpDetail>;
  followUpStates?: Map<string, EmailFollowUpState>;
}) {
  const normalizedFilter = normalizeEmailPriorityQueueFilter(filter);
  return emailLogs
    .map((emailLog) => {
      const classification = readEmailSmartClassification({
        smartLabelGeneratedAt: emailLog.smartLabelGeneratedAt,
        smartLabelJson: emailLog.smartLabelJson,
        smartLabelProvider: emailLog.smartLabelProvider
      });
      if (!isRelationshipQueueCandidate(classification, emailLog)) return null;
      const followUpDetail = followUpDetails.get(emailLog.id);
      const followUps = followUpDetail?.followUps ?? [];
      const followUpState = followUpDetail?.state ?? followUpStates.get(emailLog.id) ?? "unknown";
      const linkedRecord = emailPriorityLinkedRecord(emailLog);
      const nextBestAction = emailPriorityNextBestAction({
        classification,
        emailLog,
        followUps,
        linkedRecord
      });
      return {
        classification,
        emailLog,
        followUps,
        followUpState,
        labels: classification ? emailSmartClassificationLabels(classification) : ["Unclassified"],
        linkedRecord,
        nextBestAction,
        priorityLabel: classification ? emailPriorityLabel(classification) : "Unclassified",
        explainer: emailPriorityQueueExplainer({
          classification,
          emailLog,
          followUps,
          followUpState,
          linkedRecord,
          nextBestAction
        }),
        rank: classification ? emailSmartSignalPriorityRank(classification) : 0
      } satisfies EmailPriorityQueueItem;
    })
    .filter((item): item is EmailPriorityQueueItem => Boolean(item))
    .filter((item) => emailPriorityItemMatchesFilter(item, normalizedFilter))
    .sort((left, right) => {
      if (right.rank !== left.rank) return right.rank - left.rank;
      return new Date(right.emailLog.occurredAt).getTime() - new Date(left.emailLog.occurredAt).getTime();
    });
}

export function buildEmailPriorityQueueSummary(emailLogs: EmailPriorityQueueEmailLog[]) {
  const items = buildEmailPriorityQueue({ emailLogs });
  return emailPriorityQueueFilters.map((filter) => ({
    count: filter.id === "all" ? items.length : items.filter((item) => emailPriorityItemMatchesFilter(item, filter.id)).length,
    href: `/email?inbox=${filter.id}` as Route,
    id: filter.id,
    label: filter.label
  }));
}

export async function listEmailPriorityFollowUpStates(
  actor: WorkspaceActor,
  emailLogs: EmailPriorityQueueEmailLog[]
): Promise<Map<string, EmailFollowUpState>> {
  const details = await listEmailPriorityFollowUpDetails(actor, emailLogs);
  return new Map(Array.from(details, ([emailLogId, detail]) => [emailLogId, detail.state]));
}

export async function listEmailPriorityFollowUpDetails(
  actor: WorkspaceActor,
  emailLogs: EmailPriorityQueueEmailLog[]
): Promise<Map<string, EmailPriorityFollowUpDetail>> {
  await ensureWorkspaceAccess(actor);
  const emailLogIds = emailLogs.map((emailLog) => emailLog.id);
  const targets = emailLogs.flatMap((emailLog) => {
    const target = emailPriorityTarget(emailLog);
    return target ? [{ emailLog, target }] : [];
  });
  const details = new Map<string, EmailPriorityFollowUpDetail>(
    emailLogs.map((emailLog) => [
      emailLog.id,
      { followUps: [], state: emailPriorityTarget(emailLog) ? "none" : "unknown" }
    ])
  );
  if (emailLogIds.length === 0) return details;

  const linkedFollowUps = await prisma.emailLogActivityLink.findMany({
    where: {
      emailLogId: { in: emailLogIds },
      workspaceId: actor.workspaceId,
      activity: {
        workspaceId: actor.workspaceId,
        ...activeWhere
      }
    },
    select: {
      activity: {
        select: {
          completedAt: true,
          createdAt: true,
          deal: { select: { id: true, title: true } },
          dueAt: true,
          id: true,
          lead: { select: { id: true, title: true } },
          organization: { select: { id: true, name: true } },
          person: { select: { email: true, firstName: true, id: true, lastName: true } },
          title: true
        }
      },
      emailLogId: true
    }
  });

  const linkedEmailLogIds = new Set<string>();
  for (const emailLogId of emailLogIds) {
    const linkedActivities = linkedFollowUps
      .filter((link) => link.emailLogId === emailLogId)
      .map((link) => emailFollowUpSummaryFromActivity(link.activity, "durable"))
      .sort(compareEmailFollowUps);
    if (linkedActivities.length === 0) continue;
    linkedEmailLogIds.add(emailLogId);
    details.set(emailLogId, {
      followUps: linkedActivities,
      state: followUpStateFromSummaries(linkedActivities)
    });
  }

  const fallbackTargets = targets.filter(({ emailLog }) => !linkedEmailLogIds.has(emailLog.id));
  if (fallbackTargets.length === 0) return details;

  const targetFilters = fallbackTargets.map(({ target }) => ({ [target.field]: target.id }));
  const activities = await prisma.activity.findMany({
    where: {
      workspaceId: actor.workspaceId,
      ...activeWhere,
      OR: targetFilters
    },
    select: {
      completedAt: true,
      createdAt: true,
      deal: { select: { id: true, title: true } },
      dealId: true,
      description: true,
      dueAt: true,
      id: true,
      lead: { select: { id: true, title: true } },
      leadId: true,
      organization: { select: { id: true, name: true } },
      organizationId: true,
      person: { select: { email: true, firstName: true, id: true, lastName: true } },
      personId: true,
      title: true
    }
  });

  for (const { emailLog, target } of fallbackTargets) {
    const matchingFollowUps = activities
      .filter((activity) => {
        const sameTarget = activity[target.field] === target.id;
        return sameTarget && activity.description?.includes(`Source email: ${emailLog.subject}`);
      })
      .map((activity) => emailFollowUpSummaryFromActivity(activity, "legacy"))
      .sort(compareEmailFollowUps);
    if (matchingFollowUps.length === 0) continue;
    details.set(emailLog.id, {
      followUps: matchingFollowUps,
      state: followUpStateFromSummaries(matchingFollowUps)
    });
  }

  return details;
}

export function emailFollowUpStateLabel(state: EmailFollowUpState) {
  if (state === "created") return "Follow-up created";
  if (state === "completed") return "Follow-up completed";
  if (state === "none") return "No follow-up created";
  return "Unknown";
}

function emailPriorityItemMatchesFilter(item: EmailPriorityQueueItem, filterId: EmailPriorityQueueFilterId) {
  const filter = emailPriorityQueueFilters.find((candidate) => candidate.id === filterId) ?? emailPriorityQueueFilters[0];
  if (filter.type === "all") return true;
  if (!item.classification) return false;
  if (filter.type === "signal") return item.classification.signals.includes(filter.signal);
  return item.classification.category === filter.category;
}

function isRelationshipQueueCandidate(classification: EmailSmartClassification | null, emailLog: EmailPriorityQueueEmailLog) {
  if (!classification) return emailLog.direction === "INBOUND" || Boolean(emailPriorityTarget(emailLog));
  if (classification.signals.length > 0) return true;
  return classification.category === "CUSTOMER" || classification.category === "PROSPECT";
}

function emailPriorityNextBestAction({
  classification,
  emailLog,
  followUps,
  linkedRecord
}: {
  classification: EmailSmartClassification | null;
  emailLog: EmailPriorityQueueEmailLog;
  followUps: EmailLinkedFollowUpSummary[];
  linkedRecord: EmailPriorityQueueItem["linkedRecord"];
}): EmailPriorityNextBestAction {
  const reviewHref = emailReviewHref(emailLog.id);
  if (!classification) {
    return {
      action: "classify_email",
      href: reviewHref,
      label: "Classify email",
      reason: "No Smart Label has been saved yet; classify before choosing relationship work.",
      severity: "medium",
      target: "email_card"
    };
  }

  const signals = new Set(classification.signals);
  const openFollowUp = followUps.find((followUp) => followUp.status === "open");
  const allFollowUpsCompleted = followUps.length > 0 && followUps.every((followUp) => followUp.status === "completed");

  if (!linkedRecord) {
    if (signals.has("POTENTIAL_LEAD")) {
      return {
        action: "review_potential_lead",
        href: reviewHref,
        label: "Review potential lead",
        reason: "Potential lead signal is saved, but the email is not linked to a CRM record.",
        severity: "high",
        target: "email_card"
      };
    }
    return {
      action: "link_crm_record",
      href: reviewHref,
      label: "Link CRM record",
      reason: "No CRM record is linked; review the email before replying or creating follow-up work.",
      severity: "medium",
      target: "email_card"
    };
  }

  if (signals.has("RELATIONSHIP_RISK")) {
    return {
      action: "review_relationship_risk",
      href: reviewHref,
      label: "Review relationship risk",
      reason: "Relationship risk is flagged; review the email and CRM context before acting.",
      severity: "high",
      target: "email_card"
    };
  }

  if (signals.has("NEEDS_REPLY") || signals.has("URGENT") || signals.has("PRICING_QUOTE") || signals.has("CONTRACT_LEGAL")) {
    return {
      action: "draft_reply",
      href: reviewHref,
      label: "Draft reply",
      reason: signals.has("URGENT")
        ? "Urgent email with CRM context is ready for a reviewed reply draft."
        : "Saved labels indicate a reply is likely needed.",
      severity: signals.has("URGENT") ? "high" : "medium",
      target: "email_card"
    };
  }

  if (signals.has("FOLLOW_UP_NEEDED") && followUps.length === 0) {
    return {
      action: "review_follow_up",
      href: reviewHref,
      label: "Review follow-up",
      reason: "Follow-up is suggested and no linked follow-up exists yet.",
      severity: "medium",
      target: "email_card"
    };
  }

  if (openFollowUp) {
    return {
      action: "mark_follow_up_complete",
      followUp: openFollowUp,
      href: openFollowUp.href,
      label: "Mark follow-up complete",
      reason: "An open linked follow-up already exists; complete the exact activity when the work is done instead of creating a duplicate.",
      severity: "medium",
      target: "linked_follow_up"
    };
  }

  if (allFollowUpsCompleted) {
    return {
      action: "no_action_needed",
      href: reviewHref,
      label: "No action needed",
      reason: "All linked follow-ups are completed and no reply or risk signal is currently saved.",
      severity: "low",
      target: "email_card"
    };
  }

  if (signals.has("POTENTIAL_LEAD")) {
    return {
      action: "review_potential_lead",
      href: reviewHref,
      label: "Review potential lead",
      reason: "Potential lead signal is saved; review linked CRM context before next steps.",
      severity: "medium",
      target: "email_card"
    };
  }

  if (signals.has("WAITING_ON_CUSTOMER")) {
    return {
      action: "no_action_needed",
      href: reviewHref,
      label: "No action needed",
      reason: "The saved signal says Northstar is waiting on the customer.",
      severity: "low",
      target: "email_card"
    };
  }

  return {
    action: "no_action_needed",
    href: reviewHref,
    label: "No action needed",
    reason: "No urgent reply, risk, or follow-up signal is currently saved.",
    severity: "low",
    target: "email_card"
  };
}

function emailPriorityQueueExplainer({
  classification,
  emailLog,
  followUps,
  followUpState,
  linkedRecord,
  nextBestAction
}: {
  classification: EmailSmartClassification | null;
  emailLog: EmailPriorityQueueEmailLog;
  followUps: EmailLinkedFollowUpSummary[];
  followUpState: EmailFollowUpState;
  linkedRecord: EmailPriorityQueueItem["linkedRecord"];
  nextBestAction: EmailPriorityNextBestAction;
}): EmailPriorityQueueExplainer {
  const detailHref = emailEvidenceHref(emailLog.id);
  const trail: EmailPriorityQueueEvidenceTrailItem[] = [];
  const emailEvidenceTarget: EmailPriorityQueueEvidenceTarget = {
    href: detailHref,
    kind: "email_evidence",
    label: "View full Relationship Inbox evidence"
  };

  if (!classification) {
    trail.push({
      id: "smart-label-unclassified",
      label: "Unclassified email",
      reason: "No Smart Label snapshot has been saved yet, so the queue recommends review before taking relationship action.",
      source: "smart_label",
      target: emailEvidenceTarget,
      tone: "attention",
      type: "unclassified"
    });
  } else {
    const categoryEvidence = classification.categoryEvidence;
    trail.push({
      category: classification.category,
      excerpts: categoryEvidence?.excerpts,
      id: `category-${classification.category}`,
      label: `Category: ${emailSmartCategoryLabel(classification.category)}`,
      reason: categoryEvidence?.reason ?? "Saved Smart Label category from the last explicit classification run.",
      source: "smart_label",
      target: emailEvidenceTarget,
      tone: "info",
      type: "category"
    });
    for (const signal of classification.signals) {
      const signalEvidence = classification.signalEvidence.find((item) => item.signal === signal);
      trail.push({
        excerpts: signalEvidence?.excerpts,
        id: `signal-${signal}`,
        label: `Signal: ${emailSmartSignalLabel(signal)}`,
        reason: signalEvidence?.reason ?? "Saved Smart Label signal contributing to priority and next-best-action guidance.",
        signal,
        source: "smart_label",
        target: emailEvidenceTarget,
        tone: signalEvidenceTone(signal),
        type: "signal"
      });
    }
    const structuredExcerpts = new Set(
      [
        ...(classification.categoryEvidence?.excerpts ?? []),
        ...classification.signalEvidence.flatMap((item) => item.excerpts)
      ].map(normalizeEvidenceText)
    );
    for (const [index, item] of classification.evidence.entries()) {
      const normalized = normalizeEvidenceText(item);
      const representedByStructuredEvidence = normalized && structuredExcerpts.has(normalized);
      trail.push({
        excerpt: item,
        id: `saved-excerpt-${index + 1}`,
        label: `${representedByStructuredEvidence ? "Additional evidence" : "Evidence"}: ${truncateQueueEvidence(item)}`,
        reason: representedByStructuredEvidence
          ? "Flat saved evidence is retained for backward compatibility and is also represented in the structured category/signal evidence above."
          : "Saved supporting excerpt from the Smart Label snapshot. Exact text offsets are not stored.",
        source: "smart_label",
        target: emailEvidenceTarget,
        tone: "muted",
        type: "saved_excerpt"
      });
    }
  }

  if (linkedRecord) {
    trail.push({
      id: "crm-link",
      label: `Linked to ${linkedRecord.type}: ${linkedRecord.label}`,
      reason: "The stored email is attached to this CRM record, so relationship actions can be reviewed in context.",
      source: "crm_link",
      target: {
        href: linkedRecord.href,
        kind: "crm_record",
        label: `Open linked ${linkedRecord.type}`
      },
      tone: "success",
      type: "crm_link"
    });
  } else {
    trail.push({
      id: "crm-link-missing",
      label: "No CRM record linked",
      reason: "No deal, lead, contact, or organization is linked, so the queue treats CRM review/linking as part of the decision.",
      source: "crm_link",
      target: emailEvidenceTarget,
      tone: "attention",
      type: "crm_link"
    });
  }

  const durableFollowUps = followUps.filter((followUp) => followUp.source === "durable");
  const legacyFollowUps = followUps.filter((followUp) => followUp.source === "legacy");
  const openFollowUp = followUps.find((followUp) => followUp.status === "open");
  if (durableFollowUps.length > 0) {
    trail.push({
      followUp: followUpEvidenceSummary(openFollowUp ?? durableFollowUps[0]),
      id: "durable-follow-up",
      label: openFollowUp ? "Open durable linked follow-up exists" : "Durable linked follow-up detected",
      reason: openFollowUp
        ? "A workspace-scoped EmailLogActivityLink points to an open activity, so the queue recommends completing that exact work instead of creating a duplicate."
        : "A workspace-scoped EmailLogActivityLink points to completed follow-up history for this email.",
      source: "durable_follow_up",
      target: {
        href: (openFollowUp ?? durableFollowUps[0]).href,
        kind: "linked_follow_up",
        label: "Open linked follow-up activity"
      },
      tone: openFollowUp ? "attention" : "success",
      type: "follow_up"
    });
  } else if (legacyFollowUps.length > 0) {
    trail.push({
      followUp: followUpEvidenceSummary(legacyFollowUps[0]),
      id: "legacy-follow-up",
      label: "Legacy follow-up marker detected",
      reason: "No durable EmailLogActivityLink exists, so the queue uses the older same-record activity description marker as a conservative fallback.",
      source: "legacy_follow_up",
      target: {
        href: legacyFollowUps[0].href,
        kind: "linked_follow_up",
        label: "Open legacy matched follow-up"
      },
      tone: "muted",
      type: "follow_up"
    });
  } else if (followUpState === "none") {
    trail.push({
      id: "follow-up-none",
      label: "No linked follow-up yet",
      reason: "The email is linked to CRM context, but no durable or legacy follow-up activity was found.",
      source: "durable_follow_up",
      target: emailEvidenceTarget,
      tone: "muted",
      type: "follow_up"
    });
  }

  if (followUps.length > 0 && followUps.every((followUp) => followUp.status === "completed")) {
    const source = durableFollowUps.length > 0 ? "durable_follow_up" : "legacy_follow_up";
    trail.push({
      followUp: followUpEvidenceSummary(followUps[0]),
      id: "follow-up-all-completed",
      label: "All linked follow-ups completed",
      reason: "Every linked follow-up activity currently surfaced for this email is completed.",
      source,
      target: {
        href: followUps[0].href,
        kind: "linked_follow_up",
        label: "Review completed linked follow-up"
      },
      tone: "success",
      type: "follow_up"
    });
  }

  trail.push({
    id: `next-best-action-${nextBestAction.action}`,
    label: `Recommended action: ${nextBestAction.label}`,
    reason: nextBestAction.reason,
    source: nextBestAction.followUp?.source === "legacy" ? "legacy_follow_up" : nextBestAction.target === "linked_follow_up" ? "durable_follow_up" : "smart_label",
    target: {
      href: nextBestAction.href,
      kind: nextBestAction.target === "linked_follow_up" ? "linked_follow_up" : "email_evidence",
      label: nextBestAction.label
    },
    tone: nextBestAction.severity === "high" ? "attention" : nextBestAction.severity === "low" ? "muted" : "info",
    type: "next_best_action"
  });

  return {
    detailHref,
    evidence: trail.map(({ label, source, tone }) => ({ label, source, tone })),
    headline: emailPriorityExplainerHeadline(nextBestAction),
    severity: nextBestAction.severity,
    sources: uniqueEvidenceSources(trail),
    trail
  };
}

function emailPriorityExplainerHeadline(action: EmailPriorityNextBestAction) {
  if (action.action === "classify_email") return "Queued because the email is unclassified but relationship-relevant.";
  if (action.action === "review_potential_lead") return "Queued by potential-lead signal and CRM link state.";
  if (action.action === "review_relationship_risk") return "Queued by relationship-risk signal.";
  if (action.action === "draft_reply") return "Queued by reply-sensitive saved labels.";
  if (action.action === "review_follow_up") return "Queued because follow-up work is suggested.";
  if (action.action === "mark_follow_up_complete") return "Queued because an exact linked follow-up is still open.";
  if (action.action === "link_crm_record") return "Queued because no CRM record is linked yet.";
  if (action.action === "open_follow_up") return "Queued because linked follow-up history exists.";
  return "Queued for review with no immediate action required.";
}

function signalEvidenceTone(signal: EmailSmartSignal): EmailPriorityQueueEvidence["tone"] {
  if (signal === "URGENT" || signal === "RELATIONSHIP_RISK" || signal === "NEEDS_REPLY") return "attention";
  if (signal === "WAITING_ON_CUSTOMER") return "muted";
  return "info";
}

function truncateQueueEvidence(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

function normalizeEvidenceText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function uniqueEvidenceSources(evidence: EmailPriorityQueueEvidence[]) {
  return Array.from(new Set(evidence.map((item) => item.source)));
}

function followUpEvidenceSummary(followUp: EmailLinkedFollowUpSummary) {
  return {
    completedAt: followUp.completedAt,
    dueAt: followUp.dueAt,
    href: followUp.href,
    id: followUp.id,
    source: followUp.source,
    status: followUp.status,
    title: followUp.title
  };
}

function emailPriorityLabel(classification: EmailSmartClassification) {
  const signals = new Set(classification.signals);
  if (signals.has("URGENT")) return "Urgent";
  if (signals.has("RELATIONSHIP_RISK")) return "Relationship risk";
  if (signals.has("NEEDS_REPLY")) return "Needs reply";
  if (signals.has("PRICING_QUOTE")) return "Pricing / quote";
  if (signals.has("CONTRACT_LEGAL")) return "Contract / legal";
  if (signals.has("FOLLOW_UP_NEEDED")) return "Follow-up needed";
  if (signals.has("WAITING_ON_CUSTOMER")) return "Waiting on customer";
  if (signals.has("POTENTIAL_LEAD")) return "Potential lead";
  return emailSmartCategoryLabel(classification.category);
}

function emailReviewHref(emailLogId: string) {
  return `#email-card-${emailLogId}` as Route;
}

function emailEvidenceHref(emailLogId: string) {
  return `#email-evidence-${emailLogId}` as Route;
}

function emailPriorityLinkedRecord(emailLog: EmailPriorityQueueEmailLog): EmailPriorityQueueItem["linkedRecord"] {
  const target = emailPriorityTarget(emailLog);
  if (!target) return null;
  return {
    href: target.href,
    label: target.label,
    type: target.type
  };
}

function emailFollowUpSummaryFromActivity(
  activity: {
    completedAt: Date | string | null;
    createdAt: Date | string;
    deal: { id: string; title: string } | null;
    dueAt: Date | string | null;
    id: string;
    lead: { id: string; title: string } | null;
    organization: { id: string; name: string } | null;
    person: { email: string | null; firstName: string; id: string; lastName: string | null } | null;
    title: string;
  },
  source: EmailLinkedFollowUpSource
): EmailLinkedFollowUpSummary {
  return {
    completedAt: activity.completedAt,
    dueAt: activity.dueAt,
    href: `/activities/${activity.id}/edit?returnTo=${encodeURIComponent("/email")}` as Route,
    id: activity.id,
    linkedRecord: emailActivityLinkedRecord(activity),
    source,
    status: activity.completedAt ? "completed" : "open",
    title: activity.title
  };
}

function followUpStateFromSummaries(followUps: EmailLinkedFollowUpSummary[]): EmailFollowUpState {
  if (followUps.some((followUp) => followUp.status === "open")) return "created";
  return "completed";
}

function compareEmailFollowUps(left: EmailLinkedFollowUpSummary, right: EmailLinkedFollowUpSummary) {
  if (left.status !== right.status) return left.status === "open" ? -1 : 1;
  const leftDue = sortableDate(left.dueAt);
  const rightDue = sortableDate(right.dueAt);
  if (leftDue !== rightDue) return leftDue - rightDue;
  return right.id.localeCompare(left.id);
}

function sortableDate(value: Date | string | null) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function emailActivityLinkedRecord(activity: {
  deal: { id: string; title: string } | null;
  lead: { id: string; title: string } | null;
  organization: { id: string; name: string } | null;
  person: { email: string | null; firstName: string; id: string; lastName: string | null } | null;
}): EmailPriorityQueueItem["linkedRecord"] {
  if (activity.deal) {
    return { href: `/deals/${activity.deal.id}` as Route, label: activity.deal.title, type: "deal" };
  }
  if (activity.lead) {
    return { href: `/leads/${activity.lead.id}` as Route, label: activity.lead.title, type: "lead" };
  }
  if (activity.person) {
    const label = [activity.person.firstName, activity.person.lastName].filter(Boolean).join(" ") || activity.person.email || "Unnamed contact";
    return { href: `/contacts/${activity.person.id}` as Route, label, type: "person" };
  }
  if (activity.organization) {
    return { href: `/organizations/${activity.organization.id}` as Route, label: activity.organization.name, type: "organization" };
  }
  return null;
}

function emailPriorityTarget(emailLog: EmailPriorityQueueEmailLog) {
  if (emailLog.dealId && emailLog.deal) {
    return { field: "dealId" as const, href: `/deals/${emailLog.dealId}` as Route, id: emailLog.dealId, label: emailLog.deal.title, type: "deal" as const };
  }
  if (emailLog.leadId && emailLog.lead) {
    return { field: "leadId" as const, href: `/leads/${emailLog.leadId}` as Route, id: emailLog.leadId, label: emailLog.lead.title, type: "lead" as const };
  }
  if (emailLog.personId && emailLog.person) {
    const label = [emailLog.person.firstName, emailLog.person.lastName].filter(Boolean).join(" ") || emailLog.person.email || "Unnamed contact";
    return { field: "personId" as const, href: `/contacts/${emailLog.personId}` as Route, id: emailLog.personId, label, type: "person" as const };
  }
  if (emailLog.organizationId && emailLog.organization) {
    return { field: "organizationId" as const, href: `/organizations/${emailLog.organizationId}` as Route, id: emailLog.organizationId, label: emailLog.organization.name, type: "organization" as const };
  }
  return null;
}
