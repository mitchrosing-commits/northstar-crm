import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildEmailReplyPrompt,
  createOpenAIEmailReplyProvider,
  emailReplyAssistantReadiness,
  type EmailReplyContext
} from "@/lib/services/email-reply-assistant-service";

const assistantService = readFileSync(join(process.cwd(), "lib/services/email-reply-assistant-service.ts"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const emailAiReplyPanel = readFileSync(join(process.cwd(), "components/email-ai-reply-panel.tsx"), "utf8");
const emailActions = readFileSync(join(process.cwd(), "app/email/actions.ts"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("AI email reply assistant", () => {
  it("reports provider readiness without requiring AI for email workflows", () => {
    expect(emailReplyAssistantReadiness({})).toEqual({
      configured: false,
      message: "AI reply drafting is not configured. Set OPENAI_API_KEY to enable review-first draft generation.",
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId: "none",
      providerName: "Not configured"
    });
    expect(emailReplyAssistantReadiness({ OPENAI_API_KEY: "test-key" })).toMatchObject({
      configured: true,
      missingEnvNames: [],
      providerId: "openai",
      providerName: "OpenAI"
    });
  });

  it("builds a guarded prompt from CRM context and relationship profile facts", () => {
    const prompt = buildEmailReplyPrompt({ context: sampleContext(), tone: "pricing_quote" });

    expect(prompt.system).toContain("Never auto-send");
    expect(prompt.system).toContain("Do not invent pricing, discounts, legal commitments, contract terms, dates");
    expect(prompt.system).toContain("Return strict JSON");
    expect(prompt.user).toContain("Tone option: answer pricing or quote questions carefully.");
    expect(prompt.user).toContain("Acme Expansion (OPEN, Proposal stage");
    expect(prompt.user).toContain("Quote Q-100: SENT");
    expect(prompt.user).toContain("Personal context: Rockies fan");
    expect(prompt.user).toContain("Communication style: Prefers concise morning emails");
  });

  it("parses OpenAI Responses JSON output without logging or sending email", async () => {
    const provider = createOpenAIEmailReplyProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.input[0].content).toContain("Never auto-send");
        expect(body.input[1].content).toContain("Email to reply to");
        return Response.json({
          output_text: JSON.stringify({
            body: "Hi Maya,\n\nThanks for the note. I will confirm pricing details before sharing specifics.",
            contextUsed: ["Email subject and body", "Deal stage/status", "Quote"],
            subjectSuggestion: "Re: Pricing question",
            suggestedNextAction: "Confirm quote details before replying.",
            warnings: ["Verify pricing before sending."]
          })
        });
      }) as typeof fetch
    );

    await expect(provider?.generate({ context: sampleContext(), prompt: buildEmailReplyPrompt({ context: sampleContext(), tone: "concise" }), tone: "concise" })).resolves.toMatchObject({
      body: expect.stringContaining("confirm pricing details"),
      contextUsed: ["Email subject and body", "Deal stage/status", "Quote"],
      subjectSuggestion: "Re: Pricing question"
    });
    expect(assistantService).not.toContain("sendMail");
    expect(assistantService).not.toContain("smtp");
  });

  it("renders a review-first AI panel on stored email logs only", () => {
    expect(emailPage).toContain('import { EmailAiReplyPanel } from "@/components/email-ai-reply-panel"');
    expect(emailPage).toContain("emailReplyAssistantReadiness(process.env)");
    expect(emailPage).toContain("<EmailAiReplyPanel");
    expect(emailPage).toContain("aiReplyReadiness={aiReplyReadiness}");
    expect(emailPage).toContain("emailLogId={emailLog.id}");
    expect(emailAiReplyPanel).toContain("Draft with AI");
    expect(emailAiReplyPanel).toContain("Review-first only.");
    expect(emailAiReplyPanel).toContain("never sends AI replies automatically");
    expect(emailAiReplyPanel).toContain("Generate reply");
    expect(emailAiReplyPanel).toContain("Regenerate reply");
    expect(emailAiReplyPanel).toContain("Context used");
    expect(emailAiReplyPanel).toContain("Review cautions");
    expect(emailAiReplyPanel).toContain("textarea");
    expect(emailAiReplyPanel).toContain("Copy draft");
    expect(emailAiReplyPanel).toContain("Open compose");
    expect(emailActions).toContain("generateEmailReplyDraftAction");
    expect(emailActions).toContain("generateEmailReplyDraft(actor, { emailLogId, tone })");
  });

  it("keeps the relationship profile hook explicit for future personalization", () => {
    expect(assistantService).toContain("personRelationshipProfile(person)");
    expect(assistantService).toContain("getRelationshipProfileFacts");
    expect(assistantService).toContain("Approved relationship profile facts");
    expect(assistantService).toContain("Use only the provided email and CRM context");
    expect(currentStatus).toContain("AI Email Reply Assistant");
  });
});

function sampleContext(): EmailReplyContext {
  return {
    activities: ["Open email: Send follow-up, due 2030-02-01"],
    contact: "Maya Buyer <maya@example.test>",
    contractSteps: ["MSA: IN_PROGRESS"],
    deal: "Acme Expansion (OPEN, Proposal stage, Sales pipeline), value $12,000.00",
    email: {
      body: "Can you send pricing and next steps?",
      direction: "INBOUND",
      fromText: "Maya Buyer <maya@example.test>",
      occurredAt: new Date("2030-01-02T12:00:00.000Z"),
      provider: "GOOGLE_WORKSPACE",
      subject: "Pricing question",
      toText: "sales@example.test"
    },
    meetingSummaries: ["Decision: Maya wants a proposal this week"],
    notes: ["2030-01-01: Procurement needs careful review."],
    organization: "Acme (acme.example)",
    productsAndQuotes: ["Quote Q-100: SENT, total $12,000.00, 2 items"],
    relationshipProfileFacts: ["Personal context: Rockies fan", "Communication style: Prefers concise morning emails"]
  };
}
