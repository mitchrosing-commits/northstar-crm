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
const aiRecordBriefCard = readFileSync(join(process.cwd(), "components/ai-record-brief-card.tsx"), "utf8");

describe("AI preferences and review-first briefs", () => {
  it("stores AI preferences by workspace and user without a broad JSON blob", () => {
    expect(schema).toContain("model AiPreference");
    expect(schema).toContain("@@unique([workspaceId, userId])");
    expect(schema).toContain("workspace                    Workspace @relation");
    expect(schema).toContain("user                         User      @relation");
    expect(schema).toContain("naturalLanguageInstructions  String?");
    expect(schema).toContain("assistantNamePreset");
    expect(schema).toContain("assistantTonePreset");
    expect(schema).toContain("assistantHelpAreas");
    expect(schema).not.toContain("aiPreferences Json");
    expect(migration).toContain('CREATE TABLE "AiPreference"');
    expect(migration).toContain('"workspaceId" TEXT NOT NULL');
    expect(migration).toContain('ON DELETE CASCADE');
  });

  it("renders a discoverable AI preferences console with review-first copy", () => {
    expect(settingsPage).toContain('href={"/settings/ai" as Route}');
    expect(aiSettingsPage).toContain("AI Preferences");
    expect(aiSettingsPage).toContain("Review-first");
    expect(aiSettingsPage).toContain("Assistant name");
    expect(aiSettingsPage).toContain("Where the assistant helps");
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
    expect(brief.sourcesUsed).toContain("Deal record");
    expect(brief.missingContext).toEqual(expect.arrayContaining(["No deal-specific notes were reviewed."]));
    expect(brief.risks.length).toBeGreaterThan(0);
    expect(brief.risks.every((risk) => Boolean(risk.sourceRef))).toBe(true);
    expect(brief.nextActions.length).toBeGreaterThan(0);
    expect(brief.nextActions.every((action) => Boolean(action.sourceRef))).toBe(true);
  });

  it("builds contact briefs from contact-specific memory, notes, activities, and linked deals", () => {
    const brief = buildAiRecordBrief(sampleContactContext(), buildDeterministicInsight(sampleContactContext()));
    const memoryFact = brief.keyFacts.find((fact) => fact.label === "Personal context");
    const noteFact = brief.keyFacts.find((fact) => fact.label === "Recent contact note");
    const activityFact = brief.keyFacts.find((fact) => fact.label === "Open follow-up");
    const emailFact = brief.keyFacts.find((fact) => fact.label === "Recent stored email");
    const linkedDealFact = brief.keyFacts.find((fact) => fact.label === "Linked deal context");

    expect(brief.keyFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Personal context", source: "Relationship Memory", value: expect.stringContaining("France") }),
        expect.objectContaining({ label: "Recent contact note", source: "Notes", value: expect.stringContaining("prefers morning calls") }),
        expect.objectContaining({ label: "Open follow-up", source: "Activities", value: expect.stringContaining("Call Jane") }),
        expect.objectContaining({ label: "Linked deal context", source: "Linked deals", value: "Linked deal: Alpha Renewal (OPEN)" })
      ])
    );
    expect(memoryFact?.sourceRef).toMatchObject({
      detail: "Meeting Intelligence source",
      href: "/meeting-intelligence/intake_1",
      label: "Relationship Memory history: Discovery call",
      recordId: "intake_1",
      targetRecordId: "person_1",
      type: "relationship_memory"
    });
    expect(noteFact?.sourceRef).toMatchObject({
      excerpt: "Jane prefers morning calls before standup.",
      href: "#note-note_1",
      label: "Record note by Sam User",
      occurredAt: "2030-01-01T12:00:00.000Z",
      recordId: "note_1",
      type: "note"
    });
    expect(activityFact?.sourceRef).toMatchObject({ href: "/activities/activity_1/edit", recordId: "activity_1", type: "activity" });
    expect(emailFact?.sourceRef).toMatchObject({
      detail: "Source account: Sales Inbox",
      excerpt: "Re: rollout",
      href: "#email-email_1",
      label: "Stored email log",
      recordId: "email_1",
      type: "email_log"
    });
    expect(JSON.stringify(emailFact?.sourceRef)).not.toContain("GOOGLE_WORKSPACE");
    expect(linkedDealFact?.sourceRef).toMatchObject({
      href: "/deals/deal_linked_1",
      label: "Alpha Renewal",
      recordId: "deal_linked_1",
      type: "linked_record_summary"
    });
    expect(brief.sourcesUsed).toEqual(expect.arrayContaining(["Person fields", "Relationship Memory", "Notes", "Activities", "Linked deals"]));
    expect(JSON.stringify(brief.keyFacts)).not.toContain("WMS implementation");
  });

  it("keeps organization briefs at organization level and frames linked people separately", () => {
    const brief = buildAiRecordBrief(sampleOrganizationContext(), buildDeterministicInsight(sampleOrganizationContext()));
    const domainFact = brief.keyFacts.find((fact) => fact.label === "Domain");
    const noteFact = brief.keyFacts.find((fact) => fact.label === "Recent organization note");

    expect(brief.keyFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Domain", source: "Organization record", value: "Domain: alpha.example" }),
        expect.objectContaining({ label: "Recent organization note", source: "Notes", value: expect.stringContaining("WMS implementation") })
      ])
    );
    expect(JSON.stringify(brief.keyFacts)).not.toContain("Jane is traveling to France");
    expect(brief.omittedOrNeedsReview).toContain(
      "Linked contacts' Relationship Memory was omitted from organization facts; review stakeholders on their contact records."
    );
    expect(domainFact?.sourceRef).toMatchObject({ href: "/organizations/org_1", recordId: "org_1", type: "current_record" });
    expect(noteFact?.sourceRef).toMatchObject({ href: "#note-note_1", recordId: "note_1", type: "note" });
    expect(JSON.stringify(brief.keyFacts)).not.toContain("#relationship-brief");
    expect(brief.sourcesUsed).toEqual(expect.arrayContaining(["Organization record", "Notes"]));
  });

  it("keeps deal briefs scoped to the current deal and omits linked contact personal memory", () => {
    const brief = buildAiRecordBrief(sampleDealBriefContext(), buildDeterministicInsight(sampleDealBriefContext()));
    const stageFact = brief.keyFacts.find((fact) => fact.label === "Stage");
    const noteFact = brief.keyFacts.find((fact) => fact.label === "Recent deal note");
    const activityFact = brief.keyFacts.find((fact) => fact.label === "Open deal follow-up");

    expect(brief.keyFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Stage", source: "Deal record", value: "Stage: Procurement" }),
        expect.objectContaining({ label: "Recent deal note", source: "Notes", value: expect.stringContaining("SOW timeline") }),
        expect.objectContaining({ label: "Open deal follow-up", source: "Activities", value: expect.stringContaining("Send legal packet") })
      ])
    );
    expect(JSON.stringify(brief.keyFacts)).not.toContain("Unrelated Expansion");
    expect(JSON.stringify(brief.keyFacts)).not.toContain("Jane is traveling to France");
    expect(brief.omittedOrNeedsReview).toContain(
      "Linked contact Relationship Memory was omitted from deal facts; use it only as stakeholder context after review."
    );
    expect(stageFact?.sourceRef).toMatchObject({ href: "/deals/deal_1", recordId: "deal_1", type: "current_record" });
    expect(noteFact?.sourceRef).toMatchObject({ href: "#note-note_1", recordId: "note_1", type: "note" });
    expect(activityFact?.sourceRef).toMatchObject({ href: "/activities/activity_1/edit", recordId: "activity_1", type: "activity" });
    expect(brief.sourcesUsed).toEqual(expect.arrayContaining(["Deal record", "Notes", "Activities"]));
  });

  it("uses missing-context messages and cleans raw transcript-like note text", () => {
    const brief = buildAiRecordBrief(sampleSparseContactContext(), buildDeterministicInsight(sampleSparseContactContext()));

    expect(brief.missingContext).toEqual(
      expect.arrayContaining([
        "No recent activities are scheduled.",
        "No contact-specific relationship memory has been saved yet.",
        "No open deals are linked to this contact."
      ])
    );
    expect(brief.keyFacts).toEqual([
      expect.objectContaining({
        label: "Recent contact note",
        sourceRef: expect.objectContaining({
          excerpt: "Jane Contact mentioned they will be traveling with family next month.",
          href: "#note-note_1",
          type: "note"
        }),
        source: "Notes",
        value: "Jane Contact mentioned they will be traveling with family next month."
      })
    ]);
    expect(JSON.stringify(brief)).not.toContain("Jane Contact:");
  });

  it("caps safe source excerpts and renders drill-down links without broad UI redesign", () => {
    const context = sampleContactContext();
    context.related.notes = [{
      body: `A very long implementation note ${"with scoped detail ".repeat(20)}and no sensitive values.`,
      createdAt: "2030-01-01T12:00:00.000Z",
      id: "note_long"
    }];
    const brief = buildAiRecordBrief(context, buildDeterministicInsight(context), samplePreferences({ recordSummaryStyle: "detailed" }));
    const noteFact = brief.keyFacts.find((fact) => fact.source === "Notes");

    expect(noteFact?.sourceRef?.excerpt?.length).toBeLessThanOrEqual(140);
    expect(noteFact?.sourceRef).toMatchObject({ href: "#note-note_long", recordId: "note_long", type: "note" });
    expect(aiRecordBriefCard).toContain("BriefSourceRef");
    expect(aiRecordBriefCard).toContain("sourceRef.href");
    expect(aiRecordBriefCard).toContain("Suggested review actions");
  });

  it("does not invent linked deal hrefs when only summary strings are available", () => {
    const context = sampleContactContext();
    context.related.linkedRecords = [];
    const brief = buildAiRecordBrief(context, buildDeterministicInsight(context));
    const linkedDealFact = brief.keyFacts.find((fact) => fact.label === "Linked deal context");

    expect(linkedDealFact?.sourceRef).toMatchObject({
      label: "Linked deal summary",
      type: "linked_record_summary",
      warning: "Exact source link was not available in this brief context."
    });
    expect(linkedDealFact?.sourceRef).not.toHaveProperty("href");
  });

  it("uses Meeting Intelligence intake metadata for proposal-backed facts", () => {
    const brief = buildAiRecordBrief(sampleMeetingIntelligenceContext(), buildDeterministicInsight(sampleMeetingIntelligenceContext()));

    expect(brief.keyFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Intake status",
          source: "Meeting Intelligence",
          sourceRef: expect.objectContaining({
            detail: "Categories: personFact, stakeholderNote",
            href: "/meeting-intelligence/intake_1",
            label: "Discovery call",
            recordId: "intake_1",
            type: "meeting_intelligence"
          }),
          value: "Status: READY_FOR_REVIEW"
        })
      ])
    );
    expect(JSON.stringify(brief)).not.toContain("raw transcript");
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
    assistantNamePreset: "Stella",
    assistantCustomName: null,
    assistantHelpAreas: ["guide_around_app", "suggest_follow_ups"],
    assistantPermissionMode: "review_first",
    assistantTonePreset: "warm_helpful",
    diagnosticsDetailLevel: "simple",
    emailSummaryLength: "short",
    meetingIntelligenceNoteStyle: "structured",
    naturalLanguageInstructions: null,
    onboardingGoals: null,
    recordSummaryStyle: "balanced",
    relationshipMemoryUsage: "conservative",
    replyTone: "warm",
    suggestionAggressiveness: "medium",
    ...overrides
  };
}

