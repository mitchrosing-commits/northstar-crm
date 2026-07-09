import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDealRiskAssistantAnswer,
  buildEmailReplyAssistantAnswer,
  buildTodayAssistantAnswer,
  buildUnsupportedAssistantAnswer,
  parseAssistantCommand
} from "@/lib/services/assistant/assistant-command-service";
import type {
  AssistantDealRiskContext,
  AssistantEmailReplyContext,
  AssistantTodayContext
} from "@/lib/services/assistant/assistant-context-service";

const assistantPage = readFileSync(join(process.cwd(), "app/assistant/page.tsx"), "utf8");
const assistantConsole = readFileSync(join(process.cwd(), "components/assistant-console.tsx"), "utf8");
const commandService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-command-service.ts"), "utf8");
const contextService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-context-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

describe("read-only Northstar Assistant command service", () => {
  it("parses the three supported deterministic commands", () => {
    expect(parseAssistantCommand("Tell me what I have to do today.")).toEqual({ kind: "today" });
    expect(parseAssistantCommand("Show me the highest-risk deals this week.")).toEqual({ kind: "deal_risk" });
    expect(parseAssistantCommand("Check whether Mike Fox replied to my recent email.")).toEqual({
      kind: "email_reply_check",
      target: "Mike Fox"
    });
    expect(parseAssistantCommand("Create a deal and send a quote.")).toEqual({ kind: "unsupported" });
  });

  it("answers today's agenda from deterministic activity buckets", () => {
    const answer = buildTodayAssistantAnswer(sampleTodayContext(), "Tell me what I have to do today.");

    expect(answer.command).toBe("today");
    expect(answer.reviewFirst).toBe(true);
    expect(answer.safetyNotice).toContain("does not create, update, delete");
    expect(answer.summary).toContain("1 overdue, 1 due today, 1 upcoming, 1 unscheduled");
    expect(answer.items.map((item) => item.label)).toEqual(["Overdue", "Due today", "Upcoming", "No due date"]);
    expect(answer.sources.map((source) => source.label)).toContain("Activity queue");
    expect(JSON.stringify(answer)).not.toMatch(secretOrRawProviderTerms);
  });

  it("ranks highest-risk deals without editing deals", () => {
    const answer = buildDealRiskAssistantAnswer(sampleDealRiskContext(), "Show me the highest-risk deals this week.");

    expect(answer.command).toBe("deal_risk");
    expect(answer.reviewFirst).toBe(true);
    expect(answer.items[0]).toMatchObject({
      href: "/deals/deal_hot",
      label: "Risk 60",
      title: "Hot renewal"
    });
    expect(answer.items[0].detail).toContain("overdue follow-up");
    expect(answer.items[0].detail).toContain("Expected close is within 7 days");
    expect(answer.items[0].detail).toContain("High value");
    expect(answer.summary).toContain("Review the deal before changing");
    expect(JSON.stringify(answer)).not.toMatch(secretOrRawProviderTerms);
  });

  it("checks likely replies from stored email logs without syncing or sending", () => {
    const answer = buildEmailReplyAssistantAnswer(sampleEmailReplyContext(), "Check whether Mike Fox replied to my recent email.");

    expect(answer.command).toBe("email_reply_check");
    expect(answer.reviewFirst).toBe(true);
    expect(answer.summary).toContain("Likely yes");
    expect(answer.items[0]).toMatchObject({
      label: "Likely reply",
      title: "Re: Pricing next steps"
    });
    expect(answer.items[0].detail).toContain("Source account sales@example.test");
    expect(JSON.stringify(answer)).not.toContain("providerMessageId");
    expect(JSON.stringify(answer)).not.toContain("providerThreadId");
    expect(JSON.stringify(answer)).not.toMatch(secretOrRawProviderTerms);
  });

  it("returns safe fallback suggestions for unsupported commands", () => {
    const answer = buildUnsupportedAssistantAnswer("Create a quote and email it.", fixedNow());

    expect(answer.command).toBe("unsupported");
    expect(answer.reviewFirst).toBe(true);
    expect(answer.summary).toContain("read-only CRM questions");
    expect(answer.items).toHaveLength(3);
    expect(answer.safetyNotice).toContain("does not create, update, delete");
  });

  it("wires the route, nav, console, and styles without adding schema or mutation paths", () => {
    expect(navigation).toContain('href: "/assistant" as Route');
    expect(navigation).toContain('label: "Assistant"');
    expect(navigation).toContain('helper: "Read-only AI"');
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(assistantPage).toContain("export default async function AssistantPage");
    expect(assistantPage).toContain("answerAssistantCommand(actor, command)");
    expect(assistantPage).toContain("<AssistantConsole answer={answer} command={command} />");
    expect(assistantConsole).toContain("assistantSuggestedCommands");
    expect(assistantConsole).toContain('action="/assistant"');
    expect(assistantConsole).toContain("Context-only");
    expect(assistantConsole).toContain("Review-first");
    expect(globalStyles).toContain(".assistant-console");
    expect(globalStyles).toContain(".assistant-answer-card");
    expect(crmBarrel).toContain('export * from "./assistant/assistant-command-service"');
    expect(crmBarrel).toContain('export * from "./assistant/assistant-context-service"');
    expect(schema).not.toContain("model AiAssistantConversation");
    expect(schema).not.toContain("model AiActionRequest");
  });

  it("keeps the first Assistant slice workspace-scoped and read-only", () => {
    expect(contextService).toContain("await ensureWorkspaceAccess(actor)");
    expect(contextService).toContain("workspaceId: actor.workspaceId");
    expect(contextService).toContain("emailLogAttachmentRelationsWhere(actor.workspaceId)");
    expect(contextService).not.toMatch(/prisma\.(create|update|delete|upsert|createMany|deleteMany|updateMany)\b/);
    expect(commandService).not.toContain("sendGmailReplyFromEmailLog");
    expect(commandService).not.toContain("runGmailInboxSyncNow");
    expect(commandService).not.toContain("syncOlderGmailInboxMessages");
    expect(commandService).not.toContain("refreshGmailInboxThread");
    expect(commandService).not.toContain("writeAuditLog");
    expect(commandService).not.toMatch(/prisma\.(create|update|delete|upsert|createMany|deleteMany|updateMany)\b/);
  });
});

