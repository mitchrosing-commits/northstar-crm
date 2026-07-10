import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type CrmServices = typeof import("@/lib/services/crm");
type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;
type TodayCommandCenter = Awaited<ReturnType<CrmServices["buildAssistantTodayCommandCenter"]>>;
type TodayCommandCenterItem = TodayCommandCenter["items"][number];

let crm: CrmServices;
let fixture: Fixture | undefined;
const secretOrRawProviderTerms = /\b(OAuth|refresh token|access token|auth header|raw provider|raw Gmail|provider payload|provider error|gmail\.metadata|secret|providerMessageId|providerThreadId)\b/i;

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
  it("builds a deterministic Today Command Center with workspace-scoped links and no view-time mutations", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-02T12:00:00.000Z");
    await fx.prisma.activity.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: fx.recordsA.deal.id,
          type: "TASK",
          title: "Center overdue renewal task",
          dueAt: new Date("2030-01-01T15:00:00.000Z")
        },
        {
          workspaceId: fx.workspaceB.id,
          ownerId: fx.userB.id,
          dealId: fx.recordsB.deal.id,
          type: "TASK",
          title: "Center hidden workspace task",
          dueAt: new Date("2030-01-01T15:00:00.000Z")
        }
      ]
    });
    const closeDateDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        organizationId: fx.recordsA.organization.id,
        title: "Center close-date deal",
        expectedCloseAt: new Date("2030-01-05T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z"),
        valueCents: 250000
      }
    });
    const noActivityDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        title: "Center no-activity deal",
        expectedCloseAt: new Date("2030-02-15T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z")
      }
    });
    const staleDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        title: "Center stale deal",
        expectedCloseAt: new Date("2030-03-01T00:00:00.000Z"),
        updatedAt: new Date("2029-12-01T00:00:00.000Z")
      }
    });
    const quoteDeal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageTwo.id,
        ownerId: fx.userA.id,
        organizationId: fx.recordsA.organization.id,
        title: "Center quoted deal",
        expectedCloseAt: new Date("2030-03-15T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z")
      }
    });
    const quote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: quoteDeal.id,
        number: `CMD-${Date.now()}`,
        status: "SENT",
        subtotalCents: 50000,
        totalCents: 50000,
        updatedAt: new Date("2029-12-26T00:00:00.000Z")
      }
    });
    await fx.prisma.activity.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: closeDateDeal.id,
          type: "TASK",
          title: "Center close-date next step",
          dueAt: new Date("2030-01-03T15:00:00.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: staleDeal.id,
          type: "TASK",
          title: "Center stale deal scheduled step",
          dueAt: new Date("2030-03-10T15:00:00.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: quoteDeal.id,
          type: "TASK",
          title: "Center quote scheduled step",
          dueAt: new Date("2030-03-11T15:00:00.000Z")
        }
      ]
    });
    await fx.prisma.lead.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        title: "Center web lead",
        source: "Web",
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        updatedAt: new Date("2030-01-01T00:00:00.000Z")
      }
    });
    const draftAnswer = await crm.answerAssistantCommand(
      fx.actorA,
      `Remind me to follow up with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} tomorrow.`,
      { now }
    );
    const draft = draftAnswer.draftActions?.[0];
    if (!draft) throw new Error("Expected a draft action.");
    await crm.createAssistantActionRequest(fx.actorA, { draftAction: draft, sourceCommand: draftAnswer.query });
    const before = await readOnlyCounts(fx);

    const commandCenter = await crm.buildAssistantTodayCommandCenter(fx.actorA, now);
    const serialized = JSON.stringify(commandCenter);

    expect(commandCenter.reviewFirstNotice).toContain("Review-first suggestions only");
    expect(commandCenter.items.map((item) => item.priority)).toEqual(
      [...commandCenter.items.map((item) => item.priority)].sort((a, b) => a - b)
    );
    expect(serialized).toContain("Center overdue renewal task");
    expect(serialized).toContain("Center close-date deal");
    expect(serialized).toContain("Center no-activity deal");
    expect(serialized).toContain("Center stale deal");
    expect(serialized).toContain("Quote");
    expect(serialized).toContain("Center web lead");
    expect(serialized).toContain("Pending Assistant request");
    expect(serialized).not.toContain("Center hidden workspace task");
    const overdueItem = itemForLabel(commandCenter, "Center overdue renewal task");
    const closeDateItem = itemForLabel(commandCenter, "Center close-date deal");
    const noActivityItem = itemForLabel(commandCenter, "Center no-activity deal");
    const staleItem = itemForLabel(commandCenter, "Center stale deal");
    const quoteItem = itemForLabel(commandCenter, `Quote ${quote.number}`);
    const leadItem = itemForLabel(commandCenter, "Center web lead");
    const pendingItem = commandCenter.items.find((item) => item.recordType === "Assistant request");
    if (!pendingItem) throw new Error("Expected pending Assistant request item.");

    expect(closeDateItem).toMatchObject({
      draftHref: expect.stringContaining("/assistant?command="),
      href: `/deals/${closeDateDeal.id}`,
      kind: "deal_close_date",
      recordType: "Deal"
    });
    expect(noActivityItem).toMatchObject({
      href: `/deals/${noActivityDeal.id}`,
      kind: "deal_no_activity"
    });
    expect(staleItem).toMatchObject({
      href: `/deals/${staleDeal.id}`,
      kind: "deal_stale"
    });
    expect(quoteItem).toMatchObject({
      href: `/deals/${quoteDeal.id}/quotes/${quote.id}`,
      kind: "quote_follow_up"
    });
    expect(pendingItem).toMatchObject({
      href: "/assistant?queue=pending#assistant-review-queue",
      safeNextAction: expect.stringContaining("explicitly apply eligible activity or note drafts")
    });
    expect(overdueItem.explanation).toMatchObject({
      rule: "Incomplete activity due before the current UTC day.",
      threshold: expect.stringContaining("Due before Jan 3, 2030 UTC"),
      calculation: expect.stringContaining("1 day overdue"),
      result: "Shown as an overdue activity."
    });
    expect(explanationValue(overdueItem, "Due date/time")).toContain("Jan 1, 2030");
    expect(explanationValue(overdueItem, "Related record")).toBe(fx.recordsA.deal.title);
    expect(closeDateItem.explanation).toMatchObject({
      rule: expect.stringContaining("seven-day UTC lookahead"),
      threshold: expect.stringContaining("7-day window"),
      calculation: expect.stringContaining("3 days from Jan 2, 2030"),
      result: "Shown as a deal approaching expected close."
    });
    expect(explanationValue(closeDateItem, "Expected close")).toBe("Jan 5, 2030");
    expect(noActivityItem.explanation).toMatchObject({
      rule: "Open deal has no upcoming open activity.",
      calculation: expect.stringContaining("no open activity with a due date today or later"),
      result: "Shown because the deal has no qualifying upcoming activity."
    });
    expect(explanationValue(noActivityItem, "Nearest open activity")).toBe("No open activity found");
    expect(staleItem.explanation).toMatchObject({
      rule: expect.stringContaining("at least 14 UTC days"),
      threshold: "14 days without a visible deal update.",
      calculation: expect.stringContaining("32 days before Jan 2, 2030"),
      result: "Shown as a stale open deal."
    });
    expect(explanationValue(staleItem, "Deal last updated")).toContain("Dec 1, 2029");
    expect(quoteItem.explanation).toMatchObject({
      rule: expect.stringContaining("Sent quote"),
      threshold: "3 days since the sent quote follow-up date basis.",
      calculation: expect.stringContaining("7 days before Jan 2, 2030"),
      result: "Shown as a sent quote awaiting follow-up."
    });
    expect(explanationValue(quoteItem, "Quote status")).toBe("SENT");
    expect(explanationValue(quoteItem, "Follow-up date basis")).toContain("Dec 26, 2029");
    expect(leadItem.explanation).toMatchObject({
      rule: "New lead was created inside the seven-day review window.",
      threshold: "Created within the last 7 UTC days.",
      result: "Shown as a recently created lead needing review."
    });
    expect(explanationValue(leadItem, "Source")).toBe("Web");
    expect(pendingItem.explanation).toMatchObject({
      rule: "Assistant action request created by you is still pending.",
      threshold: "Pending requests remain visible until applied or rejected.",
      calculation: expect.stringContaining("PENDING"),
      result: "Shown as a pending Assistant review item."
    });
    expect(explanationValue(pendingItem, "Status")).toBe("PENDING");
    expect(commandCenter.items.every((item) => item.explanation.sourceRecord.href === item.href)).toBe(true);
    expect(commandCenter.items.every((item) => !item.href.startsWith("/api/") && !item.draftHref?.startsWith("/api/"))).toBe(true);
    expect(commandCenter.items.every((item) => item.reason.length > 0 && item.safeNextAction.length > 0)).toBe(true);
    expect(serialized).not.toMatch(secretOrRawProviderTerms);
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
  });

  it("returns a helpful empty Today Command Center state without creating records", async () => {
    const fx = currentFixture();
    await clearCommandCenterRecords(fx);
    const before = await readOnlyCounts(fx);

    const commandCenter = await crm.buildAssistantTodayCommandCenter(fx.actorA, new Date("2030-01-02T12:00:00.000Z"));

    expect(commandCenter.items).toEqual([]);
    expect(commandCenter.emptyState.title).toBe("No Command Center items for today");
    expect(commandCenter.emptyState.description).toContain("Overdue or due-today activities");
    expect(commandCenter.emptyState.description).toContain("pending Assistant action requests");
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
  });

  it("uses deterministic UTC thresholds for Today Command Center date boundaries", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-15T12:00:00.000Z");
    await clearCommandCenterRecords(fx);
    await fx.prisma.activity.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          type: "TASK",
          title: "Boundary overdue activity",
          dueAt: new Date("2030-01-14T23:59:59.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          type: "TASK",
          title: "Boundary due today early",
          dueAt: new Date("2030-01-15T00:00:00.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          type: "TASK",
          title: "Boundary due today late",
          dueAt: new Date("2030-01-15T23:59:59.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          type: "TASK",
          title: "Boundary future activity excluded",
          dueAt: new Date("2030-01-16T00:00:00.000Z")
        }
      ]
    });
    const pastCloseDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-01-14T23:59:59.000Z"),
      title: "Boundary past close deal"
    });
    const exactCloseDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-01-22T23:59:59.000Z"),
      title: "Boundary exact seven-day close deal"
    });
    const outsideCloseDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-01-23T00:00:00.000Z"),
      title: "Boundary eight-day close excluded"
    });
    const noActivityDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-03-01T00:00:00.000Z"),
      title: "Boundary no activity deal"
    });
    const staleDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-03-02T00:00:00.000Z"),
      title: "Boundary stale exact deal",
      updatedAt: new Date("2030-01-01T00:00:00.000Z")
    });
    const quoteDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-03-03T00:00:00.000Z"),
      title: "Boundary quoted deal"
    });
    await fx.prisma.activity.createMany({
      data: [
        futureDealActivity(fx, pastCloseDeal.id, "Boundary past close future step"),
        futureDealActivity(fx, exactCloseDeal.id, "Boundary exact close future step"),
        futureDealActivity(fx, outsideCloseDeal.id, "Boundary outside close future step"),
        futureDealActivity(fx, staleDeal.id, "Boundary stale future step"),
        futureDealActivity(fx, quoteDeal.id, "Boundary quote future step")
      ]
    });
    const quote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: quoteDeal.id,
        number: `UTC-${Date.now()}`,
        status: "SENT",
        subtotalCents: 10000,
        totalCents: 10000,
        updatedAt: new Date("2030-01-12T00:00:00.000Z")
      }
    });
    const youngQuoteDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-03-04T00:00:00.000Z"),
      title: "Boundary young quote deal"
    });
    await fx.prisma.activity.create({ data: futureDealActivity(fx, youngQuoteDeal.id, "Boundary young quote future step") });
    await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: youngQuoteDeal.id,
        number: `YOUNG-${Date.now()}`,
        status: "SENT",
        subtotalCents: 10000,
        totalCents: 10000,
        updatedAt: new Date("2030-01-13T00:00:00.000Z")
      }
    });
    await fx.prisma.lead.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          title: "Boundary recent lead",
          createdAt: new Date("2030-01-08T00:00:00.000Z"),
          updatedAt: new Date("2030-01-08T00:00:00.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          title: "Boundary old lead excluded",
          createdAt: new Date("2030-01-07T23:59:59.000Z"),
          updatedAt: new Date("2030-01-07T23:59:59.000Z")
        }
      ]
    });
    await fx.prisma.assistantActionRequest.create({
      data: {
        workspaceId: fx.workspaceA.id,
        createdById: fx.userA.id,
        actionType: "activity",
        confidence: "high",
        objectType: "Person",
        proposedPayload: { fields: [], targetHref: `/contacts/${fx.recordsA.person.id}` },
        riskLevel: "low",
        status: "PENDING",
        targetHref: `/contacts/${fx.recordsA.person.id}`,
        targetLabel: "Boundary contact",
        title: "Boundary pending request"
      }
    });
    const before = await readOnlyCounts(fx);

    const commandCenter = await crm.buildAssistantTodayCommandCenter(fx.actorA, now);
    const byLabel = new Map(commandCenter.items.map((item) => [item.recordLabel, item]));
    const serialized = JSON.stringify(commandCenter);

    expect(commandCenter.items).toHaveLength(10);
    expect(byLabel.get("Boundary overdue activity")).toMatchObject({ priority: 10, reason: expect.stringContaining("Overdue since Jan 14, 2030") });
    expect(byLabel.get("Boundary due today early")).toMatchObject({ priority: 20, reason: expect.stringContaining("Due today (Jan 15, 2030)") });
    expect(byLabel.get("Boundary due today late")).toMatchObject({ priority: 20, reason: expect.stringContaining("Due today (Jan 15, 2030)") });
    expect(byLabel.get("Boundary pending request")).toMatchObject({ priority: 30, recordType: "Assistant request" });
    expect(commandCenter.items.find((item) => item.recordLabel.includes("Boundary past close deal"))).toMatchObject({ priority: 40 });
    expect(commandCenter.items.find((item) => item.recordLabel.includes("Boundary exact seven-day close deal"))).toMatchObject({
      priority: 45,
      reason: expect.stringContaining("Expected close is in 7 days")
    });
    expect(commandCenter.items.find((item) => item.recordLabel.includes("Boundary no activity deal"))).toMatchObject({
      href: `/deals/${noActivityDeal.id}`,
      priority: 50
    });
    expect(commandCenter.items.find((item) => item.recordLabel.includes("Boundary stale exact deal"))).toMatchObject({
      priority: 60,
      reason: expect.stringContaining("14 days")
    });
    expect(byLabel.get(`Quote ${quote.number}`)).toMatchObject({
      priority: 70,
      reason: expect.stringContaining("3 days")
    });
    expect(byLabel.get("Boundary recent lead")).toMatchObject({
      priority: 80,
      reason: expect.stringContaining("Jan 8, 2030")
    });
    expect(byLabel.get("Boundary overdue activity")?.explanation.calculation).toContain("1 day overdue");
    expect(byLabel.get("Boundary due today early")?.explanation.calculation).toContain("on or after Jan 15, 2030");
    expect(byLabel.get("Boundary due today late")?.explanation.calculation).toContain("before Jan 16, 2030");
    expect(explanationValue(requiredItem(byLabel.get("Boundary due today early")), "Related record")).toBe("No linked record");
    expect(commandCenter.items.find((item) => item.recordLabel.includes("Boundary exact seven-day close deal"))?.explanation.calculation).toContain(
      "7 days from Jan 15, 2030"
    );
    expect(commandCenter.items.find((item) => item.recordLabel.includes("Boundary stale exact deal"))?.explanation.calculation).toContain(
      "14 days before Jan 15, 2030"
    );
    expect(byLabel.get(`Quote ${quote.number}`)?.explanation.calculation).toContain("3 days before Jan 15, 2030");
    expect(serialized).not.toContain("Boundary future activity excluded");
    expect(serialized).not.toContain("Boundary eight-day close excluded");
    expect(serialized).not.toContain("YOUNG-");
    expect(serialized).not.toContain("Boundary old lead excluded");
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
  });

  it("caps Today Command Center items at 10 and sorts ties by record type then label", async () => {
    const fx = currentFixture();
    await clearCommandCenterRecords(fx);
    await fx.prisma.activity.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        type: "TASK" as const,
        title: `Sort ${String(12 - index).padStart(2, "0")} activity`,
        dueAt: new Date("2030-01-15T12:00:00.000Z")
      }))
    });

    const commandCenter = await crm.buildAssistantTodayCommandCenter(fx.actorA, new Date("2030-01-15T12:00:00.000Z"));

    expect(commandCenter.items).toHaveLength(10);
    expect(commandCenter.items.map((item) => item.recordLabel)).toEqual([
      "Sort 01 activity",
      "Sort 02 activity",
      "Sort 03 activity",
      "Sort 04 activity",
      "Sort 05 activity",
      "Sort 06 activity",
      "Sort 07 activity",
      "Sort 08 activity",
      "Sort 09 activity",
      "Sort 10 activity"
    ]);
  });

  it("hides visible Today Command Center items for one user and reveals them without CRM mutation", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-15T12:00:00.000Z");
    await clearCommandCenterRecords(fx);
    await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        type: "TASK",
        title: "Hideable overdue activity",
        dueAt: new Date("2030-01-14T12:00:00.000Z")
      }
    });
    const draftAnswer = await crm.answerAssistantCommand(
      fx.actorA,
      `Remind me to follow up with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} tomorrow.`,
      { now }
    );
    const draft = draftAnswer.draftActions?.[0];
    if (!draft) throw new Error("Expected a draft action.");
    const request = await crm.createAssistantActionRequest(fx.actorA, { draftAction: draft, sourceCommand: draftAnswer.query });
    const beforeCrm = await readOnlyCounts(fx);
    const beforeReviewQueue = await crm.listAssistantActionRequests(fx.actorA);
    const initial = await crm.buildAssistantTodayCommandCenter(fx.actorA, now, { timeZone: "America/New_York" });
    const target = initial.items.find((item) => item.recordLabel === "Hideable overdue activity");
    if (!target) throw new Error("Expected hideable item.");

    const hidden = await crm.hideAssistantTodayCommandCenterItem(fx.actorA, { itemKey: target.itemKey }, now, { timeZone: "America/New_York" });
    const afterHide = await crm.buildAssistantTodayCommandCenter(fx.actorA, now, { timeZone: "America/New_York" });
    const revealed = await crm.buildAssistantTodayCommandCenter(fx.actorA, now, { showHidden: true, timeZone: "America/New_York" });

    expect(hidden).toMatchObject({ hiddenItem: { itemKey: target.itemKey }, localDateKey: "2030-01-15" });
    expect(afterHide.items.map((item) => item.itemKey)).not.toContain(target.itemKey);
    expect(afterHide.hiddenCount).toBe(1);
    expect(revealed.hiddenItems).toHaveLength(1);
    expect(revealed.hiddenItems[0]).toMatchObject({
      hiddenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      itemKey: target.itemKey,
      priority: target.priority,
      recordLabel: target.recordLabel,
      explanation: target.explanation
    });
    await expect(fx.prisma.assistantTodayItemHide.count({ where: { workspaceId: fx.workspaceA.id, userId: fx.userA.id } })).resolves.toBe(1);
    await expect(readOnlyCounts(fx)).resolves.toEqual(beforeCrm);
    await expect(crm.listAssistantActionRequests(fx.actorA)).resolves.toEqual(beforeReviewQueue);
    await expect(fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: request.id } })).resolves.toMatchObject({ status: "PENDING" });
  });

  it("isolates hidden Today Command Center state by user, workspace, and condition key", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-15T12:00:00.000Z");
    await clearCommandCenterRecords(fx);
    await fx.prisma.workspaceMembership.create({
      data: {
        role: "MEMBER",
        userId: fx.userB.id,
        workspaceId: fx.workspaceA.id
      }
    });
    const actorA2 = { actorUserId: fx.userB.id, workspaceId: fx.workspaceA.id };
    const staleDeal = await createCommandCenterDeal(fx, {
      expectedCloseAt: new Date("2030-03-01T00:00:00.000Z"),
      title: "Independent stale no-activity deal",
      updatedAt: new Date("2030-01-01T00:00:00.000Z")
    });
    await fx.prisma.assistantTodayItemHide.create({
      data: {
        itemKey: `deal-no-activity-${staleDeal.id}`,
        localDateKey: "2030-01-15",
        userId: fx.userB.id,
        workspaceId: fx.workspaceB.id
      }
    });
    const initial = await crm.buildAssistantTodayCommandCenter(fx.actorA, now, { timeZone: "America/New_York" });
    const noActivity = initial.items.find((item) => item.itemKey === `deal-no-activity-${staleDeal.id}`);
    const stale = initial.items.find((item) => item.itemKey === `deal-stale-${staleDeal.id}`);
    if (!noActivity || !stale) throw new Error("Expected same deal to surface as two independent conditions.");

    await crm.hideAssistantTodayCommandCenterItem(fx.actorA, { itemKey: noActivity.itemKey }, now, { timeZone: "America/New_York" });
    const hiddenForA = await crm.buildAssistantTodayCommandCenter(fx.actorA, now, { showHidden: true, timeZone: "America/New_York" });
    const visibleForA2 = await crm.buildAssistantTodayCommandCenter(actorA2, now, { timeZone: "America/New_York" });
    const visibleForWorkspaceB = await crm.buildAssistantTodayCommandCenter(fx.actorB, now, { timeZone: "America/New_York" });

    expect(hiddenForA.items.map((item) => item.itemKey)).not.toContain(noActivity.itemKey);
    expect(hiddenForA.items.map((item) => item.itemKey)).toContain(stale.itemKey);
    expect(hiddenForA.hiddenItems.map((item) => item.itemKey)).toContain(noActivity.itemKey);
    expect(visibleForA2.items.map((item) => item.itemKey)).toContain(noActivity.itemKey);
    expect(JSON.stringify(visibleForWorkspaceB)).not.toContain("Independent stale no-activity deal");
  });

  it("returns hidden Today Command Center items on the next local day and ignores stale or malformed rows", async () => {
    const fx = currentFixture();
    const hideNow = new Date("2030-01-16T04:30:00.000Z");
    const nextLocalDay = new Date("2030-01-16T05:30:00.000Z");
    await clearCommandCenterRecords(fx);
    await fx.prisma.activity.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          type: "TASK",
          title: "Local day rollover activity",
          dueAt: new Date("2030-01-15T12:00:00.000Z")
        },
        {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          type: "TASK",
          title: "Malformed hide should not apply",
          dueAt: new Date("2030-01-15T12:00:00.000Z")
        }
      ]
    });
    const initial = await crm.buildAssistantTodayCommandCenter(fx.actorA, hideNow, { timeZone: "America/New_York" });
    const rollover = initial.items.find((item) => item.recordLabel === "Local day rollover activity");
    if (!rollover) throw new Error("Expected rollover item.");

    await fx.prisma.assistantTodayItemHide.createMany({
      data: [
        {
          itemKey: rollover.itemKey,
          localDateKey: "2030-01-14",
          userId: fx.userA.id,
          workspaceId: fx.workspaceA.id
        },
        {
          itemKey: "bad key with spaces",
          localDateKey: "2030-01-15",
          userId: fx.userA.id,
          workspaceId: fx.workspaceA.id
        }
      ]
    });
    const staleAndMalformedIgnored = await crm.buildAssistantTodayCommandCenter(fx.actorA, hideNow, { timeZone: "America/New_York" });
    await crm.hideAssistantTodayCommandCenterItem(fx.actorA, { itemKey: rollover.itemKey }, hideNow, { timeZone: "America/New_York" });
    const hiddenToday = await crm.buildAssistantTodayCommandCenter(fx.actorA, hideNow, { timeZone: "America/New_York" });
    const returnedTomorrow = await crm.buildAssistantTodayCommandCenter(fx.actorA, nextLocalDay, { timeZone: "America/New_York" });

    expect(crm.assistantTodayLocalDateKey(hideNow, "America/New_York")).toBe("2030-01-15");
    expect(crm.assistantTodayLocalDateKey(nextLocalDay, "America/New_York")).toBe("2030-01-16");
    expect(staleAndMalformedIgnored.items.map((item) => item.itemKey)).toContain(rollover.itemKey);
    expect(staleAndMalformedIgnored.items.map((item) => item.recordLabel)).toContain("Malformed hide should not apply");
    expect(hiddenToday.items.map((item) => item.itemKey)).not.toContain(rollover.itemKey);
    expect(returnedTomorrow.items.map((item) => item.itemKey)).toContain(rollover.itemKey);
  });

  it("applies the visible Today Command Center cap after hidden exclusions", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-15T12:00:00.000Z");
    await clearCommandCenterRecords(fx);
    await fx.prisma.activity.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        type: "TASK" as const,
        title: `Hide cap ${String(index + 1).padStart(2, "0")} activity`,
        dueAt: new Date("2030-01-15T12:00:00.000Z")
      }))
    });
    const initial = await crm.buildAssistantTodayCommandCenter(fx.actorA, now, { timeZone: "America/New_York" });
    await crm.hideAssistantTodayCommandCenterItem(fx.actorA, { itemKey: initial.items[0].itemKey }, now, { timeZone: "America/New_York" });
    await crm.hideAssistantTodayCommandCenterItem(fx.actorA, { itemKey: initial.items[1].itemKey }, now, { timeZone: "America/New_York" });

    const afterHide = await crm.buildAssistantTodayCommandCenter(fx.actorA, now, { timeZone: "America/New_York" });

    expect(afterHide.items).toHaveLength(10);
    expect(afterHide.items.map((item) => item.recordLabel)).toEqual([
      "Hide cap 03 activity",
      "Hide cap 04 activity",
      "Hide cap 05 activity",
      "Hide cap 06 activity",
      "Hide cap 07 activity",
      "Hide cap 08 activity",
      "Hide cap 09 activity",
      "Hide cap 10 activity",
      "Hide cap 11 activity",
      "Hide cap 12 activity"
    ]);
    expect(afterHide.hiddenCount).toBe(2);
  });

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

  it("drafts an activity from a command without creating activities or crossing workspaces", async () => {
    const fx = currentFixture();
    const now = new Date("2030-01-02T12:00:00.000Z");
    await fx.prisma.person.create({
      data: {
        email: "assistant.hidden@example.test",
        firstName: fx.recordsA.person.firstName,
        lastName: fx.recordsA.person.lastName,
        workspaceId: fx.workspaceB.id
      }
    });
    const before = await readOnlyCounts(fx);
    const contactName = [fx.recordsA.person.firstName, fx.recordsA.person.lastName].filter(Boolean).join(" ");

    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      `Remind me to follow up with ${contactName} next Tuesday.`,
      { now }
    );
    const serialized = JSON.stringify(answer);

    expect(answer.command).toBe("draft_activity");
    expect(answer.draftActions?.[0]).toMatchObject({
      applyState: "disabled",
      reviewLabel: "Draft only",
      targetLabel: contactName
    });
    expect(serialized).toContain("Jan 8, 2030");
    expect(serialized).not.toContain("assistant.hidden@example.test");
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
  });

  it("drafts a summarized contact relationship update without saving profile fields", async () => {
    const fx = currentFixture();
    const before = await readOnlyCounts(fx);
    const contactName = [fx.recordsA.person.firstName, fx.recordsA.person.lastName].filter(Boolean).join(" ");

    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      `Update ${contactName}'s profile to include that she is going on vacation to France in 3 weeks with her family.`
    );
    const serialized = JSON.stringify(answer);

    expect(answer.command).toBe("draft_contact_relationship");
    expect(serialized).toContain("will be traveling to France with family in about three weeks");
    expect(serialized).toContain("Relationship Memory field");
    expect(serialized).toContain("Review for sensitivity before saving");
    expect(serialized).not.toContain("raw provider");
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
    await expect(fx.prisma.person.findUnique({
      select: { relationshipPersonalContext: true },
      where: { id: fx.recordsA.person.id }
    })).resolves.toMatchObject({ relationshipPersonalContext: null });
  });

  it("drafts organization/contact creation and AI preference changes without writes", async () => {
    const fx = currentFixture();
    const beforeCreation = await readOnlyCounts(fx);

    const creation = await crm.answerAssistantCommand(
      fx.actorA,
      "Create an organization for Acme Draft Co and add Mike Fox as CFO from this note: Mike said Acme Draft Co is evaluating Q3 pricing."
    );
    const creationJson = JSON.stringify(creation);

    expect(creation.command).toBe("draft_record_creation");
    expect(creationJson).toContain("Acme Draft Co");
    expect(creationJson).toContain("Mike Fox");
    expect(creationJson).toContain("CFO");
    expect(creationJson).toContain("No records will be created");
    await expect(readOnlyCounts(fx)).resolves.toEqual(beforeCreation);

    const beforePreferences = await readOnlyCounts(fx);
    const preferences = await crm.answerAssistantCommand(fx.actorA, "Make email replies more casual and concise.");
    const preferencesJson = JSON.stringify(preferences);

    expect(preferences.command).toBe("draft_ai_preferences");
    expect(preferencesJson).toContain("Reply Tone");
    expect(preferencesJson).toContain("concise");
    expect(preferencesJson).toContain("Email replies should be casual and concise");
    await expect(readOnlyCounts(fx)).resolves.toEqual(beforePreferences);
  });

  it("returns candidates and requires review when draft record matches are ambiguous", async () => {
    const fx = currentFixture();
    await fx.prisma.person.createMany({
      data: [
        {
          email: "jane.one@example.test",
          firstName: "Jane",
          lastName: "Doe",
          workspaceId: fx.workspaceA.id
        },
        {
          email: "jane.two@example.test",
          firstName: "Jane",
          lastName: "Doe",
          workspaceId: fx.workspaceA.id
        }
      ]
    });
    const before = await readOnlyCounts(fx);

    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      "Remind me to follow up with Jane Doe tomorrow."
    );

    expect(answer.command).toBe("draft_activity");
    expect(answer.draftActions?.[0]?.confidence).toBe("needs_clarification");
    expect(answer.draftActions?.[0]?.candidates.map((candidate) => candidate.label)).toEqual(["Jane Doe", "Jane Doe"]);
    expect(answer.summary).toContain("needs clarification");
    await expect(readOnlyCounts(fx)).resolves.toEqual(before);
  });

  it("saves draft actions as user-scoped pending requests without touching CRM records", async () => {
    const fx = currentFixture();
    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      `Remind me to follow up with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} tomorrow.`
    );
    const draft = answer.draftActions?.[0];
    if (!draft) throw new Error("Expected a draft action.");
    const beforeCrm = await crmRecordCounts(fx);

    const request = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: {
        ...draft,
        evidence: [
          "Authorization: Bearer secret-token",
          "refresh_token=super-secret",
          "Provider payload: should be sanitized"
        ]
      },
      sourceCommand: "Remind me with token=super-secret"
    });
    const pendingForA = await crm.listPendingAssistantActionRequests(fx.actorA);
    const pendingForB = await crm.listPendingAssistantActionRequests(fx.actorB);
    const stored = await fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: request.id } });
    const audit = await fx.prisma.auditLog.findFirstOrThrow({
      where: {
        action: "assistant_action_request.created",
        entityId: request.id,
        workspaceId: fx.workspaceA.id
      }
    });
    const serialized = JSON.stringify({ pendingForA, stored });

    expect(request.status).toBe("PENDING");
    expect(request.actionType).toBe("activity");
    expect(request.riskLevel).toBe("low");
    expect(pendingForA.map((item) => item.id)).toEqual([request.id]);
    expect(pendingForB).toEqual([]);
    expect(stored.workspaceId).toBe(fx.workspaceA.id);
    expect(stored.createdById).toBe(fx.userA.id);
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("Bearer secret");
    expect(audit.metadata).toMatchObject({ actionType: "activity", status: "PENDING" });
    await expect(crmRecordCounts(fx)).resolves.toEqual(beforeCrm);
  });

  it("rejects pending requests through the Assistant queue without touching CRM records or crossing users", async () => {
    const fx = currentFixture();
    const answer = await crm.answerAssistantCommand(fx.actorA, "Make email replies more casual and concise.");
    const draft = answer.draftActions?.[0];
    if (!draft) throw new Error("Expected a draft action.");
    const request = await crm.createAssistantActionRequest(fx.actorA, { draftAction: draft, sourceCommand: answer.query });
    const beforeCrm = await crmRecordCounts(fx);

    await expect(crm.rejectAssistantActionRequest(fx.actorB, request.id)).rejects.toThrow(/not found|no longer pending/i);
    const rejected = await crm.rejectAssistantActionRequest(fx.actorA, request.id);
    const pendingAfterReject = await crm.listPendingAssistantActionRequests(fx.actorA);
    const stored = await fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: request.id } });
    const audit = await fx.prisma.auditLog.findFirstOrThrow({
      where: {
        action: "assistant_action_request.rejected",
        entityId: request.id,
        workspaceId: fx.workspaceA.id
      }
    });

    expect(rejected.status).toBe("REJECTED");
    expect(stored.status).toBe("REJECTED");
    expect(stored.rejectedAt).toBeTruthy();
    expect(stored.appliedAt).toBeNull();
    expect(pendingAfterReject).toEqual([]);
    expect(audit.metadata).toMatchObject({ actionType: "ai_preference_update", status: "REJECTED" });
    await expect(crmRecordCounts(fx)).resolves.toEqual(beforeCrm);
  });

  it("lists pending, applied, and rejected requests for the review queue without exposing cross-user rows", async () => {
    const fx = currentFixture();
    const contactName = `${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}`;
    const activityAnswer = await crm.answerAssistantCommand(fx.actorA, `Remind me to follow up with ${contactName} tomorrow.`);
    const activityDraft = activityAnswer.draftActions?.[0];
    if (!activityDraft) throw new Error("Expected an activity draft.");
    const activityRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: activityDraft,
      sourceCommand: "Authorization: Bearer activity-secret"
    });
    const preferenceAnswer = await crm.answerAssistantCommand(fx.actorA, "Make email replies more casual and concise.");
    const preferenceDraft = preferenceAnswer.draftActions?.[0];
    if (!preferenceDraft) throw new Error("Expected a preference draft.");
    const preferenceRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: preferenceDraft,
      sourceCommand: "refresh_token=preference-secret"
    });
    const noteAnswer = await crm.answerAssistantCommand(fx.actorA, `Add a note for ${contactName}: Prefers concise renewal summaries.`);
    const noteDraft = noteAnswer.draftActions?.[0];
    if (!noteDraft) throw new Error("Expected a note draft.");
    const noteRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: noteDraft,
      sourceCommand: "Provider payload: note-secret"
    });

    await crm.applyAssistantActionRequest(fx.actorA, activityRequest.id);
    await crm.rejectAssistantActionRequest(fx.actorA, preferenceRequest.id);

    const [allForA, pendingForA, allForB] = await Promise.all([
      crm.listAssistantActionRequests(fx.actorA),
      crm.listPendingAssistantActionRequests(fx.actorA),
      crm.listAssistantActionRequests(fx.actorB)
    ]);
    const byId = new Map(allForA.map((request) => [request.id, request]));
    const serialized = JSON.stringify({ allForA, pendingForA });

    expect(allForA).toHaveLength(3);
    expect(allForB).toEqual([]);
    expect(pendingForA.map((request) => request.id)).toEqual([noteRequest.id]);
    expect(byId.get(activityRequest.id)).toMatchObject({
      actionType: "activity",
      canApply: false,
      status: "APPLIED"
    });
    expect(byId.get(preferenceRequest.id)).toMatchObject({
      actionType: "ai_preference_update",
      canApply: false,
      status: "REJECTED"
    });
    expect(byId.get(noteRequest.id)).toMatchObject({
      actionType: "note",
      canApply: true,
      status: "PENDING",
      targetHref: `/contacts/${fx.recordsA.person.id}`,
      targetLabel: contactName
    });
    expect(byId.get(noteRequest.id)?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(serialized).not.toContain("activity-secret");
    expect(serialized).not.toContain("preference-secret");
    expect(serialized).not.toContain("note-secret");
    expect(serialized).not.toMatch(/\b(refresh_token|Authorization: Bearer|Provider payload)\b/i);
  });

  it("applies only clear pending activity requests through the activity service", async () => {
    const fx = currentFixture();
    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      `Remind me to follow up with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} tomorrow.`
    );
    const draft = answer.draftActions?.[0];
    if (!draft) throw new Error("Expected a draft action.");
    const request = await crm.createAssistantActionRequest(fx.actorA, { draftAction: draft, sourceCommand: answer.query });
    const beforeActivityCount = await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } });

    const applied = await crm.applyAssistantActionRequest(fx.actorA, request.id);
    const stored = await fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: request.id } });
    const createdActivities = await fx.prisma.activity.findMany({
      where: {
        personId: fx.recordsA.person.id,
        title: "Follow up with Alpha Contact",
        workspaceId: fx.workspaceA.id
      }
    });
    const pendingAfterApply = await crm.listPendingAssistantActionRequests(fx.actorA);
    const allRequestsAfterApply = await crm.listAssistantActionRequests(fx.actorA);
    const assistantAudit = await fx.prisma.auditLog.findFirstOrThrow({
      where: {
        action: "assistant_action_request.applied",
        entityId: request.id,
        workspaceId: fx.workspaceA.id
      }
    });
    const activityAudit = await fx.prisma.auditLog.findFirstOrThrow({
      where: {
        action: "activity.created",
        entityId: applied.activityId,
        workspaceId: fx.workspaceA.id
      }
    });

    expect(applied.request).toMatchObject({ canApply: false, status: "APPLIED" });
    expect(stored.status).toBe("APPLIED");
    expect(stored.appliedAt).toBeTruthy();
    expect(createdActivities).toHaveLength(1);
    expect(createdActivities[0]).toMatchObject({
      id: applied.activityId,
      personId: fx.recordsA.person.id,
      type: "TASK"
    });
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeActivityCount + 1);
    expect(pendingAfterApply).toEqual([]);
    expect(allRequestsAfterApply.map((item) => item.status)).toEqual(["APPLIED"]);
    expect(assistantAudit.metadata).toMatchObject({ actionType: "activity", activityId: applied.activityId, status: "APPLIED" });
    expect(activityAudit.metadata).toMatchObject({ title: "Follow up with Alpha Contact" });
  });

  it("drafts and applies only clear pending note requests through the note service", async () => {
    const fx = currentFixture();
    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      `Add a note for ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}: Prefers Monday morning check-ins.`
    );
    const draft = answer.draftActions?.[0];
    if (!draft) throw new Error("Expected a note draft.");
    expect(answer.command).toBe("draft_note");
    expect(draft).toMatchObject({
      kind: "note",
      targetHref: `/contacts/${fx.recordsA.person.id}`,
      targetLabel: `${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}`
    });
    const request = await crm.createAssistantActionRequest(fx.actorA, { draftAction: draft, sourceCommand: answer.query });
    const beforeNoteCount = await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } });

    const applied = await crm.applyAssistantActionRequest(fx.actorA, request.id);
    const stored = await fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: request.id } });
    const createdNotes = await fx.prisma.note.findMany({
      where: {
        body: "Prefers Monday morning check-ins",
        personId: fx.recordsA.person.id,
        workspaceId: fx.workspaceA.id
      }
    });
    const assistantAudit = await fx.prisma.auditLog.findFirstOrThrow({
      where: {
        action: "assistant_action_request.applied",
        entityId: request.id,
        workspaceId: fx.workspaceA.id
      }
    });
    const noteAudit = await fx.prisma.auditLog.findFirstOrThrow({
      where: {
        action: "note.created",
        entityId: applied.noteId,
        workspaceId: fx.workspaceA.id
      }
    });

    expect(applied.request).toMatchObject({ canApply: false, status: "APPLIED" });
    expect(stored.status).toBe("APPLIED");
    expect(stored.appliedAt).toBeTruthy();
    expect(createdNotes).toHaveLength(1);
    expect(createdNotes[0]).toMatchObject({
      authorId: fx.userA.id,
      id: applied.noteId,
      personId: fx.recordsA.person.id
    });
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeNoteCount + 1);
    expect(assistantAudit.metadata).toMatchObject({ actionType: "note", noteId: applied.noteId, status: "APPLIED" });
    expect(noteAudit.entityType).toBe("Note");
  });

  it("does not apply an already applied or rejected Assistant request twice", async () => {
    const fx = currentFixture();
    const answer = await crm.answerAssistantCommand(
      fx.actorA,
      `Remind me to follow up with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} tomorrow.`
    );
    const draft = answer.draftActions?.[0];
    if (!draft) throw new Error("Expected a draft action.");
    const appliedRequest = await crm.createAssistantActionRequest(fx.actorA, { draftAction: draft, sourceCommand: answer.query });
    await crm.applyAssistantActionRequest(fx.actorA, appliedRequest.id);
    const afterFirstApply = await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } });

    await expect(crm.applyAssistantActionRequest(fx.actorA, appliedRequest.id)).rejects.toThrow(/not found|no longer pending/i);
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstApply);

    const rejectedRequest = await crm.createAssistantActionRequest(fx.actorA, { draftAction: draft, sourceCommand: answer.query });
    await crm.rejectAssistantActionRequest(fx.actorA, rejectedRequest.id);
    await expect(crm.applyAssistantActionRequest(fx.actorA, rejectedRequest.id)).rejects.toThrow(/not found|no longer pending/i);
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstApply);

    const noteAnswer = await crm.answerAssistantCommand(
      fx.actorA,
      `Add a note for ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}: Likes concise renewal summaries.`
    );
    const noteDraft = noteAnswer.draftActions?.[0];
    if (!noteDraft) throw new Error("Expected a note draft.");
    const appliedNoteRequest = await crm.createAssistantActionRequest(fx.actorA, { draftAction: noteDraft, sourceCommand: noteAnswer.query });
    await crm.applyAssistantActionRequest(fx.actorA, appliedNoteRequest.id);
    const afterFirstNoteApply = await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } });

    await expect(crm.applyAssistantActionRequest(fx.actorA, appliedNoteRequest.id)).rejects.toThrow(/not found|no longer pending/i);
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstNoteApply);

    const rejectedNoteRequest = await crm.createAssistantActionRequest(fx.actorA, { draftAction: noteDraft, sourceCommand: noteAnswer.query });
    await crm.rejectAssistantActionRequest(fx.actorA, rejectedNoteRequest.id);
    await expect(crm.applyAssistantActionRequest(fx.actorA, rejectedNoteRequest.id)).rejects.toThrow(/not found|no longer pending/i);
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstNoteApply);
  });

  it("rejects unsupported, ambiguous, and cross-workspace applies without CRM mutations", async () => {
    const fx = currentFixture();
    const preferences = await crm.answerAssistantCommand(fx.actorA, "Make email replies more casual and concise.");
    const unsupportedDraft = preferences.draftActions?.[0];
    if (!unsupportedDraft) throw new Error("Expected an unsupported apply draft.");
    const unsupportedRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: unsupportedDraft,
      sourceCommand: preferences.query
    });
    const activityAnswer = await crm.answerAssistantCommand(
      fx.actorA,
      `Remind me to follow up with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} tomorrow.`
    );
    const activityDraft = activityAnswer.draftActions?.[0];
    if (!activityDraft) throw new Error("Expected an activity draft.");
    const crossWorkspaceRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: activityDraft,
      sourceCommand: activityAnswer.query
    });
    const noteAnswer = await crm.answerAssistantCommand(
      fx.actorA,
      `Add a note for ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}: Confirmed budget owner.`
    );
    const noteDraft = noteAnswer.draftActions?.[0];
    if (!noteDraft) throw new Error("Expected a note draft.");
    const crossWorkspaceNoteRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: noteDraft,
      sourceCommand: noteAnswer.query
    });
    await fx.prisma.person.createMany({
      data: [
        {
          email: "ambiguous-one@example.test",
          firstName: "Jordan",
          lastName: "River",
          workspaceId: fx.workspaceA.id
        },
        {
          email: "ambiguous-two@example.test",
          firstName: "Jordan",
          lastName: "River",
          workspaceId: fx.workspaceA.id
        }
      ]
    });
    const ambiguousAnswer = await crm.answerAssistantCommand(fx.actorA, "Remind me to follow up with Jordan River tomorrow.");
    const ambiguousDraft = ambiguousAnswer.draftActions?.[0];
    if (!ambiguousDraft) throw new Error("Expected an ambiguous activity draft.");
    const ambiguousRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: ambiguousDraft,
      sourceCommand: ambiguousAnswer.query
    });
    const ambiguousNoteAnswer = await crm.answerAssistantCommand(fx.actorA, "Add a note for Jordan River: Needs procurement follow-up.");
    const ambiguousNoteDraft = ambiguousNoteAnswer.draftActions?.[0];
    if (!ambiguousNoteDraft) throw new Error("Expected an ambiguous note draft.");
    const ambiguousNoteRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: ambiguousNoteDraft,
      sourceCommand: ambiguousNoteAnswer.query
    });
    const missingTargetNoteAnswer = await crm.answerAssistantCommand(fx.actorA, "Add note: Needs review before next call.");
    const missingTargetNoteDraft = missingTargetNoteAnswer.draftActions?.[0];
    if (!missingTargetNoteDraft) throw new Error("Expected a missing-target note draft.");
    const missingTargetNoteRequest = await crm.createAssistantActionRequest(fx.actorA, {
      draftAction: missingTargetNoteDraft,
      sourceCommand: missingTargetNoteAnswer.query
    });
    const beforeCrm = await crmRecordCounts(fx);

    await expect(crm.applyAssistantActionRequest(fx.actorA, unsupportedRequest.id)).rejects.toThrow(/only available/i);
    await expect(crm.applyAssistantActionRequest(fx.actorB, crossWorkspaceRequest.id)).rejects.toThrow(/not found|no longer pending/i);
    await expect(crm.applyAssistantActionRequest(fx.actorB, crossWorkspaceNoteRequest.id)).rejects.toThrow(/not found|no longer pending/i);
    await expect(crm.applyAssistantActionRequest(fx.actorA, ambiguousRequest.id)).rejects.toThrow(/only available/i);
    await expect(crm.applyAssistantActionRequest(fx.actorA, ambiguousNoteRequest.id)).rejects.toThrow(/only available/i);
    await expect(crm.applyAssistantActionRequest(fx.actorA, missingTargetNoteRequest.id)).rejects.toThrow(/only available/i);

    const [unsupportedStored, ambiguousStored, ambiguousNoteStored, missingTargetNoteStored] = await Promise.all([
      fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: unsupportedRequest.id } }),
      fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: ambiguousRequest.id } }),
      fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: ambiguousNoteRequest.id } }),
      fx.prisma.assistantActionRequest.findUniqueOrThrow({ where: { id: missingTargetNoteRequest.id } })
    ]);
    expect(unsupportedStored.status).toBe("PENDING");
    expect(ambiguousStored.status).toBe("PENDING");
    expect(ambiguousStored.appliedAt).toBeNull();
    expect(ambiguousNoteStored.status).toBe("PENDING");
    expect(missingTargetNoteStored.status).toBe("PENDING");
    expect(ambiguousNoteStored.appliedAt).toBeNull();
    expect(missingTargetNoteStored.appliedAt).toBeNull();
    await expect(crmRecordCounts(fx)).resolves.toEqual(beforeCrm);
  });
});

