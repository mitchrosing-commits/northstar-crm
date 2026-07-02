import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentWorkspaceContext: vi.fn(),
  revalidatePath: vi.fn(),
  previewDealImport: vi.fn(),
  importDealsFromCsv: vi.fn(),
  previewContactImport: vi.fn(),
  importContactsFromCsv: vi.fn(),
  previewLeadImport: vi.fn(),
  importLeadsFromCsv: vi.fn(),
  previewOrganizationImport: vi.fn(),
  importOrganizationsFromCsv: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("@/lib/auth/request-context", () => ({
  getCurrentWorkspaceContext: mocks.getCurrentWorkspaceContext
}));

vi.mock("@/lib/services/crm", () => ({
  previewDealImport: mocks.previewDealImport,
  importDealsFromCsv: mocks.importDealsFromCsv,
  previewContactImport: mocks.previewContactImport,
  importContactsFromCsv: mocks.importContactsFromCsv,
  previewLeadImport: mocks.previewLeadImport,
  importLeadsFromCsv: mocks.importLeadsFromCsv,
  previewOrganizationImport: mocks.previewOrganizationImport,
  importOrganizationsFromCsv: mocks.importOrganizationsFromCsv
}));

import {
  previewContactImportAction,
  previewDealImportAction,
  previewLeadImportAction,
  previewOrganizationImportAction
} from "@/app/settings/import-export/actions";

const actor = { workspaceId: "workspace_1", actorUserId: "user_1" };

function formData(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

function preview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    totalRows: 1,
    validRows: 1,
    duplicateRows: 0,
    invalidRows: 0,
    unsupportedColumns: [],
    parseErrors: [],
    rows: [{ rowNumber: 2, status: "valid" }],
    ...overrides
  };
}

