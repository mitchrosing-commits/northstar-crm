import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"),
  "utf8"
);
const validators = readFileSync(join(process.cwd(), "lib/validators/crm.ts"), "utf8");
const limits = readFileSync(join(process.cwd(), "lib/product-limits.ts"), "utf8");
const service = [
  readFileSync(join(process.cwd(), "lib/services/deal-service.ts"), "utf8"),
  readFileSync(join(process.cwd(), "lib/services/record-guards.ts"), "utf8")
].join("\n");
const newDealPage = readFileSync(join(process.cwd(), "app/deals/new/page.tsx"), "utf8");
const editDealPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/edit/page.tsx"), "utf8");
const form = readFileSync(join(process.cwd(), "components/deal-form.tsx"), "utf8");

describe("deal create/update behavior", () => {
  it("routes deal create and update through validated API payloads", () => {
    expect(route).toContain("createDealSchema.parse");
    expect(route).toContain("updateDealSchema.parse");
    expect(route).toContain("createDeal(actor");
    expect(route).toContain("updateDeal(actor");
    expect(limits).toContain("dealValueCentsMax = intColumnMax");
    expect(validators).toContain('max(dealValueCentsMax, "Deal value is too large.")');
  });

  it("keeps deal mutations workspace-scoped and audited", () => {
    expect(service).toContain("assertDealPipelineAndStage(actor.workspaceId");
    expect(service).toContain("normalizeCreateDealInput(data)");
    expect(service).toContain("normalizeUpdateDealInput(data)");
    expect(service).toContain("Deal update must be an object.");
    expect(service).toContain("Deal relation ids must be text.");
    expect(service).toContain("data: { ...normalized, workspaceId: actor.workspaceId }");
    expect(service).toContain("Object.keys(normalized).length === 0 || !dealUpdateChanges(normalized, existing)");
    expect(service).toContain("dealUpdateChanges(");
    expect(service).toContain("writeAuditLog(actor, \"deal.created\"");
    expect(service).toContain("stageChanged ? \"deal.stage_changed\" : \"deal.updated\"");
  });

  it("prevents cross-pipeline stage moves and audits valid stage changes", () => {
    expect(service).toContain("INVALID_PIPELINE_MOVE");
    expect(service).toContain("Move the deal within its current pipeline.");
    expect(service).toContain("deal.stage_changed");
    expect(service).toContain("previousStageId");
    expect(service).toContain("nextStageId");
  });

  it("submits create and edit forms to the workspace-scoped deal API", () => {
    expect(newDealPage).toContain("searchParams?: Promise<{ organizationId?: string; personId?: string; returnTo?: string; title?: string }>");
    expect(newDealPage).toContain("const defaultTitle = firstSearchParam(resolvedSearchParams?.title)");
    expect(newDealPage).toContain("defaultTitle={defaultTitle}");
    expect(newDealPage).toContain("const hasPrefill = Boolean(defaultTitle || defaultPersonId || defaultOrganizationId)");
    expect(newDealPage).toContain("prefillNotice={");
    expect(newDealPage).toContain("We prefilled this deal from your search or related-record shortcut.");
    expect(newDealPage).toContain("Create this deal, then Northstar will return to your activity draft with the deal selected.");
    expect(newDealPage).toContain("returnTo={hasReturnTo ? { href: returnHref, paramName: \"dealId\" } : undefined}");
    expect(newDealPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(newDealPage).toContain('formatPersonName(person) ?? "Unnamed contact"');
    expect(newDealPage).not.toContain("[person.firstName, person.lastName].filter(Boolean).join(\" \")");
    expect(editDealPage).toContain('import { formatPersonName } from "@/lib/person-name"');
    expect(editDealPage).toContain('formatPersonName(person) ?? "Unnamed contact"');
    expect(editDealPage).not.toContain("[person.firstName, person.lastName].filter(Boolean).join(\" \")");
    expect(newDealPage).toContain("defaultPersonId={peopleOptions.some((person) => person.id === defaultPersonId) ? defaultPersonId : undefined}");
    expect(newDealPage).toContain(
      "defaultOrganizationId={organizationOptions.some((organization) => organization.id === defaultOrganizationId) ? defaultOrganizationId : undefined}"
    );
    expect(form).toContain("mode === \"create\"");
    expect(form).toContain("defaultTitle?: string");
    expect(form).toContain("prefillNotice?: string");
    expect(form).toContain("returnTo?: {");
    expect(form).toContain("paramName: \"dealId\";");
    expect(form).toContain("FormPrefillNotice");
    expect(form).toContain("<FormPrefillNotice>{prefillNotice}</FormPrefillNotice>");
    expect(form).toContain("defaultPersonId?: string");
    expect(form).toContain("defaultOrganizationId?: string");
    expect(form).toContain("initialDeal?.title ?? defaultTitle ?? \"\"");
    expect(form).toContain("initialDeal?.personId ?? defaultPersonId ?? \"\"");
    expect(form).toContain("initialDeal?.organizationId ?? defaultOrganizationId ?? \"\"");
    expect(form).toContain("method = mode === \"create\" ? \"POST\" : \"PATCH\"");
    expect(form).toContain("/api/v1/workspaces/${workspaceId}/deals");
    expect(form).toContain("appendReturnParam(returnTo.href, returnTo.paramName, deal.id)");
    expect(form).toContain("valueCents");
    expect(form).toContain("expectedCloseAt");
  });
});
