import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MembershipRole } from "@prisma/client";

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

describe("workspace CSV exports", () => {
  it("exports workspace-scoped CRM rows without leaking another workspace", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const product = await crm.createProduct(fx.actorA, {
      name: "Export Package",
      unitPriceCents: 120000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);

    const deals = await crm.exportWorkspaceCsv(fx.actorA, "deals");
    const contacts = await crm.exportWorkspaceCsv(fx.actorA, "contacts");
    const organizations = await crm.exportWorkspaceCsv(fx.actorA, "organizations");
    const activities = await crm.exportWorkspaceCsv(fx.actorA, "activities");
    const quotes = await crm.exportWorkspaceCsv(fx.actorA, "quotes");

    expect(deals.filename).toBe("northstar-deals.csv");
    expect(deals.csv).toContain("title,status,value,currency,pipeline,stage");
    expect(deals.csv).toContain("Alpha Needle Deal");
    expect(deals.csv).not.toContain("Beta Needle Deal");
    expect(contacts.csv).toContain("Alpha,Contact");
    expect(contacts.csv).not.toContain("Beta,Contact");
    expect(organizations.csv).toContain("Alpha Orbit Organization");
    expect(organizations.csv).not.toContain("Beta Orbit Organization");
    expect(activities.csv).toContain("Alpha Needle Activity");
    expect(activities.csv).not.toContain("Beta Needle Activity");
    expect(quotes.filename).toBe("northstar-quotes.csv");
    expect(quotes.csv).toContain(quote.number);
    expect(quotes.csv).toContain("Alpha Needle Deal");
    expect(quotes.csv).not.toContain("Beta Needle Deal");
  });

  it("returns header-only CSVs for an empty workspace", async () => {
    const prisma = await getPrisma();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: { email: `empty-export-${suffix}@example.test`, name: "Empty Export User" }
    });
    const workspace = await prisma.workspace.create({
      data: {
        name: `Empty Export ${suffix}`,
        slug: `empty-export-${suffix}`,
        memberships: { create: { userId: user.id, role: MembershipRole.OWNER } }
      }
    });
    const actor = { workspaceId: workspace.id, actorUserId: user.id };

    try {
      const deals = await crm.exportWorkspaceCsv(actor, "deals");
      const activities = await crm.exportWorkspaceCsv(actor, "activities");
      const quotes = await crm.exportWorkspaceCsv(actor, "quotes");

      expect(deals.csv).toBe("title,status,value,currency,pipeline,stage,expectedCloseAt,contactName,contactEmail,organizationName,ownerEmail,createdAt,updatedAt");
      expect(activities.csv).toBe("title,type,status,dueAt,completedAt,dealTitle,leadTitle,contactName,contactEmail,organizationName,ownerEmail,description,createdAt,updatedAt");
      expect(quotes.csv).toBe("number,status,dealTitle,contactName,contactEmail,organizationName,currency,subtotal,discountType,discount,taxType,tax,total,itemCount,createdAt,updatedAt");
    } finally {
      await cleanupIntegrationFixture({
        prisma,
        workspaceIds: [workspace.id],
        userIds: [user.id]
      });
    }
  });
});
