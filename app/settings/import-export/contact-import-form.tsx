"use client";

import { useActionState } from "react";

import {
  previewContactImportAction,
  type ContactImportPreviewActionState,
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

const initialState: ContactImportPreviewActionState = {
  csvText: "",
};

export function ContactImportForm() {
  const [state, formAction] = useActionState(
    previewContactImportAction,
    initialState,
  );
  const canImport = isImportReady(state.preview);

  return (
    <ImportFormShell
      action={formAction}
      canImport={canImport}
      error={state.error}
      importButtonLabel="Import valid contacts"
      importPendingLabel="Importing..."
      preview={state.preview}
      previewButtonLabel="Preview contacts"
      previewContent={
        state.preview ? <ContactImportPreview state={state} /> : null
      }
      previewPendingLabel="Previewing..."
      recordLabel="contact"
      recordPluralLabel="contacts"
      result={state.result}
    >
      <ImportCsvInputGroup
        defaultValue={state.csvText}
        id="contactCsv"
        label="Contacts CSV"
        name="contactCsv"
        placeholder={
          "name,email,phone,organizationName\nAvery Stone,avery@example.test,555-0100,Acme Corporation"
        }
        guidance={
          <ImportColumnGuidance
            customFieldNote="Contact custom field import is deferred, and custom fields or export-only columns are reported but not imported yet."
            optionalColumns="lastName, email, phone, and organizationName, plus ownerEmail"
            recordIntro="Contacts preview and import."
            requiredColumns="name or firstName"
            requiredLabel="Required column"
            workspaceNote="Organization names and owner emails must already exist in this workspace; contacts are only created after import."
          />
        }
      />
    </ImportFormShell>
  );
}

function ContactImportPreview({
  state,
}: {
  state: ContactImportPreviewActionState;
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
        <ImportPreviewTable ariaLabel="Contacts import preview table">
          <table className="table crm-list-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Name</th>
                <th>Email</th>
                <th>Organization</th>
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
                  <td data-label="Email">{row.email || "-"}</td>
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
        <ImportPreviewEmptyState recordLabel="contact" />
      )}
    </div>
  );
}
