export type RecordActivityCopyKind = "dealOpen" | "dealCompleted" | "contact" | "organization" | "lead";

export type RecordActivitySectionCopy = {
  description: string;
  emptyMessage: string;
  title: string;
};

const recordActivityCopy = {
  dealOpen: {
    description: "Open follow-ups attached to this deal, sorted into the record workspace.",
    emptyMessage: "No open activities are attached to this deal.",
    title: "Open Next Steps"
  },
  dealCompleted: {
    description: "Completed follow-ups stay visible for customer history and handoffs.",
    emptyMessage: "Completed activities will appear here.",
    title: "Completed Activity History"
  },
  contact: {
    description: "Open and completed follow-ups linked to this contact.",
    emptyMessage: "No activities are linked to this contact.",
    title: "Activities"
  },
  organization: {
    description: "Open and completed follow-ups linked to this organization.",
    emptyMessage: "No activities are linked to this organization.",
    title: "Activities"
  },
  lead: {
    description: "Open and completed follow-ups linked to this lead.",
    emptyMessage: "No activities are linked to this lead.",
    title: "Activities"
  }
} as const satisfies Record<RecordActivityCopyKind, RecordActivitySectionCopy>;

export function recordActivitySectionCopy(kind: RecordActivityCopyKind) {
  return recordActivityCopy[kind];
}
