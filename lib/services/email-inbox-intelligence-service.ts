import type { Route } from "next";

import type { AiPreferences } from "./ai-preferences-service";
import type { EmailInboxThreadSummary } from "./email-connection-service";
import type { EmailPriorityFollowUpDetail } from "./email-priority-queue-service";
import {
  buildLocalEmailLabelSuggestions,
} from "./email-classification-service";
import {
  summarizeStoredEmailForAi,
  type StoredEmailSummary,
} from "./ai-email-summary-service";

export const workInboxTabs = [
  { id: "all", label: "All" },
  { id: "priority", label: "Priority" },
  { id: "work", label: "Work" },
  { id: "needs-reply", label: "Needs Reply" },
  { id: "follow-ups", label: "Follow-ups" },
  { id: "crm-linked", label: "CRM Linked" },
  { id: "leads-opportunities", label: "Leads / Opportunities" },
  { id: "customers", label: "Customers" },
  { id: "personal-low-priority", label: "Personal / Low Priority" },
  { id: "automated-marketing", label: "Automated / Marketing" },
] as const;

const workInboxSignalCategories = [
  { id: "pricing-quote", label: "Pricing / Quote" },
  { id: "contract-legal", label: "Contract / Legal" },
  { id: "relationship-risk", label: "Relationship Risk" },
  { id: "low-automated", label: "Low / Automated" },
] as const;

export const workInboxPriorityShortcuts = [
  { id: "all", label: "All", priorityFilter: "all", tabId: "all" },
  { id: "high", label: "High priority", priorityFilter: "high", tabId: "all" },
  { id: "needs-reply", label: "Needs reply", priorityFilter: "all", tabId: "needs-reply" },
  { id: "follow-ups", label: "Follow-up", priorityFilter: "all", tabId: "follow-ups" },
  { id: "pricing-quote", label: "Pricing / quote", priorityFilter: "all", tabId: "pricing-quote" },
  { id: "contract-legal", label: "Contract / legal", priorityFilter: "all", tabId: "contract-legal" },
  { id: "relationship-risk", label: "Relationship risk", priorityFilter: "all", tabId: "relationship-risk" },
  { id: "low-automated", label: "Low / automated", priorityFilter: "low", tabId: "low-automated" },
] as const;

export type WorkInboxTabId = (typeof workInboxTabs)[number]["id"];
export type WorkInboxCategoryId =
  | WorkInboxTabId
  | (typeof workInboxSignalCategories)[number]["id"];
export type WorkInboxPriorityLevel = "high" | "low" | "medium";
export type WorkInboxCrmFilter = "all" | "linked" | "unlinked";
export type WorkInboxImportanceFilter = "all" | "hide-unimportant";
export type WorkInboxPriorityFilter = WorkInboxPriorityLevel | "all";
export type WorkInboxSort = "newest" | "oldest" | "priority" | "unread";

export type WorkInboxItem = {
  alertEligibility: WorkInboxAlertEligibility;
  categories: WorkInboxCategoryId[];
  confidence: "high" | "low" | "medium";
  crmLinkLabel: string;
  detectedIntent: string;
  href: Route;
  isUnimportant: boolean;
  missingCrmLinkSuggestion: string | null;
  priorityLevel: WorkInboxPriorityLevel;
  priorityScore: number;
  primaryMessage: EmailInboxThreadSummary["messages"][number];
  reasonList: string[];
  relatedRecordLabel: string | null;
  summary: StoredEmailSummary;
  suggestedNextAction: string;
  tags: string[];
  thread: EmailInboxThreadSummary;
  triageActions: WorkInboxTriageAction[];
  unimportantReasons: string[];
  unansweredQuestions: string[];
  urgencyRisk: string | null;
  whyItMatters: string;
};

export type WorkInboxAlertEligibility = {
  eligible: boolean;
  reason: string;
  severity: WorkInboxPriorityLevel;
  signalKeys: string[];
};

export type WorkInboxTriageAction = {
  detail: string;
  id:
    | "create-follow-up"
    | "draft-reply"
    | "no-action-needed"
    | "review-contract"
    | "review-crm-record"
    | "review-follow-up"
    | "review-pricing"
    | "review-risk"
    | "review-thread";
  label: string;
};

