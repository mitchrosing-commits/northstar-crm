import Link from "next/link";
import type { Route } from "next";

import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { CrmAiInsight } from "@/lib/services/crm-ai-insight-service";

type CrmAiInsightCardProps = {
  eyebrow?: string;
  insight: CrmAiInsight;
};

export function CrmAiInsightCard({ eyebrow = "Northstar Assistant", insight }: CrmAiInsightCardProps) {
  return (
    <section aria-label={insight.title} className="data-card crm-ai-insight-card">
      <PanelTitleRow
        actions={
          <>
            <Badge>Review-first</Badge>
            <Badge>{insight.confidence === "high" ? "High confidence" : "Deterministic"}</Badge>
          </>
        }
        description="Suggestions are review-first. Northstar does not apply CRM changes automatically."
        eyebrow={eyebrow}
        title={insight.title}
      />
      <p className="crm-ai-insight-summary">{insight.summary}</p>
      <ul className="crm-ai-insight-list">
        {insight.items.map((item) => (
          <li className={`crm-ai-insight-item crm-ai-insight-item-${item.tone}`} key={`${item.title}-${item.detail}`}>
            <span aria-hidden className={`crm-ai-insight-marker crm-ai-insight-marker-${item.tone}`} />
            <span className="crm-ai-insight-copy">
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
      <div className="crm-ai-insight-footer">
        <strong>Reviewed</strong>
        <span>{insight.sourceBasis.join(" · ")}</span>
      </div>
    </section>
  );
}
