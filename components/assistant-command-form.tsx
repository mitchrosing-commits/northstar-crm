"use client";

import { useId, useState } from "react";

import { FormFieldLabel } from "@/components/form-field-label";

type AssistantCommandFormProps = {
  assistantName: string;
  command: string;
  hasAnswer: boolean;
};

type CommandFormState = "answered" | "error" | "idle" | "loading";

export function AssistantCommandForm({ assistantName, command, hasAnswer }: AssistantCommandFormProps) {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const statusId = `${inputId}-status`;
  const [formState, setFormState] = useState<CommandFormState>(hasAnswer ? "answered" : "idle");
  const isLoading = formState === "loading";
  const statusCopy = commandStatusCopy(formState, assistantName);

  return (
    <div className="assistant-command-entry">
      <form
        action="/assistant"
        className="assistant-command-form"
        onSubmit={() => {
          setFormState("loading");
        }}
      >
        <label className="form-field assistant-command-input" htmlFor={inputId}>
          <FormFieldLabel>Question or command</FormFieldLabel>
          <input
            aria-describedby={`${descriptionId} ${statusId}`}
            autoComplete="off"
            defaultValue={command}
            id={inputId}
            maxLength={640}
            name="command"
            onInvalid={() => {
              setFormState("error");
            }}
            onInput={() => {
              if (formState === "error") setFormState("idle");
            }}
            placeholder="Tell me what I have to do today."
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
  if (formState === "loading") return `${assistantName} is building a review-first answer...`;
  if (formState === "answered") return "Answer ready below.";
  if (formState === "error") return "Enter a question or command before asking.";
  return "Ready for a review-first CRM question.";
}