export function normalizeWorkInboxTab(value: unknown): WorkInboxCategoryId {
  return typeof value === "string" &&
    [...workInboxTabs, ...workInboxSignalCategories].some(
      (tab) => tab.id === value,
    )
    ? (value as WorkInboxCategoryId)
    : "all";
}

export function normalizeWorkInboxSearch(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

export function normalizeWorkInboxPriorityFilter(
  value: unknown,
): WorkInboxPriorityFilter {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "all";
}

export function normalizeWorkInboxCrmFilter(
  value: unknown,
): WorkInboxCrmFilter {
  return value === "linked" || value === "unlinked" ? value : "all";
}

export function normalizeWorkInboxImportanceFilter(
  value: unknown,
): WorkInboxImportanceFilter {
  return value === "hide-unimportant" ? "hide-unimportant" : "all";
}

export function normalizeWorkInboxSort(value: unknown): WorkInboxSort {
  if (value === "oldest" || value === "priority" || value === "unread")
    return value;
  return "newest";
}

export function buildWorkInbox({
  crmFilter = "all",
  followUpDetails = new Map<string, EmailPriorityFollowUpDetail>(),
  importanceFilter = "all",
  priorityFilter = "all",
  preferences,
  query = "",
  selectedTab = "all",
  sort = "newest",
  threads,
}: {
  crmFilter?: WorkInboxCrmFilter;
  followUpDetails?: Map<string, EmailPriorityFollowUpDetail>;
  importanceFilter?: WorkInboxImportanceFilter;
  priorityFilter?: WorkInboxPriorityFilter;
  preferences?: AiPreferences;
  query?: string;
  selectedTab?: WorkInboxCategoryId;
  sort?: WorkInboxSort;
  threads: EmailInboxThreadSummary[];
}) {
  const normalizedQuery = normalizeWorkInboxSearch(query).toLowerCase();
  const items = threads
    .map((thread) => {
      const item = buildWorkInboxItem({ followUpDetails, preferences, thread });
      return {
        ...item,
        href: workInboxThreadHref(thread.id, {
          crmFilter,
          importanceFilter,
          priorityFilter,
          query,
          selectedTab,
          sort,
        }),
      };
    })
    .sort((left, right) => compareWorkInboxItems(left, right, sort));
  const tabs = workInboxTabs.map((tab) => ({
    ...tab,
    count:
      tab.id === "all"
        ? items.length
        : items.filter((item) => item.categories.includes(tab.id)).length,
    href: workInboxTabHref(tab.id, {
      crmFilter,
      importanceFilter,
      priorityFilter,
      query,
      sort,
    }),
  }));
  const priorityShortcuts = workInboxPriorityShortcuts.map((shortcut) => ({
    ...shortcut,
    count: items.filter((item) => workInboxItemMatchesShortcut(item, shortcut))
      .length,
    href: workInboxTabHref(shortcut.tabId, {
      crmFilter,
      importanceFilter,
      priorityFilter: shortcut.priorityFilter,
      query,
      sort,
    }),
  }));
  const visibleItems = items.filter((item) => {
    if (selectedTab !== "all" && !item.categories.includes(selectedTab))
      return false;
    if (importanceFilter === "hide-unimportant" && item.isUnimportant)
      return false;
    if (priorityFilter !== "all" && item.priorityLevel !== priorityFilter)
      return false;
    if (crmFilter === "linked" && !item.relatedRecordLabel) return false;
    if (crmFilter === "unlinked" && item.relatedRecordLabel) return false;
    if (!normalizedQuery) return true;
    return searchableThreadText(item).toLowerCase().includes(normalizedQuery);
  });
  return { items, priorityShortcuts, tabs, visibleItems };
}

function workInboxThreadHref(
  threadId: string,
  {
    crmFilter,
    importanceFilter,
    priorityFilter,
    query,
    selectedTab,
    sort,
  }: {
    crmFilter: WorkInboxCrmFilter;
    importanceFilter: WorkInboxImportanceFilter;
    priorityFilter: WorkInboxPriorityFilter;
    query: string;
    selectedTab: WorkInboxCategoryId;
    sort: WorkInboxSort;
  },
) {
  const params = new URLSearchParams({ inbox: selectedTab, thread: threadId });
  if (query) params.set("q", query);
  if (importanceFilter !== "all") params.set("importance", importanceFilter);
  if (priorityFilter !== "all") params.set("priority", priorityFilter);
  if (crmFilter !== "all") params.set("crm", crmFilter);
  if (sort !== "newest") params.set("sort", sort);
  return `/email?${params.toString()}` as Route;
}

function workInboxTabHref(
  tabId: WorkInboxCategoryId,
  {
    crmFilter,
    importanceFilter,
    priorityFilter,
    query,
    sort,
  }: {
    crmFilter: WorkInboxCrmFilter;
    importanceFilter: WorkInboxImportanceFilter;
    priorityFilter: WorkInboxPriorityFilter;
    query: string;
    sort: WorkInboxSort;
  },
) {
  const params = new URLSearchParams({ inbox: tabId });
  if (query) params.set("q", query);
  if (importanceFilter !== "all") params.set("importance", importanceFilter);
  if (priorityFilter !== "all") params.set("priority", priorityFilter);
  if (crmFilter !== "all") params.set("crm", crmFilter);
  if (sort !== "newest") params.set("sort", sort);
  return `/email?${params.toString()}` as Route;
}

function workInboxItemMatchesShortcut(
  item: WorkInboxItem,
  shortcut: (typeof workInboxPriorityShortcuts)[number],
) {
  if (
    shortcut.priorityFilter !== "all" &&
    item.priorityLevel !== shortcut.priorityFilter
  )
    return false;
  return shortcut.tabId === "all" || item.categories.includes(shortcut.tabId);
}

function buildWorkInboxItem({
  followUpDetails,
  preferences,
  thread,
}: {
  followUpDetails: Map<string, EmailPriorityFollowUpDetail>;
  preferences?: AiPreferences;
  thread: EmailInboxThreadSummary;
}): WorkInboxItem {
  const primaryMessage =
    [...thread.messages]
      .reverse()
      .find((message) => message.direction === "INBOUND") ??
    thread.latestMessage;
  const text = searchableEmailText(primaryMessage);
  const lower = text.toLowerCase();
  const providerLabels = normalizedProviderLabels(
    primaryMessage.providerLabels,
  );
  const linkedRecordLabel =
    thread.linkedRecordLabel ?? linkedRecordLabelForMessage(primaryMessage);
  const followUpDetail = firstFollowUpDetail(thread, followUpDetails);
  const isInbound = primaryMessage.direction === "INBOUND";
  const isAutomated =
    hasAny(lower, [
      "unsubscribe",
      "newsletter",
      "view in browser",
      "marketing",
      "promotion",
      "promotional",
      "webinar",
      "digest",
      "no-reply",
      "noreply",
      "notification",
      "automated notification",
    ]) ||
    providerLabels.some((label) =>
      ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"].includes(
        label,
      ),
    );
  const isPersonal =
    !linkedRecordLabel &&
    hasAny(lower, [
      "family",
      "personal",
      "birthday",
      "dinner",
      "weekend",
      "vacation",
    ]);
  const noReplySender = /\b(no-?reply|donotreply|do-not-reply)\b/i.test(
    primaryMessage.fromText ?? "",
  );
  const lowActionStatusUpdate =
    !linkedRecordLabel &&
    hasAny(lower, [
      "receipt",
      "invoice paid",
      "payment received",
      "order confirmation",
      "status update",
      "delivery update",
      "your statement is ready",
      "password changed",
      "security alert",
      "login alert",
    ]);
  const needsReply =
    isInbound &&
    (hasQuestion(text) ||
      hasAny(lower, [
        "can you",
        "could you",
        "please",
        "let me know",
        "thoughts?",
        "available?",
      ]));
  const followUpSignal =
    followUpDetail?.state === "created" ||
    hasAny(lower, [
      "follow up",
      "follow-up",
      "next step",
      "circle back",
      "check in",
    ]);
  const opportunitySignal = hasAny(lower, [
    "pricing",
    "price",
    "quote",
    "proposal",
    "contract",
    "msa",
    "sow",
    "demo",
    "trial",
    "interested",
    "buying",
    "legal",
  ]);
  const customerSignal =
    Boolean(
      primaryMessage.personId ||
      primaryMessage.organizationId ||
      primaryMessage.dealId,
    ) ||
    hasAny(lower, [
      "customer",
      "renewal",
      "implementation",
      "support",
      "account",
    ]);
  const urgencySignal = hasAny(lower, [
    "urgent",
    "asap",
    "today",
    "deadline",
    "blocked",
    "escalat",
    "risk",
    "concern",
    "issue",
  ]);
  const meetingSignal = hasAny(lower, [
    "meeting",
    "calendar",
    "demo",
    "call",
    "zoom",
    "agenda",
  ]);
  const riskSignal = hasAny(lower, [
    "risk",
    "concern",
    "blocked",
    "unhappy",
    "delay",
    "issue",
    "cancel",
    "churn",
  ]);
  const automatedPromotionSignal =
    isAutomated &&
    hasAny(lower, [
      "action required",
      "requires action",
      "required action",
      "deadline",
      "due today",
      "due by",
      "overdue",
      "expires",
      "expiring",
      "failed payment",
      "payment failed",
      "payment declined",
      "invoice failed",
      "service outage",
      "outage",
      "incident",
      "security issue",
      "security incident",
      "compliance issue",
      "legal notice",
      "signature required",
      "requires signature",
      "document requires signature",
      "contract requires signature",
    ]);
  const actionableNeedsReply =
    needsReply && (!isAutomated || automatedPromotionSignal);
  const actionableFollowUpSignal =
    followUpSignal && (!isAutomated || automatedPromotionSignal);
  const actionableOpportunitySignal =
    opportunitySignal && (!isAutomated || automatedPromotionSignal);
  const actionableCustomerSignal =
    customerSignal && (!isAutomated || automatedPromotionSignal);
  const actionableUrgencySignal =
    urgencySignal && (!isAutomated || automatedPromotionSignal);
  const actionableMeetingSignal =
    meetingSignal && (!isAutomated || automatedPromotionSignal);
  const actionableRiskSignal =
    riskSignal && (!isAutomated || automatedPromotionSignal);

  let score = 35;
  const reasons: string[] = [];
  if (automatedPromotionSignal)
    addScore("Automated message promoted because it includes required action or risk", 18);
  if (linkedRecordLabel) addScore("Linked to CRM record", 18);
  if (actionableNeedsReply)
    addScore("Inbound message asks for a reply or decision", 18);
  if (actionableFollowUpSignal)
    addScore("Follow-up or next-step language is present", 14);
  if (actionableOpportunitySignal)
    addScore("Opportunity, pricing, quote, or contract language", 14);
  if (actionableCustomerSignal)
    addScore("Customer/prospect context detected", 10);
  if (actionableUrgencySignal) addScore("Urgency or risk language", 16);
  if (actionableMeetingSignal) addScore("Meeting/demo context", 6);
  if (actionableRiskSignal) addScore("Relationship risk language", 10);
  if (thread.isUnread) addScore("Unread synced message", 6);
  if (isAutomated && automatedPromotionSignal)
    addScore("Automated or marketing signals still lower work priority", -18);
  if (isAutomated && !automatedPromotionSignal)
    addScore("Automated or marketing signals lower work priority", -45);
  if (isPersonal) addScore("Likely personal or low-work message", -20);
  if (lowActionStatusUpdate)
    addScore("Informational status update with no clear CRM action", -18);

  const unimportantReasons = buildUnimportantReasons({
    automatedPromotionSignal,
    followUpSignal: actionableFollowUpSignal,
    isAutomated,
    isPersonal,
    linkedRecordLabel,
    lowActionStatusUpdate,
    needsReply: actionableNeedsReply,
    noReplySender,
    opportunitySignal: actionableOpportunitySignal,
    riskSignal: actionableRiskSignal,
  });
  const isUnimportant = unimportantReasons.length > 0;

  const priorityLevel: WorkInboxPriorityLevel =
    score >= 70 ? "high" : score >= 45 ? "medium" : "low";

  const categories = new Set<WorkInboxCategoryId>(["all"]);
  if (score >= 70) categories.add("priority");
  if (
    !isAutomated &&
    !isPersonal &&
    (linkedRecordLabel ||
      score >= 48 ||
      actionableOpportunitySignal ||
      actionableNeedsReply)
  )
    categories.add("work");
  if (isAutomated && automatedPromotionSignal) categories.add("work");
  if (actionableNeedsReply) categories.add("needs-reply");
  if (actionableFollowUpSignal) categories.add("follow-ups");
  if (linkedRecordLabel) categories.add("crm-linked");
  if (actionableOpportunitySignal) {
    categories.add("leads-opportunities");
    const label = opportunityTag(lower);
    if (label === "Pricing / quote") categories.add("pricing-quote");
    if (label === "Contract / legal") categories.add("contract-legal");
  }
  if (actionableCustomerSignal) categories.add("customers");
  if (actionableRiskSignal) categories.add("relationship-risk");
  if (isPersonal) categories.add("personal-low-priority");
  if (isAutomated) categories.add("automated-marketing");
  if (lowActionStatusUpdate && !isAutomated)
    categories.add("automated-marketing");
  if (
    (isAutomated || lowActionStatusUpdate) &&
    (priorityLevel === "low" || isUnimportant)
  )
    categories.add("low-automated");
  if (!categories.has("priority") && categories.has("work") && score >= 62)
    categories.add("priority");

  const summary = summarizeStoredEmailForAi(primaryMessage, preferences);
  const tags = new Set(buildLocalEmailLabelSuggestions(primaryMessage));
  if (isAutomated && !automatedPromotionSignal) {
    for (const tag of [
      "Needs reply",
      "Follow-up",
      "Pricing / quote",
      "Contract / legal",
      "Meeting / scheduling",
      "Relationship risk",
      "Lead",
      "Opportunity",
      "Prospect",
    ]) {
      tags.delete(tag);
    }
  }
  if (actionableNeedsReply) tags.add("Needs reply");
  if (actionableFollowUpSignal) tags.add("Follow-up");
  if (actionableCustomerSignal)
    tags.add(
      actionableCustomerSignal && linkedRecordLabel ? "Customer" : "Prospect",
    );
  if (actionableOpportunitySignal) tags.add(opportunityTag(lower));
  if (actionableMeetingSignal) tags.add("Meeting / scheduling");
  if (actionableRiskSignal) tags.add("Relationship risk");
  if (isAutomated) {
    tags.add("Newsletter / promotion");
    tags.add("Automated / no-reply");
  }
  if (isPersonal) tags.add("Personal");
  if (isUnimportant) tags.add("Unimportant");
  if (linkedRecordLabel) tags.delete("No CRM link");
  else tags.delete("CRM linked");
  tags.add(linkedRecordLabel ? "CRM linked" : "No CRM link");
  tags.add(summary.status === "ready" ? "AI summary" : "Summary unavailable");
  const displayTags = prioritizeWorkInboxTags(tags, linkedRecordLabel);

  const reasonList = trimByPreference(
    reasons,
    preferences?.assistantDetailLevel,
  );
  const unansweredQuestions = actionableNeedsReply
    ? extractQuestionSentences(text).slice(
        0,
        preferences?.assistantDetailLevel === "detailed" ? 3 : 1,
      )
    : [];
  const suggestedNextAction = nextAction({
    followUpState: followUpDetail?.state,
    isUnimportant,
    linkedRecordLabel,
    needsReply: actionableNeedsReply,
    opportunitySignal: actionableOpportunitySignal,
    priorityLevel,
  });
  const triageActions = buildTriageActions({
    actionableFollowUpSignal,
    actionableNeedsReply,
    actionableRiskSignal,
    automatedPromotionSignal,
    followUpState: followUpDetail?.state,
    isUnimportant,
    linkedRecordLabel,
    opportunityTag: actionableOpportunitySignal ? opportunityTag(lower) : null,
    priorityLevel,
  });
  const alertEligibility = buildAlertEligibility({
    actionableFollowUpSignal,
    actionableNeedsReply,
    actionableOpportunitySignal,
    actionableRiskSignal,
    actionableUrgencySignal,
    automatedPromotionSignal,
    isUnimportant,
    linkedRecordLabel,
    priorityLevel,
  });

  return {
    alertEligibility,
    categories: [...categories],
    confidence:
      reasonList.length >= 3
        ? "high"
        : reasonList.length >= 1
          ? "medium"
          : "low",
    crmLinkLabel: linkedRecordLabel
      ? `Linked: ${linkedRecordLabel}`
      : "No CRM link",
    detectedIntent: detectedIntent({
      automatedPromotionSignal,
      followUpSignal: actionableFollowUpSignal,
      isAutomated,
      needsReply: actionableNeedsReply,
      opportunitySignal: actionableOpportunitySignal,
      riskSignal: actionableRiskSignal,
    }),
    href: `/email?thread=${thread.id}` as Route,
    isUnimportant,
    missingCrmLinkSuggestion: linkedRecordLabel
      ? null
      : "Review sender and create/link a CRM contact or lead if this is business-relevant.",
    priorityLevel,
    priorityScore: Math.max(0, Math.min(100, score)),
    primaryMessage,
    reasonList,
    relatedRecordLabel: linkedRecordLabel,
    summary,
    suggestedNextAction,
    tags: displayTags.slice(0, 7),
    thread,
    triageActions,
    unimportantReasons,
    unansweredQuestions,
    urgencyRisk:
      actionableUrgencySignal || actionableRiskSignal
        ? "Review timing, risk language, and customer impact before replying."
        : null,
    whyItMatters: whyItMatters({
      automatedPromotionSignal,
      isAutomated,
      isUnimportant,
      linkedRecordLabel,
      needsReply: actionableNeedsReply,
      opportunitySignal: actionableOpportunitySignal,
      priorityLevel,
    }),
  };

  function addScore(reason: string, delta: number) {
    score += delta;
    if (delta > 0) reasons.push(reason);
  }
}

