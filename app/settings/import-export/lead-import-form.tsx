"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  previewLeadImportAction,
  type LeadImportPreviewActionState
} from "@/app/settings/import-export/actions";

const initialState: LeadImportPreviewActionState = {
  csvText: ""
};

export function LeadImportForm() {
  const [state, formAction] = useActionState(previewLeadImportAction, initialState);

  return (
    <form action={formAction} className="import-form">
      <label className="form-label" htmlFor="leadCsv">
        Leads CSV
      </label>
      <textarea
        className="import-textarea"
        id="leadCsv"
        name="leadCsv"
        rows={8}
        defaultValue={state.csvText}
        placeholder={"title,source,status,organizationName\nExpansion opportunity,Web,NEW,Acme Corporation"}
      />
      <p className="empty-copy">
        Leads preview and import. Required column: title or name. Optional columns: source, status, and organizationName.
        Status must be NEW, QUALIFIED, or DISQUALIFIED; CONVERTED is not imported.
      </p>
      <div className="import-actions">
        <SubmitButton intent="preview" label="Preview leads" pendingLabel="Previewing..." />
        {state.preview && state.preview.parseErrors.length === 0 && state.preview.validRows > 0 ? (
          <SubmitButton intent="import" label="Import valid leads" pendingLabel="Importing..." />
        ) : null}
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.result ? <LeadImportResultSummary result={state.result} /> : null}
      {state.preview ? <LeadImportPreview state={state} /> : null}
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

function LeadImportResultSummary({
  result
}: {
  result: NonNullable<LeadImportPreviewActionState["result"]>;
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

function LeadImportPreview({ state }: { state: LeadImportPreviewActionState }) {
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
            <th>Title</th>
            <th>Source</th>
            <th>Status</th>
            <th>Organization</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.title || "Missing"}</td>
              <td>{row.source || "-"}</td>
              <td>{row.statusValue || "-"}</td>
              <td>{row.organizationName || "-"}</td>
              <td>{row.skipReasons.length > 0 ? row.skipReasons.join(" ") : row.warnings.join(" ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.rows.length === 0 ? <p className="empty-copy">No lead rows found.</p> : null}
    </div>
  );
}
