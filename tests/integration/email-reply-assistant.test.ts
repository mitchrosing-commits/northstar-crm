import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type CrmServices = typeof import("@/lib/services/crm");
type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let crm: CrmServices;
let fixture: Fixture | undefined;

beforeAll(async () => {
  crm = await import("@/lib/services/crm");
});

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("AI email reply assistant service", () => {
  it("assembles workspace-scoped CRM context and curated relationship facts for a logged email", async () => {
    const fx = currentFixture();
    await fx.prisma.person.update({
      where: { id: fx.recordsA.person.id },
      data: {
        relationshipCommunicationStyle: "Prefers concise morning emails",
        relationshipFollowUpReminders: "Ask how the Colorado trip went",
        relationshipInternalGuidance: "Use naturally; do not over-personalize.",
        relationshipPersonalContext: "Rockies fan"
      }
    });
    await fx.prisma.note.create({
      data: {
        body: "Alpha pricing must be verified with finance before promising anything.",
        dealId: fx.recordsA.deal.id,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.note.create({
      data: {
        body: "Beta cross-workspace note must never appear.",
        dealId: fx.recordsB.deal.id,
        workspaceId: fx.workspaceB.id
      }
    });
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Can you send pricing and next steps?",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-03T12:00:00.000Z",
      subject: "Pricing and next steps",
      toText: "sales@example.test"
    });
    let observed: Awaited<ReturnType<typeof crm.buildEmailReplyContext>> | undefined;

    const draft = await crm.generateEmailReplyDraft(
      fx.actorA,
      { emailLogId: emailLog.id, tone: "pricing_quote" },
      {
        provider: {
          id: "test-provider",
          name: "Test provider",
          async generate(input) {
            observed = input.context;
            return {
              body: "Hi Alpha,\n\nThanks for asking. I will verify pricing before sharing specifics.",
              contextUsed: ["Email subject and body", "Deal stage/status", "Recent notes", "Approved relationship profile facts"],
              subjectSuggestion: "Re: Pricing and next steps",
              warnings: ["Verify pricing before sending."]
            };
          }
        }
      }
    );

    expect(draft).toMatchObject({
      body: expect.stringContaining("verify pricing"),
      subjectSuggestion: "Re: Pricing and next steps",
      tone: "pricing_quote"
    });
    expect(draft.warnings).toContain("Review and edit before using. Northstar never sends AI-generated replies automatically.");
    expect(observed?.deal).toContain(fx.recordsA.deal.title);
    expect(observed?.contact).toContain(fx.recordsA.person.email);
    expect(observed?.notes.join("\n")).toContain("Alpha pricing must be verified");
    expect(observed?.notes.join("\n")).not.toContain("Beta cross-workspace");
    expect(observed?.relationshipProfileFacts).toEqual([
      "Personal context (May inform warm personalization when voluntarily shared, but avoid protected traits or overly sensitive details.): Rockies fan",
      "Communication style (Use for tone, cadence, and level of detail. Usually adapt the reply rather than quoting the preference.): Prefers concise morning emails",
      "Follow-up reminders (Use as operational next-step context. Do not quote as a stored reminder.): Ask how the Colorado trip went",
      "Internal guidance: present but withheld from customer-facing AI context. Internal-only handling guidance. Do not include the stored text in customer-facing AI drafts."
    ]);
    expect(observed?.relationshipProfileFacts.join("\n")).not.toContain("Use naturally; do not over-personalize.");
  });

  it("fails closed when no AI provider is configured without mutating email logs", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Can you follow up?",
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-03T12:00:00.000Z",
      personId: fx.recordsA.person.id,
      subject: "Follow up",
      toText: "sales@example.test"
    });
    const beforeCount = await fx.prisma.emailLog.count({ where: { workspaceId: fx.workspaceA.id } });

    await expect(
      crm.generateEmailReplyDraft(
        fx.actorA,
        { emailLogId: emailLog.id },
        { env: { OPENAI_API_KEY: undefined } }
      )
    ).rejects.toMatchObject({
      code: "AI_EMAIL_REPLY_NOT_CONFIGURED",
      status: 503
    });
    await expect(fx.prisma.emailLog.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeCount);
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
