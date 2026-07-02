"use client";

import { ActionGroup } from "@/components/action-group";

type ActivityDueDateShortcutsProps = {
  onSelect: (value: string) => void;
};

export function ActivityDueDateShortcuts({ onSelect }: ActivityDueDateShortcutsProps) {
  const shortcutGroupLabel = "Due date shortcuts";
  const shortcuts = [
    { label: "Today", value: formatDateInputOffset(0) },
    { label: "Tomorrow", value: formatDateInputOffset(1) },
    { label: "Next week", value: formatDateInputOffset(7) }
  ];

  return (
    <ActionGroup className="filter-actions due-shortcuts" label={shortcutGroupLabel}>
      {shortcuts.map((shortcut) => (
        <button
          aria-label={`Set due date to ${shortcut.label.toLowerCase()}`}
          className="button-secondary button-compact"
          key={shortcut.label}
          onClick={() => onSelect(shortcut.value)}
          title={`Set due date to ${shortcut.label.toLowerCase()}`}
          type="button"
        >
          {shortcut.label}
        </button>
      ))}
    </ActionGroup>
  );
}

function formatDateInputOffset(daysFromNow: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}