function sampleContactContext(): NorthstarAssistantContext {
  return {
    audits: [],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["contact identity and owner", "Relationship Memory fields", "recent notes and emails"],
    record: { id: "person_1", label: "Jane Contact", type: "contact" },
    related: {
      activities: [{
        completedAt: null,
        dueAt: "2030-01-05T12:00:00.000Z",
        id: "activity_1",
        title: "Call Jane about rollout timing",
        type: "CALL"
      }],
      connections: [],
      emails: [{
        direction: "INBOUND",
        excerpt: "Re: rollout",
        followUpCount: 0,
        id: "email_1",
        occurredAt: "2030-01-02T10:00:00.000Z",
        signals: [],
        sourceAccountLabel: "Sales Inbox",
        subject: "Re: rollout"
      }],
      jobs: [],
      linkedRecords: [
        { id: "deal_linked_1", label: "Alpha Renewal", relationship: "linked_deal", status: "OPEN", type: "deal" },
        { id: "deal_linked_2", label: "Alpha Expansion", relationship: "linked_deal", status: "OPEN", type: "deal" }
      ],
      notes: [{ authorLabel: "Sam User", body: "Jane prefers morning calls before standup.", createdAt: "2030-01-01T12:00:00.000Z", id: "note_1" }],
      possibleLinks: [],
      proposalSummaries: ["Linked deal: Alpha Renewal (OPEN)", "Linked deal: Alpha Expansion (OPEN)"],
      relationshipFacts: [
        {
          field: "relationshipPersonalContext",
          label: "Personal context",
          source: {
            auditId: "audit_relationship_1",
            changedAt: "2030-01-01T15:00:00.000Z",
            sourceIntakeId: "intake_1",
            sourceTitle: "Discovery call",
            sourceType: "meeting_intelligence"
          },
          value: "Jane mentioned traveling to France with family."
        },
        { field: "relationshipCommunicationStyle", label: "Communication style", value: "Prefers concise morning calls." }
      ]
    },
    safety: { excludes: ["OAuth access tokens"], reviewFirst: true, workspaceScoped: true },
    surface: "contact",
    workspaceId: "workspace_1"
  };
}

