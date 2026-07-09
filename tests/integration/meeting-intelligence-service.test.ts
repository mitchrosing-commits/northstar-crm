import { JobStatus, Prisma } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runJobsOnce } from "@/lib/jobs/run-once";
import { meetingMediaExtractionJobType } from "@/lib/jobs/handlers";
import { deleteStoredMeetingIntelligenceFile, storeMeetingIntelligenceFile } from "@/lib/meeting-intelligence/file-storage";
import { handleInternalMeetingMediaExtract } from "@/lib/meeting-intelligence/internal-media-extract-route";
import { internalMeetingMediaExtractionRoutePath } from "@/lib/meeting-intelligence/openai-media-provider";
import {
  applyMeetingIntake,
  cleanupMeetingIntelligenceStoredFiles,
  createMeetingIntake
} from "@/lib/services/meeting-intelligence-service";
import { buildEmailReplyContext } from "@/lib/services/email-reply-assistant-service";
import { updateActivity } from "@/lib/services/activity-service";
import { getRecordTimeline } from "@/lib/services/timeline-service";
import type { MeetingIntelligenceDraft } from "@/lib/meeting-intelligence/types";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;
let storageDir: string | undefined;
const pdfFixtureBase64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTQ3ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIChNZWV0aW5nIGRhdGU6IDIwMzAtMDQtMDEpIFRqIDAgLTE4IFRkIChBY3Rpb246IHNlbmQgU09XIGJ5IDIwMzAtMDQtMDUuKSBUaiAwIC0xOCBUZCAoQ3VycmVudCBXTVMgaGFzIGludmVudG9yeSBwYWluLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjUwOQolJUVPRgo=";
const scannedPdfFixtureBase64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8ID4+ID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMjA4CiUlRU9GCg==";

beforeAll(async () => {
  fixture = await createIntegrationFixture();
});

beforeEach(async () => {
  storageDir = await mkdtemp(join(tmpdir(), "northstar-mi-storage-"));
  process.env.MEETING_INTELLIGENCE_FILE_STORAGE_DIR = storageDir;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fixture?.prisma.meetingActivityAssociation.deleteMany({ where: { workspaceId: fixture.workspaceA.id } });
  await fixture?.prisma.job.deleteMany({ where: { workspaceId: fixture.workspaceA.id } });
  await fixture?.prisma.meetingIntake.deleteMany({ where: { workspaceId: fixture.workspaceA.id } });
  await fixture?.prisma.auditLog.deleteMany({ where: { workspaceId: fixture.workspaceA.id, entityType: "MeetingIntake" } });
  await fixture?.prisma.note.deleteMany({
    where: {
      workspaceId: fixture.workspaceA.id,
      OR: [
        { body: { contains: "Meeting intelligence" } },
        { body: "Edited meeting intelligence note body" },
        { body: "Manual reassigned meeting note body" }
      ]
    }
  });
  await fixture?.prisma.activity.deleteMany({
    where: { workspaceId: fixture.workspaceA.id, title: { contains: "Meeting:" } }
  });
  await fixture?.prisma.activity.deleteMany({
    where: {
      workspaceId: fixture.workspaceA.id,
      OR: [{ description: { contains: "Source: send SOW" } }, { description: { contains: "Source: Meeting Intelligence" } }]
    }
  });
  await fixture?.prisma.person.deleteMany({
    where: { workspaceId: fixture.workspaceA.id, email: "retarget-alpha-alt@example.test" }
  });
  if (fixture) {
    await fixture.prisma.person.updateMany({
      where: { workspaceId: { in: [fixture.workspaceA.id, fixture.workspaceB.id] } },
      data: {
        relationshipBusinessConcerns: null,
        relationshipCommunicationStyle: null,
        relationshipFollowUpReminders: null,
        relationshipInternalGuidance: null,
        relationshipPersonalContext: null
      }
    });
  }
  if (storageDir) await rm(storageDir, { force: true, recursive: true });
  storageDir = undefined;
  delete process.env.MEETING_INTELLIGENCE_FILE_STORAGE_DIR;
});

afterAll(async () => {
  await fixture?.cleanup();
  fixture = undefined;
  await disconnectPrisma();
});