describe("import/export server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentWorkspaceContext.mockResolvedValue({ actor });
  });

  it("previews CSV without creating records or revalidating list routes", async () => {
    const dealPreview = preview();
    mocks.previewDealImport.mockResolvedValue(dealPreview);

    const result = await previewDealImportAction(
      { csvText: "" },
      formData({ dealCsv: "title,pipeline,stage\nOne,Sales,Discovery" })
    );

    expect(mocks.previewDealImport).toHaveBeenCalledWith(actor, "title,pipeline,stage\nOne,Sales,Discovery");
    expect(mocks.importDealsFromCsv).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(result).toEqual({
      csvText: "title,pipeline,stage\nOne,Sales,Discovery",
      preview: dealPreview
    });
  });

  it("imports from the submitted CSV and revalidates affected routes", async () => {
    const contactPreview = preview();
    const contactResult = {
      preview: contactPreview,
      createdCount: 1,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: 0,
      failedRows: [],
      createdContacts: [{ id: "person_1", name: "Ada Lovelace", email: "ada@example.test" }]
    };
    mocks.importContactsFromCsv.mockResolvedValue(contactResult);

    const result = await previewContactImportAction(
      { csvText: "" },
      formData({ intent: "import", contactCsv: "name,email\nAda Lovelace,ada@example.test" })
    );

    expect(mocks.previewContactImport).not.toHaveBeenCalled();
    expect(mocks.importContactsFromCsv).toHaveBeenCalledWith(actor, "name,email\nAda Lovelace,ada@example.test");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/contacts");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/settings/import-export");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      csvText: "name,email\nAda Lovelace,ada@example.test",
      preview: contactPreview,
      result: contactResult
    });
  });

  it("imports deals from submitted CSV and revalidates pipeline-facing routes", async () => {
    const dealPreview = preview();
    const dealResult = {
      preview: dealPreview,
      createdCount: 1,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: 0,
      failedRows: [],
      createdDeals: [{ id: "deal_1", title: "Pipeline Deal" }]
    };
    mocks.importDealsFromCsv.mockResolvedValue(dealResult);

    const result = await previewDealImportAction(
      { csvText: "" },
      formData({ intent: "import", dealCsv: "title,pipeline,stage\nPipeline Deal,Sales,Discovery" })
    );

    expect(mocks.previewDealImport).not.toHaveBeenCalled();
    expect(mocks.importDealsFromCsv).toHaveBeenCalledWith(
      actor,
      "title,pipeline,stage\nPipeline Deal,Sales,Discovery"
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/deals");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/pipeline");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(3, "/settings/import-export");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      csvText: "title,pipeline,stage\nPipeline Deal,Sales,Discovery",
      preview: dealPreview,
      result: dealResult
    });
  });

  it("imports organizations through the preview-first server action", async () => {
    const organizationPreview = preview();
    const organizationResult = {
      preview: organizationPreview,
      createdCount: 1,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: 0,
      failedRows: [],
      createdOrganizations: [{ id: "org_1", name: "Acme Corporation" }]
    };
    mocks.importOrganizationsFromCsv.mockResolvedValue(organizationResult);

    const result = await previewOrganizationImportAction(
      { csvText: "" },
      formData({ intent: "import", organizationCsv: "name,domain\nAcme Corporation,acme.example" })
    );

    expect(mocks.previewOrganizationImport).not.toHaveBeenCalled();
    expect(mocks.importOrganizationsFromCsv).toHaveBeenCalledWith(
      actor,
      "name,domain\nAcme Corporation,acme.example"
    );
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/organizations");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/settings/import-export");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      csvText: "name,domain\nAcme Corporation,acme.example",
      preview: organizationPreview,
      result: organizationResult
    });
  });

  it("imports leads through the preview-first server action and revalidates lead routes", async () => {
    const leadPreview = preview();
    const leadResult = {
      preview: leadPreview,
      createdCount: 1,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      errorCount: 0,
      failedRows: [],
      createdLeads: [{ id: "lead_1", title: "Qualified Lead" }]
    };
    mocks.importLeadsFromCsv.mockResolvedValue(leadResult);

    const result = await previewLeadImportAction(
      { csvText: "" },
      formData({ intent: "import", leadCsv: "title,source\nQualified Lead,Website" })
    );

    expect(mocks.previewLeadImport).not.toHaveBeenCalled();
    expect(mocks.importLeadsFromCsv).toHaveBeenCalledWith(actor, "title,source\nQualified Lead,Website");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/leads");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/settings/import-export");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      csvText: "title,source\nQualified Lead,Website",
      preview: leadPreview,
      result: leadResult
    });
  });

  it("redacts sensitive failure details before returning import action errors", async () => {
    mocks.previewLeadImport.mockRejectedValue(
      new Error(
        "CSV parser failed for founder@example.test with Bearer raw-import-token at /reset-password?token=raw-reset-token"
      )
    );

    const result = await previewLeadImportAction({ csvText: "" }, formData({ leadCsv: "title\nSecret Lead" }));

    expect(result.csvText).toBe("title\nSecret Lead");
    expect(result.error).toBe(
      "CSV parser failed for [redacted email] with Bearer [redacted] at [redacted reset url]"
    );
    expect(result.error).not.toContain("founder@example.test");
    expect(result.error).not.toContain("raw-import-token");
    expect(result.error).not.toContain("raw-reset-token");
  });

  it("does not revalidate list routes after failed imports and redacts import errors", async () => {
    mocks.importDealsFromCsv.mockRejectedValue(
      new Error(
        "Deal import failed for founder@example.test with api_key=raw-import-api-key and /reset-password?token=raw-import-reset-token"
      )
    );

    const result = await previewDealImportAction(
      { csvText: "" },
      formData({ intent: "import", dealCsv: "title,pipeline,stage\nSecret Deal,Sales,Discovery" })
    );

    expect(mocks.previewDealImport).not.toHaveBeenCalled();
    expect(mocks.importDealsFromCsv).toHaveBeenCalledWith(
      actor,
      "title,pipeline,stage\nSecret Deal,Sales,Discovery"
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(result.csvText).toBe("title,pipeline,stage\nSecret Deal,Sales,Discovery");
    expect(result.error).toBe(
      "Deal import failed for [redacted email] with api_key=[redacted] and [redacted reset url]"
    );
    expect(result.error).not.toContain("founder@example.test");
    expect(result.error).not.toContain("raw-import-api-key");
    expect(result.error).not.toContain("raw-import-reset-token");
  });

  it("returns generic import action failures for non-error throws", async () => {
    mocks.previewOrganizationImport.mockRejectedValue("raw string failure with token=raw-token");

    const result = await previewOrganizationImportAction(
      { csvText: "" },
      formData({ organizationCsv: "name\nAcme" })
    );

    expect(result).toEqual({
      csvText: "name\nAcme",
      error: "Organization import preview failed."
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
