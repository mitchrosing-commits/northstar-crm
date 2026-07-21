"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { ActivityDueDateShortcuts } from "@/components/activity-due-date-shortcuts";
import { ActivityDueDateHint, ActivityManualFollowUpHint } from "@/components/activity-form-guidance";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSection } from "@/components/form-section";
import { OwnerAssignmentHint } from "@/components/owner-assignment-hint";

type ActivityType = "CALL" | "EMAIL" | "MEETING" | "TASK";

type EntityOption = {
  id: string;
  name: string;
};

type ActivityEditFormProps = {
  workspaceId: string;
  activity: {
    id: string;
    title: string;
    type: ActivityType;
    dueAt: Date | string | null;
    ownerId: string | null;
    description: string | null;
  };
  cancelLabel?: string;
  owners: EntityOption[];
  redirectTo: Route;
};

export function ActivityEditForm({
  workspaceId,
  activity,
  cancelLabel = "Back to activity",
  owners,
  redirectTo
}: ActivityEditFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(activity.title);
  const [type, setType] = useState<ActivityType>(activity.type);
  const [dueAt, setDueAt] = useState(toDateInput(activity.dueAt));
  const [ownerId, setOwnerId] = useState(activity.ownerId ?? "");
  const [description, setDescription] = useState(activity.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Add a title before saving this activity.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/activities/${activity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        type,
        dueAt: dueAt ? new Date(`${dueAt}T00:00:00.000Z`).toISOString() : null,
        ownerId: ownerId || null,
        description: description.trim() || null
      })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error?.message ?? "Could not update the activity.");
      setIsSaving(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
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
        </div>
      </FormSection>

      <FormActionBar
        cancelHref={redirectTo}
        cancelLabel={cancelLabel}
        disabledHint="Add an activity title before saving."
        isSaving={isSaving}
        submitDisabled={!title.trim()}
        submitLabel="Save activity"
      />
    </form>
  );
}

function toDateInput(value: Date | string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}
