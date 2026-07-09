export type CrmAiInsightTone = "attention" | "info" | "success" | "warning";

export type CrmAiInsightItem = {
  detail: string;
  href?: string;
  reviewFirst: true;
  title: string;
  tone: CrmAiInsightTone;
};

export type CrmAiInsight = {
  confidence: "high" | "medium";
  generatedAt: string;
  items: CrmAiInsightItem[];
  reviewFirst: true;
  sourceBasis: string[];
  summary: string;
  title: string;
};

type DashboardInsightSummary = {
  commercialSnapshot: {
    draftQuotes: number;
    openDealsWithoutQuotes: number;
    openValueWithoutLineItems: number;
  };
  metrics: {
    activeLeadsMissingNextActivity: number;
    dueTodayActivitiesCount: number;
    openDealsCount: number;
    overdueActivitiesCount: number;
  };
  onboarding: {
    isCleanWorkspace: boolean;
  };
  pipelineHealth: {
    openDealsWithoutNextActivity: number;
  };
};

type NeedsAttentionSummaryItem = {
  reason: string;
  title: string;
};

type ActivityQueueSummary = {
  completedRecently: number;
  dueToday: number;
  openTotal: number;
  overdue: number;
  unscheduled: number;
  upcoming: number;
};

type ActivityInsightRecord = {
  completedAt: Date | string | null;
  deal?: { title: string } | null;
  dueAt: Date | string | null;
  lead?: { title: string } | null;
  organization?: { name: string } | null;
  person?: { firstName: string | null; lastName: string | null } | null;
  title: string;
};

type LeadInsightRecord = {
  activities: Array<{ dueAt: Date | string | null }>;
  organization: { name: string } | null;
  owner?: { email: string; name: string | null } | null;
  person: { firstName: string | null; lastName: string | null } | null;
  source: string | null;
  status: string;
  title: string;
};

export function buildDashboardAiInsight(
  summary: DashboardInsightSummary,
  needsAttention: NeedsAttentionSummaryItem[],
  now = new Date()
): CrmAiInsight {
  const items: CrmAiInsightItem[] = [];
  if (summary.metrics.overdueActivitiesCount > 0) {
    items.push(reviewItem({
      detail: `${summary.metrics.overdueActivitiesCount} open ${plural(summary.metrics.overdueActivitiesCount, "activity is", "activities are")} past due.`,
      href: "/activities?status=open&due=overdue",
      title: "Review overdue follow-ups",
      tone: "attention"
    }));
  }
  if (summary.metrics.dueTodayActivitiesCount > 0) {
    items.push(reviewItem({
      detail: `${summary.metrics.dueTodayActivitiesCount} open ${plural(summary.metrics.dueTodayActivitiesCount, "activity is", "activities are")} due today.`,
      href: "/activities?status=open&due=today",
      title: "Work today's queue",
      tone: "warning"
    }));
  }
  if (summary.pipelineHealth.openDealsWithoutNextActivity > 0) {
    items.push(reviewItem({
      detail: `${summary.pipelineHealth.openDealsWithoutNextActivity} open ${plural(summary.pipelineHealth.openDealsWithoutNextActivity, "deal has", "deals have")} no visible next activity.`,
      href: "/deals?followUp=missing",
      title: "Schedule deal next steps",
      tone: "warning"
    }));
  }
  if (summary.metrics.activeLeadsMissingNextActivity > 0) {
    items.push(reviewItem({
      detail: `${summary.metrics.activeLeadsMissingNextActivity} active ${plural(summary.metrics.activeLeadsMissingNextActivity, "lead has", "leads have")} no next activity.`,
      href: "/leads?followUp=missing",
      title: "Qualify active leads",
      tone: "warning"
    }));
  }
  if (summary.commercialSnapshot.openDealsWithoutQuotes > 0) {
    items.push(reviewItem({
      detail: `${summary.commercialSnapshot.openDealsWithoutQuotes} open ${plural(summary.commercialSnapshot.openDealsWithoutQuotes, "deal has", "deals have")} no quote attached.`,
      href: "/deals?commercial=noQuote",
      title: "Check quote coverage",
      tone: "info"
    }));
  }
  if (summary.commercialSnapshot.openValueWithoutLineItems > 0) {
    items.push(reviewItem({
      detail: `${summary.commercialSnapshot.openValueWithoutLineItems} valued open ${plural(summary.commercialSnapshot.openValueWithoutLineItems, "deal has", "deals have")} no line items.`,
      href: "/deals?commercial=valueNoLineItems",
      title: "Review pricing detail",
      tone: "info"
    }));
  }
  for (const item of needsAttention.slice(0, 2)) {
    items.push(reviewItem({
      detail: item.reason,
      title: item.title,
      tone: "attention"
    }));
  }

  const focusItems = compactItems(items, 4);
  const clean = focusItems.length === 0;
  return {
    confidence: "medium",
    generatedAt: now.toISOString(),
    items: clean
      ? [reviewItem({
          detail: summary.onboarding.isCleanWorkspace
            ? "Start with contacts, organizations, a deal, or a follow-up activity so Northstar has CRM context to review."
            : "No urgent dashboard review signals were found in the current workspace snapshot.",
          href: summary.onboarding.isCleanWorkspace ? "/contacts/new" : "/activities",
          title: summary.onboarding.isCleanWorkspace ? "Build the first CRM context" : "Keep working from the queue",
          tone: summary.onboarding.isCleanWorkspace ? "info" : "success"
        })]
      : focusItems,
    reviewFirst: true,
    sourceBasis: ["Dashboard metrics", "Needs Attention queue", "Pipeline health", "Commercial snapshot"],
    summary: clean
      ? "Northstar found no urgent dashboard review queue. Suggestions stay review-first and never change records automatically."
      : "Northstar grouped the highest-signal dashboard work into review-first suggestions. Open each queue before deciding what to change.",
    title: "AI work focus"
  };
}

