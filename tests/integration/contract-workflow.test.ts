import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanupIntegrationFixture, createIntegrationFixture, disconnectPrisma, getPrisma } from "./fixtures";

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

describe("deal contract workflow service", () => {
  it("creates, updates, orders, and audit-logs deal contract steps", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    expect(await crm.listDealContractSteps(fx.actorA, fx.recordsA.deal.id)).toEqual([]);
    await expect(crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step type must be NDA, MSA, or SOW."
    });
    await expect(crm.upsertDealContractStep(fx.actorA, fx.recordsA.deal.id, [] as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step type must be NDA, MSA, or SOW."
    });
    expect(await crm.listDealContractSteps(fx.actorA, fx.recordsA.deal.id)).toEqual([]);

    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "NDA",
        dueAt: new Date("not-a-date")
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract due date is invalid."
    });
    expect(await crm.listDealContractSteps(fx.actorA, fx.recordsA.deal.id)).toEqual([]);
    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "ORDER_FORM" as unknown as "SOW"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step type must be NDA, MSA, or SOW."
    });
    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "NDA",
        status: "DONE" as unknown as "SIGNED"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step status must be NOT_STARTED, IN_PROGRESS, SENT, SIGNED, BLOCKED, or SKIPPED."
    });
    expect(await crm.listDealContractSteps(fx.actorA, fx.recordsA.deal.id)).toEqual([]);
    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "NDA",
        notes: { text: "Malformed notes" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract notes must be text."
    });
    expect(await crm.listDealContractSteps(fx.actorA, fx.recordsA.deal.id)).toEqual([]);
    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "NDA",
        ownerId: { id: fx.userA.id } as never
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step owner id must be text."
    });
    expect(await crm.listDealContractSteps(fx.actorA, fx.recordsA.deal.id)).toEqual([]);

    const nda = await crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "NDA",
      status: "IN_PROGRESS",
      ownerId: fx.userA.id,
      dueAt: "2030-01-10T00:00:00.000Z" as never,
      notes: "Mutual NDA started.",
      externalReference: "local-doc-nda"
    });
    expect(nda.type).toBe("NDA");
    expect(nda.status).toBe("IN_PROGRESS");
    expect(nda.dueAt?.toISOString()).toBe("2030-01-10T00:00:00.000Z");
    expect(nda.owner?.email).toBe(fx.userA.email);
    const contractStepUpdateAuditCountBeforeNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "contract_step.updated",
        entityType: "DealContractStep",
        entityId: nda.id
      }
    });
    const noopNda = await crm.updateDealContractStep(fx.actorA, nda.id, {
      status: "IN_PROGRESS",
      ownerId: fx.userA.id,
      dueAt: "2030-01-10T00:00:00.000Z",
      notes: "  Mutual NDA started.  ",
      externalReference: "local-doc-nda"
    });
    const emptyNdaUpdate = await crm.updateDealContractStep(fx.actorA, nda.id, {});
    const contractStepUpdateAuditCountAfterNoop = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "contract_step.updated",
        entityType: "DealContractStep",
        entityId: nda.id
      }
    });
    await expect(crm.updateDealContractStep(fx.actorA, nda.id, null as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step update must be an object."
    });
    await expect(crm.updateDealContractStep(fx.actorA, nda.id, [] as never)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step update must be an object."
    });
    const contractStepUpdateAuditCountAfterMalformedUpdate = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "contract_step.updated",
        entityType: "DealContractStep",
        entityId: nda.id
      }
    });
    await expect(fx.prisma.dealContractStep.findUnique({ where: { id: nda.id } })).resolves.toMatchObject({
      externalReference: "local-doc-nda",
      notes: "Mutual NDA started.",
      status: "IN_PROGRESS"
    });
    expect(noopNda).toMatchObject({
      externalReference: "local-doc-nda",
      notes: "Mutual NDA started.",
      status: "IN_PROGRESS"
    });
    expect(emptyNdaUpdate).toMatchObject({
      externalReference: "local-doc-nda",
      notes: "Mutual NDA started.",
      status: "IN_PROGRESS"
    });
    expect(contractStepUpdateAuditCountBeforeNoop).toBe(0);
    expect(contractStepUpdateAuditCountAfterNoop).toBe(contractStepUpdateAuditCountBeforeNoop);
    expect(contractStepUpdateAuditCountAfterMalformedUpdate).toBe(contractStepUpdateAuditCountBeforeNoop);
    await expect(
      crm.updateDealContractStep(fx.actorA, nda.id, {
        externalReference: { ref: "Malformed external reference" }
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract external reference must be text."
    });
    await expect(fx.prisma.dealContractStep.findUnique({ where: { id: nda.id } })).resolves.toMatchObject({
      externalReference: "local-doc-nda",
      notes: "Mutual NDA started.",
      status: "IN_PROGRESS"
    });
    await expect(
      crm.updateDealContractStep(fx.actorA, nda.id, {
        status: "DONE" as unknown as "SIGNED",
        notes: "Should not persist"
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract step status must be NOT_STARTED, IN_PROGRESS, SENT, SIGNED, BLOCKED, or SKIPPED."
    });
    await expect(fx.prisma.dealContractStep.findUnique({ where: { id: nda.id } })).resolves.toMatchObject({
      status: "IN_PROGRESS",
      notes: "Mutual NDA started."
    });

    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "MSA",
        status: "SENT"
      })
    ).rejects.toThrow("MSA cannot move forward until NDA is signed or skipped.");

    await expect(
      crm.updateDealContractStep(fx.actorA, nda.id, {
        signedAt: new Date("not-a-date")
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      message: "Contract signed date is invalid."
    });

    const signedNda = await crm.updateDealContractStep(fx.actorA, nda.id, {
      status: "SIGNED"
    });
    expect(signedNda.status).toBe("SIGNED");
    expect(signedNda.sentAt).toBeInstanceOf(Date);
    expect(signedNda.signedAt).toBeInstanceOf(Date);

    const msa = await crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "MSA",
      status: "SENT",
      sentAt: new Date("2030-01-11T00:00:00.000Z")
    });
    expect(msa.sentAt?.toISOString()).toBe("2030-01-11T00:00:00.000Z");

    const steps = await crm.listDealContractSteps(fx.actorA, fx.recordsA.deal.id);
    expect(steps.map((step) => step.type)).toEqual(["NDA", "MSA"]);
    expect(crm.nextContractStepAction(steps)).toEqual({ type: "MSA", status: "SENT" });
    const stepsByDeal = await crm.listDealContractStepsForDeals(fx.actorA, [
      fx.recordsA.deal.id,
      fx.recordsA.deal.id,
      fx.recordsB.deal.id,
      { id: fx.recordsA.deal.id } as never,
      "",
      "missing-deal"
    ]);
    const malformedBatchSummaries = await crm.listDealContractStepsForDeals(fx.actorA, null as never);
    expect(stepsByDeal.get(fx.recordsA.deal.id)?.map((step) => step.type)).toEqual(["NDA", "MSA"]);
    expect(stepsByDeal.has(fx.recordsB.deal.id)).toBe(false);
    expect(stepsByDeal.has("missing-deal")).toBe(false);
    expect(malformedBatchSummaries.size).toBe(0);

    const auditLogs = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityType: "DealContractStep" },
      orderBy: { createdAt: "asc" }
    });
    expect(auditLogs.map((entry) => entry.action)).toEqual([
      "contract_step.created",
      "contract_step.status_changed",
      "contract_step.created"
    ]);
  });

  it("keeps contract steps scoped to the deal workspace", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "NDA",
        ownerId: fx.userB.id
      })
    ).rejects.toThrow("User was not found in this workspace.");

    await expect(crm.listDealContractSteps(fx.actorB, fx.recordsA.deal.id)).rejects.toThrow(
      "Record was not found in this workspace."
    );

    const nda = await crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "NDA",
      status: "SKIPPED"
    });

    await expect(crm.updateDealContractStep(fx.actorB, nda.id, { status: "SIGNED" })).rejects.toThrow(
      "Contract step was not found."
    );
  });

  it("keeps contract status timestamps consistent when status changes", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const nda = await crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "NDA",
      status: "SIGNED",
      sentAt: new Date("2030-05-01T00:00:00.000Z"),
      signedAt: new Date("2030-05-02T00:00:00.000Z")
    });

    const restarted = await crm.updateDealContractStep(fx.actorA, nda.id, {
      status: "IN_PROGRESS",
      dueAt: null,
      sentAt: new Date("2030-05-01T00:00:00.000Z"),
      signedAt: new Date("2030-05-02T00:00:00.000Z")
    });
    expect(restarted.status).toBe("IN_PROGRESS");
    expect(restarted.dueAt).toBeNull();
    expect(restarted.sentAt).toBeNull();
    expect(restarted.signedAt).toBeNull();

    const resent = await crm.updateDealContractStep(fx.actorA, nda.id, {
      status: "SENT"
    });
    expect(resent.status).toBe("SENT");
    expect(resent.sentAt).toBeInstanceOf(Date);
    expect(resent.signedAt).toBeNull();

    const resigned = await crm.updateDealContractStep(fx.actorA, nda.id, {
      status: "SIGNED",
      signedAt: new Date("2030-05-03T00:00:00.000Z")
    });
    expect(resigned.sentAt).toBeInstanceOf(Date);
    expect(resigned.signedAt?.toISOString()).toBe("2030-05-03T00:00:00.000Z");

    const blocked = await crm.updateDealContractStep(fx.actorA, nda.id, {
      status: "BLOCKED"
    });
    expect(blocked.status).toBe("BLOCKED");
    expect(blocked.sentAt).toBeInstanceOf(Date);
    expect(blocked.signedAt).toBeNull();

    const skipped = await crm.updateDealContractStep(fx.actorA, nda.id, {
      status: "SKIPPED"
    });
    expect(skipped.sentAt).toBeNull();
    expect(skipped.signedAt).toBeNull();
  });

  it("upserts contract steps without duplicates while preserving sequence and closed-deal locks", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const createdNda = await crm.upsertDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "NDA",
      status: "IN_PROGRESS",
      ownerId: fx.userA.id,
      notes: "  NDA in progress.  "
    });
    const updatedNda = await crm.upsertDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "NDA",
      status: "SENT",
      externalReference: "  nda-doc-1  "
    });

    expect(updatedNda.id).toBe(createdNda.id);
    expect(updatedNda).toMatchObject({
      type: "NDA",
      status: "SENT",
      notes: "NDA in progress.",
      externalReference: "nda-doc-1"
    });
    await expect(
      fx.prisma.dealContractStep.count({
        where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id, type: "NDA" }
      })
    ).resolves.toBe(1);

    await expect(
      crm.upsertDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "MSA",
        status: "SENT"
      })
    ).rejects.toMatchObject({
      code: "CONTRACT_SEQUENCE_BLOCKED",
      status: 409,
      message: "MSA cannot move forward until NDA is signed or skipped."
    });
    await expect(
      fx.prisma.dealContractStep.count({
        where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id, type: "MSA" }
      })
    ).resolves.toBe(0);

    await crm.upsertDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "NDA",
      status: "SKIPPED"
    });
    const msa = await crm.upsertDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "MSA",
      status: "SENT"
    });
    expect(msa).toMatchObject({ type: "MSA", status: "SENT" });

    await crm.closeDeal(fx.actorA, fx.recordsA.deal.id, { status: "WON" });
    await expect(
      crm.upsertDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "SOW",
        status: "IN_PROGRESS"
      })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });
    await expect(
      fx.prisma.dealContractStep.count({
        where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id, type: "SOW" }
      })
    ).resolves.toBe(0);
  });

  it("blocks contract step mutations after a deal is closed", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const nda = await crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
      type: "NDA",
      status: "IN_PROGRESS",
      notes: "Before close"
    });
    await crm.closeDeal(fx.actorA, fx.recordsA.deal.id, { status: "WON" });

    await expect(
      crm.createDealContractStep(fx.actorA, fx.recordsA.deal.id, {
        type: "MSA",
        status: "SENT"
      })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });

    await expect(
      crm.updateDealContractStep(fx.actorA, nda.id, {
        status: "SIGNED",
        notes: "After close"
      })
    ).rejects.toMatchObject({ code: "DEAL_CLOSED", status: 409 });

    await expect(fx.prisma.dealContractStep.findUnique({ where: { id: nda.id } })).resolves.toMatchObject({
      status: "IN_PROGRESS",
      notes: "Before close"
    });
  });

  it("supports an empty workspace cleanup path after contract rows exist", async () => {
    const prisma = await getPrisma();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `contract-cleanup-${suffix}@example.test`, name: "Contract Cleanup" }
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: `Contract Cleanup ${suffix}`,
        slug: `contract-cleanup-${suffix}`,
        memberships: { create: { userId: user.id, role: "OWNER" } }
      }
    });
    const pipeline = await prisma.pipeline.create({
      data: { workspaceId: workspace.id, name: "Cleanup Pipeline" }
    });
    const stage = await prisma.pipelineStage.create({
      data: { workspaceId: workspace.id, pipelineId: pipeline.id, name: "Qualified", sortOrder: 1 }
    });
    const deal = await prisma.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: "Cleanup Contract Deal"
      }
    });
    await prisma.dealContractStep.create({
      data: { workspaceId: workspace.id, dealId: deal.id, type: "NDA" }
    });

    await cleanupIntegrationFixture({ prisma, workspaceIds: [workspace.id], userIds: [user.id] });
    expect(await prisma.dealContractStep.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });
});
