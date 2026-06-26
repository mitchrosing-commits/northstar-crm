"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

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

export function EmailTemplatesPanel({ templates, workspaceId }: EmailTemplatesPanelProps) {
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Email Templates</h2>
        <span className="badge">Manual logging</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 16 }}>
        Reusable text for manual email logs. Templates do not send email, sync inboxes, or add merge variables.
      </p>
      <EmailTemplateCreateForm workspaceId={workspaceId} />
      <div style={{ marginTop: 18 }}>
        {templates.length > 0 ? (
          <div className="quote-draft-list">
            {templates.map((template) => (
              <EmailTemplateEditForm key={template.id} template={template} workspaceId={workspaceId} />
            ))}
          </div>
        ) : (
          <p className="empty-copy">No email templates yet.</p>
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

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/email-templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, subject, body })
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not create this email template.");
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
      {error ? <div className="form-error">{error}</div> : null}
      <div className="form-grid">
        <label className="form-field">
          <span>Name</span>
          <input onChange={(event) => setName(event.target.value)} required value={name} />
        </label>
        <label className="form-field">
          <span>Subject</span>
          <input onChange={(event) => setSubject(event.target.value)} required value={subject} />
        </label>
      </div>
      <label className="form-field">
        <span>Body</span>
        <textarea onChange={(event) => setBody(event.target.value)} required rows={4} value={body} />
      </label>
      <div className="form-actions">
        <button className="button-primary" disabled={isSaving || !name.trim() || !subject.trim() || !body.trim()} type="submit">
          {isSaving ? "Creating..." : "Create template"}
        </button>
      </div>
    </form>
  );
}

function EmailTemplateEditForm({ template, workspaceId }: { template: EmailTemplate; workspaceId: string }) {
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

    const response = await fetch(`/api/v1/workspaces/${workspaceId}/email-templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, subject, body })
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not update this email template.");
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
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/email-templates/${template.id}/${action}`, {
      method: "POST"
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not update this email template status.");
      setIsSaving(false);
      return;
    }

    setNotice(template.active ? "Template deactivated." : "Template reactivated.");
    setIsSaving(false);
    router.refresh();
  }

  return (
    <article className="quote-draft-item">
      <div className="panel-title-row">
        <h3 className="compact-title">{template.name}</h3>
        <span className="badge">{template.active ? "Active" : "Inactive"}</span>
      </div>
      <form className="inline-form" onSubmit={saveTemplate}>
        {error ? <div className="form-error">{error}</div> : null}
        {notice ? <p className="empty-copy">{notice}</p> : null}
        <div className="form-grid">
          <label className="form-field">
            <span>Name</span>
            <input onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <label className="form-field">
            <span>Subject</span>
            <input onChange={(event) => setSubject(event.target.value)} required value={subject} />
          </label>
        </div>
        <label className="form-field">
          <span>Body</span>
          <textarea onChange={(event) => setBody(event.target.value)} required rows={4} value={body} />
        </label>
        <div className="filter-actions">
          <button className="button-primary button-compact" disabled={isSaving || !name.trim() || !subject.trim() || !body.trim()} type="submit">
            {isSaving ? "Saving..." : "Save"}
          </button>
          <button className="button-secondary button-compact" disabled={isSaving} onClick={toggleActive} type="button">
            {template.active ? "Deactivate" : "Reactivate"}
          </button>
        </div>
      </form>
    </article>
  );
}
