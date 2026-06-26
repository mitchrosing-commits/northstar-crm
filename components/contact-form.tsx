"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type EntityOption = {
  id: string;
  name: string;
};

type ContactFormInitial = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  organizationId: string | null;
  ownerId: string | null;
};

type ContactFormProps = {
  mode: "create" | "edit";
  workspaceId: string;
  organizations: EntityOption[];
  owners: EntityOption[];
  defaultOwnerId?: string;
  initialContact?: ContactFormInitial;
};

export function ContactForm({
  mode,
  workspaceId,
  organizations,
  owners,
  defaultOwnerId,
  initialContact
}: ContactFormProps) {
  const router = useRouter();
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [name, setName] = useState(formatNameInput(initialContact));
  const [email, setEmail] = useState(initialContact?.email ?? "");
  const [phone, setPhone] = useState(initialContact?.phone ?? "");
  const [organizationId, setOrganizationId] = useState(initialContact?.organizationId ?? "");
  const [ownerId, setOwnerId] = useState(initialContact?.ownerId ?? defaultCreateOwnerId);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedName = parseName(name);
    if (!parsedName) {
      setError("Add a contact name before saving.");
      return;
    }

    setIsSaving(true);
    const payload = {
      firstName: parsedName.firstName,
      lastName: parsedName.lastName,
      email: email.trim() || null,
      phone: phone.trim() || null,
      organizationId: organizationId || null,
      ownerId: ownerId || null
    };

    const endpoint =
      mode === "create"
        ? `/api/v1/workspaces/${workspaceId}/people`
        : `/api/v1/workspaces/${workspaceId}/people/${initialContact?.id}`;
    const method = mode === "create" ? "POST" : "PATCH";

    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not save the contact.");
      setIsSaving(false);
      return;
    }

    const contact = await response.json();
    router.push(`/contacts/${contact.id}`);
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
          <span>Email</span>
          <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>

        <label className="form-field">
          <span>Phone</span>
          <input onChange={(event) => setPhone(event.target.value)} value={phone} />
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
          {isSaving ? "Saving..." : mode === "create" ? "Create contact" : "Save changes"}
        </button>
        <button className="button-secondary" onClick={() => router.back()} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}

function formatNameInput(contact?: ContactFormInitial) {
  if (!contact) return "";
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function parseName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const [firstName, ...rest] = parts;
  return {
    firstName,
    lastName: rest.length > 0 ? rest.join(" ") : null
  };
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
