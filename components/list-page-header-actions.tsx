import type { Route } from "next";
import Link from "next/link";

import { ActionGroup } from "@/components/action-group";
import { ListExportLink } from "@/components/list-export-link";
import type { ListSearchParams } from "@/lib/list-page-query";
import {
  listResourceCreateActionLabel,
  listResourceSingularLabel,
} from "@/lib/list-resource-labels";
import type { ExportResource } from "@/lib/services/crm";

type ListPageHeaderActionsProps = {
  createHref: Route;
  createLabel: string;
  importHref?: Route;
  importLabel?: string;
  matchingCount?: number;
  resource: ExportResource;
  searchParams: ListSearchParams;
  workspaceId: string;
};

export function ListPageHeaderActions({
  createHref,
  createLabel,
  importHref,
  importLabel = "Import CSV",
  matchingCount,
  resource,
  searchParams,
  workspaceId,
}: ListPageHeaderActionsProps) {
  const listActionsLabel = `${listResourceSingularLabel(resource)} list actions`;
  const createActionLabel = listResourceCreateActionLabel(resource, createLabel);
  const importActionLabel = importHref
    ? `${importLabel}: preview ${listResourceSingularLabel(resource)} CSV import`
    : undefined;

  return (
    <ActionGroup className="list-page-header-actions" label={listActionsLabel}>
      <Link
        aria-label={createActionLabel}
        className="button-primary"
        href={createHref}
        title={createActionLabel}
      >
        {createLabel}
      </Link>
      {importHref ? (
        <Link
          aria-label={importActionLabel}
          className="button-secondary"
          href={importHref}
          title={importActionLabel}
        >
          {importLabel}
        </Link>
      ) : null}
      <ListExportLink
        matchingCount={matchingCount}
        resource={resource}
        searchParams={searchParams}
        workspaceId={workspaceId}
      />
    </ActionGroup>
  );
}
