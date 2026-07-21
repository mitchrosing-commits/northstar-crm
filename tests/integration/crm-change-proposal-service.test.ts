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

  it("atomically applies a compound organization/contact create-and-link proposal with title, audits, and idempotent retry", async () => {
    const fx = currentFixture();
    await allowCrmProposalApplies(fx);

    const proposal = await crm.createContactOrganizationChangeProposal(fx.actorA, {
      idempotencyKey: "compound-create-link-idempotent",
      contact: {
        action: "create",
        fields: {
          email: "compound-contact@example.test",
          firstName: "Compound",
          lastName: "Buyer",
          title: "VP Revenue"
        }
      },
      organization: {
        action: "create",
        fields: {
          domain: "compound-org.example",
          name: "Compound Org"
        }
      },
      linkContactToOrganization: true,
      sourceType: "meeting_intelligence"
    });
    const beforeOrganizations = await fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id, name: "Compound Org" } });
    const applied = await crm.applyCrmChangeProposal(fx.actorA, proposal.id);
    const reapplied = await crm.applyCrmChangeProposal(fx.actorA, proposal.id);
    const contact = await fx.prisma.person.findUniqueOrThrow({ where: { id: applied.appliedEntityId ?? "" } });
    const organization = await fx.prisma.organization.findUniqueOrThrow({ where: { id: contact.organizationId ?? "" } });
    const afterOrganizations = await fx.prisma.organization.count({ where: { workspaceId: fx.workspaceA.id, name: "Compound Org" } });
    const audits = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityId: { in: [proposal.id, contact.id, organization.id] } }
    });

    expect(beforeOrganizations).toBe(0);
    expect(applied.appliedEntityId).toBe(reapplied.appliedEntityId);
    expect(afterOrganizations).toBe(1);
    expect(contact).toMatchObject({
      email: "compound-contact@example.test",
      firstName: "Compound",
      organizationId: organization.id,
      title: "VP Revenue",
      workspaceId: fx.workspaceA.id
    });
    expect(organization).toMatchObject({ domain: "compound-org.example", name: "Compound Org", workspaceId: fx.workspaceA.id });
    expect(proposal.changeGroups.map((group) => group.key)).toEqual(["organization", "contact", "link"]);
    expect(proposal.permissionChecks.map((check) => check.actionKey)).toEqual(expect.arrayContaining([
      "create_contact",
      "create_organization",
      "link_contact_organization"
    ]));
    expect(audits.map((audit) => audit.action)).toEqual(expect.arrayContaining([
      "crm_change_proposal.applied",
      "organization.created",
      "person.created"
    ]));
  });

  it("blocks compound apply when one included action lacks confirmation permission", async () => {
    const fx = currentFixture();
    await crm.updateAiPreferences(fx.actorA, {
      assistantActionPermissions: permissionMap({
        create_organization: "require_confirmation",
        link_contact_organization: "suggest_only"
      })
    });

    const proposal = await crm.createContactOrganizationChangeProposal(fx.actorA, {
      contact: { action: "existing", id: fx.recordsA.person.id },
      organization: { action: "create", fields: { name: "Permission Blocked Org" } },
      linkContactToOrganization: true,
      sourceType: "assistant"
    });

    await expect(crm.applyCrmChangeProposal(fx.actorA, proposal.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fx.prisma.organization.findFirst({
      where: { name: "Permission Blocked Org", workspaceId: fx.workspaceA.id }
    })).resolves.toBeNull();
  });

  it("blocks compound duplicate candidates and stale existing targets", async () => {
    const fx = currentFixture();
    await allowCrmProposalApplies(fx);

    const duplicate = await crm.createContactOrganizationChangeProposal(fx.actorA, {
      contact: {
        action: "create",
        fields: { email: fx.recordsA.person.email, firstName: "Duplicate" }
      },
      organization: {
        action: "create",
        fields: { domain: "compound-duplicate.example", name: "Compound Duplicate Org" }
      },
      linkContactToOrganization: true,
      sourceType: "assistant"
    });
    await expect(crm.applyCrmChangeProposal(fx.actorA, duplicate.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(fx.prisma.crmChangeProposal.findUniqueOrThrow({ where: { id: duplicate.id } })).resolves.toMatchObject({
      status: "FAILED",
      conflictInfo: expect.objectContaining({ code: "DUPLICATE_CANDIDATES" })
    });

    const stale = await crm.createContactOrganizationChangeProposal(fx.actorA, {
      contact: {
        action: "update",
        fields: { phone: "555-0202" },
        id: fx.recordsA.person.id
      },
      organization: {
        action: "existing",
        id: fx.recordsA.organization.id
      },
      linkContactToOrganization: true,
      sourceType: "meeting_intelligence"
    });
    await fx.prisma.person.update({ data: { phone: "555-9999" }, where: { id: fx.recordsA.person.id } });
    await expect(crm.applyCrmChangeProposal(fx.actorA, stale.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(fx.prisma.crmChangeProposal.findUniqueOrThrow({ where: { id: stale.id } })).resolves.toMatchObject({
      status: "FAILED",
      conflictInfo: expect.objectContaining({ code: "STALE_TARGET" })
    });
  });

  it("rolls back a partially failed compound apply", async () => {
    const fx = currentFixture();
    await allowCrmProposalApplies(fx);

    const proposal = await crm.createContactOrganizationChangeProposal(fx.actorA, {
      contact: {
        action: "create",
        fields: {
          firstName: "Rollback",
          ownerId: fx.userB.id
        }
      },
      organization: {
        action: "create",
        fields: { name: "Rolled Back Org" }
      },
      linkContactToOrganization: true,
      sourceType: "assistant"
    });

    await expect(crm.applyCrmChangeProposal(fx.actorA, proposal.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fx.prisma.organization.findFirst({
      where: { name: "Rolled Back Org", workspaceId: fx.workspaceA.id }
    })).resolves.toBeNull();
    await expect(fx.prisma.person.findFirst({
      where: { firstName: "Rollback", workspaceId: fx.workspaceA.id }
    })).resolves.toBeNull();
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
