"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { formatDate } from "@/components/format";
import { LockedPanelNotice } from "@/components/locked-panel-notice";
import { PanelTitleRow } from "@/components/panel-title-row";
import { buildActivityFollowUpHref } from "@/lib/follow-up-links";

type ContractField = {
  key: string;
  name: string;
  value: unknown;
};

type ContractStepType = "NDA" | "MSA" | "SOW";
type ContractStepStatus = "NOT_STARTED" | "IN_PROGRESS" | "SENT" | "SIGNED" | "BLOCKED" | "SKIPPED";

type OwnerOption = {
  id: string;
  name: string;
};

export type ContractStepRecord = {
  id: string;
  type: ContractStepType;
  status: ContractStepStatus;
  ownerId: string | null;
  owner?: { name: string | null; email: string } | null;
  dueAt: Date | string | null;
  sentAt: Date | string | null;
  signedAt: Date | string | null;
  notes: string | null;
  externalReference: string | null;
};

export type ContractWorkflowItem = {
  id?: string;
  label: ContractStepType;
  fieldName: string;
  status: string;
  statusValue?: ContractStepStatus;
  tone: "neutral" | "active" | "review" | "success" | "blocked";
  ownerId?: string | null;
  ownerName?: string | null;
  dueAt?: Date | string | null;
  sentAt?: Date | string | null;
  signedAt?: Date | string | null;
  notes?: string | null;
  externalReference?: string | null;
  sequenceWarning?: string | null;
};

const contractSteps: Array<{ key: string; label: ContractStepType; name: string }> = [
  { key: "nda_status", label: "NDA", name: "NDA Status" },
  { key: "msa_status", label: "MSA", name: "MSA Status" },
  { key: "sow_status", label: "SOW", name: "SOW Status" }
];

const statusOptions: Array<{ value: ContractStepStatus; label: string }> = [
  { value: "NOT_STARTED", label: "Not started" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "SENT", label: "Sent" },
  { value: "SIGNED", label: "Signed" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "SKIPPED", label: "Skipped" }
];

export function ContractWorkflowPanel({
  dealId,
  fields = [],
  lockedMessage,
  owners = [],
  readOnly = false,
  steps = [],
  workspaceId
}: {
  dealId?: string;
  fields?: ContractField[];
  lockedMessage?: string;
  owners?: OwnerOption[];
  readOnly?: boolean;
  steps?: ContractStepRecord[];
  workspaceId?: string;
}) {
  const items = buildContractWorkflowItemsFromSteps(steps, fields);
  const nextAction = firstOpenContractStep(items);
  const completion = contractCompletionSummary(items);
  const needsFollowUp = items.some((item) =>
    ["Sent", "In progress", "Blocked"].includes(item.status)
  );
  const summaryActionsLabel = "Contract workflow summary actions";
  const followUpActionLabel = "Contract workflow: add follow-up activity";

  return (
    <section className="data-card contract-workflow-panel section-spaced" id="contract-workflow">
      <PanelTitleRow
        actions={
          <ActionGroup className="filter-actions" label={summaryActionsLabel}>
            <span className="contract-progress-count">{completion}</span>
            {nextAction ? <span className={`contract-status-chip contract-status-${nextAction.tone}`}>Next: {nextAction.label}</span> : <span className="contract-status-chip contract-status-success">Complete</span>}
            {dealId && needsFollowUp && !readOnly ? (
              <Link
                aria-label={followUpActionLabel}
                className="button-secondary button-compact"
                href={buildActivityFollowUpHref({
                  description: "Review NDA, MSA, and SOW status and unblock the next contract step.",
                  dueInDays: 1,
                  related: { type: "deal", id: dealId },
                  returnTo: `/deals/${dealId}`,
                  title: "Contract workflow follow-up",
                  type: "TASK"
                })}
                title={followUpActionLabel}
              >
                Add contract follow-up
              </Link>
            ) : null}
          </ActionGroup>
        }
        description="NDA → MSA → SOW. Track the sales agreement path from NDA to MSA to SOW. OpenContracts templates, document storage, and e-signature integration are a future layer, not part of this local CRM slice."
        eyebrow="Contract management"
        title="Contract Workflow"
      />
      {readOnly ? (
        <LockedPanelNotice>{lockedMessage ?? "Contract workflow steps are read-only for this deal."}</LockedPanelNotice>
      ) : null}
      <ol className="contract-progress-rail" aria-label="Contract sequence progress">
        {items.map((item, index) => (
          <li className={`contract-progress-step contract-progress-step-${item.tone}`} key={item.label}>
            <span className="contract-progress-node">{index + 1}</span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.status}</small>
            </span>
          </li>
        ))}
      </ol>
      {nextAction ? (
        <div className="contract-next-action">
          <strong>{nextContractActionLabel(nextAction)}</strong>
          <span>{contractNextActionDetail(nextAction)}</span>
        </div>
      ) : (
        <div className="contract-next-action contract-next-action-complete">
          <strong>Contract path complete</strong>
          <span>NDA, MSA, and SOW are signed or intentionally skipped.</span>
        </div>
      )}
      <div className="contract-workflow-grid">
        {items.map((item) => (
          <ContractStepEditor
            dealId={dealId}
            item={item}
            key={item.label}
            owners={owners}
            readOnly={readOnly}
            workspaceId={workspaceId}
          />
        ))}
      </div>
    </section>
  );
}

