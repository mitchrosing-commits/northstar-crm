import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { NorthstarAssistantInsight, NorthstarAssistantSeverity } from "@/lib/services/northstar-ai-service";

type NorthstarAssistantPanelProps = {
  insight: NorthstarAssistantInsight;
};

export function NorthstarAssistantPanel({ insight }: NorthstarAssistantPanelProps) {
  const primaryFinding = insight.findings[0];

  return (
    <section aria-label="Northstar Assistant AI insights" className="data-card northstar-assistant-panel" id="northstar-assistant">
      <PanelTitleRow
        actions={
          <>
            <Badge className={`badge northstar-confidence-${insight.confidence}`}>{confidenceLabel(insight.confidence)}</Badge>
            <Badge>{insight.mode === "provider" ? insight.providerName : "Rule check"}</Badge>
          </>
        }
        description="Review-first guidance from the current CRM context. Nothing changes automatically."
        eyebrow="AI insights"
        title="Northstar Assistant"
      />

      <div className="northstar-assistant-summary">
        <span className={`northstar-assistant-status ${severityClass(primaryFinding?.severity)}`}>
          {primaryFinding?.title ?? "Diagnostic ready"}
        </span>
        <p>{insight.summary}</p>
      </div>

      <div className="northstar-assistant-reviewed">
        <strong>Reviewed</strong>
        <span>{insight.lookedAt.slice(0, 6).join(" · ")}</span>
      </div>

      <div className="northstar-assistant-grid">
        <div>
          <h3>Findings</h3>
          <ul className="northstar-assistant-list">
            {insight.findings.slice(0, 4).map((finding) => (
              <li key={finding.id}>
                <strong>{finding.title}</strong>
                <span>{finding.detail}</span>
                {finding.evidence.length > 0 ? <small>{finding.evidence.slice(0, 2).join(" · ")}</small> : null}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Suggested Next Actions</h3>
          <ul className="northstar-assistant-list">
            {insight.suggestedActions.slice(0, 4).map((action) => (
              <li key={action.id}>
                <strong>{action.href ? <Link className="inline-link" href={action.href as Route}>{action.label}</Link> : action.label}</strong>
                <span>{action.reason}</span>
                <small>Review before apply</small>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="northstar-assistant-footer">
        <strong>Guardrails</strong>
        <span>{insight.guardrails.join(" · ")}</span>
      </div>
    </section>
  );
}

function confidenceLabel(confidence: NorthstarAssistantInsight["confidence"]) {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  return "Low confidence";
}

function severityClass(severity: NorthstarAssistantSeverity | undefined) {
  if (severity === "attention") return "northstar-assistant-status-attention";
  if (severity === "warning") return "northstar-assistant-status-warning";
  if (severity === "success") return "northstar-assistant-status-success";
  return "northstar-assistant-status-info";
}