function prioritizeWorkInboxTags(
  tags: Set<string>,
  linkedRecordLabel: string | null,
) {
  const linkTag = linkedRecordLabel ? "CRM linked" : "No CRM link";
  const oppositeLinkTag = linkedRecordLabel ? "No CRM link" : "CRM linked";
  const values = [...tags].filter(
    (tag) => tag !== linkTag && tag !== oppositeLinkTag,
  );
  return [linkTag, ...values];
}

function compareWorkInboxItems(
  left: WorkInboxItem,
  right: WorkInboxItem,
  sort: WorkInboxSort,
) {
  if (sort === "oldest")
    return left.thread.latestAt.getTime() - right.thread.latestAt.getTime();
  if (sort === "priority") {
    if (right.priorityScore !== left.priorityScore)
      return right.priorityScore - left.priorityScore;
    return right.thread.latestAt.getTime() - left.thread.latestAt.getTime();
  }
  if (sort === "unread") {
    if (left.thread.isUnread !== right.thread.isUnread)
      return left.thread.isUnread ? -1 : 1;
    return right.thread.latestAt.getTime() - left.thread.latestAt.getTime();
  }
  return right.thread.latestAt.getTime() - left.thread.latestAt.getTime();
}

function buildUnimportantReasons(input: {
  automatedPromotionSignal: boolean;
  followUpSignal: boolean;
  isAutomated: boolean;
  isPersonal: boolean;
  linkedRecordLabel: string | null;
  lowActionStatusUpdate: boolean;
  needsReply: boolean;
  noReplySender: boolean;
  opportunitySignal: boolean;
  riskSignal: boolean;
}) {
  if (input.isAutomated && !input.automatedPromotionSignal) {
    const reasons: string[] = [];
    if (input.noReplySender)
      reasons.push("Sender appears to be a no-reply or automated mailbox.");
    reasons.push(
      "Automated, newsletter, promotion, digest, or provider category signals without a strong CRM action.",
    );
    if (input.lowActionStatusUpdate)
      reasons.push(
        "Informational status or receipt-style update with no clear action.",
      );
    return reasons;
  }

  if (
    input.linkedRecordLabel ||
    input.needsReply ||
    input.followUpSignal ||
    input.opportunitySignal ||
    input.riskSignal
  )
    return [];

  const reasons: string[] = [];
  if (input.noReplySender)
    reasons.push("Sender appears to be a no-reply or automated mailbox.");
  if (input.isAutomated)
    reasons.push(
      "Newsletter, promotion, digest, or provider category signals.",
    );
  if (input.lowActionStatusUpdate)
    reasons.push(
      "Informational status or receipt-style update with no clear action.",
    );
  if (input.isPersonal)
    reasons.push("Personal or non-work language without CRM context.");
  return reasons;
}

