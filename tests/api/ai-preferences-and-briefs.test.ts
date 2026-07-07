import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { draftAiPreferenceChangesFromText, sanitizeInstructionText, type AiPreferences } from "@/lib/services/ai-preferences-service";
import { buildAiRecordBrief } from "@/lib/services/ai-record-brief-service";
import { summarizeStoredEmailForAi } from "@/lib/services/ai-email-summary-service";
import { explainMeetingNotePlacement, explainRelationshipFactPlacement } from "@/lib/meeting-intelligence/placement-explanations";
import { buildDeterministicInsight, type NorthstarAssistantContext } from "@/lib/services/northstar-ai-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(join(process.cwd(), "prisma/migrations/20260707120000_ai_preferences/migration.sql"), "utf8");
const settingsPage = readFileSync(join(process.cwd(), "app/settings/page.tsx"), "utf8");
const aiSettingsPage = readFileSync(join(process.cwd(), "app/settings/ai/page.tsx"), "utf8");
const hygieneService = readFileSync(join(process.cwd(), "lib/services/ai-hygiene-service.ts"), "utf8");
const meetingReview = readFileSync(join(process.cwd(), "components/meeting-intelligence-review.tsx"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");

describe("AI preferences and review-first briefs", () => {
  it("stores AI preferences by workspace and user without a broad JSON blob", () => {
    expect(schema).toContain("model AiPreference");
    expect(schema).toContain("@@unique([workspaceId, userId])");
    expect(schema).toContain("workspace                    Workspace @relation");
    expect(schema).toContain("user                         User      @relation");
    expect(schema).toContain("naturalLanguageInstructions  String?");
    expect(schema).not.toContain("aiPreferences Json");
    expect(migration).toContain('CREATE TABLE "AiPreference"');
    expect(migration).toContain('"workspaceId" TEXT NOT NULL');
    expect(migration).toContain('ON DELETE CASCADE');
  });

  it("renders a discoverable AI preferences console with review-first copy", () => {
    expect(settingsPage).toContain('href={"/settings/ai" as Route}');
    expect(aiSettingsPage).toContain("AI Preferences");
    expect(aiSettingsPage).toContain("Review-first");
    expect(aiSettingsPage).toContain("CRM Hygiene Suggestions");
    expect(aiSettingsPage).toContain("Provider-specific model choice");
    expect(aiSettingsPage).toContain("updateAiPreferencesAction");
    expect(aiSettingsPage).toContain("resetAiPreferencesAction");
  });

  it("parses natural language preference drafts without applying changes", () => {
    const draft = draftAiPreferenceChangesFromText("Keep replies warm, concise, and use simple diagnostics.");
    expect(draft.reviewFirst).toBe(true);
    expect(draft.proposedChanges).toMatchObject({
      diagnosticsDetailLevel: "simple",
      recordSummaryStyle: "concise",
      replyTone: "warm"
    });
    expect(sanitizeInstructionText("token secret=abc123 keep it concise")).toContain("[redacted]");
  });

  it("applies Assistant preferences without expanding context or technical diagnostics", () => {
    const insight = buildDeterministicInsight(sampleInboxContext(), samplePreferences({
      assistantDetailLevel: "detailed",
      diagnosticsDetailLevel: "simple",
      suggestionAggressiveness: "low"
    }));

    expect(insight.findings.length).toBeLessThanOrEqual(6);
    expect(insight.suggestedActions.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(insight.findings)).toContain("Secret values and raw provider data are hidden");
    expect(JSON.stringify(insight)).not.toContain("encryptedAccessToken");
  });

  it("builds compact record briefs and health summaries from sanitized context", () => {
    const context = sampleDealContext();
    const insight = buildDeterministicInsight(context);
    const brief = buildAiRecordBrief(context, insight, samplePreferences({ recordSummaryStyle: "concise" }));

    expect(brief.reviewFirst).toBe(true);
    expect(brief.recordLabel).toBe("Acme Renewal");
    expect(brief.health.status).toBe("attention");
    expect(brief.whatChanged[0]).toContain("deal updated");
    expect(brief.sourceBasis.length).toBeLessThanOrEqual(4);
  });

  it("summarizes only stored email body or snippet and reports unavailable bodies safely", () => {
    expect(summarizeStoredEmailForAi({ body: "", providerSnippet: "" }, samplePreferences()).status).toBe("unavailable");
    expect(summarizeStoredEmailForAi({ body: "First sentence. Second sentence. Third sentence." }, samplePreferences({
      emailSummaryLength: "one_sentence"
    })).summary).toBe("First sentence.");
    expect(summarizeStoredEmailForAi({ providerSnippet: "Snippet only." }, samplePreferences()).warnings).toContain("Summary is based on stored snippet only.");
  });

  it("adds Meeting Intelligence placement explanations without applying proposals", () => {
    expect(explainMeetingNotePlacement({ body: "Legal needs the MSA next week", kind: "deal_fact", target: { id: "deal_1", type: "deal" } })).toMatchObject({
      reviewFirst: true,
      targetType: "deal"
    });
    expect(explainRelationshipFactPlacement({ field: "relationshipPersonalContext", text: "Procurement requires security review" })).toMatchObject({
      reviewFirst: true,
      targetType: "organization"
    });
    expect(meetingReview).toContain("placementExplanation");
    expect(meetingReview).toContain("Review before apply");
  });

  it("keeps CRM hygiene and Inbox AI preference wiring workspace-scoped and non-mutating", () => {
    expect(hygieneService).toContain("await ensureWorkspaceAccess(actor)");
    expect(hygieneService).toContain("workspaceId: actor.workspaceId");
    expect(hygieneService).toContain("reviewFirst: true");
    expect(hygieneService).not.toContain("create({");
    expect(hygieneService).not.toContain("update({");
    expect(hygieneService).not.toContain("emailConnectionSecret");
    expect(emailPage).toContain("getAiPreferences(actor)");
    expect(emailPage).toContain("defaultAiReplyTone={defaultAiReplyTone}");
  });
});

function samplePreferences(overrides: Partial<AiPreferences> = {}): AiPreferences {
  return {
    assistantDetailLevel: "balanced",
    diagnosticsDetailLevel: "simple",
    emailSummaryLength: "short",
    meetingIntelligenceNoteStyle: "structured",
    naturalLanguageInstructions: null,
    recordSummaryStyle: "balanced",
    relationshipMemoryUsage: "conservative",
    replyTone: "warm",
    suggestionAggressiveness: "medium",
    ...overrides
  };
}

function sampleDealContext(): NorthstarAssistantContext {
  return {
    audits: [{
      action: "deal.updated",
      actorLabel: "Sam User",
      createdAt: "2030-01-02T12:00:00.000Z",
      entityType: "Deal",
      id: "audit_1"
    }],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["deal status and stage", "customer links", "follow-up activity", "recent change history"],
    record: { id: "deal_1", label: "Acme Renewal", status: "WON", type: "deal" },
    related: {
      activities: [{
        completedAt: null,
        dueAt: "2029-12-31T12:00:00.000Z",
        id: "activity_1",
        title: "Send close-out follow-up",
        type: "EMAIL"
      }],
      connections: [],
      emails: [],
      jobs: [],
      notes: [],
      possibleLinks: [{ id: "org_1", label: "Acme", reason: "Recently updated organization in this workspace", type: "organization" }],
      proposalSummaries: ["Stage: Closed Won", "Customer: not linked", "Line items: 0", "Quotes: 0"],
      relationshipFacts: []
    },
    safety: {
      excludes: ["OAuth access tokens", "raw provider payloads", "job payload internals"],
      reviewFirst: true,
      workspaceScoped: true
    },
    surface: "deal",
    workspaceId: "workspace_1"
  };
}

function sampleInboxContext(): NorthstarAssistantContext {
  return {
    audits: [],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["recent stored email logs", "email connection health", "recent email sync activity"],
    related: {
      activities: [],
      connections: [{
        accountEmail: "sales@example.test",
        createdAt: "2030-01-01T12:00:00.000Z",
        id: "connection_1",
        lastError: "401 reconnect required",
        lastSyncAt: null,
        provider: "GOOGLE_WORKSPACE",
        scopeCategories: ["Gmail read"],
        status: "ERROR",
        updatedAt: "2030-01-02T12:00:00.000Z"
      }],
      emails: [{
        direction: "INBOUND",
        followUpCount: 0,
        id: "email_1",
        occurredAt: "2030-01-02T10:00:00.000Z",
        provider: "GOOGLE_WORKSPACE",
        signals: ["NEEDS_REPLY"],
        subject: "Can you send next steps?"
      }],
      jobs: [{
        attempts: 3,
        createdAt: "2030-01-02T09:00:00.000Z",
        failedAt: "2030-01-02T10:00:00.000Z",
        id: "job_1",
        lastError: "Provider returned [redacted]",
        lockedAt: null,
        maxAttempts: 3,
        processedAt: null,
        runAt: "2030-01-02T09:00:00.000Z",
        status: "DEAD",
        type: "email.gmail_sync",
        updatedAt: "2030-01-02T10:00:00.000Z"
      }],
      notes: [],
      possibleLinks: [],
      proposalSummaries: ["Stored email logs reviewed: 1"],
      relationshipFacts: []
    },
    safety: {
      excludes: ["OAuth access tokens", "raw provider payloads", "job payload internals"],
      reviewFirst: true,
      workspaceScoped: true
    },
    surface: "inbox",
    workspaceId: "workspace_1"
  };
}
