"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { FormPrefillNotice } from "@/components/form-prefill-notice";
import { OwnerAssignmentHint } from "@/components/owner-assignment-hint";
import { formatPersonName } from "@/lib/person-name";

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
  defaultEmail?: string;
  defaultName?: string;
  defaultOrganizationId?: string;
  prefillNotice?: string;
  returnTo?: {
    href: string;
    paramName: "personId";
  };
  initialContact?: ContactFormInitial;
  cancelHref: Route;
};

export function ContactForm({
  mode,
  workspaceId,
  organizations,
  owners,
  defaultOwnerId,
  defaultEmail,
  defaultName,
  defaultOrganizationId,
  prefillNotice,
  returnTo,
  initialContact,
  cancelHref
}: ContactFormProps) {
  const router = useRouter();
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [name, setName] = useState(formatNameInput(initialContact) || defaultName || "");
  const [email, setEmail] = useState(initialContact?.email ?? defaultEmail ?? "");
  const [phone, setPhone] = useState(initialContact?.phone ?? "");
  const [organizationId, setOrganizationId] = useState(initialContact?.organizationId ?? defaultOrganizationId ?? "");
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
    router.push((mode === "create" && returnTo ? appendReturnParam(returnTo.href, returnTo.paramName, contact.id) : `/contacts/${contact.id}`) as Route);
    router.refresh();
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {mode === "create" ? (
        <FormIntroCallout>
          Add the person first, then link them to deals, activities, notes, and an organization as the relationship develops.
        </FormIntroCallout>
      ) : null}
      {mode === "create" && prefillNotice ? (
        <FormPrefillNotice>{prefillNotice}</FormPrefillNotice>
      ) : null}
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <FormFieldLabel required>Name</FormFieldLabel>
          <input onChange={(event) => setName(event.target.value)} required value={name} />
        </label>

        <label className="form-field">
          <FormFieldLabel>Email</FormFieldLabel>
          <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>

        <label className="form-field">
          <FormFieldLabel>Phone</FormFieldLabel>
          <input onChange={(event) => setPhone(event.target.value)} value={phone} />
        </label>

        <label className="form-field">
          <FormFieldLabel>Organization</FormFieldLabel>
          <select onChange={(event) => setOrganizationId(event.target.value)} value={organizationId}>
            <option value="">{organizations.length === 0 ? "No organizations yet - save without one" : "None"}</option>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
          {organizations.length === 0 ? <small className="form-hint">You can create or import organizations later.</small> : null}
        </label>

        <label className="form-field">
          <FormFieldLabel>Assigned to</FormFieldLabel>
          <select onChange={(event) => setOwnerId(event.target.value)} value={ownerId}>
            <option value="">{owners.length === 0 ? "No workspace members available" : "Unassigned"}</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <OwnerAssignmentHint owners={owners} />
        </label>
      </div>

      <FormActionBar
        cancelHref={cancelHref}
        cancelLabel={mode === "create" ? "Back to contacts" : "Back to contact"}
        disabledHint="Add a contact name before saving."
        isSaving={isSaving}
        submitDisabled={!name.trim()}
        submitLabel={mode === "create" ? "Create contact" : "Save changes"}
      />
    </form>
  );
}

function formatNameInput(contact?: ContactFormInitial) {
  if (!contact) return "";
  return formatPersonName(contact) ?? "";
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

function appendReturnParam(returnTo: string, paramName: "personId", id: string) {
  const [path, query = ""] = returnTo.split("?");
  const params = new URLSearchParams(query);
  params.set(paramName, id);
  const nextQuery = params.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
}
