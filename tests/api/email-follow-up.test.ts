import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildEmailFollowUpDraftFromEmailLog } from "@/lib/services/email-follow-up-service";

const emailFollowUpService = readFileSync(join(process.cwd(), "lib/services/email-follow-up-service.ts"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const emailFollowUpPanel = readFileSync(join(process.cwd(), "components/email-follow-up-panel.tsx"), "utf8");
const emailActions = readFileSync(join(process.cwd(), "app/email/actions.ts"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("Relationship Inbox email follow-up workflow", () => {
  it("builds editable follow-up defaults from saved smart labels and linked deal context", () => {
    const draft = buildEmailFollowUpDraftFromEmailLog(
      {
        ...sampleEmailLog(),
        smartLabelGeneratedAt: new Date("2026-07-06T12:00:00.000Z"),
        smartLabelJson: {
          category: "CUSTOMER",
          confidence: 0.92,
          evidence: ["Customer asks for urgent quote timing."],
          signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE"],
          summary: "Urgent customer pricing email that needs a reply."
        },
        smartLabelProvider: "openai"
      },
      { now: new Date("2026-07-06T15:00:00.000Z") }
    );

    expect(draft).toMatchObject({
      dueAt: "2026-07-06",
      emailLogId: "email_1",
      hasSavedLabels: true,
      labels: ["Customer", "Urgent", "Needs reply", "Pricing / quote"],
      target: {
        field: "dealId",
        href: "/deals/deal_1",
        id: "deal_1",
        label: "Deal: Acme Expansion",
        type: "deal"
      },
      title: "Follow up on pricing: Quote timing",
      type: "EMAIL"
    });
    expect(draft.description).toContain("Saved labels: Customer, Urgent, Needs reply, Pricing / quote");
    expect(draft.description).toContain("Why: Urgent customer pricing email");
    expect(draft.description).toContain("- Customer asks for urgent quote timing.");
  });

  it("uses conservative editable defaults when no smart labels are saved", () => {
    const draft = buildEmailFollowUpDraftFromEmailLog(sampleEmailLog(), {
      now: new Date("2026-07-10T15:00:00.000Z")
    });

    expect(draft.hasSavedLabels).toBe(false);
    expect(draft.labels).toEqual([]);
    expect(draft.dueAt).toBe("2026-07-13");
    expect(draft.title).toBe("Follow up: Quote timing");
    expect(draft.description).toContain("Saved labels: none yet; using conservative manual follow-up defaults.");
  });

  it("keeps the workflow review-first and routes creation through the existing activity service", () => {
    expect(emailFollowUpService).toContain("buildEmailFollowUpDraftFromEmailLog");
    expect(emailFollowUpService).toContain("createActivity(actor");
    expect(emailFollowUpService).toContain("prisma.emailLogActivityLink.create");
    expect(emailFollowUpService).not.toContain("prisma.activity.create");
    expect(emailFollowUpService).not.toContain("classifyEmailLog(");
    expect(emailFollowUpService).not.toContain("generateEmailReplyDraft(");
    expect(emailPage).toContain('import { EmailFollowUpPanel } from "@/components/email-follow-up-panel"');
    expect(emailPage).toContain("<EmailFollowUpPanel");
    expect(emailPage).toContain("Review follow-up");
    expect(emailFollowUpPanel).toContain("Nothing is created until you save this follow-up.");
    expect(emailFollowUpPanel).toContain("No saved Smart Labels yet; using conservative manual defaults.");
    expect(emailFollowUpPanel).toContain("Create activity");
    expect(emailActions).toContain("createEmailFollowUpActivityAction");
    expect(emailActions).toContain("createEmailFollowUpActivity(actor");
    expect(currentStatus).toContain("Relationship Inbox follow-up drafting");
    expect(currentStatus).toContain("EmailLogActivityLink");
  });
});

function sampleEmailLog() {
  return {
    body: "Gmail snippet: Can you confirm quote timing today?",
    deal: { id: "deal_1", title: "Acme Expansion" },
    dealId: "deal_1",
    direction: "INBOUND" as const,
    fromText: "Maya Buyer <maya@example.test>",
    id: "email_1",
    lead: null,
    leadId: null,
    occurredAt: new Date("2026-07-06T12:00:00.000Z"),
    organization: { id: "org_1", name: "Acme" },
    organizationId: "org_1",
    person: { email: "maya@example.test", firstName: "Maya", id: "person_1", lastName: "Buyer" },
    personId: "person_1",
    smartLabelGeneratedAt: null,
    smartLabelJson: null,
    smartLabelProvider: null,
    subject: "Quote timing",
    toText: "sales@example.test"
  };
}