export function ContractWorkflowQuickLink({
  alwaysShow = false,
  fields = [],
  steps = []
}: {
  alwaysShow?: boolean;
  fields?: ContractField[];
  steps?: ContractStepRecord[];
}) {
  const items = buildContractWorkflowItemsFromSteps(steps, fields);
  if (!alwaysShow && items.every((item) => item.status === "Not started" && !item.id)) return null;

  return (
    <Link className="contract-workflow-quick-link" href="#contract-workflow">
      <span>Contracts</span>
      <ContractWorkflowSummary fields={fields} steps={steps} />
    </Link>
  );
}

export function ContractWorkflowSummary({ fields = [], steps = [] }: { fields?: ContractField[]; steps?: ContractStepRecord[] }) {
  if (fields.length === 0 && steps.length === 0) return null;
  const items = buildContractWorkflowItemsFromSteps(steps, fields);
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

export function buildContractWorkflowItemsFromSteps(steps: ContractStepRecord[] = [], fields: ContractField[] = []) {
  const byType = new Map(steps.map((step) => [step.type, step]));
  const legacyItems = new Map(buildContractWorkflowItems(fields).map((item) => [item.label, item]));
  const items = contractSteps.map((step) => {
    const record = byType.get(step.label);
    const legacy = legacyItems.get(step.label);
    const legacyStatusValue = legacyStatusToValue(legacy?.status);
    const status = record ? contractStatusLabel(record.status) : legacyStatusValue ? contractStatusLabel(legacyStatusValue) : legacy?.status ?? "Not started";
    const item: ContractWorkflowItem = {
      id: record?.id,
      label: step.label,
      fieldName: step.name,
      status,
      statusValue: record?.status ?? legacyStatusValue,
      tone: contractStatusTone(status),
      ownerId: record?.ownerId ?? null,
      ownerName: record?.owner?.name ?? record?.owner?.email ?? null,
      dueAt: record?.dueAt ?? null,
      sentAt: record?.sentAt ?? null,
      signedAt: record?.signedAt ?? null,
      notes: record?.notes ?? null,
      externalReference: record?.externalReference ?? null
    };
    return item;
  });

  return items.map((item, index) => ({
    ...item,
    sequenceWarning: contractSequenceWarning(items, index)
  }));
}

function ContractStepEditor({
  dealId,
  item,
  owners,
  readOnly,
  workspaceId
}: {
  dealId?: string;
  item: ContractWorkflowItem;
  owners: OwnerOption[];
  readOnly?: boolean;
  workspaceId?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<ContractStepStatus>(item.statusValue ?? "NOT_STARTED");
  const [ownerId, setOwnerId] = useState(item.ownerId ?? "");
  const [dueAt, setDueAt] = useState(dateInputValue(item.dueAt));
  const [sentAt, setSentAt] = useState(dateInputValue(item.sentAt));
  const [signedAt, setSignedAt] = useState(dateInputValue(item.signedAt));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [externalReference, setExternalReference] = useState(item.externalReference ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const canSave = Boolean(workspaceId && dealId);
  const statusPreview = useMemo(() => contractStatusLabel(status), [status]);

  if (readOnly) {
    return (
      <div className={`contract-step-card contract-step-card-${contractStatusTone(statusPreview)}`}>
        <div className="contract-step-header">
          <span className="contract-step-label">{item.label}</span>
          <span className={`contract-status-chip contract-status-${contractStatusTone(statusPreview)}`}>{statusPreview}</span>
        </div>
        <span className="muted">{item.fieldName}</span>
        <div className="contract-step-meta">
          <span>{contractOwnerLabel(item)}</span>
          <span>{contractDateLabel(item)}</span>
          {item.externalReference ? <span>Document: {item.externalReference}</span> : null}
        </div>
        {item.sequenceWarning ? <p className="form-hint">{item.sequenceWarning}</p> : null}
        {item.notes ? <p className="empty-copy">{item.notes}</p> : null}
      </div>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !dealId) return;

    setError(null);
    setIsSaving(true);
    const response = await fetch(
      item.id
        ? `/api/v1/workspaces/${workspaceId}/contract-steps/${item.id}`
        : `/api/v1/workspaces/${workspaceId}/deals/${dealId}/contracts`,
      {
        method: item.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: item.label,
          status,
          ownerId: ownerId || null,
          dueAt: dateToIsoOrNull(dueAt),
          sentAt: dateToIsoOrNull(sentAt),
          signedAt: dateToIsoOrNull(signedAt),
          notes: notes.trim() || null,
          externalReference: externalReference.trim() || null
        })
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not save this contract step.");
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    router.refresh();
  }

  return (
    <form className={`contract-step-card contract-step-card-${contractStatusTone(statusPreview)}`} onSubmit={onSubmit}>
      <div className="contract-step-header">
        <span className="contract-step-label">{item.label}</span>
        <span className={`contract-status-chip contract-status-${contractStatusTone(statusPreview)}`}>{statusPreview}</span>
      </div>
      <span className="muted">{item.fieldName}</span>
      <div className="contract-step-meta">
        <span>{contractOwnerLabel(item)}</span>
        <span>{contractDateLabel(item)}</span>
        {item.externalReference ? <span>Document: {item.externalReference}</span> : null}
      </div>
      {item.sequenceWarning ? <p className="form-hint">{item.sequenceWarning}</p> : null}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <div className="contract-step-form-grid">
        <label className="form-field">
          <FormFieldLabel required>Status</FormFieldLabel>
          <select onChange={(event) => setStatus(event.target.value as ContractStepStatus)} value={status}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <FormFieldLabel>Owner</FormFieldLabel>
          <select onChange={(event) => setOwnerId(event.target.value)} value={ownerId}>
            <option value="">Unassigned</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <FormFieldLabel>Due</FormFieldLabel>
          <input onChange={(event) => setDueAt(event.target.value)} type="date" value={dueAt} />
        </label>
        <label className="form-field">
          <FormFieldLabel>Sent</FormFieldLabel>
          <input onChange={(event) => setSentAt(event.target.value)} type="date" value={sentAt} />
        </label>
        <label className="form-field">
          <FormFieldLabel>Signed</FormFieldLabel>
          <input onChange={(event) => setSignedAt(event.target.value)} type="date" value={signedAt} />
        </label>
        <label className="form-field">
          <FormFieldLabel>Document ref</FormFieldLabel>
          <input
            onChange={(event) => setExternalReference(event.target.value)}
            placeholder="OpenContracts/doc URL later"
            value={externalReference}
          />
        </label>
        <label className="form-field form-field-wide">
          <FormFieldLabel>Notes</FormFieldLabel>
          <textarea onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
        </label>
      </div>
      <FormActionBar
        compact
        disabledHintId={`contract-step-${item.label.toLowerCase()}-disabled-hint`}
        isSaving={isSaving}
        submitDisabled={!canSave}
        submitLabel={item.id ? "Update step" : "Create step"}
      />
    </form>
  );
}

function findContractField(fields: ContractField[], step: { key: string; name: string }) {
  const targetName = normalizeContractName(step.name);
  return fields.find((field) => field.key === step.key || normalizeContractName(field.name) === targetName);
}

function displayContractStatus(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not started";
  return String(value);
}

function contractStatusLabel(status: ContractStepStatus) {
  return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function legacyStatusToValue(status?: string): ContractStepStatus | undefined {
  const normalized = status?.trim().toLowerCase();
  if (!normalized || normalized === "not started") return "NOT_STARTED";
  if (normalized === "requested" || normalized === "in review" || normalized === "in progress") return "IN_PROGRESS";
  if (normalized === "sent") return "SENT";
  if (normalized === "signed") return "SIGNED";
  if (normalized === "blocked") return "BLOCKED";
  if (normalized === "skipped") return "SKIPPED";
  return undefined;
}

function contractStatusTone(status: string): ContractWorkflowItem["tone"] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "signed" || normalized === "skipped") return "success";
  if (normalized === "blocked") return "blocked";
  if (normalized === "in review" || normalized === "in progress" || normalized === "sent") return "review";
  if (normalized === "requested") return "active";
  return "neutral";
}

function firstOpenContractStep(items: ContractWorkflowItem[]) {
  return items.find((item) => !["Signed", "Skipped"].includes(item.status));
}

function nextContractActionLabel(item: ContractWorkflowItem) {
  if (item.status === "Not started") return `Start ${item.label}`;
  if (item.status === "Blocked") return `Unblock ${item.label}`;
  if (item.status === "Sent") return `Confirm ${item.label} signature`;
  if (item.status === "In progress") return `Move ${item.label} toward sending`;
  return `Review ${item.label}`;
}

function contractNextActionDetail(item: ContractWorkflowItem) {
  if (item.sequenceWarning) return item.sequenceWarning;
  const owner = item.ownerName ? `Owner: ${item.ownerName}.` : "Assign an owner if legal or sales should drive this step.";
  const due = item.dueAt ? `Due ${formatDate(item.dueAt)}.` : "Set a due date when timing matters.";
  if (item.status === "Blocked") return `${owner} Capture the blocker in notes and schedule a follow-up.`;
  if (item.status === "Sent") return `${owner} Confirm signature and record the signed date.`;
  return `${owner} ${due}`;
}

function contractCompletionSummary(items: ContractWorkflowItem[]) {
  const complete = items.filter((item) => ["Signed", "Skipped"].includes(item.status)).length;
  return `${complete}/${items.length} complete`;
}

function contractOwnerLabel(item: ContractWorkflowItem) {
  return `Owner: ${item.ownerName ?? "Unassigned"}`;
}

function contractDateLabel(item: ContractWorkflowItem) {
  if (item.signedAt) return `Signed: ${formatDate(item.signedAt)}`;
  if (item.sentAt) return `Sent: ${formatDate(item.sentAt)}`;
  return `Due: ${formatDate(item.dueAt)}`;
}

function contractSequenceWarning(items: ContractWorkflowItem[], index: number) {
  const previous = items.slice(0, index).find((item) => !["Signed", "Skipped"].includes(item.status));
  if (!previous) return null;
  return `${items[index].label} should not move forward until ${previous.label} is signed or skipped.`;
}

function dateInputValue(value?: Date | string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function dateToIsoOrNull(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function normalizeContractName(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
