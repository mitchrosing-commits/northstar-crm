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
      suggestedNextAction: "Draft a reply and answer the open question.",
      tags: expect.arrayContaining([
        "Needs reply",
        "Pricing / quote",
        "CRM linked",
        "AI summary",
      ]),
      whyItMatters:
        "A linked CRM relationship appears to be waiting on a response.",
    });
    expect(inbox.items[0].reasonList).toEqual(
      expect.arrayContaining([
        "Linked to CRM record",
        "Inbound message asks for a reply or decision",
        "Opportunity, pricing, quote, or contract language",
      ]),
    );
    expect(inbox.items[0].triageActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "draft-reply", label: "Draft reply" }),
        expect.objectContaining({
          id: "create-follow-up",
          label: "Create follow-up",
        }),
        expect.objectContaining({
          id: "review-pricing",
          label: "Review pricing context",
        }),
        expect.objectContaining({
          id: "review-crm-record",
          label: "Review related CRM record",
        }),
      ]),
    );
    expect(inbox.items[0].alertEligibility).toMatchObject({
      eligible: true,
      severity: "high",
      signalKeys: expect.arrayContaining([
        "needs_reply",
        "pipeline_or_contract",
        "urgency",
        "crm_linked",
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
      tags: expect.arrayContaining([
        "Automated / no-reply",
        "No CRM link",
        "Unimportant",
      ]),
      unimportantReasons: expect.arrayContaining([
        "Automated, newsletter, promotion, digest, or provider category signals without a strong CRM action.",
      ]),
    });
    expect(inbox.items[0].categories).not.toContain("priority");
    expect(inbox.items[0].alertEligibility).toMatchObject({
      eligible: false,
      severity: "low",
    });
  });

  it("demotes no-reply blasts even when they contain business words", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Please join our pricing webinar for the newest sales playbook. Unsubscribe anytime or view in browser.",
          fromText: "No Reply <no-reply@vendor.example>",
          providerLabels: ["CATEGORY_PROMOTIONS"],
          subject: "Pricing webinar invitation",
        }),
      ],
    });

    expect(inbox.items[0]).toMatchObject({
      categories: expect.arrayContaining(["automated-marketing"]),
      detectedIntent: "Automated update or marketing message",
      isUnimportant: true,
      priorityLevel: "low",
      suggestedNextAction: "Leave for later or hide with the unimportant filter.",
      whyItMatters:
        "Automation, marketing, or status-update signals make this lower priority unless a clear CRM action appears.",
    });
    expect(inbox.items[0].categories).not.toContain("priority");
    expect(inbox.items[0].categories).not.toContain("needs-reply");
    expect(inbox.items[0].categories).not.toContain("leads-opportunities");
    expect(inbox.items[0].tags).not.toContain("Needs reply");
    expect(inbox.items[0].tags).not.toContain("Pricing / quote");
    expect(inbox.items[0].unimportantReasons).toEqual(
      expect.arrayContaining([
        "Sender appears to be a no-reply or automated mailbox.",
        "Automated, newsletter, promotion, digest, or provider category signals without a strong CRM action.",
      ]),
    );
    expect(inbox.items[0].triageActions).toEqual([
      expect.objectContaining({
        id: "no-action-needed",
        label: "No action needed",
      }),
    ]);
  });

  it("keeps receipt and status updates low priority when no action is needed", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Receipt for your subscription. Payment received. This is a status update and no action is needed.",
          fromText: "Billing <billing@vendor.example>",
          subject: "Payment receipt",
        }),
      ],
    });

    expect(inbox.items[0]).toMatchObject({
      categories: expect.arrayContaining(["automated-marketing"]),
      detectedIntent: "General inbox review",
      isUnimportant: true,
      priorityLevel: "low",
      unimportantReasons: expect.arrayContaining([
        "Informational status or receipt-style update with no clear action.",
      ]),
    });
    expect(inbox.items[0].categories).not.toContain("priority");
  });

  it("promotes automated messages only when strong action or risk signals are present", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Payment failed for the Acme contract. Action required by deadline today. Contract requires signature before launch.",
          fromText: "No Reply <no-reply@payments.example>",
          linkedRecordLabel: "Deal: Acme",
          providerLabels: ["CATEGORY_UPDATES"],
          subject: "Payment failed - action required",
        }),
      ],
    });

    expect(inbox.items[0]).toMatchObject({
      categories: expect.arrayContaining([
        "priority",
        "work",
        "crm-linked",
        "leads-opportunities",
      ]),
      detectedIntent: "Automated action or risk alert",
      isUnimportant: false,
      priorityLevel: "high",
      reasonList: expect.arrayContaining([
        "Automated message promoted because it includes required action or risk",
      ]),
      whyItMatters:
        "This automated message was promoted because it includes required action, deadline, risk, or deal-blocking language.",
    });
    expect(inbox.items[0].unimportantReasons).toEqual([]);
    expect(inbox.items[0].triageActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "create-follow-up",
          label: "Create follow-up",
        }),
        expect.objectContaining({
          id: "review-contract",
          label: "Review contract/legal context",
        }),
        expect.objectContaining({
          id: "review-risk",
          label: "Review relationship risk",
        }),
        expect.objectContaining({
          id: "review-crm-record",
          label: "Review related CRM record",
        }),
      ]),
    );
    expect(inbox.items[0].alertEligibility).toMatchObject({
      eligible: true,
      severity: "high",
      signalKeys: expect.arrayContaining([
        "automated_action_alert",
        "pipeline_or_contract",
        "urgency",
        "crm_linked",
      ]),
    });
  });

  it("builds compact priority shortcuts for action-oriented inbox filters", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Can you send pricing today?",
          fromText: "Buyer <buyer@example.test>",
          id: "gmail_thread_pricing",
          subject: "Pricing question",
        }),
        thread({
          body: "Can legal review the contract and MSA today?",
          fromText: "Legal Buyer <legal@example.test>",
          id: "gmail_thread_contract",
          subject: "Contract review",
        }),
        thread({
          body: "We are blocked and there is churn risk unless this issue is fixed.",
          fromText: "Customer <customer@example.test>",
          id: "gmail_thread_risk",
          linkedRecordLabel: "Deal: Renewal",
          subject: "Escalation risk",
        }),
        thread({
          body: "Weekly newsletter. Unsubscribe or view in browser.",
          fromText: "newsletter@vendor.example",
          id: "gmail_thread_marketing",
          providerLabels: ["CATEGORY_PROMOTIONS"],
          subject: "Vendor digest",
        }),
      ],
    });

    expect(inbox.priorityShortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 4, id: "all", label: "All" }),
        expect.objectContaining({
          id: "high",
          label: "High priority",
          priorityFilter: "high",
        }),
        expect.objectContaining({
          count: 1,
          id: "pricing-quote",
          label: "Pricing / quote",
        }),
        expect.objectContaining({
          count: 1,
          id: "contract-legal",
          label: "Contract / legal",
        }),
        expect.objectContaining({
          count: 1,
          id: "relationship-risk",
          label: "Relationship risk",
        }),
        expect.objectContaining({
          count: 1,
          id: "low-automated",
          label: "Low / automated",
          priorityFilter: "low",
        }),
      ]),
    );
    expect(
      inbox.priorityShortcuts.find((shortcut) => shortcut.id === "high")?.href,
    ).toContain("priority=high");
    expect(
      inbox.priorityShortcuts.find((shortcut) => shortcut.id === "pricing-quote")
        ?.href,
    ).toContain("inbox=pricing-quote");
    expect(
      inbox.priorityShortcuts.find((shortcut) => shortcut.id === "low-automated")
        ?.href,
    ).toContain("priority=low");
  });

  it("filters by priority shortcut categories without changing hide-unimportant behavior", () => {
    const pricing = thread({
      body: "Can you send pricing today?",
      fromText: "Buyer <buyer@example.test>",
      id: "gmail_thread_pricing",
      subject: "Pricing question",
    });
    const marketing = thread({
      body: "Weekly newsletter. Unsubscribe or view in browser.",
      fromText: "newsletter@vendor.example",
      id: "gmail_thread_marketing",
      providerLabels: ["CATEGORY_PROMOTIONS"],
      subject: "Vendor digest",
    });

    expect(
      buildWorkInbox({
        selectedTab: "pricing-quote",
        threads: [pricing, marketing],
      }).visibleItems.map((item) => item.thread.subject),
    ).toEqual(["Pricing question"]);
    expect(
      buildWorkInbox({
        selectedTab: "low-automated",
        threads: [pricing, marketing],
      }).visibleItems.map((item) => item.thread.subject),
    ).toEqual(["Vendor digest"]);
    expect(
      buildWorkInbox({
        importanceFilter: "hide-unimportant",
        selectedTab: "low-automated",
        threads: [pricing, marketing],
      }).visibleItems,
    ).toEqual([]);
  });

  it("sorts direct customer questions ahead of automated marketing noise by priority", () => {
    const marketing = thread({
      body: "Please join our pricing webinar and download the contract checklist. Unsubscribe anytime.",
      fromText: "marketing@vendor.example",
      id: "gmail_thread_marketing",
      occurredAt: new Date("2030-01-02T12:00:00.000Z"),
      providerLabels: ["CATEGORY_PROMOTIONS"],
      subject: "Pricing webinar",
    });
    const customerQuestion = thread({
      body: "Can you send the updated quote today?",
      fromText: "Buyer <buyer@acme.example>",
      id: "gmail_thread_customer",
      linkedRecordLabel: "Deal: Acme",
      occurredAt: new Date("2030-01-01T12:00:00.000Z"),
      subject: "Updated quote",
    });

    const inbox = buildWorkInbox({
      sort: "priority",
      threads: [marketing, customerQuestion],
    });

    expect(inbox.visibleItems.map((item) => item.thread.subject)).toEqual([
      "Updated quote",
      "Pricing webinar",
    ]);
    expect(inbox.items.find((item) => item.thread.id === marketing.id)).toMatchObject({
      isUnimportant: true,
      priorityLevel: "low",
    });
  });

  it("keeps person-sent pricing and quote requests high priority", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Can you send pricing and a quote today?",
          fromText: "Founder <founder@startup.ai>",
          subject: "Pricing quote request",
        }),
      ],
    });

    expect(inbox.items[0]).toMatchObject({
      categories: expect.arrayContaining([
        "priority",
        "work",
        "needs-reply",
        "leads-opportunities",
      ]),
      detectedIntent: "Commercial opportunity",
      isUnimportant: false,
      priorityLevel: "high",
      tags: expect.arrayContaining(["Needs reply", "Pricing / quote"]),
    });
    expect(inbox.items[0].triageActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "draft-reply" }),
        expect.objectContaining({ id: "review-pricing" }),
      ]),
    );
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
        "Pricing / quote",
        "Contract / legal",
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
      tags: expect.arrayContaining([
        "Needs reply",
        "Pricing / quote",
        "No CRM link",
      ]),
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

  it("tracks waiting-on-customer threads from latest meaningful outbound messages", () => {
    const now = new Date("2030-01-06T12:00:00.000Z");
    const longWait = threadFromMessages({
      id: "gmail_thread_long_wait",
      linkedRecordLabel: "Deal: Acme",
      messages: [
        {
          body: "Can you send final procurement notes?",
          direction: "INBOUND",
          fromText: "Buyer <buyer@acme.example>",
          occurredAt: new Date("2030-01-01T09:00:00.000Z"),
          subject: "Procurement notes",
        },
        {
          body: "We sent the notes and are waiting on your procurement response.",
          direction: "OUTBOUND",
          fromText: "Sales <sales@northstar.example>",
          occurredAt: new Date("2030-01-02T09:00:00.000Z"),
          subject: "Re: Procurement notes",
          toText: "Buyer <buyer@acme.example>",
        },
      ],
      subject: "Procurement notes",
    });
    const shortWait = threadFromMessages({
      id: "gmail_thread_short_wait",
      messages: [
        {
          body: "I sent the proposal this morning for your review.",
          direction: "OUTBOUND",
          fromText: "Sales <sales@northstar.example>",
          occurredAt: new Date("2030-01-06T08:00:00.000Z"),
          subject: "Proposal review",
          toText: "Prospect <prospect@example.test>",
        },
      ],
      subject: "Proposal review",
    });

    const inbox = buildWorkInbox({
      now,
      selectedTab: "waiting-on-customer",
      threads: [shortWait, longWait],
    });

    expect(inbox.tabs.find((tab) => tab.id === "waiting-on-customer")).toMatchObject({
      count: 2,
      label: "Waiting on Customer",
    });
    expect(
      inbox.priorityShortcuts.find(
        (shortcut) => shortcut.id === "waiting-on-customer",
      ),
    ).toMatchObject({ count: 2, label: "Waiting on customer" });
    expect(inbox.visibleItems.map((item) => item.thread.subject)).toEqual([
      "Procurement notes",
      "Proposal review",
    ]);
    expect(inbox.visibleItems[0]).toMatchObject({
      categories: expect.arrayContaining(["waiting-on-customer"]),
      relatedRecordLabel: "Deal: Acme",
      suggestedNextAction:
        "Draft a follow-up reply or review the linked CRM record before nudging the customer.",
      tags: expect.arrayContaining(["Waiting on customer", "CRM linked"]),
      waitingOnCustomer: expect.objectContaining({
        accountState: "connected",
        bucket: "over-three-days",
        bucketLabel: "Over 3 days",
        waitLabel: "Waiting 4 days",
      }),
    });
    expect(inbox.visibleItems[0].waitingOnCustomer?.reason).toContain(
      "no newer meaningful inbound customer response is stored",
    );
    expect(inbox.visibleItems[0].triageActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "draft-reply", label: "Draft follow-up" }),
        expect.objectContaining({ id: "review-crm-record" }),
      ]),
    );
    expect(inbox.visibleItems[1].waitingOnCustomer).toMatchObject({
      bucket: "under-24h",
      waitLabel: "Waiting 4 hours",
    });
  });

  it("removes waiting state after a newer inbound customer response arrives", () => {
    const responded = threadFromMessages({
      id: "gmail_thread_responded",
      messages: [
        {
          body: "Checking whether you received the proposal.",
          direction: "OUTBOUND",
          fromText: "Sales <sales@northstar.example>",
          occurredAt: new Date("2030-01-02T09:00:00.000Z"),
          subject: "Proposal check-in",
          toText: "Buyer <buyer@example.test>",
        },
        {
          body: "Yes, we received it and will review tomorrow.",
          direction: "INBOUND",
          fromText: "Buyer <buyer@example.test>",
          occurredAt: new Date("2030-01-03T09:00:00.000Z"),
          subject: "Re: Proposal check-in",
        },
      ],
      subject: "Proposal check-in",
    });

    const inbox = buildWorkInbox({
      now: new Date("2030-01-06T12:00:00.000Z"),
      selectedTab: "waiting-on-customer",
      threads: [responded],
    });

    expect(inbox.items[0].waitingOnCustomer).toBeNull();
    expect(inbox.items[0].categories).not.toContain("waiting-on-customer");
    expect(inbox.visibleItems).toEqual([]);
  });

  it("excludes automated, no-reply, and ambiguous-direction traffic from waiting state", () => {
    const automatedOutbound = threadFromMessages({
      id: "gmail_thread_automated_wait",
      messages: [
        {
          body: "Receipt for your subscription. Status update only.",
          direction: "OUTBOUND",
          fromText: "No Reply <no-reply@northstar.example>",
          occurredAt: new Date("2030-01-02T09:00:00.000Z"),
          providerLabels: ["CATEGORY_PROMOTIONS"],
          subject: "Receipt and status update",
          toText: "Customer <customer@example.test>",
        },
      ],
      subject: "Receipt and status update",
    });
    const ambiguousDirection = threadFromMessages({
      id: "gmail_thread_ambiguous_wait",
      messages: [
        {
          body: "Follow-up without a trusted direction should not enter the queue.",
          direction: "UNKNOWN" as never,
          fromText: "Sales <sales@northstar.example>",
          occurredAt: new Date("2030-01-02T10:00:00.000Z"),
          subject: "Ambiguous direction",
          toText: "Customer <customer@example.test>",
        },
      ],
      subject: "Ambiguous direction",
    });

    const inbox = buildWorkInbox({
      now: new Date("2030-01-06T12:00:00.000Z"),
      selectedTab: "waiting-on-customer",
      threads: [automatedOutbound, ambiguousDirection],
    });

    expect(inbox.items.map((item) => item.waitingOnCustomer)).toEqual([
      null,
      null,
    ]);
    expect(inbox.visibleItems).toEqual([]);
  });

  it("marks stored disconnected-account threads conservatively when the latest meaningful message is outbound", () => {
    const inbox = buildWorkInbox({
      now: new Date("2030-01-04T12:00:00.000Z"),
      selectedTab: "waiting-on-customer",
      threads: [
        threadFromMessages({
          accountEmail: null,
          emailConnectionId: null,
          id: "gmail_thread_disconnected_wait",
          messages: [
            {
              body: "We sent the updated terms and are waiting on your signature.",
              direction: "OUTBOUND",
              fromText: "Sales <sales@northstar.example>",
              occurredAt: new Date("2030-01-02T12:00:00.000Z"),
              subject: "Updated terms",
              toText: "Buyer <buyer@example.test>",
            },
          ],
          subject: "Updated terms",
        }),
      ],
    });

    expect(inbox.visibleItems[0].waitingOnCustomer).toMatchObject({
      accountState: "disconnected",
      bucket: "one-to-three-days",
      waitLabel: "Waiting 2 days",
    });
    expect(inbox.visibleItems[0].waitingOnCustomer?.reason).toContain(
      "without an active inbox connection",
    );
  });

  it("keeps row tags compact and deterministic when a saved smart-label snapshot exists", () => {
    const inbox = buildWorkInbox({
      threads: [
        thread({
          body: "Can you send updated pricing and contract timing today?",
          smartLabelJson: {
            category: "CUSTOMER",
            confidence: 0.91,
            evidence: ["Provider evidence should stay in the reader."],
            signals: ["PRICING_QUOTE", "CONTRACT_LEGAL"],
            summary: "Provider summary should not become a row paragraph."
          },
          smartLabelProvider: "openai",
          subject: "Pricing and contract timing"
        })
      ]
    });

    expect(inbox.items[0].tags).toEqual(
      expect.arrayContaining(["Pricing / quote", "Contract / legal"])
    );
    expect(inbox.items[0].tags).not.toContain("Smart Label");
    expect(inbox.items[0].tags.join(" ")).not.toContain("Provider summary");
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
    expect(normalizeWorkInboxTab("pricing-quote")).toBe("pricing-quote");
    expect(normalizeWorkInboxTab("low-automated")).toBe("low-automated");
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
  smartLabelJson = null,
  smartLabelProvider = null,
  subject,
}: {
  body: string;
  fromText?: string;
  id?: string;
  isUnread?: boolean;
  linkedRecordLabel?: string | null;
  occurredAt?: Date;
  providerLabels?: string[];
  smartLabelJson?: unknown;
  smartLabelProvider?: string | null;
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
    smartLabelGeneratedAt: smartLabelProvider ? occurredAt : null,
    smartLabelJson,
    smartLabelProvider,
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

type ThreadMessageInput = {
  body: string;
  direction: EmailInboxThreadSummary["messages"][number]["direction"];
  fromText?: string;
  occurredAt: Date;
  providerLabels?: string[];
  subject: string;
  toText?: string;
};

function threadFromMessages({
  accountEmail = "me@example.test",
  emailConnectionId = "email_connection_1",
  id,
  linkedRecordLabel = null,
  messages,
  subject,
}: {
  accountEmail?: string | null;
  emailConnectionId?: string | null;
  id: string;
  linkedRecordLabel?: string | null;
  messages: ThreadMessageInput[];
  subject: string;
}): EmailInboxThreadSummary {
  const emailMessages = messages.map((source, index) => {
    const occurredAt = source.occurredAt;
    return {
      body: source.body,
      createdAt: occurredAt,
      createdBy: null,
      createdById: null,
      deal: linkedRecordLabel?.startsWith("Deal:")
        ? { id: "deal_1", title: linkedRecordLabel.replace("Deal: ", "") }
        : null,
      dealId: linkedRecordLabel?.startsWith("Deal:") ? "deal_1" : null,
      direction: source.direction,
      fromText: source.fromText ?? "sender@example.test",
      id: `${id}_email_${index + 1}`,
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
      providerLabels: source.providerLabels ?? [],
      providerMessageId: `${id}_message_${index + 1}`,
      providerSnippet: source.body.slice(0, 120),
      providerThreadId: id,
      smartLabelGeneratedAt: null,
      smartLabelJson: null,
      smartLabelProvider: null,
      subject: source.subject,
      toText: source.toText ?? "me@example.test",
      updatedAt: occurredAt,
      workspaceId: "workspace_1",
    } as EmailInboxThreadSummary["messages"][number];
  });
  const latestMessage = emailMessages[emailMessages.length - 1];

  return {
    accountEmail,
    emailConnectionId,
    emailConnectionRef: emailConnectionId ? "nection_1" : null,
    id,
    isUnread: false,
    latestAt: latestMessage.occurredAt,
    latestMessage,
    linkedRecordLabel,
    messageCount: emailMessages.length,
    messages: emailMessages,
    provider: "GOOGLE_WORKSPACE",
    subject,
  };
}
