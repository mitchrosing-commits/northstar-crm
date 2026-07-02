import { afterAll, afterEach, describe, expect, it } from "vitest";

import { getNeedsAttentionSummary } from "@/lib/sales-assistant";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("sales assistant workspace boundaries", () => {
  it("omits priority activities whose attached CRM records resolve outside the workspace", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const validActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        type: "TASK",
        title: "Assistant valid workspace activity",
        dueAt: new Date("2030-03-20T08:00:00.000Z")
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
        title: "Assistant cross-workspace activity leak",
        dueAt: new Date("2030-03-20T07:00:00.000Z")
      }
    });

    const summary = await getNeedsAttentionSummary(fx.actorA, new Date("2030-03-20T12:00:00.000Z"));
    const serializedSummary = JSON.stringify(summary);

    expect(summary.map((item) => item.title)).toContain(validActivity.title);
    expect(serializedSummary).not.toContain(mismatchedActivity.id);
    expect(serializedSummary).not.toContain(mismatchedActivity.title);
    expect(serializedSummary).not.toContain(fx.recordsB.deal.id);
    expect(serializedSummary).not.toContain(fx.recordsB.person.id);
    expect(serializedSummary).not.toContain(fx.recordsB.organization.id);
  });
});
