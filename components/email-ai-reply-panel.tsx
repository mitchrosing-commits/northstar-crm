"use client";

import { useActionState, useEffect, useState } from "react";

import { generateEmailReplyDraftAction, type GenerateEmailReplyDraftActionState } from "@/app/email/actions";
import { ActionGroup } from "@/components/action-group";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import type { EmailReplyAssistantReadiness } from "@/lib/services/email-reply-assistant-service";

type EmailAiReplyPanelProps = {
  defaultTone?: string;
  emailLogId: string;
  readiness: EmailReplyAssistantReadiness;
  recipientEmail: string | null;
  subject: string;
};

const initialState: GenerateEmailReplyDraftActionState = {};
const aiReplyDisclosureLabel = "Draft reply with AI";
const aiReplyActionsLabel = "AI email reply actions";

export function EmailAiReplyPanel({ defaultTone = "concise", emailLogId, readiness, recipientEmail, subject }: EmailAiReplyPanelProps) {
  const [state, formAction, isPending] = useActionState(generateEmailReplyDraftAction, initialState);
  const [draftSubject, setDraftSubject] = useState(`Re: ${subject}`.slice(0, 160));
  const [draftBody, setDraftBody] = useState("");
  const [instructions, setInstructions] = useState("");
  const [replyPanelOpen, setReplyPanelOpen] = useState(false);
  const [clientSubmitting, setClientSubmitting] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const [draftHidden, setDraftHidden] = useState(false);

  useEffect(() => {
    if (state.subjectSuggestion) setDraftSubject(state.subjectSuggestion);
    if (state.replyBody) setDraftBody(state.replyBody);
    if (state.instructions !== undefined) setInstructions(state.instructions);
    if (state.replyBody || state.subjectSuggestion) setCopyState("idle");
    if (state.replyBody) setDraftHidden(false);
    if (state.error || state.message || state.retryable || state.replyBody) setReplyPanelOpen(true);
    setClientSubmitting(false);
  }, [state]);

  async function copyDraft() {
    if (!navigator.clipboard) {
      setCopyState("unavailable");
      return;
    }
    await navigator.clipboard.writeText(`To: ${recipientEmail ?? ""}\nSubject: ${draftSubject}\n\n${draftBody}`);
    setCopyState("copied");
  }

  const composeHref =
    recipientEmail && draftBody
      ? `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(draftSubject)}&body=${encodeURIComponent(draftBody)}`
      : null;
  const generated = Boolean(state.replyBody) && !draftHidden;
  const primaryActionLabel = isPending || clientSubmitting ? "Generating..." : state.retryable ? "Retry reply" : generated ? "Regenerate reply" : "Generate reply";

  function applyInstruction(value: string) {
    setInstructions((current) => {
      const next = current ? `${current}; ${value}` : value;
      return next.slice(0, 500);
    });
  }

  function resetDraft() {
    setDraftSubject(`Re: ${subject}`.slice(0, 160));
    setDraftBody("");
    setInstructions("");
    setCopyState("idle");
    setDraftHidden(true);
  }

  return (
    <details
      aria-label={aiReplyDisclosureLabel}
      className="email-draft-panel email-ai-reply-panel"
      onToggle={(event) => setReplyPanelOpen(event.currentTarget.open)}
      open={replyPanelOpen}
      title={aiReplyDisclosureLabel}
    >
      <summary title={aiReplyDisclosureLabel}>Draft with AI</summary>
      <p className="form-hint">
        Review-first only. Northstar drafts text for you to edit, copy, or open in your mail client; it never sends AI replies automatically.
      </p>
      {!readiness.configured ? (
        <p className="form-hint">{readiness.message}</p>
      ) : (
        <form
          action={formAction}
          className="email-ai-reply-form"
          onSubmit={(event) => {
            if (clientSubmitting || isPending) {
              event.preventDefault();
              return;
            }
            setClientSubmitting(true);
          }}
        >
          <input name="emailLogId" type="hidden" value={emailLogId} />
          <label className="form-field">
            <FormFieldLabel>Refinement instructions</FormFieldLabel>
            <textarea
              disabled={isPending || clientSubmitting}
              name="instructions"
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="Optional: make it shorter, friendlier, more direct, mention pricing, or ask for availability."
              rows={3}
              value={instructions}
            />
          </label>
          <ActionGroup className="email-ai-reply-suggestions" label="AI reply refinement suggestions">
            {[
              "Make it shorter",
              "Make it friendlier",
              "Make it more direct",
              "Mention pricing carefully",
              "Ask for availability"
            ].map((suggestion) => (
              <button
                className="button-secondary button-compact"
                disabled={isPending || clientSubmitting}
                key={suggestion}
                onClick={() => applyInstruction(suggestion)}
                type="button"
              >
                {suggestion}
              </button>
            ))}
          </ActionGroup>
          <label className="form-field">
            <FormFieldLabel>Tone</FormFieldLabel>
            <select disabled={isPending || clientSubmitting} name="tone" defaultValue={state.tone ?? defaultTone}>
              <option value="concise">Concise</option>
              <option value="warm">Warm</option>
              <option value="professional">Professional</option>
              <option value="follow_up">Follow up</option>
              <option value="pricing_quote">Pricing / quote careful</option>
            </select>
          </label>
          <button className="button-primary button-compact" disabled={isPending || clientSubmitting} type="submit">
            {primaryActionLabel}
          </button>
          {isPending || clientSubmitting ? (
            <p className="form-hint" role="status">
              Generating draft. If the provider is busy, Northstar will retry briefly before asking you to try again.
            </p>
          ) : null}
        </form>
      )}
      {state.error ? <FormErrorMessage compact>{state.error}</FormErrorMessage> : null}
      {state.retryable ? (
        <p className="form-hint">
          {state.retryLabel ?? "Retry is available from this panel without reopening the thread."}
        </p>
      ) : null}
      {state.message ? <FormSuccessMessage compact>{state.message}</FormSuccessMessage> : null}
      {generated ? (
        <div className="email-ai-review">
          <label className="form-field">
            <FormFieldLabel>Subject suggestion</FormFieldLabel>
            <input onChange={(event) => setDraftSubject(event.target.value)} value={draftSubject} />
          </label>
          <label className="form-field">
            <FormFieldLabel>Draft reply</FormFieldLabel>
            <textarea onChange={(event) => setDraftBody(event.target.value)} rows={8} value={draftBody} />
          </label>
          {state.contextUsed?.length ? (
            <div>
              <strong>Context used</strong>
              <ul className="email-ai-context-list">
                {state.contextUsed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.warnings?.length ? (
            <div>
              <strong>Review cautions</strong>
              <ul className="email-ai-context-list">
                {state.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {state.suggestedNextAction ? <p className="form-hint">Suggested next action: {state.suggestedNextAction}</p> : null}
          <ActionGroup className="filter-actions" label={aiReplyActionsLabel}>
            <button className="button-secondary button-compact" onClick={copyDraft} title="Copy AI draft" type="button">
              {copyState === "copied" ? "Copied" : copyState === "unavailable" ? "Copy unavailable" : "Copy draft"}
            </button>
            <button className="button-secondary button-compact" onClick={resetDraft} title="Clear the current AI draft" type="button">
              Start over
            </button>
            {composeHref ? (
              <a className="button-secondary button-compact" href={composeHref} title="Open compose with AI draft">
                Open compose
              </a>
            ) : null}
          </ActionGroup>
        </div>
      ) : null}
    </details>
  );
}
