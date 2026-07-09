import Link from "next/link";
import type { Route } from "next";

import { AssistantActionReviewQueue } from "@/components/assistant-action-review-queue";
import { Badge } from "@/components/badge";
import { AssistantDraftActionCard } from "@/components/assistant-draft-action-card";
import { FormFieldLabel } from "@/components/form-field-label";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantCommandResult } from "@/lib/services/assistant/assistant-command-service";
import { assistantSuggestedCommands } from "@/lib/services/assistant/assistant-command-service";
import type { AssistantActionRequestView } from "@/lib/services/assistant/assistant-action-request-service";

type AssistantConsoleProps = {
  actionRequestQueue: "all" | "applied" | "pending" | "rejected";
  actionRequestStatus: string;
  answer: AssistantCommandResult | null;
  command: string;
  pendingActionRequests: AssistantActionRequestView[];
};

export function AssistantConsole({ actionRequestQueue, actionRequestStatus, answer, command, pendingActionRequests }: AssistantConsoleProps) {
  return (
    <section className="assistant-console" aria-label="Northstar Assistant console">
      <section className="panel assistant-command-panel" aria-labelledby="assistant-command-title">
        <PanelTitleRow
          actions={<Badge>Review-first</Badge>}
          description="Ask a focused CRM question or draft a CRM action for review. Northstar applies only explicitly confirmed low-risk activity or note drafts; it does not save settings, send email, sync, or mutate provider mail from this page."
          title="Ask Northstar"
          titleId="assistant-command-title"
        />
        <div className="assistant-suggestion-grid" aria-label="Suggested Assistant prompts">
          {assistantSuggestedCommands.map((suggestion) => (
            <Link
              className="assistant-suggestion"
              href={`/assistant?command=${encodeURIComponent(suggestion)}` as Route}
              key={suggestion}
            >
              {suggestion}
            </Link>
          ))}
        </div>
        <AssistantPermissionSummary />
        <form action="/assistant" className="assistant-command-form">
          <label className="form-field assistant-command-input">
            <FormFieldLabel>Command</FormFieldLabel>
            <input
              autoComplete="off"
              defaultValue={command}
              maxLength={640}
              name="command"
              placeholder="Tell me what I have to do today."
            />
          </label>
          <button className="button-primary" type="submit">
            Ask
          </button>
        </form>
      </section>

      {answer ? <AssistantAnswerCard answer={answer} /> : <AssistantEmptyState />}
      <AssistantActionReviewQueue queue={actionRequestQueue} requests={pendingActionRequests} status={actionRequestStatus} />
    </section>
  );
}

function AssistantAnswerCard({ answer }: { answer: AssistantCommandResult }) {
  return (
    <section className="data-card assistant-answer-card" aria-label="Assistant answer">
      <PanelTitleRow
        actions={
          <>
            <Badge>Context-only</Badge>
            <Badge>Draft only</Badge>
          </>
        }
        description={answer.safetyNotice}
        eyebrow="Assistant answer"
        title={answer.title}
      />
      <p className="assistant-answer-summary">{answer.summary}</p>
      <ul className="assistant-answer-list">
        {answer.items.map((item) => (
          <li className={`assistant-answer-item assistant-answer-item-${item.tone}`} key={`${item.title}-${item.detail}`}>
            <span className="assistant-answer-label">{item.label ?? "Context"}</span>
            <span className="assistant-answer-copy">
              {item.href ? (
                <Link className="inline-link" href={item.href as Route}>
                  {item.title}
                </Link>
              ) : (
                <strong>{item.title}</strong>
              )}
              <span>{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {answer.draftActions?.length ? (
        <div className="assistant-draft-list" aria-label="Assistant draft actions">
          {answer.draftActions.map((draft) => (
            <AssistantDraftActionCard draft={draft} key={draft.id} sourceCommand={answer.query} />
          ))}
        </div>
      ) : null}
      {answer.sources.length > 0 ? (
        <div className="assistant-source-notes" aria-label="Assistant source context notes">
          <strong>Source notes</strong>
          <ul>
            {answer.sources.map((source) => (
              <li key={`${source.label}-${source.detail}`}>
                <span>{source.label}</span>
                <small>{source.detail}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function AssistantEmptyState() {
  return (
    <section className="data-card assistant-answer-card" aria-label="Assistant getting started">
      <PanelTitleRow
        actions={<Badge>Deterministic</Badge>}
        description="Choose a suggested command or ask one of the supported read-only or draft-only questions."
        eyebrow="Assistant answer"
        title="Ready for a workspace question"
      />
      <p className="assistant-answer-summary">
        Northstar can summarize today&apos;s work, identify deterministic deal risk, check stored email logs for likely replies, and draft CRM actions for review. It will not sync, send, save settings, or apply anything except an explicitly confirmed low-risk activity or note draft.
      </p>
    </section>
  );
}

function AssistantPermissionSummary() {
  return (
    <div className="assistant-permission-summary" aria-label="Assistant permissions and limits">
      <div>
        <strong>Available now</strong>
        <span>Read-only answers, draft actions, save to review, and confirmed activity or note apply.</span>
      </div>
      <div>
        <strong>Review-only for now</strong>
        <span>Contact, organization, deal, quote, relationship memory, AI preference, email send, sync, and autonomous actions.</span>
      </div>
    </div>
  );
}
