import Link from "next/link";
import type { Route } from "next";

import { sendAssistantConversationMessageAction } from "@/app/assistant/actions";
import { AssistantActionReviewQueue } from "@/components/assistant-action-review-queue";
import { Badge } from "@/components/badge";
import { AssistantCommandForm } from "@/components/assistant-command-form";
import { AssistantDraftActionCard } from "@/components/assistant-draft-action-card";
import { AssistantIcon } from "@/components/assistant-icon";
import { AssistantTodayCommandCenter } from "@/components/assistant-today-command-center";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantTonePreset } from "@/lib/services/ai-preferences-service";
import type { AssistantCommandResult } from "@/lib/services/assistant/assistant-command-service";
import type { AssistantActionRequestView } from "@/lib/services/assistant/assistant-action-request-service";
import {
  assistantConversationStarterPrompts,
  type AssistantConversationMessageView,
  type AssistantConversationSource,
  type AssistantConversationView
} from "@/lib/services/assistant/assistant-conversation-service";
import type { AssistantTodayCommandCenter as AssistantTodayCommandCenterView } from "@/lib/services/assistant/assistant-today-command-center-service";

type AssistantConsoleProps = {
  actionRequestQueue: "all" | "applied" | "pending" | "rejected";
  actionRequestStatus: string;
  answer: AssistantCommandResult | null;
  assistantChatStatus: string;
  assistantName: string;
  assistantTone: AssistantTonePreset;
  command: string;
  conversation: AssistantConversationView | null;
  pendingActionRequests: AssistantActionRequestView[];
  todayCommandCenter: AssistantTodayCommandCenterView;
  todayCommandCenterStatus: string;
};

export function AssistantConsole({
  actionRequestQueue,
  actionRequestStatus,
  answer,
  assistantChatStatus,
  assistantName,
  assistantTone,
  command,
  conversation,
  pendingActionRequests,
  todayCommandCenter,
  todayCommandCenterStatus
}: AssistantConsoleProps) {
  return (
    <section className="assistant-console" aria-label="Northstar Assistant console">
      <section className="panel assistant-command-panel assistant-command-panel-primary assistant-chat-panel" id="assistant-ask" aria-labelledby="assistant-command-title">
        <div className="assistant-command-head">
          <span className="assistant-command-icon" aria-hidden="true">
            <AssistantIcon data-testid="assistant-icon" size={24} />
          </span>
          <div className="assistant-command-copy">
            <p className="assistant-command-kicker">Review-first Assistant</p>
            <h2 id="assistant-command-title">Chat with {assistantName}</h2>
            <p>
              Ask open-ended CRM and Inbox questions, keep follow-up context in this conversation, and draft safe actions for review. {assistantName} is using a {assistantToneLabel(assistantTone)} tone; eligible contact and organization changes go through CRM Change Proposals before anything mutates.
            </p>
          </div>
          <div className="assistant-command-head-actions">
            <Badge>Review-first</Badge>
            {conversation ? (
              <Link className="button-secondary button-compact" href={"/assistant" as Route}>
                New conversation
              </Link>
            ) : null}
          </div>
        </div>
        <AssistantChatThread answer={answer} assistantName={assistantName} command={command} conversation={conversation} />
        <AssistantStarterPrompts conversationId={conversation?.id ?? ""} />
        <AssistantCommandForm
          assistantChatStatus={assistantChatStatus}
          assistantName={assistantName}
          command={command}
          conversationId={conversation?.id ?? null}
          hasAnswer={Boolean(answer) || Boolean(conversation?.messages.length)}
        />
        <AssistantPermissionSummary />
      </section>

      {answer ? <AssistantAnswerCard answer={answer} /> : null}
      <section className="assistant-workspace-panels" aria-label="Assistant workspace panels">
        <AssistantTodayCommandCenter commandCenter={todayCommandCenter} status={todayCommandCenterStatus} />
        <AssistantActionReviewQueue queue={actionRequestQueue} requests={pendingActionRequests} status={actionRequestStatus} />
      </section>
    </section>
  );
}

function assistantToneLabel(tone: AssistantTonePreset) {
  if (tone === "custom_later") return "custom";
  return tone.replaceAll("_", " ");
}

function AssistantChatThread({
  answer,
  assistantName,
  command,
  conversation
}: {
  answer: AssistantCommandResult | null;
  assistantName: string;
  command: string;
  conversation: AssistantConversationView | null;
}) {
  const hasMessages = Boolean(conversation?.messages.length);
  return (
    <section className="assistant-chat-thread" id="assistant-chat-thread" aria-label="Assistant conversation">
      {hasMessages ? (
        conversation?.messages.map((message) => (
          <AssistantMessageBubble
            conversationId={conversation.id}
            key={message.id}
            message={message}
            sourceCommand={previousSourceCommand(conversation.messages, message)}
          />
        ))
      ) : answer && command ? (
        <>
          <AssistantMessageBubble
            conversationId=""
            message={{
              content: command,
              createdAt: answer.generatedAt,
              draftActions: [],
              errorCode: null,
              id: "transient-user-command",
              retryPrompt: null,
              role: "user",
              sources: [],
              title: null
            }}
            sourceCommand={command}
          />
          <AssistantTransientAnswer answer={answer} />
        </>
      ) : (
        <div className="assistant-chat-empty">
          <strong>{assistantName} is ready for a work conversation.</strong>
          <p>
            Ask about your day, risky deals, a customer relationship, stored Inbox context, meeting prep, or a review-first draft. Follow-up questions stay in the current conversation.
          </p>
        </div>
      )}
    </section>
  );
}

