"use client";

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
  initialLead?: LeadFormInitial;
};

export function LeadForm({
  mode,
  workspaceId,
  people,
  organizations,
  owners,
  initialLead
}: LeadFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialLead?.title ?? "");
  const [source, setSource] = useState(initialLead?.source ?? "");
  const [status, setStatus] = useState<LeadStatus>(initialLead?.status ?? "NEW");
  const [ownerId, setOwnerId] = useState(initialLead?.ownerId ?? "");
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
          <span>Owner</span>
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
          <span>Person</span>
          <select onChange={(event) => setPersonId(event.target.value)} value={personId}>
            <option value="">None</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Organization</span>
          <select onChange={(event) => setOrganizationId(event.target.value)} value={organizationId}>
            <option value="">None</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
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
