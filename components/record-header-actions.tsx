import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";

type RecordHeaderActionsProps = {
  addHref?: Route;
  addLockedLabel?: string;
  addLabel?: string;
  backHref: Route;
  backLabel: string;
  customFieldsHref?: Route;
  customFieldsLabel?: string;
  editHref?: Route;
  editLabel?: string;
  leadingActions?: ReactNode;
  locked?: boolean;
  lockedLabel?: string;
  noteHref?: Route;
  noteLockedLabel?: string;
  noteLabel?: string;
  recordTitle?: string;
};

export function RecordHeaderActions({
  addHref,
  addLockedLabel = "Follow-up locked",
  addLabel = "Add follow-up",
  backHref,
  backLabel,
  customFieldsHref,
  customFieldsLabel = "Custom fields",
  editHref,
  editLabel = "Edit record",
  leadingActions,
  locked = false,
  lockedLabel = "Editing locked",
  noteHref,
  noteLockedLabel = "Notes locked",
  noteLabel = "Add note",
  recordTitle
}: RecordHeaderActionsProps) {
  const addActionLabel = recordActionLabel(addLabel, recordTitle);
  const noteActionLabel = recordActionLabel(noteLabel, recordTitle);
  const customFieldsActionLabel = recordActionLabel(customFieldsLabel, recordTitle);
  const backActionLabel = recordBackActionLabel(backLabel);
  const editActionLabel = recordActionLabel(editLabel, recordTitle);
  const addLockedActionLabel = lockedRecordActionLabel(addLockedLabel, lockedLabel, recordTitle);
  const noteLockedActionLabel = lockedRecordActionLabel(noteLockedLabel, lockedLabel, recordTitle);
  const editLockedActionLabel = lockedRecordActionLabel(editLabel, lockedLabel, recordTitle);
  const actionsLabel = recordTitle?.trim() ? `${recordTitle.trim()} workspace actions` : "Record workspace actions";

  return (
    <ActionGroup className="record-header-actions" label={actionsLabel}>
      {leadingActions}
      {addHref && locked ? (
        <button aria-label={addLockedActionLabel} className="button-secondary" disabled title={addLockedActionLabel} type="button">
          {addLockedLabel}
        </button>
      ) : addHref ? (
        <Link aria-label={addActionLabel} className="button-secondary" href={addHref} title={addActionLabel}>
          {addLabel}
        </Link>
      ) : null}
      {noteHref && locked ? (
        <button aria-label={noteLockedActionLabel} className="button-secondary" disabled title={noteLockedActionLabel} type="button">
          {noteLockedLabel}
        </button>
      ) : noteHref ? (
        <Link aria-label={noteActionLabel} className="button-secondary" href={noteHref} title={noteActionLabel}>
          {noteLabel}
        </Link>
      ) : null}
      {customFieldsHref ? (
        <Link aria-label={customFieldsActionLabel} className="button-secondary" href={customFieldsHref} title={customFieldsActionLabel}>
          {customFieldsLabel}
        </Link>
      ) : null}
      <Link aria-label={backActionLabel} className="button-secondary" href={backHref} title={backActionLabel}>
        {backLabel}
      </Link>
      {locked ? (
        <button aria-label={editLockedActionLabel} className="button-secondary" disabled title={editLockedActionLabel} type="button">
          {lockedLabel}
        </button>
      ) : editHref ? (
        <Link aria-label={editActionLabel} className="button-primary" href={editHref} title={editActionLabel}>
          {editLabel}
        </Link>
      ) : null}
    </ActionGroup>
  );
}

function recordActionLabel(label: string, recordTitle?: string) {
  const trimmedTitle = recordTitle?.trim();

  return trimmedTitle ? `${label}: ${trimmedTitle}` : `Record action: ${label}`;
}

function lockedRecordActionLabel(label: string, lockedLabel: string, recordTitle?: string) {
  const actionLabel = recordActionLabel(label, recordTitle);

  return `${actionLabel}: ${lockedLabel}`;
}

function recordBackActionLabel(label: string) {
  const trimmedLabel = label.trim();

  return /^back\b/i.test(trimmedLabel) ? trimmedLabel : `Back to ${trimmedLabel}`;
}
