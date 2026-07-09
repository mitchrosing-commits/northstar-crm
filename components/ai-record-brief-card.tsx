import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AiRecordBrief, AiRecordBriefAction, AiRecordBriefFact, AiRecordBriefSourceRef } from "@/lib/services/ai-record-brief-service";

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
      {brief.keyFacts.length > 0 ? (
        <BriefItemList items={brief.keyFacts} title="Grounded facts" />
      ) : null}
      {brief.risks.length > 0 ? (
        <BriefItemList items={brief.risks} title="Risks to review" />
      ) : null}
      {brief.nextActions.length > 0 ? (
        <BriefItemList items={brief.nextActions} title="Suggested review actions" />
      ) : null}
      {brief.sourcesUsed.length > 0 ? (
        <p className="ai-record-brief-footnote">Sources used: {brief.sourcesUsed.join(" · ")}</p>
      ) : null}
      {brief.missingContext.length > 0 ? (
        <p className="ai-record-brief-footnote">Missing context: {brief.missingContext.join(" · ")}</p>
      ) : null}
      {brief.omittedOrNeedsReview.length > 0 ? (
        <p className="ai-record-brief-footnote">Needs review: {brief.omittedOrNeedsReview.join(" · ")}</p>
      ) : null}
      {brief.missingOrStale.length > 0 ? (
        <p className="ai-record-brief-footnote">Review focus: {brief.missingOrStale.join(" · ")}</p>
      ) : null}
    </section>
  );
}

function BriefItemList({ items, title }: { items: Array<AiRecordBriefAction | AiRecordBriefFact>; title: string }) {
  return (
    <div className="ai-record-brief-section">
      <strong>{title}</strong>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.source}-${item.label}-${index}`}>
            <span>{item.label}</span>
            <small>
              {item.source}: {item.value}
              {item.sourceRef ? <BriefSourceRef sourceRef={item.sourceRef} /> : null}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BriefSourceRef({ sourceRef }: { sourceRef: AiRecordBriefSourceRef }) {
  return (
    <span className="ai-record-brief-source-ref" title={sourceRef.excerpt}>
      {" Source: "}
      {sourceRef.href ? (
        <a className="inline-link" href={sourceRef.href}>
          {sourceRef.label}
        </a>
      ) : (
        <span>{sourceRef.label}</span>
      )}
      {sourceRef.occurredAt ? <span> - {sourceRef.occurredAt.slice(0, 10)}</span> : null}
      {sourceRef.detail ? <span> - {sourceRef.detail}</span> : null}
      {sourceRef.warning ? <span> - {sourceRef.warning}</span> : null}
    </span>
  );
}

function healthLabel(status: AiRecordBrief["health"]["status"]) {
  if (status === "attention") return "Needs review";
  if (status === "stale") return "Stale risk";
  if (status === "watch") return "Watch";
  return "Clean";
}
