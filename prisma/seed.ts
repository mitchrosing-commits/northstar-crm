import {
  ActivityType,
  CustomFieldEntityType,
  CustomFieldType,
  DealStatus,
  EmailDirection,
  LeadStatus,
  MembershipRole,
  Prisma,
  PrismaClient,
  QuoteStatus
} from "@prisma/client";

import { hashPassword } from "../lib/auth/password";

const prisma = new PrismaClient();
const seedLoginPassword = process.env.SEED_LOGIN_PASSWORD || "northstar-demo";

async function main() {
  const alex = await prisma.user.upsert({
    where: { email: "alex@example.test" },
    update: { name: "Alex Morgan", passwordHash: hashPassword(seedLoginPassword) },
    create: { email: "alex@example.test", name: "Alex Morgan", passwordHash: hashPassword(seedLoginPassword) }
  });

  const sam = await prisma.user.upsert({
    where: { email: "sam@example.test" },
    update: { name: "Sam Rivera", passwordHash: hashPassword(seedLoginPassword) },
    create: { email: "sam@example.test", name: "Sam Rivera", passwordHash: hashPassword(seedLoginPassword) }
  });

  const workspace = await prisma.workspace.upsert({
    where: { slug: "northstar-revenue" },
    update: { name: "Northstar Revenue" },
    create: { name: "Northstar Revenue", slug: "northstar-revenue" }
  });

  await resetWorkspace(workspace.id);

  await prisma.workspaceMembership.createMany({
    data: [
      { workspaceId: workspace.id, userId: alex.id, role: MembershipRole.OWNER },
      { workspaceId: workspace.id, userId: sam.id, role: MembershipRole.MEMBER }
    ],
    skipDuplicates: true
  });

  const owners = { alex, sam };
  const pipeline = await createPipeline(workspace.id);
  const stages = await createStages(workspace.id, pipeline.id);
  const organizations = await createOrganizations(workspace.id, owners);
  const people = await createPeople(workspace.id, owners, organizations);
  const deals = await createDeals(workspace.id, pipeline.id, stages, owners, organizations, people);
  const leads = await createLeads(workspace.id, owners, organizations, people);
  const products = await createProducts(workspace.id);
  await createDealCommercials(workspace.id, deals, products);

  await createActivities(workspace.id, owners, organizations, people, deals, leads);
  await createNotes(workspace.id, owners, organizations, people, deals, leads);
  await createEmailLogs(workspace.id, owners, organizations, people, deals);
  await createAuditLogs(workspace.id, owners, deals, leads);
  await createCustomFieldExamples(workspace.id, organizations, people, deals, leads);

  await prisma.auditLog.create({
    data: {
      workspaceId: workspace.id,
      actorId: alex.id,
      action: "workspace.seeded",
      entityType: "Workspace",
      entityId: workspace.id,
      metadata: {
        seedVersion: 2,
        organizations: Object.keys(organizations).length,
        people: Object.keys(people).length,
        deals: Object.keys(deals).length,
        leads: Object.keys(leads).length
      }
    }
  });

  console.log(
    `Seeded ${workspace.name} with ${Object.keys(organizations).length} organizations, ${Object.keys(people).length} contacts, ${Object.keys(deals).length} deals, and ${Object.keys(leads).length} leads.`
  );
}

async function createProducts(workspaceId: string) {
  const data = [
    ["platform", "Northstar CRM Platform", "Core CRM workspace with pipeline, activity, and quote tracking.", 2400000],
    ["implementation", "Implementation Sprint", "Guided rollout, configuration, and team enablement.", 1800000],
    ["success", "Revenue Success Package", "Quarterly workflow review and optimization support.", 900000]
  ] as const;

  const entries = await Promise.all(
    data.map(([key, name, description, unitPriceCents]) =>
      prisma.product.create({
        data: {
          workspaceId,
          name,
          description,
          unitPriceCents,
          currency: "USD"
        }
      }).then((product) => [key, product] as const)
    )
  );
  return Object.fromEntries(entries);
}

async function createDealCommercials(workspaceId: string, deals: DealMap, products: ProductMap) {
  const data: CommercialSeed[] = [
    ["orbitExpansion", "platform", 2, "Enterprise platform rollout", "Q-DEMO-0001", QuoteStatus.SENT],
    ["canopyRollout", "implementation", 1, "Partner rollout implementation", "Q-DEMO-0002", QuoteStatus.DRAFT],
    ["evergreenDispatch", "platform", 3, "Dispatch modernization subscription", "Q-DEMO-0003", QuoteStatus.ACCEPTED],
    ["lumenHarbor", "success", 2, "Revenue success support", "Q-DEMO-0004", QuoteStatus.SENT],
    ["evergreenKiosk", "implementation", 1, "Station kiosk pilot implementation", "Q-DEMO-0005", QuoteStatus.DRAFT],
    ["atlasTraining", "success", 1, "Manager training and enablement package", "Q-DEMO-0006", QuoteStatus.SENT]
  ];

  for (const [dealKey, productKey, quantity, description, quoteNumber, quoteStatus] of data) {
    const deal = deals[dealKey];
    const product = products[productKey];
    const lineTotalCents = product.unitPriceCents * quantity;
    const lineItem = await prisma.dealLineItem.create({
      data: {
        workspaceId,
        dealId: deal.id,
        productId: product.id,
        productName: product.name,
        description,
        quantity,
        unitPriceCents: product.unitPriceCents,
        lineTotalCents,
        currency: product.currency
      }
    });

    await prisma.quote.create({
      data: {
        workspaceId,
        dealId: deal.id,
        number: quoteNumber,
        status: quoteStatus,
        currency: product.currency,
        subtotalCents: lineTotalCents,
        totalCents: lineTotalCents,
        items: {
          create: {
            workspaceId,
            dealLineItemId: lineItem.id,
            productId: product.id,
            name: product.name,
            description,
            quantity,
            unitPriceCents: product.unitPriceCents,
            lineTotalCents,
            currency: product.currency
          }
        }
      }
    });
  }
}

