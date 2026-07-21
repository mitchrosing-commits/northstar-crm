import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { CustomFieldType, MembershipRole } from "@prisma/client";

import { parseCsv } from "@/lib/csv";
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
    const products = await crm.exportWorkspaceCsv(fx.actorA, "products");
    const quotes = await crm.exportWorkspaceCsv(fx.actorA, "quotes");

    expect(deals.filename).toBe("northstar-deals.csv");
    expect(deals.csv).toContain("Deal Title,Status,Deal Value,Currency,Pipeline,Stage");
    expect(deals.csv).toContain("Alpha Needle Deal");
    expect(deals.csv).not.toContain("Beta Needle Deal");
    expect(contacts.csv).toContain("Alpha,Contact");
    expect(contacts.csv).not.toContain("Beta,Contact");
    expect(organizations.csv).toContain("Alpha Orbit Organization");
    expect(organizations.csv).not.toContain("Beta Orbit Organization");
    expect(activities.csv).toContain("Alpha Needle Activity");
    expect(activities.csv).not.toContain("Beta Needle Activity");
    expect(products.filename).toBe("northstar-products.csv");
    expect(products.csv).toContain("Export Package");
    expect(quotes.filename).toBe("northstar-quotes.csv");
    expect(quotes.csv).toContain(quote.number);
    expect(quotes.csv).toContain("Alpha Needle Deal");
    expect(quotes.csv).not.toContain("Beta Needle Deal");
  });

  it("summarizes workspace export row and custom-field counts without leaking another workspace", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const product = await crm.createProduct(fx.actorA, {
      name: "Overview Export Package",
      unitPriceCents: 42000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await Promise.all([
      crm.createCustomField(fx.actorA, {
        entityType: "DEAL",
        name: "Export Segment",
        key: "export_segment",
        fieldType: CustomFieldType.TEXT,
        required: false
      }),
      crm.createCustomField(fx.actorA, {
        entityType: "PERSON",
        name: "Contact Tier",
        key: "contact_tier",
        fieldType: CustomFieldType.TEXT,
        required: false
      }),
      crm.createCustomField(fx.actorB, {
        entityType: "ORGANIZATION",
        name: "Other Workspace Field",
        key: "other_workspace_field",
        fieldType: CustomFieldType.TEXT,
        required: false
      })
    ]);

    const overview = await crm.getWorkspaceExportOverview(fx.actorA);

    expect(overview.deals).toEqual({ rowCount: 1, customFieldCount: 1 });
    expect(overview.contacts).toEqual({ rowCount: 1, customFieldCount: 1 });
    expect(overview.organizations).toEqual({ rowCount: 1, customFieldCount: 0 });
    expect(overview.leads).toEqual({ rowCount: 1, customFieldCount: 0 });
    expect(overview.activities).toEqual({ rowCount: 1, customFieldCount: 0 });
    expect(overview.products).toEqual({ rowCount: 1, customFieldCount: 0 });
    expect(overview.quotes).toEqual({ rowCount: 1, customFieldCount: 0 });
  });

  it("keeps product and quote settings exports as full workspace snapshots when query params are present", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const firstProduct = await crm.createProduct(fx.actorA, {
      name: "Full Snapshot Product One",
      unitPriceCents: 10000,
      currency: "USD"
    });
    const secondProduct = await crm.createProduct(fx.actorA, {
      name: "Full Snapshot Product Two",
      unitPriceCents: 20000,
      currency: "USD"
    });
    await crm.setProductActive(fx.actorA, secondProduct.id, false);
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: firstProduct.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);

    const products = await crm.exportWorkspaceCsv(fx.actorA, "products", {
      page: "2",
      pageSize: "1",
      q: "No matching product query",
      sortBy: "name",
      sortDirection: "desc"
    });
    const quotes = await crm.exportWorkspaceCsv(fx.actorA, "quotes", {
      page: "2",
      pageSize: "1",
      q: "No matching quote query",
      status: "DECLINED"
    });
    const parsedProducts = parseCsv(products.csv);
    const productNameIndex = parsedProducts.headers.indexOf("Product Name");
    const productActiveIndex = parsedProducts.headers.indexOf("Active");
    const inactiveProductRow = parsedProducts.rows.find((row) => row[productNameIndex] === secondProduct.name);

    expect(products.csv).toContain(firstProduct.name);
    expect(products.csv).toContain(secondProduct.name);
    expect(inactiveProductRow?.[productActiveIndex]).toBe("No");
    expect(quotes.csv).toContain(quote.number);
    expect(quotes.csv).toContain(fx.recordsA.deal.title);
    expect(quotes.csv).not.toContain("Beta Needle Deal");
  });

  it("omits cross-workspace related labels and quote items from exports when links are inconsistent", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const product = await crm.createProduct(fx.actorA, {
      name: "Boundary Export Package",
      unitPriceCents: 5000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);

    await Promise.all([
      fx.prisma.deal.update({
        where: { id: fx.recordsA.deal.id },
        data: {
          personId: fx.recordsB.person.id,
          organizationId: fx.recordsB.organization.id
        }
      }),
      fx.prisma.lead.update({
        where: { id: fx.recordsA.lead.id },
        data: {
          personId: fx.recordsB.person.id,
          organizationId: fx.recordsB.organization.id
        }
      }),
      fx.prisma.person.update({
        where: { id: fx.recordsA.person.id },
        data: { organizationId: fx.recordsB.organization.id }
      }),
      fx.prisma.activity.create({
        data: {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: fx.recordsB.deal.id,
          leadId: fx.recordsB.lead.id,
          personId: fx.recordsB.person.id,
          organizationId: fx.recordsB.organization.id,
          type: "TASK",
          title: "Boundary export activity"
        }
      }),
      fx.prisma.quoteItem.create({
        data: {
          workspaceId: fx.workspaceB.id,
          quoteId: quote.id,
          name: "Cross-workspace quote item",
          quantity: 1,
          unitPriceCents: 9900,
          currency: "USD",
          lineTotalCents: 9900
        }
      }),
      fx.prisma.dealLineItem.create({
        data: {
          workspaceId: fx.workspaceB.id,
          dealId: fx.recordsA.deal.id,
          productName: "Cross-workspace deal line item",
          quantity: 1,
          unitPriceCents: 9900,
          currency: "USD",
          lineTotalCents: 9900
        }
      }),
      fx.prisma.quote.create({
        data: {
          workspaceId: fx.workspaceB.id,
          dealId: fx.recordsA.deal.id,
          number: "Q-CROSS-WORKSPACE-EXPORT",
          status: "DRAFT",
          currency: "USD",
          subtotalCents: 9900,
          totalCents: 9900
        }
      })
    ]);

    const [deals, contacts, leads, activities, quotes] = await Promise.all([
      crm.exportWorkspaceCsv(fx.actorA, "deals"),
      crm.exportWorkspaceCsv(fx.actorA, "contacts"),
      crm.exportWorkspaceCsv(fx.actorA, "leads"),
      crm.exportWorkspaceCsv(fx.actorA, "activities"),
      crm.exportWorkspaceCsv(fx.actorA, "quotes")
    ]);
    const parsedQuotes = parseCsv(quotes.csv);
    const quoteNumberIndex = parsedQuotes.headers.indexOf("Quote Number");
    const itemCountIndex = parsedQuotes.headers.indexOf("Item Count");
    const quoteRow = parsedQuotes.rows.find((row) => row[quoteNumberIndex] === quote.number);
    const parsedDeals = parseCsv(deals.csv);
    const dealTitleIndex = parsedDeals.headers.indexOf("Deal Title");
    const lineItemCountIndex = parsedDeals.headers.indexOf("Line Item Count");
    const quoteCountIndex = parsedDeals.headers.indexOf("Quote Count");
    const latestQuoteNumberIndex = parsedDeals.headers.indexOf("Latest Quote Number");
    const dealRow = parsedDeals.rows.find((row) => row[dealTitleIndex] === fx.recordsA.deal.title);

    for (const csv of [deals.csv, contacts.csv, leads.csv, activities.csv, quotes.csv]) {
      expect(csv).not.toContain("Beta,Contact");
      expect(csv).not.toContain("beta@example.test");
      expect(csv).not.toContain("Beta Orbit Organization");
      expect(csv).not.toContain("Beta Needle Deal");
      expect(csv).not.toContain("Beta Needle Lead");
      expect(csv).not.toContain("Cross-workspace deal line item");
      expect(csv).not.toContain("Q-CROSS-WORKSPACE-EXPORT");
    }
    expect(dealRow?.[lineItemCountIndex]).toBe("1");
    expect(dealRow?.[quoteCountIndex]).toBe("1");
    expect(dealRow?.[latestQuoteNumberIndex]).toBe(quote.number);
    expect(quoteRow?.[itemCountIndex]).toBe("1");
  });

  it("omits soft-deleted related labels from exported CRM and quote rows", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;

    const product = await crm.createProduct(fx.actorA, {
      name: "Soft Deleted Export Package",
      unitPriceCents: 7000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const quote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await Promise.all([
      fx.prisma.person.update({
        where: { id: fx.recordsA.person.id },
        data: { deletedAt: new Date("2030-03-01T00:00:00.000Z") }
      }),
      fx.prisma.organization.update({
        where: { id: fx.recordsA.organization.id },
        data: { deletedAt: new Date("2030-03-01T00:00:00.000Z") }
      })
    ]);

    const [deals, leads, activities, quotes] = await Promise.all([
      crm.exportWorkspaceCsv(fx.actorA, "deals", { q: fx.recordsA.deal.title }),
      crm.exportWorkspaceCsv(fx.actorA, "leads", { q: fx.recordsA.lead.title }),
      crm.exportWorkspaceCsv(fx.actorA, "activities", { q: fx.recordsA.activity.title }),
      crm.exportWorkspaceCsv(fx.actorA, "quotes")
    ]);
    const [deletedOrganizationDealSearch, deletedOrganizationContactSearch, deletedOrganizationLeadSearch] = await Promise.all([
      crm.exportWorkspaceCsv(fx.actorA, "deals", { q: fx.recordsA.organization.name }),
      crm.exportWorkspaceCsv(fx.actorA, "contacts", { q: fx.recordsA.organization.name }),
      crm.exportWorkspaceCsv(fx.actorA, "leads", { q: fx.recordsA.organization.name })
    ]);
    const parsedDeals = parseCsv(deals.csv);
    const parsedLeads = parseCsv(leads.csv);
    const parsedActivities = parseCsv(activities.csv);
    const parsedQuotes = parseCsv(quotes.csv);
    const dealRow = parsedDeals.rows.find((row) => row[parsedDeals.headers.indexOf("Deal Title")] === fx.recordsA.deal.title);
    const leadRow = parsedLeads.rows.find((row) => row[parsedLeads.headers.indexOf("Lead Title")] === fx.recordsA.lead.title);
    const activityRow = parsedActivities.rows.find((row) => row[parsedActivities.headers.indexOf("Activity Title")] === fx.recordsA.activity.title);
    const quoteRow = parsedQuotes.rows.find((row) => row[parsedQuotes.headers.indexOf("Quote Number")] === quote.number);

    expect(dealRow?.[parsedDeals.headers.indexOf("Contact Name")]).toBe("");
    expect(dealRow?.[parsedDeals.headers.indexOf("Contact Email")]).toBe("");
    expect(dealRow?.[parsedDeals.headers.indexOf("Organization Name")]).toBe("");
    expect(leadRow?.[parsedLeads.headers.indexOf("Contact Name")]).toBe("");
    expect(leadRow?.[parsedLeads.headers.indexOf("Contact Email")]).toBe("");
    expect(leadRow?.[parsedLeads.headers.indexOf("Organization Name")]).toBe("");
    expect(activityRow?.[parsedActivities.headers.indexOf("Contact Name")]).toBe("");
    expect(activityRow?.[parsedActivities.headers.indexOf("Contact Email")]).toBe("");
    expect(activityRow?.[parsedActivities.headers.indexOf("Organization Name")]).toBe("");
    expect(quoteRow?.[parsedQuotes.headers.indexOf("Contact Name")]).toBe("");
    expect(quoteRow?.[parsedQuotes.headers.indexOf("Contact Email")]).toBe("");
    expect(quoteRow?.[parsedQuotes.headers.indexOf("Organization Name")]).toBe("");
    expect(deletedOrganizationDealSearch.csv).not.toContain(fx.recordsA.deal.title);
    expect(deletedOrganizationContactSearch.csv).not.toContain(fx.recordsA.person.email as string);
    expect(deletedOrganizationLeadSearch.csv).not.toContain(fx.recordsA.lead.title);
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
      const contacts = await crm.exportWorkspaceCsv(actor, "contacts");
      const organizations = await crm.exportWorkspaceCsv(actor, "organizations");
      const leads = await crm.exportWorkspaceCsv(actor, "leads");
      const activities = await crm.exportWorkspaceCsv(actor, "activities");
      const products = await crm.exportWorkspaceCsv(actor, "products");
      const quotes = await crm.exportWorkspaceCsv(actor, "quotes");

      expect(deals.csv).toBe("Deal Title,Status,Deal Value,Currency,Pipeline,Stage,Expected Close,Contact Name,Contact Email,Organization Name,Owner Email,Line Item Count,Quote Count,Latest Quote Number,Latest Quote Status,Latest Quote Total,Created At,Updated At");
      expect(contacts.csv).toBe("First Name,Last Name,Email,Phone,Organization Name,Owner Email,Created At,Updated At");
      expect(organizations.csv).toBe("Organization Name,Domain,Owner Email,People Count,Deal Count,Created At,Updated At");
      expect(leads.csv).toBe("Lead Title,Status,Source,Contact Name,Contact Email,Organization Name,Owner Email,Created At,Updated At");
      expect(activities.csv).toBe("Activity Title,Type,Status,Due At,Completed At,Deal Title,Lead Title,Contact Name,Contact Email,Organization Name,Owner Email,Description,Created At,Updated At");
      expect(products.csv).toBe("Product Name,Description,Unit Price,Currency,Active,Created At,Updated At");
      expect(quotes.csv).toBe("Quote Number,Status,Deal Title,Contact Name,Contact Email,Organization Name,Currency,Subtotal,Discount Type,Discount,Tax Type,Tax,Total,Item Count,Created At,Updated At");
    } finally {
      await cleanupIntegrationFixture({
        prisma,
        workspaceIds: [workspace.id],
        userIds: [user.id]
      });
    }
  });

  it("neutralizes spreadsheet formulas in exported user-entered fields", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;
    const prisma = fx.prisma;
    const organization = await prisma.organization.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "-Export Formula Organization"
      }
    });
    const contact = await prisma.person.create({
      data: {
        workspaceId: fx.workspaceA.id,
        firstName: "@Export",
        lastName: "Formula Contact",
        organizationId: organization.id
      }
    });
    const deal = await prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        personId: contact.id,
        organizationId: organization.id,
        title: "=Export Formula Deal",
        valueCents: 10000,
        currency: "USD"
      }
    });
    const formulaField = await prisma.customFieldDefinition.create({
      data: {
        workspaceId: fx.workspaceA.id,
        entityType: "DEAL",
        name: "Formula",
        key: "export_formula",
        fieldType: CustomFieldType.TEXT
      }
    });
    const formulaProduct = await prisma.product.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "=Export Formula Product",
        unitPriceCents: 1000,
        currency: "USD"
      }
    });
    await Promise.all([
      prisma.customFieldValue.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          entityId: deal.id,
          fieldId: formulaField.id,
          value: "+SUM(1,1)"
        }
      }),
      prisma.activity.create({
        data: {
          workspaceId: fx.workspaceA.id,
          dealId: deal.id,
          type: "TASK",
          title: "\tExport Formula Activity"
        }
      })
    ]);
    await crm.createDealLineItem(fx.actorA, {
      dealId: deal.id,
      productId: formulaProduct.id,
      quantity: 1
    });
    await crm.createQuoteFromDeal(fx.actorA, deal.id);

    const [deals, contacts, organizations, activities, products, quotes] = await Promise.all([
      crm.exportWorkspaceCsv(fx.actorA, "deals"),
      crm.exportWorkspaceCsv(fx.actorA, "contacts"),
      crm.exportWorkspaceCsv(fx.actorA, "organizations"),
      crm.exportWorkspaceCsv(fx.actorA, "activities"),
      crm.exportWorkspaceCsv(fx.actorA, "products"),
      crm.exportWorkspaceCsv(fx.actorA, "quotes")
    ]);

    expect(deals.csv).toContain("'=Export Formula Deal");
    expect(deals.csv).toContain("\"'+SUM(1,1)\"");
    expect(deals.csv).not.toContain("\n=Export Formula Deal");
    expect(contacts.csv).toContain("'@Export,Formula Contact");
    expect(organizations.csv).toContain("'-Export Formula Organization");
    expect(activities.csv).toContain("'\tExport Formula Activity");
    expect(products.csv).toContain("'=Export Formula Product");
    expect(quotes.csv).toContain("'=Export Formula Deal");
    expect(quotes.csv).not.toContain("\n=Export Formula Deal");
  });

  it("exports current filtered activity views", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;
    await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        leadId: fx.recordsA.lead.id,
        type: "TASK",
        title: "Completed Export Activity",
        completedAt: new Date("2030-02-01T00:00:00.000Z")
      }
    });
    await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        type: "TASK",
        title: "Unrelated Export Activity"
      }
    });

    const openActivities = await crm.exportWorkspaceCsv(fx.actorA, "activities", {
      related: `lead:${fx.recordsA.lead.id}`,
      status: "open",
      sortBy: "title",
      sortDirection: "asc"
    });
    const completedActivities = await crm.exportWorkspaceCsv(fx.actorA, "activities", {
      related: `lead:${fx.recordsA.lead.id}`,
      status: "completed"
    });
    const whitespaceNormalizedActivities = await crm.exportWorkspaceCsv(fx.actorA, "activities", {
      q: "   ",
      ownerId: "   ",
      related: ` lead:${fx.recordsA.lead.id} `,
      status: "open"
    });
    const malformedRelatedActivities = await crm.exportWorkspaceCsv(fx.actorA, "activities", {
      related: `lead:${fx.recordsA.lead.id}:ignored`,
      status: "open"
    });
    const crossWorkspaceRelatedActivities = await crm.exportWorkspaceCsv(fx.actorA, "activities", {
      related: `deal:${fx.recordsB.deal.id}`,
      status: "open"
    });
    const malformedFilterActivities = await crm.exportWorkspaceCsv(fx.actorA, "activities", {
      q: { value: "Alpha" } as never,
      related: { value: `lead:${fx.recordsA.lead.id}` } as never,
      status: { value: "completed" } as never
    });

    expect(openActivities.csv).toContain("Alpha Needle Activity");
    expect(openActivities.csv).not.toContain("Completed Export Activity");
    expect(openActivities.csv).not.toContain("Unrelated Export Activity");
    expect(completedActivities.csv).toContain("Completed Export Activity");
    expect(completedActivities.csv).not.toContain("Alpha Needle Activity");
    expect(whitespaceNormalizedActivities.csv).toContain("Alpha Needle Activity");
    expect(whitespaceNormalizedActivities.csv).not.toContain("Completed Export Activity");
    expect(whitespaceNormalizedActivities.csv).not.toContain("Unrelated Export Activity");
    expect(malformedRelatedActivities.csv).toContain("Alpha Needle Activity");
    expect(malformedRelatedActivities.csv).toContain("Unrelated Export Activity");
    expect(malformedRelatedActivities.csv).not.toContain("Completed Export Activity");
    expect(crossWorkspaceRelatedActivities.csv).toBe(
      "Activity Title,Type,Status,Due At,Completed At,Deal Title,Lead Title,Contact Name,Contact Email,Organization Name,Owner Email,Description,Created At,Updated At"
    );
    expect(malformedFilterActivities.csv).toContain("Alpha Needle Activity");
    expect(malformedFilterActivities.csv).toContain("Completed Export Activity");
  });

  it("exports current filtered deal views with custom field columns", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;
    const prisma = fx.prisma;

    const hiddenDeal = await prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "Hidden Export Deal",
        valueCents: 50000,
        currency: "USD"
      }
    });
    const secondMatchingDeal = await prisma.deal.create({
      data: {
        workspaceId: fx.workspaceA.id,
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "Second Needle Export Deal",
        valueCents: 60000,
        currency: "USD"
      }
    });
    const segmentField = await prisma.customFieldDefinition.create({
      data: {
        workspaceId: fx.workspaceA.id,
        entityType: "DEAL",
        name: "Segment",
        key: "segment",
        fieldType: CustomFieldType.TEXT
      }
    });
    const secondarySegmentField = await prisma.customFieldDefinition.create({
      data: {
        workspaceId: fx.workspaceA.id,
        entityType: "DEAL",
        name: "Segment",
        key: "segment_secondary",
        fieldType: CustomFieldType.TEXT
      }
    });
    await prisma.customFieldValue.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          entityId: fx.recordsA.deal.id,
          fieldId: segmentField.id,
          value: "Enterprise"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          entityId: hiddenDeal.id,
          fieldId: segmentField.id,
          value: "SMB"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          entityId: secondMatchingDeal.id,
          fieldId: segmentField.id,
          value: "Enterprise"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          entityId: secondMatchingDeal.id,
          fieldId: secondarySegmentField.id,
          value: "Strategic"
        }
      ]
    });

    const searched = await crm.exportWorkspaceCsv(fx.actorA, "deals", {
      page: "2",
      pageSize: "1",
      q: "Needle",
      sortBy: "title",
      sortDirection: "asc"
    });
    expect(searched.csv).toContain("Alpha Needle Deal");
    expect(searched.csv).toContain("Second Needle Export Deal");
    expect(searched.csv).not.toContain("Hidden Export Deal");

    const filtered = await crm.exportWorkspaceCsv(fx.actorA, "deals", {
      customFieldId: segmentField.id,
      customFieldOperator: "equals",
      customFieldValue: "Enterprise",
      page: "2",
      pageSize: "1"
    });
    const filteredHeader = filtered.csv.split("\n")[0];
    expect(filtered.csv).toContain("Custom: Segment");
    expect(filteredHeader).toContain("Custom: Segment (segment),Custom: Segment (segment_secondary)");
    expect(filtered.csv).toContain("Alpha Needle Deal");
    expect(filtered.csv).toContain("Second Needle Export Deal");
    expect(filtered.csv).toContain("Enterprise");
    expect(filtered.csv).toContain("Strategic");
    expect(filtered.csv).not.toContain("Hidden Export Deal");
    expect(filtered.csv).not.toContain("SMB");
  });

  it("exports the most recently updated quote summary for deal rows", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;
    const product = await crm.createProduct(fx.actorA, {
      name: "Latest Quote Export Package",
      unitPriceCents: 25000,
      currency: "USD"
    });
    await crm.createDealLineItem(fx.actorA, {
      dealId: fx.recordsA.deal.id,
      productId: product.id,
      quantity: 1
    });
    const firstQuote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    const secondQuote = await crm.createQuoteFromDeal(fx.actorA, fx.recordsA.deal.id);
    await crm.updateQuoteStatus(fx.actorA, firstQuote.id, "SENT");

    const deals = await crm.exportWorkspaceCsv(fx.actorA, "deals", { q: fx.recordsA.deal.title });
    const parsedDeals = parseCsv(deals.csv);
    const titleIndex = parsedDeals.headers.indexOf("Deal Title");
    const quoteCountIndex = parsedDeals.headers.indexOf("Quote Count");
    const latestQuoteNumberIndex = parsedDeals.headers.indexOf("Latest Quote Number");
    const latestQuoteStatusIndex = parsedDeals.headers.indexOf("Latest Quote Status");
    const latestQuoteTotalIndex = parsedDeals.headers.indexOf("Latest Quote Total");
    const dealRow = parsedDeals.rows.find((row) => row[titleIndex] === fx.recordsA.deal.title);

    expect(secondQuote.number).not.toBe(firstQuote.number);
    expect(dealRow?.[quoteCountIndex]).toBe("2");
    expect(dealRow?.[latestQuoteNumberIndex]).toBe(firstQuote.number);
    expect(dealRow?.[latestQuoteStatusIndex]).toBe("Sent");
    expect(dealRow?.[latestQuoteTotalIndex]).toBe("250.00");
  });

  it("exports current filtered contact, organization, and lead views with custom field columns", async () => {
    fixture = await createIntegrationFixture();
    const fx = fixture;
    const prisma = fx.prisma;

    const [matchingContact, hiddenContact, matchingOrganization, hiddenOrganization, matchingLead, hiddenLead] = await Promise.all([
      prisma.person.create({
        data: {
          workspaceId: fx.workspaceA.id,
          firstName: "Second",
          lastName: "Export Contact",
          email: "second-export-contact@example.test",
          organizationId: fx.recordsA.organization.id
        }
      }),
      prisma.person.create({
        data: {
          workspaceId: fx.workspaceA.id,
          firstName: "Hidden",
          lastName: "Export Contact",
          email: "hidden-export-contact@example.test"
        }
      }),
      prisma.organization.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "Second Export Organization",
          domain: "second-export.example"
        }
      }),
      prisma.organization.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "Hidden Export Organization",
          domain: "hidden-export.example"
        }
      }),
      prisma.lead.create({
        data: {
          workspaceId: fx.workspaceA.id,
          title: "Second Export Lead",
          source: "Export coverage"
        }
      }),
      prisma.lead.create({
        data: {
          workspaceId: fx.workspaceA.id,
          title: "Hidden Export Lead",
          source: "Export coverage"
        }
      })
    ]);
    const [contactField, organizationField, leadField] = await Promise.all([
      prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "PERSON",
          name: "Tier",
          key: "export_contact_tier",
          fieldType: CustomFieldType.TEXT
        }
      }),
      prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "ORGANIZATION",
          name: "Segment",
          key: "export_organization_segment",
          fieldType: CustomFieldType.TEXT
        }
      }),
      prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "LEAD",
          name: "Priority",
          key: "export_lead_priority",
          fieldType: CustomFieldType.TEXT
        }
      })
    ]);
    await prisma.customFieldValue.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          entityType: "PERSON",
          entityId: fx.recordsA.person.id,
          fieldId: contactField.id,
          value: "Founder"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "PERSON",
          entityId: matchingContact.id,
          fieldId: contactField.id,
          value: "Founder"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "PERSON",
          entityId: hiddenContact.id,
          fieldId: contactField.id,
          value: "SMB"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "ORGANIZATION",
          entityId: fx.recordsA.organization.id,
          fieldId: organizationField.id,
          value: "Enterprise"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "ORGANIZATION",
          entityId: matchingOrganization.id,
          fieldId: organizationField.id,
          value: "Enterprise"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "ORGANIZATION",
          entityId: hiddenOrganization.id,
          fieldId: organizationField.id,
          value: "SMB"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "LEAD",
          entityId: fx.recordsA.lead.id,
          fieldId: leadField.id,
          value: "High"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "LEAD",
          entityId: matchingLead.id,
          fieldId: leadField.id,
          value: "High"
        },
        {
          workspaceId: fx.workspaceA.id,
          entityType: "LEAD",
          entityId: hiddenLead.id,
          fieldId: leadField.id,
          value: "Low"
        }
      ]
    });

    const contacts = await crm.exportWorkspaceCsv(fx.actorA, "contacts", {
      customFieldId: contactField.id,
      customFieldOperator: "equals",
      customFieldValue: "Founder",
      page: "2",
      pageSize: "1"
    });
    const organizations = await crm.exportWorkspaceCsv(fx.actorA, "organizations", {
      customFieldId: organizationField.id,
      customFieldOperator: "equals",
      customFieldValue: "Enterprise",
      page: "2",
      pageSize: "1"
    });
    const leads = await crm.exportWorkspaceCsv(fx.actorA, "leads", {
      customFieldId: leadField.id,
      customFieldOperator: "equals",
      customFieldValue: "High",
      page: "2",
      pageSize: "1"
    });

    expect(contacts.csv).toContain("Custom: Tier");
    expect(contacts.csv).toContain("Alpha,Contact");
    expect(contacts.csv).toContain("Second,Export Contact");
    expect(contacts.csv).toContain("Founder");
    expect(contacts.csv).not.toContain("Hidden,Export Contact");
    expect(contacts.csv).not.toContain("SMB");

    expect(organizations.csv).toContain("Custom: Segment");
    expect(organizations.csv).toContain("Alpha Orbit Organization");
    expect(organizations.csv).toContain("Second Export Organization");
    expect(organizations.csv).toContain("Enterprise");
    expect(organizations.csv).not.toContain("Hidden Export Organization");
    expect(organizations.csv).not.toContain("SMB");

    expect(leads.csv).toContain("Custom: Priority");
    expect(leads.csv).toContain("Alpha Needle Lead");
    expect(leads.csv).toContain("Second Export Lead");
    expect(leads.csv).toContain("High");
    expect(leads.csv).not.toContain("Hidden Export Lead");
    expect(leads.csv).not.toContain("Low");
  });
});
