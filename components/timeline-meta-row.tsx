import type { ReactNode } from "react";

type TimelineMetaRowProps = {
  ariaLabel?: string;
  className?: string;
  items: Array<ReactNode | null | undefined | false>;
};

export function TimelineMetaRow({ ariaLabel = "Timeline metadata", className, items }: TimelineMetaRowProps) {
  const visibleItems = items.map(normalizeTimelineMetaItem).filter(isVisibleMetaItem);
  if (visibleItems.length === 0) return null;

  return (
    <div aria-label={ariaLabel} className={["timeline-meta", className].filter(Boolean).join(" ")} role="list">
      {visibleItems.map((item, index) => (
        <span className="timeline-meta-chip" key={index} role="listitem" title={timelineMetaItemTitle(item)}>
          {item}
        </span>
      ))}
    </div>
  );
}

function normalizeTimelineMetaItem(item: ReactNode | null | undefined | false) {
  return typeof item === "string" ? item.trim() : item;
}

function isVisibleMetaItem(item: ReactNode | null | undefined | false) {
  return item !== null && item !== undefined && item !== false && item !== "";
}

function timelineMetaItemTitle(item: ReactNode | null | undefined | false) {
  return typeof item === "string" || typeof item === "number" ? String(item) : undefined;
}
