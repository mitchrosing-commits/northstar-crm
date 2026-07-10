import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildEmailClassificationPrompt,
  buildLocalEmailLabelSuggestions,
  buildLocalEmailSmartClassification,
  createOpenAIEmailClassificationProvider,
  emailClassificationReadiness,
  emailSmartClassificationLabels,
  emailSmartSignalPriorityRank,
  readEmailSmartClassification
} from "@/lib/services/email-classification-service";
import type { EmailReplyContext } from "@/lib/services/email-reply-assistant-service";

const classificationService = readFileSync(join(process.cwd(), "lib/services/email-classification-service.ts"), "utf8");
const emailPage = readFileSync(join(process.cwd(), "app/email/page.tsx"), "utf8");
const emailSmartLabelPanel = readFileSync(join(process.cwd(), "components/email-smart-label-panel.tsx"), "utf8");
const emailActions = readFileSync(join(process.cwd(), "app/email/actions.ts"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");

describe("Smart Email Labels", () => {
  it("reports provider readiness without requiring AI for email workflows", () => {
    expect(emailClassificationReadiness({})).toEqual({
      configured: false,
      message: "Smart Email Labels are not configured. Set OPENAI_API_KEY to enable review-first classification.",
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId: "none",
      providerName: "Not configured"
    });
    expect(emailClassificationReadiness({ OPENAI_API_KEY: "test-key" })).toMatchObject({
      configured: true,
      missingEnvNames: [],
      providerId: "openai",
      providerName: "OpenAI"
    });
  });

  it("builds a guarded relationship-inbox prompt from CRM email context", () => {
    const prompt = buildEmailClassificationPrompt({ context: sampleContext() });

    expect(prompt.system).toContain("Smart Email Label classifier");
    expect(prompt.system).toContain("Do not classify protected traits");
    expect(prompt.system).toContain("Do not create, recommend automatic creation");
    expect(prompt.system).toContain("Allowed categories: CUSTOMER, PROSPECT, INTERNAL, PERSONAL, UNKNOWN, NOT_CRM_RELEVANT");
    expect(prompt.system).toContain("Allowed signals: URGENT, NEEDS_REPLY");
    expect(prompt.system).toContain("categoryEvidence");
    expect(prompt.system).toContain("signalEvidence");
    expect(prompt.system).toContain("do not provide exact offsets");
    expect(prompt.user).toContain("Pricing question");
    expect(prompt.user).toContain("Acme Expansion (OPEN, Proposal stage");
    expect(prompt.user).toContain("Quote Q-100: SENT");
    expect(prompt.user).toContain("Approved relationship profile facts");
  });

  it("parses OpenAI Responses JSON output into supported labels only", async () => {
    const provider = createOpenAIEmailClassificationProvider(
      { OPENAI_API_KEY: "openai-test-key" },
      (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.input[0].content).toContain("Do not classify protected traits");
        expect(body.input[1].content).toContain("Email to classify");
        return Response.json({
          output_text: JSON.stringify({
            category: "CUSTOMER",
            categoryEvidence: {
              confidence: 0.8,
              excerpts: ["Customer asks for quote timing and next steps."],
              reason: "The message is from a customer with an active deal."
            },
            confidence: 0.91,
            evidence: [
              "Customer asks for quote timing and next steps.",
              "x".repeat(260),
              "Customer asks for quote timing and next steps."
            ],
            signalEvidence: [
              {
                confidence: 0.92,
                excerpts: ["This is urgent.", "Can you send quote pricing and confirm next steps today?", "third ignored excerpt"],
                reason: "The sender asks for action today.",
                severity: "high",
                signal: "URGENT"
              },
              {
                excerpts: ["Can you send quote pricing and confirm next steps today?"],
                reason: "The customer asks a direct question that needs a response.",
                signal: "NEEDS_REPLY"
              },
              {
                excerpts: ["Unsupported should be dropped."],
                reason: "Unsupported signal.",
                signal: "UNSUPPORTED_SIGNAL"
              },
              {
                excerpts: ["Not selected should be dropped."],
                reason: "Waiting signal was not selected.",
                signal: "WAITING_ON_CUSTOMER"
              }
            ],
            signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE", "UNSUPPORTED_SIGNAL"],
            summary: "Customer pricing email needs a timely reply."
          })
        });
      }) as typeof fetch
    );

    await expect(
      provider?.classify({ context: sampleContext(), prompt: buildEmailClassificationPrompt({ context: sampleContext() }) })
    ).resolves.toMatchObject({
      category: "CUSTOMER",
      categoryEvidence: {
        category: "CUSTOMER",
        confidence: 0.8,
        excerpts: ["Customer asks for quote timing and next steps."],
        reason: "The message is from a customer with an active deal."
      },
      confidence: 0.91,
      evidence: [
        "Customer asks for quote timing and next steps.",
        "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx..."
      ],
      signalEvidence: [
        {
          confidence: 0.92,
          excerpts: ["This is urgent.", "Can you send quote pricing and confirm next steps today?"],
          reason: "The sender asks for action today.",
          severity: "high",
          signal: "URGENT"
        },
        {
          excerpts: ["Can you send quote pricing and confirm next steps today?"],
          reason: "The customer asks a direct question that needs a response.",
          signal: "NEEDS_REPLY"
        }
      ],
      signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE"],
      summary: "Customer pricing email needs a timely reply."
    });
    expect(classificationService).not.toContain("sendMail");
    expect(classificationService).not.toContain("createActivity");
    expect(classificationService).not.toContain("createLead");
  });

  it("reads saved smart-label snapshots for relationship inbox priority display", () => {
    const classification = readEmailSmartClassification({
      smartLabelGeneratedAt: new Date("2030-01-04T12:00:00.000Z"),
      smartLabelJson: {
        category: "CUSTOMER",
        categoryEvidence: {
          excerpts: ["Contract is ready today."],
          reason: "Linked customer asks about contract readiness."
        },
        confidence: 0.88,
        evidence: ["Asks whether the contract is ready today."],
        signalEvidence: [
          {
            excerpts: ["contract is ready today"],
            reason: "The customer asks about a contract deadline.",
            signal: "CONTRACT_LEGAL"
          },
          {
            excerpts: ["Unsupported should be ignored."],
            reason: "Unknown signal.",
            signal: "UNKNOWN_SIGNAL"
          },
          {
            excerpts: ["Potential lead evidence should be ignored because the signal was not selected."],
            reason: "Not selected.",
            signal: "POTENTIAL_LEAD"
          }
        ],
        signals: ["URGENT", "CONTRACT_LEGAL", "UNKNOWN_SIGNAL"],
        summary: "Urgent contract email."
      },
      smartLabelProvider: "openai"
    });

    expect(classification).toMatchObject({
      category: "CUSTOMER",
      confidence: 0.88,
      providerId: "openai",
      providerName: "OpenAI",
      signalEvidence: [
        {
          excerpts: ["contract is ready today"],
          reason: "The customer asks about a contract deadline.",
          signal: "CONTRACT_LEGAL"
        }
      ],
      signals: ["URGENT", "CONTRACT_LEGAL"],
      summary: "Urgent contract email."
    });
    expect(classification?.categoryEvidence).toMatchObject({
      category: "CUSTOMER",
      excerpts: ["Contract is ready today."],
      reason: "Linked customer asks about contract readiness."
    });
    expect(emailSmartClassificationLabels(classification!)).toEqual(["Customer", "Urgent", "Contract / legal"]);
    expect(emailSmartSignalPriorityRank(classification)).toBe(4);
  });

  it("keeps old flat smart-label snapshots backward compatible", () => {
    const classification = readEmailSmartClassification({
      smartLabelGeneratedAt: new Date("2030-01-04T12:00:00.000Z"),
      smartLabelJson: {
        category: "CUSTOMER",
        confidence: 0.77,
        evidence: ["Old flat evidence only."],
        signals: ["NEEDS_REPLY"],
        summary: "Old label snapshot."
      },
      smartLabelProvider: "openai"
    });

    expect(classification).toMatchObject({
      category: "CUSTOMER",
      evidence: ["Old flat evidence only."],
      signalEvidence: [],
      signals: ["NEEDS_REPLY"],
      summary: "Old label snapshot."
    });
    expect(classification?.categoryEvidence).toBeUndefined();
  });

  it("generates deterministic local labels when AI refinement is unavailable", () => {
    const classification = buildLocalEmailSmartClassification(
      {
        body: "Can you send updated pricing and contract timing today? We need the proposal for our demo.",
        dealId: "deal_1",
        direction: "INBOUND",
        fromText: "Maya Buyer <maya@example.test>",
        subject: "Pricing and contract timing"
      },
      { now: new Date("2030-01-04T12:00:00.000Z") }
    );

    expect(buildLocalEmailLabelSuggestions({
      body: "Newsletter digest. Unsubscribe or view in browser.",
      providerLabels: ["CATEGORY_PROMOTIONS"],
      subject: "Vendor newsletter"
    })).toEqual(
      expect.arrayContaining([
        "Automated / no-reply",
        "Newsletter / promotion",
        "Unimportant",
        "No CRM link"
      ])
    );
    expect(classification).toMatchObject({
      category: "CUSTOMER",
      providerId: "local_rules",
      providerName: "Local rules",
      signals: expect.arrayContaining(["NEEDS_REPLY", "PRICING_QUOTE", "CONTRACT_LEGAL", "POSITIVE_BUYING_SIGNAL"]),
      summary: expect.stringContaining("Local rules suggest")
    });
    expect(classification.evidence.join(" ")).not.toContain("raw-secret-token");
  });

  it("renders smart labels in Inbox without replacing manual email workflows", () => {
    expect(emailPage).toContain('import { EmailSmartLabelPanel } from "@/components/email-smart-label-panel"');
    expect(emailPage).toContain("emailClassificationReadiness(process.env)");
    expect(emailPage).toContain("Relationship Inbox Queue");
    expect(emailPage).toContain("<EmailSmartLabelPanel");
    expect(emailPage).toContain("readEmailSmartClassification(emailLog)");
    expect(emailPage).toContain("buildLocalEmailSmartClassification(emailLog)");
    expect(emailPage).toContain("buildLocalEmailLabelSuggestions(emailLog)");
    expect(emailSmartLabelPanel).toContain("Refine with AI");
    expect(emailSmartLabelPanel).toContain("AI labeling unavailable; using local labels.");
    expect(emailSmartLabelPanel).toContain("email-smart-label-diagnostics");
    expect(emailSmartLabelPanel).not.toContain("FormErrorMessage");
    expect(emailSmartLabelPanel).not.toContain("provider request failed");
    expect(emailSmartLabelPanel).toContain("Why this was labeled");
    expect(emailSmartLabelPanel).toContain("Labels do not create tasks or change CRM records");
    expect(emailActions).toContain("classifyEmailLogAction");
    expect(emailActions).toContain("classifyEmailLog(actor, { emailLogId })");
    expect(currentStatus).toContain("Smart Email Labels");
    expect(currentStatus).toContain("do not send email, mutate Gmail labels, or create activities, notes, leads, CRM links, or profile facts");
  });
});

function sampleContext(): EmailReplyContext {
  return {
    activities: ["Open email: Send follow-up, due 2030-02-01"],
    contact: "Maya Buyer <maya@example.test>",
    contractSteps: ["MSA: IN_PROGRESS"],
    deal: "Acme Expansion (OPEN, Proposal stage, Sales pipeline), value $12,000.00",
    email: {
      body: "This is urgent. Can you send quote pricing and confirm next steps today?",
      direction: "INBOUND",
      fromText: "Maya Buyer <maya@example.test>",
      occurredAt: new Date("2030-01-02T12:00:00.000Z"),
      provider: "GOOGLE_WORKSPACE",
      subject: "Pricing question",
      toText: "sales@example.test"
    },
    lead: undefined,
    meetingSummaries: ["Decision: Maya wants a proposal this week"],
    notes: ["2030-01-01: Procurement needs careful review."],
    organization: "Acme (acme.example)",
    productsAndQuotes: ["Quote Q-100: SENT, total $12,000.00, 2 items"],
    relationshipProfileFacts: ["Communication style: Prefers concise morning emails"],
    threadMessages: []
  };
}