async function readOnlyCounts(fx: Fixture) {
  const where = { workspaceId: { in: [fx.workspaceA.id, fx.workspaceB.id] } };
  const [
    activities,
    auditLogs,
    deals,
    emailLogs,
    organizations,
    jobs,
    notes,
    people,
    aiPreferences,
    assistantActionRequests
  ] = await Promise.all([
    fx.prisma.activity.count({ where }),
    fx.prisma.auditLog.count({ where }),
    fx.prisma.deal.count({ where }),
    fx.prisma.emailLog.count({ where }),
    fx.prisma.organization.count({ where }),
    fx.prisma.job.count({ where }),
    fx.prisma.note.count({ where }),
    fx.prisma.person.count({ where }),
    fx.prisma.aiPreference.count({ where }),
    fx.prisma.assistantActionRequest.count({ where })
  ]);
  return { activities, aiPreferences, assistantActionRequests, auditLogs, deals, emailLogs, jobs, notes, organizations, people };
}

async function crmRecordCounts(fx: Fixture) {
  const counts = await readOnlyCounts(fx);
  return {
    activities: counts.activities,
    aiPreferences: counts.aiPreferences,
    deals: counts.deals,
    emailLogs: counts.emailLogs,
    jobs: counts.jobs,
    notes: counts.notes,
    organizations: counts.organizations,
    people: counts.people
  };
}

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}

