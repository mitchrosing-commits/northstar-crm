import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assistantConversationStarterPrompts,
  sanitizeAssistantConversationFailure
} from "@/lib/services/assistant/assistant-conversation-service";
import {
  buildDraftActionAssistantAnswer,
  buildDealRiskAssistantAnswer,
  buildEmailReplyAssistantAnswer,
  buildTodayAssistantAnswer,
  buildUnsupportedAssistantAnswer,
  assistantSuggestedCommands,
  parseAssistantCommand
} from "@/lib/services/assistant/assistant-command-service";
import type { AssistantDraftAction } from "@/lib/services/assistant/assistant-draft-action-service";
import type {
  AssistantDealRiskContext,
  AssistantEmailReplyContext,
  AssistantTodayContext
} from "@/lib/services/assistant/assistant-context-service";

const assistantPage = readFileSync(join(process.cwd(), "app/assistant/page.tsx"), "utf8");
const assistantActions = readFileSync(join(process.cwd(), "app/assistant/actions.ts"), "utf8");
const assistantCommandForm = readFileSync(join(process.cwd(), "components/assistant-command-form.tsx"), "utf8");
const assistantConsole = readFileSync(join(process.cwd(), "components/assistant-console.tsx"), "utf8");
const assistantDraftCard = readFileSync(join(process.cwd(), "components/assistant-draft-action-card.tsx"), "utf8");
const assistantIcon = readFileSync(join(process.cwd(), "components/assistant-icon.tsx"), "utf8");
const assistantReviewQueue = readFileSync(join(process.cwd(), "components/assistant-action-review-queue.tsx"), "utf8");
const assistantTodayCommandCenter = readFileSync(join(process.cwd(), "components/assistant-today-command-center.tsx"), "utf8");
const actionRequestService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-action-request-service.ts"), "utf8");
const commandService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-command-service.ts"), "utf8");
const conversationService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-conversation-service.ts"), "utf8");
const contextService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-context-service.ts"), "utf8");
const draftActionService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-draft-action-service.ts"), "utf8");
const todayCommandCenterService = readFileSync(join(process.cwd(), "lib/services/assistant/assistant-today-command-center-service.ts"), "utf8");
const emailConnectionService = readFileSync(join(process.cwd(), "lib/services/email-connection-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const assistantActionRequestMigration = readFileSync(join(process.cwd(), "prisma/migrations/20260709130000_assistant_action_requests/migration.sql"), "utf8");
const assistantTodayItemHideMigration = readFileSync(join(process.cwd(), "prisma/migrations/20260710120000_assistant_today_item_hides/migration.sql"), "utf8");
const assistantConversationMigration = readFileSync(join(process.cwd(), "prisma/migrations/20260710140000_assistant_conversations_v1/migration.sql"), "utf8");

describe("read-only and draft-only Northstar Assistant command service", () => {
  it("parses supported deterministic commands", () => {
    expect(parseAssistantCommand("Tell me what I have to do today.")).toEqual({ kind: "today" });
    expect(parseAssistantCommand("Show me the highest-risk deals this week.")).toEqual({ kind: "deal_risk" });
    expect(parseAssistantCommand("Check whether Mike Fox replied to my recent email.")).toEqual({
      kind: "email_reply_check",
      target: "Mike Fox"
    });
    expect(parseAssistantCommand("Remind me to follow up with Jane Doe next Tuesday.")).toEqual({ kind: "draft_activity" });
    expect(parseAssistantCommand("Add a note for Jane Doe: Prefers Monday morning check-ins.")).toEqual({ kind: "draft_note" });
    expect(parseAssistantCommand("Update Jane Doe's profile to include that she is going on vacation.")).toEqual({ kind: "draft_contact_relationship" });
    expect(parseAssistantCommand("Create an organization for Acme and add Mike Fox as CFO from this note: met at event.")).toEqual({ kind: "draft_record_creation" });
    expect(parseAssistantCommand("Make email replies more casual and concise.")).toEqual({ kind: "draft_ai_preferences" });
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
    expect(answer.summary).toContain("draft a small set of review-first actions");
    expect(answer.items).toHaveLength(5);
    expect(answer.safetyNotice).toContain("does not create, update, delete");
  });

  it("suggests only current safe capabilities", () => {
    expect([...assistantSuggestedCommands]).toEqual([
      "Tell me what I have to do today.",
      "Show me the highest-risk deals this week.",
      "Check whether Mike Fox replied to my recent email.",
      "Remind me to follow up with Jane Doe next Tuesday.",
      "Add a note for Jane Doe: she prefers concise email updates."
    ]);
    expect(assistantSuggestedCommands.join(" ")).not.toMatch(/\b(create|send|convert|close|delete)\b/i);
    expect(assistantSuggestedCommands.join(" ")).not.toMatch(/\b(organization|quote|relationship memory|AI preference|sync)\b/i);
  });

  it("offers broad conversation starter prompts without unsafe apply language", () => {
    expect([...assistantConversationStarterPrompts]).toEqual([
      "Help me plan my day.",
      "What should I focus on?",
      "Summarize the Acme relationship.",
      "Which deals look risky?",
      "Help me prepare for my meeting.",
      "What am I waiting on?"
    ]);
    expect(assistantConversationStarterPrompts.join(" ")).not.toMatch(/\b(send|sync|convert|close|delete|autonomous)\b/i);
    expect(sanitizeAssistantConversationFailure(new Error("provider payload: access_token=secret raw Gmail body=hidden"))).not.toMatch(secretOrRawProviderTerms);
  });

  it("returns draft-only action previews without implying apply behavior", () => {
    const answer = buildDraftActionAssistantAnswer(
      [sampleDraftActivityAction()],
      "draft_activity",
      "Remind me to follow up with Jane Doe next Tuesday.",
      fixedNow()
    );

    expect(answer.command).toBe("draft_activity");
    expect(answer.reviewFirst).toBe(true);
    expect(answer.draftActions?.[0]).toMatchObject({
      applyState: "disabled",
      reviewLabel: "Draft only",
      targetLabel: "Jane Doe"
    });
    expect(answer.summary).toContain("Nothing has been saved or applied");
    expect(answer.safetyNotice).toContain("save settings");
    expect(JSON.stringify(answer)).not.toMatch(secretOrRawProviderTerms);
  });

  it("wires the route, nav, console, queue, and styles", () => {
    expect(navigation).toContain('href: "/assistant" as Route');
    expect(navigation).toContain('label: "Assistant"');
    expect(navigation).toContain('icon: "NorthstarAssistant"');
    expect(navigation).toContain('helper: "Review-first AI"');
    expect(primaryNav).toContain("appShellNavigationManifest");
    expect(primaryNav).toContain("AssistantIcon");
    expect(primaryNav).toContain("data-testid");
    expect(assistantIcon).toContain("export const AssistantIcon");
    expect(assistantIcon).not.toContain("Sparkles");
    expect(assistantIcon).not.toContain("BrainCircuit");
    expect(assistantPage).toContain("export default async function AssistantPage");
    expect(assistantPage).toContain("answerAssistantCommand(actor, command)");
    expect(assistantPage).toContain("getAssistantConversation(actor, conversationId)");
    expect(assistantPage).toContain("listAssistantActionRequests(actor)");
    expect(assistantPage).toContain("buildAssistantTodayCommandCenter(actor, new Date(), { showHidden: showHiddenTodayItems })");
    expect(assistantPage).toContain("getAiPreferences(actor)");
    expect(assistantPage).toContain("assistantDisplayName");
    expect(assistantPage).toContain("showHiddenTodayItems");
    expect(assistantPage).toContain("todayCommandCenterStatus={todayCommandCenterStatus}");
    expect(assistantPage).toContain("actionRequestQueue={actionRequestQueue}");
    expect(assistantPage).toContain("pendingActionRequests={pendingActionRequests}");
    expect(assistantPage).toContain("todayCommandCenter={todayCommandCenter}");
    expect(assistantPage).toContain('return "pending"');
    expect(assistantConsole).toContain("assistantConversationStarterPrompts");
    expect(assistantConsole).toContain("AssistantDraftActionCard");
    expect(assistantConsole).toContain("AssistantActionReviewQueue");
    expect(assistantConsole).toContain("AssistantTodayCommandCenter");
    expect(assistantConsole).toContain("AssistantCommandForm");
    expect(assistantConsole).toContain("AssistantIcon");
    expect(assistantConsole).toContain("AssistantChatThread");
    expect(assistantConsole).toContain("AssistantStarterPrompts");
    expect(assistantConsole).toContain("AssistantSourceList");
    expect(assistantConsole.indexOf("assistant-command-panel")).toBeLessThan(assistantConsole.indexOf("<AssistantTodayCommandCenter"));
    expect(assistantConsole).toContain("AssistantPermissionSummary");
    expect(assistantConsole).toContain("Available now");
    expect(assistantConsole).toContain("Settings-only for now");
    expect(assistantConsole).toContain("permission-checked confirmed activity or note apply");
    expect(assistantConsole).toContain("Chat with {assistantName}");
    expect(assistantConsole).toContain("assistantToneLabel");
    expect(assistantCommandForm).toContain("sendAssistantConversationMessageAction");
    expect(assistantCommandForm).toContain('name="message"');
    expect(assistantCommandForm).toContain('name="conversationId"');
    expect(assistantCommandForm).toContain('id="assistant-chat-composer"');
    expect(assistantCommandForm).toContain("Question or command");
    expect(assistantCommandForm).toContain("Ready for a review-first CRM question.");
    expect(assistantCommandForm).toContain("is building a review-first reply");
    expect(assistantCommandForm).toContain("Enter a question or command before asking.");
    expect(assistantCommandForm).toContain("aria-live");
    expect(assistantCommandForm).toContain("required");
    expect(assistantConsole).toContain("Context-only");
    expect(assistantConsole).toContain("Draft only");
    expect(assistantActions).toContain("saveAssistantDraftActionRequest");
    expect(assistantActions).toContain("applyAssistantActionRequestAction");
    expect(assistantActions).toContain("rejectAssistantActionRequestAction");
    expect(assistantActions).toContain("hideAssistantTodayCommandCenterItemAction");
    expect(assistantActions).toContain('assistantRedirect("saved", returnCommand, "pending")');
    expect(assistantActions).toContain('assistantRedirect("applied", "", "applied")');
    expect(assistantActions).toContain('assistantRedirect("rejected", "", "rejected")');
    expect(assistantActions).toContain('todayCommandCenterRedirect("hidden")');
    expect(assistantDraftCard).toContain("Review required");
    expect(assistantDraftCard).toContain("Save, then review");
    expect(assistantDraftCard).toContain("Needs clearer target");
    expect(assistantDraftCard).toContain("Review-only for now");
    expect(assistantDraftCard).toContain("Save to review queue");
    expect(assistantReviewQueue).toContain("Review queue");
    expect(assistantReviewQueue).toContain("Assistant review queue filters");
    expect(assistantReviewQueue).toContain("Hide completed requests");
    expect(assistantReviewQueue).toContain("Filters hide completed requests from view without deleting audit history or CRM records.");
    expect(assistantReviewQueue).toContain("Created");
    expect(assistantReviewQueue).toContain("Action type");
    expect(assistantReviewQueue).toContain("Apply availability");
    expect(assistantReviewQueue).toContain("Review-only");
    expect(assistantReviewQueue).toContain("No pending Assistant action requests.");
    expect(assistantReviewQueue).toContain("No applied Assistant action requests yet.");
    expect(assistantReviewQueue).toContain("No rejected Assistant action requests yet.");
    expect(assistantReviewQueue).toContain("No Assistant action requests yet.");
    expect(assistantReviewQueue).toContain("applyAvailability");
    expect(assistantReviewQueue).toContain("permissionReason");
    expect(assistantReviewQueue).toContain("Apply {applyNoun(request)}");
    expect(assistantReviewQueue).toContain("Apply not available yet");
    expect(assistantReviewQueue).toContain("AI Preferences");
    expect(assistantReviewQueue).toContain("Apply is blocked until one clear target record is selected.");
    expect(assistantReviewQueue).toContain("This request has already been applied and cannot be applied again.");
    expect(assistantReviewQueue).toContain("This request was rejected and cannot be applied.");
    expect(assistantReviewQueue).toContain("Reject request");
    expect(assistantTodayCommandCenter).toContain("Command Center");
    expect(assistantTodayCommandCenter).toContain("Prioritized Assistant Command Center items");
    expect(assistantTodayCommandCenter).toContain("Hidden Assistant Command Center items");
    expect(assistantTodayCommandCenter).toContain("Hide for today");
    expect(assistantTodayCommandCenter).toContain("Show hidden");
    expect(assistantTodayCommandCenter).toContain("Hidden today");
    expect(assistantTodayCommandCenter).toContain("Why this is here");
    expect(assistantTodayCommandCenter).toContain("assistant-today-explanation");
    expect(assistantTodayCommandCenter).toContain("safeNextAction");
    expect(assistantTodayCommandCenter).toContain("Draft follow-up");
    expect(assistantTodayCommandCenter).toContain("Review activities");
    expect(globalStyles).toContain(".assistant-console");
    expect(globalStyles).toContain(".assistant-command-panel-primary");
    expect(globalStyles).toContain(".assistant-command-icon");
    expect(globalStyles).toContain(".assistant-command-status");
    expect(globalStyles).toContain(".assistant-chat-thread");
    expect(globalStyles).toContain(".assistant-chat-message");
    expect(globalStyles).toContain(".assistant-chat-sources");
    expect(globalStyles).toContain(".assistant-workspace-panels");
    expect(globalStyles).toContain(".assistant-today-command-center");
    expect(globalStyles).toContain(".assistant-today-item");
    expect(globalStyles).toContain(".assistant-today-explanation");
    expect(globalStyles).toContain(".assistant-answer-card");
    expect(globalStyles).toContain(".assistant-permission-summary");
    expect(globalStyles).toContain(".assistant-draft-card");
    expect(globalStyles).toContain(".assistant-review-queue");
    expect(globalStyles).toContain(".assistant-review-request");
    expect(globalStyles).toContain(".assistant-review-request-applied");
    expect(globalStyles).toContain(".assistant-review-request-rejected");
    expect(crmBarrel).toContain('export * from "./assistant/assistant-command-service"');
    expect(crmBarrel).toContain('export * from "./assistant/assistant-conversation-service"');
    expect(crmBarrel).toContain('export * from "./assistant/assistant-context-service"');
    expect(crmBarrel).toContain('export * from "./assistant/assistant-draft-action-service"');
    expect(crmBarrel).toContain('export * from "./assistant/assistant-action-request-service"');
    expect(crmBarrel).toContain('export * from "./assistant/assistant-today-command-center-service"');
    expect(schema).toContain("model AssistantActionRequest");
    expect(schema).toContain("model AssistantConversation");
    expect(schema).toContain("model AssistantConversationMessage");
    expect(schema).toContain("@@index([workspaceId, userId, updatedAt])");
    expect(schema).toContain("assistantActionPermissions");
    expect(schema).toContain("model AssistantTodayItemHide");
    expect(schema).toContain("@@unique([workspaceId, userId, itemKey, localDateKey])");
    expect(schema).toContain("enum AssistantActionRequestStatus");
    expect(assistantActionRequestMigration).toContain('CREATE TABLE IF NOT EXISTS "AssistantActionRequest"');
    expect(assistantTodayItemHideMigration).toContain('CREATE TABLE IF NOT EXISTS "AssistantTodayItemHide"');
    expect(assistantConversationMigration).toContain('CREATE TABLE IF NOT EXISTS "AssistantConversation"');
    expect(assistantConversationMigration).toContain('CREATE TABLE IF NOT EXISTS "AssistantConversationMessage"');
  });

  it("keeps Assistant slices workspace-scoped and non-mutating", () => {
    expect(contextService).toContain("await ensureWorkspaceAccess(actor)");
    expect(contextService).toContain("workspaceId: actor.workspaceId");
    expect(contextService).toContain("emailLogAttachmentRelationsWhere(actor.workspaceId)");
    expect(contextService).not.toMatch(/prisma\.(create|update|delete|upsert|createMany|deleteMany|updateMany)\b/);
    expect(draftActionService).toContain("await ensureWorkspaceAccess(actor)");
    expect(draftActionService).toContain("workspaceId: actor.workspaceId");
    expect(draftActionService).toContain("redactSensitiveText");
    expect(draftActionService).not.toMatch(/prisma\.(create|update|delete|upsert|createMany|deleteMany|updateMany)\b/);
    expect(todayCommandCenterService).toContain("await ensureWorkspaceAccess(actor)");
    expect(todayCommandCenterService).toContain("workspaceId: actor.workspaceId");
    expect(todayCommandCenterService).toContain("createdById: actor.actorUserId");
    expect(todayCommandCenterService).toContain("AssistantActionRequestStatus.PENDING");
    expect(todayCommandCenterService).toContain("hideAssistantTodayCommandCenterItem");
    expect(todayCommandCenterService).toContain("assistantTodayItemHide.findMany");
    expect(todayCommandCenterService).toContain("assistantTodayItemHide.upsert");
    expect(todayCommandCenterService).toContain("assistantTodayLocalDateKey");
    expect(todayCommandCenterService).toContain("AssistantTodayCommandCenterExplanation");
    expect(todayCommandCenterService).toContain("commandCenterExplanation");
    expect(todayCommandCenterService).toContain("storedValues");
    expect(todayCommandCenterService).toContain("actionableActivityRelationsWhere(actor.workspaceId)");
    expect(todayCommandCenterService).toContain("activityAttachmentRelationsWhere(actor.workspaceId)");
    expect(todayCommandCenterService).toContain("Review-first suggestions only");
    expect(todayCommandCenterService).not.toMatch(/prisma\.(activity|deal|lead|quote|note|emailLog|aiPreference)\.(create|update|delete|upsert|createMany|deleteMany|updateMany)\b/);
    expect(todayCommandCenterService).not.toContain("writeAuditLog");
    expect(todayCommandCenterService).not.toMatch(/\b(providerMessageId|providerThreadId|refresh_token|access token|sendGmail|syncGmail)\b/i);
    expect(actionRequestService).toContain("await ensureWorkspaceAccess(actor)");
    expect(actionRequestService).toContain("createdById: actor.actorUserId");
    expect(actionRequestService).toContain("workspaceId: actor.workspaceId");
    expect(actionRequestService).toContain("redactSensitiveText");
    expect(actionRequestService).toContain("writeAuditLog");
    expect(actionRequestService).toContain("applyAssistantActionRequest");
    expect(actionRequestService).toContain("isSupportedAssistantActionApply");
    expect(actionRequestService).toContain("createActivity(actor, activityInput)");
    expect(actionRequestService).toContain("createNote(actor, noteInput)");
    expect(actionRequestService).toContain("AssistantActionRequestStatus.APPLIED");
    expect(actionRequestService).toContain("assistant_action_request.applied");
    expect(actionRequestService).not.toContain("updateAiPreferences");
    expect(commandService).not.toContain("sendGmailReplyFromEmailLog");
    expect(commandService).not.toContain("runGmailInboxSyncNow");
    expect(commandService).not.toContain("syncOlderGmailInboxMessages");
    expect(commandService).not.toContain("refreshGmailInboxThread");
    expect(commandService).not.toContain("writeAuditLog");
    expect(commandService).not.toMatch(/prisma\.(create|update|delete|upsert|createMany|deleteMany|updateMany)\b/);
    expect(conversationService).toContain("await ensureWorkspaceAccess(actor)");
    expect(conversationService).toContain("workspaceId: actor.workspaceId");
    expect(conversationService).toContain("userId: actor.actorUserId");
    expect(conversationService).toContain("redactSensitiveText");
    expect(conversationService).toContain("assistantConversation.create");
    expect(conversationService).toContain("assistantConversationMessage.create");
    expect(conversationService).not.toMatch(/sendGmail|syncGmail|refreshGmail|providerMessageId|providerThreadId|raw provider|raw Gmail/i);
    expect(conversationService).not.toMatch(/prisma\.(activity|deal|lead|quote|note|emailLog|aiPreference)\.(create|update|delete|upsert|createMany|deleteMany|updateMany)\b/);
  });

  it("does not regress Gmail OAuth scopes from Assistant work", () => {
    const requestedScopes = emailConnectionService.match(/export const gmailOAuthScopes = \[[\s\S]*?\] as const;/)?.[0] ?? "";
    expect(requestedScopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(requestedScopes).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(requestedScopes).not.toContain("https://www.googleapis.com/auth/gmail.metadata");
    expect(emailConnectionService).toContain('url.searchParams.set("include_granted_scopes", "false")');
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

function sampleDraftActivityAction(): AssistantDraftAction {
  return {
    applyState: "disabled",
    candidates: [
      {
        detail: "jane@example.test",
        href: "/contacts/person_1",
        id: "person_1",
        label: "Jane Doe",
        type: "person"
      }
    ],
    confidence: "high",
    evidence: ["Remind me to follow up with Jane Doe next Tuesday."],
    fields: [
      { label: "Title", value: "Follow up with Jane Doe" },
      { label: "Due date", value: "8 Jan 2030" }
    ],
    id: "draft-activity",
    kind: "activity",
    missingInfo: [],
    reviewLabel: "Draft only",
    targetHref: "/contacts/person_1",
    targetKind: "Activity",
    targetLabel: "Jane Doe",
    title: "Draft activity",
    warnings: []
  };
}
