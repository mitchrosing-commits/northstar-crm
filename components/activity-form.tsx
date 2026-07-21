"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { ActivityDueDateShortcuts } from "@/components/activity-due-date-shortcuts";
import { ActivityDueDateHint, ActivityManualFollowUpHint } from "@/components/activity-form-guidance";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSection } from "@/components/form-section";
import { FormSuccessMessage } from "@/components/form-success-message";
import { OwnerAssignmentHint } from "@/components/owner-assignment-hint";

type ActivityType = "CALL" | "EMAIL" | "MEETING" | "TASK";

type EntityOption = {
  id: string;
  name: string;
};

type ActivityAttachment =
  | { dealId: string }
  | { leadId: string }
  | { personId: string }
  | { organizationId: string };

type ActivityAttachmentOption = {
  label: string;
  value: string;
};

type ActivityFormProps = {
  workspaceId: string;
  attachment?: ActivityAttachment;
  attachmentOptions?: ActivityAttachmentOption[];
  owners: EntityOption[];
  redirectTo?: Route;
  cancelHref?: Route;
  cancelLabel?: string;
  defaultOwnerId?: string;
  initialOwnerId?: string;
  initialAttachmentValue?: string;
  initialDescription?: string;
  initialDueAt?: string;
  initialTitle?: string;
  initialType?: ActivityType;
  submitLabel?: string;
};

export function ActivityForm({
  workspaceId,
  attachment,
  attachmentOptions = [],
  owners,
  redirectTo,
  cancelHref,
  cancelLabel,
  defaultOwnerId = "",
  initialOwnerId,
  initialAttachmentValue = "",
  initialDescription = "",
  initialDueAt = "",
  initialTitle = "",
  initialType = "TASK",
  submitLabel = "Add activity"
}: ActivityFormProps) {
  const router = useRouter();
  const resolvedDefaultOwnerId = owners.some((owner) => owner.id === defaultOwnerId)
    ? defaultOwnerId
    : owners.length === 1
      ? owners[0]?.id ?? ""
      : "";
  const resolvedInitialOwnerId = owners.some((owner) => owner.id === initialOwnerId)
    ? initialOwnerId ?? ""
    : resolvedDefaultOwnerId;
  const resolvedInitialAttachmentValue = attachmentOptions.some((option) => option.value === initialAttachmentValue)
    ? initialAttachmentValue
    : attachmentOptions[0]?.value ?? "";
  const [title, setTitle] = useState(initialTitle);
  const [type, setType] = useState<ActivityType>(initialType);
  const [dueAt, setDueAt] = useState(initialDueAt);
  const [ownerId, setOwnerId] = useState(resolvedInitialOwnerId);
  const [description, setDescription] = useState(initialDescription);
  const [completed, setCompleted] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState(resolvedInitialAttachmentValue);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!title.trim()) {
      setError("Add a title before saving this activity.");
      return;
    }
    const resolvedAttachment = attachment ?? parseAttachmentValue(selectedAttachment);
    if (!resolvedAttachment) {
      setError("Choose the record this activity belongs to.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        type,
        dueAt: dueAt ? new Date(`${dueAt}T00:00:00.000Z`).toISOString() : null,
        ownerId: ownerId || null,
        description: description.trim() || null,
        ...resolvedAttachment,
        completedAt: completed ? new Date().toISOString() : null
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not add the activity.");
      setIsSaving(false);
      return;
    }

    setTitle("");
    setType("TASK");
    setDueAt("");
    setOwnerId(resolvedDefaultOwnerId);
    setDescription("");
    setCompleted(false);
    if (!attachment) setSelectedAttachment(attachmentOptions[0]?.value ?? "");
    setIsSaving(false);
    if (redirectTo) {
      router.push(redirectTo);
    } else if (attachment) {
      setSuccess(completed ? "Activity saved as complete. Recent activities refreshed." : "Activity added. Recent activities refreshed.");
      router.replace(currentPathWithHash("activities"), { scroll: true });
    }
    router.refresh();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {success ? <FormSuccessMessage compact>{success}</FormSuccessMessage> : null}
      <FormSection description={<ActivityManualFollowUpHint />} title="Activity details">
        <div className="form-grid">
          <label className="form-field form-field-wide">
            <FormFieldLabel required>Title</FormFieldLabel>
            <input onChange={(event) => setTitle(event.target.value)} required value={title} />
          </label>

          <label className="form-field">
            <FormFieldLabel>Type</FormFieldLabel>
            <select onChange={(event) => setType(event.target.value as ActivityType)} value={type}>
              <option value="TASK">Task</option>
              <option value="CALL">Call</option>
              <option value="EMAIL">Email</option>
              <option value="MEETING">Meeting</option>
            </select>
          </label>

          <label className="form-field">
            <FormFieldLabel>Due date</FormFieldLabel>
            <input onChange={(event) => setDueAt(event.target.value)} type="date" value={dueAt} />
            <ActivityDueDateShortcuts onSelect={setDueAt} />
            <ActivityDueDateHint />
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

          <label className="form-field form-field-wide">
            <FormFieldLabel>Description</FormFieldLabel>
            <textarea onChange={(event) => setDescription(event.target.value)} rows={3} value={description} />
          </label>

          <label className="form-field checkbox-field">
            <input checked={completed} onChange={(event) => setCompleted(event.target.checked)} type="checkbox" />
            <span>Mark complete now</span>
          </label>
        </div>
      </FormSection>

      {!attachment ? (
        <FormSection
          description="Choose where this activity should appear. If the record does not exist yet, create it and return with this draft preserved."
          title="Related record"
        >
          <label className="form-field">
            <FormFieldLabel required>Related record</FormFieldLabel>
            <select
              onChange={(event) => setSelectedAttachment(event.target.value)}
              required
              value={selectedAttachment}
            >
              {attachmentOptions.length > 0 ? null : <option value="">No available records</option>}
              {attachmentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="form-hint">Attach this follow-up to an existing deal, contact, organization, or lead.</small>
            <ActivityRelatedRecordCreateLinks
              description={description}
              dueAt={dueAt}
              ownerId={ownerId}
              title={title}
              type={type}
            />
          </label>
        </FormSection>
      ) : null}

      <FormActionBar
        cancelHref={cancelHref}
        cancelLabel={cancelLabel}
        disabledHint={
          attachment
            ? "Add an activity title before saving."
            : "Add an activity title and choose a related record before saving."
        }
        isSaving={isSaving}
        pendingLabel="Adding..."
        submitDisabled={!title.trim() || (!attachment && !selectedAttachment)}
        submitLabel={submitLabel}
      />
    </form>
  );
}

