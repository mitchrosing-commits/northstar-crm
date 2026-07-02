import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  applyMeetingIntake,
  createMeetingIntake
} from "@/lib/services/meeting-intelligence-service";
import type { MeetingIntelligenceDraft } from "@/lib/meeting-intelligence/types";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | undefined;
const pdfFixtureBase64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTQ3ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIChNZWV0aW5nIGRhdGU6IDIwMzAtMDQtMDEpIFRqIDAgLTE4IFRkIChBY3Rpb246IHNlbmQgU09XIGJ5IDIwMzAtMDQtMDUuKSBUaiAwIC0xOCBUZCAoQ3VycmVudCBXTVMgaGFzIGludmVudG9yeSBwYWluLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjUwOQolJUVPRgo=";

beforeAll(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
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
    where: { workspaceId: fixture.workspaceA.id, description: { contains: "Source: send SOW" } }
  });
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
      notes: await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })
    };
    const secondResult = await applyMeetingIntake(fx.actorA, intake.id, applyInput);

    expect(secondResult).toEqual(result);
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstApplyCounts.notes);
    await expect(fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(afterFirstApplyCounts.activities);
  });

  it("creates object-specific notes, a completed meeting log, and follow-up activities after approval", async () => {
    const fx = currentFixture();
    const intake = await createMeetingIntake(fx.actorA, {
      contextText: "Meeting date: 2030-04-10\nAttendees: Alpha Contact",
      hints: {
        dealId: fx.recordsA.deal.id,
        organizationId: fx.recordsA.organization.id,
        personIds: [fx.recordsA.person.id]
      },
      text: [
        `Met with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} at ${fx.recordsA.organization.name} about ${fx.recordsA.deal.title}.`,
        `${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} prefers email and mentioned a birthday on 2030-05-01.`,
        `${fx.recordsA.organization.name} has WMS inventory pain and a data migration blocker.`,
        `${fx.recordsA.deal.title} has approved budget, SOW risk, and legal approval timing pressure.`,
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

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true } : null,
      notes: draft.notes.map((note) => ({ ...note, include: true })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: true }))
    });

    expect(result.created.filter((item) => item.type === "note").length).toBeGreaterThanOrEqual(3);
    expect(result.created.filter((item) => item.type === "activity")).toHaveLength(2);
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
    const meeting = await fx.prisma.activity.findFirstOrThrow({
      where: { dealId: fx.recordsA.deal.id, title: { contains: "Meeting:" }, type: "MEETING", workspaceId: fx.workspaceA.id }
    });
    expect(meeting.completedAt?.toISOString()).toBe("2030-04-10T00:00:00.000Z");
    expect(meeting.description).toContain("Associated CRM records:");
    expect(meeting.description).toContain(`Contact: ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName}`);
    const followUp = await fx.prisma.activity.findFirstOrThrow({
      where: { dealId: fx.recordsA.deal.id, title: { contains: "send SOW" }, type: "TASK", workspaceId: fx.workspaceA.id }
    });
    expect(followUp.dueAt?.toISOString()).toBe("2030-04-15T00:00:00.000Z");
    expect(followUp.description).toContain("Source: Action: send SOW by 2030-04-15.");
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
      hints: { dealId: fx.recordsA.deal.id },
      text: [
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

    const result = await applyMeetingIntake(fx.actorA, intake.id, {
      meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true, target: foreignDealTarget } : null,
      notes: draft.notes.map((note) => ({ ...note, include: true, target: foreignOrganizationTarget })),
      nextStepActivities: draft.nextStepActivities.map((activity) => ({ ...activity, include: true, target: foreignDealTarget }))
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
