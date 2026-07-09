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
