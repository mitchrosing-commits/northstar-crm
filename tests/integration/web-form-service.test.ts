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
    await expect(
      fx.prisma.webFormSubmission.findFirstOrThrow({
        where: { workspaceId: fx.workspaceA.id, webFormId: webForm.id, leadId: lead.id },
        select: {
          leadTitle: true,
          personName: true,
          email: true,
          phone: true,
          organizationName: true,
          message: true
        }
      })
    ).resolves.toEqual({
      leadTitle: "Website inquiry from Morgan Labs",
      personName: "Casey Morgan",
      email: "casey@example.test",
      phone: "+1 555 0199",
      organizationName: "Morgan Labs",
      message: "Interested in a rollout this quarter."
    });
    const auditActions = await fx.prisma.auditLog.findMany({
      where: { workspaceId: fx.workspaceA.id, entityId: { in: [lead.id, webForm.id] } },
      select: { action: true, metadata: true }
    });
    expect(auditActions.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(["lead.created_from_web_form", "web_form.submission_received"])
    );
    expect(JSON.stringify(auditActions)).not.toContain(webForm.token);
  });

  it("returns workspace-scoped submission history with linked leads and without public tokens", async () => {
    const fx = currentFixture();
    const emptyForm = await crm.createWebForm(fx.actorA, {
      name: "Empty review form",
      publicTitle: "Empty form"
    });
    const emptyReview = await crm.getWebFormReview(fx.actorA, emptyForm.id);

    expect(emptyReview._count.submissions).toBe(0);
    expect(emptyReview.submissions).toEqual([]);
    expect(JSON.stringify(emptyReview)).not.toContain(emptyForm.token);
    await expect(crm.getWebFormReview(fx.actorB, emptyForm.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Review form",
      publicTitle: "Review our form",
      sourceLabel: "Web Form / Review"
    });
    const first = await crm.submitPublicWebForm(webForm.token, {
      leadTitle: "Review request",
      personName: "Riley Review",
      email: "riley@example.test",
      phone: "+1 555 0188",
      organizationName: "Review Co",
      message: "Please review this submission."
    });
    const duplicate = await crm.submitPublicWebForm(webForm.token, {
      leadTitle: "Review request",
      personName: "Riley Review",
      email: "riley@example.test",
      phone: "+1 555 0188",
      organizationName: "Review Co",
      message: "Please review this submission."
    });
    const honeypot = await crm.submitPublicWebForm(webForm.token, {
      email: "spam@example.test",
      message: "Store nothing from this.",
      website: "https://spam.example.test"
    });

    expect(first).toMatchObject({ created: true, duplicate: false });
    expect(duplicate).toMatchObject({ created: false, duplicate: true, leadId: first.leadId });
    expect(honeypot).toMatchObject({ blocked: true, created: false });

    const review = await crm.getWebFormReview(fx.actorA, webForm.id);
    expect(review).toMatchObject({
      id: webForm.id,
      name: "Review form",
      sourceLabel: "Web Form / Review"
    });
    expect(review._count.submissions).toBe(1);
    expect(review.submissions).toHaveLength(1);
    expect(review.submissions[0]).toMatchObject({
      leadTitle: "Review request",
      personName: "Riley Review",
      email: "riley@example.test",
      phone: "+1 555 0188",
      organizationName: "Review Co",
      message: "Please review this submission.",
      lead: {
        id: first.leadId,
        title: "Review request",
        deletedAt: null
      }
    });
    expect(JSON.stringify(review)).not.toContain(webForm.token);
    expect(JSON.stringify(review)).not.toContain("https://spam.example.test");
    await expect(fx.prisma.webFormSubmission.count({ where: { webFormId: webForm.id } })).resolves.toBe(1);
  });

  it("filters accepted submission history safely by text, date, and linked lead status", async () => {
    const fx = currentFixture();
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Filter review form",
      publicTitle: "Filter our form",
      sourceLabel: "Web Form / Filters"
    });
    const otherWorkspaceForm = await crm.createWebForm(fx.actorB, {
      name: "Other workspace filter form",
      publicTitle: "Other workspace"
    });

    const alpha = await crm.submitPublicWebForm(webForm.token, {
      leadTitle: "Alpha Boundary",
      personName: "Alex Boundary",
      email: "alpha-boundary@example.test",
      phone: "+1 555 0101",
      organizationName: "Alpha Co",
      message: "First accepted submission."
    });
    const beta = await crm.submitPublicWebForm(webForm.token, {
      leadTitle: "Beta Boundary",
      personName: "Blair Boundary",
      email: "beta-boundary@example.test",
      phone: "+1 555 0102",
      organizationName: "Beta Co",
      message: "Second accepted submission."
    });
    const gamma = await crm.submitPublicWebForm(webForm.token, {
      leadTitle: "Gamma Boundary",
      personName: "Gale Boundary",
      email: "gamma-boundary@example.test",
      phone: "+1 555 0103",
      organizationName: "Gamma Co",
      message: "Third accepted submission."
    });
    const legacy = await crm.submitPublicWebForm(webForm.token, {
      leadTitle: "Temporary legacy title",
      personName: "Legacy Person",
      email: "legacy@example.test",
      phone: "+1 555 0104",
      organizationName: "Legacy Co",
      message: "Legacy accepted submission."
    });
    await crm.submitPublicWebForm(otherWorkspaceForm.token, {
      leadTitle: "Other Workspace Lead",
      email: "other-workspace@example.test"
    });

    const alphaLeadId = alpha.leadId ?? "";
    const betaLeadId = beta.leadId ?? "";
    const gammaLeadId = gamma.leadId ?? "";
    const legacyLeadId = legacy.leadId ?? "";
    await fx.prisma.lead.update({ where: { id: betaLeadId }, data: { status: "QUALIFIED" } });
    await fx.prisma.lead.update({ where: { id: gammaLeadId }, data: { status: "DISQUALIFIED" } });
    await fx.prisma.lead.update({ where: { id: legacyLeadId }, data: { status: "CONVERTED", title: "Legacy Linked Lead" } });

    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: alphaLeadId },
      data: { submittedAt: new Date("2026-01-10T00:00:00.000Z") }
    });
    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: betaLeadId },
      data: { submittedAt: new Date("2026-01-10T23:59:59.999Z") }
    });
    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: gammaLeadId },
      data: { submittedAt: new Date("2026-01-11T12:00:00.000Z") }
    });
    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: legacyLeadId },
      data: {
        email: null,
        leadTitle: null,
        message: null,
        organizationName: null,
        personName: null,
        phone: null,
        submittedAt: new Date("2026-01-12T12:00:00.000Z")
      }
    });

    const all = await crm.getWebFormReview(fx.actorA, webForm.id);
    expect(all._count.submissions).toBe(4);
    expect(all.filteredSubmissionCount).toBe(4);
    expect(all.submissions.map((submission) => submission.leadTitle ?? submission.lead?.title)).toEqual([
      "Legacy Linked Lead",
      "Gamma Boundary",
      "Beta Boundary",
      "Alpha Boundary"
    ]);

    await expect(crm.getWebFormReview(fx.actorA, webForm.id, { q: "alex boundary" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Alpha Boundary" }]
    });
    await expect(crm.getWebFormReview(fx.actorA, webForm.id, { q: "BETA-BOUNDARY@EXAMPLE.TEST" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Beta Boundary" }]
    });
    await expect(crm.getWebFormReview(fx.actorA, webForm.id, { q: "gamma co" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Gamma Boundary" }]
    });
    await expect(crm.getWebFormReview(fx.actorA, webForm.id, { q: "555 0103" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Gamma Boundary" }]
    });
    const linkedLeadSearch = await crm.getWebFormReview(fx.actorA, webForm.id, { q: "legacy linked" });
    expect(linkedLeadSearch.filteredSubmissionCount).toBe(1);
    expect(linkedLeadSearch.submissions[0]?.leadTitle).toBeNull();
    expect(linkedLeadSearch.submissions[0]?.lead?.title).toBe("Legacy Linked Lead");

    const dateBoundary = await crm.getWebFormReview(fx.actorA, webForm.id, { from: "2026-01-10", to: "2026-01-10" });
    expect(dateBoundary.filteredSubmissionCount).toBe(2);
    expect(dateBoundary.submissions.map((submission) => submission.leadTitle)).toEqual(["Beta Boundary", "Alpha Boundary"]);

    const statusFiltered = await crm.getWebFormReview(fx.actorA, webForm.id, { status: "QUALIFIED" });
    expect(statusFiltered.filteredSubmissionCount).toBe(1);
    expect(statusFiltered.submissions[0]?.leadTitle).toBe("Beta Boundary");

    const combined = await crm.getWebFormReview(fx.actorA, webForm.id, {
      from: "2026-01-10",
      q: "beta",
      status: "QUALIFIED",
      to: "2026-01-10"
    });
    expect(combined.filteredSubmissionCount).toBe(1);
    expect(combined.submissions[0]?.leadTitle).toBe("Beta Boundary");

    const noResults = await crm.getWebFormReview(fx.actorA, webForm.id, { q: "missing submission" });
    expect(noResults.hasActiveFilters).toBe(true);
    expect(noResults.filteredSubmissionCount).toBe(0);
    expect(noResults.submissions).toEqual([]);

    const malformed = await crm.getWebFormReview(fx.actorA, webForm.id, {
      from: "not-a-date",
      q: ["Alpha Boundary", "ignored"],
      status: "UNSUPPORTED",
      to: "2026-99-99"
    });
    expect(malformed.filters).toEqual({ from: null, query: "Alpha Boundary", status: null, to: null, webFormId: null });
    expect(malformed.filteredSubmissionCount).toBe(1);
    expect(JSON.stringify(malformed)).not.toContain(webForm.token);
    expect(JSON.stringify(malformed)).not.toContain("other-workspace@example.test");

    await expect(crm.getWebFormReview(fx.actorB, webForm.id, { q: "alpha" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    await fx.prisma.webForm.update({ where: { id: webForm.id }, data: { deletedAt: new Date() } });
    await expect(crm.getWebFormReview(fx.actorA, webForm.id, { q: "alpha" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
  });

  it("returns all workspace accepted submissions with shared filters, source links, and token-safe projections", async () => {
    const fx = currentFixture();
    const empty = await crm.getWebFormSubmissionReview(fx.actorA);
    expect(empty.acceptedSubmissionCount).toBe(0);
    expect(empty.filteredSubmissionCount).toBe(0);
    expect(empty.submissions).toEqual([]);

    const alphaForm = await crm.createWebForm(fx.actorA, {
      name: "All forms Alpha",
      publicTitle: "Alpha public",
      sourceLabel: "Web Form / All Alpha"
    });
    const betaForm = await crm.createWebForm(fx.actorA, {
      name: "All forms Beta",
      publicTitle: "Beta public",
      sourceLabel: "Web Form / All Beta"
    });
    const deletedForm = await crm.createWebForm(fx.actorA, {
      name: "Deleted all forms",
      publicTitle: "Deleted public"
    });
    const otherWorkspaceForm = await crm.createWebForm(fx.actorB, {
      name: "Other workspace all forms",
      publicTitle: "Other workspace"
    });

    const alpha = await crm.submitPublicWebForm(alphaForm.token, {
      leadTitle: "Alpha All Lead",
      personName: "Alex All",
      email: "alpha-all@example.test",
      phone: "+1 555 0201",
      organizationName: "Alpha All Co",
      message: "Alpha all submission."
    });
    const beta = await crm.submitPublicWebForm(betaForm.token, {
      leadTitle: "Beta All Lead",
      personName: "Blair All",
      email: "beta-all@example.test",
      phone: "+1 555 0202",
      organizationName: "Beta All Co",
      message: "Beta all submission."
    });
    const gamma = await crm.submitPublicWebForm(alphaForm.token, {
      leadTitle: "Gamma All Lead",
      personName: "Gale All",
      email: "gamma-all@example.test",
      phone: "+1 555 0203",
      organizationName: "Gamma All Co",
      message: "Gamma all submission."
    });
    const legacy = await crm.submitPublicWebForm(betaForm.token, {
      leadTitle: "Temporary all legacy",
      personName: "Legacy All",
      email: "legacy-all@example.test",
      phone: "+1 555 0204",
      organizationName: "Legacy All Co",
      message: "Legacy all submission."
    });
    const deleted = await crm.submitPublicWebForm(deletedForm.token, {
      leadTitle: "Deleted Form Lead",
      email: "deleted-form@example.test"
    });
    await crm.submitPublicWebForm(otherWorkspaceForm.token, {
      leadTitle: "Other Workspace All Lead",
      email: "other-all@example.test"
    });

    for (let index = 0; index < 23; index += 1) {
      const result = await crm.submitPublicWebForm(alphaForm.token, {
        leadTitle: `Older capped lead ${index.toString().padStart(2, "0")}`,
        email: `older-capped-${index}@example.test`
      });
      await fx.prisma.webFormSubmission.updateMany({
        where: { leadId: result.leadId ?? "" },
        data: { submittedAt: new Date(`2026-01-${(index + 1).toString().padStart(2, "0")}T12:00:00.000Z`) }
      });
    }

    const alphaLeadId = alpha.leadId ?? "";
    const betaLeadId = beta.leadId ?? "";
    const gammaLeadId = gamma.leadId ?? "";
    const legacyLeadId = legacy.leadId ?? "";
    await fx.prisma.lead.update({ where: { id: betaLeadId }, data: { status: "QUALIFIED" } });
    await fx.prisma.lead.update({ where: { id: gammaLeadId }, data: { status: "DISQUALIFIED" } });
    await fx.prisma.lead.update({ where: { id: legacyLeadId }, data: { status: "CONVERTED", title: "Legacy All Linked Lead" } });
    await fx.prisma.webForm.update({ where: { id: deletedForm.id }, data: { deletedAt: new Date() } });

    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: alphaLeadId },
      data: { submittedAt: new Date("2026-02-10T00:00:00.000Z") }
    });
    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: betaLeadId },
      data: { submittedAt: new Date("2026-02-10T23:59:59.999Z") }
    });
    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: gammaLeadId },
      data: { submittedAt: new Date("2026-02-11T12:00:00.000Z") }
    });
    await fx.prisma.webFormSubmission.updateMany({
      where: { leadId: legacyLeadId },
      data: {
        email: null,
        leadTitle: null,
        message: null,
        organizationName: null,
        personName: null,
        phone: null,
        submittedAt: new Date("2026-02-12T12:00:00.000Z")
      }
    });

    const all = await crm.getWebFormSubmissionReview(fx.actorA);
    expect(all.acceptedSubmissionCount).toBe(27);
    expect(all.filteredSubmissionCount).toBe(27);
    expect(all.submissions).toHaveLength(25);
    expect(all.submissions.slice(0, 4).map((submission) => submission.leadTitle ?? submission.lead?.title)).toEqual([
      "Legacy All Linked Lead",
      "Gamma All Lead",
      "Beta All Lead",
      "Alpha All Lead"
    ]);
    expect(all.submissions[0]?.webForm).toEqual({
      id: betaForm.id,
      name: "All forms Beta",
      sourceLabel: "Web Form / All Beta"
    });
    expect(JSON.stringify(all)).not.toContain(alphaForm.token);
    expect(JSON.stringify(all)).not.toContain(betaForm.token);
    expect(JSON.stringify(all)).not.toContain(deletedForm.token);
    expect(JSON.stringify(all)).not.toContain("deleted-form@example.test");
    expect(JSON.stringify(all)).not.toContain("other-all@example.test");

    await expect(crm.getWebFormSubmissionReview(fx.actorA, { form: betaForm.id })).resolves.toMatchObject({
      filteredSubmissionCount: 2,
      submissions: [{ webForm: { id: betaForm.id } }, { webForm: { id: betaForm.id } }]
    });
    await expect(crm.getWebFormSubmissionReview(fx.actorA, { q: "alex all" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Alpha All Lead" }]
    });
    await expect(crm.getWebFormSubmissionReview(fx.actorA, { q: "BETA-ALL@EXAMPLE.TEST" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Beta All Lead" }]
    });
    await expect(crm.getWebFormSubmissionReview(fx.actorA, { q: "Gamma All Co" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Gamma All Lead" }]
    });
    await expect(crm.getWebFormSubmissionReview(fx.actorA, { q: "555 0203" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Gamma All Lead" }]
    });
    await expect(crm.getWebFormSubmissionReview(fx.actorA, { q: "legacy all linked" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: null, lead: { title: "Legacy All Linked Lead" } }]
    });
    await expect(crm.getWebFormSubmissionReview(fx.actorA, { q: "All forms Beta" })).resolves.toMatchObject({
      filteredSubmissionCount: 2
    });

    const dateBoundary = await crm.getWebFormSubmissionReview(fx.actorA, { from: "2026-02-10", to: "2026-02-10" });
    expect(dateBoundary.filteredSubmissionCount).toBe(2);
    expect(dateBoundary.submissions.map((submission) => submission.leadTitle)).toEqual(["Beta All Lead", "Alpha All Lead"]);

    await expect(crm.getWebFormSubmissionReview(fx.actorA, { status: "QUALIFIED" })).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Beta All Lead" }]
    });
    await expect(
      crm.getWebFormSubmissionReview(fx.actorA, {
        form: betaForm.id,
        from: "2026-02-10",
        q: "beta",
        status: "QUALIFIED",
        to: "2026-02-10"
      })
    ).resolves.toMatchObject({
      filteredSubmissionCount: 1,
      submissions: [{ leadTitle: "Beta All Lead" }]
    });

    const noResults = await crm.getWebFormSubmissionReview(fx.actorA, { q: "missing all-form submission" });
    expect(noResults.hasActiveFilters).toBe(true);
    expect(noResults.filteredSubmissionCount).toBe(0);
    expect(noResults.submissions).toEqual([]);

    const malformed = await crm.getWebFormSubmissionReview(fx.actorA, {
      form: deletedForm.id,
      from: "not-a-date",
      q: ["Alpha All Lead", "ignored"],
      status: "UNSUPPORTED",
      to: "2026-99-99"
    });
    expect(malformed.filters).toEqual({ from: null, query: "Alpha All Lead", status: null, to: null, webFormId: null });
    expect(malformed.filteredSubmissionCount).toBe(1);

    const otherWorkspaceReview = await crm.getWebFormSubmissionReview(fx.actorB);
    expect(otherWorkspaceReview.acceptedSubmissionCount).toBe(1);
    expect(otherWorkspaceReview.submissions[0]?.leadTitle).toBe("Other Workspace All Lead");
    expect(JSON.stringify(otherWorkspaceReview)).not.toContain(alphaForm.token);
    expect(JSON.stringify(otherWorkspaceReview)).not.toContain("alpha-all@example.test");

    await fx.prisma.lead.update({ where: { id: alphaLeadId }, data: { deletedAt: new Date() } });
    await expect(crm.getWebFormSubmissionReview(fx.actorA, { q: "Alpha All Lead" })).resolves.toMatchObject({
      filteredSubmissionCount: 0,
      submissions: []
    });
    expect(deleted.leadId).toBeTruthy();
  });

  it("returns workspace-scoped accepted submission detail with safe linked Lead and Note context", async () => {
    const fx = currentFixture();
    const webForm = await crm.createWebForm(fx.actorA, {
      name: "Detail review form",
      publicTitle: "Detail public",
      sourceLabel: "Web Form / Detail"
    });
    const otherWorkspaceForm = await crm.createWebForm(fx.actorB, {
      name: "Other detail form",
      publicTitle: "Other detail"
    });

    const result = await crm.submitPublicWebForm(webForm.token, {
      leadTitle: "Detail Lead",
      personName: "Drew Detail",
      email: "DETAIL@EXAMPLE.TEST",
      phone: "+1 555 0301",
      organizationName: "Detail Co",
      message: "Review the full accepted submission."
    });
    const otherResult = await crm.submitPublicWebForm(otherWorkspaceForm.token, {
      leadTitle: "Other Detail Lead",
      email: "other-detail@example.test"
    });
    const submission = await fx.prisma.webFormSubmission.findFirstOrThrow({
      where: { workspaceId: fx.workspaceA.id, webFormId: webForm.id, leadId: result.leadId }
    });
    const otherSubmission = await fx.prisma.webFormSubmission.findFirstOrThrow({
      where: { workspaceId: fx.workspaceB.id, webFormId: otherWorkspaceForm.id, leadId: otherResult.leadId }
    });
    const beforeCounts = {
      leads: await fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } }),
      notes: await fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } }),
      submissions: await fx.prisma.webFormSubmission.count({ where: { workspaceId: fx.workspaceA.id } })
    };

    const detail = await crm.getWebFormSubmissionDetail(fx.actorA, submission.id);
    expect(detail).toMatchObject({
      id: submission.id,
      leadTitle: "Detail Lead",
      personName: "Drew Detail",
      email: "detail@example.test",
      phone: "+1 555 0301",
      organizationName: "Detail Co",
      message: "Review the full accepted submission.",
      webForm: {
        id: webForm.id,
        name: "Detail review form",
        sourceLabel: "Web Form / Detail"
      },
      lead: {
        id: result.leadId,
        title: "Detail Lead",
        status: "NEW",
        deletedAt: null
      }
    });
    expect(detail.leadNote).toMatchObject({
      body: expect.stringContaining("Web form submission: Detail review form")
    });
    expect(detail.leadNote?.body).toContain("Email: detail@example.test");
    expect(JSON.stringify(detail)).not.toContain(webForm.token);
    expect(JSON.stringify(detail)).not.toContain(otherWorkspaceForm.token);
    expect(JSON.stringify(detail)).not.toContain("other-detail@example.test");
    await expect(fx.prisma.lead.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeCounts.leads);
    await expect(fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeCounts.notes);
    await expect(fx.prisma.webFormSubmission.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(beforeCounts.submissions);

    await fx.prisma.webFormSubmission.update({
      where: { id: submission.id },
      data: {
        email: null,
        leadTitle: null,
        message: null,
        organizationName: null,
        personName: null,
        phone: null
      }
    });
    await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        leadId: result.leadId,
        body: "A later manual note makes direct submission-note linkage ambiguous."
      }
    });
    const legacy = await crm.getWebFormSubmissionDetail(fx.actorA, submission.id);
    expect(legacy).toMatchObject({
      leadTitle: null,
      personName: null,
      email: null,
      phone: null,
      organizationName: null,
      message: null,
      lead: { title: "Detail Lead" },
      leadNote: null
    });

    await expect(crm.getWebFormSubmissionDetail(fx.actorB, submission.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.getWebFormSubmissionDetail(fx.actorA, otherSubmission.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
    await expect(crm.getWebFormSubmissionDetail(fx.actorA, "not-a-real-submission")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    const nonAccepted = await fx.prisma.webFormSubmission.create({
      data: {
        workspaceId: fx.workspaceA.id,
        webFormId: webForm.id,
        leadId: null,
        fingerprint: "non-accepted-missing-lead"
      }
    });
    await expect(crm.getWebFormSubmissionDetail(fx.actorA, nonAccepted.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    const deletedForm = await crm.createWebForm(fx.actorA, {
      name: "Deleted detail form",
      publicTitle: "Deleted detail"
    });
    const deletedFormResult = await crm.submitPublicWebForm(deletedForm.token, {
      leadTitle: "Deleted Detail Lead",
      email: "deleted-detail@example.test"
    });
    const deletedFormSubmission = await fx.prisma.webFormSubmission.findFirstOrThrow({
      where: { workspaceId: fx.workspaceA.id, webFormId: deletedForm.id, leadId: deletedFormResult.leadId }
    });
    await fx.prisma.webForm.update({ where: { id: deletedForm.id }, data: { deletedAt: new Date() } });
    await expect(crm.getWebFormSubmissionDetail(fx.actorA, deletedFormSubmission.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });

    await fx.prisma.lead.update({ where: { id: result.leadId ?? "" }, data: { deletedAt: new Date() } });
    await expect(crm.getWebFormSubmissionDetail(fx.actorA, submission.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404
    });
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
