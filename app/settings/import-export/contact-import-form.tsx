"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  previewContactImportAction,
  type ContactImportPreviewActionState
} from "@/app/settings/import-export/actions";

const initialState: ContactImportPreviewActionState = {
  csvText: ""
};

export function ContactImportForm() {
  const [state, formAction] = useActionState(previewContactImportAction, initialState);

  return (
    <form action={formAction} className="import-form">
      <label className="form-label" htmlFor="contactCsv">
        Contacts CSV
      </label>
      <textarea
        className="import-textarea"
        id="contactCsv"
        name="contactCsv"
        rows={8}
        defaultValue={state.csvText}
        placeholder={"name,email,phone,organizationName\nAvery Stone,avery@example.test,555-0100,Acme Corporation"}
      />
      <p className="empty-copy">
        Contacts preview and import. Required column: name or firstName. Optional columns: lastName, email, phone, and
        organizationName. Organization names must already exist; contacts are only created after import.
      </p>
      <div className="import-actions">
        <SubmitButton intent="preview" label="Preview contacts" pendingLabel="Previewing..." />
        {state.preview && state.preview.parseErrors.length === 0 && state.preview.validRows > 0 ? (
          <SubmitButton intent="import" label="Import valid contacts" pendingLabel="Importing..." />
        ) : null}
      </div>
      {state.error ? <p className="form-error">{state.error}</p> : null}
      {state.result ? <ContactImportResultSummary result={state.result} /> : null}
      {state.preview ? <ContactImportPreview state={state} /> : null}
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

function ContactImportResultSummary({
  result
}: {
  result: NonNullable<ContactImportPreviewActionState["result"]>;
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

function ContactImportPreview({ state }: { state: ContactImportPreviewActionState }) {
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
            <th>Email</th>
            <th>Organization</th>
            <th>Status</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.name || "Missing"}</td>
              <td>{row.email || "-"}</td>
              <td>{row.organizationName || "-"}</td>
              <td>
                <span className="badge">{row.status}</span>
              </td>
              <td>{row.skipReasons.length > 0 ? row.skipReasons.join(" ") : row.warnings.join(" ") || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.rows.length === 0 ? <p className="empty-copy">No contact rows found.</p> : null}
    </div>
  );
}