async function clearCommandCenterRecords(fx: Fixture) {
  await fx.prisma.$transaction([
    fx.prisma.assistantTodayItemHide.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.assistantActionRequest.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.note.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.activity.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.quoteItem.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.quote.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.dealLineItem.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.deal.deleteMany({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.lead.deleteMany({ where: { workspaceId: fx.workspaceA.id } })
  ]);
}

async function createCommandCenterDeal(
  fx: Fixture,
  input: { expectedCloseAt: Date; title: string; updatedAt?: Date }
) {
  return fx.prisma.deal.create({
    data: {
      workspaceId: fx.workspaceA.id,
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageOne.id,
      ownerId: fx.userA.id,
      organizationId: fx.recordsA.organization.id,
      title: input.title,
      expectedCloseAt: input.expectedCloseAt,
      updatedAt: input.updatedAt ?? new Date("2030-01-15T12:00:00.000Z")
    }
  });
}

function futureDealActivity(fx: Fixture, dealId: string, title: string) {
  return {
    workspaceId: fx.workspaceA.id,
    ownerId: fx.userA.id,
    dealId,
    type: "TASK" as const,
    title,
    dueAt: new Date("2030-02-01T12:00:00.000Z")
  };
}

function itemForLabel(commandCenter: TodayCommandCenter, label: string) {
  const item = commandCenter.items.find((candidate) => candidate.recordLabel.includes(label));
  if (!item) throw new Error(`Expected Command Center item for ${label}.`);
  return item;
}

function requiredItem(item: TodayCommandCenterItem | undefined) {
  if (!item) throw new Error("Expected Command Center item.");
  return item;
}

function explanationValue(item: TodayCommandCenterItem, label: string) {
  const row = item.explanation.storedValues.find((value) => value.label === label);
  if (!row) throw new Error(`Expected explanation value ${label}.`);
  return row.value;
}