async function createPipeline(workspaceId: string) {
  return prisma.pipeline.create({
    data: {
      workspaceId,
      name: "New Business",
      description: "Inbound, outbound, and partner opportunities for the Northstar Revenue team.",
      sortOrder: 1
    }
  });
}

async function createStages(workspaceId: string, pipelineId: string) {
  const stageData = [
    ["qualified", "Qualified", 20],
    ["discovery", "Discovery", 35],
    ["proposal", "Proposal", 60],
    ["negotiation", "Negotiation", 80],
    ["closed", "Closed", 100]
  ] as const;
  const entries = await Promise.all(
    stageData.map(([key, name, probability], index) =>
      prisma.pipelineStage.create({
        data: {
          workspaceId,
          pipelineId,
          name,
          probability,
          sortOrder: index + 1
        }
      }).then((stage) => [key, stage] as const)
    )
  );
  return Object.fromEntries(entries);
}

async function createOrganizations(workspaceId: string, owners: Owners) {
  const data = [
    ["orbit", "Orbit Labs", "orbitlabs.example", "alex"],
    ["canopy", "Canopy Works", "canopy.example", "sam"],
    ["northline", "Northline Robotics", "northlinerobotics.example", "alex"],
    ["lumen", "Lumen Harbor", "lumenharbor.example", "sam"],
    ["atlas", "Atlas Kitchens", "atlaskitchens.example", "alex"],
    ["cinder", "Cinder Finance", "cinderfinance.example", "sam"],
    ["brightpath", "Brightpath Health", "brightpathhealth.example", "alex"],
    ["evergreen", "Evergreen Transit", "evergreentransit.example", "sam"],
    ["mesa", "Mesa Cloud", "mesacloud.example", "alex"],
    ["solace", "Solace Supply", "solacesupply.example", "sam"]
  ] as const;

  const entries = await Promise.all(
    data.map(([key, name, domain, ownerKey]) =>
      prisma.organization.create({
        data: {
          workspaceId,
          ownerId: owners[ownerKey].id,
          name,
          domain
        }
      }).then((organization) => [key, organization] as const)
    )
  );
  return Object.fromEntries(entries);
}

async function createPeople(workspaceId: string, owners: Owners, organizations: OrganizationMap) {
  const data = [
    ["priya", "Priya", "Shah", "priya@orbitlabs.example", "+1 555 0101", "orbit", "alex"],
    ["mateo", "Mateo", "Reed", "mateo@orbitlabs.example", "+1 555 0102", "orbit", "sam"],
    ["jordan", "Jordan", "Lee", "jordan@canopy.example", "+1 555 0144", "canopy", "sam"],
    ["tessa", "Tessa", "Brooks", "tessa@canopy.example", "+1 555 0145", "canopy", "alex"],
    ["nina", "Nina", "Patel", "nina@northlinerobotics.example", "+1 555 0170", "northline", "alex"],
    ["owen", "Owen", "Kim", "owen@lumenharbor.example", "+1 555 0188", "lumen", "sam"],
    ["mara", "Mara", "Stone", "mara@atlaskitchens.example", "+1 555 0120", "atlas", "alex"],
    ["eli", "Eli", "Chen", "eli@cinderfinance.example", "+1 555 0130", "cinder", "sam"],
    ["hana", "Hana", "Ortiz", "hana@brightpathhealth.example", "+1 555 0161", "brightpath", "alex"],
    ["victor", "Victor", "Ng", "victor@evergreentransit.example", "+1 555 0162", "evergreen", "sam"],
    ["riley", "Riley", "Fox", "riley@mesacloud.example", "+1 555 0190", "mesa", "alex"],
    ["imani", "Imani", "Cole", "imani@solacesupply.example", "+1 555 0118", "solace", "sam"],
    ["greta", "Greta", "Miles", "greta@lumenharbor.example", "+1 555 0189", "lumen", "alex"],
    ["asher", "Asher", "Bell", "asher@northlinerobotics.example", "+1 555 0171", "northline", "sam"],
    ["lena", "Lena", "Park", "lena@brightpathhealth.example", "+1 555 0163", "brightpath", "alex"],
    ["noah", "Noah", "Wells", "noah@mesa.example", "+1 555 0191", "mesa", "sam"]
  ] as const;

  const entries = await Promise.all(
    data.map(([key, firstName, lastName, email, phone, organizationKey, ownerKey]) =>
      prisma.person.create({
        data: {
          workspaceId,
          ownerId: owners[ownerKey].id,
          organizationId: organizations[organizationKey].id,
          firstName,
          lastName,
          email,
          phone
        }
      }).then((person) => [key, person] as const)
    )
  );
  return Object.fromEntries(entries);
}