function searchableThreadText(item: WorkInboxItem) {
  return [
    item.thread.subject,
    item.thread.linkedRecordLabel,
    item.crmLinkLabel,
    item.detectedIntent,
    item.summary.summary,
    item.tags.join(" "),
    item.reasonList.join(" "),
    ...item.thread.messages.map(searchableEmailText),
  ]
    .filter(Boolean)
    .join(" ");
}

function searchableEmailText(
  message: EmailInboxThreadSummary["messages"][number],
) {
  return [
    message.subject,
    message.fromText,
    message.toText,
    message.providerSnippet,
    message.body,
  ]
    .filter(Boolean)
    .join(" ");
}

function normalizedProviderLabels(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function firstFollowUpDetail(
  thread: EmailInboxThreadSummary,
  followUpDetails: Map<string, EmailPriorityFollowUpDetail>,
) {
  return thread.messages
    .map((message) => followUpDetails.get(message.id))
    .find(Boolean);
}

function linkedRecordLabelForMessage(
  message: EmailInboxThreadSummary["messages"][number],
) {
  if (message.deal) return `Deal: ${message.deal.title}`;
  if (message.lead) return `Lead: ${message.lead.title}`;
  if (message.organization) return `Organization: ${message.organization.name}`;
  if (message.person)
    return `Contact: ${[message.person.firstName, message.person.lastName].filter(Boolean).join(" ") || message.person.email}`;
  return null;
}

function hasAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function hasQuestion(value: string) {
  return /\?|\b(can|could|would|will|are|is|do|does|did|when|what|where|who|how)\b[^.!?]{0,120}\?/i.test(
    value,
  );
}

function extractQuestionSentences(value: string) {
  return value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.includes("?"));
}