describe("meeting intelligence service", () => {
  it("creates a reviewable draft without mutating CRM records, then applies selected updates idempotently", async () => {
    const fx = currentFixture();
    const noteCountBefore = await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } });
    const activityCountBefore = await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } });
    const associationCountBefore = await fx.prisma.meetingActivityAssociation.count({ where: { workspaceId: fx.workspaceA.id } });

    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-01\nAttendees: Alpha Contact",
      hints: { dealId: fx.recordsA.deal.id, organizationId: fx.recordsA.organization.id, personIds: [fx.recordsA.person.id] },
      text: [
        `Met with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} at ${fx.recordsA.organization.name}.`,
        `${fx.recordsA.deal.title} has approved budget and needs SOW review.`,
        "Current WMS has inventory pain and ERP integration risk.",
        "Action: send SOW by 2030-04-05."
      ].join("\n")
    });

    expect(intake.errorMessage).toBeNull();
    expect(intake.status).toBe("READY_FOR_REVIEW");
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;
    expect(JSON.stringify(draft.matchedObjects)).toContain(fx.recordsA.deal.id);
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(noteCountBefore);
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(activityCountBefore);
    await expect(fx.prisma.meetingActivityAssociation.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      associationCountBefore
    );

    const applyInput = {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true } : null,
      notes: draft.notes.map((note, index) => ({
        ...note,
        body: index === 0 ? "Edited meeting intelligence note body" : note.body,
        include: index === 0
      })),
      nextStepActivities: draft.nextStepActivities.map((activity, index) => ({ ...activity, include: index === 0 }))
    };
    const result = await applyMeetingIntake(fx.actorA, intake.id, applyInput);

    expect(result.created.filter((item) => item.type === "note")).toHaveLength(1);
    expect(result.created.filter((item) => item.type === "activity")).toHaveLength(2);
    await expect(
      fx.prisma.note.findFirst({
        where: { workspaceId: fx.workspaceA.id, body: "Edited meeting intelligence note body" }
      })
    ).resolves.toBeTruthy();
    const afterFirstApplyCounts = {
      activities: await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } }),
      associations: await fx.prisma.meetingActivityAssociation.count({ where: { workspaceId: fx.workspaceA.id } }),
      notes: await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })
    };
    const secondResult = await applyMeetingIntake(fx.actorA, intake.id, applyInput);

    expect(secondResult).toEqual(result);
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstApplyCounts.notes);
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstApplyCounts.activities);
    await expect(fx.prisma.meetingActivityAssociation.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(
      afterFirstApplyCounts.associations
    );
  });

  it("creates object-specific notes, a completed meeting log, and follow-up activities after approval", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-10\nAttendees: Alpha Contact",
      hints: {
        dealId: fx.recordsA.deal.id,
        leadId: fx.recordsA.lead.id,
        organizationId: fx.recordsA.organization.id,
        personIds: [fx.recordsA.person.id]
      },
      text: [
        `Met with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} at ${fx.recordsA.organization.name} about ${fx.recordsA.deal.title}.`,
        `${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} prefers email and mentioned a birthday on 2030-05-01.`,
        `${fx.recordsA.organization.name} has WMS inventory pain and a data migration blocker.`,
        `${fx.recordsA.deal.title} has approved budget, SOW risk, and legal approval timing pressure.`,
        `${fx.recordsA.lead.title} has pilot interest and a qualification timeline.`,
        "Action: send SOW by 2030-04-15."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;

    expect(draft.meetingActivity?.associatedTargets?.map((target) => target.type)).toEqual(
      expect.arrayContaining(["deal", "organization", "person"])
    );
    expect(draft.notes.some((note) => note.target?.type === "person" && note.kind === "personal_fact")).toBe(true);
    expect(draft.notes.some((note) => note.target?.type === "organization" && note.kind === "company_fact")).toBe(true);
    expect(draft.notes.some((note) => note.target?.type === "deal" && note.kind === "deal_fact")).toBe(true);
    expect(draft.notes.some((note) => note.target?.type === "lead" && note.kind === "lead_fact")).toBe(true);
    expect(draft.relationshipBriefUpdates?.some((update) => update.target?.id === fx.recordsA.person.id)).toBe(true);

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true } : null,
      notes: draft.notes.map((note) => ({ ...note, include: true })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: true })),
      relationshipBriefUpdates: draft.relationshipBriefUpdates?.map((update) => ({ ...update, include: true })) ?? []
    });

    expect(result.created.filter((item) => item.type === "note").length).toBeGreaterThanOrEqual(4);
    expect(result.created.filter((item) => item.type === "activity")).toHaveLength(2);
    expect(result.created.filter((item) => item.type === "relationship_brief")).toHaveLength(1);
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipCommunicationStyle: expect.stringContaining("prefers email"),
      relationshipPersonalContext: expect.stringContaining("birthday")
    });
    await expect(
      fx.prisma.note.findFirst({
        where: { body: { contains: "Meeting intelligence personal facts" }, personId: fx.recordsA.person.id, workspaceId: fx.workspaceA.id }
      })
    ).resolves.toBeTruthy();
    await expect(
      fx.prisma.note.findFirst({
        where: {
          body: { contains: "Meeting intelligence company facts" },
          organizationId: fx.recordsA.organization.id,
          workspaceId: fx.workspaceA.id
        }
      })
    ).resolves.toBeTruthy();
    await expect(
      fx.prisma.note.findFirst({
        where: { body: { contains: "Meeting intelligence deal facts" }, dealId: fx.recordsA.deal.id, workspaceId: fx.workspaceA.id }
      })
    ).resolves.toBeTruthy();
    await expect(
      fx.prisma.note.findFirst({
        where: { body: { contains: "Meeting intelligence lead facts" }, leadId: fx.recordsA.lead.id, workspaceId: fx.workspaceA.id }
      })
    ).resolves.toBeTruthy();
    const meeting = await fx.prisma.activity.findFirstOrThrow({
      where: { dealId: fx.recordsA.deal.id, title: { contains: "Meeting:" }, type: "MEETING", workspaceId: fx.workspaceA.id }
    });
    expect(meeting.completedAt?.toISOString()).toBe("2030-04-10T00:00:00.000Z");
    expect(meeting.description).toContain("Associated CRM records:");
    expect(meeting.description).toContain(`Contact: ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}`);
    const meetingAssociations = await fx.prisma.meetingActivityAssociation.findMany({
      where: { activityId: meeting.id, workspaceId: fx.workspaceA.id },
      orderBy: { createdAt: "asc" }
    });
    expect(meetingAssociations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dealId: fx.recordsA.deal.id }),
        expect.objectContaining({ organizationId: fx.recordsA.organization.id }),
        expect.objectContaining({ personId: fx.recordsA.person.id })
      ])
    );
    const organizationTimeline = await getRecordTimeline(fx.actorA, { type: "ORGANIZATION", id: fx.recordsA.organization.id });
    const associatedMeetingTimelineItem = organizationTimeline.find((item) => item.type === "activity" && item.activityId === meeting.id);
    expect(associatedMeetingTimelineItem).toMatchObject({
      associationLabels: expect.arrayContaining([
        `Deal: ${fx.recordsA.deal.title}`,
        `Organization: ${fx.recordsA.organization.name}`,
        `Contact: ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}`
      ]),
      type: "activity"
    });
    const followUp = await fx.prisma.activity.findFirstOrThrow({
      where: { dealId: fx.recordsA.deal.id, title: { contains: "send SOW" }, type: "TASK", workspaceId: fx.workspaceA.id }
    });
    expect(followUp.dueAt?.toISOString()).toBe("2030-04-15T00:00:00.000Z");
    expect(followUp.description).toContain("Source: Meeting Intelligence next-step activity.");
    expect(followUp.description).toContain("Source: Action: send SOW by 2030-04-15.");
    await expect(
      fx.prisma.emailLogActivityLink.count({ where: { activityId: followUp.id, workspaceId: fx.workspaceA.id } })
    ).resolves.toBe(0);

    const emailLog = await fx.prisma.emailLog.create({
      data: {
        body: "Can you remind me what came out of our meeting and whether the SOW is coming?",
        dealId: fx.recordsA.deal.id,
        direction: "INBOUND",
        fromText: `${fx.recordsA.person.firstName} <${fx.recordsA.person.email}>`,
        occurredAt: new Date("2030-04-11T12:00:00.000Z"),
        personId: fx.recordsA.person.id,
        subject: "Meeting follow-up",
        toText: "sales@example.test",
        workspaceId: fx.workspaceA.id
      }
    });
    const replyContext = await buildEmailReplyContext(fx.actorA, emailLog.id);
    expect(replyContext.activities.join("\n")).toContain("Source: Meeting Intelligence next-step activity.");
    expect(replyContext.activities.join("\n")).toContain("send SOW");
    expect(replyContext.meetingSummaries.join("\n")).toContain("Action: send SOW by 2030-04-15.");

    const completedFollowUp = await updateActivity(fx.actorA, followUp.id, {
      completedAt: new Date("2030-04-12T12:00:00.000Z")
    });
    expect(completedFollowUp.completedAt?.toISOString()).toBe("2030-04-12T12:00:00.000Z");
  });

  it("hydrates, edits, and merges approved Relationship Brief updates without mutating before apply", async () => {
    const fx = currentFixture();
    await fx.prisma.person.update({
      where: { id: fx.recordsA.person.id },
      data: {
        relationshipPersonalContext:
          "Existing relationship context.\n\nAlpha Contact is a Rockies fan and mentioned a Colorado trip with her kids."
      }
    });
    const beforeApply = await fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } });

    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-20\nAttendees: Alpha Contact",
      hints: { personIds: [fx.recordsA.person.id] },
      text: [
        "Alpha Contact is a Rockies fan and mentioned a Colorado trip with her kids.",
        "Alpha Contact prefers short, concrete follow-up emails.",
        "Alpha Contact is concerned about switching costs and implementation disruption.",
        "Next personal follow-up: ask how the Colorado trip went."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;
    const proposal = draft.relationshipBriefUpdates?.find((update) => update.target?.id === fx.recordsA.person.id);

    expect(proposal).toBeTruthy();
    expect(proposal?.existing.relationshipPersonalContext).toContain("Existing relationship context.");
    expect(proposal?.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          duplicateOfExisting: true,
          field: "relationshipPersonalContext",
          include: false
        }),
        expect.objectContaining({
          field: "relationshipCommunicationStyle",
          include: true
        }),
        expect.objectContaining({
          field: "relationshipFollowUpReminders",
          staleWarning: expect.stringContaining("stale")
        })
      ])
    );
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipPersonalContext: beforeApply.relationshipPersonalContext,
      relationshipCommunicationStyle: null,
      relationshipFollowUpReminders: null
    });

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: false } : null,
      notes: draft.notes.map((note) => ({ ...note, include: false })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: false })),
      relationshipBriefUpdates:
        draft.relationshipBriefUpdates?.map((update) => ({
          ...update,
          include: update.target?.id === fx.recordsA.person.id,
          facts: update.facts?.map((fact) => ({
            ...fact,
            include:
              update.target?.id === fx.recordsA.person.id &&
              fact.include &&
              fact.field !== "relationshipPersonalContext" &&
              fact.field !== "relationshipFollowUpReminders",
            text:
              fact.field === "relationshipCommunicationStyle"
                ? "Edited: prefers concise follow-up emails with concrete next steps."
                : fact.text
          }))
        })) ?? []
    });

    expect(result.created).toEqual([
      expect.objectContaining({
        href: `/contacts/${fx.recordsA.person.id}`,
        type: "relationship_brief"
      })
    ]);
    expect(result.relationshipBriefChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "relationshipBusinessConcerns",
          fieldLabel: "Business concerns",
          previousValue: null,
          newValue: expect.stringContaining("switching costs"),
          source: expect.objectContaining({
            intakeId: intake.id,
            type: "meeting_intelligence"
          }),
          target: expect.objectContaining({
            id: fx.recordsA.person.id,
            type: "person"
          })
        }),
        expect.objectContaining({
          field: "relationshipCommunicationStyle",
          previousValue: null,
          newValue: "Edited: prefers concise follow-up emails with concrete next steps.",
          acceptedFactCount: 1
        })
      ])
    );
    expect(result.relationshipBriefChanges?.some((change) => change.field === "relationshipPersonalContext")).toBe(false);
    const relationshipAuditLog = await fx.prisma.auditLog.findFirstOrThrow({
      where: { action: "person.updated", entityId: fx.recordsA.person.id, entityType: "Person", workspaceId: fx.workspaceA.id },
      orderBy: { createdAt: "desc" }
    });
    expect(relationshipAuditLog.metadata).toMatchObject({
      relationshipBriefChanges: expect.arrayContaining([
        expect.objectContaining({
          field: "relationshipBusinessConcerns",
          previousValue: null,
          newValue: expect.stringContaining("switching costs")
        })
      ]),
      source: {
        intakeId: intake.id,
        title: expect.any(String),
        type: "meeting_intelligence"
      }
    });
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipBusinessConcerns: expect.stringContaining("switching costs"),
      relationshipCommunicationStyle: "Edited: prefers concise follow-up emails with concrete next steps.",
      relationshipFollowUpReminders: null,
      relationshipPersonalContext:
        "Existing relationship context.\n\nAlpha Contact is a Rockies fan and mentioned a Colorado trip with her kids."
    });
    await expect(applyMeetingIntake(fx.actorA, intake.id, {})).resolves.toEqual(result);
  });

  it("applies retargeted Relationship Brief updates to the newly selected contact only", async () => {
    const fx = currentFixture();
    const alternatePerson = await fx.prisma.person.create({
      data: {
        email: "retarget-alpha-alt@example.test",
        firstName: "Retarget",
        lastName: "Contact",
        relationshipPersonalContext: "Alpha Contact is a Rockies fan and mentioned a Colorado trip with her kids.",
        workspaceId: fx.workspaceA.id
      }
    });
    const originalBefore = await fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } });
    const originalRelationshipAuditCountBefore = await fx.prisma.auditLog.count({
      where: {
        action: "person.updated",
        entityId: fx.recordsA.person.id,
        entityType: "Person",
        metadata: { path: ["relationshipBriefChanges"], not: Prisma.DbNull },
        workspaceId: fx.workspaceA.id
      }
    });

    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-22\nAttendees: Alpha Contact",
      hints: { personIds: [fx.recordsA.person.id] },
      text: [
        "Alpha Contact is a Rockies fan and mentioned a Colorado trip with her kids.",
        "Alpha Contact prefers short, concrete follow-up emails.",
        "Alpha Contact is concerned about switching costs and implementation disruption."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;
    const proposal = draft.relationshipBriefUpdates?.find((update) => update.target?.id === fx.recordsA.person.id);

    expect(proposal).toBeTruthy();
    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: false } : null,
      notes: draft.notes.map((note) => ({ ...note, include: false })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: false })),
      relationshipBriefUpdates: draft.relationshipBriefUpdates?.map((update) => ({
        ...update,
        include: update.id === proposal?.id,
        target: { id: alternatePerson.id, label: "Retarget Contact", type: "person" },
        facts: update.facts?.map((fact) => ({ ...fact, include: update.id === proposal?.id }))
      })) ?? []
    });

    expect(result.created).toEqual([
      expect.objectContaining({
        href: `/contacts/${alternatePerson.id}`,
        type: "relationship_brief"
      })
    ]);
    expect(result.relationshipBriefChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "relationshipBusinessConcerns",
          target: expect.objectContaining({ id: alternatePerson.id, type: "person" })
        }),
        expect.objectContaining({
          field: "relationshipCommunicationStyle",
          target: expect.objectContaining({ id: alternatePerson.id, type: "person" })
        })
      ])
    );
    expect(result.relationshipBriefChanges?.every((change) => change.target.id === alternatePerson.id)).toBe(true);
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipBusinessConcerns: originalBefore.relationshipBusinessConcerns,
      relationshipCommunicationStyle: originalBefore.relationshipCommunicationStyle,
      relationshipPersonalContext: originalBefore.relationshipPersonalContext
    });
    await expect(
      fx.prisma.auditLog.count({
        where: {
          action: "person.updated",
          entityId: fx.recordsA.person.id,
          entityType: "Person",
          metadata: { path: ["relationshipBriefChanges"], not: Prisma.DbNull },
          workspaceId: fx.workspaceA.id
        }
      })
    ).resolves.toBe(originalRelationshipAuditCountBefore);
    const retargetAuditLog = await fx.prisma.auditLog.findFirstOrThrow({
      where: { action: "person.updated", entityId: alternatePerson.id, entityType: "Person", workspaceId: fx.workspaceA.id },
      orderBy: { createdAt: "desc" }
    });
    expect(retargetAuditLog.metadata).toMatchObject({
      relationshipBriefChanges: expect.arrayContaining([
        expect.objectContaining({
          target: expect.objectContaining({ id: alternatePerson.id }),
          source: expect.objectContaining({ intakeId: intake.id, type: "meeting_intelligence" })
        })
      ])
    });
    const alternateAfter = await fx.prisma.person.findUniqueOrThrow({ where: { id: alternatePerson.id } });
    expect(alternateAfter).toMatchObject({
      relationshipBusinessConcerns: expect.stringContaining("switching costs"),
      relationshipCommunicationStyle: expect.stringContaining("short, concrete follow-up emails")
    });
    expect(alternateAfter.relationshipPersonalContext).toContain(
      "Alpha Contact is a Rockies fan and mentioned a Colorado trip with her kids."
    );
    expect(alternateAfter.relationshipPersonalContext?.match(/Rockies fan/g)).toHaveLength(1);
  });

  it("enriches Relationship Brief proposals with a semantic provider while preserving review-first apply", async () => {
    const fx = currentFixture();
    const beforeApply = await fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } });
    const intake = await createMeetingIntake(
      fx.actorA,
      {
        contextText: "Meeting date: 2030-04-21\nAttendees: Alpha Contact",
        hints: { personIds: [fx.recordsA.person.id] },
        text: [
          "Alpha Contact mentioned taking her kids to Colorado.",
          "Alpha Contact prefers concise follow-up emails with clear next steps.",
          "Alpha Contact is worried about implementation disruption."
        ].join("\n")
      },
      {
        relationshipBriefProvider: {
          id: "semantic-test",
          name: "Semantic test relationship provider",
          async extract(input) {
            expect(input.contacts).toEqual([
              expect.objectContaining({
                id: fx.recordsA.person.id,
                label: "Alpha Contact"
              })
            ]);
            return {
              proposals: [
                {
                  confidence: "high",
                  evidence: ["Alpha Contact mentioned taking her kids to Colorado."],
                  existing: {},
                  facts: [
                    {
                      field: "relationshipPersonalContext",
                      id: "semantic-fact-personal",
                      include: true,
                      sensitivity: [
                        {
                          category: "safe_personalization",
                          field: "relationshipPersonalContext",
                          guidance: "Use lightly for rapport."
                        }
                      ],
                      text: "Mentioned taking her kids to Colorado."
                    },
                    {
                      field: "relationshipCommunicationStyle",
                      id: "semantic-fact-style",
                      include: true,
                      text: "Prefers concise follow-up emails with clear next steps."
                    },
                    {
                      field: "relationshipBusinessConcerns",
                      id: "semantic-fact-concern",
                      include: true,
                      text: "Concerned about implementation disruption."
                    },
                    {
                      field: "relationshipFollowUpReminders",
                      id: "semantic-fact-reminder",
                      include: true,
                      text: "Ask how the Colorado trip went."
                    },
                    {
                      field: "relationshipInternalGuidance",
                      id: "semantic-fact-guidance",
                      include: true,
                      sensitivity: [
                        {
                          category: "use_cautiously",
                          field: "relationshipInternalGuidance",
                          guidance: "Keep personalization subtle."
                        }
                      ],
                      text: "Use the Colorado detail naturally; avoid overdoing personal references."
                    }
                  ],
                  id: "semantic-alpha-contact",
                  include: true,
                  matchedReason: "Semantic contact relationship extraction",
                  proposed: {
                    relationshipBusinessConcerns: "Concerned about implementation disruption.",
                    relationshipCommunicationStyle: "Prefers concise follow-up emails with clear next steps.",
                    relationshipFollowUpReminders: "Ask how the Colorado trip went.",
                    relationshipInternalGuidance: "Use the Colorado detail naturally; avoid overdoing personal references.",
                    relationshipPersonalContext: "Mentioned taking her kids to Colorado."
                  },
                  providerId: "semantic-test",
                  providerName: "Semantic test relationship provider",
                  sensitivity: [
                    {
                      category: "safe_personalization",
                      field: "relationshipPersonalContext",
                      guidance: "Use lightly for rapport."
                    },
                    {
                      category: "use_cautiously",
                      field: "relationshipInternalGuidance",
                      guidance: "Keep personalization subtle."
                    }
                  ],
                  target: { id: fx.recordsA.person.id, label: "Alpha Contact", type: "person" },
                  warnings: ["Review for tone before saving."]
                }
              ],
              warnings: ["Semantic provider returned review cautions."]
            };
          }
        }
      }
    );
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;
    const analysis = intake.analysisJson as Record<string, unknown>;
    const proposal = draft.relationshipBriefUpdates?.find((update) => update.target?.id === fx.recordsA.person.id);

    expect(analysis.relationshipSemanticExtraction).toMatchObject({
      providerId: "semantic-test",
      status: "succeeded"
    });
    expect(proposal).toMatchObject({
      providerId: "semantic-test",
      providerName: "Semantic test relationship provider",
      facts: expect.arrayContaining([
        expect.objectContaining({
          field: "relationshipPersonalContext",
          sensitivity: expect.arrayContaining([expect.objectContaining({ category: "safe_personalization" })])
        }),
        expect.objectContaining({
          field: "relationshipFollowUpReminders",
          staleWarning: expect.stringContaining("stale")
        })
      ]),
      proposed: {
        relationshipBusinessConcerns: expect.stringContaining("implementation disruption"),
        relationshipCommunicationStyle: expect.stringContaining("concise follow-up emails"),
        relationshipFollowUpReminders: expect.stringContaining("Colorado trip"),
        relationshipInternalGuidance: expect.stringContaining("avoid overdoing"),
        relationshipPersonalContext: expect.stringContaining("kids to Colorado")
      },
      sensitivity: expect.arrayContaining([
        expect.objectContaining({ category: "safe_personalization" }),
        expect.objectContaining({ category: "use_cautiously" })
      ]),
      warnings: ["Review for tone before saving."]
    });
    expect(proposal?.mergedPreview?.relationshipPersonalContext).toContain("kids to Colorado");
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipPersonalContext: beforeApply.relationshipPersonalContext
    });

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: false } : null,
      notes: draft.notes.map((note) => ({ ...note, include: false })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: false })),
      relationshipBriefUpdates: draft.relationshipBriefUpdates?.map((update) => ({ ...update, include: true })) ?? []
    });

    expect(result.created).toEqual([expect.objectContaining({ type: "relationship_brief" })]);
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipBusinessConcerns: expect.stringContaining("implementation disruption"),
      relationshipCommunicationStyle: expect.stringContaining("concise follow-up emails"),
      relationshipFollowUpReminders: expect.stringContaining("Colorado trip"),
      relationshipInternalGuidance: expect.stringContaining("avoid overdoing"),
      relationshipPersonalContext: expect.stringContaining("kids to Colorado")
    });
  });

  it("keeps deterministic Relationship Brief proposals when semantic extraction fails", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(
      fx.actorA,
      {
        hints: { personIds: [fx.recordsA.person.id] },
        text: "Alpha Contact prefers concise email follow-up and is a Rockies fan."
      },
      {
        relationshipBriefProvider: {
          id: "semantic-failure-test",
          name: "Semantic failure test provider",
          async extract() {
            throw new Error("semantic provider unavailable");
          }
        }
      }
    );
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;

    expect(intake.status).toBe("READY_FOR_REVIEW");
    expect(intake.analysisJson).toMatchObject({
      relationshipSemanticExtraction: {
        providerId: "semantic-failure-test",
        status: "failed_fallback"
      }
    });
    expect(draft.relationshipBriefUpdates?.[0]).toMatchObject({
      target: { id: fx.recordsA.person.id, type: "person" }
    });
    expect(draft.relationshipBriefUpdates?.[0]).not.toHaveProperty("providerId");
    expect(draft.warnings).toContain("semantic provider unavailable");
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipCommunicationStyle: null,
      relationshipPersonalContext: null
    });
  });

  it("does not update the contact Relationship Brief when the proposal is rejected", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      hints: { personIds: [fx.recordsA.person.id] },
      text: "Alpha Contact prefers short email follow-up and is a Rockies fan."
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: false } : null,
      notes: draft.notes.map((note) => ({ ...note, include: false })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: false })),
      relationshipBriefUpdates: draft.relationshipBriefUpdates?.map((update) => ({ ...update, include: false })) ?? []
    });

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "Not selected for apply.", type: "relationship_brief" })])
    );
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      relationshipCommunicationStyle: null,
      relationshipPersonalContext: null
    });
  });

  it("preserves closed-deal locks when applying an approved draft after review", async () => {
    const fx = currentFixture();
    const deal = await fx.prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        title: "Meeting intelligence lock regression deal",
        valueCents: 50000,
        currency: "USD"
      }
    });

    try {
      const intake = await createMeetingIntake(fx.actorA, {
        contextText: "Meeting date: 2030-04-02",
        hints: { dealId: deal.id },
        text: [
          `${deal.title} needs a recap and follow-up.`,
          "Action: send implementation recap by 2030-04-06."
        ].join("\n")
      });
      const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;
      const lockedTarget = { id: deal.id, label: deal.title, type: "deal" as const };
      const noteCountBefore = await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id, dealId: deal.id } });
      const activityCountBefore = await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id, dealId: deal.id } });

      await fx.prisma.deal.update({
        where: { id: deal.id },
        data: {
          lostAt: new Date("2030-04-03T00:00:00.000Z"),
          status: "LOST"
        }
      });

      const result = await applyMeetingIntake(fx.actorA, intake.id, {
        meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true, target: lockedTarget } : null,
        notes: draft.notes.map((note) => ({ ...note, include: true, target: lockedTarget })),
        nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: true, target: lockedTarget }))
      });
      const applied = await fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: intake.id } });

      expect(result.created).toEqual([]);
      expect(result.skipped.length).toBeGreaterThanOrEqual(2);
      expect(result.skipped.every((item) => item.reason.includes("Closed deals cannot be edited."))).toBe(true);
      expect(applied.status).toBe("APPLIED");
      await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id, dealId: deal.id } })).resolves.toBe(
        noteCountBefore
      );
      await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id, dealId: deal.id } })).resolves.toBe(
        activityCountBefore
      );
    } finally {
      await fx.prisma.activity.deleteMany({ where: { workspaceId: fx.workspaceA.id, dealId: deal.id } });
      await fx.prisma.note.deleteMany({ where: { workspaceId: fx.workspaceA.id, dealId: deal.id } });
      await fx.prisma.deal.deleteMany({ where: { id: deal.id } });
    }
  });

  it("applies manually reassigned proposal targets inside the same workspace", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-04",
      hints: { dealId: fx.recordsA.deal.id },
      text: [
        `${fx.recordsA.deal.title} needs implementation support.`,
        "Current WMS has inventory pain.",
        "Action: send SOW by 2030-04-08."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;
    const reassignedTarget = { id: fx.recordsA.organization.id, label: fx.recordsA.organization.name, type: "organization" as const };

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: false } : null,
      notes: draft.notes.map((note, index) => ({
        ...note,
        body: index === 0 ? "Manual reassigned meeting note body" : note.body,
        include: index === 0,
        target: reassignedTarget
      })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: false }))
    });

    expect(result.created.filter((item) => item.type === "note")).toHaveLength(1);
    await expect(
      fx.prisma.note.findFirst({
        where: {
          body: "Manual reassigned meeting note body",
          organizationId: fx.recordsA.organization.id,
          workspaceId: fx.workspaceA.id
        }
      })
    ).resolves.toBeTruthy();
  });

  it("skips manually submitted targets outside the current workspace", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-05",
      hints: { dealId: fx.recordsA.deal.id, personIds: [fx.recordsA.person.id] },
      text: [
        `${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} prefers concise email follow-up.`,
        `${fx.recordsA.deal.title} needs a recap.`,
        "Current WMS has integration risk.",
        "Action: send recap by 2030-04-09."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;
    const foreignDealTarget = { id: fx.recordsB.deal.id, label: fx.recordsB.deal.title, type: "deal" as const };
    const foreignOrganizationTarget = {
      id: fx.recordsB.organization.id,
      label: fx.recordsB.organization.name,
      type: "organization" as const
    };
    const foreignPersonTarget = { id: fx.recordsB.person.id, label: "Beta Contact", type: "person" as const };

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true, target: foreignDealTarget } : null,
      notes: draft.notes.map((note) => ({ ...note, include: true, target: foreignOrganizationTarget })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: true, target: foreignDealTarget })),
      relationshipBriefUpdates: draft.relationshipBriefUpdates?.map((update) => ({
        ...update,
        include: true,
        target: foreignPersonTarget
      })) ?? []
    });

    expect(result.created).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped.every((item) => item.reason === "Selected target is not available in this workspace.")).toBe(true);
  });

  it("skips approved updates when review removes the target", async () => {
    const fx = currentFixture();
    const noteCountBefore = await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } });
    const activityCountBefore = await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } });
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-06",
      hints: { dealId: fx.recordsA.deal.id },
      text: [
        `${fx.recordsA.deal.title} needs a recap and SOW review.`,
        "Action: send recap by 2030-04-10."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true, target: null } : null,
      notes: draft.notes.map((note) => ({ ...note, include: true, target: null })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: true, target: null }))
    });

    expect(result.created).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped.every((item) => item.reason === "No target record was selected.")).toBe(true);
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(noteCountBefore);
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(activityCountBefore);
  });

  it("stores reviewed meeting associations and skips unavailable association targets without dropping the meeting log", async () => {
    const fx = currentFixture();
    const foreignDealTarget = { id: fx.recordsB.deal.id, label: fx.recordsB.deal.title, type: "deal" as const };
    const convertedLeadTarget = { id: fx.recordsA.lead.id, label: fx.recordsA.lead.title, type: "lead" as const };
    const organizationTarget = {
      id: fx.recordsA.organization.id,
      label: fx.recordsA.organization.name,
      type: "organization" as const
    };
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-12",
      hints: { dealId: fx.recordsA.deal.id, organizationId: fx.recordsA.organization.id },
      text: [
        `${fx.recordsA.deal.title} and ${fx.recordsA.organization.name} reviewed budget and implementation risk.`,
        "Action: send recap by 2030-04-16."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;

    try {
      await fx.prisma.lead.update({ where: { id: fx.recordsA.lead.id }, data: { status: "CONVERTED" } });
      const result = await applyMeetingIntake(fx.actorA, intake.id, {
        meetingActivity: draft.meetingActivity
          ? {
              ...draft.meetingActivity,
              associatedTargets: [organizationTarget, convertedLeadTarget, foreignDealTarget],
              include: true,
              target: { id: fx.recordsA.deal.id, label: fx.recordsA.deal.title, type: "deal" as const }
            }
          : null,
        notes: draft.notes.map((note) => ({ ...note, include: false })),
        nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: false }))
      });

      const meeting = await fx.prisma.activity.findFirstOrThrow({
        where: { dealId: fx.recordsA.deal.id, title: { contains: "Meeting:" }, type: "MEETING", workspaceId: fx.workspaceA.id }
      });
      const associations = await fx.prisma.meetingActivityAssociation.findMany({
        where: { activityId: meeting.id, workspaceId: fx.workspaceA.id }
      });

      expect(result.created.filter((item) => item.id === meeting.id && item.type === "activity")).toHaveLength(1);
      expect(result.skipped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reason: "Converted leads are locked. Add new context on the converted deal." }),
          expect.objectContaining({ reason: "Selected target is not available in this workspace." })
        ])
      );
      expect(associations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dealId: fx.recordsA.deal.id }),
          expect.objectContaining({ organizationId: fx.recordsA.organization.id })
        ])
      );
      expect(associations.some((association) => association.leadId === fx.recordsA.lead.id)).toBe(false);
      expect(associations.some((association) => association.dealId === fx.recordsB.deal.id)).toBe(false);
    } finally {
      await fx.prisma.lead.update({ where: { id: fx.recordsA.lead.id }, data: { status: "NEW" } });
    }
  });

  it("skips converted lead targets reintroduced during review", async () => {
    const fx = currentFixture();
    const convertedLeadTarget = { id: fx.recordsA.lead.id, label: fx.recordsA.lead.title, type: "lead" as const };
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-07",
      hints: { dealId: fx.recordsA.deal.id },
      text: [
        `${fx.recordsA.deal.title} needs follow-up before legal approval.`,
        "Action: send legal checklist by 2030-04-11."
      ].join("\n")
    });
    const draft = intake.proposedChangesJson as unknown as MeetingIntelligenceDraft;

    try {
      await fx.prisma.lead.update({ where: { id: fx.recordsA.lead.id }, data: { status: "CONVERTED" } });
      const result = await applyMeetingIntake(fx.actorA, intake.id, {
        meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true, target: convertedLeadTarget } : null,
        notes: draft.notes.map((note) => ({ ...note, include: true, target: convertedLeadTarget })),
        nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: true, target: convertedLeadTarget }))
      });

      expect(result.created).toEqual([]);
      expect(result.skipped.length).toBeGreaterThan(0);
      expect(result.skipped.every((item) => item.reason.includes("Converted leads are locked"))).toBe(true);
    } finally {
      await fx.prisma.lead.update({ where: { id: fx.recordsA.lead.id }, data: { status: "NEW" } });
    }
  });

  it("does not leak cross-workspace matches into proposals", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      text: `Discussed ${fx.recordsB.deal.title} with ${fx.recordsB.organization.name}.`
    });

    expect(JSON.stringify(intake.proposedChangesJson)).not.toContain(fx.recordsB.deal.id);
    expect(JSON.stringify(intake.proposedChangesJson)).not.toContain(fx.recordsB.organization.id);
  });

  it("extracts a text-based PDF into a reviewable intake", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      fileBase64: pdfFixtureBase64,
      hints: { dealId: fx.recordsA.deal.id },
      originalFilename: "discovery.pdf",
      originalMimeType: "application/pdf"
    });

    expect(intake.errorMessage).toBeNull();
    expect(intake.status).toBe("READY_FOR_REVIEW");
    expect(intake.rawText).toContain("Action: send SOW by 2030-04-05.");
    expect(intake.markdownText).toContain("- Pages: 1");
    expect(intake.markdownText).toContain("- Conversion: Local");
    expect(intake.analysisJson).toMatchObject({
      processorStatus: {
        capability: "supported",
        conversionMode: "local",
        extractionMethod: "local-pdf",
        originalFilename: "discovery.pdf",
        sourceType: "pdf"
      }
    });
  });

  it.each([
    [
      "meeting.rtf",
      "application/rtf",
      "{\\rtf1\\ansi Meeting date: 2030-04-01\\par Action: send SOW by 2030-04-05.}",
      "rtf",
      "local-rtf",
      "Action: send SOW by 2030-04-05."
    ],
    [
      "meeting.html",
      "text/html",
      "<html><body><h1>Discovery Recap</h1><p>Action: send SOW by 2030-04-05.</p></body></html>",
      "html",
      "local-html",
      "# Discovery Recap"
    ],
    [
      "actions.csv",
      "text/csv",
      "Owner,Action,Due\nSam,send SOW,2030-04-05",
      "csv",
      "local-csv",
      "| Sam | send SOW | 2030-04-05 |"
    ],
    [
      "meeting.json",
      "application/json",
      JSON.stringify({ action_items: [{ due: "2030-04-05", owner: "Sam", task: "send SOW" }], meeting_date: "2030-04-01" }),
      "json",
      "local-json",
      "| due | owner | task |"
    ]
  ])("extracts %s into a reviewable intake without mutating CRM records", async (
    filename,
    mimeType,
    fileText,
    sourceType,
    extractionMethod,
    expectedMarkdown
  ) => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-01\nAttendees: Alpha Contact",
      fileText,
      hints: { dealId: fx.recordsA.deal.id },
      originalFilename: filename,
      originalMimeType: mimeType
    });

    expect(intake.errorMessage).toBeNull();
    expect(intake.status).toBe("READY_FOR_REVIEW");
    expect(intake.markdownText).toContain("## User Context");
    expect(intake.markdownText).toContain("Attendees: Alpha Contact");
    expect(intake.markdownText).toContain(expectedMarkdown);
    expect(intake.analysisJson).toMatchObject({
      processorStatus: {
        capability: "supported",
        conversionMode: "local",
        extractionMethod,
        originalFilename: filename,
        originalMimeType: mimeType,
        sourceType
      }
    });
    await expect(crmMutationCounts(fx)).resolves.toEqual(before);
  });

  it("queues provider-configured image extraction and turns provider text into a reviewable proposal without CRM mutation", async () => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    const mediaBase64 = Buffer.from("fake-whiteboard-image").toString("base64");

    await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
      vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          fileBase64: mediaBase64,
          filename: "whiteboard.png",
          mimeType: "image/png",
          sourceType: "image"
        });
        return Response.json({
          text: [
            `Whiteboard notes for ${fx.recordsA.deal.title}.`,
            "Current WMS has inventory pain.",
            "Action: send SOW by 2030-04-05."
          ].join("\n"),
          warnings: ["OCR confidence medium."]
        });
      });

      const intake = await createMeetingIntake(fx.actorA, {
        contextText: "Meeting date: 2030-04-01\nAttendees: Alpha Contact",
        fileBase64: mediaBase64,
        hints: { dealId: fx.recordsA.deal.id },
        originalFilename: "whiteboard.png",
        originalMimeType: "image/png"
      });

      expect(intake.status).toBe("EXTRACTING");
      expect(intake.analysisJson).toMatchObject({
        processorStatus: {
          capability: "provider_required",
          conversionMode: "provider_required",
          extractionMethod: "provider-required",
          message: "Queued for Configured media extraction provider extraction.",
          storedFile: {
            backend: "local-filesystem",
            byteLength: Buffer.byteLength("fake-whiteboard-image"),
            sourceType: "image"
          },
          sourceType: "image"
        },
        providerReadiness: {
          configured: true,
          providerId: "provider-http"
        }
      });
      await expect(fx.prisma.job.count({ where: { workspaceId: fx.workspaceA.id, status: JobStatus.PENDING } })).resolves.toBe(1);
      const job = await fx.prisma.job.findFirstOrThrow({
        where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" }
      });
      const jobPayload = job.payload as Record<string, unknown>;
      expect(jobPayload.fileBase64).toBeUndefined();
      expect(jobPayload).toMatchObject({
        storedFile: {
          backend: "local-filesystem",
          byteLength: Buffer.byteLength("fake-whiteboard-image"),
          sourceType: "image",
          workspaceId: fx.workspaceA.id
        }
      });
      expect(JSON.stringify(job.payload)).not.toContain(mediaBase64);
      await expect(crmMutationCounts(fx)).resolves.toEqual(before);

      await expect(runMeetingMediaJobOnce(fx, "meeting-media-test")).resolves.toMatchObject({
        claimed: 1,
        failed: 0,
        succeeded: 1
      });
      const reloaded = await fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: intake.id } });
      const draft = reloaded.proposedChangesJson as unknown as MeetingIntelligenceDraft;

      expect(reloaded.status).toBe("READY_FOR_REVIEW");
      expect(reloaded.errorMessage).toBeNull();
      expect(reloaded.rawText).toContain("Action: send SOW by 2030-04-05.");
      expect(reloaded.markdownText).toContain("## User Context");
      expect(reloaded.markdownText).toContain("- Provider: Configured media extraction provider");
      expect(draft.sourceMetadata).toMatchObject({
        extractionMethod: "provider-ocr",
        providerId: "provider-http",
        providerName: "Configured media extraction provider",
        sourceType: "image"
      });
      expect(draft.warnings).toContain("OCR confidence medium.");
      expect(JSON.stringify(draft.matchedObjects)).toContain(fx.recordsA.deal.id);
      await expect(crmMutationCounts(fx)).resolves.toEqual(before);
    });
  });

  it("queues provider-backed extraction through S3-compatible storage and lets the worker retrieve the object", async () => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    const mediaBase64 = Buffer.from("s3-whiteboard-image").toString("base64");
    const s3 = mockS3Storage();

    await withS3StorageEnv(async () => {
      await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
        vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
          const url = requestUrl(input);
          if (url.hostname === "s3.example.test") return s3.handle(input, init);
          if (url.hostname !== "provider.example.test") return new Response(null, { status: 404 });

          const body = JSON.parse(String(init?.body));
          expect(body).toMatchObject({
            fileBase64: mediaBase64,
            filename: "whiteboard-s3.png",
            mimeType: "image/png",
            sourceType: "image"
          });
          return Response.json({
            text: [
              `S3 whiteboard notes for ${fx.recordsA.deal.title}.`,
              "Current WMS has inventory pain.",
              "Action: send SOW by 2030-04-05."
            ].join("\n")
          });
        });

        const intake = await createMeetingIntake(fx.actorA, {
          contextText: "Meeting date: 2030-04-01\nAttendees: Alpha Contact",
          fileBase64: mediaBase64,
          hints: { dealId: fx.recordsA.deal.id },
          originalFilename: "whiteboard-s3.png",
          originalMimeType: "image/png"
        });

        expect(intake.status).toBe("EXTRACTING");
        expect(intake.analysisJson).toMatchObject({
          processorStatus: {
            storedFile: {
              backend: "s3-compatible",
              byteLength: Buffer.byteLength("s3-whiteboard-image"),
              sourceType: "image"
            }
          }
        });
        const job = await fx.prisma.job.findFirstOrThrow({
          where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" }
        });
        const jobPayload = job.payload as Record<string, unknown>;
        const storedFile = jobPayload.storedFile as { key: string };
        expect(jobPayload.fileBase64).toBeUndefined();
        expect(jobPayload).toMatchObject({
          storedFile: {
            backend: "s3-compatible",
            sourceType: "image",
            workspaceId: fx.workspaceA.id
          }
        });
        expect(JSON.stringify(job.payload)).not.toContain(mediaBase64);
        expect(s3.objects.has(`${storedFile.key}/content.bin`)).toBe(true);
        await expect(crmMutationCounts(fx)).resolves.toEqual(before);

        await expect(runMeetingMediaJobOnce(fx, "meeting-media-s3-test")).resolves.toMatchObject({
          claimed: 1,
          failed: 0,
          succeeded: 1
        });
        expect(s3.objects.has(`${storedFile.key}/content.bin`)).toBe(false);
        expect(s3.objects.has(`${storedFile.key}/metadata.json`)).toBe(false);
        const reloaded = await fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: intake.id } });
        expect(reloaded.status).toBe("READY_FOR_REVIEW");
        expect(reloaded.rawText).toContain("Action: send SOW by 2030-04-05.");
        await expect(crmMutationCounts(fx)).resolves.toEqual(before);
      });
    });
  });

  it("queues provider-configured scanned PDF OCR and turns provider text into a reviewable proposal without CRM mutation", async () => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);

    await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
      vi.stubGlobal("fetch", async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          fileBase64: scannedPdfFixtureBase64,
          filename: "scanned-discovery.pdf",
          mimeType: "application/pdf",
          sourceType: "pdf"
        });
        return Response.json({
          text: [
            `Scanned PDF notes for ${fx.recordsA.deal.title}.`,
            "Current WMS has inventory pain.",
            "Action: send SOW by 2030-04-05."
          ].join("\n"),
          warnings: ["Scanned PDF OCR confidence medium."]
        });
      });

      const intake = await createMeetingIntake(fx.actorA, {
        contextText: "Meeting date: 2030-04-01\nAttendees: Alpha Contact",
        fileBase64: scannedPdfFixtureBase64,
        hints: { dealId: fx.recordsA.deal.id },
        originalFilename: "scanned-discovery.pdf",
        originalMimeType: "application/pdf"
      });

      expect(intake.status).toBe("EXTRACTING");
      expect(intake.analysisJson).toMatchObject({
        processorStatus: {
          capability: "provider_required",
          conversionMode: "provider_required",
          extractionMethod: "provider-required",
          requiredProvider: "ocr_or_vision",
          storedFile: {
            backend: "local-filesystem",
            sourceType: "pdf"
          },
          sourceType: "pdf"
        },
        providerReadiness: {
          configured: true,
          providerId: "provider-http",
          supportedSourceTypes: expect.arrayContaining(["pdf"])
        }
      });
      await expect(fx.prisma.job.count({ where: { workspaceId: fx.workspaceA.id, status: JobStatus.PENDING } })).resolves.toBe(1);
      const job = await fx.prisma.job.findFirstOrThrow({
        where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" }
      });
      const jobPayload = job.payload as Record<string, unknown>;
      expect(jobPayload.fileBase64).toBeUndefined();
      expect(jobPayload).toMatchObject({
        storedFile: {
          backend: "local-filesystem",
          sourceType: "pdf",
          workspaceId: fx.workspaceA.id
        }
      });
      expect(JSON.stringify(job.payload)).not.toContain(scannedPdfFixtureBase64);
      await expect(crmMutationCounts(fx)).resolves.toEqual(before);

      await expect(runMeetingMediaJobOnce(fx, "meeting-scanned-pdf-test")).resolves.toMatchObject({
        claimed: 1,
        failed: 0,
        succeeded: 1
      });
      const reloaded = await fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: intake.id } });
      const draft = reloaded.proposedChangesJson as unknown as MeetingIntelligenceDraft;

      expect(reloaded.status).toBe("READY_FOR_REVIEW");
      expect(reloaded.errorMessage).toBeNull();
      expect(reloaded.rawText).toContain("Action: send SOW by 2030-04-05.");
      expect(reloaded.markdownText).toContain("- Source type: PDF");
      expect(reloaded.markdownText).toContain("- Provider: Configured media extraction provider");
      expect(draft.sourceMetadata).toMatchObject({
        extractionMethod: "provider-ocr",
        providerId: "provider-http",
        providerName: "Configured media extraction provider",
        requiredProvider: "ocr_or_vision",
        sourceType: "pdf"
      });
      expect(draft.warnings).toContain("Scanned PDF OCR confidence medium.");
      expect(JSON.stringify(draft.matchedObjects)).toContain(fx.recordsA.deal.id);
      await expect(crmMutationCounts(fx)).resolves.toEqual(before);
    });
  });

  it("keeps provider failures retryable through the job queue and readable on the intake", async () => {
    const fx = currentFixture();
    await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
      vi.stubGlobal("fetch", async () => {
        throw new Error("provider unavailable");
      });
      const intake = await createMeetingIntake(fx.actorA, {
        fileBase64: Buffer.from("fake-audio").toString("base64"),
        originalFilename: "call.mp3",
        originalMimeType: "audio/mpeg"
      });
      const job = await fx.prisma.job.findFirstOrThrow({ where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" } });

      await expect(runMeetingMediaJobOnce(fx, "meeting-media-provider-failure-test")).resolves.toMatchObject({
        claimed: 1,
        failed: 1,
        succeeded: 0
      });
      await expect(fx.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).resolves.toMatchObject({
        attempts: 1,
        status: JobStatus.PENDING
      });
      await expect(fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: intake.id } })).resolves.toMatchObject({
        errorMessage: "Meeting media extraction provider request failed.",
        status: "FAILED"
      });
    });
  });

  it("fails queued provider extraction clearly when the stored file is missing", async () => {
    const fx = currentFixture();
    await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const intake = await createMeetingIntake(fx.actorA, {
        fileBase64: Buffer.from("missing-file-audio").toString("base64"),
        originalFilename: "call.mp3",
        originalMimeType: "audio/mpeg"
      });
      const job = await fx.prisma.job.findFirstOrThrow({
        where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" }
      });
      const storedFile = (job.payload as { storedFile?: Parameters<typeof deleteStoredMeetingIntelligenceFile>[0] }).storedFile;
      await deleteStoredMeetingIntelligenceFile(storedFile);

      await expect(runMeetingMediaJobOnce(fx, "meeting-media-missing-file-test")).resolves.toMatchObject({
        claimed: 1,
        failed: 1,
        succeeded: 0
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      await expect(fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: intake.id } })).resolves.toMatchObject({
        errorMessage: "Stored meeting file is missing or expired. Upload the meeting artifact again.",
        status: "FAILED"
      });
    });
  });

  it("cleans expired stored provider files without deleting active extraction job files", async () => {
    const fx = currentFixture();
    const expired = await storeMeetingIntelligenceFile({
      fileBase64: Buffer.from("expired-audio").toString("base64"),
      intakeId: "expired-intake",
      now: new Date("2030-01-01T00:00:00.000Z"),
      sourceType: "audio",
      workspaceId: fx.workspaceA.id
    });
    const active = await storeMeetingIntelligenceFile({
      fileBase64: Buffer.from("active-audio").toString("base64"),
      intakeId: "active-intake",
      now: new Date("2030-01-01T00:00:00.000Z"),
      sourceType: "audio",
      workspaceId: fx.workspaceA.id
    });
    await fx.prisma.job.create({
      data: {
        maxAttempts: 3,
        payload: {
          actorUserId: fx.actorA.actorUserId,
          intakeId: "active-intake",
          sourceType: "audio",
          storedFile: active,
          workspaceId: fx.workspaceA.id
        },
        status: JobStatus.PENDING,
        type: "meeting_intake.extract_media",
        workspaceId: fx.workspaceA.id
      }
    });

    await expect(cleanupMeetingIntelligenceStoredFiles({ now: new Date("2030-01-10T00:00:00.000Z") })).resolves.toEqual({
      deleted: 1,
      failed: [],
      scanned: expect.any(Number),
      skippedActive: 1
    });
    await expect(deleteStoredMeetingIntelligenceFile(active)).resolves.toBe(true);
    await expect(deleteStoredMeetingIntelligenceFile(expired)).resolves.toBe(true);
  });

  it("processes queued audio through the internal OpenAI media route without CRM mutation before review", async () => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    const mediaBase64 = Buffer.from("fake-audio-recording").toString("base64");
    const internalRouteUrl = `http://localhost${internalMeetingMediaExtractionRoutePath}`;

    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL", internalRouteUrl);
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", "internal-media-token");
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      if (requestUrl === internalRouteUrl) {
        return handleInternalMeetingMediaExtract(new Request(requestUrl, init));
      }
      if (requestUrl === "https://api.openai.com/v1/audio/transcriptions") {
        const formData = init?.body as FormData;
        expect(formData.get("model")).toBe("gpt-4o-transcribe");
        expect(formData.get("response_format")).toBe("json");
        return Response.json({
          text: [
            `Transcript for ${fx.recordsA.deal.title}.`,
            "Current WMS has inventory pain.",
            "Action: send SOW by 2030-04-05."
          ].join("\n")
        });
      }
      throw new Error(`Unexpected fetch URL: ${requestUrl}`);
    });

    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-01\nAttendees: Alpha Contact",
      fileBase64: mediaBase64,
      hints: { dealId: fx.recordsA.deal.id },
      originalFilename: "call.mp3",
      originalMimeType: "audio/mpeg"
    });

    expect(intake.status).toBe("EXTRACTING");
    await expect(crmMutationCounts(fx)).resolves.toEqual(before);
    await expect(runMeetingMediaJobOnce(fx, "meeting-media-internal-route-test")).resolves.toMatchObject({
      claimed: 1,
      failed: 0,
      succeeded: 1
    });

    const reloaded = await fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: intake.id } });
    const draft = reloaded.proposedChangesJson as unknown as MeetingIntelligenceDraft;

    expect(reloaded.status).toBe("READY_FOR_REVIEW");
    expect(reloaded.rawText).toContain("Action: send SOW by 2030-04-05.");
    expect(reloaded.markdownText).toContain("## User Context");
    expect(draft.sourceMetadata).toMatchObject({
      extractionMethod: "provider-transcription",
      providerId: "openai",
      providerName: "OpenAI media extraction",
      sourceType: "audio"
    });
    expect(JSON.stringify(draft.matchedObjects)).toContain(fx.recordsA.deal.id);
    await expect(crmMutationCounts(fx)).resolves.toEqual(before);
  });

  it("keeps video explicitly unsupported when the internal OpenAI media provider is selected", async () => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL", `http://localhost${internalMeetingMediaExtractionRoutePath}`);
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", "internal-media-token");
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");

    const intake = await createMeetingIntake(fx.actorA, {
      fileBase64: Buffer.from("fake-video").toString("base64"),
      originalFilename: "recording.mp4",
      originalMimeType: "video/mp4"
    });

    expect(intake.status).toBe("FAILED");
    expect(intake.errorMessage).toMatch(/does not process video yet/);
    await expect(fx.prisma.job.count({ where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" } })).resolves.toBe(0);
    await expect(crmMutationCounts(fx)).resolves.toEqual(before);
  });

  it.each([
    ["review.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "pptx", /presentation parser/],
    ["tracker.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", /spreadsheet parser/]
  ])("persists unsupported %s document failures with conversion guidance and no CRM mutation", async (
    filename,
    mimeType,
    sourceType,
    errorPattern
  ) => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    const intake = await createMeetingIntake(fx.actorA, {
      originalFilename: filename,
      originalMimeType: mimeType
    });

    expect(intake.status).toBe("FAILED");
    expect(intake.errorMessage).toMatch(errorPattern);
    expect(intake.analysisJson).toMatchObject({
      processorStatus: {
        capability: "unsupported",
        conversionMode: "unsupported",
        extractionMethod: "unavailable",
        originalFilename: filename,
        originalMimeType: mimeType,
        requiredProvider: "document_conversion",
        sourceType
      }
    });
    await expect(crmMutationCounts(fx)).resolves.toEqual(before);
  });

  it.each([
    ["whiteboard.png", "image/png", "image", "ocr_or_vision", /OCR or vision provider/],
    ["call.mp3", "audio/mpeg", "audio", "transcription", /transcription provider/],
    ["recording.mp4", "video/mp4", "video", "media_processing", /media processing provider/]
  ])("persists provider-required %s failures with clear reviewable status and no CRM mutation", async (
    filename,
    mimeType,
    sourceType,
    requiredProvider,
    errorPattern
  ) => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    await withMeetingMediaProviderEnv(undefined, async () => {
      const intake = await createMeetingIntake(fx.actorA, {
        contextText: "Meeting date: 2030-04-20",
        fileBase64: Buffer.from("fake-media").toString("base64"),
        originalFilename: filename,
        originalMimeType: mimeType
      });

      expect(intake.status).toBe("FAILED");
      expect(intake.errorMessage).toMatch(errorPattern);
      expect(intake.analysisJson).toMatchObject({
        processorStatus: {
          capability: "provider_required",
          conversionMode: "provider_required",
          extractionMethod: "provider-required",
          originalFilename: filename,
          originalMimeType: mimeType,
          requiredProvider,
          sourceType
        }
      });
      await expect(crmMutationCounts(fx)).resolves.toEqual(before);
    });
  });

  it("persists scanned PDF failures as provider-required when OCR is not configured without creating CRM updates", async () => {
    const fx = currentFixture();
    const before = await crmMutationCounts(fx);
    const intake = await createMeetingIntake(fx.actorA, {
      fileBase64: scannedPdfFixtureBase64,
      originalFilename: "scanned-discovery.pdf",
      originalMimeType: "application/pdf"
    });

    expect(intake.status).toBe("FAILED");
    expect(intake.errorMessage).toMatch(/Scanned PDF extraction requires a configured OCR or vision provider/);
    expect(intake.analysisJson).toMatchObject({
      processorStatus: {
        capability: "provider_required",
        conversionMode: "provider_required",
        failureCode: "MEETING_INTAKE_PROVIDER_NOT_CONFIGURED",
        requiredProvider: "ocr_or_vision",
        sourceType: "pdf"
      }
    });
    await expect(crmMutationCounts(fx)).resolves.toEqual(before);
  });

  it("persists processor failures with a clear error", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      originalFilename: "discovery.pdf",
      originalMimeType: "application/pdf"
    });

    expect(intake.status).toBe("FAILED");
    expect(intake.errorMessage).toMatch(/PDF extraction requires uploaded PDF file content/);
  });

  it("rejects empty submissions before creating a failed intake record", async () => {
    const fx = currentFixture();
    const countBefore = await fx.prisma.meetingIntake.count({ where: { workspaceId: fx.workspaceA.id } });

    await expect(
      createMeetingIntake(fx.actorA, {
        contextText: "Meeting date: 2030-04-01",
        explicitSourceType: "pasted_text",
        text: "   "
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Paste meeting notes or upload a meeting artifact before creating an intake.",
      status: 422
    });
    await expect(fx.prisma.meetingIntake.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(countBefore);
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Fixture was not initialized.");
  return fixture;
}

function runMeetingMediaJobOnce(fx: Fixture, workerId: string) {
  return runJobsOnce({
    limit: 1,
    types: [meetingMediaExtractionJobType],
    workerId,
    workspaceId: fx.workspaceA.id
  });
}

async function crmMutationCounts(fx: Fixture) {
  return {
    activities: await fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } }),
    associations: await fx.prisma.meetingActivityAssociation.count({ where: { workspaceId: fx.workspaceA.id } }),
    notes: await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })
  };
}

