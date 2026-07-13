import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crm from "@/lib/services/crm";
import { createIntegrationFixture } from "./fixtures";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;

let fixture: Fixture | null = null;

describe("CRM change proposal service", () => {
  beforeEach(async () => {
    fixture = await createIntegrationFixture();
  });

  afterEach(async () => {
    if (fixture) await fixture.cleanup();
    fixture = null;
  });

  it("creates, reviews, applies, and idempotently returns a contact create proposal", async () => {
    const fx = currentFixture();
    await allowCrmProposalApplies(fx);

    const proposal = await crm.createCrmChangeProposal(fx.actorA, {
      confidence: "high",
      idempotencyKey: "contact-create-idempotent",
      proposalType: "CREATE_PERSON",
      proposedPayload: {
        fields: {
          email: "proposal-contact@example.test",
          firstName: "Proposal",
          lastName: "Contact",
          phone: "555-0100"
        }
      },
      rationale: "Source suggested a new buyer contact.",
      sourceId: "assistant-message-1",
      sourceLabel: "Assistant draft",
      sourceType: "assistant"
    });
    const sameProposal = await crm.createCrmChangeProposal(fx.actorA, {
      idempotencyKey: "contact-create-idempotent",
      proposalType: "CREATE_PERSON",
      proposedPayload: { fields: { firstName: "Different" } },
      sourceType: "assistant"
    });
    const applied = await crm.applyCrmChangeProposal(fx.actorA, proposal.id, {
      fields: {
        email: "proposal-contact@example.test",
        firstName: "Reviewed",
        lastName: "Contact",
        phone: "555-0101"
      }
    });
    const reapplied = await crm.applyCrmChangeProposal(fx.actorA, proposal.id);
    const contact = await fx.prisma.person.findUniqueOrThrow({ where: { id: applied.appliedEntityId ?? "" } });
    const audit = await fx.prisma.auditLog.findFirstOrThrow({
      where: { action: "crm_change_proposal.applied", entityId: proposal.id, workspaceId: fx.workspaceA.id }
    });

    expect(sameProposal.id).toBe(proposal.id);
    expect(proposal).toMatchObject({
      canApply: true,
      permissionActionKey: "create_contact",
      permissionState: "requires_confirmation",
      status: "PENDING"
    });
    expect(contact).toMatchObject({
      email: "proposal-contact@example.test",
      firstName: "Reviewed",
      lastName: "Contact",
      workspaceId: fx.workspaceA.id
    });
    expect(applied.appliedEntityId).toBe(reapplied.appliedEntityId);
    expect(audit.metadata).toMatchObject({ appliedEntityType: "Person", permissionActionKey: "create_contact" });
  });

  it("enforces create and apply permissions server-side", async () => {
    const fx = currentFixture();

    await crm.updateAiPreferences(fx.actorA, {
      assistantActionPermissions: permissionMap({ create_contact: "never_allow" })
    });
    await expect(crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "CREATE_PERSON",
      proposedPayload: { fields: { email: "blocked@example.test", firstName: "Blocked" } },
      sourceType: "assistant"
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await crm.updateAiPreferences(fx.actorA, {
      assistantActionPermissions: permissionMap({ update_contact: "suggest_only" })
    });
    const proposal = await crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "UPDATE_PERSON",
      proposedPayload: { fields: { phone: "555-0199" } },
      sourceType: "assistant",
      targetEntityId: fx.recordsA.person.id
    });
    await expect(crm.applyCrmChangeProposal(fx.actorA, proposal.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      phone: null
    });
  });

  it("blocks cross-workspace access and unsupported or blanking field payloads", async () => {
    const fx = currentFixture();
    await allowCrmProposalApplies(fx);

    await expect(crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "UPDATE_PERSON",
      proposedPayload: { fields: { phone: "555-0102" } },
      sourceType: "assistant",
      targetEntityId: fx.recordsB.person.id
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "UPDATE_PERSON",
      proposedPayload: { fields: { deletedAt: "2026-07-13" } },
      sourceType: "assistant",
      targetEntityId: fx.recordsA.person.id
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "UPDATE_PERSON",
      proposedPayload: { fields: { phone: "" } },
      sourceType: "assistant",
      targetEntityId: fx.recordsA.person.id
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("detects duplicate candidates and stale target updates conservatively", async () => {
    const fx = currentFixture();
    await allowCrmProposalApplies(fx);

    const duplicate = await crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "CREATE_PERSON",
      proposedPayload: { fields: { email: fx.recordsA.person.email, firstName: "Duplicate" } },
      sourceType: "meeting_intelligence"
    });
    await expect(crm.applyCrmChangeProposal(fx.actorA, duplicate.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const failedDuplicate = await fx.prisma.crmChangeProposal.findUniqueOrThrow({ where: { id: duplicate.id } });
    expect(failedDuplicate).toMatchObject({ status: "FAILED" });
    expect(failedDuplicate.conflictInfo).toMatchObject({ code: "DUPLICATE_CANDIDATES" });

    const stale = await crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "UPDATE_ORGANIZATION",
      proposedPayload: { fields: { domain: "fresh.example.test" } },
      sourceType: "meeting_intelligence",
      targetEntityId: fx.recordsA.organization.id
    });
    await fx.prisma.organization.update({
      data: { domain: "manual.example.test" },
      where: { id: fx.recordsA.organization.id }
    });
    await expect(crm.applyCrmChangeProposal(fx.actorA, stale.id)).rejects.toMatchObject({ code: "CONFLICT" });
    const failedStale = await fx.prisma.crmChangeProposal.findUniqueOrThrow({ where: { id: stale.id } });
    expect(failedStale).toMatchObject({ status: "FAILED" });
    expect(failedStale.conflictInfo).toMatchObject({ code: "STALE_TARGET" });
  });

  it("applies organization creates, contact updates, contact-organization links, and reject lifecycle with audits", async () => {
    const fx = currentFixture();
    await allowCrmProposalApplies(fx);

    const organizationProposal = await crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "CREATE_ORGANIZATION",
      proposedPayload: { fields: { domain: "proposal-org.example", name: "Proposal Org" } },
      sourceType: "assistant"
    });
    const organizationApply = await crm.applyCrmChangeProposal(fx.actorA, organizationProposal.id);
    const linkProposal = await crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "LINK_PERSON_ORGANIZATION",
      proposedPayload: { organizationId: organizationApply.appliedEntityId },
      sourceType: "assistant",
      targetEntityId: fx.recordsA.person.id
    });
    await crm.applyCrmChangeProposal(fx.actorA, linkProposal.id);
    const updateProposal = await crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "UPDATE_PERSON",
      proposedPayload: { fields: { phone: "555-0123", relationshipPersonalContext: "Prefers concise implementation updates." } },
      sourceType: "meeting_intelligence",
      targetEntityId: fx.recordsA.person.id
    });
    await crm.applyCrmChangeProposal(fx.actorA, updateProposal.id);
    const rejected = await crm.createCrmChangeProposal(fx.actorA, {
      proposalType: "UPDATE_ORGANIZATION",
      proposedPayload: { fields: { domain: "rejected.example" } },
      sourceType: "assistant",
      targetEntityId: fx.recordsA.organization.id
    });
    await crm.rejectCrmChangeProposal(fx.actorA, rejected.id);

    const person = await fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } });
    const proposalAudits = await fx.prisma.auditLog.findMany({
      where: { entityType: "CrmChangeProposal", workspaceId: fx.workspaceA.id }
    });

    expect(person).toMatchObject({
      organizationId: organizationApply.appliedEntityId,
      phone: "555-0123",
      relationshipPersonalContext: "Prefers concise implementation updates."
    });
    expect(proposalAudits.map((audit) => audit.action)).toEqual(expect.arrayContaining([
      "crm_change_proposal.created",
      "crm_change_proposal.applied",
      "crm_change_proposal.rejected"
    ]));
    await expect(crm.applyCrmChangeProposal(fx.actorA, rejected.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

async function allowCrmProposalApplies(fx: Fixture) {
  await crm.updateAiPreferences(fx.actorA, {
    assistantActionPermissions: permissionMap({
      create_contact: "require_confirmation",
      create_organization: "require_confirmation",
      link_contact_organization: "require_confirmation",
      update_contact: "require_confirmation",
      update_organization: "require_confirmation"
    })
  });
}

function permissionMap(overrides: Record<string, string> = {}) {
  return {
    ...crm.defaultAiActionPermissions,
    ...overrides
  };
}

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not initialized.");
  return fixture;
}