function opportunityTag(value: string) {
  if (hasAny(value, ["contract", "msa", "sow", "legal"]))
    return "Contract / legal";
  if (hasAny(value, ["pricing", "price", "quote"])) return "Pricing / quote";
  return "Lead";
}

function trimByPreference(
  reasons: string[],
  detailLevel: AiPreferences["assistantDetailLevel"] | undefined,
) {
  const limit =
    detailLevel === "detailed" ? 6 : detailLevel === "minimal" ? 2 : 4;
  return reasons.slice(0, limit);
}

function detectedIntent(input: {
  automatedPromotionSignal: boolean;
  followUpSignal: boolean;
  isAutomated: boolean;
  needsReply: boolean;
  opportunitySignal: boolean;
  riskSignal: boolean;
}) {
  if (input.isAutomated && input.automatedPromotionSignal)
    return "Automated action or risk alert";
  if (input.isAutomated) return "Automated update or marketing message";
  if (input.riskSignal) return "Risk or escalation";
  if (input.opportunitySignal) return "Commercial opportunity";
  if (input.needsReply) return "Direct reply requested";
  if (input.followUpSignal) return "Follow-up coordination";
  return "General inbox review";
}

function nextAction(input: {
  followUpState?: string;
  isUnimportant: boolean;
  linkedRecordLabel: string | null;
  needsReply: boolean;
  opportunitySignal: boolean;
  priorityLevel: WorkInboxPriorityLevel;
}) {
  if (input.isUnimportant)
    return "Leave for later or hide with the unimportant filter.";
  if (input.needsReply) return "Draft a reply and answer the open question.";
  if (input.followUpState === "created")
    return "Open or complete the linked follow-up.";
  if (input.opportunitySignal && !input.linkedRecordLabel)
    return "Review CRM match before creating a lead or contact.";
  if (input.priorityLevel === "high")
    return "Review this thread before clearing lower-priority inbox items.";
  return "Review when triaging the inbox.";
}

