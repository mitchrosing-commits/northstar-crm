import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { EmailReplyProviderInput } from "@/lib/services/email-reply-assistant-service";

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

  it("includes same-workspace stored thread context without provider or CRM mutation", async () => {
    const fx = currentFixture();
    const connection = await fx.prisma.emailConnection.create({
      data: {
        accountEmail: "sales@example.test",
        createdById: fx.userA.id,
        provider: "GOOGLE_WORKSPACE",
        scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
        status: "CONNECTED",
        workspaceId: fx.workspaceA.id
      }
    });
    const otherWorkspaceConnection = await fx.prisma.emailConnection.create({
      data: {
        accountEmail: "sales@example.test",
        createdById: fx.userB.id,
        provider: "GOOGLE_WORKSPACE",
        scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
        status: "CONNECTED",
        workspaceId: fx.workspaceB.id
      }
    });
    const threadId = "thread-ai-reply-context-1";
    await fx.prisma.emailLog.create({
      data: {
        body: "Earlier customer question from another workspace must not be visible.",
        direction: "INBOUND",
        emailConnectionId: otherWorkspaceConnection.id,
        fromText: "Beta Contact <beta@example.test>",
        occurredAt: new Date("2030-01-02T09:00:00.000Z"),
        provider: "GOOGLE_WORKSPACE",
        providerMessageId: "beta-thread-message-1",
        providerThreadId: threadId,
        subject: "Shared thread id",
        toText: "sales@example.test",
        workspaceId: fx.workspaceB.id
      }
    });
    await fx.prisma.emailLog.create({
      data: {
        body: "Can you confirm the implementation timeline?",
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
        occurredAt: new Date("2030-01-02T10:00:00.000Z"),
        personId: fx.recordsA.person.id,
        provider: "GOOGLE_WORKSPACE",
        providerMessageId: "alpha-thread-message-1",
        providerThreadId: threadId,
        subject: "Implementation timeline",
        toText: "sales@example.test",
        workspaceId: fx.workspaceA.id
      }
    });
    const targetEmail = await fx.prisma.emailLog.create({
      data: {
        body: "Thanks. What are the next steps after legal review?",
        dealId: fx.recordsA.deal.id,
        direction: "INBOUND",
        emailConnectionId: connection.id,
        fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
        occurredAt: new Date("2030-01-03T10:00:00.000Z"),
        personId: fx.recordsA.person.id,
        provider: "GOOGLE_WORKSPACE",
        providerMessageId: "alpha-thread-message-2",
        providerThreadId: threadId,
        subject: "Re: Implementation timeline",
        toText: "sales@example.test",
        workspaceId: fx.workspaceA.id
      }
    });
    let observed: Awaited<ReturnType<typeof crm.buildEmailReplyContext>> | undefined;
    const beforeCounts = await readMutationGuardCounts(fx);

    const draft = await crm.generateEmailReplyDraft(
      fx.actorA,
      { emailLogId: targetEmail.id, tone: "follow_up" },
      {
        provider: {
          id: "test-provider",
          name: "Test provider",
          async generate(input) {
            observed = input.context;
            return {
              body: "Hi Alpha,\n\nThanks. I will confirm the next steps after legal review.",
              subjectSuggestion: "Re: Implementation timeline"
            };
          }
        }
      }
    );

    expect(draft.body).toContain("next steps");
    expect(observed?.email.body).toContain("What are the next steps");
    expect(observed?.threadMessages).toHaveLength(1);
    expect(observed?.threadMessages[0]).toMatchObject({
      body: "Can you confirm the implementation timeline?",
      direction: "INBOUND",
      subject: "Implementation timeline"
    });
    expect(JSON.stringify(observed?.threadMessages)).not.toContain("another workspace");
    await expect(readMutationGuardCounts(fx)).resolves.toEqual(beforeCounts);
  });

  it("deduplicates concurrent identical reply generations for one user and email", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Can you send next steps?",
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-03T12:00:00.000Z",
      personId: fx.recordsA.person.id,
      subject: "Concurrent reply",
      toText: "sales@example.test"
    });
    const beforeCounts = await readMutationGuardCounts(fx);
    let providerCalls = 0;
    const provider = {
      id: "test-provider",
      name: "Test provider",
      async generate() {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          body: "Hi Alpha,\n\nThanks. I will send next steps after review.",
          subjectSuggestion: "Re: Concurrent reply"
        };
      }
    };

    const [first, second] = await Promise.all([
      crm.generateEmailReplyDraft(fx.actorA, { emailLogId: emailLog.id, tone: "warm" }, { provider }),
      crm.generateEmailReplyDraft(fx.actorA, { emailLogId: emailLog.id, tone: "warm" }, { provider })
    ]);

    expect(providerCalls).toBe(1);
    expect(first).toEqual(second);
    await expect(readMutationGuardCounts(fx)).resolves.toEqual(beforeCounts);
  });

  it("keeps concurrent reply dedupe isolated by workspace and user", async () => {
    const fx = currentFixture();
    const [emailLogA, emailLogB] = await Promise.all([
      crm.createEmailLog(fx.actorA, {
        body: "Can you send Alpha next steps?",
        direction: "INBOUND",
        fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
        occurredAt: "2030-01-03T12:00:00.000Z",
        personId: fx.recordsA.person.id,
        subject: "Shared-looking reply",
        toText: "sales@example.test"
      }),
      crm.createEmailLog(fx.actorB, {
        body: "Can you send Beta next steps?",
        direction: "INBOUND",
        fromText: `${fx.recordsB.person.firstName} <${fx.recordsB.person.email}>`,
        occurredAt: "2030-01-03T12:00:00.000Z",
        personId: fx.recordsB.person.id,
        subject: "Shared-looking reply",
        toText: "sales@example.test"
      })
    ]);
    let providerCalls = 0;
    const provider = {
      id: "test-provider",
      name: "Test provider",
      async generate(input: EmailReplyProviderInput) {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          body: `Hi,\n\nReplying to ${input.context.email.body}`,
          subjectSuggestion: "Re: Shared-looking reply"
        };
      }
    };

    const [draftA, draftB] = await Promise.all([
      crm.generateEmailReplyDraft(fx.actorA, { emailLogId: emailLogA.id, tone: "warm" }, { provider }),
      crm.generateEmailReplyDraft(fx.actorB, { emailLogId: emailLogB.id, tone: "warm" }, { provider })
    ]);

    expect(providerCalls).toBe(2);
    expect(draftA.body).toContain("Alpha");
    expect(draftB.body).toContain("Beta");
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}

async function readMutationGuardCounts(fx: Fixture) {
  const where = { workspaceId: fx.workspaceA.id };
  const [emailLogs, activities, notes, people, organizations, leads, deals] = await Promise.all([
    fx.prisma.emailLog.count({ where }),
    fx.prisma.activity.count({ where }),
    fx.prisma.note.count({ where }),
    fx.prisma.person.count({ where }),
    fx.prisma.organization.count({ where }),
    fx.prisma.lead.count({ where }),
    fx.prisma.deal.count({ where })
  ]);

  return { activities, deals, emailLogs, leads, notes, organizations, people };
}
