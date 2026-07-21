import Link from "next/link";
import type { Route } from "next";

import {
  deleteAssistantConversationAction,
  regenerateAssistantConversationAction,
  renameAssistantConversationAction,
  sendAssistantConversationMessageAction
} from "@/app/assistant/actions";
import { AssistantActionReviewQueue } from "@/components/assistant-action-review-queue";
import { Badge } from "@/components/badge";
import { AssistantCommandForm } from "@/components/assistant-command-form";
import { AssistantCopyButton } from "@/components/assistant-copy-button";
import { AssistantDraftActionCard } from "@/components/assistant-draft-action-card";
import { AssistantIcon } from "@/components/assistant-icon";
import { AssistantTodayCommandCenter } from "@/components/assistant-today-command-center";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantTonePreset } from "@/lib/services/ai-preferences-service";
import type { AssistantCommandResult } from "@/lib/services/assistant/assistant-command-service";
import type { AssistantActionRequestView } from "@/lib/services/assistant/assistant-action-request-service";
import {
  assistantCrmProposalIdempotencyKey,
  isAssistantCrmChangeProposalDraft
} from "@/lib/services/assistant/assistant-crm-change-proposal-service";
import {
  assistantConversationStarterPrompts,
  type AssistantConversationListItem,
  type AssistantConversationMessageView,
  type AssistantConversationSource,
  type AssistantConversationView
} from "@/lib/services/assistant/assistant-conversation-service";
import type { AssistantTodayCommandCenter as AssistantTodayCommandCenterView } from "@/lib/services/assistant/assistant-today-command-center-service";
import type { CrmChangeProposalView } from "@/lib/services/crm-change-proposal-service";

type AssistantConsoleProps = {
  actionRequestQueue: "all" | "applied" | "pending" | "rejected";
  actionRequestStatus: string;
  answer: AssistantCommandResult | null;
  assistantChatStatus: string;
  assistantName: string;
  assistantTone: AssistantTonePreset;
  command: string;
  conversation: AssistantConversationView | null;
  conversations: AssistantConversationListItem[];
  crmChangeProposals: CrmChangeProposalView[];
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
  conversations,
  crmChangeProposals,
  pendingActionRequests,
  todayCommandCenter,
  todayCommandCenterStatus
}: AssistantConsoleProps) {
  return (
    <section className="assistant-console" aria-label="Northstar Assistant console">
      <div className="assistant-chat-layout">
        <AssistantConversationHistory conversations={conversations} currentConversationId={conversation?.id ?? ""} />
        <section className="panel assistant-command-panel assistant-command-panel-primary assistant-chat-panel" id="assistant-ask" aria-labelledby="assistant-command-title">
          <div className="assistant-command-head">
            <span className="assistant-command-icon" aria-hidden="true">
              <AssistantIcon data-testid="assistant-icon" size={24} />
            </span>
            <div className="assistant-command-copy">
              <p className="assistant-command-kicker">Review-first Assistant</p>
              <h2 id="assistant-command-title">Chat with {assistantName}</h2>
              <p>
                Ask naturally, follow up, change direction, and keep CRM work review-first. {assistantName} is using a {assistantToneLabel(assistantTone)} tone; eligible contact and organization changes go through CRM Change Proposals before anything mutates.
              </p>
            </div>
            <div className="assistant-command-head-actions">
              <Badge>Review-first</Badge>
              <Link className="button-secondary button-compact" href={"/assistant" as Route}>
                New chat
              </Link>
            </div>
          </div>
          {conversation ? <AssistantConversationTitleControls conversation={conversation} /> : null}
          <AssistantChatThread
            answer={answer}
            assistantName={assistantName}
            command={command}
            conversation={conversation}
            crmChangeProposals={crmChangeProposals}
          />
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
      </div>

      {answer ? <AssistantAnswerCard answer={answer} crmChangeProposals={crmChangeProposals} /> : null}
      <section className="assistant-workspace-panels" aria-label="Assistant workspace panels">
        <AssistantTodayCommandCenter commandCenter={todayCommandCenter} status={todayCommandCenterStatus} />
        <AssistantActionReviewQueue
          crmChangeProposals={crmChangeProposals}
          queue={actionRequestQueue}
          requests={pendingActionRequests}
          status={actionRequestStatus}
        />
      </section>
    </section>
  );
}

