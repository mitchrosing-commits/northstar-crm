"use client";

import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from "react";

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
  const formRef = useRef<HTMLFormElement>(null);
  const [message, setMessage] = useState(command);
  const descriptionId = `${inputId}-description`;
  const statusId = `${inputId}-status`;
  const [formState, setFormState] = useState<CommandFormState>(assistantChatStatus === "error" ? "error" : hasAnswer || assistantChatStatus === "sent" ? "answered" : "idle");
  const isLoading = formState === "loading";
  const isEmpty = message.trim().length === 0;
  const statusCopy = commandStatusCopy(formState, assistantName);
  const updateMessage = (value: string) => {
    setMessage(value);
    if (formState === "error" && value.trim()) setFormState("idle");
  };

  return (
    <div className="assistant-command-entry" id="assistant-chat-composer">
      <form
        action={sendAssistantConversationMessageAction}
        className="assistant-command-form"
        ref={formRef}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          const formMessage = new FormData(event.currentTarget).get("message");
          if (typeof formMessage !== "string" || formMessage.trim().length === 0) {
            event.preventDefault();
            setFormState("error");
            return;
          }
          setFormState("loading");
        }}
      >
        {conversationId ? <input name="conversationId" type="hidden" value={conversationId} /> : null}
        <label className="form-field assistant-command-input" htmlFor={inputId}>
          <FormFieldLabel>Message</FormFieldLabel>
          <textarea
            aria-describedby={`${descriptionId} ${statusId}`}
            autoFocus
            autoComplete="off"
            id={inputId}
            maxLength={640}
            name="message"
            onChange={(event) => {
              updateMessage(event.currentTarget.value);
            }}
            onInput={(event) => {
              updateMessage(event.currentTarget.value);
            }}
            onInvalid={() => {
              setFormState("error");
            }}
            onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              if (event.currentTarget.value.trim().length === 0) {
                setFormState("error");
                return;
              }
              formRef.current?.requestSubmit();
            }}
            placeholder="Ask anything about your work, a customer, a deal, or a review-first draft."
            required
            rows={2}
            value={message}
          />
        </label>
        <div className="assistant-command-buttons">
          <button className="button-primary assistant-command-submit" disabled={isLoading || isEmpty} type="submit">
            {isLoading ? "Sending" : "Send"}
          </button>
          {isLoading ? (
            <button className="button-secondary assistant-command-stop" disabled type="button">
              Stop unavailable
            </button>
          ) : null}
        </div>
      </form>
      <div className="assistant-command-support">
        <p id={descriptionId}>Enter sends. Shift+Enter adds a new line. Actions stay review-first before anything eligible can be applied.</p>
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
  if (formState === "error") return "Enter a message before sending.";
  return "Ready for a review-first CRM question.";
}
