import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ActivityType, MeetingIntakeSourceType, MeetingIntakeStatus, QuoteStatus } from "@prisma/client";

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

describe("Meeting Prep Brief service", () => {
  it("builds an attributed, separated, read-only prep brief for an upcoming CRM meeting", async () => {
    const fx = currentFixture();
    await fx.prisma.person.update({
      where: { id: fx.recordsA.person.id },
      data: {
        relationshipCommunicationStyle: "Prefers concise agendas before budget calls.",
        relationshipPersonalContext: "Enjoys implementation examples from logistics teams."
      }
    });
    const meeting = await fx.prisma.activity.create({
      data: {
        dealId: fx.recordsA.deal.id,
        dueAt: new Date("2030-02-03T15:30:00.000Z"),
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "Prep Brief Renewal Meeting",
        type: ActivityType.MEETING,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.note.create({
      data: {
        authorId: fx.userA.id,
        body: "Customer asked for a SOC 2 proof point and a short implementation checklist.",
        dealId: fx.recordsA.deal.id,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.activity.create({
      data: {
        completedAt: new Date("2030-01-20T16:00:00.000Z"),
        dealId: fx.recordsA.deal.id,
        ownerId: fx.userA.id,
        title: "Completed pricing recap",
        type: ActivityType.CALL,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.activity.create({
      data: {
        dealId: fx.recordsA.deal.id,
        dueAt: new Date("2030-01-15T16:00:00.000Z"),
        ownerId: fx.userA.id,
        title: "Send legal follow-up",
        type: ActivityType.TASK,
        workspaceId: fx.workspaceA.id
      }
    });
    const quote = await fx.prisma.quote.create({
      data: {
        currency: "USD",
        dealId: fx.recordsA.deal.id,
        discountCents: 0,
        discountType: "NONE",
        discountValue: 0,
        number: `MPB-${Date.now()}`,
        status: QuoteStatus.SENT,
        subtotalCents: 120000,
        taxCents: 0,
        taxType: "NONE",
        taxValue: 0,
        totalCents: 120000,
        workspaceId: fx.workspaceA.id
      }
    });
    const priorMeeting = await fx.prisma.activity.create({
      data: {
        completedAt: new Date("2030-01-10T16:00:00.000Z"),
        dealId: fx.recordsA.deal.id,
        ownerId: fx.userA.id,
        title: "Prior discovery call",
        type: ActivityType.MEETING,
        workspaceId: fx.workspaceA.id
      }
    });
    const intake = await fx.prisma.meetingIntake.create({
      data: {
        markdownText: "RAW TRANSCRIPT: do not dump this into prep.",
        proposedChangesJson: {
          markdown: "RAW TRANSCRIPT: do not dump this into prep.",
          matchedObjects: [],
          meetingActivity: null,
          nextStepActivities: [],
          notes: [],
          relationshipBriefUpdates: [
            {
              evidence: ["They prefer legal review before budget approval."],
              existing: {},
              facts: [
                {
                  field: "relationshipBusinessConcerns",
                  id: "fact_1",
                  include: true,
                  text: "Legal review is a budget approval dependency."
                }
              ],
              id: "relationship_1",
              include: true,
              proposed: { relationshipBusinessConcerns: "Legal review is a budget approval dependency." },
              target: { id: fx.recordsA.person.id, label: "Alpha Contact", type: "person" }
            }
          ],
          summary: "Prior discovery confirmed legal review is needed before budget approval.",
          unmatchedEntities: [],
          warnings: []
        },
        sourceType: MeetingIntakeSourceType.TEXT_FILE,
        status: MeetingIntakeStatus.APPLIED,
        workspaceId: fx.workspaceA.id,
        applyResultJson: {
          appliedAt: "2030-01-10T17:00:00.000Z",
          created: [],
          relationshipBriefChanges: [
            {
              acceptedFactCount: 1,
              acceptedFacts: ["Legal review is a budget approval dependency."],
              changedAt: "2030-01-10T17:00:00.000Z",
              field: "relationshipBusinessConcerns",
              fieldLabel: "Business concerns",
              newValue: "Legal review is a budget approval dependency.",
              previousValue: null,
              source: { intakeId: "intake", title: "Prior discovery call", type: "meeting_intelligence" },
              target: { id: fx.recordsA.person.id, label: "Alpha Contact", type: "person" }
            }
          ],
          skipped: [],
          warnings: []
        }
      }
    });
    await fx.prisma.meetingActivityAssociation.create({
      data: {
        activityId: priorMeeting.id,
        dealId: fx.recordsA.deal.id,
        meetingIntakeId: intake.id,
        workspaceId: fx.workspaceA.id
      }
    });

    const countsBefore = await mutationCounts(fx);
    const brief = await crm.buildMeetingPrepBrief(fx.actorA, meeting.id, { now: new Date("2030-01-25T12:00:00.000Z") });
    const countsAfter = await mutationCounts(fx);

    expect(countsAfter).toEqual(countsBefore);
    expect(brief?.activity.title).toBe("Prep Brief Renewal Meeting");
    expect(brief?.attendees).toEqual(expect.arrayContaining([expect.objectContaining({ value: "Alpha Contact" })]));
    expect(brief?.attendeeConfidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "matched_contact",
          stateLabel: "Matched to one CRM contact",
          confirmedLinks: expect.arrayContaining([expect.objectContaining({ href: `/contacts/${fx.recordsA.person.id}` })]),
          evidence: expect.arrayContaining([expect.objectContaining({ label: "Linked activity person" })])
        })
      ])
    );
    expect(brief?.personFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: expect.stringContaining("Communication style"), source: "Relationship Memory" })
      ])
    );
    expect(JSON.stringify(brief?.organizationFacts)).toContain(fx.recordsA.organization.name);
    expect(JSON.stringify(brief?.organizationFacts)).not.toContain("implementation examples from logistics teams");
    expect(brief?.dealContext[0]).toMatchObject({ source: "Deal record", sourceRef: { href: `/deals/${fx.recordsA.deal.id}` } });
    expect(brief?.recentHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "Notes", value: expect.stringContaining("SOC 2 proof point") }),
        expect.objectContaining({ source: "Activity", value: expect.stringContaining("Completed pricing recap") })
      ])
    );
    expect(brief?.openCommitments).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Overdue follow-up", value: expect.stringContaining("Send legal follow-up") })])
    );
    expect(brief?.quoteStatus).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceRef: expect.objectContaining({ href: `/deals/${fx.recordsA.deal.id}/quotes/${quote.id}` }) })])
    );
    expect(brief?.meetingIntelligence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "Meeting Intelligence",
          sourceRef: expect.objectContaining({ href: `/meeting-intelligence/${intake.id}`, type: "meeting_intelligence" }),
          value: expect.stringContaining("legal review")
        })
      ])
    );
    expect(brief?.suggestedTopics.every((item) => item.source === "Suggestion")).toBe(true);
    expect(JSON.stringify(brief)).not.toContain("RAW TRANSCRIPT");
  });

  it("respects workspace boundaries and reports missing attendee/context safely", async () => {
    const fx = currentFixture();
    const meeting = await fx.prisma.activity.create({
      data: {
        dueAt: null,
        ownerId: fx.userA.id,
        title: "Unmatched prospect meeting",
        type: ActivityType.MEETING,
        workspaceId: fx.workspaceA.id
      }
    });

    await expect(crm.buildMeetingPrepBrief(fx.actorB, meeting.id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const brief = await crm.buildMeetingPrepBrief(fx.actorA, meeting.id, { now: new Date("2030-01-25T12:00:00.000Z") });
    expect(brief?.attendees).toEqual([]);
    expect(brief?.attendeeConfidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "unmatched",
          evidence: expect.arrayContaining([expect.objectContaining({ label: "No attendee metadata found" })])
        })
      ])
    );
    expect(brief?.missingOrUncertain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Meeting time missing" }),
        expect.objectContaining({ label: "Linked contact missing", actions: expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining("/contacts?q=Unmatched+prospect+meeting") })]) }),
        expect.objectContaining({ label: "Linked organization missing", actions: expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining("/organizations?q=Unmatched+prospect+meeting") })]) }),
        expect.objectContaining({ label: "Linked deal context missing", actions: expect.arrayContaining([expect.objectContaining({ href: expect.stringContaining("/deals?q=Unmatched+prospect+meeting") })]) }),
        expect.objectContaining({ label: "Attendee confidence incomplete" })
      ])
    );
    expect(brief?.suggestedTopics).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Confirm attendees" })]));
  });

  it("classifies attendee confidence with evidence, safe candidates, workspace isolation, and no mutations", async () => {
    const fx = currentFixture();
    const suffix = `${Date.now()}`;
    const exactEmail = `prep-exact-${suffix}@example.test`;
    const duplicateEmail = `prep-dupe-${suffix}@example.test`;
    const deletedEmail = `prep-deleted-${suffix}@example.test`;
    const otherWorkspaceEmail = `prep-other-${suffix}@example.test`;
    const ambiguousLastName = `Ambiguous${suffix}`;
    const nameOnlyLastName = `Nameonly${suffix}`;
    const exactPerson = await fx.prisma.person.create({
      data: {
        email: exactEmail,
        firstName: "Exact",
        lastName: `Email${suffix}`,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.person.createMany({
      data: [
        {
          email: duplicateEmail,
          firstName: "Jordan",
          lastName: `Duplicate${suffix}`,
          workspaceId: fx.workspaceA.id
        },
        {
          email: duplicateEmail,
          firstName: "Jordan",
          lastName: `Duplicate${suffix}`,
          workspaceId: fx.workspaceA.id
        },
        {
          email: `name-only-${suffix}@example.test`,
          firstName: "Morgan",
          lastName: nameOnlyLastName,
          workspaceId: fx.workspaceA.id
        },
        {
          email: `ambiguous-a-${suffix}@example.test`,
          firstName: "Casey",
          lastName: ambiguousLastName,
          workspaceId: fx.workspaceA.id
        },
        {
          email: `ambiguous-b-${suffix}@example.test`,
          firstName: "Casey",
          lastName: ambiguousLastName,
          workspaceId: fx.workspaceA.id
        },
        {
          email: deletedEmail,
          firstName: "Deleted",
          lastName: `Contact${suffix}`,
          deletedAt: new Date("2030-01-01T00:00:00.000Z"),
          workspaceId: fx.workspaceA.id
        },
        {
          email: otherWorkspaceEmail,
          firstName: "Other",
          lastName: `Workspace${suffix}`,
          workspaceId: fx.workspaceB.id
        }
      ]
    });
    const associatedPerson = await fx.prisma.person.create({
      data: {
        email: `associated-${suffix}@example.test`,
        firstName: "Associated",
        lastName: `Contact${suffix}`,
        workspaceId: fx.workspaceA.id
      }
    });
    const meeting = await fx.prisma.activity.create({
      data: {
        description: [
          `Attendees: ${exactEmail}; ${duplicateEmail}; Morgan ${nameOnlyLastName}; Casey ${ambiguousLastName}; Unstored Prospect ${suffix}; ${fx.userA.email}; ${deletedEmail}; ${otherWorkspaceEmail}`,
          "Context: discuss renewal timing and implementation owners."
        ].join("\n"),
        dueAt: new Date("2030-04-03T15:30:00.000Z"),
        ownerId: fx.userA.id,
        title: `Attendee Confidence Review ${suffix}`,
        type: ActivityType.MEETING,
        workspaceId: fx.workspaceA.id
      }
    });
    const intake = await fx.prisma.meetingIntake.create({
      data: {
        proposedChangesJson: {
          markdown: "RAW TRANSCRIPT: do not show attendee transcript chunks.",
          matchedObjects: [],
          meetingActivity: null,
          nextStepActivities: [],
          notes: [],
          relationshipBriefUpdates: [],
          summary: "Reviewed source confirms a stakeholder was associated.",
          unmatchedEntities: [],
          warnings: []
        },
        sourceType: MeetingIntakeSourceType.TEXT_FILE,
        status: MeetingIntakeStatus.APPLIED,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.meetingActivityAssociation.create({
      data: {
        activityId: meeting.id,
        meetingIntakeId: intake.id,
        personId: associatedPerson.id,
        workspaceId: fx.workspaceA.id
      }
    });

    const countsBefore = await mutationCounts(fx);
    const brief = await crm.buildMeetingPrepBrief(fx.actorA, meeting.id, { now: new Date("2030-03-01T12:00:00.000Z") });
    const countsAfter = await mutationCounts(fx);
    const attendees = brief?.attendeeConfidence ?? [];

    expect(countsAfter).toEqual(countsBefore);
    expect(attendees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining("Associated Contact"),
          state: "matched_contact",
          evidence: expect.arrayContaining([expect.objectContaining({ label: "Existing Meeting Intelligence association" })])
        }),
        expect.objectContaining({
          label: expect.stringContaining("Exact Email"),
          state: "matched_contact",
          evidence: expect.arrayContaining([expect.objectContaining({ label: "Exact email match", detail: exactEmail })]),
          confirmedLinks: expect.arrayContaining([expect.objectContaining({ href: `/contacts/${exactPerson.id}` })])
        }),
        expect.objectContaining({
          label: duplicateEmail,
          state: "multiple_contact_candidates",
          suggestedCandidates: expect.arrayContaining([
            expect.objectContaining({ label: expect.stringContaining("Jordan Duplicate") })
          ])
        }),
        expect.objectContaining({
          label: `Morgan ${nameOnlyLastName}`,
          state: "name_only",
          confirmedLinks: [],
          suggestedCandidates: expect.arrayContaining([expect.objectContaining({ label: `Morgan ${nameOnlyLastName}` })])
        }),
        expect.objectContaining({
          label: `Casey ${ambiguousLastName}`,
          state: "multiple_contact_candidates",
          suggestedCandidates: expect.arrayContaining([
            expect.objectContaining({ label: `Casey ${ambiguousLastName}` })
          ])
        }),
        expect.objectContaining({
          label: `Unstored Prospect ${suffix}`,
          state: "name_only",
          suggestedCandidates: []
        }),
        expect.objectContaining({
          label: "Integration A",
          state: "internal",
          internal: true,
          evidence: expect.arrayContaining([expect.objectContaining({ label: "Workspace member email" })])
        }),
        expect.objectContaining({
          label: deletedEmail,
          state: "email_no_contact",
          confirmedLinks: [],
          suggestedCandidates: []
        }),
        expect.objectContaining({
          label: otherWorkspaceEmail,
          state: "email_no_contact",
          confirmedLinks: [],
          suggestedCandidates: []
        })
      ])
    );
    expect(JSON.stringify(attendees)).toContain(`/contacts?q=${encodeURIComponent(deletedEmail)}`);
    expect(JSON.stringify(attendees)).toContain(`/activities/${meeting.id}/edit`);
    expect(JSON.stringify(brief)).not.toContain("RAW TRANSCRIPT");
  });

  it("finds the next upcoming meeting prep brief from related record pages", async () => {
    const fx = currentFixture();
    await fx.prisma.activity.create({
      data: {
        completedAt: new Date("2030-01-01T12:00:00.000Z"),
        dealId: fx.recordsA.deal.id,
        ownerId: fx.userA.id,
        title: "Completed meeting should not show",
        type: ActivityType.MEETING,
        workspaceId: fx.workspaceA.id
      }
    });
    const upcoming = await fx.prisma.activity.create({
      data: {
        dealId: fx.recordsA.deal.id,
        dueAt: new Date("2030-03-01T12:00:00.000Z"),
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "Record detail prep meeting",
        type: ActivityType.MEETING,
        workspaceId: fx.workspaceA.id
      }
    });

    await expect(crm.buildMeetingPrepBriefForRecord(fx.actorB, { type: "deal", id: fx.recordsA.deal.id })).resolves.toBeNull();
    await expect(crm.buildMeetingPrepBriefForRecord(fx.actorA, { type: "deal", id: fx.recordsB.deal.id })).resolves.toBeNull();
    const brief = await crm.buildMeetingPrepBriefForRecord(fx.actorA, { type: "deal", id: fx.recordsA.deal.id }, {
      now: new Date("2030-02-01T12:00:00.000Z")
    });

    expect(brief?.activity.id).toBe(upcoming.id);
    expect(brief?.activity.title).toBe("Record detail prep meeting");
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Expected integration fixture to be initialized.");
  return fixture;
}

async function mutationCounts(fx: Fixture) {
  const where = { workspaceId: fx.workspaceA.id };
  const [activities, auditLogs, meetingIntakes, notes, people, quotes] = await Promise.all([
    fx.prisma.activity.count({ where }),
    fx.prisma.auditLog.count({ where }),
    fx.prisma.meetingIntake.count({ where }),
    fx.prisma.note.count({ where }),
    fx.prisma.person.count({ where }),
    fx.prisma.quote.count({ where })
  ]);
  return { activities, auditLogs, meetingIntakes, notes, people, quotes };
}
