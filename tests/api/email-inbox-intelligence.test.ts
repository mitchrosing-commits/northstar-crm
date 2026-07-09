import { describe, expect, it } from "vitest";

import {
  buildWorkInbox,
  normalizeWorkInboxCrmFilter,
  normalizeWorkInboxImportanceFilter,
  normalizeWorkInboxPriorityFilter,
  normalizeWorkInboxSearch,
  normalizeWorkInboxSort,
  normalizeWorkInboxTab,
} from "@/lib/services/email-inbox-intelligence-service";
import {
  defaultAiPreferences,
  type AiPreferences,
} from "@/lib/services/ai-preferences-service";
import type { EmailInboxThreadSummary } from "@/lib/services/email-connection-service";

describe("work inbox intelligence", () => {
  it("prioritizes linked customer emails that ask direct questions", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Can you send updated pricing today? We need a quote before the deadline.",
          fromText: "Pat Customer <pat@customer.example>",
          linkedRecordLabel: "Deal: Expansion",
          subject: "Updated pricing needed today",
        }),
      ],
    });

    expect(inbox.items[0]).toMatchObject({
      categories: expect.arrayContaining([
        "priority",
        "work",
        "needs-reply",
        "crm-linked",
        "leads-opportunities",
      ]),
      detectedIntent: "Commercial opportunity",
      priorityLevel: "high",
      relatedRecordLabel: "Deal: Expansion",
      tags: expect.arrayContaining([
        "Needs reply",
        "Pricing",
        "CRM linked",
        "AI summary",
      ]),
    });
    expect(inbox.tabs.find((tab) => tab.id === "priority")?.count).toBe(1);
  });

  it("classifies newsletters as automated marketing and lowers work priority", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Weekly newsletter. Unsubscribe or view in browser.",
          fromText: "newsletter@vendor.example",
          providerLabels: ["CATEGORY_PROMOTIONS"],
          subject: "Vendor digest",
        }),
      ],
    });

    expect(inbox.items[0]).toMatchObject({
      categories: expect.arrayContaining(["automated-marketing"]),
      detectedIntent: "Automated update or marketing message",
      priorityLevel: "low",
      isUnimportant: true,
      tags: expect.arrayContaining(["Automated", "No CRM link", "Unimportant"]),
      unimportantReasons: expect.arrayContaining([
        "Newsletter, promotion, digest, or provider category signals.",
      ]),
    });
    expect(inbox.items[0].categories).not.toContain("priority");
  });

  it("does not penalize .info and other custom-domain business senders by TLD", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Can you send the updated proposal and contract today? We are ready to move forward after the demo.",
          fromText: "Sales Lead <sales@veridian.info>",
          linkedRecordLabel: "Organization: Veridian",
          subject: "Proposal and contract timing",
        }),
        thread({
          body: "Can we review pricing after the pilot?",
          fromText: "Founder <founder@startup.ai>",
          id: "gmail_thread_ai",
          subject: "Pilot pricing question",
        }),
      ],
    });

    const infoItem = inbox.items.find(
      (item) => item.thread.id === "gmail_thread_1",
    );
    const aiItem = inbox.items.find(
      (item) => item.thread.id === "gmail_thread_ai",
    );

    expect(infoItem).toMatchObject({
      categories: expect.arrayContaining([
        "priority",
        "work",
        "crm-linked",
        "leads-opportunities",
      ]),
      priorityLevel: "high",
      relatedRecordLabel: "Organization: Veridian",
      tags: expect.arrayContaining([
        "Needs reply",
        "Pricing",
        "Contract",
        "CRM linked",
      ]),
    });
    expect(infoItem?.categories).not.toContain("personal-low-priority");
    expect(infoItem?.categories).not.toContain("automated-marketing");
    expect(aiItem).toMatchObject({
      categories: expect.arrayContaining([
        "work",
        "needs-reply",
        "leads-opportunities",
      ]),
      tags: expect.arrayContaining(["Needs reply", "Pricing", "No CRM link"]),
    });
    expect(aiItem?.categories).not.toContain("personal-low-priority");
    expect(aiItem?.categories).not.toContain("automated-marketing");
  });

  it("keeps personal low-priority mail out of work tabs", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Dinner this weekend with family?",
          fromText: "friend@example.test",
          subject: "Weekend plans",
        }),
      ],
    });

    expect(inbox.items[0]).toMatchObject({
      categories: expect.arrayContaining(["personal-low-priority"]),
      priorityLevel: "low",
      tags: expect.arrayContaining(["Personal"]),
    });
    expect(inbox.items[0].categories).not.toContain("work");
  });

  it("defaults to newest-first ordering instead of AI priority ordering", () => {
    const olderPriority = thread({
      body: "Urgent pricing question. Can you send a quote today?",
      fromText: "buyer@acme.example",
      linkedRecordLabel: "Deal: Acme",
      occurredAt: new Date("2030-01-01T12:00:00.000Z"),
      subject: "Urgent quote",
    });
    const newerLowValue = thread({
      body: "Weekly newsletter. Unsubscribe or view in browser.",
      fromText: "newsletter@vendor.example",
      id: "gmail_thread_2",
      occurredAt: new Date("2030-01-02T12:00:00.000Z"),
      providerLabels: ["CATEGORY_PROMOTIONS"],
      subject: "Vendor digest",
    });

    const inbox = buildWorkInbox({ threads: [olderPriority, newerLowValue] });

    expect(inbox.visibleItems.map((item) => item.thread.subject)).toEqual([
      "Vendor digest",
      "Urgent quote",
    ]);
  });

  it("supports explicit oldest, unread, and priority sorts", () => {
    const readNewest = thread({
      body: "Newsletter and webinar invitation. Unsubscribe anytime.",
      fromText: "marketing@vendor.example",
      id: "gmail_thread_2",
      isUnread: false,
      occurredAt: new Date("2030-01-03T12:00:00.000Z"),
      providerLabels: ["CATEGORY_PROMOTIONS"],
      subject: "Newest low priority",
    });
    const unreadMiddle = thread({
      body: "Status update with no action needed.",
      fromText: "notifications@vendor.example",
      id: "gmail_thread_3",
      isUnread: true,
      occurredAt: new Date("2030-01-02T12:00:00.000Z"),
      subject: "Unread middle",
    });
    const olderPriority = thread({
      body: "Urgent pricing question. Can you send a quote today?",
      fromText: "buyer@acme.example",
      linkedRecordLabel: "Deal: Acme",
      id: "gmail_thread_1",
      isUnread: false,
      occurredAt: new Date("2030-01-01T12:00:00.000Z"),
      subject: "Older priority",
    });

    expect(
      buildWorkInbox({
        sort: "oldest",
        threads: [readNewest, unreadMiddle, olderPriority],
      }).visibleItems.map((item) => item.thread.subject),
    ).toEqual(["Older priority", "Unread middle", "Newest low priority"]);
    expect(
      buildWorkInbox({
        sort: "unread",
        threads: [readNewest, unreadMiddle, olderPriority],
      }).visibleItems.map((item) => item.thread.subject),
    ).toEqual(["Unread middle", "Newest low priority", "Older priority"]);
    expect(
      buildWorkInbox({
        sort: "priority",
        threads: [readNewest, unreadMiddle, olderPriority],
      }).visibleItems.map((item) => item.thread.subject)[0],
    ).toBe("Older priority");
  });

  it("filters visible work inbox items by search, priority, CRM link, importance, and sort", () => {
    const linkedPriority = thread({
      body: "Can you send the contract today?",
      fromText: "buyer@acme.example",
      linkedRecordLabel: "Deal: Acme",
      subject: "Contract question",
    });
    const unlinkedMarketing = thread({
      body: "Newsletter and webinar invitation. Unsubscribe anytime.",
      fromText: "marketing@vendor.example",
      id: "gmail_thread_2",
      occurredAt: new Date("2030-01-02T12:00:00.000Z"),
      providerLabels: ["CATEGORY_PROMOTIONS"],
      subject: "Webinar digest",
    });

    const filtered = buildWorkInbox({
      crmFilter: "linked",
      importanceFilter: "hide-unimportant",
      priorityFilter: "high",
      query: "contract",
      sort: "priority",
      threads: [unlinkedMarketing, linkedPriority],
    });

    expect(filtered.visibleItems).toHaveLength(1);
    expect(filtered.visibleItems[0].thread.subject).toBe("Contract question");
    expect(filtered.visibleItems[0].href).toContain("inbox=all");
    expect(filtered.visibleItems[0].href).toContain("thread=gmail_thread_1");
    expect(filtered.visibleItems[0].href).toContain("q=contract");
    expect(filtered.visibleItems[0].href).toContain(
      "importance=hide-unimportant",
    );
    expect(filtered.visibleItems[0].href).toContain("priority=high");
    expect(filtered.visibleItems[0].href).toContain("crm=linked");
    expect(filtered.visibleItems[0].href).toContain("sort=priority");
    expect(filtered.tabs.find((tab) => tab.id === "all")?.href).toContain(
      "q=contract",
    );
    expect(filtered.tabs.find((tab) => tab.id === "all")?.href).toContain(
      "priority=high",
    );
    expect(filtered.tabs.find((tab) => tab.id === "all")?.href).toContain(
      "crm=linked",
    );
    expect(filtered.tabs.find((tab) => tab.id === "all")?.href).toContain(
      "importance=hide-unimportant",
    );
    expect(filtered.tabs.find((tab) => tab.id === "all")?.href).toContain(
      "sort=priority",
    );
  });

  it("hides locally classified unimportant emails only when explicitly requested", () => {
    const unimportant = thread({
      body: "Weekly newsletter. Unsubscribe or view in browser.",
      fromText: "newsletter@vendor.example",
      providerLabels: ["CATEGORY_PROMOTIONS"],
      subject: "Vendor digest",
    });
    const important = thread({
      body: "Can you send updated pricing today?",
      fromText: "buyer@acme.example",
      id: "gmail_thread_2",
      linkedRecordLabel: "Deal: Acme",
      subject: "Pricing question",
    });

    expect(
      buildWorkInbox({ threads: [unimportant, important] }).visibleItems.map(
        (item) => item.thread.subject,
      ),
    ).toEqual(["Vendor digest", "Pricing question"]);
    expect(
      buildWorkInbox({
        importanceFilter: "hide-unimportant",
        threads: [unimportant, important],
      }).visibleItems.map((item) => item.thread.subject),
    ).toEqual(["Pricing question"]);
  });

  it("honors AI preference summary length and detail level", () => {
    const detailedPreferences: AiPreferences = {
      ...defaultAiPreferences,
      assistantDetailLevel: "detailed",
      emailSummaryLength: "detailed",
    };
    const minimalPreferences: AiPreferences = {
      ...defaultAiPreferences,
      assistantDetailLevel: "minimal",
      emailSummaryLength: "one_sentence",
    };
    const sourceThread = thread({
      body: "First sentence has the ask. Second sentence has pricing. Third sentence has risk. Fourth sentence has the deadline.",
      linkedRecordLabel: "Contact: Alex",
      subject: "Can you review pricing?",
    });

    const detailed = buildWorkInbox({
      preferences: detailedPreferences,
      threads: [sourceThread],
    }).items[0];
    const minimal = buildWorkInbox({
      preferences: minimalPreferences,
      threads: [sourceThread],
    }).items[0];

    expect(detailed.summary.summary).toContain("Fourth sentence");
    expect(minimal.summary.summary).toBe("First sentence has the ask.");
    expect(detailed.reasonList.length).toBeGreaterThanOrEqual(
      minimal.reasonList.length,
    );
  });

  it("defaults the work inbox to All and normalizes unknown tabs to All", () => {
    expect(buildWorkInbox({ threads: [] }).tabs[0]).toMatchObject({
      id: "all",
      label: "All",
    });
    expect(normalizeWorkInboxTab("customers")).toBe("customers");
    expect(normalizeWorkInboxTab("unknown")).toBe("all");
    expect(normalizeWorkInboxPriorityFilter("medium")).toBe("medium");
    expect(normalizeWorkInboxPriorityFilter("urgent")).toBe("all");
    expect(normalizeWorkInboxCrmFilter("unlinked")).toBe("unlinked");
    expect(normalizeWorkInboxCrmFilter("secret")).toBe("all");
    expect(normalizeWorkInboxImportanceFilter("hide-unimportant")).toBe(
      "hide-unimportant",
    );
    expect(normalizeWorkInboxImportanceFilter("hide-important")).toBe("all");
    expect(normalizeWorkInboxSort(undefined)).toBe("newest");
    expect(normalizeWorkInboxSort("recent")).toBe("newest");
    expect(normalizeWorkInboxSort("oldest")).toBe("oldest");
    expect(normalizeWorkInboxSort("priority")).toBe("priority");
    expect(normalizeWorkInboxSort("unread")).toBe("unread");
    expect(normalizeWorkInboxSearch("  hello  ")).toBe("hello");
    expect(normalizeWorkInboxSearch(42)).toBe("");
  });
});