function buildTriageActions(input: {
  actionableFollowUpSignal: boolean;
  actionableNeedsReply: boolean;
  actionableRiskSignal: boolean;
  automatedPromotionSignal: boolean;
  followUpState?: string;
  isUnimportant: boolean;
  linkedRecordLabel: string | null;
  opportunityTag: string | null;
  priorityLevel: WorkInboxPriorityLevel;
}): WorkInboxTriageAction[] {
  const actions: WorkInboxTriageAction[] = [];

  if (input.isUnimportant) {
    actions.push({
      detail:
        "Keep this in lower-priority review unless a clear customer action appears.",
      id: "no-action-needed",
      label: "No action needed",
    });
    return actions;
  }

  if (input.actionableNeedsReply) {
    actions.push({
      detail: "Use the existing draft panels, then review before sending.",
      id: "draft-reply",
      label: "Draft reply",
    });
  }

  if (input.followUpState === "created") {
    actions.push({
      detail: "Open or complete the linked follow-up activity.",
      id: "review-follow-up",
      label: "Review follow-up",
    });
  } else if (input.actionableFollowUpSignal || input.priorityLevel === "high") {
    actions.push({
      detail: "Review and edit the activity draft before creating anything.",
      id: "create-follow-up",
      label: "Create follow-up",
    });
  }

  if (input.opportunityTag === "Pricing / quote") {
    actions.push({
      detail: "Check pricing, proposal, or quote context before replying.",
      id: "review-pricing",
      label: "Review pricing context",
    });
  }

  if (input.opportunityTag === "Contract / legal") {
    actions.push({
      detail: "Review contract, legal, MSA, SOW, or signature context.",
      id: "review-contract",
      label: "Review contract/legal context",
    });
  }

  if (input.actionableRiskSignal || input.automatedPromotionSignal) {
    actions.push({
      detail: "Review risk language and customer impact before clearing it.",
      id: "review-risk",
      label: "Review relationship risk",
    });
  }

  if (input.linkedRecordLabel) {
    actions.push({
      detail: "Open the linked CRM record in a separate review step.",
      id: "review-crm-record",
      label: "Review related CRM record",
    });
  }

  if (actions.length === 0) {
    actions.push({
      detail: "Read the thread and decide whether it needs a manual next step.",
      id: "review-thread",
      label: "Review thread",
    });
  }

  return dedupeTriageActions(actions).slice(0, 5);
}

