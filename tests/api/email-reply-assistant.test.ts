import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildOpenAIEmailReplyRequestPayload,
  classifyOpenAIEmailReplyProviderError,
  buildEmailReplyPrompt,
  createOpenAIEmailReplyProvider,
  emailReplyAssistantReadiness,
  selectOpenAIEmailReplyModel,
  type EmailReplyContext
} from "@/lib/services/email-reply-assistant-service";

const assistantService = readFileSync(join(process.cwd(), "lib/services/email-reply-assistant-service.ts"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const emailAiReplyPanel = readFileSync(join(process.cwd(), "components/email-ai-reply-panel.tsx"), "utf8");
const emailActions = readFileSync(join(process.cwd(), "app/email/actions.ts"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
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

  it("builds a real Responses API payload with a configurable current model and structured output", () => {
    const context = sampleContext();
    const prompt = buildEmailReplyPrompt({ context, tone: "professional" });
    const defaultPayload = buildOpenAIEmailReplyRequestPayload({ context, prompt, tone: "professional" }, { OPENAI_API_KEY: "test-key" });
    const overridePayload = buildOpenAIEmailReplyRequestPayload(
      { context, prompt, tone: "professional" },
      { EMAIL_REPLY_OPENAI_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "test-key" }
    );

    expect(selectOpenAIEmailReplyModel({ OPENAI_API_KEY: "test-key" })).toBe("gpt-5.6-terra");
    expect(selectOpenAIEmailReplyModel({ EMAIL_REPLY_OPENAI_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "test-key" })).toBe("gpt-5.6-luna");
    expect(defaultPayload).toMatchObject({
      max_output_tokens: 1200,
      model: "gpt-5.6-terra",
      text: {
        format: {
          name: "email_reply_draft",
          strict: true,
          type: "json_schema"
        }
      }
    });
    expect(overridePayload.model).toBe("gpt-5.6-luna");
    expect(defaultPayload.input[0]).toEqual({
      role: "system",
      content: [{ type: "input_text", text: prompt.system }]
    });
    expect(defaultPayload.input[1]).toEqual({
      role: "user",
      content: [{ type: "input_text", text: prompt.user }]
    });
  });

  it("builds a guarded prompt from CRM context and relationship profile facts", () => {
    const prompt = buildEmailReplyPrompt({ context: sampleContext(), tone: "pricing_quote" });

    expect(prompt.system).toContain("Never auto-send");
    expect(prompt.system).toContain("Do not invent pricing, discounts, legal commitments, contract terms, dates");
    expect(prompt.system).toContain("Relationship Brief facts include field-level usage guidance");
    expect(prompt.system).toContain("Return strict JSON");
    expect(prompt.user).toContain("Tone option: answer pricing or quote questions carefully.");
    expect(prompt.user).toContain("Acme Expansion (OPEN, Proposal stage");
    expect(prompt.user).toContain("Quote Q-100: SENT");
    expect(prompt.user).toContain("Latest stored thread context:");
    expect(prompt.user).toContain("Yesterday we discussed budget approval.");
    expect(prompt.user).toContain("Meeting Intelligence:");
    expect(prompt.user).toContain("Decision: Maya wants a proposal this week");
    expect(prompt.user).toContain("Personal context (May inform warm personalization");
    expect(prompt.user).toContain("Communication style (Use for tone");
    expect(prompt.user).toContain("Internal guidance: present but withheld from customer-facing AI context");
    expect(prompt.user).not.toContain("Never mention procurement escalation");
  });

  it("parses OpenAI Responses JSON output without logging or sending email", async () => {
    const provider = createOpenAIEmailReplyProvider(
      { EMAIL_REPLY_OPENAI_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "openai-test-key" },
      (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("gpt-5.6-luna");
        expect(body.input[0].content[0].text).toContain("Never auto-send");
        expect(body.input[1].content[0].text).toContain("Email to reply to");
        expect(body.text.format.type).toBe("json_schema");
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

  it("classifies OpenAI provider failures without leaking secrets or raw request context", async () => {
    const context = sampleContext();
    const prompt = buildEmailReplyPrompt({ context, tone: "concise" });
    const cases = [
      {
        body: { error: { code: "invalid_api_key", message: "Incorrect API key provided: sk-live-secret.", type: "invalid_request_error" } },
        code: "AI_EMAIL_REPLY_PROVIDER_AUTHENTICATION_FAILED",
        message: "AI email reply provider authentication failed. Check OPENAI_API_KEY and retry.",
        status: 401
      },
      {
        body: { error: { code: "model_not_found", message: "The model `gpt-5.5` does not exist or you do not have access to it.", type: "invalid_request_error" } },
        code: "AI_EMAIL_REPLY_MODEL_UNAVAILABLE",
        message: "AI email reply model is not available. Check EMAIL_REPLY_OPENAI_MODEL or use the default supported model.",
        status: 400
      },
      {
        body: { error: { code: "rate_limit_exceeded", message: "Too many requests.", type: "rate_limit_error" } },
        code: "AI_EMAIL_REPLY_PROVIDER_RATE_LIMITED",
        message: "AI email reply provider is rate limited. Retry shortly.",
        status: 429
      },
      {
        body: { error: { code: "server_error", message: "Provider overloaded.", type: "server_error" } },
        code: "AI_EMAIL_REPLY_PROVIDER_UNAVAILABLE",
        message: "AI email reply provider is temporarily unavailable. Retry shortly.",
        status: 500
      }
    ];

    for (const providerCase of cases) {
      const provider = createOpenAIEmailReplyProvider(
        { OPENAI_API_KEY: "openai-test-key" },
        (async () => Response.json(providerCase.body, { status: providerCase.status })) as typeof fetch
      );

      await expect(provider?.generate({ context, prompt, tone: "concise" })).rejects.toMatchObject({
        code: providerCase.code,
        message: providerCase.message,
        status: providerCase.status >= 500 || providerCase.status === 429 ? 503 : 502
      });
    }

    expect(classifyOpenAIEmailReplyProviderError(400, { message: "The model `gpt-5.5` does not exist." })).toBe("unsupported_model");
    expect(assistantService).not.toContain("console.error");
    expect(assistantService).not.toContain("console.log");
  });

  it("does not expose provider-echoed prompt or email body text in error details", async () => {
    const context = sampleContext();
    const prompt = buildEmailReplyPrompt({ context, tone: "concise" });
    const provider = createOpenAIEmailReplyProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async () =>
        Response.json(
          {
            error: {
              code: "invalid_request_error",
              message: "Invalid request near customer text: Can you send pricing and next steps? sk-should-not-leak",
              type: "invalid_request_error"
            }
          },
          { status: 400 }
        )) as typeof fetch
    );

    await expect(provider?.generate({ context, prompt, tone: "concise" })).rejects.toMatchObject({
      code: "AI_EMAIL_REPLY_PROVIDER_REQUEST_FAILED",
      details: {
        category: "provider_request_rejected",
        providerCode: "invalid_request_error",
        providerMessage: "Provider rejected the draft request.",
        providerStatus: 400,
        providerType: "invalid_request_error"
      },
      message: "AI email reply provider rejected the draft request.",
      status: 502
    });
    await provider?.generate({ context, prompt, tone: "concise" }).catch((error) => {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain("Can you send pricing");
      expect(serialized).not.toContain("sk-should-not-leak");
      expect(serialized).not.toContain(prompt.user);
    });
  });

  it("surfaces network, timeout, and invalid provider response states distinctly", async () => {
    const context = sampleContext();
    const prompt = buildEmailReplyPrompt({ context, tone: "concise" });
    const networkProvider = createOpenAIEmailReplyProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async () => {
        throw new TypeError("fetch failed with sk-should-not-leak");
      }) as typeof fetch
    );
    const timeoutProvider = createOpenAIEmailReplyProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }) as typeof fetch
    );
    const invalidProvider = createOpenAIEmailReplyProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async () => Response.json({ id: "resp_without_text", output: [] })) as typeof fetch
    );

    await expect(networkProvider?.generate({ context, prompt, tone: "concise" })).rejects.toMatchObject({
      code: "AI_EMAIL_REPLY_PROVIDER_UNAVAILABLE",
      message: "AI email reply provider could not be reached. Retry shortly.",
      status: 503
    });
    await expect(timeoutProvider?.generate({ context, prompt, tone: "concise" })).rejects.toMatchObject({
      code: "AI_EMAIL_REPLY_PROVIDER_UNAVAILABLE",
      message: "AI email reply provider timed out. Retry shortly.",
      status: 503
    });
    await expect(invalidProvider?.generate({ context, prompt, tone: "concise" })).rejects.toMatchObject({
      code: "AI_EMAIL_REPLY_PROVIDER_INVALID_RESPONSE",
      message: "AI email reply provider returned an invalid draft response.",
      status: 502
    });
  });

  it("parses fenced and aliased provider JSON without surfacing a generic draft failure", async () => {
    const provider = createOpenAIEmailReplyProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async () =>
        Response.json({
          output_text:
            '```json\n{"replyBody":"Hi Maya,\\n\\nThanks for checking in. I will confirm the proposal details before sending them over.","subject":"Re: Pricing question","nextAction":"Review quote details before sending.","warnings":["Verify pricing."]}\n```'
        })) as typeof fetch
    );

    await expect(
      provider?.generate({
        context: sampleContext(),
        prompt: buildEmailReplyPrompt({ context: sampleContext(), tone: "concise" }),
        tone: "concise"
      })
    ).resolves.toMatchObject({
      body: "Hi Maya,\n\nThanks for checking in. I will confirm the proposal details before sending them over.",
      subjectSuggestion: "Re: Pricing question",
      suggestedNextAction: "Review quote details before sending.",
      warnings: ["Verify pricing."]
    });
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
    expect(assistantService).toContain("relationshipBriefPromptFact");
    expect(assistantService).toContain("Do not quote fields marked internal-only or do-not-mention-directly.");
    expect(assistantService).toContain("getRelationshipProfileFacts");
    expect(assistantService).toContain("Approved relationship profile facts");
    expect(assistantService).toContain("Use only the provided email and CRM context");
    expect(currentStatus).toContain("Meeting Intelligence meeting summaries and approved follow-up activities can appear as CRM context");
    expect(architecture).toContain("AI Email Reply Assistant prompt assembly consumes relevant Meeting Intelligence summaries");
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
    relationshipProfileFacts: [
      "Personal context (May inform warm personalization when voluntarily shared, but avoid protected traits or overly sensitive details.): Rockies fan",
      "Communication style (Use for tone, cadence, and level of detail. Usually adapt the reply rather than quoting the preference.): Prefers concise morning emails",
      "Internal guidance: present but withheld from customer-facing AI context. Internal-only handling guidance. Do not include the stored text in customer-facing AI drafts."
    ],
    threadMessages: [
      {
        body: "Yesterday we discussed budget approval.",
        direction: "OUTBOUND",
        fromText: "sales@example.test",
        occurredAt: new Date("2030-01-01T12:00:00.000Z"),
        subject: "Re: Pricing question",
        toText: "Maya Buyer <maya@example.test>"
      }
    ]
  };
}
