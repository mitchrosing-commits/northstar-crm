"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { FormPrefillNotice } from "@/components/form-prefill-notice";
import { FormSection } from "@/components/form-section";
import { OwnerAssignmentHint } from "@/components/owner-assignment-hint";

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
  defaultName?: string;
  defaultOwnerId?: string;
  prefillNotice?: string;
  returnTo?: {
    href: string;
    paramName: "organizationId";
  };
  initialOrganization?: OrganizationFormInitial;
  cancelHref: Route;
};

export function OrganizationForm({
  mode,
  workspaceId,
  owners,
  defaultName,
  defaultOwnerId,
  prefillNotice,
  returnTo,
  initialOrganization,
  cancelHref
}: OrganizationFormProps) {
  const router = useRouter();
  const defaultCreateOwnerId =
    mode === "create" ? defaultOwnerId || (owners.length === 1 ? owners[0]?.id ?? "" : "") : "";
  const [name, setName] = useState(initialOrganization?.name ?? defaultName ?? "");
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
    router.push((
      mode === "create" && returnTo
        ? appendReturnParam(returnTo.href, returnTo.paramName, organization.id)
        : `/organizations/${organization.id}`
    ) as Route);
    router.refresh();
  }

  return (
    <form className="form-card" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {mode === "create" ? (
        <FormIntroCallout>
          Create the account or company record first, then attach people, deals, activities, and notes to it.
        </FormIntroCallout>
      ) : null}
      {mode === "create" && prefillNotice ? (
        <FormPrefillNotice>{prefillNotice}</FormPrefillNotice>
      ) : null}
      <FormSection
        description="Use the company name as the primary record label, then add web and ownership context if available."
        title="Organization details"
      >
        <div className="form-grid">
          <label className="form-field form-field-wide">
            <FormFieldLabel required>Name</FormFieldLabel>
            <input onChange={(event) => setName(event.target.value)} required value={name} />
          </label>

          <label className="form-field">
            <FormFieldLabel>Domain</FormFieldLabel>
            <input onChange={(event) => setDomain(event.target.value)} placeholder="example.com" value={domain} />
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

      <FormActionBar
        cancelHref={cancelHref}
        cancelLabel={mode === "create" ? "Back to organizations" : "Back to organization"}
        disabledHint="Add an organization name before saving."
        isSaving={isSaving}
        submitDisabled={!name.trim()}
        submitLabel={mode === "create" ? "Create organization" : "Save changes"}
      />
    </form>
  );
}

function appendReturnParam(returnTo: string, paramName: "organizationId", id: string) {
  const [path, query = ""] = returnTo.split("?");
  const params = new URLSearchParams(query);
  params.set(paramName, id);
  const nextQuery = params.toString();
  return `${path}${nextQuery ? `?${nextQuery}` : ""}`;
}
