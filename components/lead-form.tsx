"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { FormPrefillNotice } from "@/components/form-prefill-notice";
import { FormRelatedRecordCallout } from "@/components/form-related-record-callout";
import { FormSection } from "@/components/form-section";
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
  defaultOrganizationId?: string;
  defaultPersonId?: string;
  defaultSource?: string;
  defaultStatus?: LeadStatus;
  defaultTitle?: string;
  prefillNotice?: string;
  returnTo?: {
    href: string;
    paramName: "leadId";
  };
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
  defaultOrganizationId,
  defaultPersonId,
  defaultSource,
  defaultStatus,
  defaultTitle,
  prefillNotice,
  returnTo,
  initialLead,
  cancelHref
}: LeadFormProps) {
  const router = useRouter();
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [title, setTitle] = useState(initialLead?.title ?? defaultTitle ?? "");
  const [source, setSource] = useState(initialLead?.source ?? defaultSource ?? "");
  const [status, setStatus] = useState<LeadStatus>(initialLead?.status ?? defaultStatus ?? "NEW");
  const [ownerId, setOwnerId] = useState(initialLead?.ownerId ?? defaultCreateOwnerId);
  const [personId, setPersonId] = useState(initialLead?.personId ?? defaultPersonId ?? "");
  const [organizationId, setOrganizationId] = useState(initialLead?.organizationId ?? defaultOrganizationId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const leadReturnTo = buildLeadReturnTo({
    initialLeadId: initialLead?.id,
    mode,
    organizationId,
    ownerId,
    personId,
    source,
    status,
    title
  });
  const createContactHref = relatedRecordCreateHref("/contacts/new", {
    organizationId,
    returnTo: leadReturnTo
  });
  const createOrganizationHref = relatedRecordCreateHref("/organizations/new", {
    name: title,
    returnTo: leadReturnTo
  });

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
    router.push((mode === "create" && returnTo ? appendReturnParam(returnTo.href, returnTo.paramName, lead.id) : `/leads/${lead.id}`) as Route);
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
      {prefillNotice ? (
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
      <FormSection
        description="Capture the early opportunity name, source, status, and owner before qualification."
        title="Lead details"
      >
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
        </div>
      </FormSection>

      <FormSection
        description="Link a known buyer or company, or create one and return with this lead draft preserved."
        title="Related records"
      >
        <div className="form-grid">
          <div className="form-field">
            <label>
              <FormFieldLabel>Person</FormFieldLabel>
              <select onChange={(event) => setPersonId(event.target.value)} value={personId}>
                <option value="">{people.length === 0 ? "No contacts yet - save lead without contact" : "None"}</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-related-record-actions">
              <Link className="inline-link" href={createContactHref}>
                Create contact
              </Link>
              <small className="form-hint">Create a contact, then return here with it selected for this lead.</small>
            </div>
            {people.length === 0 ? <small className="form-hint">Add a contact later when the lead is clearer.</small> : null}
          </div>

          <div className="form-field">
            <label>
              <FormFieldLabel>Organization</FormFieldLabel>
              <select onChange={(event) => setOrganizationId(event.target.value)} value={organizationId}>
                <option value="">{organizations.length === 0 ? "No organizations yet - save lead without one" : "None"}</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-related-record-actions">
              <Link className="inline-link" href={createOrganizationHref}>
                Create organization
              </Link>
              <small className="form-hint">Create a company, then return here with it selected for this lead.</small>
            </div>
            {organizations.length === 0 ? <small className="form-hint">Add the company later or create it before saving.</small> : null}
          </div>
        </div>
      </FormSection>

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

function buildLeadReturnTo({
  initialLeadId,
  mode,
  organizationId,
  ownerId,
  personId,
  source,
  status,
  title
}: {
  initialLeadId?: string;
  mode: "create" | "edit";
  organizationId: string;
  ownerId: string;
  personId: string;
  source: string;
  status: LeadStatus;
  title: string;
}) {
  if (mode === "edit" && initialLeadId) return `/leads/${initialLeadId}/edit`;

  const params = new URLSearchParams();
  const trimmedTitle = title.trim();
  const trimmedSource = source.trim();
  if (trimmedTitle) params.set("title", trimmedTitle);
  if (trimmedSource) params.set("source", trimmedSource);
  if (status !== "NEW") params.set("status", status);
  if (ownerId) params.set("ownerId", ownerId);
  if (personId) params.set("personId", personId);
  if (organizationId) params.set("organizationId", organizationId);
  const query = params.toString();
  return query ? `/leads/new?${query}` : "/leads/new";
}

function relatedRecordCreateHref(path: "/contacts/new" | "/organizations/new", params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) query.set(key, trimmed);
  }
  const queryText = query.toString();
  return `${path}${queryText ? `?${queryText}` : ""}` as Route;
}

function appendReturnParam(returnTo: string, paramName: "leadId", id: string) {
  const [path, query = ""] = returnTo.split("?");
  const params = new URLSearchParams(query);
  params.set(paramName, id);
  const nextQuery = params.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
}