export function buildActivityQueueAiInsight(
  input: {
    hasActiveFilters: boolean;
    query?: string;
    summary: ActivityQueueSummary;
    visibleActivities: ActivityInsightRecord[];
  },
  now = new Date()
): CrmAiInsight {
  const items: CrmAiInsightItem[] = [];
  if (input.summary.overdue > 0) {
    items.push(reviewItem({
      detail: `${input.summary.overdue} overdue ${plural(input.summary.overdue, "activity needs", "activities need")} review before newer work.`,
      href: "/activities?status=open&due=overdue",
      title: "Start with overdue work",
      tone: "attention"
    }));
  }
  if (input.summary.dueToday > 0) {
    items.push(reviewItem({
      detail: `${input.summary.dueToday} ${plural(input.summary.dueToday, "activity is", "activities are")} due today.`,
      href: "/activities?status=open&due=today",
      title: "Protect today's commitments",
      tone: "warning"
    }));
  }
  if (input.summary.unscheduled > 0) {
    items.push(reviewItem({
      detail: `${input.summary.unscheduled} open ${plural(input.summary.unscheduled, "activity has", "activities have")} no due date.`,
      href: "/activities?status=open&due=unscheduled",
      title: "Add dates to vague work",
      tone: "info"
    }));
  }
  if (input.hasActiveFilters) {
    items.push(reviewItem({
      detail: input.query ? `Current results are filtered by "${input.query}". Clear filters before treating this as the whole queue.` : "Current results are filtered. Clear filters before treating this as the whole queue.",
      href: "/activities",
      title: "Filter-aware review",
      tone: "info"
    }));
  }
  const visibleWithoutRelated = input.visibleActivities.filter((activity) => !activity.deal && !activity.lead && !activity.person && !activity.organization);
  if (visibleWithoutRelated.length > 0) {
    items.push(reviewItem({
      detail: `${visibleWithoutRelated.length} visible ${plural(visibleWithoutRelated.length, "activity has", "activities have")} no linked CRM record.`,
      title: "Review activity context",
      tone: "info"
    }));
  }

  const clean = items.length === 0;
  return {
    confidence: "medium",
    generatedAt: now.toISOString(),
    items: clean
      ? [reviewItem({
          detail: input.summary.openTotal === 0
            ? "No open activities are visible in the current queue."
            : `${input.summary.openTotal} open ${plural(input.summary.openTotal, "activity is", "activities are")} sequenced without overdue or undated signals.`,
          href: "/activities/new",
          title: input.summary.openTotal === 0 ? "Plan the next follow-up" : "Queue looks organized",
          tone: input.summary.openTotal === 0 ? "info" : "success"
        })]
      : compactItems(items, 4),
    reviewFirst: true,
    sourceBasis: ["Activity work queue counts", "Visible activity rows", "Current list filters"],
    summary: clean
      ? "Northstar did not find urgent activity queue gaps. Suggestions remain review-first."
      : "Northstar prioritized the visible work queue from due dates, links, and active filters. Review before completing or editing activities.",
    title: "AI queue focus"
  };
}

