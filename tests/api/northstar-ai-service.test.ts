import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDeterministicInsight,
  buildNorthstarAssistantPrompt,
  createOpenAINorthstarAssistantProvider,
  northstarAssistantReadiness,
  summarizeConnectionScopes,
  type NorthstarAssistantContext
} from "@/lib/services/northstar-ai-service";

const service = readFileSync(join(process.cwd(), "lib/services/northstar-ai-service.ts"), "utf8");
const barrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const panel = readFileSync(join(process.cwd(), "components/northstar-assistant-panel.tsx"), "utf8");
const contactPage = readFileSync(join(process.cwd(), "app/contacts/[personId]/page.tsx"), "utf8");
const dealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const styles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("Northstar Assistant operating layer", () => {
  it("keeps provider summaries gated while deterministic diagnostics remain available", () => {
    expect(northstarAssistantReadiness({})).toEqual({
      configured: false,
      message: "Northstar Assistant AI summaries are not configured. Deterministic diagnostics still run.",
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId: "none",
      providerName: "Not configured"
    });
    expect(northstarAssistantReadiness({ OPENAI_API_KEY: "test-key" })).toMatchObject({
      configured: true,
      missingEnvNames: [],
      providerId: "openai",
      providerName: "OpenAI"
    });
  });

  it("detects record discrepancies and returns only review-first actions", () => {
    const insight = buildDeterministicInsight(sampleDealContext());

    expect(insight.mode).toBe("deterministic");
    expect(insight.providerId).toBe("deterministic");
    expect(insight.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      "deal-missing-customer",
      "closed-deal-open-activities"
    ]));
    expect(insight.summary).toContain("Deal is missing a customer link");
    expect(insight.suggestedActions.length).toBeGreaterThan(0);
    expect(insight.suggestedActions.every((action) => action.reviewFirst)).toBe(true);
    expect(insight.guardrails).toContain("No automatic changes");
  });

  it("detects inbox diagnostic issues without needing an AI provider", () => {
    const insight = buildDeterministicInsight(sampleInboxContext());

    expect(insight.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining([
      "unlinked-inbound-email",
      "email-needs-follow-up-without-linked-activity",
      "connection-readiness-issue",
      "failed-jobs"
    ]));
    expect(insight.cautions.join(" ")).toContain("private connection data");
    expect(insight.suggestedActions.some((action) => action.kind === "reconnect_guidance")).toBe(true);
    expect(insight.suggestedActions.some((action) => action.kind === "retry_sync_proposal")).toBe(true);
  });

  it("builds a guarded provider prompt and parses provider JSON", async () => {
    const context = sampleInboxContext();
    const deterministicInsight = buildDeterministicInsight(context);
    const prompt = buildNorthstarAssistantPrompt(context, deterministicInsight);

    expect(prompt.system).toContain("Do not expose secrets");
    expect(prompt.system).toContain("Every action must stay review-first");
    expect(prompt.user).toContain("raw provider payloads");
    expect(prompt.user).not.toContain("encryptedAccessToken");
    expect(prompt.user).not.toContain("refreshToken");

    const provider = createOpenAINorthstarAssistantProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.input[0].content).toContain("Northstar Assistant");
        expect(body.input[1].content).toContain("deterministicInsight");
        return Response.json({
          output_text: JSON.stringify({
            cautions: ["Verify the job state before retrying."],
            confidence: "high",
            summary: "The inbox has one unlinked priority email and one failed email job."
          })
        });
      }) as typeof fetch
    );

    await expect(provider?.explain({ context, deterministicInsight, prompt })).resolves.toMatchObject({
      confidence: "high",
      summary: expect.stringContaining("failed email job")
    });
  });

  it("summarizes OAuth scopes by category instead of exposing raw provider internals", () => {
    expect(summarizeConnectionScopes([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "profile"
    ])).toEqual(["Gmail read", "Gmail send", "Profile", "Email identity"]);
  });

  it("keeps diagnostic context builders scoped and secret-aware by construction", () => {
    expect(service).toContain("await ensureWorkspaceAccess(actor)");
    expect(service).toContain("workspaceId: actor.workspaceId");
    expect(service).toContain("records outside the active workspace");
    expect(service).toContain("raw provider payloads");
    expect(service).toContain("job payload internals");
    expect(service).toContain("OAuth access tokens");
    expect(service).toContain("OAuth refresh tokens");
    expect(service).toContain("redactSensitiveText");
    expect(service).not.toContain("emailConnectionSecret.find");
    expect(service).not.toContain("encryptedAccessToken");
    expect(service).not.toContain("encryptedRefreshToken");
    expect(service).not.toContain("payload:");
  });

  it("renders the reusable AI-first entry point on Inbox, contact, and deal pages", () => {
    expect(barrel).toContain('export * from "./northstar-ai-service"');
    expect(panel).toContain("NorthstarAssistantPanel");
    expect(panel).toContain("Reviewed");
    expect(panel).toContain("Suggested Next Actions");
    expect(panel).toContain("Review before apply");
    expect(panel).toContain("Review-first guidance");
    expect(styles).toContain(".northstar-assistant-panel");
    expect(styles).toContain(".northstar-assistant-grid");
    expect(contactPage).toContain("buildContactAssistantContext");
    expect(contactPage).toContain("<NorthstarAssistantPanel insight={northstarInsight} />");
    expect(dealPage).toContain("buildDealAssistantContext");
    expect(dealPage).toContain("<NorthstarAssistantPanel insight={northstarInsight} />");
    expect(emailPage).toContain("buildInboxAssistantContext");
    expect(emailPage).toContain("<NorthstarAssistantPanel insight={northstarInsight} />");
  });
});

function sampleDealContext(): NorthstarAssistantContext {
  return {
    audits: [],
    generatedAt: "2030-01-02T12:00:00.000Z",
    lookedAt: ["deal status and stage", "customer links", "open and completed activities"],
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
    lookedAt: ["recent stored email logs", "saved Smart Label snapshots", "email connection health", "recent email sync activity"],
    related: {
      activities: [],
      connections: [{
        accountEmail: "sales@example.test",
        createdAt: "2030-01-01T12:00:00.000Z",
        id: "connection_1",
        lastError: "401 reconnect required",
        lastSyncAt: null,
        provider: "GOOGLE_WORKSPACE",
        scopeCategories: ["Gmail read", "Gmail send"],
        status: "RECONNECT_REQUIRED",
        updatedAt: "2030-01-02T12:00:00.000Z"
      }],
      emails: [{
        direction: "INBOUND",
        followUpCount: 0,
        id: "email_1",
        occurredAt: "2030-01-02T10:00:00.000Z",
        provider: "GOOGLE_WORKSPACE",
        signals: ["NEEDS_REPLY", "FOLLOW_UP_NEEDED"],
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