function sampleOrganizationContext(): NorthstarAssistantContext {
  return {
    audits: [],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["organization identity", "linked contacts and deals", "notes"],
    record: { id: "org_1", label: "Alpha Orbit", type: "organization" },
    related: {
      activities: [],
      connections: [],
      emails: [],
      jobs: [],
      notes: [{ body: "Alpha Orbit has WMS implementation risk across two DCs.", createdAt: "2030-01-01T12:00:00.000Z", id: "note_1" }],
      possibleLinks: [],
      proposalSummaries: ["Domain: alpha.example", "Contacts: 2", "Deals: 1"],
      relationshipFacts: [
        { field: "relationshipPersonalContext", label: "Personal context", value: "Jane is traveling to France." }
      ]
    },
    safety: { excludes: ["OAuth access tokens"], reviewFirst: true, workspaceScoped: true },
    surface: "organization",
    workspaceId: "workspace_1"
  };
}

function sampleDealBriefContext(): NorthstarAssistantContext {
  return {
    audits: [],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["deal status and stage", "customer links", "recent notes and emails"],
    record: { id: "deal_1", label: "Alpha Renewal", status: "OPEN", type: "deal" },
    related: {
      activities: [{
        completedAt: null,
        dueAt: "2030-01-04T12:00:00.000Z",
        id: "activity_1",
        title: "Send legal packet",
        type: "EMAIL"
      }],
      connections: [],
      emails: [],
      jobs: [],
      notes: [{ body: "SOW timeline is blocked on legal review.", createdAt: "2030-01-01T12:00:00.000Z", id: "note_1" }],
      possibleLinks: [],
      proposalSummaries: ["Stage: Procurement", "Customer: Alpha Orbit", "Line items: 2", "Quotes: 1"],
      relationshipFacts: [
        { field: "relationshipPersonalContext", label: "Personal context", value: "Jane is traveling to France." }
      ]
    },
    safety: { excludes: ["OAuth access tokens"], reviewFirst: true, workspaceScoped: true },
    surface: "deal",
    workspaceId: "workspace_1"
  };
}

