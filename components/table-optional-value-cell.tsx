import { InlineEmptyStateText } from "@/components/inline-empty-state-text";

type TableOptionalValueCellProps = {
  value?: string | null;
  emptyLabel?: string;
};

export function TableOptionalValueCell({ value, emptyLabel = "Not set" }: TableOptionalValueCellProps) {
  const label = value?.trim();

  if (!label) {
    return <InlineEmptyStateText>{emptyLabel}</InlineEmptyStateText>;
  }

  return <span>{label}</span>;
}
