import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AiRecordBrief } from "@/lib/services/ai-record-brief-service";

type AiRecordBriefCardProps = {
  brief: AiRecordBrief;
};

export function AiRecordBriefCard({ brief }: AiRecordBriefCardProps) {
  return (
    <section aria-label="AI record brief" className="data-card ai-record-brief-card" id="ai-record-brief">
      <PanelTitleRow
        actions={
          <>
            <Badge>{healthLabel(brief.health.status)}</Badge>
            <Badge>Review-first</Badge>
          </>
        }
        description="A compact brief from workspace-scoped CRM context. Northstar does not apply changes automatically."
        eyebrow="AI brief"
        title={brief.recordLabel}
      />
      <div className="ai-record-brief-grid">
        <div>
          <strong>Snapshot</strong>
          <span>{brief.about}</span>
        </div>
        <div>
          <strong>Health</strong>
          <span>{brief.health.summary}</span>
        </div>
        <div>
          <strong>What changed</strong>
          <span>{brief.whatChanged.join(" · ")}</span>
        </div>
        <div>
          <strong>Next review</strong>
          <span>{brief.nextBestReview}</span>
        </div>
      </div>
      {brief.missingOrStale.length > 0 ? (
        <p className="ai-record-brief-footnote">Review focus: {brief.missingOrStale.join(" · ")}</p>
      ) : null}
    </section>
  );
}

function healthLabel(status: AiRecordBrief["health"]["status"]) {
  if (status === "attention") return "Needs review";
  if (status === "stale") return "Stale risk";
  if (status === "watch") return "Watch";
  return "Clean";
}