async function createDeals(
  workspaceId: string,
  pipelineId: string,
  stages: StageMap,
  owners: Owners,
  organizations: OrganizationMap,
  people: PersonMap
) {
  const data: DealSeed[] = [
    ["orbitPilot", "Orbit Labs pilot", "qualified", "alex", "orbit", "priya", 1800000, DealStatus.OPEN, 21],
    ["orbitExpansion", "Orbit Labs enterprise expansion", "proposal", "sam", "orbit", "mateo", 6400000, DealStatus.OPEN, 35],
    ["canopyExpansion", "Canopy Works expansion", "proposal", "sam", "canopy", "jordan", 4200000, DealStatus.OPEN, 28],
    ["canopyRollout", "Canopy partner rollout", "negotiation", "alex", "canopy", "tessa", 2750000, DealStatus.OPEN, 14],
    ["northlineFleet", "Northline robotics fleet program", "discovery", "alex", "northline", "nina", 5200000, DealStatus.OPEN, 45],
    ["northlineSecurity", "Northline security review package", "qualified", "sam", "northline", "asher", 1600000, DealStatus.OPEN, 18],
    ["lumenHarbor", "Lumen Harbor coastal operations", "negotiation", "sam", "lumen", "owen", 7100000, DealStatus.OPEN, 12],
    ["lumenAnalytics", "Lumen Harbor analytics sprint", "closed", "alex", "lumen", "greta", 2200000, DealStatus.WON, -5],
    ["atlasKitchen", "Atlas Kitchens franchise rollout", "discovery", "alex", "atlas", "mara", 3900000, DealStatus.OPEN, 32],
    ["cinderRisk", "Cinder Finance risk workflow", "proposal", "sam", "cinder", "eli", 5800000, DealStatus.OPEN, 25],
    ["brightpathCare", "Brightpath care team pilot", "qualified", "alex", "brightpath", "hana", 1250000, DealStatus.OPEN, 9],
    ["brightpathNetwork", "Brightpath regional network", "closed", "alex", "brightpath", "lena", 3600000, DealStatus.WON, -18],
    ["evergreenDispatch", "Evergreen dispatch modernization", "negotiation", "sam", "evergreen", "victor", 8300000, DealStatus.OPEN, 20],
    ["mesaCloud", "Mesa Cloud platform migration", "proposal", "alex", "mesa", "riley", 4900000, DealStatus.OPEN, 40],
    ["mesaRenewal", "Mesa Cloud renewal save", "closed", "sam", "mesa", "noah", 2100000, DealStatus.LOST, -11],
    ["solaceSupply", "Solace Supply vendor portal", "discovery", "sam", "solace", "imani", 3100000, DealStatus.OPEN, 27],
    ["orbitBenchmark", "Orbit benchmark study", "closed", "alex", "orbit", "priya", 950000, DealStatus.WON, -30],
    ["cinderArchive", "Cinder archive migration", "closed", "sam", "cinder", "eli", 1750000, DealStatus.LOST, -22],
    ["atlasTraining", "Atlas manager training package", "qualified", "alex", "atlas", "mara", 880000, DealStatus.OPEN, 16],
    ["evergreenKiosk", "Evergreen station kiosk pilot", "proposal", "sam", "evergreen", "victor", 2450000, DealStatus.OPEN, 37]
  ];

  const entries = await Promise.all(
    data.map(([key, title, stageKey, ownerKey, organizationKey, personKey, valueCents, status, expectedCloseOffset]) =>
      prisma.deal.create({
        data: {
          workspaceId,
          pipelineId,
          stageId: stages[stageKey].id,
          ownerId: owners[ownerKey].id,
          personId: people[personKey].id,
          organizationId: organizations[organizationKey].id,
          title,
          valueCents,
          currency: "USD",
          status,
          expectedCloseAt: daysFromNow(expectedCloseOffset)
        }
      }).then((deal) => [key, deal] as const)
    )
  );
  return Object.fromEntries(entries);
}

