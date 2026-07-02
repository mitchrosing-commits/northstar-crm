import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildContractWorkflowItems, buildContractWorkflowItemsFromSteps } from "@/components/contract-workflow-panel";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const dealDetailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const contractPanel = readFileSync(join(process.cwd(), "components/contract-workflow-panel.tsx"), "utf8");
const lockedPanelNotice = readFileSync(join(process.cwd(), "components/locked-panel-notice.tsx"), "utf8");
const panelTitleRow = readFileSync(join(process.cwd(), "components/panel-title-row.tsx"), "utf8");
const contractService = readFileSync(join(process.cwd(), "lib/services/contract-workflow-service.ts"), "utf8");
const workspaceRoute = readFileSync(join(process.cwd(), "app/api/v1/workspaces/[workspaceId]/[...segments]/route.ts"), "utf8");
const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const signupActions = readFileSync(join(process.cwd(), "app/signup/actions.ts"), "utf8");
const workspaceService = readFileSync(join(process.cwd(), "lib/services/workspace-service.ts"), "utf8");
const architecture = readFileSync(join(process.cwd(), "docs/architecture.md"), "utf8");
const currentStatus = readFileSync(join(process.cwd(), "docs/current-status.md"), "utf8");
const openContractsNote = readFileSync(join(process.cwd(), "docs/opencontracts-contract-workflow-integration.md"), "utf8");
const smokeSpec = readFileSync(join(process.cwd(), "tests/browser/smoke.spec.ts"), "utf8");

