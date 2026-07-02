import { InlineEmptyStateText } from "@/components/inline-empty-state-text";

type TableOwner = {
  name?: string | null;
  email?: string | null;
} | null;

type TableOwnerCellProps = {
  owner?: TableOwner;
  emptyLabel?: string;
};

export function TableOwnerCell({ owner, emptyLabel = "Unassigned" }: TableOwnerCellProps) {
  const label = owner?.name ?? owner?.email;

  if (!label) {
    return <InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>;
  }

  return <span>{label}</span>;
}