async function createLeads(workspaceId: string, owners: Owners, organizations: OrganizationMap, people: PersonMap) {
  const data: LeadSeed[] = [
    ["orbitReferral", "Orbit Labs referral", "Partner referral", LeadStatus.NEW, "alex", "orbit", "priya"],
    ["canopyWebinar", "Canopy webinar attendee", "Webinar", LeadStatus.QUALIFIED, "sam", "canopy", "jordan"],
    ["northlineOutbound", "Northline outbound sequence", "Outbound", LeadStatus.NEW, "alex", "northline", "nina"],
    ["lumenEvent", "Lumen Harbor trade show lead", "Trade show", LeadStatus.QUALIFIED, "sam", "lumen", "owen"],
    ["atlasInbound", "Atlas Kitchens inbound demo", "Website", LeadStatus.NEW, "alex", "atlas", "mara"],
    ["cinderPodcast", "Cinder Finance podcast listener", "Podcast", LeadStatus.DISQUALIFIED, "sam", "cinder", "eli"],
    ["brightpathPartner", "Brightpath partner intro", "Partner referral", LeadStatus.QUALIFIED, "alex", "brightpath", "hana"],
    ["evergreenRfp", "Evergreen RFP inquiry", "RFP", LeadStatus.NEW, "sam", "evergreen", "victor"],
    ["mesaOrbitSearch", "Mesa Cloud orbit search campaign", "Paid search", LeadStatus.NEW, "alex", "mesa", "riley"],
    ["solaceNewsletter", "Solace Supply newsletter reply", "Newsletter", LeadStatus.QUALIFIED, "sam", "solace", "imani"],
    ["lumenConverted", "Lumen Harbor converted pilot lead", "Trade show", LeadStatus.CONVERTED, "alex", "lumen", "greta"],
    ["mesaDormant", "Mesa dormant trial", "Website", LeadStatus.DISQUALIFIED, "sam", "mesa", "noah"]
  ];

  const entries = await Promise.all(
    data.map(([key, title, source, status, ownerKey, organizationKey, personKey]) =>
      prisma.lead.create({
        data: {
          workspaceId,
          ownerId: owners[ownerKey].id,
          personId: people[personKey].id,
          organizationId: organizations[organizationKey].id,
          title,
          source,
          status
        }
      }).then((lead) => [key, lead] as const)
    )
  );
  return Object.fromEntries(entries);
}

async function createActivities(
  workspaceId: string,
  owners: Owners,
  organizations: OrganizationMap,
  people: PersonMap,
  deals: DealMap,
  leads: LeadMap
) {
  const data: ActivitySeed[] = [
    ["alex", "orbitPilot", "priya", "orbit", null, ActivityType.MEETING, "Run pilot success review", 2, null],
    ["sam", "orbitExpansion", "mateo", "orbit", null, ActivityType.CALL, "Map Orbit procurement path", 5, null],
    ["sam", "canopyExpansion", "jordan", "canopy", null, ActivityType.CALL, "Confirm Canopy procurement timeline", 4, null],
    ["alex", "canopyRollout", "tessa", "canopy", null, ActivityType.TASK, "Send rollout pricing options", 1, null],
    ["alex", "northlineFleet", "nina", "northline", null, ActivityType.MEETING, "Northline robotics discovery workshop", -3, null],
    ["sam", "northlineSecurity", "asher", "northline", null, ActivityType.EMAIL, "Share Northline security packet", 0, null],
    ["sam", "lumenHarbor", "owen", "lumen", null, ActivityType.MEETING, "Review Lumen Harbor legal comments", 3, null],
    ["alex", "atlasKitchen", "mara", "atlas", null, ActivityType.CALL, "Atlas franchise stakeholder call", 7, null],
    ["sam", "cinderRisk", "eli", "cinder", null, ActivityType.TASK, "Cinder risk workflow ROI draft", -1, null],
    ["alex", "brightpathCare", "hana", "brightpath", null, ActivityType.EMAIL, "Brightpath pilot recap email", 0, null],
    ["sam", "evergreenDispatch", "victor", "evergreen", null, ActivityType.MEETING, "Evergreen dispatch executive review", 8, null],
    ["alex", "mesaCloud", "riley", "mesa", null, ActivityType.CALL, "Mesa Cloud migration scoping", 12, null],
    ["sam", "solaceSupply", "imani", "solace", null, ActivityType.TASK, "Solace portal requirements checklist", 6, null],
    ["alex", "orbitBenchmark", "priya", "orbit", null, ActivityType.MEETING, "Orbit benchmark handoff completed", -28, -27],
    ["sam", "cinderArchive", "eli", "cinder", null, ActivityType.CALL, "Cinder loss review", -18, -18],
    ["alex", null, "priya", "orbit", "orbitReferral", ActivityType.EMAIL, "Reply to Orbit referral", 1, null],
    ["sam", null, "jordan", "canopy", "canopyWebinar", ActivityType.CALL, "Qualify Canopy webinar interest", 2, null],
    ["alex", null, "nina", "northline", "northlineOutbound", ActivityType.TASK, "Send Northline outbound follow-up", -2, null],
    ["sam", null, "owen", "lumen", "lumenEvent", ActivityType.MEETING, "Meet Lumen event contact", 9, null],
    ["alex", null, "mara", "atlas", "atlasInbound", ActivityType.CALL, "Atlas inbound qualification call", 0, null],
    ["sam", null, "eli", "cinder", "cinderPodcast", ActivityType.EMAIL, "Archive Cinder podcast lead", -7, -6],
    ["alex", null, "hana", "brightpath", "brightpathPartner", ActivityType.MEETING, "Brightpath partner intro call", 11, null],
    ["sam", null, "victor", "evergreen", "evergreenRfp", ActivityType.TASK, "Evergreen RFP checklist", 14, null],
    ["alex", null, "riley", "mesa", "mesaOrbitSearch", ActivityType.EMAIL, "Send Mesa orbit campaign content", 4, null],
    ["sam", null, "imani", "solace", "solaceNewsletter", ActivityType.CALL, "Solace newsletter reply call", -4, null],
    ["alex", null, "greta", "lumen", null, ActivityType.TASK, "Update Lumen Harbor customer story", 18, null],
    ["sam", null, "noah", "mesa", null, ActivityType.EMAIL, "Mesa dormant trial wrap-up", -10, -10]
  ];

  await prisma.activity.createMany({
    data: data.map(([ownerKey, dealKey, personKey, organizationKey, leadKey, type, title, dueOffset, completedOffset]) => ({
      workspaceId,
      ownerId: owners[ownerKey].id,
      dealId: dealKey ? deals[dealKey].id : null,
      leadId: leadKey ? leads[leadKey].id : null,
      personId: people[personKey].id,
      organizationId: organizations[organizationKey].id,
      type,
      title,
      dueAt: daysFromNow(dueOffset),
      completedAt: completedOffset == null ? null : daysFromNow(completedOffset)
    }))
  });
}

