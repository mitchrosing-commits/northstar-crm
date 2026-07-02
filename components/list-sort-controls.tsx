import { FormFieldLabel } from "@/components/form-field-label";
import type { SortDirection } from "@/lib/list-page-query";

export type ListSortOption<TSortBy extends string = string> = {
  label: string;
  value: TSortBy;
};

type ListSortControlsProps<TSortBy extends string = string> = {
  direction?: SortDirection;
  directionOptions?: SortDirection[];
  options: Array<ListSortOption<TSortBy>>;
  sortBy?: TSortBy;
};

const sortBySelectLabel = "Choose list sort field";
const sortDirectionSelectLabel = "Choose list sort direction";

export function ListSortControls<TSortBy extends string = string>({
  direction = "desc",
  directionOptions = ["desc", "asc"],
  options,
  sortBy
}: ListSortControlsProps<TSortBy>) {
  return (
    <>
      <label className="form-field">
        <FormFieldLabel>Sort by</FormFieldLabel>
        <select
          aria-label={sortBySelectLabel}
          defaultValue={sortBy ?? options[0]?.value ?? ""}
          name="sortBy"
          title={sortBySelectLabel}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <FormFieldLabel>Direction</FormFieldLabel>
        <select
          aria-label={sortDirectionSelectLabel}
          defaultValue={direction}
          name="sortDirection"
          title={sortDirectionSelectLabel}
        >
          {directionOptions.map((option) => (
            <option key={option} value={option}>
              {sortDirectionLabel(option)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function sortDirectionLabel(direction: SortDirection) {
  return direction === "asc" ? "Ascending (A-Z, oldest, low to high)" : "Descending (Z-A, newest, high to low)";
}
