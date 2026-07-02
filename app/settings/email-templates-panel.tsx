"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { ActionGroup } from "@/components/action-group";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { EmptyState } from "@/components/empty-state";
import { FormActionBar } from "@/components/form-action-bar";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { PanelTitleRow } from "@/components/panel-title-row";

type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  active: boolean;
};

type EmailTemplatesPanelProps = {
  templates: EmailTemplate[];
  workspaceId: string;
};

export function EmailTemplatesPanel({
  templates,
  workspaceId,
}: EmailTemplatesPanelProps) {
  return (
    <section className="panel section-separated">
      <PanelTitleRow
        actions={<Badge>Manual logging</Badge>}
        title="Email Templates"
      />
      <p className="empty-copy section-separated">
        Reusable text for manual email logs. Templates do not send email, sync
        inboxes, or add merge variables.
      </p>
      <EmailTemplateCreateForm workspaceId={workspaceId} />
      <div className="section-spaced">
        {templates.length > 0 ? (
          <div className="quote-draft-list">
            {templates.map((template) => (
              <EmailTemplateEditForm
                key={template.id}
                template={template}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            className="empty-state-compact empty-state-panel email-template-empty"
            title="No email templates yet"
            description="Create a template above to reuse subject and body text when logging manual email activity."
          />
        )}
      </div>
    </section>
  );
}

function EmailTemplateCreateForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/email-templates`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, body }),
      },
    );

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(
        responseBody?.error?.message ?? "Could not create this email template.",
      );
      setIsSaving(false);
      return;
    }

    setName("");
    setSubject("");
    setBody("");
    setIsSaving(false);
    router.refresh();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit}>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <div className="form-grid">
        <label className="form-field">
          <FormFieldLabel required>Name</FormFieldLabel>
          <input
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="form-field">
          <FormFieldLabel required>Subject</FormFieldLabel>
          <input
            onChange={(event) => setSubject(event.target.value)}
            required
            value={subject}
          />
        </label>
      </div>
      <label className="form-field">
        <FormFieldLabel required>Body</FormFieldLabel>
        <textarea
          onChange={(event) => setBody(event.target.value)}
          required
          rows={4}
          value={body}
        />
      </label>
      <FormActionBar
        isSaving={isSaving}
        pendingLabel="Creating..."
        submitDisabled={!name.trim() || !subject.trim() || !body.trim()}
        submitLabel="Create template"
      />
    </form>
  );
}

function EmailTemplateEditForm({
  template,
  workspaceId,
}: {
  template: EmailTemplate;
  workspaceId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setIsSaving(true);

    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/email-templates/${template.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, subject, body }),
      },
    );

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(
        responseBody?.error?.message ?? "Could not update this email template.",
      );
      setIsSaving(false);
      return;
    }

    setNotice("Template saved.");
    setIsSaving(false);
    router.refresh();
  }

  async function toggleActive() {
    setError(null);
    setNotice(null);
    setIsSaving(true);

    const action = template.active ? "deactivate" : "activate";
    const response = await fetch(
      `/api/v1/workspaces/${workspaceId}/email-templates/${template.id}/${action}`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(
        responseBody?.error?.message ??
          "Could not update this email template status.",
      );
      setIsSaving(false);
      return;
    }

    setNotice(
      template.active ? "Template deactivated." : "Template reactivated.",
    );
    setIsSaving(false);
    router.refresh();
  }

  const templateActionsLabel = `${template.name} template actions`;

  return (
    <article className="quote-draft-item">
      <CompactTitleRow
        actions={<Badge>{template.active ? "Active" : "Inactive"}</Badge>}
        title={template.name}
      />
      <form className="inline-form" onSubmit={saveTemplate}>
        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
        {notice ? (
          <FormIntroCallout
            className="email-template-status-callout"
            title="Template status"
          >
            {notice}
          </FormIntroCallout>
        ) : null}
        <div className="form-grid">
          <label className="form-field">
            <FormFieldLabel required>Name</FormFieldLabel>
            <input
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label className="form-field">
            <FormFieldLabel required>Subject</FormFieldLabel>
            <input
              onChange={(event) => setSubject(event.target.value)}
              required
              value={subject}
            />
          </label>
        </div>
        <label className="form-field">
          <FormFieldLabel required>Body</FormFieldLabel>
          <textarea
            onChange={(event) => setBody(event.target.value)}
            required
            rows={4}
            value={body}
          />
        </label>
        <ActionGroup className="filter-actions" label={templateActionsLabel}>
          <button
            className="button-primary button-compact"
            disabled={
              isSaving || !name.trim() || !subject.trim() || !body.trim()
            }
            type="submit"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button
            className="button-secondary button-compact"
            disabled={isSaving}
            onClick={toggleActive}
            type="button"
          >
            {template.active ? "Deactivate" : "Reactivate"}
          </button>
        </ActionGroup>
      </form>
    </article>
  );
}
