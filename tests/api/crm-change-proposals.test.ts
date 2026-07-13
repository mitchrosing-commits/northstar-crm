import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260713120000_crm_change_proposals/migration.sql"),
  "utf8"
);
const service = readFileSync(join(process.cwd(), "lib/services/crm-change-proposal-service.ts"), "utf8");
const permissions = readFileSync(join(process.cwd(), "lib/services/ai-action-permissions.ts"), "utf8");
const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const listPage = readFileSync(join(process.cwd(), "app/crm-change-proposals/page.tsx"), "utf8");
const detailPage = readFileSync(join(process.cwd(), "app/crm-change-proposals/[proposalId]/page.tsx"), "utf8");
const reviewComponent = readFileSync(join(process.cwd(), "components/crm-change-proposal-review.tsx"), "utf8");
const docs = readFileSync(join(process.cwd(), "docs/crm-change-proposals.md"), "utf8");

describe("CRM change proposal infrastructure", () => {
  it("adds a durable workspace-scoped proposal model and migration", () => {
    expect(schema).toContain("model CrmChangeProposal");
    expect(schema).toContain("proposalType        CrmChangeProposalType");
    expect(schema).toContain("idempotencyKey      String");
    expect(schema).toContain("@@unique([workspaceId, idempotencyKey])");
    expect(schema).toContain("enum CrmChangeProposalStatus");
    expect(schema).toContain("CREATE_PERSON");
    expect(schema).toContain("LINK_PERSON_ORGANIZATION");
    expect(migration).toContain('CREATE TABLE "CrmChangeProposal"');
    expect(migration).toContain('CREATE UNIQUE INDEX "CrmChangeProposal_workspaceId_idempotencyKey_key"');
  });

  it("distinguishes contact and organization permissions server-side", () => {
    expect(permissions).toContain('"create_contact"');
    expect(permissions).toContain('"update_contact"');
    expect(permissions).toContain('"create_organization"');
    expect(permissions).toContain('"update_organization"');
    expect(permissions).toContain('"link_contact_organization"');
    expect(service).toContain("proposalPermissionDecision");
    expect(service).toContain("permission.level === \"never_allow\"");
    expect(service).toContain("permission.level !== \"require_confirmation\"");
  });

  it("validates payloads, duplicate candidates, stale targets, and idempotent applies", () => {
    expect(service).toContain("normalizePayloadForProposal");
    expect(service).toContain("CRM change proposals cannot blank existing fields.");
    expect(service).toContain("is not supported for this CRM proposal");
    expect(service).toContain("duplicateCandidatesForProposal");
    expect(service).toContain("STALE_TARGET");
    expect(service).toContain("DUPLICATE_CANDIDATES");
    expect(service).toContain("existing.status === CrmChangeProposalStatus.APPLIED");
    expect(service).toContain("updatePerson(actor");
    expect(service).toContain("updateOrganization(actor");
  });

  it("exposes review API and reusable internal UI without producer-specific mutation", () => {
    expect(route).toContain('resource === "crm-change-proposals"');
    expect(route).toContain("createCrmChangeProposal(actor");
    expect(route).toContain("applyCrmChangeProposal(actor");
    expect(route).toContain("rejectCrmChangeProposal(actor");
    expect(listPage).toContain("listCrmChangeProposals(actor");
    expect(detailPage).toContain("getCrmChangeProposal(actor");
    expect(reviewComponent).toContain("Current vs Proposed");
    expect(reviewComponent).toContain("Applied record");
    expect(reviewComponent).toContain("Apply reviewed change");
    expect(reviewComponent).toContain("Reject proposal");
    expect(service).not.toContain("transcript");
    expect(service).not.toContain("sendEmail");
  });

  it("documents producer contract, supported fields, and deferred actions", () => {
    expect(docs).toContain("Producer Contract");
    expect(docs).toContain("Assistant Supported Actions");
    expect(docs).toContain("Supported Fields");
    expect(docs).toContain("Applied proposals link to the final contact or organization record.");
    expect(docs).toContain("Duplicate candidates are stored on the proposal and block apply.");
    expect(docs).toContain("Automatic apply is intentionally not supported");
    expect(docs).toContain("Custom fields, deals, leads, merge operations, destructive changes, and blanking existing values are deferred.");
  });
});