function thread({
  body,
  fromText = "sender@example.test",
  id = "gmail_thread_1",
  isUnread = true,
  linkedRecordLabel = null,
  occurredAt = new Date("2030-01-01T12:00:00.000Z"),
  providerLabels = [],
  subject,
}: {
  body: string;
  fromText?: string;
  id?: string;
  isUnread?: boolean;
  linkedRecordLabel?: string | null;
  occurredAt?: Date;
  providerLabels?: string[];
  subject: string;
}): EmailInboxThreadSummary {
  const message = {
    body,
    createdAt: occurredAt,
    createdBy: null,
    createdById: null,
    deal: linkedRecordLabel?.startsWith("Deal:")
      ? { id: "deal_1", title: linkedRecordLabel.replace("Deal: ", "") }
      : null,
    dealId: linkedRecordLabel?.startsWith("Deal:") ? "deal_1" : null,
    direction: "INBOUND",
    fromText,
    id: `${id}_email_1`,
    lead: null,
    leadId: null,
    occurredAt,
    organization: null,
    organizationId: null,
    person: linkedRecordLabel?.startsWith("Contact:")
      ? {
          email: "alex@example.test",
          firstName: "Alex",
          id: "person_1",
          lastName: null,
        }
      : null,
    personId: linkedRecordLabel?.startsWith("Contact:") ? "person_1" : null,
    provider: "GOOGLE_WORKSPACE",
    providerLabels,
    providerMessageId: `${id}_message_1`,
    providerSnippet: body.slice(0, 120),
    providerThreadId: id,
    smartLabelGeneratedAt: null,
    smartLabelJson: null,
    smartLabelProvider: null,
    subject,
    toText: "me@example.test",
    updatedAt: occurredAt,
    workspaceId: "workspace_1",
  } as EmailInboxThreadSummary["messages"][number];

  return {
    accountEmail: "me@example.test",
    emailConnectionId: "email_connection_1",
    emailConnectionRef: "nection_1",
    id,
    isUnread,
    latestAt: message.occurredAt,
    latestMessage: message,
    linkedRecordLabel,
    messageCount: 1,
    messages: [message],
    provider: "GOOGLE_WORKSPACE",
    subject,
  };
}
