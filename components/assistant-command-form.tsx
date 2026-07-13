"use client";

import { useId, useState } from "react";

import { sendAssistantConversationMessageAction } from "@/app/assistant/actions";
import { FormFieldLabel } from "@/components/form-field-label";

type AssistantCommandFormProps = {
  assistantChatStatus: string;
  assistantName: string;
  command: string;
  conversationId: string | null;
  hasAnswer: boolean;
};

type CommandFormState = "answered" | "error" | "idle" | "loading";

export function AssistantCommandForm({ assistantChatStatus, assistantName, command, conversationId, hasAnswer }: AssistantCommandFormProps) {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const statusId = `${inputId}-status`;
  const [formState, setFormState] = useState<CommandFormState>(assistantChatStatus === "error" ? "error" : hasAnswer || assistantChatStatus === "sent" ? "answered" : "idle");
  const isLoading = formState === "loading";
  const statusCopy = commandStatusCopy(formState, assistantName);

  return (
    <div className="assistant-command-entry" id="assistant-chat-composer">
      <form
        action={sendAssistantConversationMessageAction}
        className="assistant-command-form"
        onSubmit={() => {
          setFormState("loading");
        }}
      >
        {conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}
        <label className="form-field assistant-command-input" htmlFor={inputId}>
          <FormFieldLabel>Question or command</FormFieldLabel>
          <input
            aria-describedby={`${descriptionId} ${statusId}`}
            autoFocus
            autoComplete="off"
            defaultValue={command}
            id={inputId}
            maxLength={640}
            name="message"
            onInvalid={() => {
              setFormState("error");
            }}
            onInput={() => {
              if (formState === "error") setFormState("idle");
            }}
            placeholder="Ask about your day, a customer, a deal, or a review-first draft."
            required
          />
        </label>
        <button className="button-primary assistant-command-submit" disabled={isLoading} type="submit">
          {isLoading ? "Asking" : "Ask"}
        </button>
      </form>
      <div className="assistant-command-support">
        <p id={descriptionId}>Read-only answers and draft-only CRM actions. Suggestions are review-first before anything eligible can be applied.</p>
        <p aria-live="polite" className={`assistant-command-status assistant-command-status-${formState}`} id={statusId} role="status">
          {statusCopy}
        </p>
      </div>
    </div>
  );
}

function commandStatusCopy(formState: CommandFormState, assistantName: string) {
  if (formState === "loading") return `${assistantName} is building a review-first reply...`;
  if (formState === "answered") return "Reply ready in the conversation.";
  if (formState === "error") return "Enter a question or command before asking.";
  return "Ready for a review-first CRM question.";
}
