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

describe("web form lead capture service", () => {
  it("creates, lists, updates, and scopes web forms to the actor workspace", async () => {
    const fx = currentFixture();
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Website contact",
      publicTitle: "Talk with sales",
      publicDescription: "Tell us how we can help.",
      requireLeadTitle: true
    });

    expect(webForm.workspaceId).toBe(fx.workspaceA.id);
    expect(webForm.createdById).toBe(fx.userA.id);
    expect(webForm.sourceLabel).toBe("Web Form / Website contact");
    expect(webForm.token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);

    await expect(crm.listWebForms(fx.actorA)).resolves.toHaveLength(1);
    await expect(crm.listWebForms(fx.actorB)).resolves.toHaveLength(0);
    await expect(crm.updateWebForm(fx.actorB, webForm.id, { isEnabled: false })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    const updated = await crm.updateWebForm(fx.actorA, webForm.id, {
      isEnabled: false,
      sourceLabel: "Web Form / Pricing page"
    });
    expect(updated.isEnabled).toBe(false);
    expect(updated.sourceLabel).toBe("Web Form / Pricing page");

    const audits = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityType: "WebForm", entityId: webForm.id },
      orderBy: { createdAt: "asc" }
    });
    expect(audits.map((entry) => entry.action)).toEqual(["web_form.created", "web_form.updated"]);
  });

  it("returns only enabled public form data for valid public tokens", async () => {
    const fx = currentFixture();
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Website contact",
      publicTitle: "Contact our team",
      publicDescription: "We will route this to the right person.",
      sourceLabel: "Web Form / Website",
      requireLeadTitle: false
    });

    const publicForm = await crm.getPublicWebFormByToken(webForm.token);
    expect(publicForm).toEqual({
      token: webForm.token,
      publicTitle: "Contact our team",
      publicDescription: "We will route this to the right person.",
      requireLeadTitle: false
    });
    expect((publicForm as { id?: string }).id).toBeUndefined();
    expect((publicForm as { workspaceId?: string }).workspaceId).toBeUndefined();

    await expect(crm.getPublicWebFormByToken("not-a-token")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await crm.updateWebForm(fx.actorA, webForm.id, { isEnabled: false });
    await expect(crm.getPublicWebFormByToken(webForm.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("submits an enabled public form into exactly one workspace-scoped lead and lead note", async () => {
    const fx = currentFixture();
    const initialLeadCount = await fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } });
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Pricing page",
      publicTitle: "Request pricing",
      sourceLabel: "Web Form / Pricing page"
    });

    const result = await crm.submitPublicWebForm(webForm.token, {
      personName: "Casey Morgan",
      email: "CASEY@example.test",
      phone: "+1 555 0199",
      organizationName: "Morgan Labs",
      message: "Interested in a rollout this quarter."
    });

    expect(result).toMatchObject({ blocked: false, created: true, duplicate: false });
    await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(initialLeadCount + 1);
    await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceB.id } })).resolves.toBe(1);

    const lead = await fx.prisma.lead.findUniqueOrThrow({
      where: { id: result.leadId ?? "" },
      include: { notes: true }
    });
    expect(lead.workspaceId).toBe(fx.workspaceA.id);
    expect(lead.title).toBe("Website inquiry from Morgan Labs");
    expect(lead.source).toBe("Web Form / Pricing page");
    expect(lead.personId).toBeNull();
    expect(lead.organizationId).toBeNull();
    expect(lead.notes).toHaveLength(1);
    expect(lead.notes[0]?.authorId).toBeNull();
    expect(lead.notes[0]?.body).toContain("Web form submission: Pricing page");
    expect(lead.notes[0]?.body).toContain("Name: Casey Morgan");
    expect(lead.notes[0]?.body).toContain("Email: casey@example.test");
    expect(lead.notes[0]?.body).toContain("Organization: Morgan Labs");
    expect(lead.notes[0]?.body).toContain("Interested in a rollout this quarter.");
    expect(lead.notes[0]?.body).not.toContain(webForm.token);

    await expect(
      fx.prisma.webFormSubmission.count({ where: { workspaceId: fx.workspaceA.id, webFormId: webForm.id, leadId: lead.id } })
    ).resolves.toBe(1);
    const auditActions = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityId: { in: [lead.id, webForm.id] } },
      select: { action: true, metadata: true }
    });
    expect(auditActions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["lead.created_from_web_form", "web_form.submission_received"])
    );
    expect(JSON.stringify(auditActions)).not.toContain(webForm.token);
  });

  it("rejects disabled form submissions without creating a lead", async () => {
    const fx = currentFixture();
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Disabled form",
      publicTitle: "Unavailable"
    });
    await crm.updateWebForm(fx.actorA, webForm.id, { isEnabled: false });
    const before = await fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } });

    await expect(
      crm.submitPublicWebForm(webForm.token, {
        email: "disabled@example.test",
        message: "Should not create a lead."
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(before);
  });

  it("ignores honeypot submissions without creating leads or submission rows", async () => {
    const fx = currentFixture();
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Contact form",
      publicTitle: "Contact us"
    });
    const beforeLeadCount = await fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } });

    const result = await crm.submitPublicWebForm(webForm.token, {
      personName: "Bot Filled",
      email: "bot@example.test",
      message: "This should be ignored.",
      website: "https://spam.example.test"
    });

    expect(result).toMatchObject({ blocked: true, created: false, duplicate: false, leadId: null });
    await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeLeadCount);
    await expect(fx.prisma.webFormSubmission.count({ where: { webFormId: webForm.id } })).resolves.toBe(0);
  });

  it("deduplicates repeated public submissions within a short window", async () => {
    const fx = currentFixture();
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Contact form",
      publicTitle: "Contact us"
    });
    const beforeLeadCount = await fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } });
    const payload = {
      leadTitle: "Need help with onboarding",
      email: "repeat@example.test",
      message: "Same request."
    };

    const first = await crm.submitPublicWebForm(webForm.token, payload);
    const second = await crm.submitPublicWebForm(webForm.token, payload);

    expect(first).toMatchObject({ created: true, duplicate: false });
    expect(second).toMatchObject({ created: false, duplicate: true, leadId: first.leadId });
    await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeLeadCount + 1);
    await expect(fx.prisma.webFormSubmission.count({ where: { webFormId: webForm.id } })).resolves.toBe(1);
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Expected integration fixture to be initialized.");
  return fixture;
}
