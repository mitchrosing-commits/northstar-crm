import Link from "next/link";
import type { Route } from "next";

export type RecordPanelJump = {
  count?: number | string;
  countKey?: keyof RecordPanelJumpCounts;
  countLabel?: RecordPanelJumpCountLabel;
  href: Route;
  label: string;
};

export type RecordPanelJumpCountLabel = {
  plural: string;
  singular: string;
};

export type RecordPanelJumpCounts = {
  activities?: number;
  auditHistory?: number;
  customFields?: number;
  emailLog?: number;
  linkedDeals?: number;
  linkedPeople?: number;
  notes?: number;
  quotes?: number;
  timeline?: number;
};

const defaultPanelJumps: RecordPanelJump[] = [
  { href: "#activities" as Route, label: "Activities", countKey: "activities", countLabel: countLabel("activity", "activities") },
  { href: "#notes" as Route, label: "Notes", countKey: "notes", countLabel: countLabel("note", "notes") },
  { href: "#custom-fields" as Route, label: "Custom fields", countKey: "customFields", countLabel: countLabel("custom field", "custom fields") },
  { href: "#email-log" as Route, label: "Email", countKey: "emailLog", countLabel: countLabel("email log", "email logs") },
  { href: "#timeline" as Route, label: "Timeline", countKey: "timeline", countLabel: countLabel("timeline event", "timeline events") },
  { href: "#audit-history" as Route, label: "Audit", countKey: "auditHistory", countLabel: countLabel("audit event", "audit events") }
];

type RecordPanelJumpNavProps = {
  ariaLabel?: string;
  counts?: RecordPanelJumpCounts;
  extraJumps?: RecordPanelJump[];
  jumps?: RecordPanelJump[];
  label?: string;
};

export function RecordPanelJumpNav({
  ariaLabel = "Record workspace panels",
  counts = {},
  extraJumps = [],
  jumps,
  label = "Workspace"
}: RecordPanelJumpNavProps) {
  const panelJumps = jumps ?? [...defaultPanelJumps, ...extraJumps];

  return (
    <nav aria-label={ariaLabel} className="record-panel-jump-nav">
      <span className="record-panel-jump-label">{label}</span>
      <ul className="record-panel-jump-list">
        {panelJumps.map((jump) => {
          const count = jump.count ?? (jump.countKey ? counts[jump.countKey] : undefined);
          const jumpLabel = formatJumpAriaLabel(jump.label, count, jump.countLabel);
          const linkClassName = [
            "button-secondary",
            "button-compact",
            "record-panel-jump-link",
            count === 0 ? "record-panel-jump-link-muted" : null
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li className="record-panel-jump-item" key={jump.href}>
              <Link
                aria-label={jumpLabel}
                className={linkClassName}
                href={jump.href}
                title={jumpLabel}
              >
                <span>{jump.label}</span>
                {typeof count !== "undefined" ? (
                  <span aria-hidden="true" className="record-panel-jump-count">
                    {count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function countLabel(singular: string, plural: string): RecordPanelJumpCountLabel {
  return { singular, plural };
}

function formatJumpAriaLabel(
  label: string,
  count: number | string | undefined,
  itemLabel: RecordPanelJumpCountLabel = countLabel("item", "items")
) {
  if (typeof count === "undefined") return label;
  if (typeof count === "number") return `${label}: ${count} ${count === 1 ? itemLabel.singular : itemLabel.plural}`;
  return `${label}: ${count}`;
}