export function buildLeadQualificationAiInsight(
  leads: LeadInsightRecord[],
  now = new Date()
): CrmAiInsight {
  const activeLeads = leads.filter((lead) => lead.status === "NEW" || lead.status === "QUALIFIED");
  const missingFollowUp = activeLeads.filter((lead) => lead.activities.length === 0);
  const missingRelationship = activeLeads.filter((lead) => !lead.person && !lead.organization);
  const missingSource = activeLeads.filter((lead) => !lead.source);
  const unassigned = activeLeads.filter((lead) => !lead.owner);
  const items = [
    missingFollowUp.length > 0
      ? reviewItem({
          detail: `${missingFollowUp.length} active ${plural(missingFollowUp.length, "lead has", "leads have")} no open follow-up.`,
          href: "/leads?followUp=missing",
          title: "Add qualification follow-ups",
          tone: "attention"
        })
      : null,
    missingRelationship.length > 0
      ? reviewItem({
          detail: `${missingRelationship.length} active ${plural(missingRelationship.length, "lead is", "leads are")} missing a linked contact or organization.`,
          title: "Check relationship context",
          tone: "warning"
        })
      : null,
    missingSource.length > 0
      ? reviewItem({
          detail: `${missingSource.length} active ${plural(missingSource.length, "lead is", "leads are")} missing source context.`,
          title: "Review lead source quality",
          tone: "info"
        })
      : null,
    unassigned.length > 0
      ? reviewItem({
          detail: `${unassigned.length} active ${plural(unassigned.length, "lead has", "leads have")} no owner.`,
          title: "Confirm ownership",
          tone: "warning"
        })
      : null
  ].filter((item): item is CrmAiInsightItem => Boolean(item));

  const clean = items.length === 0;
  return {
    confidence: "medium",
    generatedAt: now.toISOString(),
    items: clean
      ? [reviewItem({
          detail: activeLeads.length === 0
            ? "No active leads are in the current workspace snapshot."
            : `${activeLeads.length} active ${plural(activeLeads.length, "lead has", "leads have")} basic source, owner, relationship, and follow-up context.`,
          href: "/leads/new",
          title: activeLeads.length === 0 ? "Capture the next lead" : "Qualification basics look covered",
          tone: activeLeads.length === 0 ? "info" : "success"
        })]
      : compactItems(items, 4),
    reviewFirst: true,
    sourceBasis: ["Lead status", "Linked contact or organization", "Owner", "Source", "Open follow-up activity"],
    summary: clean
      ? "Northstar did not find obvious lead qualification gaps. Suggestions stay review-first."
      : "Northstar highlighted lead qualification gaps from CRM fields and open follow-ups. Review each lead before editing or converting.",
    title: "AI lead qualification"
  };
}

function compactItems(items: CrmAiInsightItem[], limit: number) {
  const toneRank: Record<CrmAiInsightTone, number> = {
    attention: 0,
    warning: 1,
    info: 2,
    success: 3
  };
  return [...items].sort((a, b) => toneRank[a.tone] - toneRank[b.tone]).slice(0, limit);
}

function plural(count: number, singular: string, pluralValue: string) {
  return count === 1 ? singular : pluralValue;
}

function reviewItem(input: Omit<CrmAiInsightItem, "reviewFirst">): CrmAiInsightItem {
  return { ...input, reviewFirst: true };
}
