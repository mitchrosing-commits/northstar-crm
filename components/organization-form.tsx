"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type EntityOption = {
  id: string;
  name: string;
};

type OrganizationFormInitial = {
  id: string;
  name: string;
  domain: string | null;
  ownerId: string | null;
};

type OrganizationFormProps = {
  mode: "create" | "edit";
  workspaceId: string;
  owners: EntityOption[];
  defaultOwnerId?: string;
  initialOrganization?: OrganizationFormInitial;
};

export function OrganizationForm({
  mode,
  workspaceId,
  owners,
  defaultOwnerId,
  initialOrganization
}: OrganizationFormProps) {
  const router = useRouter();
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [name, setName] = useState(initialOrganization?.name ?? "");
  const [domain, setDomain] = useState(initialOrganization?.domain ?? "");
  const [ownerId, setOwnerId] = useState(initialOrganization?.ownerId ?? defaultCreateOwnerId);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Add an organization name before saving.");
      return;
    }

    setIsSaving(true);
    const payload = {
      name: name.trim(),
      domain: domain.trim() || null,
      ownerId: ownerId || null
    };

    const endpoint =
      mode === "create"
        ? `/api/v1/workspaces/${workspaceId}/organizations`
        : `/api/v1/workspaces/${workspaceId}/organizations/${initialOrganization?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not save the organization.");
      setIsSaving(false);
      return;
    }

    const organization = await response.json();
    router.push(`/organizations/${organization.id}`);
    router.refresh();
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>Name</span>
          <input onChange={(event) => setName(event.target.value)} required value={name} />
        </label>

        <label className="form-field">
          <span>Domain</span>
          <input onChange={(event) => setDomain(event.target.value)} placeholder="example.com" value={domain} />
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
      </div>

      <div className="form-actions">
        <button className="button-primary" disabled={isSaving || !name.trim()} type="submit">
          {isSaving ? "Saving..." : mode === "create" ? "Create organization" : "Save changes"}
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