async function createNotes(
  workspaceId: string,
  owners: Owners,
  organizations: OrganizationMap,
  people: PersonMap,
  deals: DealMap,
  leads: LeadMap
) {
  const data: NoteSeed[] = [
    ["alex", "orbitPilot", "priya", "orbit", null, "Priya wants a lightweight Orbit pilot with clear implementation milestones."],
    ["sam", "orbitExpansion", "mateo", "orbit", null, "Orbit expansion team asked for benchmark proof and a security worksheet."],
    ["sam", "canopyExpansion", "jordan", "canopy", null, "Canopy has budget approved, but legal needs security documentation."],
    ["alex", "canopyRollout", "tessa", "canopy", null, "Partner rollout depends on executive alignment before quarter end."],
    ["alex", "northlineFleet", "nina", "northline", null, "Northline robotics team is evaluating deployment effort across three warehouses."],
    ["sam", "lumenHarbor", "owen", "lumen", null, "Lumen Harbor requested implementation staffing assumptions."],
    ["alex", "atlasKitchen", "mara", "atlas", null, "Atlas franchise owners care about onboarding time and manager training."],
    ["sam", "cinderRisk", "eli", "cinder", null, "Cinder Finance is comparing workflow risk controls against a legacy vendor."],
    ["alex", "brightpathCare", "hana", "brightpath", null, "Brightpath care team wants a patient-safety review in the next meeting."],
    ["sam", "evergreenDispatch", "victor", "evergreen", null, "Evergreen Transit needs proof that dispatch teams can adopt quickly."],
    ["alex", "mesaCloud", "riley", "mesa", null, "Mesa Cloud migration search keyword: orbit resilience."],
    ["sam", "solaceSupply", "imani", "solace", null, "Solace Supply is focused on vendor portal visibility and approvals."],
    ["alex", null, "priya", "orbit", "orbitReferral", "Referral came from the Orbit advisory board; strong search keyword: northstar orbit."],
    ["sam", null, "jordan", "canopy", "canopyWebinar", "Jordan asked for a short webinar follow-up and pricing overview."],
    ["alex", null, "nina", "northline", "northlineOutbound", "Outbound note: mention robotics uptime benchmark."],
    ["sam", null, "owen", "lumen", "lumenEvent", "Trade show conversation centered on coastal operations scheduling."],
    ["alex", null, "mara", "atlas", "atlasInbound", "Website demo request mentioned multi-location training."],
    ["sam", null, "eli", "cinder", "cinderPodcast", "Podcast lead was not a fit this quarter."],
    ["alex", null, "hana", "brightpath", "brightpathPartner", "Partner intro included the Brightpath regional operations lead."],
    ["sam", null, "victor", "evergreen", "evergreenRfp", "RFP timeline likely opens after internal budget review."]
  ];

  await prisma.note.createMany({
    data: data.map(([authorKey, dealKey, personKey, organizationKey, leadKey, body]) => ({
      workspaceId,
      authorId: owners[authorKey].id,
      dealId: dealKey ? deals[dealKey].id : null,
      leadId: leadKey ? leads[leadKey].id : null,
      personId: people[personKey].id,
      organizationId: organizations[organizationKey].id,
      body
    }))
  });
}

