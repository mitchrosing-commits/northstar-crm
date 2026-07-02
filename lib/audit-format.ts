type AuditActor = {
  name: string | null;
  email: string;
};

export type AuditDisplayEntry = {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: unknown;
  actor?: AuditActor | null;
};

type FormattedAuditEvent = {
  actorLabel: string;
  label: string;
  metadataLabel?: string;
  targetLabel?: string;
};

const actionLabels: Record<string, string> = {
  "activity.completed": "Completed activity",
  "activity.created": "Created activity",
  "activity.deleted": "Removed activity",
  "activity.updated": "Updated activity",
  "custom_field.created": "Created custom field",
  "custom_field_value.updated": "Updated custom fields",
  "deal.created": "Created deal",
  "deal.created_from_lead": "Created deal from lead",
  "deal.deleted": "Removed deal",
  "deal.imported": "Imported deal from CSV",
  "deal.lost": "Marked deal lost",
  "deal.reopened": "Reopened deal",
  "deal.stage_changed": "Moved deal stage",
  "deal.updated": "Updated deal",
  "deal.value_synced_from_quote": "Synced deal value from quote",
  "deal.won": "Marked deal won",
  "email_log.created": "Logged manual email",
  "email_template.created": "Created email template",
  "email_template.deactivated": "Deactivated email template",
  "email_template.reactivated": "Reactivated email template",
  "email_template.updated": "Updated email template",
  "lead.converted": "Converted lead",
  "lead.created": "Created lead",
  "lead.imported": "Imported lead from CSV",
  "lead.updated": "Updated lead",
  "note.created": "Added note",
  "note.deleted": "Removed note",
  "organization.created": "Created organization",
  "organization.deleted": "Removed organization",
  "organization.imported": "Imported organization from CSV",
  "organization.updated": "Updated organization",
  "person.created": "Created contact",
  "person.deleted": "Removed contact",
  "contact.imported": "Imported contact from CSV",
  "person.updated": "Updated contact",
  "pipeline.created": "Created pipeline",
  "pipeline.deleted": "Removed pipeline",
  "pipeline.updated": "Updated pipeline",
  "quote.accepted": "Accepted quote",
  "quote.adjustments_updated": "Updated quote adjustments",
  "quote.created": "Created quote",
  "quote.declined": "Declined quote",
  "quote.public_accepted": "Customer accepted public quote",
  "quote.public_link_created": "Created public quote link",
  "quote.public_link_revoked": "Revoked public quote link",
  "quote.sent": "Sent quote",
  "stage.created": "Created pipeline stage",
  "stage.deleted": "Removed pipeline stage",
  "stage.updated": "Updated pipeline stage",
  "workspace_invitation.accepted": "Accepted workspace invitation",
  "workspace_invitation.created": "Created workspace invitation",
  "workspace_invitation.revoked": "Revoked workspace invitation",
  "workspace.created": "Created workspace",
  "workspace_member.removed": "Removed workspace member",
  "workspace_member.ownership_transferred": "Transferred workspace ownership",
  "workspace_member.role_updated": "Updated workspace member role"
};

const entityLabels: Record<string, string> = {
  Activity: "Activity",
  CustomFieldDefinition: "Custom field",
  Deal: "Deal",
  EmailLog: "Email log",
  EmailTemplate: "Email template",
  Lead: "Lead",
  Note: "Note",
  Organization: "Organization",
  Person: "Contact",
  Pipeline: "Pipeline",
  PipelineStage: "Pipeline stage",
  Quote: "Quote",
  Workspace: "Workspace",
  WorkspaceInvitation: "Workspace invitation",
  WorkspaceMembership: "Workspace member"
};

export function formatAuditEvent(entry: AuditDisplayEntry): FormattedAuditEvent {
  return {
    actorLabel: entry.actor?.name ?? entry.actor?.email ?? "System",
    label: actionLabels[entry.action] ?? fallbackActionLabel(entry.action),
    metadataLabel: metadataSummary(entry.metadata),
    targetLabel: entry.entityType ? (entityLabels[entry.entityType] ?? humanizeAction(entry.entityType)) : undefined
  };
}

function metadataSummary(metadata: unknown) {
  if (!isMetadataRecord(metadata)) return undefined;

  if (typeof metadata.lostReason === "string" && metadata.lostReason.trim()) {
    return `Lost reason: ${metadata.lostReason.trim()}`;
  }

  if (
    typeof metadata.reattachedActivities === "number" ||
    typeof metadata.reattachedNotes === "number" ||
    typeof metadata.reattachedEmailLogs === "number"
  ) {
    const activityCount = typeof metadata.reattachedActivities === "number" ? metadata.reattachedActivities : 0;
    const noteCount = typeof metadata.reattachedNotes === "number" ? metadata.reattachedNotes : 0;
    const emailLogCount = typeof metadata.reattachedEmailLogs === "number" ? metadata.reattachedEmailLogs : undefined;
    if (emailLogCount !== undefined) {
      const activityText = `${activityCount} ${pluralize("activity", activityCount)}`;
      const noteText = `${noteCount} ${pluralize("note", noteCount)}`;
      const emailLogText = `${emailLogCount} ${pluralize("email log", emailLogCount)}`;
      return `Moved ${activityText}, ${noteText}, and ${emailLogText}`;
    }
    return `Moved ${activityCount} ${pluralize("activity", activityCount)} and ${noteCount} ${pluralize("note", noteCount)}`;
  }

  if (Array.isArray(metadata.fieldIds)) {
    const count = metadata.fieldIds.length;
    return `${count} custom ${count === 1 ? "field" : "fields"} updated`;
  }

  if (typeof metadata.previousStatus === "string" && typeof metadata.nextStatus === "string") {
    return `${metadata.previousStatus} to ${metadata.nextStatus}`;
  }

  if (typeof metadata.title === "string" && metadata.title.trim()) return metadata.title.trim();
  if (typeof metadata.name === "string" && metadata.name.trim()) return metadata.name.trim();
  if (typeof metadata.key === "string" && metadata.key.trim()) return `Key: ${metadata.key.trim()}`;
  if (typeof metadata.email === "string" && metadata.email.trim()) return metadata.email.trim();
  if (typeof metadata.leadSource === "string" && metadata.leadSource.trim()) return `Lead source: ${metadata.leadSource.trim()}`;

  return undefined;
}

function isMetadataRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeAction(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fallbackActionLabel(action: string) {
  const humanized = humanizeAction(action).trim();
  return humanized ? `Recorded ${humanized.toLowerCase()}` : "Recorded audit event";
}

function pluralize(label: string, count: number) {
  if (count !== 1 && label.endsWith("y")) return `${label.slice(0, -1)}ies`;
  return count === 1 ? label : `${label}s`;
}
