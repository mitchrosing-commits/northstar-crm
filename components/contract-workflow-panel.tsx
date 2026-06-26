import Link from "next/link";

type ContractField = {
  key: string;
  name: string;
  value: unknown;
};

export type ContractWorkflowItem = {
  label: "NDA" | "MSA" | "SOW";
  fieldName: string;
  status: string;
  tone: "neutral" | "active" | "review" | "success" | "blocked";
};

const contractSteps: Array<{ key: string; label: ContractWorkflowItem["label"]; name: string }> = [
  { key: "nda_status", label: "NDA", name: "NDA Status" },
  { key: "msa_status", label: "MSA", name: "MSA Status" },
  { key: "sow_status", label: "SOW", name: "SOW Status" }
];

export function ContractWorkflowPanel({ fields }: { fields: ContractField[] }) {
  const items = buildContractWorkflowItems(fields);
  if (items.length === 0) return null;

  return (
    <section className="data-card contract-workflow-panel" id="contract-workflow" style={{ marginTop: 14 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Contract Workflow</h2>
        <Link className="inline-link" href="/custom-fields">
          Manage fields
        </Link>
      </div>
      <p className="empty-copy">
        Track the agreement path from NDA through MSA and SOW. Document generation and e-signature can be added later.
      </p>
      <div className="contract-workflow-grid">
        {items.map((item) => (
          <div className="contract-step-card" key={item.label}>
            <span className="contract-step-label">{item.label}</span>
            <span className={`contract-status-chip contract-status-${item.tone}`}>{item.status}</span>
            <span className="muted">{item.fieldName}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ContractWorkflowQuickLink({ fields }: { fields: ContractField[] }) {
  const items = buildContractWorkflowItems(fields);
  if (items.length === 0) return null;

  return (
    <Link className="contract-workflow-quick-link" href="#contract-workflow">
      <span>Contract Workflow</span>
      <ContractWorkflowSummary fields={fields} />
    </Link>
  );
}

export function ContractWorkflowSummary({ fields }: { fields: ContractField[] }) {
  const items = buildContractWorkflowItems(fields);
  if (items.length === 0) return null;

  return (
    <span className="contract-status-summary" aria-label="Contract workflow status summary">
      {items.map((item) => (
        <span className={`contract-status-mini contract-status-${item.tone}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.status}</strong>
        </span>
      ))}
    </span>
  );
}

export function buildContractWorkflowItems(fields: ContractField[]): ContractWorkflowItem[] {
  const hasContractWorkflow = contractSteps.some((step) => findContractField(fields, step));
  if (!hasContractWorkflow) return [];

  return contractSteps.map((step) => {
    const field = findContractField(fields, step);
    const status = displayContractStatus(field?.value);

    return {
      label: step.label,
      fieldName: field?.name ?? step.name,
      status,
      tone: contractStatusTone(status)
    };
  });
}

function findContractField(fields: ContractField[], step: { key: string; name: string }) {
  const targetName = normalizeContractName(step.name);
  return fields.find((field) => field.key === step.key || normalizeContractName(field.name) === targetName);
}

function displayContractStatus(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not started";
  return String(value);
}

function contractStatusTone(status: string): ContractWorkflowItem["tone"] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "signed") return "success";
  if (normalized === "blocked") return "blocked";
  if (normalized === "in review" || normalized === "sent") return "review";
  if (normalized === "requested") return "active";
  return "neutral";
}

function normalizeContractName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