async function withMeetingMediaProviderEnv(url: string | undefined, callback: () => Promise<void>) {
  const previousUrl = process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL;
  const previousToken = process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN;
  if (url) {
    process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL = url;
    process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN = "test-provider-token";
  } else {
    delete process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL;
    delete process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN;
  }

  try {
    await callback();
  } finally {
    if (previousUrl === undefined) {
      delete process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL;
    } else {
      process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL = previousUrl;
    }
    if (previousToken === undefined) {
      delete process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN;
    } else {
      process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN = previousToken;
    }
  }
}

async function withS3StorageEnv(callback: () => Promise<void>) {
  const previousValues = {
    accessKeyId: process.env.MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID,
    backend: process.env.MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND,
    bucket: process.env.MEETING_INTELLIGENCE_S3_BUCKET,
    endpoint: process.env.MEETING_INTELLIGENCE_S3_ENDPOINT,
    forcePathStyle: process.env.MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE,
    region: process.env.MEETING_INTELLIGENCE_S3_REGION,
    secretAccessKey: process.env.MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY
  };
  process.env.MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND = "s3";
  process.env.MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID = "test-access";
  process.env.MEETING_INTELLIGENCE_S3_BUCKET = "northstar-mi-test";
  process.env.MEETING_INTELLIGENCE_S3_ENDPOINT = "https://s3.example.test";
  process.env.MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE = "true";
  process.env.MEETING_INTELLIGENCE_S3_REGION = "auto";
  process.env.MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY = "test-secret";

  try {
    await callback();
  } finally {
    restoreEnv("MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND", previousValues.backend);
    restoreEnv("MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID", previousValues.accessKeyId);
    restoreEnv("MEETING_INTELLIGENCE_S3_BUCKET", previousValues.bucket);
    restoreEnv("MEETING_INTELLIGENCE_S3_ENDPOINT", previousValues.endpoint);
    restoreEnv("MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE", previousValues.forcePathStyle);
    restoreEnv("MEETING_INTELLIGENCE_S3_REGION", previousValues.region);
    restoreEnv("MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY", previousValues.secretAccessKey);
  }
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function mockS3Storage() {
  const objects = new Map<string, Buffer>();
  const requests: Array<{ authorization: string; method: string; url: string }> = [];
  async function handle(input: string | URL | Request, init?: RequestInit) {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    const headers = init?.headers as Record<string, string>;
    requests.push({ authorization: headers.authorization ?? "", method, url: url.toString() });
    expect(url.pathname.startsWith("/northstar-mi-test")).toBe(true);
    expect(headers.authorization).toContain("AWS4-HMAC-SHA256");
    expect(headers.authorization).not.toContain("test-secret");

    if (url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = Array.from(objects.keys()).filter((key) => key.startsWith(prefix));
      return new Response(
        [
          "<ListBucketResult>",
          "<IsTruncated>false</IsTruncated>",
          ...keys.map((key) => `<Contents><Key>${xmlEscape(key)}</Key></Contents>`),
          "</ListBucketResult>"
        ].join(""),
        { status: 200 }
      );
    }

    const key = decodeURIComponent(url.pathname.replace(/^\/northstar-mi-test\/?/, ""));
    if (method === "PUT") {
      objects.set(key, Buffer.from(init?.body as Uint8Array));
      return new Response(null, { status: 200 });
    }
    if (method === "GET") {
      const body = objects.get(key);
      return body
        ? new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { status: 200 })
        : new Response(null, { status: 404 });
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }
  return { handle, objects, requests };
}

function requestUrl(input: string | URL | Request) {
  return new URL(input instanceof Request ? input.url : String(input));
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
