"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { FormPrefillNotice } from "@/components/form-prefill-notice";
import { FormRelatedRecordCallout } from "@/components/form-related-record-callout";
import { OwnerAssignmentHint } from "@/components/owner-assignment-hint";

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
  defaultSource?: string;
  defaultTitle?: string;
  prefillNotice?: string;
  initialLead?: LeadFormInitial;
  cancelHref: Route;
};

export function LeadForm({
  mode,
  workspaceId,
  people,
  organizations,
  owners,
  defaultOwnerId,
  defaultSource,
  defaultTitle,
  prefillNotice,
  initialLead,
  cancelHref
}: LeadFormProps) {
  const router = useRouter();
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [title, setTitle] = useState(initialLead?.title ?? defaultTitle ?? "");
  const [source, setSource] = useState(initialLead?.source ?? defaultSource ?? "");
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
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {mode === "create" ? (
        <FormIntroCallout>
          Capture a possible opportunity before it is qualified. Link a contact or organization now, or add those
          records later when you know more.
        </FormIntroCallout>
      ) : null}
      {mode === "create" && prefillNotice ? (
        <FormPrefillNotice>{prefillNotice}</FormPrefillNotice>
      ) : null}
      {mode === "create" && (people.length === 0 || organizations.length === 0) ? (
        <FormRelatedRecordCallout
          showContactAction={people.length === 0}
          showOrganizationAction={organizations.length === 0}
          title="Need a related record?"
        >
          Leads can start without a contact or organization. Add one first if you already know the buyer or company.
        </FormRelatedRecordCallout>
      ) : null}
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <FormFieldLabel required>Title</FormFieldLabel>
          <input onChange={(event) => setTitle(event.target.value)} required value={title} />
        </label>

        <label className="form-field">
          <FormFieldLabel>Source</FormFieldLabel>
          <input onChange={(event) => setSource(event.target.value)} value={source} />
        </label>

        <label className="form-field">
          <FormFieldLabel>Status</FormFieldLabel>
          <select onChange={(event) => setStatus(event.target.value as LeadStatus)} value={status}>
            <option value="NEW">New</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="DISQUALIFIED">Disqualified</option>
          </select>
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

        <label className="form-field">
          <FormFieldLabel>Person</FormFieldLabel>
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
          <FormFieldLabel>Organization</FormFieldLabel>
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

      <FormActionBar
        cancelHref={cancelHref}
        cancelLabel={mode === "create" ? "Back to leads" : "Back to lead"}
        disabledHint="Add a lead title before saving."
        isSaving={isSaving}
        submitDisabled={!title.trim()}
        submitLabel={mode === "create" ? "Create lead" : "Save changes"}
      />
    </form>
  );
}
