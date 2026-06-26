"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  previewDealImportAction,
  type DealImportPreviewActionState
} from "@/app/settings/import-export/actions";

const initialState: DealImportPreviewActionState = {
  csvText: ""
};

export function DealImportForm() {
  const [state, formAction] = useActionState(previewDealImportAction, initialState);

  return (
    <form action={formAction} className="import-form">
      <label className="form-label" htmlFor="dealCsv">
        Deals CSV
      </label>
      <textarea
        className="import-textarea"
        id="dealCsv"
        name="dealCsv"
        rows={8}
        defaultValue={state.csvText}
        placeholder={"title,pipeline,stage,value,currency,status,contactEmail,organizationName\nExpansion deal,Sales,Qualified,1200.00,USD,OPEN,avery@example.test,Acme Corporation"}
      />
      <p className="empty-copy">
        Deals preview and import. Required columns: title, pipeline, and stage. Optional columns: status, value, currency,
        expectedCloseAt, contactEmail, contactName, organizationName, and ownerEmail. Associations must already exist in
        this workspace; contacts, organizations, and leads are not auto-created. Deal custom field import is deferred, and
        custom fields or export-only columns are reported but not imported yet. Imported WON and LOST status does not set
        wonAt, lostAt, or lost reason, so imported won deals do not count toward Goals v1 until closed in-app.
      </p>
      <div className="import-actions">
        <SubmitButton intent="preview" label="Preview deals" pendingLabel="Previewing..." />
        {state.preview && state.preview.parseErrors.length === 0 && state.preview.validRows > 0 ? (
          <SubmitButton intent="import" label="Import valid deals" pendingLabel="Importing..." />
        ) : null}
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.result ? <DealImportResultSummary result={state.result} /> : null}
      {state.preview ? <DealImportPreview state={state} /> : null}
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

function DealImportResultSummary({
  result
}: {
  result: NonNullable<DealImportPreviewActionState["result"]>;
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

function DealImportPreview({ state }: { state: DealImportPreviewActionState }) {
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
        <span>{preview.totalRows} total rows</span>
        <span>{preview.validRows} valid</span>
        <span>{preview.duplicateRows} duplicates to skip</span>
        <span>{preview.invalidRows} invalid rows to skip</span>
        <span>{preview.unsupportedColumns.length} unsupported columns</span>
      </div>
      {preview.unsupportedColumns.length > 0 ? (
        <p className="empty-copy">Ignored unsupported columns, not imported: {preview.unsupportedColumns.join(", ")}</p>
      ) : null}
      <table className="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Title</th>
            <th>Pipeline</th>
            <th>Stage</th>
            <th>Status</th>
            <th>Value</th>
            <th>Organization</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.title || "Missing"}</td>
              <td>{row.pipelineName || "Missing"}</td>
              <td>{row.stageName || "Missing"}</td>
              <td>{row.statusValue}</td>
              <td>{row.value || "-"}</td>
              <td>{row.organizationName || "-"}</td>
              <td>{row.skipReasons.length > 0 ? row.skipReasons.join(" ") : row.warnings.join(" ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.rows.length === 0 ? <p className="empty-copy">No deal rows found.</p> : null}
    </div>
  );
}
