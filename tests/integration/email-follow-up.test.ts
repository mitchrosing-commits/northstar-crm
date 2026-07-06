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

describe("Relationship Inbox email follow-up workflow", () => {
  it("builds a reviewable draft without mutation, then creates one linked activity through the activity service", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Can you send the quote and confirm next steps today?",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-05T12:00:00.000Z",
      subject: "Quote and next steps",
      toText: "sales@example.test"
    });
    await fx.prisma.emailLog.update({
      where: { id: emailLog.id },
      data: {
        smartLabelGeneratedAt: new Date("2030-01-05T12:10:00.000Z"),
        smartLabelJson: {
          category: "CUSTOMER",
          confidence: 0.93,
          evidence: ["Customer asks for quote and next steps today."],
          signals: ["URGENT", "NEEDS_REPLY", "PRICING_QUOTE"],
          summary: "Urgent customer quote email."
        },
        smartLabelProvider: "test-provider"
      }
    });
    const beforeCounts = await mutationCounts(fx);

    const draft = await crm.buildEmailFollowUpDraft(
      fx.actorA,
      { emailLogId: emailLog.id },
      { now: new Date("2030-01-05T13:00:00.000Z") }
    );

    expect(draft).toMatchObject({
      dueAt: "2030-01-07",
      hasSavedLabels: true,
      target: {
        field: "dealId",
        id: fx.recordsA.deal.id,
        type: "deal"
      },
      title: "Follow up on pricing: Quote and next steps",
      type: "EMAIL"
    });
    expect(draft.description).toContain("Saved labels: Customer, Urgent, Needs reply, Pricing / quote");
    await expect(mutationCounts(fx)).resolves.toEqual(beforeCounts);
    await expect(crm.listEmailPriorityFollowUpStates(fx.actorA, [await reloadEmailLog(fx, emailLog.id)])).resolves.toEqual(
      new Map([[emailLog.id, "none"]])
    );

    const result = await crm.createEmailFollowUpActivity(fx.actorA, {
      description: `${draft.description}\n\nEdited by reviewer.`,
      dueAt: "2030-01-08",
      emailLogId: emailLog.id,
      title: "Reviewed quote follow-up",
      type: "EMAIL"
    });

    expect(result.activityHref).toBe(`/activities/${result.activity.id}/edit?returnTo=%2Femail`);
    expect(result.target.href).toBe(`/deals/${fx.recordsA.deal.id}`);
    const activity = await fx.prisma.activity.findFirstOrThrow({
      where: { id: result.activity.id, workspaceId: fx.workspaceA.id }
    });
    expect(activity).toMatchObject({
      dealId: fx.recordsA.deal.id,
      description: expect.stringContaining("Edited by reviewer."),
      ownerId: fx.userA.id,
      title: "Reviewed quote follow-up",
      type: "EMAIL"
    });
    expect(activity.dueAt?.toISOString()).toBe("2030-01-08T00:00:00.000Z");
    await expect(
      fx.prisma.emailLogActivityLink.findFirstOrThrow({
        where: {
          activityId: result.activity.id,
          emailLogId: emailLog.id,
          workspaceId: fx.workspaceA.id
        }
      })
    ).resolves.toMatchObject({
      activityId: result.activity.id,
      emailLogId: emailLog.id,
      workspaceId: fx.workspaceA.id
    });
    await expect(crm.listEmailPriorityFollowUpStates(fx.actorA, [await reloadEmailLog(fx, emailLog.id)])).resolves.toEqual(
      new Map([[emailLog.id, "created"]])
    );
    const createdDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);
    expect(createdDetails.get(emailLog.id)).toMatchObject({
      followUps: [
        {
          href: `/activities/${result.activity.id}/edit?returnTo=%2Femail`,
          id: result.activity.id,
          linkedRecord: {
            href: `/deals/${fx.recordsA.deal.id}`,
            label: fx.recordsA.deal.title,
            type: "deal"
          },
          source: "durable",
          status: "open",
          title: "Reviewed quote follow-up"
        }
      ],
      state: "created"
    });
    await crm.updateActivity(fx.actorA, result.activity.id, {
      description: "Reviewed follow-up without a source-email marker."
    });
    await expect(crm.listEmailPriorityFollowUpStates(fx.actorA, [await reloadEmailLog(fx, emailLog.id)])).resolves.toEqual(
      new Map([[emailLog.id, "created"]])
    );
    await crm.updateActivity(fx.actorA, result.activity.id, {
      completedAt: new Date("2030-01-09T12:00:00.000Z")
    });
    await expect(crm.listEmailPriorityFollowUpStates(fx.actorA, [await reloadEmailLog(fx, emailLog.id)])).resolves.toEqual(
      new Map([[emailLog.id, "completed"]])
    );
    const completedDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);
    expect(completedDetails.get(emailLog.id)?.followUps[0]).toMatchObject({
      completedAt: new Date("2030-01-09T12:00:00.000Z"),
      id: result.activity.id,
      source: "durable",
      status: "completed"
    });
    await expect(mutationCounts(fx)).resolves.toEqual({
      ...beforeCounts,
      activities: beforeCounts.activities + 1,
      emailLogActivityLinks: beforeCounts.emailLogActivityLinks + 1
    });
  });

  it("returns deterministic linked follow-up summaries for multiple durable email follow-ups", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Can you follow up twice?",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-07T12:00:00.000Z",
      subject: "Multiple follow-ups",
      toText: "sales@example.test"
    });

    const firstOpen = await crm.createEmailFollowUpActivity(fx.actorA, {
      dueAt: "2030-01-08",
      emailLogId: emailLog.id,
      title: "First open linked follow-up",
      type: "EMAIL"
    });
    const secondOpen = await crm.createEmailFollowUpActivity(fx.actorA, {
      dueAt: "2030-01-09",
      emailLogId: emailLog.id,
      title: "Second open linked follow-up",
      type: "CALL"
    });

    const openDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);

    expect(openDetails.get(emailLog.id)).toMatchObject({
      state: "created"
    });
    expect(openDetails.get(emailLog.id)?.followUps.map((followUp) => followUp.id)).toEqual([
      firstOpen.activity.id,
      secondOpen.activity.id
    ]);
    expect(openDetails.get(emailLog.id)?.followUps).toEqual([
      expect.objectContaining({ source: "durable", status: "open", title: "First open linked follow-up" }),
      expect.objectContaining({ source: "durable", status: "open", title: "Second open linked follow-up" })
    ]);

    await crm.updateActivity(fx.actorA, firstOpen.activity.id, {
      completedAt: new Date("2030-01-08T15:00:00.000Z")
    });
    const partiallyCompletedDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);
    expect(partiallyCompletedDetails.get(emailLog.id)).toMatchObject({ state: "created" });
    expect(partiallyCompletedDetails.get(emailLog.id)?.followUps).toEqual([
      expect.objectContaining({ id: secondOpen.activity.id, status: "open", title: "Second open linked follow-up" }),
      expect.objectContaining({ id: firstOpen.activity.id, status: "completed", title: "First open linked follow-up" })
    ]);

    await crm.updateActivity(fx.actorA, secondOpen.activity.id, {
      completedAt: new Date("2030-01-09T15:00:00.000Z")
    });
    const completedDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);
    expect(completedDetails.get(emailLog.id)).toMatchObject({ state: "completed" });
    expect(completedDetails.get(emailLog.id)?.followUps.every((followUp) => followUp.status === "completed")).toBe(true);
  });

  it("uses legacy marker matches only when no durable email activity link exists", async () => {
    const fx = currentFixture();
    const legacyEmailLog = await crm.createEmailLog(fx.actorA, {
      body: "Legacy follow-up body.",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-08T12:00:00.000Z",
      subject: "Legacy marker subject",
      toText: "sales@example.test"
    });
    const legacyActivity = await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      description: "Source email: Legacy marker subject\nCreated before durable links.",
      title: "Legacy marker follow-up",
      type: "EMAIL"
    });

    const fallbackDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, legacyEmailLog.id)]);

    expect(fallbackDetails.get(legacyEmailLog.id)).toMatchObject({
      followUps: [
        {
          id: legacyActivity.id,
          source: "legacy",
          status: "open",
          title: "Legacy marker follow-up"
        }
      ],
      state: "created"
    });

    const durableEmailLog = await crm.createEmailLog(fx.actorA, {
      body: "Durable follow-up body.",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-09T12:00:00.000Z",
      subject: "Durable beats legacy",
      toText: "sales@example.test"
    });
    await fx.prisma.emailLog.update({
      where: { id: durableEmailLog.id },
      data: {
        smartLabelGeneratedAt: new Date("2030-01-09T12:10:00.000Z"),
        smartLabelJson: {
          category: "CUSTOMER",
          confidence: 0.9,
          evidence: ["Customer asked for follow-up."],
          signals: ["FOLLOW_UP_NEEDED"],
          summary: "Customer follow-up request."
        },
        smartLabelProvider: "test-provider"
      }
    });
    await crm.createActivity(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      description: "Source email: Durable beats legacy\nThis should not win once a durable link exists.",
      title: "Legacy guess that should not win",
      type: "EMAIL"
    });
    const durable = await crm.createEmailFollowUpActivity(fx.actorA, {
      emailLogId: durableEmailLog.id,
      title: "Durable completed follow-up",
      type: "EMAIL"
    });
    await crm.updateActivity(fx.actorA, durable.activity.id, {
      completedAt: new Date("2030-01-10T12:00:00.000Z")
    });

    const durableDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, durableEmailLog.id)]);
    const durableQueue = crm.buildEmailPriorityQueue({
      emailLogs: [await reloadEmailLog(fx, durableEmailLog.id)],
      followUpDetails: durableDetails
    });

    expect(durableDetails.get(durableEmailLog.id)).toMatchObject({
      followUps: [
        {
          id: durable.activity.id,
          source: "durable",
          status: "completed",
          title: "Durable completed follow-up"
        }
      ],
      state: "completed"
    });
    expect(durableQueue[0]).toMatchObject({
      followUps: [
        {
          id: durable.activity.id,
          source: "durable"
        }
      ],
      nextBestAction: {
        action: "no_action_needed",
        label: "No action needed",
        reason: expect.stringContaining("All linked follow-ups are completed")
      },
      explainer: {
        evidence: expect.arrayContaining([
          expect.objectContaining({ label: "Durable linked follow-up detected", source: "durable_follow_up" }),
          expect.objectContaining({ label: "All linked follow-ups completed", source: "durable_follow_up" })
        ]),
        sources: expect.arrayContaining(["durable_follow_up"]),
        trail: expect.arrayContaining([
          expect.objectContaining({
            followUp: expect.objectContaining({ id: durable.activity.id, source: "durable", status: "completed" }),
            reason: expect.stringContaining("EmailLogActivityLink"),
            source: "durable_follow_up",
            type: "follow_up"
          }),
          expect.objectContaining({
            label: "All linked follow-ups completed",
            source: "durable_follow_up",
            type: "follow_up"
          })
        ])
      }
    });
    expect(durableQueue[0].explainer.evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Legacy follow-up marker detected", source: "legacy_follow_up" })])
    );
    expect(durableQueue[0].explainer.trail).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Legacy follow-up marker detected", source: "legacy_follow_up" })])
    );
  });

  it("uses conservative defaults without provider configuration or saved labels", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Could you follow up next week?",
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-04T12:00:00.000Z",
      personId: fx.recordsA.person.id,
      subject: "Follow-up timing",
      toText: "sales@example.test"
    });

    const draft = await crm.buildEmailFollowUpDraft(
      fx.actorA,
      { emailLogId: emailLog.id },
      { now: new Date("2030-01-04T13:00:00.000Z") }
    );

    expect(draft.hasSavedLabels).toBe(false);
    expect(draft.labels).toEqual([]);
    expect(draft.description).toContain("Saved labels: none yet; using conservative manual follow-up defaults.");
    expect(draft.target).toMatchObject({
      field: "personId",
      id: fx.recordsA.person.id,
      type: "person"
    });
  });

  it("does not create a follow-up link for an email log in another workspace", async () => {
    const fx = currentFixture();
    const emailLog = await crm.createEmailLog(fx.actorA, {
      body: "Please follow up.",
      dealId: fx.recordsA.deal.id,
      direction: "INBOUND",
      fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
      occurredAt: "2030-01-06T12:00:00.000Z",
      subject: "Workspace boundary",
      toText: "sales@example.test"
    });

    await expect(
      crm.createEmailFollowUpActivity(fx.actorB, {
        emailLogId: emailLog.id,
        title: "Cross-workspace follow-up"
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(fx.prisma.emailLogActivityLink.count({ where: { emailLogId: emailLog.id } })).resolves.toBe(0);

    const linked = await crm.createEmailFollowUpActivity(fx.actorA, {
      emailLogId: emailLog.id,
      title: "Workspace-owned follow-up"
    });
    await expect(
      crm.updateActivity(fx.actorB, linked.activity.id, {
        completedAt: new Date("2030-01-06T15:00:00.000Z")
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(fx.prisma.activity.findUniqueOrThrow({ where: { id: linked.activity.id } })).resolves.toMatchObject({
      completedAt: null
    });
  });
});

async function mutationCounts(fx: Fixture) {
  const where = { workspaceId: fx.workspaceA.id };
  return {
    activities: await fx.prisma.activity.count({ where }),
    emailLogActivityLinks: await fx.prisma.emailLogActivityLink.count({ where }),
    leads: await fx.prisma.lead.count({ where }),
    notes: await fx.prisma.note.count({ where }),
    people: await fx.prisma.person.count({ where })
  };
}

async function reloadEmailLog(fx: Fixture, id: string) {
  return fx.prisma.emailLog.findFirstOrThrow({
    where: { id, workspaceId: fx.workspaceA.id },
    include: { deal: true, lead: true, organization: true, person: true }
  });
}

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
