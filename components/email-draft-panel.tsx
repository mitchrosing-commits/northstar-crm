"use client";

import { useMemo, useState } from "react";

type EmailTemplateOption = {
  body: string;
  id: string;
  name: string;
  subject: string;
};

type EmailDraftPanelProps = {
  recipientEmail: string | null;
  subject: string;
  templates: EmailTemplateOption[];
};

const fallbackTemplates: EmailTemplateOption[] = [
  {
    body: "Hi,\n\nFollowing up on this. What is the best next step from your side?\n\nThanks,",
    id: "following-up",
    name: "Following up on this",
    subject: "Following up"
  },
  {
    body: "Hi,\n\nJust checking in to see whether this is still active on your side.\n\nThanks,",
    id: "checking-in",
    name: "Checking in",
    subject: "Checking in"
  },
  {
    body: "Hi,\n\nThanks for the conversation. A good next step would be to confirm timing, stakeholders, and any blockers.\n\nThanks,",
    id: "next-step",
    name: "Next step after our conversation",
    subject: "Next step"
  },
  {
    body: "Hi,\n\nFollowing up on the quote/proposal. Are there any changes we should make before moving forward?\n\nThanks,",
    id: "quote-follow-up",
    name: "Quote / proposal follow-up",
    subject: "Quote follow-up"
  },
  {
    body: "Hi,\n\nChecking in on the agreement path. Is there anything needed from our side for NDA, MSA, or SOW review?\n\nThanks,",
    id: "contract-follow-up",
    name: "Contract follow-up",
    subject: "Contract follow-up"
  }
];

export function EmailDraftPanel({ recipientEmail, subject, templates }: EmailDraftPanelProps) {
  const draftTemplates = useMemo(() => (templates.length > 0 ? templates : fallbackTemplates), [templates]);
  const initialTemplate = draftTemplates[0];
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplate.id);
  const [draftSubject, setDraftSubject] = useState(`Re: ${subject || initialTemplate.subject}`.slice(0, 160));
  const [draftBody, setDraftBody] = useState(initialTemplate.body);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");

  function applyTemplate(templateId: string) {
    const template = draftTemplates.find((item) => item.id === templateId) ?? draftTemplates[0];
    setSelectedTemplateId(template.id);
    setDraftSubject(`Re: ${subject || template.subject}`.slice(0, 160));
    setDraftBody(template.body);
    setCopyState("idle");
  }

  async function copyDraft() {
    if (!navigator.clipboard) {
      setCopyState("unavailable");
      return;
    }
    await navigator.clipboard.writeText(`To: ${recipientEmail ?? ""}\nSubject: ${draftSubject}\n\n${draftBody}`);
    setCopyState("copied");
  }

  const composeHref = recipientEmail
    ? `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(draftSubject)}&body=${encodeURIComponent(draftBody)}`
    : null;

  return (
    <details className="email-draft-panel">
      <summary>Draft follow-up</summary>
      <p className="form-hint">Draft only. Northstar does not send this email or request send scopes.</p>
      <label className="form-field">
        <span>Template</span>
        <select onChange={(event) => applyTemplate(event.target.value)} value={selectedTemplateId}>
          {draftTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>To</span>
        <input readOnly value={recipientEmail ?? "Choose or create a contact first"} />
      </label>
      <label className="form-field">
        <span>Subject</span>
        <input onChange={(event) => setDraftSubject(event.target.value)} value={draftSubject} />
      </label>
      <label className="form-field">
        <span>Body</span>
        <textarea onChange={(event) => setDraftBody(event.target.value)} rows={5} value={draftBody} />
      </label>
      <div className="filter-actions">
        <button className="button-secondary button-compact" onClick={copyDraft} type="button">
          {copyState === "copied" ? "Copied" : copyState === "unavailable" ? "Copy unavailable" : "Copy draft"}
        </button>
        {composeHref ? (
          <a className="button-secondary button-compact" href={composeHref}>
            Open compose
          </a>
        ) : null}
      </div>
    </details>
  );
}