function parseAttachmentValue(value: string): ActivityAttachment | null {
  const [type, id] = value.split(":");
  if (!id) return null;
  if (type === "deal") return { dealId: id };
  if (type === "lead") return { leadId: id };
  if (type === "person") return { personId: id };
  if (type === "organization") return { organizationId: id };
  return null;
}

function currentPathWithHash(hash: string) {
  return `${window.location.pathname}${window.location.search}#${hash}` as Route;
}

function ActivityRelatedRecordCreateLinks({
  description,
  dueAt,
  ownerId,
  title,
  type
}: {
  description: string;
  dueAt: string;
  ownerId: string;
  title: string;
  type: ActivityType;
}) {
  const activityReturnTo = buildActivityDraftReturnTo({ description, dueAt, ownerId, title, type });
  const createContactHref = relatedRecordCreateHref("/contacts/new", {
    name: title,
    returnTo: activityReturnTo
  });
  const createOrganizationHref = relatedRecordCreateHref("/organizations/new", {
    name: title,
    returnTo: activityReturnTo
  });
  const createDealHref = relatedRecordCreateHref("/deals/new", {
    returnTo: activityReturnTo,
    title
  });
  const createLeadHref = relatedRecordCreateHref("/leads/new", {
    returnTo: activityReturnTo,
    title
  });

  return (
    <div className="form-related-record-actions activity-related-create-actions">
      <span>Create and return:</span>
      <Link className="inline-link" href={createContactHref}>
        Contact
      </Link>
      <Link className="inline-link" href={createOrganizationHref}>
        Organization
      </Link>
      <Link className="inline-link" href={createDealHref}>
        Deal
      </Link>
      <Link className="inline-link" href={createLeadHref}>
        Lead
      </Link>
      <small className="form-hint">Your current activity draft stays in the return link.</small>
    </div>
  );
}

function buildActivityDraftReturnTo({
  description,
  dueAt,
  ownerId,
  title,
  type
}: {
  description: string;
  dueAt: string;
  ownerId: string;
  title: string;
  type: ActivityType;
}) {
  const params = new URLSearchParams();
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  if (trimmedTitle) params.set("title", trimmedTitle);
  if (trimmedDescription) params.set("description", trimmedDescription);
  if (dueAt) params.set("due", dueAt);
  if (ownerId) params.set("ownerId", ownerId);
  if (type !== "TASK") params.set("type", type);
  const query = params.toString();
  return query ? `/activities/new?${query}` : "/activities/new";
}

function relatedRecordCreateHref(
  path: "/contacts/new" | "/deals/new" | "/leads/new" | "/organizations/new",
  params: Record<string, string | undefined>
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = value?.trim();
    if (trimmed) query.set(key, trimmed);
  }
  const queryText = query.toString();
  return `${path}${queryText ? `?${queryText}` : ""}` as Route;
}
