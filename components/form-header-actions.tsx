import type { Route } from "next";
import Link from "next/link";

type FormHeaderActionsProps = {
  backHref: Route;
  backLabel: string;
  showCustomFieldsLink?: boolean;
};

export function FormHeaderActions({ backHref, backLabel, showCustomFieldsLink = false }: FormHeaderActionsProps) {
  return (
    <>
      {showCustomFieldsLink ? (
        <Link
          aria-label="Jump to custom fields in this form"
          className="button-secondary"
          href={"#custom-fields" as Route}
          title="Jump to custom fields"
        >
          Custom fields
        </Link>
      ) : null}
      <Link aria-label={backLabel} className="button-secondary" href={backHref} title={backLabel}>
        {backLabel}
      </Link>
    </>
  );
}
