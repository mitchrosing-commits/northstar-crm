"use client";

import { useActionState } from "react";

import {
  previewDealImportAction,
  type DealImportPreviewActionState,
} from "@/app/settings/import-export/actions";
import {
  ImportColumnGuidance,
  ImportCsvInputGroup,
  ImportFormShell,
  ImportPreviewEmptyState,
  ImportPreviewIssues,
  ImportPreviewRowNotes,
  ImportPreviewStatusBadge,
  ImportPreviewSummary,
  ImportPreviewTable,
  isImportReady,
} from "./import-form-shared";

const initialState: DealImportPreviewActionState = {
  csvText: "",
};

export function DealImportForm() {
  const [state, formAction] = useActionState(
    previewDealImportAction,
    initialState,
  );
  const canImport = isImportReady(state.preview);

  return (
    <ImportFormShell
      action={formAction}
      canImport={canImport}
      error={state.error}
      importButtonLabel="Import valid deals"
      importPendingLabel="Importing..."
      preview={state.preview}
      previewButtonLabel="Preview deals"
      previewContent={
        state.preview ? <DealImportPreview state={state} /> : null
      }
      previewPendingLabel="Previewing..."
      recordLabel="deal"
      recordPluralLabel="deals"
      result={state.result}
    >
      <ImportCsvInputGroup
        defaultValue={state.csvText}
        id="dealCsv"
        label="Deals CSV"
        name="dealCsv"
        placeholder={
          "title,pipeline,stage,value,currency,status,contactEmail,organizationName\nExpansion deal,Sales,Qualified,1200.00,USD,OPEN,avery@example.test,Acme Corporation"
        }
        guidance={
          <ImportColumnGuidance
            customFieldNote="Deal custom field import is deferred, and custom fields or export-only columns are reported but not imported yet."
            lifecycleNote="Imported WON and LOST status does not set wonAt, lostAt, or lost reason, so imported won deals do not count toward Goals v1 until closed in-app."
            optionalColumns="status, value, currency, expectedCloseAt, contactEmail, contactName, organizationName, and ownerEmail"
            recordIntro="Deals preview and import."
            requiredColumns="title, pipeline, and stage"
            workspaceNote="Associations must already exist in this workspace; contacts, organizations, and leads are not auto-created."
          />
        }
      />
    </ImportFormShell>
  );
}

function DealImportPreview({ state }: { state: DealImportPreviewActionState }) {
  const preview = state.preview;
  if (!preview) return null;

  if (preview.parseErrors.length > 0) {
    return <ImportPreviewIssues errors={preview.parseErrors} />;
  }

  return (
    <div className="import-preview">
      <ImportPreviewSummary
        metrics={[
          { value: preview.totalRows, label: "total rows" },
          { value: preview.validRows, label: "valid" },
          { value: preview.duplicateRows, label: "duplicates to skip" },
          { value: preview.invalidRows, label: "invalid rows to skip" },
          {
            value: preview.unsupportedColumns.length,
            label: "unsupported columns",
          },
        ]}
        unsupportedColumns={preview.unsupportedColumns}
        unsupportedColumnsMessage="Ignored unsupported columns, not imported:"
      />
      {preview.rows.length > 0 ? (
        <ImportPreviewTable ariaLabel="Deals import preview table">
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Title</th>
                <th>Pipeline</th>
                <th>Stage</th>
                <th>Deal status</th>
                <th>Value</th>
                <th>Organization</th>
                <th>Import status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td data-label="Row">{row.rowNumber}</td>
                  <td data-label="Title">
                    <span className="table-primary-cell">
                      <strong>{row.title || "Missing"}</strong>
                    </span>
                  </td>
                  <td data-label="Pipeline">
                    {row.pipelineName || "Missing"}
                  </td>
                  <td data-label="Stage">{row.stageName || "Missing"}</td>
                  <td data-label="Deal status">{row.statusValue}</td>
                  <td data-label="Value">{row.value || "-"}</td>
                  <td data-label="Organization">
                    {row.organizationName || "-"}
                  </td>
                  <td data-label="Import status">
                    <ImportPreviewStatusBadge status={row.status} />
                  </td>
                  <td data-label="Notes">
                    <ImportPreviewRowNotes
                      skipReasons={row.skipReasons}
                      warnings={row.warnings}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ImportPreviewTable>
      ) : (
        <ImportPreviewEmptyState recordLabel="deal" />
      )}
    </div>
  );
}
