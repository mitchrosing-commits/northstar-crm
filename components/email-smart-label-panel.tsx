"use client";

import { useActionState } from "react";

import { classifyEmailLogAction, type ClassifyEmailLogActionState } from "@/app/email/actions";
import { ActionGroup } from "@/components/action-group";
import { Badge } from "@/components/badge";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormSuccessMessage } from "@/components/form-success-message";
import type {
  EmailClassificationReadiness,
  EmailSmartCategory,
  EmailSmartClassification,
  EmailSmartSignal
} from "@/lib/services/email-classification-service";

type EmailSmartLabelPanelProps = {
  emailLogId: string;
  initialClassification: EmailSmartClassification | null;
  readiness: EmailClassificationReadiness;
  subject: string;
};

const initialState: ClassifyEmailLogActionState = {};

export function EmailSmartLabelPanel({ emailLogId, initialClassification, readiness, subject }: EmailSmartLabelPanelProps) {
  const [state, formAction, isPending] = useActionState(classifyEmailLogAction, initialState);
  const classification = state.emailLogId === emailLogId && state.classification ? state.classification : initialClassification;
  const labels = classification ? smartClassificationLabels(classification) : [];
  const labelGroup = `${subject} Smart Email Labels`;
  const classifyLabel = classification ? `Refresh smart labels for ${subject}` : `Classify email ${subject} with AI`;

  return (
    <section aria-label={labelGroup} className="email-smart-label-panel">
      <ActionGroup className="email-smart-label-row filter-actions" label={labelGroup}>
        {classification ? (
          <>
            {labels.map((label) => (
              <Badge className={smartBadgeClassName(label.kind)} key={`${label.kind}-${label.value}`}>
                {label.value}
              </Badge>
            ))}
            <Badge label={`${Math.round(classification.confidence * 100)} percent confidence`}>
              {Math.round(classification.confidence * 100)}% confidence
            </Badge>
          </>
        ) : (
          <Badge>Not classified</Badge>
        )}
      </ActionGroup>
      <div className="email-smart-label-body">
        {classification ? (
          <details className="email-smart-label-evidence">
            <summary>Why this was labeled</summary>
            <p>{classification.summary}</p>
            {classification.evidence.length > 0 ? (
              <ul className="email-ai-context-list">
                {classification.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {classification.cautions.length > 0 ? (
              <p className="form-hint">Caution: {classification.cautions.join(" ")}</p>
            ) : null}
            {classification.generatedAt ? <p className="form-hint">Generated {formatSmartLabelDate(classification.generatedAt)}</p> : null}
          </details>
        ) : (
          <p className="form-hint">Generate suggested relationship-inbox labels for this stored email. Labels do not create tasks or change CRM records.</p>
        )}
        {!readiness.configured ? (
          <p className="form-hint">{readiness.message}</p>
        ) : (
          <form action={formAction}>
            <input name="emailLogId" type="hidden" value={emailLogId} />
            <button aria-label={classifyLabel} className="button-secondary button-compact" disabled={isPending} title={classifyLabel} type="submit">
              {isPending ? "Classifying..." : classification ? "Refresh labels" : "Classify with AI"}
            </button>
          </form>
        )}
        {state.emailLogId === emailLogId && state.error ? <FormErrorMessage compact>{state.error}</FormErrorMessage> : null}
        {state.emailLogId === emailLogId && state.message ? <FormSuccessMessage compact>{state.message}</FormSuccessMessage> : null}
      </div>
    </section>
  );
}

function smartClassificationLabels(classification: EmailSmartClassification) {
  return [
    { kind: classification.category, value: smartCategoryLabel(classification.category) },
    ...classification.signals.map((signal) => ({ kind: signal, value: smartSignalLabel(signal) }))
  ];
}

function smartCategoryLabel(category: EmailSmartCategory) {
  if (category === "CUSTOMER") return "Customer";
  if (category === "PROSPECT") return "Prospect";
  if (category === "INTERNAL") return "Internal";
  if (category === "PERSONAL") return "Personal";
  if (category === "NOT_CRM_RELEVANT") return "Not CRM relevant";
  return "Unknown";
}

function smartSignalLabel(signal: EmailSmartSignal) {
  if (signal === "URGENT") return "Urgent";
  if (signal === "NEEDS_REPLY") return "Needs reply";
  if (signal === "WAITING_ON_CUSTOMER") return "Waiting on customer";
  if (signal === "PRICING_QUOTE") return "Pricing / quote";
  if (signal === "CONTRACT_LEGAL") return "Contract / legal";
  if (signal === "OBJECTION_CONCERN") return "Objection / concern";
  if (signal === "POSITIVE_BUYING_SIGNAL") return "Positive buying signal";
  if (signal === "RELATIONSHIP_RISK") return "Relationship risk";
  if (signal === "FOLLOW_UP_NEEDED") return "Follow-up needed";
  return "Potential lead";
}

function smartBadgeClassName(kind: EmailSmartCategory | EmailSmartSignal) {
  if (kind === "URGENT" || kind === "RELATIONSHIP_RISK" || kind === "OBJECTION_CONCERN") return "badge email-smart-label email-smart-label-critical";
  if (kind === "NEEDS_REPLY" || kind === "PRICING_QUOTE" || kind === "CONTRACT_LEGAL") return "badge email-smart-label email-smart-label-attention";
  if (kind === "POSITIVE_BUYING_SIGNAL" || kind === "CUSTOMER" || kind === "PROSPECT") return "badge email-smart-label email-smart-label-positive";
  return "badge email-smart-label";
}

function formatSmartLabelDate(value: Date | string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString();
}
