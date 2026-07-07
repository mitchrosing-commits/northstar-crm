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

describe("Smart Email Labels service", () => {
  it("classifies a stored email with workspace-scoped CRM context and saves only label metadata", async () => {
    const fx = currentFixture();
    await fx.prisma.note.create({
      data: {
        body: "Alpha buyer is asking for quote timing and contract next steps.",
        dealId: fx.recordsA.deal.id,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.note.create({
      data: {
        body: "Beta cross-workspace risk note must never appear.",
        dealId: fx.recordsB.deal.id,
        workspaceId: fx.workspaceB.id
      }
    });
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "This is urgent. Can you send the quote and confirm contract timing today?",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-05T12:00:00.000Z",
      subject: "Urgent quote and contract timing",
      toText: "sales@example.test"
    });
    const beforeCounts = await mutationCounts(fx);
    let observedContext: Awaited<ReturnType<typeof crm.buildEmailReplyContext>> | undefined;

    const classification = await crm.classifyEmailLog(
      fx.actorA,
      { emailLogId: emailLog.id },
      {
        now: new Date("2030-01-05T12:30:00.000Z"),
        provider: {
          id: "test-provider",
          name: "Test provider",
          async classify(input) {
            observedContext = input.context;
            expect(input.prompt.system).toContain("Do not classify protected traits");
            expect(input.prompt.system).toContain("Do not create, recommend automatic creation");
            return {
              category: "CUSTOMER",
              categoryEvidence: {
                excerpts: ["urgent quote and contract timing"],
                reason: "The email is attached to an active customer deal."
              },
              confidence: 0.93,
              evidence: ["Inbound customer asks for urgent quote and contract timing."],
              signalEvidence: [
                {
                  excerpts: ["This is urgent"],
                  reason: "The email asks for same-day handling.",
                  severity: "high",
                  signal: "URGENT"
                },
                {
                  excerpts: ["Can you send the quote"],
                  reason: "The customer asks for quote information.",
                  signal: "PRICING_QUOTE"
                },
                {
                  excerpts: ["Unsupported evidence must be dropped."],
                  reason: "Unsupported.",
                  signal: "UNSUPPORTED_SIGNAL"
                }
              ],
              signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE", "CONTRACT_LEGAL"],
              summary: "Urgent customer quote and contract email that needs a reply."
            };
          }
        }
      }
    );

    expect(classification).toMatchObject({
      category: "CUSTOMER",
      confidence: 0.93,
      signalEvidence: expect.arrayContaining([
        expect.objectContaining({
          excerpts: ["This is urgent"],
          reason: "The email asks for same-day handling.",
          severity: "high",
          signal: "URGENT"
        }),
        expect.objectContaining({
          excerpts: ["Can you send the quote"],
          reason: "The customer asks for quote information.",
          signal: "PRICING_QUOTE"
        })
      ]),
      providerId: "test-provider",
      providerName: "Test provider",
      signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE", "CONTRACT_LEGAL"],
      summary: "Urgent customer quote and contract email that needs a reply."
    });
    expect(observedContext?.deal).toContain(fx.recordsA.deal.title);
    expect(observedContext?.notes.join("\n")).toContain("Alpha buyer is asking");
    expect(observedContext?.notes.join("\n")).not.toContain("Beta cross-workspace");

    const saved = await fx.prisma.emailLog.findFirstOrThrow({
      where: { id: emailLog.id, workspaceId: fx.workspaceA.id }
    });
    expect(saved.smartLabelProvider).toBe("test-provider");
    expect(saved.smartLabelGeneratedAt?.toISOString()).toBe("2030-01-05T12:30:00.000Z");
    expect(crm.readEmailSmartClassification(saved)).toMatchObject({
      category: "CUSTOMER",
      confidence: 0.93,
      categoryEvidence: expect.objectContaining({
        category: "CUSTOMER",
        excerpts: ["urgent quote and contract timing"],
        reason: "The email is attached to an active customer deal."
      }),
      signalEvidence: expect.arrayContaining([
        expect.objectContaining({ signal: "URGENT" }),
        expect.objectContaining({ signal: "PRICING_QUOTE" })
      ]),
      signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE", "CONTRACT_LEGAL"]
    });
    expect(JSON.stringify(crm.readEmailSmartClassification(saved)?.signalEvidence)).not.toContain("UNSUPPORTED_SIGNAL");
    await expect(mutationCounts(fx)).resolves.toEqual(beforeCounts);
  });

  it("falls back to local labels when no provider is configured and mutates only smart-label metadata", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Can you follow up with pricing for the demo proposal?",
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-05T12:00:00.000Z",
      personId: fx.recordsA.person.id,
      subject: "Follow up on pricing",
      toText: "sales@example.test"
    });
    const beforeCounts = await mutationCounts(fx);

    await expect(
      crm.classifyEmailLog(fx.actorA, { emailLogId: emailLog.id }, { env: { OPENAI_API_KEY: undefined } })
    ).resolves.toMatchObject({
      category: "CUSTOMER",
      providerId: "local_rules",
      signals: expect.arrayContaining(["NEEDS_REPLY", "PRICING_QUOTE", "FOLLOW_UP_NEEDED"]),
      summary: expect.stringContaining("Local rules suggest")
    });

    const saved = await fx.prisma.emailLog.findFirstOrThrow({
      where: { id: emailLog.id, workspaceId: fx.workspaceA.id }
    });
    expect(saved.smartLabelGeneratedAt).toBeTruthy();
    expect(saved.smartLabelProvider).toBe("local_rules");
    expect(crm.readEmailSmartClassification(saved)).toMatchObject({
      providerId: "local_rules",
      providerName: "Local rules",
      signals: expect.arrayContaining(["NEEDS_REPLY", "PRICING_QUOTE", "FOLLOW_UP_NEEDED"])
    });
    await expect(mutationCounts(fx)).resolves.toEqual(beforeCounts);
  });

  it("keeps local labels when the AI provider request fails", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "This is urgent. Can you send contract terms today?",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-05T12:00:00.000Z",
      subject: "Urgent contract terms",
      toText: "sales@example.test"
    });
    const beforeCounts = await mutationCounts(fx);

    const classification = await crm.classifyEmailLog(
      fx.actorA,
      { emailLogId: emailLog.id },
      {
        provider: {
          id: "test-provider",
          name: "Test provider",
          async classify() {
            throw new Error("provider failed with raw-secret-token");
          }
        }
      }
    );

    expect(classification).toMatchObject({
      category: "CUSTOMER",
      providerId: "local_rules",
      signals: expect.arrayContaining(["URGENT", "NEEDS_REPLY", "CONTRACT_LEGAL"])
    });
    expect(JSON.stringify(classification)).not.toContain("raw-secret-token");
    const saved = await fx.prisma.emailLog.findFirstOrThrow({
      where: { id: emailLog.id, workspaceId: fx.workspaceA.id }
    });
    expect(saved.smartLabelProvider).toBe("local_rules");
    expect(JSON.stringify(saved.smartLabelJson)).not.toContain("raw-secret-token");
    await expect(mutationCounts(fx)).resolves.toEqual(beforeCounts);
  });
});

async function mutationCounts(fx: Fixture) {
  const where = { workspaceId: fx.workspaceA.id };
  return {
    activities: await fx.prisma.activity.count({ where }),
    leads: await fx.prisma.lead.count({ where }),
    notes: await fx.prisma.note.count({ where }),
    people: await fx.prisma.person.count({ where })
  };
}

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