async function createEmailLogs(
  workspaceId: string,
  owners: Owners,
  organizations: OrganizationMap,
  people: PersonMap,
  deals: DealMap
) {
  const data: EmailLogSeed[] = [
    [
      "alex",
      "orbitExpansion",
      "mateo",
      "orbit",
      EmailDirection.OUTBOUND,
      "NDA sent for Orbit enterprise expansion",
      "Alex Morgan <alex@example.test>",
      "Mateo Reed <mateo@orbitlabs.example>",
      null,
      "Mateo - attaching the NDA for the enterprise expansion review. Once legal confirms, we can finalize the security worksheet and procurement timeline.",
      -6
    ],
    [
      "sam",
      "lumenHarbor",
      "owen",
      "lumen",
      EmailDirection.INBOUND,
      "MSA follow-up from Lumen legal",
      "Owen Kim <owen@lumenharbor.example>",
      "Sam Rivera <sam@example.test>",
      "Greta Miles <greta@lumenharbor.example>",
      "Sam, legal is aligned on the MSA structure. The remaining review item is implementation staffing language for the coastal operations rollout.",
      -4
    ],
    [
      "alex",
      "atlasTraining",
      "mara",
      "atlas",
      EmailDirection.OUTBOUND,
      "Quote shared for manager training package",
      "Alex Morgan <alex@example.test>",
      "Mara Stone <mara@atlaskitchens.example>",
      null,
      "Mara - I shared Q-DEMO-0006 with the training package and success support line item. The quote reflects the first manager cohort and can expand after the pilot.",
      -2
    ],
    [
      "sam",
      "evergreenKiosk",
      "victor",
      "evergreen",
      EmailDirection.INBOUND,
      "SOW review blocker for kiosk pilot",
      "Victor Ng <victor@evergreentransit.example>",
      "Sam Rivera <sam@example.test>",
      null,
      "Sam, procurement flagged the SOW dependency on station access windows. We need the pilot schedule clarified before legal can unblock the document.",
      -1
    ]
  ];

  await prisma.emailLog.createMany({
    data: data.map(([ownerKey, dealKey, personKey, organizationKey, direction, subject, fromText, toText, ccText, body, occurredOffset]) => ({
      workspaceId,
      createdById: owners[ownerKey].id,
      dealId: deals[dealKey].id,
      personId: people[personKey].id,
      organizationId: organizations[organizationKey].id,
      direction,
      subject,
      fromText,
      toText,
      ccText,
      body,
      occurredAt: daysFromNow(occurredOffset)
    }))
  });
}

async function createAuditLogs(workspaceId: string, owners: Owners, deals: DealMap, leads: LeadMap) {
  const dealEvents = Object.values(deals).flatMap((deal) => {
    const events: Prisma.AuditLogCreateManyInput[] = [
      {
        workspaceId,
        actorId: deal.ownerId,
        action: "deal.created",
        entityType: "Deal",
        entityId: deal.id,
        metadata: { title: deal.title, seedVersion: 2 }
      }
    ];

    if (deal.status === DealStatus.WON || deal.status === DealStatus.LOST) {
      events.push({
        workspaceId,
        actorId: deal.ownerId,
        action: deal.status === DealStatus.WON ? "deal.won" : "deal.lost",
        entityType: "Deal",
        entityId: deal.id,
        metadata: {
          previousStatus: "OPEN",
          nextStatus: deal.status,
          lostReason: deal.status === DealStatus.LOST ? "Timing and priority changed during evaluation." : undefined
        }
      });
    }

    return events;
  });

  const leadEvents = Object.values(leads).map((lead) => ({
    workspaceId,
    actorId: lead.ownerId ?? owners.alex.id,
    action: lead.status === LeadStatus.CONVERTED ? "lead.converted" : "lead.created",
    entityType: "Lead",
    entityId: lead.id,
    metadata: { title: lead.title, source: lead.source, seedVersion: 2 }
  }));

  await prisma.auditLog.createMany({ data: [...dealEvents, ...leadEvents] });
}

