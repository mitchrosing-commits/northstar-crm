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

describe("read-only Assistant command service integration", () => {
  it("answers today and deal-risk commands from current-workspace data without mutations", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-02T12:00:00.000Z");
    await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        type: "EMAIL",
        title: "Assistant due-today follow-up",
        dueAt: new Date("2030-01-02T15:00:00.000Z")
      }
    });
    await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceB.id,
        ownerId: fx.userB.id,
        dealId: fx.recordsB.deal.id,
        type: "EMAIL",
        title: "Assistant cross-workspace hidden follow-up",
        dueAt: new Date("2030-01-02T15:00:00.000Z")
      }
    });
    await fx.prisma.deal.update({
      where: { id: fx.recordsA.deal.id },
      data: {
        expectedCloseAt: new Date("2030-01-03T12:00:00.000Z"),
        valueCents: 275000
      }
    });
    await fx.prisma.deal.update({
      where: { id: fx.recordsB.deal.id },
      data: {
        expectedCloseAt: new Date("2030-01-03T12:00:00.000Z"),
        title: "Assistant hidden workspace deal",
        valueCents: 975000
      }
    });
    const before = await readOnlyCounts(fx);

    const today = await crm.answerAssistantCommand(fx.actorA, "Tell me what I have to do today.", { now });
    const risk = await crm.answerAssistantCommand(fx.actorA, "Show me the highest-risk deals this week.", { now });

    expect(today.command).toBe("today");
    expect(today.summary).toContain("due today");
    expect(JSON.stringify(today)).toContain("Assistant due-today follow-up");
    expect(JSON.stringify(today)).not.toContain("Assistant cross-workspace hidden follow-up");
    expect(risk.command).toBe("deal_risk");
    expect(JSON.stringify(risk)).toContain(fx.recordsA.deal.title);
    expect(JSON.stringify(risk)).not.toContain("Assistant hidden workspace deal");
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
  });

  it("checks stored email replies without syncing, sending, leaking provider ids, or crossing workspaces", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-05T12:00:00.000Z");
    const connection = await fx.prisma.emailConnection.create({
      data: {
        accountEmail: "sales@example.test",
        displayName: "Sales Inbox",
        provider: "GOOGLE_WORKSPACE",
        status: "CONNECTED",
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.emailLog.createMany({
      data: [
        {
          body: "Can you confirm pricing?",
          direction: "OUTBOUND",
          emailConnectionId: connection.id,
          fromText: "sales@example.test",
          occurredAt: new Date("2030-01-03T10:00:00.000Z"),
          personId: fx.recordsA.person.id,
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: "provider-message-secret-out",
          providerThreadId: "provider-thread-secret",
          subject: "Pricing next steps",
          toText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
          workspaceId: fx.workspaceA.id
        },
        {
          body: "Yes, let's proceed.",
          direction: "INBOUND",
          emailConnectionId: connection.id,
          fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
          occurredAt: new Date("2030-01-04T10:00:00.000Z"),
          personId: fx.recordsA.person.id,
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: "provider-message-secret-in",
          providerThreadId: "provider-thread-secret",
          subject: "Re: Pricing next steps",
          toText: "sales@example.test",
          workspaceId: fx.workspaceA.id
        },
        {
          body: "Cross-workspace email must remain hidden.",
          direction: "INBOUND",
          fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
          occurredAt: new Date("2030-01-04T11:00:00.000Z"),
          provider: "GOOGLE_WORKSPACE",
          providerMessageId: "provider-message-secret-cross",
          providerThreadId: "provider-thread-secret-cross",
          subject: "Assistant hidden workspace reply",
          toText: "sales@example.test",
          workspaceId: fx.workspaceB.id
        }
      ]
    });
    const before = await readOnlyCounts(fx);

    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      `Check whether ${fx.recordsA.person.firstName} replied to my recent email.`,
      { now }
    );
    const serialized = JSON.stringify(answer);

    expect(answer.command).toBe("email_reply_check");
    expect(answer.summary).toContain("Likely yes");
    expect(serialized).toContain("Re: Pricing next steps");
    expect(serialized).toContain("Source account Sales Inbox");
    expect(serialized).not.toContain("Assistant hidden workspace reply");
    expect(serialized).not.toContain("provider-message-secret");
    expect(serialized).not.toContain("provider-thread-secret");
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
  });
});

async function readOnlyCounts(fx: Fixture) {
  const where = { workspaceId: { in: [fx.workspaceA.id, fx.workspaceB.id] } };
  const [
    activities,
    auditLogs,
    deals,
    emailLogs,
    jobs,
    notes,
    people
  ] = await Promise.all([
    fx.prisma.activity.count({ where }),
    fx.prisma.auditLog.count({ where }),
    fx.prisma.deal.count({ where }),
    fx.prisma.emailLog.count({ where }),
    fx.prisma.job.count({ where }),
    fx.prisma.note.count({ where }),
    fx.prisma.person.count({ where })
  ]);
  return { activities, auditLogs, deals, emailLogs, jobs, notes, people };
}

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
