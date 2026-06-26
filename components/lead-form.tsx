"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type LeadStatus = "NEW" | "QUALIFIED" | "DISQUALIFIED";

type EntityOption = {
  id: string;
  name: string;
};

type LeadFormInitial = {
  id: string;
  title: string;
  source: string | null;
  status: LeadStatus;
  ownerId: string | null;
  personId: string | null;
  organizationId: string | null;
};

type LeadFormProps = {
  mode: "create" | "edit";
  workspaceId: string;
  people: EntityOption[];
  organizations: EntityOption[];
  owners: EntityOption[];
  defaultOwnerId?: string;
  initialLead?: LeadFormInitial;
};

export function LeadForm({
  mode,
  workspaceId,
  people,
  organizations,
  owners,
  defaultOwnerId,
  initialLead
}: LeadFormProps) {
  const router = useRouter();
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [title, setTitle] = useState(initialLead?.title ?? "");
  const [source, setSource] = useState(initialLead?.source ?? "");
  const [status, setStatus] = useState<LeadStatus>(initialLead?.status ?? "NEW");
  const [ownerId, setOwnerId] = useState(initialLead?.ownerId ?? defaultCreateOwnerId);
  const [personId, setPersonId] = useState(initialLead?.personId ?? "");
  const [organizationId, setOrganizationId] = useState(initialLead?.organizationId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Add a lead title before saving.");
      return;
    }

    setIsSaving(true);
    const payload = {
      title: title.trim(),
      source: source.trim() || null,
      status,
      ownerId: ownerId || null,
      personId: personId || null,
      organizationId: organizationId || null
    };

    const endpoint =
      mode === "create"
        ? `/api/v1/workspaces/${workspaceId}/leads`
        : `/api/v1/workspaces/${workspaceId}/leads/${initialLead?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not save the lead.");
      setIsSaving(false);
      return;
    }

    const lead = await response.json();
    router.push(`/leads/${lead.id}`);
    router.refresh();
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      {mode === "create" ? (
        <p className="empty-copy" style={{ marginBottom: 14 }}>
          Capture a possible opportunity before it is qualified. Link a contact or organization now, or add those
          records later when you know more.
        </p>
      ) : null}
      {mode === "create" && (people.length === 0 || organizations.length === 0) ? (
        <div className="data-card" style={{ marginBottom: 14 }}>
          <h2 className="panel-title">Need a related record?</h2>
          <p className="empty-copy" style={{ marginBottom: 12 }}>
            Leads can start without a contact or organization. Add one first if you already know the buyer or company.
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
          </div>
        </div>
      ) : null}
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>Title</span>
          <input onChange={(event) => setTitle(event.target.value)} required value={title} />
        </label>

        <label className="form-field">
          <span>Source</span>
          <input onChange={(event) => setSource(event.target.value)} value={source} />
        </label>

        <label className="form-field">
          <span>Status</span>
          <select onChange={(event) => setStatus(event.target.value as LeadStatus)} value={status}>
            <option value="NEW">New</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="DISQUALIFIED">Disqualified</option>
          </select>
        </label>

        <label className="form-field">
          <span>Assigned to</span>
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
          <span>Person</span>
          <select onChange={(event) => setPersonId(event.target.value)} value={personId}>
            <option value="">{people.length === 0 ? "No contacts yet - save lead without contact" : "None"}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {people.length === 0 ? <small className="form-hint">Add a contact later when the lead is clearer.</small> : null}
        </label>

        <label className="form-field">
          <span>Organization</span>
          <select onChange={(event) => setOrganizationId(event.target.value)} value={organizationId}>
            <option value="">{organizations.length === 0 ? "No organizations yet - save lead without one" : "None"}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
          {organizations.length === 0 ? <small className="form-hint">Add the company later or create it before saving.</small> : null}
        </label>
      </div>

      <div className="form-actions">
        <button className="button-primary" disabled={isSaving || !title.trim()} type="submit">
          {isSaving ? "Saving..." : mode === "create" ? "Create lead" : "Save changes"}
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
