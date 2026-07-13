import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Route } from "next";

import { describe, expect, it } from "vitest";

import {
  buildEmailPriorityQueue,
  buildEmailPriorityQueueSummary,
  emailFollowUpStateLabel,
  type EmailPriorityFollowUpDetail,
  normalizeEmailPriorityQueueFilter,
} from "@/lib/services/email-priority-queue-service";

const emailPriorityQueueService = readFileSync(
  join(process.cwd(), "lib/services/email-priority-queue-service.ts"),
  "utf8",
);
const emailPage = readFileSync(
  join(process.cwd(), "app/email/page.tsx"),
  "utf8",
);
const currentStatus = readFileSync(
  join(process.cwd(), "docs/current-status.md"),
  "utf8",
);

describe("Relationship Inbox priority queue", () => {
  it("filters classified emails by urgent, needs-reply, and relationship-risk signals", () => {
    const emailLogs = [
      sampleEmailLog("urgent_1", "Urgent renewal", ["URGENT", "NEEDS_REPLY"]),
      sampleEmailLog("risk_1", "Risk note", [
        "RELATIONSHIP_RISK",
        "FOLLOW_UP_NEEDED",
      ]),
      sampleEmailLog("quote_1", "Quote question", ["PRICING_QUOTE"]),
      sampleEmailLog("noise_1", "Internal FYI", [], "INTERNAL"),
    ];
    const followUpStates = new Map([
      ["urgent_1", "created" as const],
      ["risk_1", "completed" as const],
    ]);
    const followUpDetails = new Map<string, EmailPriorityFollowUpDetail>([
      [
        "urgent_1",
        {
          followUps: [
            {
              completedAt: null,
              dueAt: new Date("2030-01-04T00:00:00.000Z"),
              href: "/activities/activity_urgent/edit?returnTo=%2Femail" as Route,
              id: "activity_urgent",
              linkedRecord: {
                href: "/deals/deal_urgent_1" as Route,
                label: "Deal urgent_1",
                type: "deal" as const,
              },
              source: "durable" as const,
              status: "open" as const,
              title: "Urgent activity",
            },
          ],
          state: "created" as const,
        },
      ],
    ]);

    expect(
      buildEmailPriorityQueue({
        emailLogs,
        filter: "urgent",
        followUpStates,
      }).map((item) => item.emailLog.id),
    ).toEqual(["urgent_1"]);
    expect(
      buildEmailPriorityQueue({
        emailLogs,
        filter: "needs-reply",
        followUpStates,
      }).map((item) => item.emailLog.id),
    ).toEqual(["urgent_1"]);
    expect(
      buildEmailPriorityQueue({
        emailLogs,
        filter: "relationship-risk",
        followUpStates,
      }).map((item) => item.emailLog.id),
    ).toEqual(["risk_1"]);
    expect(
      buildEmailPriorityQueue({ emailLogs, followUpStates }).map(
        (item) => item.emailLog.id,
      ),
    ).toEqual(["risk_1", "urgent_1", "quote_1"]);
    const urgentItem = buildEmailPriorityQueue({
      emailLogs,
      filter: "urgent",
      followUpDetails,
      followUpStates,
    })[0];
    expect(urgentItem).toMatchObject({
      followUps: [
        {
          href: "/activities/activity_urgent/edit?returnTo=%2Femail",
          source: "durable",
          status: "open",
          title: "Urgent activity",
        },
      ],
      followUpState: "created",
      labels: ["Customer", "Urgent", "Needs reply"],
      explainer: {
        actionExplanation: {
          action: "draft_reply",
          category: expect.objectContaining({
            key: "CUSTOMER",
            label: "Customer",
          }),
          contributingSignals: expect.arrayContaining([
            expect.objectContaining({ key: "URGENT", label: "Urgent" }),
            expect.objectContaining({
              key: "NEEDS_REPLY",
              label: "Needs reply",
            }),
          ]),
          crmState: expect.objectContaining({
            label: "Linked to deal: Deal urgent_1",
            linked: true,
          }),
          followUpState: expect.objectContaining({
            openCount: 1,
            source: "durable",
            state: "created",
          }),
          headline: "Draft reply because Customer appears to need a response.",
          reason: expect.stringContaining("reviewed reply draft"),
        },
        evidence: expect.arrayContaining([
          expect.objectContaining({
            label: "Category: Customer",
            source: "smart_label",
          }),
          expect.objectContaining({
            label: "Signal: Urgent",
            source: "smart_label",
          }),
          expect.objectContaining({
            label: "Signal: Needs reply",
            source: "smart_label",
          }),
          expect.objectContaining({
            label: "Linked to deal: Deal urgent_1",
            source: "crm_link",
          }),
          expect.objectContaining({
            label: "Open durable linked follow-up exists",
            source: "durable_follow_up",
          }),
        ]),
        detailHref: "#email-evidence-urgent_1",
        headline: "Queued by reply-sensitive saved labels.",
        sources: expect.arrayContaining([
          "smart_label",
          "crm_link",
          "durable_follow_up",
        ]),
      },
      nextBestAction: {
        action: "draft_reply",
        href: "#email-card-urgent_1",
        label: "Draft reply",
        severity: "high",
        target: "email_card",
      },
      priorityLabel: "Urgent",
    });
    expect(urgentItem.explainer.trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "CUSTOMER",
          id: "category-CUSTOMER",
          reason: expect.stringContaining("Saved Smart Label category"),
          type: "category",
        }),
        expect.objectContaining({
          id: "signal-URGENT",
          reason: expect.stringContaining("Saved Smart Label signal"),
          signal: "URGENT",
          target: expect.objectContaining({
            href: "#email-evidence-urgent_1",
            kind: "email_evidence",
          }),
          type: "signal",
        }),
        expect.objectContaining({
          followUp: expect.objectContaining({
            id: "activity_urgent",
            source: "durable",
            status: "open",
          }),
          reason: expect.stringContaining("EmailLogActivityLink"),
          target: expect.objectContaining({
            href: "/activities/activity_urgent/edit?returnTo=%2Femail",
            kind: "linked_follow_up",
          }),
          type: "follow_up",
        }),
        expect.objectContaining({
          label: "Recommended action: Draft reply",
          reason: expect.stringContaining("reviewed reply draft"),
          type: "next_best_action",
        }),
      ]),
    );
  });

  it("recommends deterministic next-best actions from labels, CRM links, and follow-up state", () => {
    const openFollowUp = {
      completedAt: null,
      dueAt: new Date("2030-01-05T00:00:00.000Z"),
      href: "/activities/activity_open/edit?returnTo=%2Femail" as Route,
      id: "activity_open",
      linkedRecord: {
        href: "/deals/deal_open" as Route,
        label: "Open Deal",
        type: "deal" as const,
      },
      source: "durable" as const,
      status: "open" as const,
      title: "Open linked follow-up",
    };
    const completedFollowUp = {
      ...openFollowUp,
      completedAt: new Date("2030-01-06T12:00:00.000Z"),
      href: "/activities/activity_completed/edit?returnTo=%2Femail" as Route,
      id: "activity_completed",
      status: "completed" as const,
      title: "Completed linked follow-up",
    };
    const legacyFollowUp = {
      ...openFollowUp,
      href: "/activities/activity_legacy/edit?returnTo=%2Femail" as Route,
      id: "activity_legacy",
      source: "legacy" as const,
      title: "Legacy marker follow-up",
    };
    const emailLogs = [
      sampleEmailLog("unclassified_1", "Needs classification", [], "CUSTOMER", {
        classified: false,
      }),
      sampleEmailLog(
        "lead_1",
        "Potential lead",
        ["POTENTIAL_LEAD"],
        "PROSPECT",
        { linked: false },
      ),
      sampleEmailLog("reply_1", "Customer question", ["NEEDS_REPLY"]),
      sampleEmailLog(
        "commercial_1",
        "Pricing and contract",
        ["URGENT", "PRICING_QUOTE", "CONTRACT_LEGAL"],
        "CUSTOMER",
        {
          structuredEvidence: true,
        },
      ),
      sampleEmailLog("follow_1", "Follow up please", ["FOLLOW_UP_NEEDED"]),
      sampleEmailLog("open_1", "Already has follow-up", ["FOLLOW_UP_NEEDED"]),
      sampleEmailLog("completed_1", "Done follow-up", ["FOLLOW_UP_NEEDED"]),
      sampleEmailLog("legacy_1", "Legacy marker", ["FOLLOW_UP_NEEDED"]),
      sampleEmailLog("risk_1", "Risk note", ["RELATIONSHIP_RISK"]),
    ];
    const followUpDetails = new Map<string, EmailPriorityFollowUpDetail>([
      ["open_1", { followUps: [openFollowUp], state: "created" }],
      ["completed_1", { followUps: [completedFollowUp], state: "completed" }],
      ["legacy_1", { followUps: [legacyFollowUp], state: "created" }],
    ]);
    const byId = new Map(
      buildEmailPriorityQueue({ emailLogs, followUpDetails }).map((item) => [
        item.emailLog.id,
        item,
      ]),
    );

    expect(byId.get("unclassified_1")).toMatchObject({
      classification: null,
      labels: ["Unclassified"],
      nextBestAction: {
        action: "classify_email",
        href: "#email-card-unclassified_1",
        label: "Classify email",
        severity: "medium",
        target: "email_card",
      },
      priorityLabel: "Unclassified",
    });
    expect(byId.get("unclassified_1")?.explainer).toMatchObject({
      actionExplanation: {
        action: "classify_email",
        contributingSignals: [],
        headline: "Classify first before choosing a relationship action.",
        reason: expect.stringContaining("No Smart Label snapshot exists yet"),
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({
          label: "Unclassified email",
          source: "smart_label",
        }),
        expect.objectContaining({
          label: "Linked to deal: Deal unclassified_1",
          source: "crm_link",
        }),
      ]),
      headline:
        "Queued because the email is unclassified but relationship-relevant.",
      trail: expect.arrayContaining([
        expect.objectContaining({
          id: "smart-label-unclassified",
          reason: expect.stringContaining("No Smart Label snapshot"),
          type: "unclassified",
        }),
      ]),
    });
    expect(
      buildEmailPriorityQueue({
        emailLogs,
        filter: "needs-reply",
        followUpDetails,
      }).map((item) => item.emailLog.id),
    ).toEqual(["reply_1"]);
    expect(byId.get("lead_1")?.nextBestAction).toMatchObject({
      action: "review_potential_lead",
      label: "Review potential lead",
      reason: expect.stringContaining("not linked to a CRM record"),
      severity: "high",
    });
    expect(byId.get("lead_1")?.explainer.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Signal: Potential lead",
          source: "smart_label",
        }),
        expect.objectContaining({
          label: "No CRM record linked",
          source: "crm_link",
        }),
      ]),
    );
    expect(byId.get("lead_1")?.explainer.actionExplanation).toMatchObject({
      action: "review_potential_lead",
      contributingSignals: [
        expect.objectContaining({
          key: "POTENTIAL_LEAD",
          label: "Potential lead",
        }),
      ],
      crmState: expect.objectContaining({ linked: false }),
      headline: "Review potential lead and link CRM context before acting.",
      reason: expect.stringContaining("linking CRM context before action"),
    });
    expect(byId.get("reply_1")?.nextBestAction).toMatchObject({
      action: "draft_reply",
      label: "Draft reply",
      severity: "medium",
    });
    expect(byId.get("reply_1")?.explainer.actionExplanation).toMatchObject({
      action: "draft_reply",
      contributingSignals: [
        expect.objectContaining({ key: "NEEDS_REPLY", label: "Needs reply" }),
      ],
      reason: expect.stringContaining("reviewed reply draft"),
    });
    expect(byId.get("commercial_1")?.explainer.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Signal: Urgent",
          source: "smart_label",
        }),
        expect.objectContaining({
          label: "Signal: Pricing / quote",
          source: "smart_label",
        }),
        expect.objectContaining({
          label: "Signal: Contract / legal",
          source: "smart_label",
        }),
        expect.objectContaining({
          label: "Evidence: Evidence for Pricing and contract.",
          source: "smart_label",
        }),
      ]),
    );
    expect(byId.get("commercial_1")?.explainer.trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "CUSTOMER",
          excerpts: ["Category excerpt for Pricing and contract."],
          reason: "Category reason for Pricing and contract.",
          type: "category",
        }),
        expect.objectContaining({
          excerpts: ["Signal excerpt for URGENT."],
          reason: "Signal reason for URGENT.",
          signal: "URGENT",
          type: "signal",
        }),
        expect.objectContaining({
          excerpts: ["Signal excerpt for PRICING_QUOTE."],
          reason: "Signal reason for PRICING_QUOTE.",
          signal: "PRICING_QUOTE",
          type: "signal",
        }),
        expect.objectContaining({
          excerpt: "Evidence for Pricing and contract.",
          id: "saved-excerpt-1",
          reason: expect.stringContaining("Exact text offsets are not stored"),
          type: "saved_excerpt",
        }),
      ]),
    );
    expect(
      byId.get("commercial_1")?.explainer.actionExplanation.contributingSignals,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          excerpts: ["Signal excerpt for URGENT."],
          key: "URGENT",
          reason: "Signal reason for URGENT.",
        }),
        expect.objectContaining({
          excerpts: ["Signal excerpt for PRICING_QUOTE."],
          key: "PRICING_QUOTE",
          reason: "Signal reason for PRICING_QUOTE.",
        }),
      ]),
    );
    expect(byId.get("follow_1")?.nextBestAction).toMatchObject({
      action: "review_follow_up",
      label: "Review follow-up",
      reason: expect.stringContaining("no linked follow-up exists yet"),
    });
    expect(byId.get("follow_1")?.explainer.actionExplanation).toMatchObject({
      action: "review_follow_up",
      contributingSignals: [
        expect.objectContaining({
          key: "FOLLOW_UP_NEEDED",
          label: "Follow-up needed",
        }),
      ],
      followUpState: expect.objectContaining({
        openCount: 0,
        state: "unknown",
      }),
      headline:
        "Review follow-up because suggested work has no linked activity yet.",
      reason: expect.stringContaining(
        "no linked follow-up activity exists yet",
      ),
    });
    expect(byId.get("open_1")?.nextBestAction).toMatchObject({
      action: "mark_follow_up_complete",
      followUp: expect.objectContaining({
        id: "activity_open",
        status: "open",
      }),
      href: "/activities/activity_open/edit?returnTo=%2Femail",
      label: "Mark follow-up complete",
      target: "linked_follow_up",
    });
    expect(byId.get("open_1")?.explainer.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Open durable linked follow-up exists",
          source: "durable_follow_up",
        }),
      ]),
    );
    expect(byId.get("open_1")?.explainer.actionExplanation).toMatchObject({
      action: "mark_follow_up_complete",
      contributingSignals: [
        expect.objectContaining({ key: "FOLLOW_UP_NEEDED" }),
      ],
      followUpState: expect.objectContaining({
        openCount: 1,
        source: "durable",
        state: "created",
      }),
      headline: "Mark complete because linked follow-up work is still open.",
      reason: expect.stringContaining("instead of creating a duplicate"),
    });
    expect(byId.get("completed_1")?.nextBestAction).toMatchObject({
      action: "no_action_needed",
      label: "No action needed",
      reason: expect.stringContaining("All linked follow-ups are completed"),
      severity: "low",
    });
    expect(byId.get("completed_1")?.explainer.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Durable linked follow-up detected",
          source: "durable_follow_up",
        }),
        expect.objectContaining({
          label: "All linked follow-ups completed",
          source: "durable_follow_up",
        }),
      ]),
    );
    expect(byId.get("completed_1")?.explainer.trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          followUp: expect.objectContaining({
            id: "activity_completed",
            status: "completed",
          }),
          label: "All linked follow-ups completed",
          source: "durable_follow_up",
          type: "follow_up",
        }),
      ]),
    );
    expect(byId.get("completed_1")?.explainer.actionExplanation).toMatchObject({
      action: "no_action_needed",
      followUpState: expect.objectContaining({
        completedCount: 1,
        openCount: 0,
        source: "durable",
        state: "completed",
      }),
      reason: expect.stringContaining("no duplicate follow-up is recommended"),
    });
    expect(byId.get("legacy_1")?.explainer.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Legacy follow-up marker detected",
          source: "legacy_follow_up",
        }),
      ]),
    );
    expect(byId.get("legacy_1")?.explainer.trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          followUp: expect.objectContaining({
            id: "activity_legacy",
            source: "legacy",
          }),
          reason: expect.stringContaining(
            "older same-record activity description marker",
          ),
          source: "legacy_follow_up",
          type: "follow_up",
        }),
      ]),
    );
    expect(byId.get("legacy_1")?.explainer.actionExplanation).toMatchObject({
      action: "mark_follow_up_complete",
      followUpState: expect.objectContaining({ source: "legacy" }),
      reason: expect.stringContaining("legacy marker-matched"),
    });
    expect(byId.get("risk_1")?.nextBestAction).toMatchObject({
      action: "review_relationship_risk",
      label: "Review relationship risk",
      severity: "high",
    });
    expect(byId.get("risk_1")?.explainer).toMatchObject({
      actionExplanation: {
        action: "review_relationship_risk",
        contributingSignals: [
          expect.objectContaining({
            key: "RELATIONSHIP_RISK",
            label: "Relationship risk",
          }),
        ],
        headline:
          "Review relationship risk before drafting or advancing the deal.",
        reason: expect.stringContaining("reviewing relationship context"),
      },
      evidence: expect.arrayContaining([
        expect.objectContaining({
          label: "Signal: Relationship risk",
          source: "smart_label",
        }),
      ]),
      headline: "Queued by relationship-risk signal.",
    });
  });

  it("builds queue summary counts and normalizes invalid filters safely", () => {
    const emailLogs = [
      sampleEmailLog("urgent_1", "Urgent renewal", ["URGENT", "NEEDS_REPLY"]),
      sampleEmailLog("risk_1", "Risk note", ["RELATIONSHIP_RISK"]),
      sampleEmailLog("lead_1", "New lead", ["POTENTIAL_LEAD"], "PROSPECT"),
    ];
    const summary = buildEmailPriorityQueueSummary(emailLogs);

    expect(summary.find((item) => item.id === "all")).toMatchObject({
      count: 3,
      href: "/email?inbox=all",
    });
    expect(summary.find((item) => item.id === "urgent")).toMatchObject({
      count: 1,
    });
    expect(summary.find((item) => item.id === "needs-reply")).toMatchObject({
      count: 1,
    });
    expect(
      summary.find((item) => item.id === "relationship-risk"),
    ).toMatchObject({ count: 1 });
    expect(summary.find((item) => item.id === "potential-leads")).toMatchObject(
      { count: 1 },
    );
    expect(summary.find((item) => item.id === "prospects")).toMatchObject({
      count: 1,
    });
    expect(normalizeEmailPriorityQueueFilter("not-real")).toBe("all");
    expect(emailFollowUpStateLabel("created")).toBe("Follow-up created");
    expect(emailFollowUpStateLabel("completed")).toBe("Follow-up completed");
    expect(emailFollowUpStateLabel("none")).toBe("No follow-up created");
    expect(emailFollowUpStateLabel("unknown")).toBe("Unknown");
  });

  it("renders a focused queue in Inbox without adding automatic mutation", () => {
    expect(emailPage).toContain("Relationship Inbox Queue");
    expect(emailPage).toContain("normalizeEmailPriorityQueueFilter(");
    expect(emailPage).toContain("resolvedSearchParams?.inbox");
    expect(emailPage).toContain(
      "buildEmailPriorityQueueSummary(recentEmailLogs)",
    );
    expect(emailPage).toContain("buildEmailPriorityQueue({");
    expect(emailPage).toContain("listEmailPriorityFollowUpDetails(");
    expect(emailPage).toContain("recentEmailLogs");
    expect(emailPage).toContain(
      "followUpDetail={followUpDetails.get(emailLog.id)}",
    );
    expect(emailPage).toContain("Relationship Inbox priority filters");
    expect(emailPage).toContain("Draft reply");
    expect(emailPage).toContain("Open follow-up");
    expect(emailPage).toContain("RelationshipInboxNextBestAction");
    expect(emailPage).toContain("RelationshipInboxQueueExplainer");
    expect(emailPage).toContain("RelationshipInboxEvidenceDetail");
    expect(emailPage).toContain("RelationshipInboxEvidenceTrailItem");
    expect(emailPage).toContain("RelationshipInboxEvidenceDrilldown");
    expect(emailPage).toContain("RelationshipInboxActionExplanationDetail");
    expect(emailPage).toContain("Why this?");
    expect(emailPage).toContain("Why this action?");
    expect(emailPage).toContain("View evidence");
    expect(emailPage).toContain("relationshipInboxActionHref");
    expect(emailPage).toContain("emailDraftReviewHref");
    expect(emailPage).toContain("emailFollowUpReviewHref");
    expect(emailPage).toContain("relationship-inbox-state-strip");
    expect(emailPage).toContain("Next: {item.nextBestAction.label}");
    expect(emailPage).toContain("EmailSourceMessageFacts");
    expect(emailPage).toContain("source message context");
    expect(emailPage).toContain("CRM link");
    expect(emailPage).toContain("email-source-facts");
    expect(emailPage).toContain("email-action-anchor");
    expect(emailPage).toContain("priorityExplainersByEmailId");
    expect(emailPage).toContain("showEvidenceAnchor");
    expect(emailPage).toContain("email-evidence-${emailLog.id}");
    expect(emailPage).toContain("Full Relationship Inbox evidence");
    expect(emailPage).toContain("Category evidence");
    expect(emailPage).toContain("Signal evidence");
    expect(emailPage).toContain("CRM, follow-up, and action trail");
    expect(emailPage).toContain("Signals contributing to recommended action");
    expect(emailPage).toContain("Follow-up state");
    expect(emailPage).toContain("Supporting excerpts");
    expect(emailPage).toContain("Exact source text offsets");
    expect(emailPage.match(/Exact source text offsets/g)?.length).toBe(1);
    expect(emailPage).toContain("not stored");
    expect(emailPage).toContain("No signal-specific excerpt is saved");
    expect(emailPage).toContain("relationship-inbox-explainer");
    expect(emailPage).toContain("relationship-inbox-evidence-detail");
    expect(emailPage).toContain("relationship-inbox-evidence-drilldown");
    expect(emailPage).toContain("relationship-inbox-action-detail");
    expect(emailPage).toContain("relationship-inbox-action-chain");
    expect(emailPage).toContain("relationship-inbox-action-signal-map");
    expect(emailPage).toContain("uniqueEvidenceExcerpts");
    expect(emailPage).toContain("relationship-inbox-evidence-trail");
    expect(emailPage).toContain("relationship-inbox-evidence-excerpt");
    expect(emailPage).toContain("item.explainer");
    expect(emailPage).toContain("emailEvidenceSourceLabel");
    expect(emailPage).toContain("relationship-inbox-next-action");
    expect(emailPage).toContain("relationship-inbox-next-action-badges");
    expect(emailPage).toContain("item.nextBestAction");
    expect(emailPage).toContain("item.explainer.actionExplanation");
    expect(emailPage).toContain("actionExplanation.contributingSignals");
    expect(emailPage).toContain("workspaceId={workspace.id}");
    expect(emailPage).toContain("emailNextBestActionSeverityLabel");
    expect(emailPage).toContain('action.action === "mark_follow_up_complete"');
    expect(emailPage).toContain(
      "Mark recommended follow-up activity ${action.followUp.title} complete",
    );
    expect(emailPage).toContain("No Smart Label saved yet.");
    expect(emailPage).toContain("primaryLabel");
    expect(emailPage).toContain('action.action === "no_action_needed"');
    expect(emailPage).toContain('"Review email"');
    expect(emailPage).toContain("action.label");
    expect(emailPage).toContain("EmailLinkedFollowUps");
    expect(emailPage).toContain("emailLinkedFollowUpStatusLabel");
    expect(emailPage).toContain(
      'import { ActivityCompleteButton } from "@/components/activity-complete-button"',
    );
    expect(emailPage).toContain('followUp.status === "open" ?');
    expect(emailPage).toContain(
      "Mark linked follow-up activity ${followUp.title} complete",
    );
    expect(emailPage).toContain("workspaceId={workspaceId}");
    expect(emailPriorityQueueService).toContain(
      "prisma.emailLogActivityLink.findMany",
    );
    expect(emailPriorityQueueService).toContain(
      "listEmailPriorityFollowUpDetails",
    );
    expect(emailPriorityQueueService).toContain("EmailPriorityNextBestAction");
    expect(emailPriorityQueueService).toContain("EmailPriorityQueueExplainer");
    expect(emailPriorityQueueService).toContain(
      "EmailPriorityActionExplanation",
    );
    expect(emailPriorityQueueService).toContain(
      "EmailPriorityQueueEvidenceTrailItem",
    );
    expect(emailPriorityQueueService).toContain(
      "EmailPriorityQueueEvidenceTarget",
    );
    expect(emailPriorityQueueService).toContain("emailPriorityQueueExplainer");
    expect(emailPriorityQueueService).toContain(
      "emailPriorityActionExplanation",
    );
    expect(emailPriorityQueueService).toContain("actionContributingSignals");
    expect(emailPriorityQueueService).toContain("emailPriorityActionReason");
    expect(emailPriorityQueueService).toContain(
      "no duplicate follow-up is recommended",
    );
    expect(emailPriorityQueueService).toContain("trail.push");
    expect(emailPriorityQueueService).toContain("detailHref");
    expect(emailPriorityQueueService).toContain("emailEvidenceHref");
    expect(emailPriorityQueueService).toContain(
      "Exact text offsets are not stored",
    );
    expect(emailPriorityQueueService).toContain(
      "Saved supporting excerpt from the Smart Label snapshot",
    );
    expect(emailPriorityQueueService).toContain(
      "classification.signalEvidence.find",
    );
    expect(emailPriorityQueueService).toContain(
      "classification.categoryEvidence",
    );
    expect(emailPriorityQueueService).toContain(
      "Flat saved evidence is retained for backward compatibility",
    );
    expect(emailPriorityQueueService).toContain(
      "Signal: ${emailSmartSignalLabel(signal)}",
    );
    expect(emailPriorityQueueService).toContain(
      "Legacy follow-up marker detected",
    );
    expect(emailPriorityQueueService).toContain(
      "Open durable linked follow-up exists",
    );
    expect(emailPriorityQueueService).toContain(
      "All linked follow-ups completed",
    );
    expect(emailPriorityQueueService).toContain("emailPriorityNextBestAction");
    expect(emailPriorityQueueService).toContain("mark_follow_up_complete");
    expect(emailPriorityQueueService).toContain('severity: "high"');
    expect(emailPriorityQueueService).toContain('target: "linked_follow_up"');
    expect(emailPriorityQueueService).toContain(
      "No Smart Label has been saved yet",
    );
    expect(emailPriorityQueueService).toContain(
      "An open linked follow-up already exists",
    );
    expect(emailPriorityQueueService).toContain(
      "All linked follow-ups are completed",
    );
    expect(emailPriorityQueueService).toContain("followUps: linkedActivities");
    expect(emailPriorityQueueService).toContain(
      "source: EmailLinkedFollowUpSource",
    );
    expect(emailPriorityQueueService).toContain("linkedEmailLogIds");
    expect(emailPriorityQueueService).toContain(
      "Source email: ${emailLog.subject}",
    );
    expect(emailPriorityQueueService).not.toContain("createActivity(");
    expect(emailPriorityQueueService).not.toContain("classifyEmailLog(");
    expect(emailPriorityQueueService).not.toContain("sendMail");
    expect(currentStatus).toContain("Relationship Inbox Queue");
    expect(currentStatus).toContain("deterministic next-best-action summary");
    expect(currentStatus).toContain(
      "follow-up state uses `EmailLogActivityLink` first",
    );
    expect(currentStatus).toContain(
      'Deterministic next-best-action and "why this?" rules prefer durable linked follow-ups',
    );
  });
});