function AssistantTransientAnswer({ answer }: { answer: AssistantCommandResult }) {
  const message: AssistantConversationMessageView = {
    content: [
      answer.summary,
      "",
      ...answer.items.map((item) => `${item.label ?? "Context"}: ${item.title}. ${item.detail}`),
      "",
      answer.safetyNotice
    ].join("\n"),
    createdAt: answer.generatedAt,
    draftActions: answer.draftActions ?? [],
    errorCode: null,
    id: "transient-assistant-answer",
    retryPrompt: answer.query,
    role: "assistant",
    sources: [
      ...answer.items.filter((item) => item.href).map((item) => ({
        detail: item.detail,
        href: item.href as Route,
        label: item.title,
        recordType: item.label ?? "CRM record"
      })),
      ...answer.sources.map((source) => ({
        detail: source.detail,
        label: source.label,
        recordType: "Context"
      }))
    ],
    title: answer.title
  };
  return <AssistantMessageBubble conversationId="" message={message} sourceCommand={answer.query} />;
}

function AssistantMessageBubble({
  conversationId,
  message,
  sourceCommand
}: {
  conversationId: string;
  message: AssistantConversationMessageView;
  sourceCommand: string;
}) {
  const isAssistant = message.role === "assistant";
  return (
    <article className={isAssistant ? "assistant-chat-message assistant-chat-message-assistant" : "assistant-chat-message assistant-chat-message-user"}>
      <div className="assistant-chat-message-meta">
        <strong>{isAssistant ? "Assistant" : "You"}</strong>
        {message.errorCode ? <Badge>Retry available</Badge> : null}
      </div>
      {message.title ? <h3>{message.title}</h3> : null}
      <p className="assistant-chat-message-content">{message.content}</p>
      {message.sources.length > 0 ? <AssistantSourceList sources={message.sources} /> : null}
      {message.draftActions.length > 0 ? (
        <div className="assistant-draft-list" aria-label="Assistant draft actions">
          {message.draftActions.map((draft) => (
            <AssistantDraftActionCard draft={draft} key={draft.id} sourceCommand={sourceCommand} />
          ))}
        </div>
      ) : null}
      {isAssistant && message.retryPrompt ? (
        <form action={sendAssistantConversationMessageAction} className="assistant-chat-retry">
          {conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}
          <input name="message" type="hidden" value={message.retryPrompt} />
          <button className="button-secondary button-compact" type="submit">
            Retry
          </button>
        </form>
      ) : null}
    </article>
  );
}

function AssistantSourceList({ sources }: { sources: AssistantConversationSource[] }) {
  return (
    <div className="assistant-chat-sources" aria-label="Assistant source links">
      <strong>Sources</strong>
      <ul>
        {sources.map((source) => (
          <li key={`${source.recordType}-${source.label}-${source.detail}`}>
            {source.href ? (
              <Link className="inline-link" href={source.href}>
                {source.recordType}: {source.label}
              </Link>
            ) : (
              <span>{source.recordType}: {source.label}</span>
            )}
            <small>{source.detail}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AssistantStarterPrompts({ conversationId }: { conversationId: string }) {
  return (
    <div className="assistant-suggestion-grid" aria-label="Suggested Assistant prompts">
      {assistantConversationStarterPrompts.map((suggestion) => (
        <form action={sendAssistantConversationMessageAction} key={suggestion}>
          {conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}
          <input name="message" type="hidden" value={suggestion} />
          <button className="assistant-suggestion" type="submit">
            {suggestion}
          </button>
        </form>
      ))}
    </div>
  );
}

function previousSourceCommand(messages: AssistantConversationMessageView[], message: AssistantConversationMessageView) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index <= 0) return message.content;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === "user") return messages[cursor]?.content ?? message.content;
  }
  return message.content;
}

function AssistantAnswerCard({ answer }: { answer: AssistantCommandResult }) {
  return (
    <section className="data-card assistant-answer-card" id="assistant-answer" aria-label="Assistant answer">
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

function AssistantPermissionSummary() {
  return (
    <div className="assistant-permission-summary" aria-label="Assistant permissions and limits">
      <div>
        <strong>Available now</strong>
        <span>Read-only answers, draft actions, save to review, confirmed activity or note apply, and contact or organization CRM Change Proposals.</span>
      </div>
      <div>
        <strong>Settings-only for now</strong>
        <span>Deal, quote, relationship memory, AI preference, email send, sync, provider mutation, destructive actions, and unsupported automatic actions.</span>
      </div>
    </div>
  );
}
