import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type CrmServices = typeof import("@/lib/services/crm");
type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let crm: CrmServices;
let fixture: Fixture | undefined;

beforeAll(async () => {
  crm = await import("@/lib/services/crm");
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("dashboard summary workspace boundaries", () => {
  it("ignores stale cross-workspace activity attachments and suppresses mismatched relation labels", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;
    const now = new Date("2030-03-20T12:00:00.000Z");
    const before = await crm.getDashboardSummary(fx.actorA, now);

    const directRelationDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        title: "Dashboard direct relation safety",
        valueCents: 32000,
        currency: "USD"
      }
    });
    const directRelationQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: directRelationDeal.id,
        number: "Q-DASHBOARD-DIRECT-RELATION",
        status: "SENT",
        currency: "USD",
        subtotalCents: 32000,
        totalCents: 32000
      }
    });
    const closedDirectRelationDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        title: "Dashboard closed relation safety",
        valueCents: 64000,
        currency: "USD",
        status: "WON",
        wonAt: new Date("2030-03-19T12:00:00.000Z")
      }
    });
    const validActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        type: "TASK",
        title: "Dashboard valid priority activity",
        dueAt: new Date("2030-03-20T09:00:00.000Z")
      }
    });
    const mismatchedActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsB.deal.id,
        personId: fx.recordsB.person.id,
        organizationId: fx.recordsB.organization.id,
        type: "TASK",
        title: "Dashboard mismatched priority activity",
        dueAt: new Date("2030-03-20T08:00:00.000Z")
      }
    });
    await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        organizationId: fx.recordsB.organization.id,
        body: "Dashboard mismatched note should not make workspace data look populated."
      }
    });

    const after = await crm.getDashboardSummary(fx.actorA, now);
    const listedDeal = after.recentOpenDeals.find((deal) => deal.id === directRelationDeal.id);
    const listedQuote = after.recentQuotes.find((quote) => quote.id === directRelationQuote.id);
    const listedClosedDeal = after.recentClosedDeals.find((deal) => deal.id === closedDirectRelationDeal.id);
    const serializedPriorityActivities = JSON.stringify(after.priorityActivities);

    expect(after.metrics.dueTodayActivitiesCount).toBe(before.metrics.dueTodayActivitiesCount + 1);
    expect(after.activitySnapshot.dueToday).toBe(before.activitySnapshot.dueToday + 1);
    expect(after.onboarding.counts.activities).toBe(before.onboarding.counts.activities + 1);
    expect(after.onboarding.counts.notes).toBe(before.onboarding.counts.notes);
    expect(after.priorityActivities.map((activity) => activity.id)).toContain(validActivity.id);
    expect(after.priorityActivities.map((activity) => activity.id)).not.toContain(mismatchedActivity.id);
    expect(listedDeal).toMatchObject({ person: null, organization: null });
    expect(listedQuote?.deal).toMatchObject({ person: null, organization: null });
    expect(listedClosedDeal).toMatchObject({ person: null, organization: null });
    expect(serializedPriorityActivities).not.toContain(mismatchedActivity.title);
    expect(serializedPriorityActivities).not.toContain(fx.recordsB.person.id);
    expect(serializedPriorityActivities).not.toContain(fx.recordsB.organization.id);
  });
});
