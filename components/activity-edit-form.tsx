"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

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
  owners: EntityOption[];
  redirectTo: Route;
};

export function ActivityEditForm({ workspaceId, activity, owners, redirectTo }: ActivityEditFormProps) {
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
      {error ? <div className="form-error">{error}</div> : null}
      <p className="form-hint">Manual follow-up only. Due dates help sort work; they do not send reminders.</p>
      <div className="form-grid">
        <label className="form-field form-field-wide">
          <span>Title</span>
          <input onChange={(event) => setTitle(event.target.value)} required value={title} />
        </label>

        <label className="form-field">
          <span>Type</span>
          <select onChange={(event) => setType(event.target.value as ActivityType)} value={type}>
            <option value="TASK">Task</option>
            <option value="CALL">Call</option>
            <option value="EMAIL">Email</option>
            <option value="MEETING">Meeting</option>
          </select>
        </label>

        <label className="form-field">
          <span>Due date</span>
          <input onChange={(event) => setDueAt(event.target.value)} type="date" value={dueAt} />
          <small className="form-hint">Used for work-queue order, not calendar reminders.</small>
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

        <label className="form-field form-field-wide">
          <span>Description</span>
          <textarea onChange={(event) => setDescription(event.target.value)} rows={3} value={description} />
        </label>
      </div>

      <div className="form-actions">
        <button className="button-primary" disabled={isSaving || !title.trim()} type="submit">
          {isSaving ? "Saving..." : "Save activity"}
        </button>
      </div>
    </form>
  );
}

function toDateInput(value: Date | string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
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
