import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildContractWorkflowItems } from "@/components/contract-workflow-panel";

const dealDetailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const contractPanel = readFileSync(join(process.cwd(), "components/contract-workflow-panel.tsx"), "utf8");
const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const signupActions = readFileSync(join(process.cwd(), "app/signup/actions.ts"), "utf8");
const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const smokeSpec = readFileSync(join(process.cwd(), "tests/browser/smoke.spec.ts"), "utf8");

describe("Contract workflow on deal detail", () => {
  it("renders a dedicated deal-detail workflow from existing NDA/MSA/SOW custom fields", () => {
    expect(dealDetailPage).toContain("ContractWorkflowPanel");
    expect(dealDetailPage).toContain("ContractWorkflowQuickLink");
    expect(dealDetailPage).toContain("const contractFields = customFields.map");
    expect(dealDetailPage).toContain("listDealCustomFields(actor, deal.id)");
    expect(contractPanel).toContain("Contract Workflow");
    expect(contractPanel).toContain("href=\"#contract-workflow\"");
    expect(contractPanel).toContain("id=\"contract-workflow\"");
    expect(contractPanel).toContain("NDA Status");
    expect(contractPanel).toContain("MSA Status");
    expect(contractPanel).toContain("SOW Status");
    expect(contractPanel).toContain("Track whether NDA, MSA, and SOW are requested, sent, signed, or blocked.");
    expect(contractPanel).toContain("Document generation and e-signature can be added later.");
    expect(contractPanel).toContain("href=\"/custom-fields\"");
    expect(contractPanel).toContain("Add contract follow-up");
    expect(contractPanel).toContain("buildActivityFollowUpHref");
  });

  it("maps seeded statuses in the intended order and handles missing values", () => {
    expect(
      buildContractWorkflowItems([
        { key: "sow_status", name: "SOW Status", value: "Requested" },
        { key: "nda_status", name: "NDA Status", value: "Signed" },
        { key: "msa_status", name: "MSA Status", value: "In Review" }
      ])
    ).toEqual([
      { label: "NDA", fieldName: "NDA Status", status: "Signed", tone: "success" },
      { label: "MSA", fieldName: "MSA Status", status: "In Review", tone: "review" },
      { label: "SOW", fieldName: "SOW Status", status: "Requested", tone: "active" }
    ]);

    expect(buildContractWorkflowItems([{ key: "nda_status", name: "NDA Status", value: null }])).toEqual([
      { label: "NDA", fieldName: "NDA Status", status: "Not started", tone: "neutral" },
      { label: "MSA", fieldName: "MSA Status", status: "Not started", tone: "neutral" },
      { label: "SOW", fieldName: "SOW Status", status: "Not started", tone: "neutral" }
    ]);
    expect(buildContractWorkflowItems([])).toEqual([]);
  });

  it("keeps the workflow lightweight and avoids fake contract actions", () => {
    expect(contractPanel).toContain("ContractWorkflowSummary");
    expect(contractPanel).toContain("contract-status-chip");
    expect(contractPanel).toContain("contract-status-mini");
    expect(globals).toContain(".contract-status-success");
    expect(globals).toContain(".contract-status-blocked");
    expect(contractPanel).not.toContain("Upload");
    expect(contractPanel).not.toContain("Send");
    expect(contractPanel).not.toContain("Sign");
    expect(contractPanel).not.toContain("Generate");
  });

  it("does not add seeded contract data to normal signup-created workspaces", () => {
    const signupPath = [signupActions, workspaceService].join("\n");

    expect(signupPath).not.toContain("NDA Status");
    expect(signupPath).not.toContain("MSA Status");
    expect(signupPath).not.toContain("SOW Status");
    expect(signupPath).not.toContain("contractStatusOptions");
  });

  it("adds seeded browser smoke coverage for visible contract statuses", () => {
    expect(smokeSpec).toContain("Contract Workflow");
    expect(smokeSpec).toContain(".contract-workflow-panel");
    expect(smokeSpec).toContain(".contract-status-summary");
    expect(smokeSpec).toContain("SOW Status");
  });
});
