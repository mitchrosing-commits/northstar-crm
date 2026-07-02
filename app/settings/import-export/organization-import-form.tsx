"use client";

import { useActionState } from "react";

import {
  previewOrganizationImportAction,
  type OrganizationImportPreviewActionState,
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

const initialState: OrganizationImportPreviewActionState = {
  csvText: "",
};

export function OrganizationImportForm() {
  const [state, formAction] = useActionState(
    previewOrganizationImportAction,
    initialState,
  );
  const canImport = isImportReady(state.preview);

  return (
    <ImportFormShell
      action={formAction}
      canImport={canImport}
      error={state.error}
      importButtonLabel="Import valid organizations"
      importPendingLabel="Importing..."
      preview={state.preview}
      previewButtonLabel="Preview organizations"
      previewContent={
        state.preview ? <OrganizationImportPreview state={state} /> : null
      }
      previewPendingLabel="Previewing..."
      recordLabel="organization"
      recordPluralLabel="organizations"
      result={state.result}
    >
      <ImportCsvInputGroup
        defaultValue={state.csvText}
        id="organizationCsv"
        label="Organizations CSV"
        name="organizationCsv"
        placeholder={"name,domain\nAcme Corporation,acme.example"}
        guidance={
          <ImportColumnGuidance
            customFieldNote="Organization custom field columns and other export-only columns are reported but not imported yet."
            optionalColumns="domain and ownerEmail"
            recordIntro="Organizations preview and import."
            requiredColumns="name"
            requiredLabel="Required column"
            workspaceNote="Owner emails must already exist in this workspace."
          />
        }
      />
    </ImportFormShell>
  );
}

function OrganizationImportPreview({
  state,
}: {
  state: OrganizationImportPreviewActionState;
}) {
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
        <ImportPreviewTable ariaLabel="Organizations import preview table">
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Name</th>
                <th>Domain</th>
                <th>Import status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.rowNumber}>
                  <td data-label="Row">{row.rowNumber}</td>
                  <td data-label="Name">
                    <span className="table-primary-cell">
                      <strong>{row.name || "Missing"}</strong>
                    </span>
                  </td>
                  <td data-label="Domain">{row.domain || "-"}</td>
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
        <ImportPreviewEmptyState recordLabel="organization" />
      )}
    </div>
  );
}