async function createCustomFieldExamples(
  workspaceId: string,
  organizations: OrganizationMap,
  people: PersonMap,
  deals: DealMap,
  leads: LeadMap
) {
  const riskField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "Implementation Risk",
      key: "implementation_risk",
      fieldType: CustomFieldType.SELECT,
      options: ["Low", "Medium", "High"]
    }
  });

  const championField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "Executive Champion",
      key: "executive_champion",
      fieldType: CustomFieldType.TEXT
    }
  });

  const contractTypeField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "Contract Type",
      key: "contract_type",
      fieldType: CustomFieldType.TEXT
    }
  });

  const ndaStatusField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "NDA Status",
      key: "nda_status",
      fieldType: CustomFieldType.SELECT,
      options: contractStatusOptions()
    }
  });

  const msaStatusField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "MSA Status",
      key: "msa_status",
      fieldType: CustomFieldType.SELECT,
      options: contractStatusOptions()
    }
  });

  const sowStatusField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "SOW Status",
      key: "sow_status",
      fieldType: CustomFieldType.SELECT,
      options: contractStatusOptions()
    }
  });

  const renewalDateField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "Renewal Date",
      key: "renewal_date",
      fieldType: CustomFieldType.DATE
    }
  });

  const priorityAccountField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.DEAL,
      name: "Priority Account",
      key: "priority_account",
      fieldType: CustomFieldType.BOOLEAN
    }
  });

  const preferredChannelField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.PERSON,
      name: "Preferred Channel",
      key: "preferred_channel",
      fieldType: CustomFieldType.TEXT
    }
  });

  const decisionRoleField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.PERSON,
      name: "Decision Role",
      key: "decision_role",
      fieldType: CustomFieldType.TEXT
    }
  });

  const nurtureScoreField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.PERSON,
      name: "Nurture Score",
      key: "nurture_score",
      fieldType: CustomFieldType.NUMBER
    }
  });

  const industrySegmentField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.ORGANIZATION,
      name: "Industry Segment",
      key: "industry_segment",
      fieldType: CustomFieldType.TEXT
    }
  });

  const employeeCountField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.ORGANIZATION,
      name: "Employee Count",
      key: "employee_count",
      fieldType: CustomFieldType.NUMBER
    }
  });

  const strategicAccountField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.ORGANIZATION,
      name: "Strategic Account",
      key: "strategic_account",
      fieldType: CustomFieldType.BOOLEAN
    }
  });

  const qualificationScoreField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.LEAD,
      name: "Qualification Score",
      key: "qualification_score",
      fieldType: CustomFieldType.NUMBER
    }
  });

  const sourceDetailField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.LEAD,
      name: "Source Detail",
      key: "source_detail",
      fieldType: CustomFieldType.TEXT
    }
  });

  const targetCloseWindowField = await prisma.customFieldDefinition.create({
    data: {
      workspaceId,
      entityType: CustomFieldEntityType.LEAD,
      name: "Target Close Window",
      key: "target_close_window",
      fieldType: CustomFieldType.DATE
    }
  });

  await prisma.customFieldValue.createMany({
    data: [
      {
        workspaceId,
        fieldId: riskField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.orbitPilot.id,
        value: "Medium"
      },
      {
        workspaceId,
        fieldId: riskField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.evergreenDispatch.id,
        value: "High"
      },
      {
        workspaceId,
        fieldId: championField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.lumenHarbor.id,
        value: "Owen Kim"
      },
      {
        workspaceId,
        fieldId: contractTypeField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.orbitExpansion.id,
        value: "Enterprise subscription"
      },
      {
        workspaceId,
        fieldId: contractTypeField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.canopyRollout.id,
        value: "Partner rollout"
      },
      {
        workspaceId,
        fieldId: ndaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.orbitExpansion.id,
        value: "Signed"
      },
      {
        workspaceId,
        fieldId: msaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.orbitExpansion.id,
        value: "In Review"
      },
      {
        workspaceId,
        fieldId: sowStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.orbitExpansion.id,
        value: "Requested"
      },
      {
        workspaceId,
        fieldId: ndaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.lumenHarbor.id,
        value: "Signed"
      },
      {
        workspaceId,
        fieldId: msaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.lumenHarbor.id,
        value: "Signed"
      },
      {
        workspaceId,
        fieldId: sowStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.lumenHarbor.id,
        value: "In Review"
      },
      {
        workspaceId,
        fieldId: ndaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.canopyRollout.id,
        value: "Signed"
      },
      {
        workspaceId,
        fieldId: msaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.canopyRollout.id,
        value: "Requested"
      },
      {
        workspaceId,
        fieldId: sowStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.canopyRollout.id,
        value: "Not Started"
      },
      {
        workspaceId,
        fieldId: ndaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.atlasTraining.id,
        value: "Signed"
      },
      {
        workspaceId,
        fieldId: msaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.atlasTraining.id,
        value: "Sent"
      },
      {
        workspaceId,
        fieldId: sowStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.atlasTraining.id,
        value: "In Review"
      },
      {
        workspaceId,
        fieldId: ndaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.evergreenKiosk.id,
        value: "Requested"
      },
      {
        workspaceId,
        fieldId: msaStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.evergreenKiosk.id,
        value: "Not Started"
      },
      {
        workspaceId,
        fieldId: sowStatusField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.evergreenKiosk.id,
        value: "Blocked"
      },
      {
        workspaceId,
        fieldId: renewalDateField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.mesaCloud.id,
        value: "2026-09-15"
      },
      {
        workspaceId,
        fieldId: priorityAccountField.id,
        entityType: CustomFieldEntityType.DEAL,
        entityId: deals.evergreenDispatch.id,
        value: true
      },
      {
        workspaceId,
        fieldId: preferredChannelField.id,
        entityType: CustomFieldEntityType.PERSON,
        entityId: people.priya.id,
        value: "Email"
      },
      {
        workspaceId,
        fieldId: preferredChannelField.id,
        entityType: CustomFieldEntityType.PERSON,
        entityId: people.victor.id,
        value: "Phone"
      },
      {
        workspaceId,
        fieldId: decisionRoleField.id,
        entityType: CustomFieldEntityType.PERSON,
        entityId: people.mateo.id,
        value: "Economic buyer"
      },
      {
        workspaceId,
        fieldId: nurtureScoreField.id,
        entityType: CustomFieldEntityType.PERSON,
        entityId: people.hana.id,
        value: 82
      },
      {
        workspaceId,
        fieldId: industrySegmentField.id,
        entityType: CustomFieldEntityType.ORGANIZATION,
        entityId: organizations.orbit.id,
        value: "SaaS"
      },
      {
        workspaceId,
        fieldId: industrySegmentField.id,
        entityType: CustomFieldEntityType.ORGANIZATION,
        entityId: organizations.evergreen.id,
        value: "Transit"
      },
      {
        workspaceId,
        fieldId: employeeCountField.id,
        entityType: CustomFieldEntityType.ORGANIZATION,
        entityId: organizations.northline.id,
        value: 1250
      },
      {
        workspaceId,
        fieldId: strategicAccountField.id,
        entityType: CustomFieldEntityType.ORGANIZATION,
        entityId: organizations.lumen.id,
        value: true
      },
      {
        workspaceId,
        fieldId: qualificationScoreField.id,
        entityType: CustomFieldEntityType.LEAD,
        entityId: leads.canopyWebinar.id,
        value: 76
      },
      {
        workspaceId,
        fieldId: qualificationScoreField.id,
        entityType: CustomFieldEntityType.LEAD,
        entityId: leads.lumenConverted.id,
        value: 91
      },
      {
        workspaceId,
        fieldId: sourceDetailField.id,
        entityType: CustomFieldEntityType.LEAD,
        entityId: leads.orbitReferral.id,
        value: "Advisor referral from Orbit board"
      },
      {
        workspaceId,
        fieldId: targetCloseWindowField.id,
        entityType: CustomFieldEntityType.LEAD,
        entityId: leads.evergreenRfp.id,
        value: "2026-10-31"
      }
    ]
  });
}

