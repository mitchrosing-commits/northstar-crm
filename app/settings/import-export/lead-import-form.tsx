"use client";

import { useActionState } from "react";

import {
  previewLeadImportAction,
  type LeadImportPreviewActionState,
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

const initialState: LeadImportPreviewActionState = {
  csvText: "",
};

export function LeadImportForm() {
  const [state, formAction] = useActionState(
    previewLeadImportAction,
    initialState,
  );
  const canImport = isImportReady(state.preview);

  return (
    <ImportFormShell
      action={formAction}
      canImport={canImport}
      error={state.error}
      importButtonLabel="Import valid leads"
      importPendingLabel="Importing..."
      preview={state.preview}
      previewButtonLabel="Preview leads"
      previewContent={
        state.preview ? <LeadImportPreview state={state} /> : null
      }
      previewPendingLabel="Previewing..."
      recordLabel="lead"
      recordPluralLabel="leads"
      result={state.result}
    >
      <ImportCsvInputGroup
        defaultValue={state.csvText}
        id="leadCsv"
        label="Leads CSV"
        name="leadCsv"
        placeholder={
          "title,source,status,organizationName\nExpansion opportunity,Web,NEW,Acme Corporation"
        }
        guidance={
          <ImportColumnGuidance
            customFieldNote="Lead custom field import is deferred."
            lifecycleNote="Status must be NEW, QUALIFIED, or DISQUALIFIED; CONVERTED is not imported."
            optionalColumns="source, status, contactEmail, contactName, organizationName, and ownerEmail"
            recordIntro="Leads preview and import."
            requiredColumns="title or name"
            requiredLabel="Required column"
            workspaceNote="Referenced contacts, organizations, and owners must already exist in this workspace."
          />
        }
      />
    </ImportFormShell>
  );
}

function LeadImportPreview({ state }: { state: LeadImportPreviewActionState }) {
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
        <ImportPreviewTable ariaLabel="Leads import preview table">
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Title</th>
                <th>Source</th>
                <th>Lead status</th>
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
                  <td data-label="Source">{row.source || "-"}</td>
                  <td data-label="Lead status">{row.statusValue || "-"}</td>
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
        <ImportPreviewEmptyState recordLabel="lead" />
      )}
    </div>
  );
}
