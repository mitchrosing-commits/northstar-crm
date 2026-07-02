import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { ActionGroup } from "@/components/action-group";
import { PanelTitleRow } from "@/components/panel-title-row";

type FormRelatedRecordCalloutProps = {
  children: ReactNode;
  showContactAction?: boolean;
  showImportContactsAction?: boolean;
  showOrganizationAction?: boolean;
  title: string;
};

export function FormRelatedRecordCallout({
  children,
  showContactAction = false,
  showImportContactsAction = false,
  showOrganizationAction = false,
  title
}: FormRelatedRecordCalloutProps) {
  const actionsLabel = "Related record setup actions";

  return (
    <div className="data-card form-related-callout">
      <PanelTitleRow title={title} />
      <p className="empty-copy form-callout-copy">{children}</p>
      <ActionGroup className="filter-actions" label={actionsLabel}>
        {showContactAction ? (
          <Link
            aria-label="Create a contact for this related record setup"
            className="button-secondary button-compact"
            href={"/contacts/new" as Route}
            title="Create a contact for this related record setup"
          >
            Add a contact
          </Link>
        ) : null}
        {showOrganizationAction ? (
          <Link
            aria-label="Create an organization for this related record setup"
            className="button-secondary button-compact"
            href={"/organizations/new" as Route}
            title="Create an organization for this related record setup"
          >
            Add an organization
          </Link>
        ) : null}
        {showImportContactsAction ? (
          <Link
            aria-label="Open import and export settings for contact setup"
            className="button-secondary button-compact"
            href={"/settings/import-export" as Route}
            title="Open import and export settings for contact setup"
          >
            Import contacts
          </Link>
        ) : null}
      </ActionGroup>
    </div>
  );
}
