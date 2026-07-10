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

describe("scheduler link service", () => {
  it("creates, lists, updates, and scopes scheduler links to the actor workspace", async () => {
    const fx = currentFixture();
    const schedulerLink = await crm.createSchedulerLink(fx.actorA, {
      name: "Discovery scheduler",
      meetingTitle: "Discovery call",
      description: "Bring your timeline.",
      durationMinutes: 30,
      timezone: "UTC",
      minimumNoticeMinutes: 60,
      availability: [{ weekday: 1, start: "09:00", end: "11:00" }]
    });

    expect(schedulerLink.workspaceId).toBe(fx.workspaceA.id);
    expect(schedulerLink.createdById).toBe(fx.userA.id);
    expect(schedulerLink.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    await expect(crm.listSchedulerLinks(fx.actorA)).resolves.toHaveLength(1);
    await expect(crm.listSchedulerLinks(fx.actorB)).resolves.toHaveLength(0);
    await expect(crm.getSchedulerLinkReview(fx.actorB, schedulerLink.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    const updated = await crm.updateSchedulerLink(fx.actorA, schedulerLink.id, {
      name: "Renamed scheduler",
      isEnabled: false
    });
    expect(updated.name).toBe("Renamed scheduler");
    expect(updated.isEnabled).toBe(false);

    const audits = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityType: "SchedulerLink", entityId: schedulerLink.id },
      orderBy: { createdAt: "asc" }
    });
    expect(audits.map((entry) => entry.action)).toEqual(["scheduler_link.created", "scheduler_link.updated"]);
    expect(JSON.stringify(audits)).not.toContain(schedulerLink.token);
  });

  it("returns only enabled public scheduler data with configured choices and no internal ids", async () => {
    const fx = currentFixture();
    const schedulerLink = await crm.createSchedulerLink(fx.actorA, {
      name: "Public scheduler",
      meetingTitle: "Public intro",
      description: "Pick a configured time.",
      durationMinutes: 30,
      timezone: "UTC",
      minimumNoticeMinutes: 0,
      availability: [{ weekday: 1, start: "09:00", end: "10:00" }]
    });

    const publicLink = await crm.getPublicSchedulerLinkByToken(schedulerLink.token, {
      now: new Date("2026-07-06T08:00:00.000Z")
    });
    expect(publicLink).toMatchObject({
      meetingTitle: "Public intro",
      description: "Pick a configured time.",
      durationMinutes: 30,
      timezone: "UTC"
    });
    expect(publicLink.choices[0]).toMatchObject({ value: "2026-07-06T09:00:00.000Z" });
    expect((publicLink as { id?: string }).id).toBeUndefined();
    expect((publicLink as { workspaceId?: string }).workspaceId).toBeUndefined();
    expect(JSON.stringify(publicLink)).not.toContain(schedulerLink.token);

    await expect(crm.getPublicSchedulerLinkByToken("not-a-token")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await crm.updateSchedulerLink(fx.actorA, schedulerLink.id, { isEnabled: false });
    await expect(crm.getPublicSchedulerLinkByToken(schedulerLink.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("honors timezone and minimum notice when building public choices", async () => {
    const fx = currentFixture();
    const schedulerLink = await crm.createSchedulerLink(fx.actorA, {
      name: "Notice scheduler",
      meetingTitle: "Minimum notice call",
      durationMinutes: 30,
      timezone: "UTC",
      minimumNoticeMinutes: 60,
      availability: [{ weekday: 1, start: "09:00", end: "09:30" }]
    });

    const publicLink = await crm.getPublicSchedulerLinkByToken(schedulerLink.token, {
      now: new Date("2026-07-06T08:30:00.000Z")
    });

    expect(publicLink.choices.map((choice) => choice.value)).not.toContain("2026-07-06T09:00:00.000Z");
    expect(publicLink.choices[0]?.value).toBe("2026-07-13T09:00:00.000Z");
  });

  it("books an enabled public scheduler link into exactly one meeting activity without auto-created CRM records", async () => {
    const fx = currentFixture();
    const schedulerLink = await crm.createSchedulerLink(fx.actorA, {
      name: "Booking scheduler",
      meetingTitle: "Implementation review",
      durationMinutes: 30,
      timezone: "UTC",
      minimumNoticeMinutes: 0,
      availability: [{ weekday: 1, start: "09:00", end: "10:00" }]
    });
    const countsBefore = await recordCounts(fx);
    const startAt = "2026-07-06T09:00:00.000Z";

    const result = await crm.submitPublicSchedulerBooking(
      schedulerLink.token,
      {
        startAt,
        attendeeName: "Alpha Contact",
        attendeeEmail: "ALPHA@example.test",
        attendeeCompany: "Existing Org",
        attendeeNote: "Please cover rollout timing."
      },
      { now: new Date("2026-07-06T08:00:00.000Z") }
    );

    expect(result).toMatchObject({ blocked: false, created: true, duplicate: false });
    await expect(fx.prisma.schedulerBooking.count({ where: { workspaceId: fx.workspaceA.id, schedulerLinkId: schedulerLink.id } })).resolves.toBe(1);
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id, type: "MEETING" } })).resolves.toBe(
      countsBefore.activitiesA + 1
    );

    const activity = await fx.prisma.activity.findUniqueOrThrow({ where: { id: result.activityId ?? "" } });
    expect(activity.workspaceId).toBe(fx.workspaceA.id);
    expect(activity.type).toBe("MEETING");
    expect(activity.dueAt?.toISOString()).toBe(startAt);
    expect(activity.personId).toBe(fx.recordsA.person.id);
    expect(activity.organizationId).toBe(fx.recordsA.person.organizationId);
    expect(activity.description).toContain("Northstar-configured availability only");
    expect(activity.description).toContain("Email: alpha@example.test");
    expect(activity.description).not.toContain(schedulerLink.token);

    const countsAfter = await recordCounts(fx);
    expect(countsAfter.peopleA).toBe(countsBefore.peopleA);
    expect(countsAfter.organizationsA).toBe(countsBefore.organizationsA);
    expect(countsAfter.dealsA).toBe(countsBefore.dealsA);
    expect(countsAfter.leadsA).toBe(countsBefore.leadsA);
    expect(countsAfter.peopleB).toBe(countsBefore.peopleB);
    expect(countsAfter.activitiesB).toBe(countsBefore.activitiesB);

    const review = await crm.getSchedulerLinkReview(fx.actorA, schedulerLink.id);
    expect(review._count.bookings).toBe(1);
    expect(review.bookings[0]).toMatchObject({
      attendeeName: "Alpha Contact",
      attendeeEmail: "alpha@example.test",
      attendeeCompany: "Existing Org",
      attendeeNote: "Please cover rollout timing.",
      activity: { id: result.activityId }
    });
  });

  it("suppresses exact duplicate and honeypot attempts without storing spam payloads", async () => {
    const fx = currentFixture();
    const schedulerLink = await crm.createSchedulerLink(fx.actorA, {
      name: "Suppression scheduler",
      meetingTitle: "Suppression call",
      durationMinutes: 30,
      timezone: "UTC",
      minimumNoticeMinutes: 0,
      availability: [{ weekday: 1, start: "09:00", end: "10:00" }]
    });
    const payload = {
      startAt: "2026-07-06T09:00:00.000Z",
      attendeeName: "Duplicate Guest",
      attendeeEmail: "duplicate@example.test",
      attendeeCompany: "Duplicate Co",
      attendeeNote: "Only one meeting should exist."
    };

    const first = await crm.submitPublicSchedulerBooking(schedulerLink.token, payload, {
      now: new Date("2026-07-06T08:00:00.000Z")
    });
    const duplicate = await crm.submitPublicSchedulerBooking(schedulerLink.token, payload, {
      now: new Date("2026-07-06T08:01:00.000Z")
    });
    const honeypot = await crm.submitPublicSchedulerBooking(
      schedulerLink.token,
      {
        startAt: "2026-07-06T09:30:00.000Z",
        attendeeName: "Spam Guest",
        attendeeEmail: "spam@example.test",
        attendeeNote: "Do not store this.",
        website: "https://spam.example.test"
      },
      { now: new Date("2026-07-06T08:00:00.000Z") }
    );

    expect(first).toMatchObject({ created: true, duplicate: false });
    expect(duplicate).toMatchObject({ created: false, duplicate: true, activityId: first.activityId });
    expect(honeypot).toMatchObject({ blocked: true, created: false });
    await expect(fx.prisma.schedulerBooking.count({ where: { workspaceId: fx.workspaceA.id, schedulerLinkId: schedulerLink.id } })).resolves.toBe(1);
    await expect(
      fx.prisma.activity.count({
        where: { workspaceId: fx.workspaceA.id, title: { contains: "Suppression call" } }
      })
    ).resolves.toBe(1);

    const review = await crm.getSchedulerLinkReview(fx.actorA, schedulerLink.id);
    expect(JSON.stringify(review)).not.toContain("https://spam.example.test");
    expect(JSON.stringify(review)).not.toContain("Do not store this.");
  });

  it("rejects bookings outside configured windows and disabled links safely", async () => {
    const fx = currentFixture();
    const schedulerLink = await crm.createSchedulerLink(fx.actorA, {
      name: "Unavailable scheduler",
      meetingTitle: "Unavailable call",
      durationMinutes: 30,
      timezone: "UTC",
      minimumNoticeMinutes: 0,
      availability: [{ weekday: 1, start: "09:00", end: "10:00" }]
    });

    await expect(
      crm.submitPublicSchedulerBooking(
        schedulerLink.token,
        {
          startAt: "2026-07-06T11:00:00.000Z",
          attendeeName: "Late Guest",
          attendeeEmail: "late@example.test"
        },
        { now: new Date("2026-07-06T08:00:00.000Z") }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });

    await crm.updateSchedulerLink(fx.actorA, schedulerLink.id, { isEnabled: false });
    await expect(
      crm.submitPublicSchedulerBooking(
        schedulerLink.token,
        {
          startAt: "2026-07-06T09:00:00.000Z",
          attendeeName: "Disabled Guest",
          attendeeEmail: "disabled@example.test"
        },
        { now: new Date("2026-07-06T08:00:00.000Z") }
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    await expect(fx.prisma.schedulerBooking.count({ where: { workspaceId: fx.workspaceA.id, schedulerLinkId: schedulerLink.id } })).resolves.toBe(0);
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Expected integration fixture.");
  return fixture;
}

async function recordCounts(fx: Fixture) {
  const [peopleA, organizationsA, dealsA, leadsA, activitiesA, peopleB, activitiesB] = await Promise.all([
    fx.prisma.person.count({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
    fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id, type: "MEETING" } }),
    fx.prisma.person.count({ where: { workspaceId: fx.workspaceB.id } }),
    fx.prisma.activity.count({ where: { workspaceId: fx.workspaceB.id, type: "MEETING" } })
  ]);

  return { peopleA, organizationsA, dealsA, leadsA, activitiesA, peopleB, activitiesB };
}
