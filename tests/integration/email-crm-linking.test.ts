import { ActivityType } from "@prisma/client";
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

describe("manual EmailLog CRM linking assistance", () => {
  it("suggests an exact contact match and links only after review", async () => {
    const fx = currentFixture();
    const emailLog = await createUnlinkedEmailLog(fx, {
      fromText: `Alpha Buyer <${fx.recordsA.person.email}>`,
      providerThreadId: "thread-exact-contact",
      subject: "Pricing discussion"
    });
    await fx.prisma.emailLog.update({
      where: { id: emailLog.id },
      data: {
        smartLabelGeneratedAt: new Date("2030-02-01T12:00:00.000Z"),
        smartLabelJson: {
          category: "PROSPECT",
          confidence: 0.9,
          evidence: ["Pricing discussion from a known buyer."],
          signals: ["NEEDS_REPLY", "POTENTIAL_LEAD"],
          summary: "Prospect pricing thread."
        },
        smartLabelProvider: "test-provider"
      }
    });

    const suggestions = await crm.listEmailCrmLinkSuggestions(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);

    expect(suggestions.get(emailLog.id)).toMatchObject({
      alreadyLinked: false,
      primarySuggestion: {
        confidence: "high",
        label: "Alpha Contact",
        recordId: fx.recordsA.person.id,
        source: "exact_email",
        type: "PERSON",
        why: "Exact participant email matched an existing contact."
      }
    });
    expect(suggestions.get(emailLog.id)?.alternativeSuggestions.map((suggestion) => suggestion.type)).toEqual(
      expect.arrayContaining(["DEAL", "LEAD", "ORGANIZATION"])
    );
    const reviewSummary = crm.buildEmailCrmLinkReviewSummary({
      emailLogs: [await reloadEmailLog(fx, emailLog.id)],
      suggestions
    });
    expect(reviewSummary).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ count: 1, highConfidenceCount: 4, id: "all" }),
        expect.objectContaining({ count: 1, highConfidenceCount: 4, id: "suggested" })
      ])
    );
    const reviewQueue = crm.buildEmailCrmLinkReviewQueue({
      emailLogs: [await reloadEmailLog(fx, emailLog.id)],
      filter: "suggested",
      suggestions
    });
    expect(reviewQueue).toMatchObject([
      {
        highConfidenceSuggestionCount: 4,
        state: "ready",
        stateLabel: "Ready to review"
      }
    ]);

    const beforeQueue = crm.buildEmailPriorityQueue({ emailLogs: [await reloadEmailLog(fx, emailLog.id)] });
    expect(beforeQueue[0]?.linkedRecord).toBeNull();
    expect(beforeQueue[0]?.nextBestAction.target).toBe("email_card");

    const linked = await crm.linkEmailLogToCrmRecord(fx.actorA, {
      emailLogId: emailLog.id,
      recordId: fx.recordsA.person.id,
      recordType: "PERSON"
    });

    expect(linked.personId).toBe(fx.recordsA.person.id);
    await expect(
      fx.prisma.auditLog.findFirstOrThrow({
        where: { action: "email_log.linked", entityId: emailLog.id, workspaceId: fx.workspaceA.id }
      })
    ).resolves.toMatchObject({ entityType: "EmailLog" });
    const afterQueue = crm.buildEmailPriorityQueue({ emailLogs: [await reloadEmailLog(fx, emailLog.id)] });
    expect(afterQueue[0]?.linkedRecord).toMatchObject({
      href: `/contacts/${fx.recordsA.person.id}`,
      label: "Alpha Contact",
      type: "person"
    });
    const afterSuggestions = await crm.listEmailCrmLinkSuggestions(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);
    expect(
      crm.buildEmailCrmLinkReviewQueue({
        emailLogs: [await reloadEmailLog(fx, emailLog.id)],
        suggestions: afterSuggestions
      })
    ).toEqual([]);
  });

  it("keeps multiple exact candidates unresolved instead of guessing", async () => {
    const fx = currentFixture();
    const sharedEmail = "shared-buyer@example.test";
    const duplicatePerson = await fx.prisma.person.create({
      data: {
        email: sharedEmail,
        firstName: "Shared",
        lastName: "Buyer",
        ownerId: fx.userA.id,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.person.update({
      where: { id: fx.recordsA.person.id },
      data: { email: sharedEmail }
    });
    const emailLog = await createUnlinkedEmailLog(fx, {
      fromText: `Shared buyer <${sharedEmail}>`,
      subject: "Ambiguous buyer"
    });

    const suggestions = await crm.listEmailCrmLinkSuggestions(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);

    expect(suggestions.get(emailLog.id)?.primarySuggestion).toBeNull();
    expect(
      suggestions
        .get(emailLog.id)
        ?.alternativeSuggestions.filter((suggestion) => suggestion.type === "PERSON")
        .map((suggestion) => suggestion.recordId)
    ).toEqual(expect.arrayContaining([fx.recordsA.person.id, duplicatePerson.id]));
    expect(
      crm.buildEmailCrmLinkReviewQueue({
        emailLogs: [await reloadEmailLog(fx, emailLog.id)],
        filter: "ambiguous",
        suggestions
      })
    ).toMatchObject([{ state: "ambiguous", stateLabel: "Unresolved" }]);
  });

  it("reports no reliable match without leaking cross-workspace records", async () => {
    const fx = currentFixture();
    const emailLog = await createUnlinkedEmailLog(fx, {
      fromText: `Beta Contact <${fx.recordsB.person.email}>`,
      subject: "Other workspace buyer"
    });

    const suggestions = await crm.listEmailCrmLinkSuggestions(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);

    expect(suggestions.get(emailLog.id)).toMatchObject({
      alternativeSuggestions: [],
      noReliableMatchReason: "No reliable CRM match found.",
      primarySuggestion: null
    });
    expect(
      crm.buildEmailCrmLinkReviewQueue({
        emailLogs: [await reloadEmailLog(fx, emailLog.id)],
        filter: "no-match",
        suggestions
      })
    ).toMatchObject([{ state: "no_match", stateLabel: "No reliable match" }]);
  });

  it("suggests confirmed organization domains including subdomains", async () => {
    const fx = currentFixture();
    await fx.prisma.organization.update({
      where: { id: fx.recordsA.organization.id },
      data: { domain: "veridian.info" }
    });
    const emailLog = await createUnlinkedEmailLog(fx, {
      fromText: "Support <support@mail.veridian.info>",
      subject: "Domain-backed account"
    });

    const suggestions = await crm.listEmailCrmLinkSuggestions(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);

    expect(suggestions.get(emailLog.id)?.primarySuggestion).toMatchObject({
      confidence: "medium",
      recordId: fx.recordsA.organization.id,
      source: "organization_domain",
      type: "ORGANIZATION"
    });
  });

  it("rejects cross-workspace links and prevents conflicting duplicate links", async () => {
    const fx = currentFixture();
    const emailLog = await createUnlinkedEmailLog(fx, {
      fromText: `Alpha Buyer <${fx.recordsA.person.email}>`,
      subject: "Link guard"
    });

    await expect(
      crm.linkEmailLogToCrmRecord(fx.actorA, {
        emailLogId: emailLog.id,
        recordId: fx.recordsB.person.id,
        recordType: "PERSON"
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await crm.linkEmailLogToCrmRecord(fx.actorA, {
      emailLogId: emailLog.id,
      recordId: fx.recordsA.person.id,
      recordType: "PERSON"
    });
    await expect(
      crm.linkEmailLogToCrmRecord(fx.actorA, {
        emailLogId: emailLog.id,
        recordId: fx.recordsA.organization.id,
        recordType: "ORGANIZATION"
      })
    ).rejects.toMatchObject({ code: "EMAIL_LOG_ALREADY_LINKED" });

    const sameLink = await crm.linkEmailLogToCrmRecord(fx.actorA, {
      emailLogId: emailLog.id,
      recordId: fx.recordsA.person.id,
      recordType: "PERSON"
    });
    expect(sameLink.personId).toBe(fx.recordsA.person.id);
  });

  it("preserves durable follow-up state after linking an email", async () => {
    const fx = currentFixture();
    const emailLog = await createUnlinkedEmailLog(fx, {
      fromText: `Alpha Buyer <${fx.recordsA.person.email}>`,
      subject: "Follow-up still linked"
    });
    const activity = await fx.prisma.activity.create({
      data: {
        dueAt: new Date("2030-02-05T00:00:00.000Z"),
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        title: "Review buyer reply",
        type: ActivityType.EMAIL,
        workspaceId: fx.workspaceA.id
      }
    });
    await fx.prisma.emailLogActivityLink.create({
      data: {
        activityId: activity.id,
        emailLogId: emailLog.id,
        workspaceId: fx.workspaceA.id
      }
    });
    const beforeDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);
    expect(beforeDetails.get(emailLog.id)?.state).toBe("created");

    await crm.linkEmailLogToCrmRecord(fx.actorA, {
      emailLogId: emailLog.id,
      recordId: fx.recordsA.person.id,
      recordType: "PERSON"
    });

    const afterDetails = await crm.listEmailPriorityFollowUpDetails(fx.actorA, [await reloadEmailLog(fx, emailLog.id)]);
    expect(afterDetails.get(emailLog.id)).toMatchObject({
      followUps: [
        {
          id: activity.id,
          status: "open",
          title: "Review buyer reply"
        }
      ],
      state: "created"
    });
  });
});

async function createUnlinkedEmailLog(
  fx: Fixture,
  overrides: {
    fromText: string;
    providerThreadId?: string;
    subject: string;
  }
) {
  return fx.prisma.emailLog.create({
    data: {
      body: "Stored Gmail body for manual CRM linking review.",
      direction: "INBOUND",
      fromText: overrides.fromText,
      occurredAt: new Date("2030-02-01T12:00:00.000Z"),
      provider: "GOOGLE_WORKSPACE",
      providerMessageId: `${overrides.subject.toLowerCase().replace(/\W+/g, "-")}-${Math.random().toString(36).slice(2)}`,
      providerThreadId: overrides.providerThreadId ?? null,
      subject: overrides.subject,
      toText: "sales@example.test",
      workspaceId: fx.workspaceA.id,
      createdById: fx.userA.id
    }
  });
}

async function reloadEmailLog(fx: Fixture, id: string) {
  return fx.prisma.emailLog.findFirstOrThrow({
    where: { id, workspaceId: fx.workspaceA.id },
    include: { deal: true, emailConnection: true, lead: true, organization: true, person: true }
  });
}

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
