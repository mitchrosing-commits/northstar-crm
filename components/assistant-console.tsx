import Link from "next/link";
import type { Route } from "next";

import { AssistantActionReviewQueue } from "@/components/assistant-action-review-queue";
import { Badge } from "@/components/badge";
import { AssistantCommandForm } from "@/components/assistant-command-form";
import { AssistantDraftActionCard } from "@/components/assistant-draft-action-card";
import { AssistantIcon } from "@/components/assistant-icon";
import { AssistantTodayCommandCenter } from "@/components/assistant-today-command-center";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantTonePreset } from "@/lib/services/ai-preferences-service";
import type { AssistantCommandResult } from "@/lib/services/assistant/assistant-command-service";
import { assistantSuggestedCommands } from "@/lib/services/assistant/assistant-command-service";
import type { AssistantActionRequestView } from "@/lib/services/assistant/assistant-action-request-service";
import type { AssistantTodayCommandCenter as AssistantTodayCommandCenterView } from "@/lib/services/assistant/assistant-today-command-center-service";

type AssistantConsoleProps = {
  actionRequestQueue: "all" | "applied" | "pending" | "rejected";
  actionRequestStatus: string;
  answer: AssistantCommandResult | null;
  assistantName: string;
  assistantTone: AssistantTonePreset;
  command: string;
  pendingActionRequests: AssistantActionRequestView[];
  todayCommandCenter: AssistantTodayCommandCenterView;
  todayCommandCenterStatus: string;
};

export function AssistantConsole({
  actionRequestQueue,
  actionRequestStatus,
  answer,
  assistantName,
  assistantTone,
  command,
  pendingActionRequests,
  todayCommandCenter,
  todayCommandCenterStatus
}: AssistantConsoleProps) {
  return (
    <section className="assistant-console" aria-label="Northstar Assistant console">
      <section className="panel assistant-command-panel assistant-command-panel-primary" aria-labelledby="assistant-command-title">
        <div className="assistant-command-head">
          <span className="assistant-command-icon" aria-hidden="true">
            <AssistantIcon data-testid="assistant-icon" size={24} />
          </span>
          <div className="assistant-command-copy">
            <p className="assistant-command-kicker">Review-first Assistant</p>
            <h2 id="assistant-command-title">Ask {assistantName}</h2>
            <p>
              Ask a focused CRM question or draft a CRM action for review. {assistantName} is using a {assistantToneLabel(assistantTone)} tone and
              applies only explicitly confirmed low-risk activity or note drafts.
            </p>
          </div>
          <div className="assistant-command-head-actions">
            <Badge>Review-first</Badge>
          </div>
        </div>
        <AssistantCommandForm assistantName={assistantName} command={command} hasAnswer={Boolean(answer)} />
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
      </section>

      {answer ? <AssistantAnswerCard answer={answer} /> : <AssistantEmptyState />}
      <AssistantTodayCommandCenter commandCenter={todayCommandCenter} status={todayCommandCenterStatus} />
      <AssistantActionReviewQueue queue={actionRequestQueue} requests={pendingActionRequests} status={actionRequestStatus} />
    </section>
  );
}

function assistantToneLabel(tone: AssistantTonePreset) {
  if (tone === "custom_later") return "custom";
  return tone.replaceAll("_", " ");
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
