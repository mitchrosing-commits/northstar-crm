"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type EmailLogAttachment =
  | { dealId: string }
  | { leadId: string }
  | { personId: string }
  | { organizationId: string };

type EmailTemplateOption = {
  active?: boolean;
  id: string;
  name: string;
  subject: string;
  body: string;
};

type ManualEmailLogPanelProps = {
  attachment: EmailLogAttachment;
  lockedMessage?: string;
  showForm?: boolean;
  templates: EmailTemplateOption[];
  workspaceId: string;
};

export function ManualEmailLogPanel({
  attachment,
  lockedMessage,
  showForm = true,
  templates,
  workspaceId
}: ManualEmailLogPanelProps) {
  const router = useRouter();
  const [direction, setDirection] = useState<"INBOUND" | "OUTBOUND">("OUTBOUND");
  const [occurredAt, setOccurredAt] = useState(defaultDateTimeLocal());
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [ccText, setCcText] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const activeTemplates = templates.filter((template) => template.active !== false);

  function applyTemplate(templateId: string) {
    const template = activeTemplates.find((item) => item.id === templateId);
    if (!template) return;
    setSubject(template.subject);
    setBody(template.body);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!subject.trim() || !body.trim() || !occurredAt) {
      setError("Add subject, body, and email date before saving.");
      return;
    }

    setIsSaving(true);
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/email-logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...attachment,
        direction,
        occurredAt: new Date(occurredAt).toISOString(),
        fromText: fromText.trim() || null,
        toText: toText.trim() || null,
        ccText: ccText.trim() || null,
        subject: subject.trim(),
        body: body.trim()
      })
    });

    if (!response.ok) {
      const responseBody = await response.json().catch(() => null);
      setError(responseBody?.error?.message ?? "Could not log this email.");
      setIsSaving(false);
      return;
    }

    setSubject("");
    setBody("");
    setCcText("");
    setIsSaving(false);
    router.refresh();
  }

  return (
    <section className="data-card" style={{ marginTop: 14 }}>
      <div className="panel-title-row">
        <h2 className="panel-title">Log Manual Email</h2>
        <span className="badge">Manual</span>
      </div>
      <p className="empty-copy" style={{ marginBottom: 14 }}>
        Save a plain-text record of an email that was already sent or received. This does not send email, sync an
        inbox, or create background jobs. Use <Link className="inline-link" href={"/email" as Route}>Email</Link> to
        connect Gmail or sync recent matched messages from known contacts.
      </p>
      {showForm ? (
        <form className="inline-form" onSubmit={onSubmit}>
          {error ? <div className="form-error">{error}</div> : null}
          {activeTemplates.length > 0 ? (
            <label className="form-field">
              <span>Template</span>
              <select defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
                <option value="">No template</option>
                {activeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <small className="form-hint">Templates fill only the subject and body.</small>
            </label>
          ) : null}
          <div className="form-grid">
            <label className="form-field">
              <span>Direction</span>
              <select onChange={(event) => setDirection(event.target.value as "INBOUND" | "OUTBOUND")} value={direction}>
                <option value="OUTBOUND">Outbound - already sent</option>
                <option value="INBOUND">Inbound - received</option>
              </select>
            </label>
            <label className="form-field">
              <span>Email date</span>
              <input onChange={(event) => setOccurredAt(event.target.value)} required type="datetime-local" value={occurredAt} />
            </label>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>From</span>
              <input onChange={(event) => setFromText(event.target.value)} value={fromText} />
            </label>
            <label className="form-field">
              <span>To</span>
              <input onChange={(event) => setToText(event.target.value)} value={toText} />
            </label>
          </div>
          <label className="form-field">
            <span>Cc</span>
            <input onChange={(event) => setCcText(event.target.value)} value={ccText} />
          </label>
          <label className="form-field">
            <span>Subject</span>
            <input onChange={(event) => setSubject(event.target.value)} required value={subject} />
          </label>
          <label className="form-field">
            <span>Body</span>
            <textarea onChange={(event) => setBody(event.target.value)} required rows={5} value={body} />
          </label>
          <div className="form-actions">
            <button className="button-primary" disabled={isSaving || !subject.trim() || !body.trim()} type="submit">
              {isSaving ? "Saving log..." : "Save email log"}
            </button>
          </div>
        </form>
      ) : (
        <p className="empty-copy">{lockedMessage ?? "Email logging is locked for this record."}</p>
      )}
    </section>
  );
}

function defaultDateTimeLocal() {
  return new Date().toISOString().slice(0, 16);
}