function sampleSparseContactContext(): NorthstarAssistantContext {
  return {
    audits: [],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["contact identity and owner", "Relationship Memory fields", "recent notes"],
    record: { id: "person_1", label: "Jane Contact", type: "contact" },
    related: {
      activities: [],
      connections: [],
      emails: [],
      jobs: [],
      notes: [{
        body: "Jane Contact: I will be traveling with family next month.",
        createdAt: "2030-01-01T12:00:00.000Z",
        id: "note_1"
      }],
      possibleLinks: [],
      proposalSummaries: [],
      relationshipFacts: []
    },
    safety: { excludes: ["OAuth access tokens"], reviewFirst: true, workspaceScoped: true },
    surface: "contact",
    workspaceId: "workspace_1"
  };
}

function sampleMeetingIntelligenceContext(): NorthstarAssistantContext {
  return {
    audits: [],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["Meeting Intelligence status", "review proposal summary"],
    record: { id: "intake_1", label: "Discovery call", status: "READY_FOR_REVIEW", type: "lead" },
    related: {
      activities: [],
      connections: [],
      emails: [],
      jobs: [],
      meetingIntelligenceSources: [{
        categories: ["personFact", "stakeholderNote"],
        href: "/meeting-intelligence/intake_1",
        id: "intake_1",
        label: "Discovery call",
        sourceType: "pasted_text",
        status: "READY_FOR_REVIEW"
      }],
      notes: [],
      possibleLinks: [],
      proposalSummaries: [
        "Status: READY_FOR_REVIEW",
        "Relationship Memory proposal signals: 2",
        "raw transcript: Jane Contact: I need legal review"
      ],
      relationshipFacts: []
    },
    safety: { excludes: ["OAuth access tokens", "raw provider payloads"], reviewFirst: true, workspaceScoped: true },
    surface: "meeting_intelligence",
    workspaceId: "workspace_1"
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