function contractStatusOptions() {
  return ["Not Started", "Requested", "In Review", "Sent", "Signed", "Blocked"];
}

async function resetWorkspace(workspaceId: string) {
  await prisma.job.deleteMany({ where: { workspaceId } });
  await prisma.auditLog.deleteMany({ where: { workspaceId } });
  await prisma.savedView.deleteMany({ where: { workspaceId } });
  await prisma.customFieldValue.deleteMany({ where: { workspaceId } });
  await prisma.customFieldDefinition.deleteMany({ where: { workspaceId } });
  await prisma.emailLog.deleteMany({ where: { workspaceId } });
  await prisma.emailTemplate.deleteMany({ where: { workspaceId } });
  await prisma.emailConnectionSecret.deleteMany({ where: { workspaceId } });
  await prisma.emailConnection.deleteMany({ where: { workspaceId } });
  await prisma.quotePublicLink.deleteMany({ where: { workspaceId } });
  await prisma.quoteItem.deleteMany({ where: { workspaceId } });
  await prisma.quote.deleteMany({ where: { workspaceId } });
  await prisma.dealLineItem.deleteMany({ where: { workspaceId } });
  await prisma.note.deleteMany({ where: { workspaceId } });
  await prisma.activity.deleteMany({ where: { workspaceId } });
  await prisma.deal.deleteMany({ where: { workspaceId } });
  await prisma.lead.deleteMany({ where: { workspaceId } });
  await prisma.person.deleteMany({ where: { workspaceId } });
  await prisma.organization.deleteMany({ where: { workspaceId } });
  await prisma.product.deleteMany({ where: { workspaceId } });
  await prisma.pipelineStage.deleteMany({ where: { workspaceId } });
  await prisma.pipeline.deleteMany({ where: { workspaceId } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId } });
}

function daysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

type Owners = {
  alex: Awaited<ReturnType<typeof prisma.user.upsert>>;
  sam: Awaited<ReturnType<typeof prisma.user.upsert>>;
};
type StageMap = Awaited<ReturnType<typeof createStages>>;
type OrganizationMap = Awaited<ReturnType<typeof createOrganizations>>;
type PersonMap = Awaited<ReturnType<typeof createPeople>>;
type DealMap = Awaited<ReturnType<typeof createDeals>>;
type LeadMap = Awaited<ReturnType<typeof createLeads>>;
type ProductMap = Awaited<ReturnType<typeof createProducts>>;
type OwnerKey = keyof Owners;
type StageKey = keyof StageMap;
type OrganizationKey = keyof OrganizationMap;
type PersonKey = keyof PersonMap;
type DealKey = keyof DealMap;
type LeadKey = keyof LeadMap;
type ProductKey = keyof ProductMap;
type DealSeed = [
  string,
  string,
  StageKey,
  OwnerKey,
  OrganizationKey,
  PersonKey,
  number,
  DealStatus,
  number
];
type LeadSeed = [string, string, string, LeadStatus, OwnerKey, OrganizationKey, PersonKey];
type ActivitySeed = [
  OwnerKey,
  DealKey | null,
  PersonKey,
  OrganizationKey,
  LeadKey | null,
  ActivityType,
  string,
  number,
  number | null
];
type NoteSeed = [OwnerKey, DealKey | null, PersonKey, OrganizationKey, LeadKey | null, string];
type EmailLogSeed = [
  OwnerKey,
  DealKey,
  PersonKey,
  OrganizationKey,
  EmailDirection,
  string,
  string,
  string,
  string | null,
  string,
  number
];
type CommercialSeed = [DealKey, ProductKey, number, string, string, QuoteStatus];

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