function AssistantConversationHistory({
  conversations,
  currentConversationId
}: {
  conversations: AssistantConversationListItem[];
  currentConversationId: string;
}) {
  return (
    <aside className="assistant-conversation-history" aria-label="Assistant chat history">
      <div className="assistant-history-header">
        <div>
          <p className="assistant-command-kicker">Conversations</p>
          <h2>History</h2>
        </div>
        <Link className="button-primary button-compact" href={"/assistant" as Route}>
          New
        </Link>
      </div>
      {conversations.length > 0 ? (
        <ol className="assistant-history-list">
          {conversations.map((item) => (
            <li key={item.id}>
              <Link
                aria-current={currentConversationId === item.id ? "page" : undefined}
                className={currentConversationId === item.id ? "assistant-history-link assistant-history-link-active" : "assistant-history-link"}
                href={`/assistant?conversation=${item.id}` as Route}
              >
                <strong>{item.title}</strong>
                <span>{item.lastMessagePreview}</span>
                <small>{formatConversationDate(item.updatedAt)}</small>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="assistant-history-empty">Start a chat to keep the thread here.</p>
      )}
    </aside>
  );
}

function AssistantConversationTitleControls({ conversation }: { conversation: AssistantConversationView }) {
  return (
    <details className="assistant-conversation-title-controls">
      <summary>Conversation settings</summary>
      <div className="assistant-conversation-title-panel">
        <form action={renameAssistantConversationAction} className="assistant-inline-form">
          <input name="conversationId" type="hidden" value={conversation.id} />
          <label>
            <span>Rename chat</span>
            <input name="title" defaultValue={conversation.title} maxLength={80} required />
          </label>
          <button className="button-secondary button-compact" type="submit">
            Rename
          </button>
        </form>
        <form action={deleteAssistantConversationAction} className="assistant-inline-form">
          <input name="conversationId" type="hidden" value={conversation.id} />
          <button className="button-secondary button-compact" type="submit">
            Delete chat
          </button>
          <small>Deletes this conversation only. CRM records and review history stay intact.</small>
        </form>
      </div>
    </details>
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
  conversation,
  crmChangeProposals
}: {
  answer: AssistantCommandResult | null;
  assistantName: string;
  command: string;
  conversation: AssistantConversationView | null;
  crmChangeProposals: CrmChangeProposalView[];
}) {
  const hasMessages = Boolean(conversation?.messages.length);
  const latestAssistantId = latestMessageId(conversation?.messages ?? [], "assistant");
  const latestUserId = latestMessageId(conversation?.messages ?? [], "user");
  return (
    <section className="assistant-chat-thread" id="assistant-chat-thread" aria-label="Assistant conversation">
      {hasMessages ? (
        conversation?.messages.map((message) => (
          <AssistantMessageBubble
            conversationId={conversation.id}
            key={message.id}
            message={message}
            crmChangeProposals={crmChangeProposals}
            isLatestAssistant={message.id === latestAssistantId}
            isLatestUser={message.id === latestUserId}
            sourceCommand={previousSourceCommand(conversation.messages, message)}
          />
        ))
      ) : answer && command ? (
        <>
          <AssistantMessageBubble
            conversationId=""
            crmChangeProposals={crmChangeProposals}
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
            isLatestAssistant={false}
            isLatestUser={false}
          />
          <AssistantTransientAnswer answer={answer} crmChangeProposals={crmChangeProposals} />
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

function AssistantTransientAnswer({
  answer,
  crmChangeProposals
}: {
  answer: AssistantCommandResult;
  crmChangeProposals: CrmChangeProposalView[];
}) {
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
  return (
    <AssistantMessageBubble
      conversationId=""
      crmChangeProposals={crmChangeProposals}
      isLatestAssistant
      isLatestUser={false}
      message={message}
      sourceCommand={answer.query}
    />
  );
}

function AssistantMessageBubble({
  conversationId,
  crmChangeProposals,
  isLatestAssistant,
  isLatestUser,
  message,
  sourceCommand
}: {
  conversationId: string;
  crmChangeProposals: CrmChangeProposalView[];
  isLatestAssistant: boolean;
  isLatestUser: boolean;
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
      {isLatestUser ? <AssistantEditLatestUserMessage conversationId={conversationId} message={message.content} /> : null}
      <AssistantMessageLifecycleNotice message={message} />
      {message.sources.length > 0 ? <AssistantSourceList sources={message.sources} /> : null}
      {message.draftActions.length > 0 ? (
        <div className="assistant-draft-list" aria-label="Assistant draft actions">
          {message.draftActions.map((draft) => (
            <AssistantDraftActionCard
              conversationId={conversationId}
              crmProposal={proposalForDraft(draft, crmChangeProposals)}
              draft={draft}
              key={draft.id}
              sourceCommand={sourceCommand}
            />
          ))}
        </div>
      ) : null}
      {isAssistant && message.retryPrompt ? (
        <div className="assistant-chat-message-actions">
          <AssistantCopyButton text={message.content} />
          {message.errorCode ? (
            <form action={sendAssistantConversationMessageAction}>
              {conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}
              <input name="message" type="hidden" value={message.retryPrompt} />
              <button className="button-secondary button-compact" type="submit">
                Retry
              </button>
            </form>
          ) : null}
          {isLatestAssistant && conversationId ? (
            <form action={regenerateAssistantConversationAction}>
              <input name="conversationId" type="hidden" value={conversationId} />
              <button className="button-secondary button-compact" type="submit">
                Regenerate
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function AssistantEditLatestUserMessage({ conversationId, message }: { conversationId: string; message: string }) {
  if (!conversationId) return null;
  return (
    <details className="assistant-edit-message">
      <summary>Edit and resend</summary>
      <form action={sendAssistantConversationMessageAction}>
        <input name="conversationId" type="hidden" value={conversationId} />
        <textarea aria-label="Edited message" defaultValue={message} maxLength={2_000} name="message" required />
        <button className="button-secondary button-compact" type="submit">
          Send edited message
        </button>
      </form>
    </details>
  );
}

function AssistantMessageLifecycleNotice({ message }: { message: AssistantConversationMessageView }) {
  if (message.title === "Clarification canceled") {
    return (
      <div className="assistant-lifecycle-row" aria-label="Assistant lifecycle status">
        <Badge>Clarification canceled</Badge>
        <span>No CRM Change Proposal was created. Next action: retry safely or dismiss.</span>
      </div>
    );
  }
  if (message.title === "Clarification applied") {
    return (
      <div className="assistant-lifecycle-row" aria-label="Assistant lifecycle status">
        <Badge>Clarification resolved</Badge>
        <span>Selected record is now attached to the draft. Next action: review the proposal preview.</span>
      </div>
    );
  }
  if (message.title === "Clarification still needed") {
    return (
      <div className="assistant-lifecycle-row" aria-label="Assistant lifecycle status">
        <Badge>Candidate stale or deleted</Badge>
        <span>The selected record was unavailable. Next action: choose another candidate or retry safely.</span>
      </div>
    );
  }
  return null;
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

function latestMessageId(messages: AssistantConversationMessageView[], role: AssistantConversationMessageView["role"]) {
  for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
    if (messages[cursor]?.role === role) return messages[cursor]?.id ?? "";
  }
  return "";
}

function formatConversationDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(new Date(value));
}

function AssistantAnswerCard({
  answer,
  crmChangeProposals
}: {
  answer: AssistantCommandResult;
  crmChangeProposals: CrmChangeProposalView[];
}) {
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
            <AssistantDraftActionCard
              crmProposal={proposalForDraft(draft, crmChangeProposals)}
              draft={draft}
              key={draft.id}
              sourceCommand={answer.query}
            />
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

function proposalForDraft(draft: AssistantConversationMessageView["draftActions"][number], proposals: CrmChangeProposalView[]) {
  if (!isAssistantCrmChangeProposalDraft(draft) || !draft.proposal) return null;
  try {
    const idempotencyKey = assistantCrmProposalIdempotencyKey(draft);
    return proposals.find((proposal) => proposal.idempotencyKey === idempotencyKey) ?? null;
  } catch {
    return null;
  }
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
