import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { cleanupIntegrationFixture, createIntegrationFixture, disconnectPrisma } from "./fixtures";

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

describe("supply-chain vertical setup service", () => {
  it("applies custom field, saved-view, and product presets idempotently inside one workspace", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const before = await crm.getSupplyChainVerticalSetupStatus(fx.actorA);
    expect(before.customFields.missing).toBeGreaterThan(0);
    expect(before.savedViews.deferred).toBeGreaterThan(0);
    expect(before.products.missing).toBeGreaterThan(0);

    const first = await crm.applySupplyChainVerticalPresets(fx.actorA);
    expect(first.customFields.created).toBe(first.customFields.total);
    expect(first.savedViews.created).toBe(first.savedViews.total);
    expect(first.savedViews.deferred).toBeGreaterThan(0);
    expect(first.products.created).toBe(first.products.total);
    expect(first.unsupported.join(" ")).toContain("SavedViewRecordType does not include ACTIVITY");
    expect(first.unsupported.join(" ")).toContain("SELECT values");

    const after = await crm.getSupplyChainVerticalSetupStatus(fx.actorA);
    expect(after.customFields.existing).toBe(after.customFields.total);
    expect(after.savedViews.existing).toBe(after.savedViews.total);
    expect(after.products.existing).toBe(after.products.total);

    const second = await crm.applySupplyChainVerticalPresets(fx.actorA);
    expect(second.customFields.created).toBe(0);
    expect(second.savedViews.created).toBe(0);
    expect(second.products.created).toBe(0);
    expect(second.customFields.existing).toBe(second.customFields.total);
    expect(second.savedViews.existing).toBe(second.savedViews.total);
    expect(second.products.existing).toBe(second.products.total);

    const [fields, views, products] = await Promise.all([
      fx.prisma.customFieldDefinition.findMany({
        where: { workspaceId: fx.workspaceA.id },
        select: { entityType: true, key: true, fieldType: true, options: true }
      }),
      fx.prisma.savedView.findMany({
        where: { workspaceId: fx.workspaceA.id },
        select: { recordType: true, name: true, state: true }
      }),
      fx.prisma.product.findMany({
        where: { workspaceId: fx.workspaceA.id },
        select: { name: true, unitPriceCents: true, description: true }
      })
    ]);
    expect(fields.some((field) => field.key === "opportunity_type" && field.fieldType === "SELECT")).toBe(true);
    expect(fields.some((field) => field.key === "go_live_target_date" && field.fieldType === "DATE")).toBe(true);
    expect(views.some((view) => view.name === "Deals Missing Go-Live Date" && view.recordType === "DEAL")).toBe(true);
    expect(JSON.stringify(views.map((view) => view.state))).toContain("customFieldOperator");
    expect(products.some((product) => product.name === "Managed Support Retainer" && product.unitPriceCents === 0)).toBe(true);
    expect(products.every((product) => product.description?.includes("Editable supply-chain implementation consulting service template"))).toBe(true);

    const workspaceBStatus = await crm.getSupplyChainVerticalSetupStatus(fx.actorB);
    expect(workspaceBStatus.customFields.existing).toBe(0);
    expect(workspaceBStatus.savedViews.existing).toBe(0);
    expect(workspaceBStatus.products.existing).toBe(0);
  });

  it("leaves other fixture workspaces clean after manual cleanup", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;
    await crm.applySupplyChainVerticalPresets(fx.actorA);

    await cleanupIntegrationFixture({
      prisma: fx.prisma,
      workspaceIds: [fx.workspaceA.id, fx.workspaceB.id],
      userIds: [fx.userA.id, fx.userB.id]
    });
    fixture = undefined;

    expect(await fx.prisma.customFieldDefinition.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(0);
    expect(await fx.prisma.savedView.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(0);
    expect(await fx.prisma.product.count({ where: { workspaceId: fx.workspaceA.id } })).toBe(0);
  });
});
