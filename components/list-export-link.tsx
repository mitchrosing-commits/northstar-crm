"use client";

import type { Route } from "next";
import { useId } from "react";

import { DownloadAction } from "@/components/download-action";
import {
  buildListExportHref,
  exportHelperText,
  hasExportScopeSearchParams,
  hasExportSortParams
} from "@/lib/list-export-href";
import type { ListSearchParams } from "@/lib/list-page-query";
import { listResourcePluralLabel } from "@/lib/list-resource-labels";
import type { ExportResource } from "@/lib/services/crm";

type ListExportLinkProps = {
  className?: string;
  label?: string;
  matchingCount?: number;
  resource: ExportResource;
  searchParams: ListSearchParams;
  workspaceId: string;
};

export function ListExportLink({
  className = "button-secondary",
  label = "Export CSV",
  matchingCount,
  resource,
  searchParams,
  workspaceId
}: ListExportLinkProps) {
  const generatedHelperId = useId();
  const hasExportScopeParams = hasExportScopeSearchParams(searchParams);
  const helperText = exportHelperText(resource, matchingCount, hasExportScopeParams, hasExportSortParams(searchParams));
  const helperId = `${generatedHelperId}-${resource}-export-helper`;
  const exportActionLabel = `${label} for ${listResourcePluralLabel(resource)}: ${helperText}`;
  return (
    <div className="list-export-action">
      <DownloadAction
        actionLabel={exportActionLabel}
        className={className}
        filename={`northstar-${resource}.csv`}
        helperId={helperId}
        href={buildListExportHref(workspaceId, resource, searchParams) as Route}
        label={label}
        pendingLabel="Preparing CSV..."
        preparedLabel="Export prepared"
      />
      <span className="list-export-helper" id={helperId}>
        {helperText}
      </span>
    </div>
  );
}
