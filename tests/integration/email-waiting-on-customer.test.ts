import { afterAll, describe, expect, it } from "vitest";

import {
  buildWorkInbox,
  listEmailInboxThreads,
} from "@/lib/services/crm";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";

const gmailFullInboxScopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

describe("Email waiting-on-customer tracker", () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("derives waiting state from stored threads while preserving workspace and account scope", async () => {
    const fixture = await createIntegrationFixture();
    try {
      const [salesConnection, supportConnection, otherConnection] =
        await Promise.all([
          fixture.prisma.emailConnection.create({
            data: {
              accountEmail: "sales@northstar.example",
              createdById: fixture.userA.id,
              provider: "GOOGLE_WORKSPACE",
              scopes: gmailFullInboxScopes,
              status: "CONNECTED",
              workspaceId: fixture.workspaceA.id,
            },
          }),
          fixture.prisma.emailConnection.create({
            data: {
              accountEmail: "support@northstar.example",
              createdById: fixture.userA.id,
              provider: "GOOGLE_WORKSPACE",
              scopes: gmailFullInboxScopes,
              status: "CONNECTED",
              workspaceId: fixture.workspaceA.id,
            },
          }),
          fixture.prisma.emailConnection.create({
            data: {
              accountEmail: "other@northstar.example",
              createdById: fixture.userB.id,
              provider: "GOOGLE_WORKSPACE",
              scopes: gmailFullInboxScopes,
              status: "CONNECTED",
              workspaceId: fixture.workspaceB.id,
            },
          }),
        ]);

      await fixture.prisma.emailLog.createMany({
        data: [
          {
            body: "Can you send the procurement checklist?",
            direction: "INBOUND",
            emailConnectionId: salesConnection.id,
            fromText: "Buyer <buyer@example.test>",
            occurredAt: new Date("2030-01-01T09:00:00.000Z"),
            provider: "GOOGLE_WORKSPACE",
            providerLabels: ["INBOX"],
            providerMessageId: "waiting-sales-inbound",
            providerSnippet: "Can you send the procurement checklist?",
            providerThreadId: "waiting-sales-thread",
            subject: "Procurement checklist",
            toText: "Sales <sales@northstar.example>",
            workspaceId: fixture.workspaceA.id,
          },
          {
            body: "We sent the checklist and are waiting for your review.",
            dealId: fixture.recordsA.deal.id,
            direction: "OUTBOUND",
            emailConnectionId: salesConnection.id,
            fromText: "Sales <sales@northstar.example>",
            occurredAt: new Date("2030-01-02T09:00:00.000Z"),
            provider: "GOOGLE_WORKSPACE",
            providerLabels: ["SENT"],
            providerMessageId: "waiting-sales-outbound",
            providerSnippet: "We sent the checklist",
            providerThreadId: "waiting-sales-thread",
            subject: "Re: Procurement checklist",
            toText: "Buyer <buyer@example.test>",
            workspaceId: fixture.workspaceA.id,
          },
          {
            body: "We received it and will review tomorrow.",
            direction: "INBOUND",
            emailConnectionId: salesConnection.id,
            fromText: "Buyer <buyer@example.test>",
            occurredAt: new Date("2030-01-03T09:00:00.000Z"),
            provider: "GOOGLE_WORKSPACE",
            providerLabels: ["INBOX"],
            providerMessageId: "responded-sales-inbound",
            providerSnippet: "We received it",
            providerThreadId: "responded-sales-thread",
            subject: "Re: Proposal check-in",
            toText: "Sales <sales@northstar.example>",
            workspaceId: fixture.workspaceA.id,
          },
          {
            body: "Following up on the support doc.",
            direction: "OUTBOUND",
            emailConnectionId: supportConnection.id,
            fromText: "Support <support@northstar.example>",
            occurredAt: new Date("2030-01-05T08:00:00.000Z"),
            provider: "GOOGLE_WORKSPACE",
            providerLabels: ["SENT"],
            providerMessageId: "waiting-support-outbound",
            providerSnippet: "Following up",
            providerThreadId: "waiting-support-thread",
            subject: "Support doc follow-up",
            toText: "Customer <customer@example.test>",
            workspaceId: fixture.workspaceA.id,
          },
          {
            body: "Cross-workspace outbound should not leak.",
            direction: "OUTBOUND",
            emailConnectionId: otherConnection.id,
            fromText: "Other <other@northstar.example>",
            occurredAt: new Date("2030-01-01T08:00:00.000Z"),
            provider: "GOOGLE_WORKSPACE",
            providerLabels: ["SENT"],
            providerMessageId: "waiting-other-outbound",
            providerSnippet: "Cross-workspace outbound",
            providerThreadId: "waiting-other-thread",
            subject: "Other workspace waiting",
            toText: "Customer <customer@example.test>",
            workspaceId: fixture.workspaceB.id,
          },
        ],
      });

      const countsBefore = await readMutationGuardCounts(fixture);
      const [unifiedThreads, salesThreads, supportThreads] = await Promise.all([
        listEmailInboxThreads(fixture.actorA),
        listEmailInboxThreads(fixture.actorA, {
          connectionId: salesConnection.id,
        }),
        listEmailInboxThreads(fixture.actorA, {
          connectionId: supportConnection.id,
        }),
      ]);

      const unifiedInbox = buildWorkInbox({
        now: new Date("2030-01-06T12:00:00.000Z"),
        selectedTab: "waiting-on-customer",
        threads: unifiedThreads,
      });
      const salesInbox = buildWorkInbox({
        now: new Date("2030-01-06T12:00:00.000Z"),
        selectedTab: "waiting-on-customer",
        threads: salesThreads,
      });
      const supportInbox = buildWorkInbox({
        now: new Date("2030-01-06T12:00:00.000Z"),
        selectedTab: "waiting-on-customer",
        threads: supportThreads,
      });

      expect(unifiedInbox.visibleItems.map((item) => item.thread.subject)).toEqual([
        "Re: Procurement checklist",
        "Support doc follow-up",
      ]);
      expect(
        unifiedInbox.visibleItems.some(
          (item) => item.thread.subject === "Other workspace waiting",
        ),
      ).toBe(false);
      expect(
        unifiedInbox.items.find(
          (item) => item.thread.subject === "Re: Proposal check-in",
        )?.waitingOnCustomer,
      ).toBeNull();
      expect(unifiedInbox.visibleItems[0]).toMatchObject({
        relatedRecordLabel: "Deal: Alpha Needle Deal",
        waitingOnCustomer: expect.objectContaining({
          accountState: "connected",
          bucket: "over-three-days",
          waitLabel: "Waiting 4 days",
        }),
      });
      expect(salesInbox.visibleItems.map((item) => item.thread.subject)).toEqual([
        "Re: Procurement checklist",
      ]);
      expect(supportInbox.visibleItems.map((item) => item.thread.subject)).toEqual([
        "Support doc follow-up",
      ]);
      await expect(readMutationGuardCounts(fixture)).resolves.toEqual(
        countsBefore,
      );
    } finally {
      await fixture.cleanup();
    }
  });
});

async function readMutationGuardCounts(
  fixture: Awaited<ReturnType<typeof createIntegrationFixture>>,
) {
  const where = { workspaceId: fixture.workspaceA.id };
  const [emailLogs, activities, notes, people, organizations, leads, deals] =
    await Promise.all([
      fixture.prisma.emailLog.count({ where }),
      fixture.prisma.activity.count({ where }),
      fixture.prisma.note.count({ where }),
      fixture.prisma.person.count({ where }),
      fixture.prisma.organization.count({ where }),
      fixture.prisma.lead.count({ where }),
      fixture.prisma.deal.count({ where }),
    ]);
  return { activities, deals, emailLogs, leads, notes, organizations, people };
}
