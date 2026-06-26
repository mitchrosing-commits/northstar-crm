"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  previewOrganizationImportAction,
  type OrganizationImportPreviewActionState
} from "@/app/settings/import-export/actions";

const initialState: OrganizationImportPreviewActionState = {
  csvText: ""
};

export function OrganizationImportForm() {
  const [state, formAction] = useActionState(previewOrganizationImportAction, initialState);

  return (
    <form action={formAction} className="import-form">
      <label className="form-label" htmlFor="organizationCsv">
        Organizations CSV
      </label>
      <textarea
        className="import-textarea"
        id="organizationCsv"
        name="organizationCsv"
        rows={8}
        defaultValue={state.csvText}
        placeholder={"name,domain\nAcme Corporation,acme.example"}
      />
      <p className="empty-copy">
        Organizations preview and import. Required column: name. Optional column: domain. Custom field columns and other
        export-only columns are reported but not imported yet.
      </p>
      <div className="import-actions">
        <SubmitButton intent="preview" label="Preview organizations" pendingLabel="Previewing..." />
        {state.preview && state.preview.parseErrors.length === 0 && state.preview.validRows > 0 ? (
          <SubmitButton intent="import" label="Import valid organizations" pendingLabel="Importing..." />
        ) : null}
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.result ? <OrganizationImportResultSummary result={state.result} /> : null}
      {state.preview ? <OrganizationImportPreview state={state} /> : null}
    </form>
  );
}

function SubmitButton({ intent, label, pendingLabel }: { intent: string; label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button className={intent === "import" ? "button-secondary" : "button-primary"} type="submit" name="intent" value={intent} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function OrganizationImportResultSummary({
  result
}: {
  result: NonNullable<OrganizationImportPreviewActionState["result"]>;
}) {
  return (
    <div className="import-preview">
      <h3>Import results</h3>
      <div className="import-summary">
        <span>{result.createdCount} created</span>
        <span>{result.skippedDuplicateCount} duplicates skipped</span>
        <span>{result.skippedInvalidCount} invalid rows skipped</span>
        <span>{result.errorCount} errors</span>
      </div>
    </div>
  );
}

function OrganizationImportPreview({ state }: { state: OrganizationImportPreviewActionState }) {
  const preview = state.preview;
  if (!preview) return null;

  if (preview.parseErrors.length > 0) {
    return (
      <div className="import-preview">
        <h3>Preview issues</h3>
        <ul className="import-message-list">
          {preview.parseErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="import-preview">
      <h3>Preview results</h3>
      <div className="import-summary">
        <span>{preview.validRows} valid</span>
        <span>{preview.duplicateRows} duplicates to skip</span>
        <span>{preview.invalidRows} invalid rows to skip</span>
      </div>
      {preview.unsupportedColumns.length > 0 ? (
        <p className="empty-copy">Ignored columns: {preview.unsupportedColumns.join(", ")}</p>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Name</th>
            <th>Domain</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.name || "Missing"}</td>
              <td>{row.domain || "-"}</td>
              <td>
                <span className="badge">{row.status}</span>
              </td>
              <td>{row.skipReasons.length > 0 ? row.skipReasons.join(" ") : row.warnings.join(" ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.rows.length === 0 ? <p className="empty-copy">No organization rows found.</p> : null}
    </div>
  );
}