const secretOrRawProviderTerms = /\b(OAuth|refresh token|access token|auth header|raw provider|raw Gmail|provider payload|provider error|gmail\.metadata|secret)\b/i;

function fixedNow() {
  return new Date("2030-01-02T12:00:00.000Z");
}

function sampleTodayContext(): AssistantTodayContext {
  return {
    activities: [
      {
        bucket: "overdue",
        completedAt: null,
        dueAt: "2030-01-01T12:00:00.000Z",
        href: "/activities/activity_1/edit",
        id: "activity_1",
        relatedLabel: "Acme",
        title: "Call Acme",
        type: "CALL"
      },
      {
        bucket: "today",
        completedAt: null,
        dueAt: "2030-01-02T15:00:00.000Z",
        href: "/activities/activity_2/edit",
        id: "activity_2",
        relatedLabel: "Jane Doe",
        title: "Email Jane",
        type: "EMAIL"
      },
      {
        bucket: "upcoming",
        completedAt: null,
        dueAt: "2030-01-04T12:00:00.000Z",
        href: "/activities/activity_3/edit",
        id: "activity_3",
        relatedLabel: null,
        title: "Prepare quote",
        type: "TASK"
      },
      {
        bucket: "unscheduled",
        completedAt: null,
        dueAt: null,
        href: "/activities/activity_4/edit",
        id: "activity_4",
        relatedLabel: "Pipeline",
        title: "Clean list",
        type: "TASK"
      }
    ],
    counts: {
      overdue: 1,
      today: 1,
      upcoming: 1,
      unscheduled: 1
    },
    generatedAt: fixedNow().toISOString(),
    lookedAt: ["Open workspace activities", "Activity due dates"]
  };
}

function sampleDealRiskContext(): AssistantDealRiskContext {
  return {
    deals: [
      {
        activities: [{ bucket: "overdue", dueAt: "2030-01-01T12:00:00.000Z", title: "Call buyer" }],
        currency: "USD",
        expectedCloseAt: "2030-01-05T12:00:00.000Z",
        href: "/deals/deal_hot",
        id: "deal_hot",
        ownerLabel: "Sam",
        relatedLabel: "Acme",
        stageName: "Proposal",
        title: "Hot renewal",
        updatedAt: "2029-12-20T12:00:00.000Z",
        valueCents: 250000
      },
      {
        activities: [],
        currency: "USD",
        expectedCloseAt: null,
        href: "/deals/deal_quiet",
        id: "deal_quiet",
        ownerLabel: "Sam",
        relatedLabel: null,
        stageName: "Qualified",
        title: "Quiet expansion",
        updatedAt: "2030-01-01T12:00:00.000Z",
        valueCents: 0
      }
    ],
    generatedAt: fixedNow().toISOString(),
    lookedAt: ["Open deals", "Open follow-up activities"]
  };
}

function sampleEmailReplyContext(): AssistantEmailReplyContext {
  return {
    generatedAt: fixedNow().toISOString(),
    lookedAt: ["Stored workspace email logs", "Safe participant text"],
    matchedPeople: [{ email: "mike@example.test", id: "person_1", label: "Mike Fox" }],
    messages: [
      {
        accountLabel: "sales@example.test",
        direction: "INBOUND",
        fromText: "Mike Fox <mike@example.test>",
        occurredAt: "2030-01-02T10:00:00.000Z",
        providerLabel: "Gmail / Google Workspace",
        subject: "Re: Pricing next steps",
        toText: "sales@example.test"
      },
      {
        accountLabel: "sales@example.test",
        direction: "OUTBOUND",
        fromText: "sales@example.test",
        occurredAt: "2030-01-01T10:00:00.000Z",
        providerLabel: "Gmail / Google Workspace",
        subject: "Pricing next steps",
        toText: "Mike Fox <mike@example.test>"
      }
    ],
    target: "Mike Fox"
  };
}
