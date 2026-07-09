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

export type WorkInboxTabId = (typeof workInboxTabs)[number]["id"];
export type WorkInboxPriorityLevel = "high" | "low" | "medium";
export type WorkInboxCrmFilter = "all" | "linked" | "unlinked";
export type WorkInboxImportanceFilter = "all" | "hide-unimportant";
export type WorkInboxPriorityFilter = WorkInboxPriorityLevel | "all";
export type WorkInboxSort = "newest" | "oldest" | "priority" | "unread";

export type WorkInboxItem = {
  categories: WorkInboxTabId[];
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
  unimportantReasons: string[];
  unansweredQuestions: string[];
  urgencyRisk: string | null;
  whyItMatters: string;
};

export function normalizeWorkInboxTab(value: unknown): WorkInboxTabId {
  return typeof value === "string" &&
    workInboxTabs.some((tab) => tab.id === value)
    ? (value as WorkInboxTabId)
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
  selectedTab?: WorkInboxTabId;
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
  return { items, tabs, visibleItems };
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
    selectedTab: WorkInboxTabId;
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
  tabId: WorkInboxTabId,
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

  let score = 35;
  const reasons: string[] = [];
  if (linkedRecordLabel) addScore("Linked to CRM record", 18);
  if (needsReply) addScore("Inbound message asks for a reply or decision", 18);
  if (followUpSignal)
    addScore("Follow-up or next-step language is present", 14);
  if (opportunitySignal)
    addScore("Opportunity, pricing, quote, or contract language", 14);
  if (customerSignal) addScore("Customer/prospect context detected", 10);
  if (urgencySignal) addScore("Urgency or risk language", 16);
  if (meetingSignal) addScore("Meeting/demo context", 6);
  if (riskSignal) addScore("Relationship risk language", 10);
  if (thread.isUnread) addScore("Unread synced message", 6);
  if (isAutomated)
    addScore("Automated or marketing signals lower work priority", -35);
  if (isPersonal) addScore("Likely personal or low-work message", -20);
  if (lowActionStatusUpdate)
    addScore("Informational status update with no clear CRM action", -18);

  const unimportantReasons = buildUnimportantReasons({
    followUpSignal,
    isAutomated,
    isPersonal,
    linkedRecordLabel,
    lowActionStatusUpdate,
    needsReply,
    noReplySender,
    opportunitySignal,
    riskSignal,
  });
  const isUnimportant = unimportantReasons.length > 0;

  const categories = new Set<WorkInboxTabId>(["all"]);
  if (score >= 70) categories.add("priority");
  if (
    !isAutomated &&
    !isPersonal &&
    (linkedRecordLabel || score >= 48 || opportunitySignal || needsReply)
  )
    categories.add("work");
  if (needsReply) categories.add("needs-reply");
  if (followUpSignal) categories.add("follow-ups");
  if (linkedRecordLabel) categories.add("crm-linked");
  if (opportunitySignal) categories.add("leads-opportunities");
  if (customerSignal) categories.add("customers");
  if (isPersonal) categories.add("personal-low-priority");
  if (isAutomated) categories.add("automated-marketing");
  if (lowActionStatusUpdate && !isAutomated)
    categories.add("automated-marketing");
  if (!categories.has("priority") && categories.has("work") && score >= 62)
    categories.add("priority");

  const summary = summarizeStoredEmailForAi(primaryMessage, preferences);
  const tags = new Set(buildLocalEmailLabelSuggestions(primaryMessage));
  if (needsReply) tags.add("Needs reply");
  if (followUpSignal) tags.add("Follow-up");
  if (customerSignal)
    tags.add(customerSignal && linkedRecordLabel ? "Customer" : "Prospect");
  if (opportunitySignal) tags.add(opportunityTag(lower));
  if (meetingSignal) tags.add("Meeting / scheduling");
  if (riskSignal) tags.add("Relationship risk");
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

  const priorityLevel: WorkInboxPriorityLevel =
    score >= 70 ? "high" : score >= 45 ? "medium" : "low";
  const reasonList = trimByPreference(
    reasons,
    preferences?.assistantDetailLevel,
  );
  const unansweredQuestions = needsReply
    ? extractQuestionSentences(text).slice(
        0,
        preferences?.assistantDetailLevel === "detailed" ? 3 : 1,
      )
    : [];
  const suggestedNextAction = nextAction({
    followUpState: followUpDetail?.state,
    linkedRecordLabel,
    needsReply,
    opportunitySignal,
    priorityLevel,
  });

  return {
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
      followUpSignal,
      isAutomated,
      needsReply,
      opportunitySignal,
      riskSignal,
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
    unimportantReasons,
    unansweredQuestions,
    urgencyRisk:
      urgencySignal || riskSignal
        ? "Review timing, risk language, and customer impact before replying."
        : null,
    whyItMatters: whyItMatters({
      linkedRecordLabel,
      needsReply,
      opportunitySignal,
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
  followUpSignal: boolean;
  isAutomated: boolean;
  needsReply: boolean;
  opportunitySignal: boolean;
  riskSignal: boolean;
}) {
  if (input.isAutomated) return "Automated update or marketing message";
  if (input.riskSignal) return "Risk or escalation";
  if (input.opportunitySignal) return "Commercial opportunity";
  if (input.needsReply) return "Direct reply requested";
  if (input.followUpSignal) return "Follow-up coordination";
  return "General inbox review";
}

function nextAction(input: {
  followUpState?: string;
  linkedRecordLabel: string | null;
  needsReply: boolean;
  opportunitySignal: boolean;
  priorityLevel: WorkInboxPriorityLevel;
}) {
  if (input.needsReply) return "Draft a reply and answer the open question.";
  if (input.followUpState === "created")
    return "Open or complete the linked follow-up.";
  if (input.opportunitySignal && !input.linkedRecordLabel)
    return "Review CRM match before creating a lead or contact.";
  if (input.priorityLevel === "high")
    return "Review this thread before clearing lower-priority inbox items.";
  return "Review when triaging the inbox.";
}

function whyItMatters(input: {
  linkedRecordLabel: string | null;
  needsReply: boolean;
  opportunitySignal: boolean;
  priorityLevel: WorkInboxPriorityLevel;
}) {
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
