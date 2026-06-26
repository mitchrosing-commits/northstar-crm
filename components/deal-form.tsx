"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

type StageOption = {
  id: string;
  name: string;
  pipelineId: string;
  pipelineName: string;
};

type EntityOption = {
  id: string;
  name: string;
};

type DealFormInitial = {
  id: string;
  title: string;
  valueCents: number | null;
  currency: string;
  status: "OPEN" | "WON" | "LOST";
  expectedCloseAt: Date | string | null;
  stageId: string;
  personId: string | null;
  organizationId: string | null;
  ownerId: string | null;
};

type DealFormProps = {
  mode: "create" | "edit";
  workspaceId: string;
  stages: StageOption[];
  people: EntityOption[];
  organizations: EntityOption[];
  owners: EntityOption[];
  defaultOwnerId?: string;
  initialDeal?: DealFormInitial;
};

export function DealForm({
  mode,
  workspaceId,
  stages,
  people,
  organizations,
  owners,
  defaultOwnerId,
  initialDeal
}: DealFormProps) {
  const router = useRouter();
  const defaultStage = initialDeal?.stageId ?? stages[0]?.id ?? "";
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [title, setTitle] = useState(initialDeal?.title ?? "");
  const [value, setValue] = useState(initialDeal?.valueCents == null ? "" : String(initialDeal.valueCents / 100));
  const [currency, setCurrency] = useState(initialDeal?.currency ?? "USD");
  const [stageId, setStageId] = useState(defaultStage);
  const [personId, setPersonId] = useState(initialDeal?.personId ?? "");
  const [organizationId, setOrganizationId] = useState(initialDeal?.organizationId ?? "");
  const [ownerId, setOwnerId] = useState(initialDeal?.ownerId ?? defaultCreateOwnerId);
  const [expectedCloseAt, setExpectedCloseAt] = useState(formatDateInput(initialDeal?.expectedCloseAt));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedStage = useMemo(() => stages.find((stage) => stage.id === stageId), [stageId, stages]);
  const canSubmit = stages.length > 0 && title.trim().length > 0 && selectedStage;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!selectedStage) {
      setError("Choose a stage before saving this deal.");
      return;
    }

    const valueCents = parseValueCents(value);
    if (valueCents === "INVALID") {
      setError("Enter a valid non-negative deal value.");
      return;
    }

    setIsSaving(true);
    const payload = {
      title: title.trim(),
      valueCents,
      currency: currency.trim().toUpperCase(),
      pipelineId: selectedStage.pipelineId,
      stageId: selectedStage.id,
      personId: personId || null,
      organizationId: organizationId || null,
      ownerId: ownerId || null,
      expectedCloseAt: expectedCloseAt ? new Date(`${expectedCloseAt}T00:00:00.000Z`).toISOString() : null,
      ...(mode === "create" ? { status: "OPEN" as const } : {})
    };

    const endpoint =
      mode === "create"
        ? `/api/v1/workspaces/${workspaceId}/deals`
        : `/api/v1/workspaces/${workspaceId}/deals/${initialDeal?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not save the deal.");
      setIsSaving(false);
      return;
    }

    const deal = await response.json();
    router.push(`/deals/${deal.id}`);
    router.refresh();
  }

  if (stages.length === 0) {
    return (
      <div className="empty-state">
        <h2>No stages available</h2>
        <p>Add or restore an active pipeline stage before creating deals.</p>
      </div>
    );
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      {mode === "create" ? (
        <div className="empty-copy" style={{ marginBottom: 14 }}>
          Create a deal now, even if the buyer or company is not in Northstar yet. You can link a contact or
          organization later, or add them first from the shortcuts below.
        </div>
      ) : null}
      {mode === "create" && (people.length === 0 || organizations.length === 0) ? (
        <div className="data-card" style={{ marginBottom: 14 }}>
          <div className="panel-title-row">
            <h2 className="panel-title">Missing related records?</h2>
          </div>
          <p className="empty-copy" style={{ marginBottom: 12 }}>
            Deals can be created without a contact or organization for now. Add related records first if you want the
            deal linked from day one, or import contacts from a CSV.
          </p>
          <div className="filter-actions">
            {people.length === 0 ? (
              <Link className="button-secondary button-compact" href={"/contacts/new" as Route}>
                Add a contact
              </Link>
            ) : null}
            {organizations.length === 0 ? (
              <Link className="button-secondary button-compact" href={"/organizations/new" as Route}>
                Add an organization
              </Link>
            ) : null}
            <Link className="button-secondary button-compact" href={"/settings/import-export" as Route}>
              Import contacts
            </Link>
          </div>
        </div>
      ) : null}
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} required />
        </label>

        <label className="form-field">
          <span>Value</span>
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => setValue(event.target.value)}
            placeholder="0"
            type="number"
            value={value}
          />
        </label>

        <label className="form-field">
          <span>Currency</span>
          <input
            maxLength={3}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            required
            value={currency}
          />
        </label>

        <label className="form-field">
          <span>Stage</span>
          <select onChange={(event) => setStageId(event.target.value)} required value={stageId}>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.pipelineName} / {stage.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Person</span>
          <select onChange={(event) => setPersonId(event.target.value)} value={personId}>
            <option value="">{people.length === 0 ? "No contacts yet - create deal without contact" : "None"}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {people.length === 0 ? <small className="form-hint">You can add or import contacts after creating this deal.</small> : null}
        </label>

        <label className="form-field">
          <span>Organization</span>
          <select onChange={(event) => setOrganizationId(event.target.value)} value={organizationId}>
            <option value="">{organizations.length === 0 ? "No organizations yet - create deal without one" : "None"}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
          {organizations.length === 0 ? <small className="form-hint">You can add an organization after creating this deal.</small> : null}
        </label>

        <label className="form-field">
          <span>Deal owner</span>
          <select onChange={(event) => setOwnerId(event.target.value)} value={ownerId}>
            <option value="">{owners.length === 0 ? "No workspace members available" : "Unassigned"}</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <OwnerHint owners={owners} />
        </label>

        <label className="form-field">
          <span>Expected close</span>
          <input onChange={(event) => setExpectedCloseAt(event.target.value)} type="date" value={expectedCloseAt} />
        </label>
      </div>

      <div className="form-actions">
        <button className="button-primary" disabled={!canSubmit || isSaving} type="submit">
          {isSaving ? "Saving..." : mode === "create" ? "Create deal" : "Save changes"}
        </button>
        <button className="button-secondary" onClick={() => router.back()} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}

function OwnerHint({ owners }: { owners: EntityOption[] }) {
  if (owners.length === 1) {
    return (
      <small className="form-hint">
        You are the only workspace member right now. Invite teammates later from{" "}
        <Link className="inline-link" href={"/settings" as Route}>
          Settings
        </Link>
        .
      </small>
    );
  }
  if (owners.length === 0) {
    return (
      <small className="form-hint">
        Save unassigned for now, then manage workspace members from{" "}
        <Link className="inline-link" href={"/settings" as Route}>
          Settings
        </Link>
        .
      </small>
    );
  }
  return null;
}

function parseValueCents(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return "INVALID";
  return Math.round(parsed * 100);
}

function formatDateInput(value?: Date | string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}