describe("Contract workflow on deal detail", () => {
  it("adds a workspace-scoped deal contract workflow model and service", () => {
    expect(schema).toContain("model DealContractStep");
    expect(schema).toContain("enum ContractStepType");
    expect(schema).toContain("NDA");
    expect(schema).toContain("MSA");
    expect(schema).toContain("SOW");
    expect(schema).toContain("enum ContractStepStatus");
    expect(schema).toContain("NOT_STARTED");
    expect(schema).toContain("IN_PROGRESS");
    expect(schema).toContain("SENT");
    expect(schema).toContain("SIGNED");
    expect(schema).toContain("BLOCKED");
    expect(schema).toContain("SKIPPED");
    expect(schema).toContain("@@unique([workspaceId, dealId, type])");
    expect(contractService).toContain("export async function listDealContractSteps");
    expect(contractService).toContain("export async function listDealContractStepsForDeals");
    expect(contractService).toContain("export async function createDealContractStep");
    expect(contractService).toContain("export async function updateDealContractStep");
    expect(contractService).toContain("await assertRecordInWorkspace(\"deal\", actor.workspaceId, dealId)");
    expect(contractService).toContain("assertDealContractStepsEditable");
    expect(contractService).toContain("DEAL_CLOSED");
    expect(contractService).toContain("const contractInput = objectInput(input)");
    expect(contractService).toContain("function objectInput(input: unknown): Record<string, unknown>");
    expect(contractService).toContain("normalizeOptionalContractStepId(input.ownerId)");
    expect(contractService).toContain("Contract step owner id must be text.");
    expect(contractService).toContain("await assertUserInWorkspace(workspaceId, input.ownerId)");
    expect(contractService).toContain("CONTRACT_SEQUENCE_BLOCKED");
    expect(contractService).toContain("assertContractStepDateValues(contractInput)");
    expect(contractService).toContain("normalizeNullableContractDate(input.dueAt");
    expect(contractService).toContain("Contract signed date is invalid.");
    expect(contractService).toContain("normalizeContractStepType(contractInput.type)");
    expect(contractService).toContain("normalizeContractStepStatus(contractInput.status");
    expect(contractService).toContain("normalizeOptionalContractStepText(input.notes");
    expect(contractService).toContain("Contract notes must be text.");
    expect(contractService).toContain("Contract external reference must be text.");
    expect(contractService).toContain("Contract step update must be an object.");
    expect(contractService).toContain("Contract step type must be NDA, MSA, or SOW.");
    expect(contractService).toContain("Contract step status must be NOT_STARTED, IN_PROGRESS, SENT, SIGNED, BLOCKED, or SKIPPED.");
    expect(contractService).toContain("contractStepDataChanges(data, existing)");
    expect(contractService).toContain("nullableDatesEqual");
    expect(contractService).toContain("contract_step.created");
    expect(contractService).toContain("contract_step.status_changed");
  });

  it("wires contract workflow API routes through the workspace route boundary", () => {
    expect(workspaceRoute).toContain("deals\" && idOrNested && nestedResource === \"contracts\"");
    expect(workspaceRoute).toContain("listDealContractSteps(actor, idOrNested)");
    expect(workspaceRoute).toContain("createDealContractStep(actor, idOrNested, createDealContractStepSchema.parse");
    expect(workspaceRoute).toContain("resource === \"contract-steps\"");
    expect(workspaceRoute).toContain("updateDealContractStep(actor, idOrNested, updateDealContractStepSchema.parse");
  });

  it("renders a dedicated deal-detail workflow with real contract steps and legacy field fallback", () => {
    expect(dealDetailPage).toContain("ContractWorkflowPanel");
    expect(dealDetailPage).toContain("ContractWorkflowQuickLink");
    expect(dealDetailPage).toContain('href: "#contract-workflow" as Route');
    expect(dealDetailPage).toContain("count: contractSteps.length");
    expect(dealDetailPage).toContain('countLabel: { singular: "contract step", plural: "contract steps" }');
    expect(dealDetailPage).toContain("listDealContractSteps(actor, deal.id)");
    expect(dealDetailPage).toContain("steps={contractSteps}");
    expect(dealDetailPage).toContain("owners={owners}");
    expect(dealDetailPage).toContain("readOnly={deal.status !== \"OPEN\"}");
    expect(dealDetailPage).toContain('lockedMessage={closedDealLockMessage("contractWorkflow")}');
    expect(dealDetailPage).toContain("workspaceId={workspace.id}");
    expect(dealDetailPage).toContain("const contractFields = customFields.map");
    expect(dealDetailPage).toContain("listDealCustomFields(actor, deal.id)");
    expect(contractPanel).toContain("Contract Workflow");
    expect(contractPanel).toContain("href=\"#contract-workflow\"");
    expect(contractPanel).toContain("id=\"contract-workflow\"");
    expect(contractPanel).toContain("className=\"data-card contract-workflow-panel section-spaced\"");
    expect(contractPanel).toContain("PanelTitleRow");
    expect(contractPanel).toContain("eyebrow=\"Contract management\"");
    expect(contractPanel).toContain("description=\"NDA → MSA → SOW.");
    expect(contractPanel).toContain("title=\"Contract Workflow\"");
    expect(contractPanel).toContain('const summaryActionsLabel = "Contract workflow summary actions";');
    expect(contractPanel).toContain("import { ActionGroup }");
    expect(contractPanel).toContain('<ActionGroup className="filter-actions" label={summaryActionsLabel}>');
    expect(panelTitleRow).toContain("export function PanelTitleRow");
    expect(panelTitleRow).toContain("description?: ReactNode");
    expect(contractPanel).toContain("NDA → MSA → SOW");
    expect(contractPanel).toContain("contract-progress-rail");
    expect(contractPanel).toContain("contractCompletionSummary");
    expect(contractPanel).toContain("NDA Status");
    expect(contractPanel).toContain("MSA Status");
    expect(contractPanel).toContain("SOW Status");
    expect(contractPanel).toContain("OpenContracts templates, document storage, and e-signature integration are a future layer");
    expect(contractPanel).not.toContain("panel-intro-copy");
    expect(contractPanel).toContain('const followUpActionLabel = "Contract workflow: add follow-up activity";');
    expect(contractPanel).toContain("aria-label={followUpActionLabel}");
    expect(contractPanel).toContain("title={followUpActionLabel}");
    expect(contractPanel).toContain("Add contract follow-up");
    expect(contractPanel).toContain("readOnly");
    expect(contractPanel).toContain("LockedPanelNotice");
    expect(lockedPanelNotice).toContain("title = \"Read-only\"");
    expect(contractPanel).toContain("buildActivityFollowUpHref");
    expect(contractPanel).toContain("Create step");
    expect(contractPanel).toContain("Update step");
    expect(contractPanel).toContain("import { FormFieldLabel }");
    expect(contractPanel).toContain("<FormFieldLabel required>Status</FormFieldLabel>");
    expect(contractPanel).toContain("<FormFieldLabel>Owner</FormFieldLabel>");
    expect(contractPanel).toContain("<FormFieldLabel>Due</FormFieldLabel>");
    expect(contractPanel).toContain("<FormFieldLabel>Sent</FormFieldLabel>");
    expect(contractPanel).toContain("<FormFieldLabel>Signed</FormFieldLabel>");
    expect(contractPanel).toContain("<FormFieldLabel>Document ref</FormFieldLabel>");
    expect(contractPanel).toContain("<FormFieldLabel>Notes</FormFieldLabel>");
  });

  it("maps seeded legacy statuses and persisted contract steps in the intended order", () => {
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
    expect(
      buildContractWorkflowItemsFromSteps([
        {
          id: "sow_1",
          type: "SOW",
          status: "BLOCKED",
          ownerId: null,
          owner: null,
          dueAt: null,
          sentAt: null,
          signedAt: null,
          notes: "Waiting on scope",
          externalReference: null
        },
        {
          id: "nda_1",
          type: "NDA",
          status: "SIGNED",
          ownerId: "user_1",
          owner: { name: "Legal Owner", email: "legal@example.test" },
          dueAt: "2030-01-01T00:00:00.000Z",
          sentAt: "2030-01-02T00:00:00.000Z",
          signedAt: "2030-01-03T00:00:00.000Z",
          notes: null,
          externalReference: "doc-123"
        }
      ]).map((item) => ({ label: item.label, status: item.status, tone: item.tone }))
    ).toEqual([
      { label: "NDA", status: "Signed", tone: "success" },
      { label: "MSA", status: "Not started", tone: "neutral" },
      { label: "SOW", status: "Blocked", tone: "blocked" }
    ]);
  });

  it("keeps the workflow lightweight and avoids fake document-generation actions", () => {
    expect(contractPanel).toContain("ContractWorkflowSummary");
    expect(contractPanel).toContain("contract-status-chip");
    expect(contractPanel).toContain("contract-status-mini");
    expect(globals).toContain(".contract-progress-rail");
    expect(globals).toContain(".contract-status-success");
    expect(globals).toContain(".contract-status-blocked");
    expect(contractPanel).not.toContain("Send");
    expect(contractPanel).not.toContain("Generate");
    expect(architecture).toContain("OpenContracts templates, document generation/storage, redlining, approvals, and signatures remain a future integration layer");
    expect(architecture).toContain("docs/opencontracts-contract-workflow-integration.md");
    expect(currentStatus).toContain("database-backed contract workflow");
    expect(currentStatus).toContain("compact contract workflow summaries from real deal contract steps");
    expect(currentStatus).toContain("OpenContracts templates, document generation/storage, redlining, approvals, and e-signature are future integration layers");
  });

  it("documents a practical future OpenContracts boundary", () => {
    expect(openContractsNote).toContain("future document layer");
    expect(openContractsNote).toContain("DealContractStep.externalReference");
    expect(openContractsNote).toContain("CRM-to-OpenContracts mapping");
    expect(openContractsNote).toContain("Tenant/workspace isolation");
    expect(openContractsNote).toContain("Keep local NDA -> MSA -> SOW workflow authoritative");
    expect(openContractsNote).not.toContain("implement");
  });

  it("does not add seeded contract data to normal signup-created workspaces", () => {
    const signupPath = [signupActions, workspaceService].join("\n");

    expect(signupPath).not.toContain("NDA Status");
    expect(signupPath).not.toContain("MSA Status");
    expect(signupPath).not.toContain("SOW Status");
    expect(signupPath).not.toContain("contractStatusOptions");
  });

  it("adds seeded browser smoke coverage for visible contract statuses", () => {
    expect(smokeSpec).toContain("Contract management");
    expect(smokeSpec).toContain(".contract-workflow-panel");
    expect(smokeSpec).toContain(".contract-status-summary");
    expect(smokeSpec).toContain("In progress");
  });
});