function dedupeTriageActions(actions: WorkInboxTriageAction[]) {
  const seen = new Set<WorkInboxTriageAction["id"]>();
  return actions.filter((action) => {
    if (seen.has(action.id)) return false;
    seen.add(action.id);
    return true;
  });
}

function buildAlertEligibility(input: {
  actionableFollowUpSignal: boolean;
  actionableNeedsReply: boolean;
  actionableOpportunitySignal: boolean;
  actionableRiskSignal: boolean;
  actionableUrgencySignal: boolean;
  automatedPromotionSignal: boolean;
  isUnimportant: boolean;
  linkedRecordLabel: string | null;
  priorityLevel: WorkInboxPriorityLevel;
}): WorkInboxAlertEligibility {
  const signalKeys: string[] = [];
  if (input.actionableNeedsReply) signalKeys.push("needs_reply");
  if (input.actionableFollowUpSignal) signalKeys.push("follow_up");
  if (input.actionableOpportunitySignal) signalKeys.push("pipeline_or_contract");
  if (input.actionableRiskSignal) signalKeys.push("relationship_risk");
  if (input.actionableUrgencySignal) signalKeys.push("urgency");
  if (input.automatedPromotionSignal) signalKeys.push("automated_action_alert");
  if (input.linkedRecordLabel) signalKeys.push("crm_linked");

  const eligible =
    !input.isUnimportant &&
    input.priorityLevel === "high" &&
    signalKeys.some((key) =>
      [
        "needs_reply",
        "follow_up",
        "pipeline_or_contract",
        "relationship_risk",
        "urgency",
        "automated_action_alert",
      ].includes(key),
    );

  const severity: WorkInboxPriorityLevel = eligible
    ? input.actionableRiskSignal ||
      input.actionableUrgencySignal ||
      input.automatedPromotionSignal
      ? "high"
      : "medium"
    : "low";

  return {
    eligible,
    reason: eligible
      ? "Eligible for future dashboard alerting because this is high-priority CRM inbox work with clear action signals."
      : "Not eligible for future dashboard alerting because it is low priority, hidden/unimportant, or lacks a clear CRM action signal.",
    severity,
    signalKeys,
  };
}

function whyItMatters(input: {
  automatedPromotionSignal: boolean;
  isAutomated: boolean;
  isUnimportant: boolean;
  linkedRecordLabel: string | null;
  needsReply: boolean;
  opportunitySignal: boolean;
  priorityLevel: WorkInboxPriorityLevel;
}) {
  if (input.isUnimportant)
    return "Automation, marketing, or status-update signals make this lower priority unless a clear CRM action appears.";
  if (input.isAutomated && input.automatedPromotionSignal)
    return "This automated message was promoted because it includes required action, deadline, risk, or deal-blocking language.";
  if (input.needsReply && input.linkedRecordLabel)
    return "A linked CRM relationship appears to be waiting on a response.";
  if (input.opportunitySignal)
    return "Commercial language suggests this may affect pipeline or customer next steps.";
  if (input.priorityLevel === "high")
    return "Multiple work-priority signals make this worth reviewing early.";
  if (input.linkedRecordLabel)
    return "This message is tied to CRM context and belongs in the work inbox.";
  return "Northstar found limited work context; review or leave it in a lower-priority tab.";
}
