import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { FormFieldLabel } from "@/components/form-field-label";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantCommandResult } from "@/lib/services/assistant/assistant-command-service";
import { assistantSuggestedCommands } from "@/lib/services/assistant/assistant-command-service";

type AssistantConsoleProps = {
  answer: AssistantCommandResult | null;
  command: string;
};

export function AssistantConsole({ answer, command }: AssistantConsoleProps) {
  return (
    <section className="assistant-console" aria-label="Northstar Assistant console">
      <section className="panel assistant-command-panel" aria-labelledby="assistant-command-title">
        <PanelTitleRow
          actions={<Badge>Read-only</Badge>}
          description="Ask a focused CRM question. This first Assistant slice only reads workspace context and never changes CRM records or provider mail."
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
        <form action="/assistant" className="assistant-command-form">
          <label className="form-field assistant-command-input">
            <FormFieldLabel>Command</FormFieldLabel>
            <input
              autoComplete="off"
              defaultValue={command}
              maxLength={240}
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
            <Badge>Review-first</Badge>
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
        description="Choose a suggested command or ask one of the supported read-only questions."
        eyebrow="Assistant answer"
        title="Ready for a workspace question"
      />
      <p className="assistant-answer-summary">
        Northstar can summarize today&apos;s work, identify deterministic deal risk, and check stored email logs for likely replies. It will not sync, send, edit, or apply changes.
      </p>
    </section>
  );
}
