import Link from "next/link";
import type { Route } from "next";

import { hideAssistantTodayCommandCenterItemAction } from "@/app/assistant/actions";
import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import type { AssistantTodayCommandCenter, AssistantTodayCommandCenterItem } from "@/lib/services/assistant/assistant-today-command-center-service";

type AssistantTodayCommandCenterProps = {
  commandCenter: AssistantTodayCommandCenter;
  status: string;
};

export function AssistantTodayCommandCenter({ commandCenter, status }: AssistantTodayCommandCenterProps) {
  return (
    <section className="data-card assistant-today-command-center" aria-labelledby="assistant-today-command-center-title">
      <PanelTitleRow
        actions={
          <>
            <Badge>{commandCenter.items.length} items</Badge>
            {commandCenter.hiddenCount > 0 ? <Badge>{commandCenter.hiddenCount} hidden</Badge> : null}
            <Badge>Review-first</Badge>
          </>
        }
        description={commandCenter.reviewFirstNotice}
        eyebrow="Today"
        title="Command Center"
        titleId="assistant-today-command-center-title"
      />
      {statusMessage(status) ? <p className={status === "hidden" ? "compact-success" : "compact-error"}>{statusMessage(status)}</p> : null}
      {commandCenter.hiddenCount > 0 ? (
        <div className="assistant-today-hidden-controls">
          <Link
            className={commandCenter.showHidden ? "button-primary button-compact" : "button-secondary button-compact"}
            href={(commandCenter.showHidden ? "/assistant#assistant-today-command-center-title" : "/assistant?today=hidden#assistant-today-command-center-title") as Route}
          >
            {commandCenter.showHidden ? "Hide hidden" : `Show hidden (${commandCenter.hiddenCount})`}
          </Link>
          <span>Hidden items return on the next local calendar day.</span>
        </div>
      ) : null}
      {commandCenter.items.length > 0 ? (
        <ol className="assistant-today-list" aria-label="Prioritized Assistant Command Center items">
          {commandCenter.items.map((item) => (
            <CommandCenterItem item={item} key={item.id} />
          ))}
        </ol>
      ) : (
        <div className="assistant-today-empty">
          <strong>{commandCenter.emptyState.title}</strong>
          <p>{commandCenter.emptyState.description}</p>
          <Link className="inline-link" href={"/activities" as Route}>
            Review activities
          </Link>
        </div>
      )}
      {commandCenter.showHidden && commandCenter.hiddenItems.length > 0 ? (
        <div className="assistant-today-hidden-section">
          <h3>Hidden today</h3>
          <ol className="assistant-today-list" aria-label="Hidden Assistant Command Center items">
            {commandCenter.hiddenItems.map((item) => (
              <CommandCenterItem hidden item={item} key={`hidden-${item.id}`} />
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function CommandCenterItem({ hidden = false, item }: { hidden?: boolean; item: AssistantTodayCommandCenterItem }) {
  return (
    <li className={hidden ? "assistant-today-item assistant-today-item-hidden" : "assistant-today-item"}>
      <div className="assistant-today-rank" aria-label={`Priority ${item.priority}`}>
        {priorityLabel(item.priority)}
      </div>
      <div className="assistant-today-copy">
        <div className="assistant-today-item-header">
          <span className="assistant-draft-eyebrow">{item.title}</span>
          <span className="assistant-draft-badges">
            <Badge>{item.recordType}</Badge>
            {hidden ? <Badge>Hidden today</Badge> : null}
          </span>
        </div>
        <h3>
          <Link className="inline-link" href={item.href as Route}>
            {item.recordLabel}
          </Link>
        </h3>
        <p>{item.reason}</p>
        <p>{item.safeNextAction}</p>
        <details className="assistant-today-explanation">
          <summary>Why this is here</summary>
          <div className="assistant-today-explanation-panel">
            <div>
              <span>Rule</span>
              <p>{item.explanation.rule}</p>
            </div>
            <div>
              <span>Threshold</span>
              <p>{item.explanation.threshold}</p>
            </div>
            <div>
              <span>Calculation</span>
              <p>{item.explanation.calculation}</p>
            </div>
            <div>
              <span>Result</span>
              <p>{item.explanation.result}</p>
            </div>
            <div>
              <span>Source record</span>
              <p>{`${item.explanation.sourceRecord.label}${item.explanation.sourceRecord.lastUpdatedAt ? ` · Last updated ${formatDateTime(item.explanation.sourceRecord.lastUpdatedAt)}` : ""}`}</p>
            </div>
            <div className="assistant-today-explanation-values">
              <span>Stored values</span>
              <dl>
                {item.explanation.storedValues.map((row) => (
                  <div key={`${item.itemKey}-${row.label}`}>
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </details>
        <div className="assistant-today-actions">
          <Link className="button-secondary button-compact" href={item.href as Route}>
            Open {item.recordType.toLowerCase()}
          </Link>
          {item.draftHref ? (
            <Link className="button-secondary button-compact" href={item.draftHref as Route}>
              Draft follow-up
            </Link>
          ) : null}
          {!hidden ? (
            <form action={hideAssistantTodayCommandCenterItemAction}>
              <input name="itemKey" type="hidden" value={item.itemKey} />
              <button className="button-secondary button-compact" type="submit">
                Hide for today
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function statusMessage(status: string) {
  if (status === "hidden") return "Command Center item hidden for today.";
  if (status === "hide-error") return "That Command Center item could not be hidden. Refresh and try again.";
  return "";
}

function priorityLabel(priority: number) {
  if (priority < 20) return "P1";
  if (priority < 40) return "P2";
  if (priority < 70) return "P3";
  return "P4";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric"
  }).format(new Date(value));
}