function sampleEmailLog(
  id: string,
  subject: string,
  signals: string[],
  category = "CUSTOMER",
  options: {
    classified?: boolean;
    linked?: boolean;
    structuredEvidence?: boolean;
  } = {},
) {
  const linked = options.linked !== false;
  const classified = options.classified !== false;
  return {
    body: "Customer context.",
    deal: linked ? { id: `deal_${id}`, title: `Deal ${id}` } : null,
    dealId: linked ? `deal_${id}` : null,
    direction: "INBOUND" as const,
    fromText: "Buyer <buyer@example.test>",
    id,
    lead: null,
    leadId: null,
    occurredAt: new Date(
      `2030-01-0${id === "quote_1" ? "3" : id === "risk_1" ? "2" : "1"}T12:00:00.000Z`,
    ),
    organization: null,
    organizationId: null,
    person: linked
      ? {
          email: "buyer@example.test",
          firstName: "Buyer",
          id: `person_${id}`,
          lastName: "Contact",
        }
      : null,
    personId: linked ? `person_${id}` : null,
    smartLabelGeneratedAt: classified
      ? new Date("2030-01-01T12:00:00.000Z")
      : null,
    smartLabelJson: classified
      ? {
          category,
          ...(options.structuredEvidence
            ? {
                categoryEvidence: {
                  excerpts: [`Category excerpt for ${subject}.`],
                  reason: `Category reason for ${subject}.`,
                },
                signalEvidence: signals.map((signal) => ({
                  excerpts: [`Signal excerpt for ${signal}.`],
                  reason: `Signal reason for ${signal}.`,
                  signal,
                })),
              }
            : {}),
          confidence: 0.8,
          evidence: [`Evidence for ${subject}.`],
          signals,
          summary: `${subject} summary.`,
        }
      : null,
    smartLabelProvider: classified ? "test-provider" : null,
    subject,
    toText: "sales@example.test",
  };
}
