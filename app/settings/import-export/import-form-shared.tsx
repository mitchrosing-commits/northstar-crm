"use client";

import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { ActionGroup } from "@/components/action-group";
import { CompactTitleRow } from "@/components/compact-title-row";
import { EmptyState } from "@/components/empty-state";
import { FormCallout } from "@/components/form-callout";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { StatusBadge } from "@/components/status-badge";
import { TableScroll } from "@/components/table-scroll";

type ImportResultCounts = {
  createdCount: number;
  errorCount: number;
  failedRows?: Array<{ rowNumber: number; reason: string }>;
  skippedDuplicateCount: number;
  skippedInvalidCount: number;
};

type ImportPreviewReadyState = {
  parseErrors: string[];
  validRows: number;
};

type ImportPreviewMetric = {
  label: string;
  value: number | string;
};

type ImportFormShellProps = {
  action: ComponentProps<"form">["action"];
  canImport: boolean;
  children: ReactNode;
  error?: string;
  importButtonLabel: string;
  importPendingLabel: string;
  preview?: ImportPreviewReadyState;
  previewButtonLabel: string;
  previewContent?: ReactNode;
  previewPendingLabel: string;
  recordLabel: string;
  recordPluralLabel?: string;
  result?: ImportResultCounts;
};

type ImportCsvInputGroupProps = {
  defaultValue: string;
  guidance: ReactNode;
  id: string;
  label: string;
  name: string;
  placeholder: string;
  rows?: number;
};

type ImportColumnGuidanceProps = {
  customFieldNote?: ReactNode;
  lifecycleNote?: ReactNode;
  optionalColumns?: ReactNode;
  optionalLabel?: "Optional column" | "Optional columns";
  recordIntro: ReactNode;
  requiredColumns: ReactNode;
  requiredLabel?: "Required column" | "Required columns";
  workspaceNote?: ReactNode;
};

export function ImportFormShell({
  action,
  canImport,
  children,
  error,
  importButtonLabel,
  importPendingLabel,
  preview,
  previewButtonLabel,
  previewContent,
  previewPendingLabel,
  recordLabel,
  recordPluralLabel,
  result,
}: ImportFormShellProps) {
  const resolvedRecordPluralLabel =
    recordPluralLabel ?? defaultImportRecordPluralLabel(recordLabel);
  const importActionsLabel = `${recordLabel} import actions`;

  return (
    <form action={action} className="import-form">
      {children}
      {canImport && preview ? (
        <ImportReadyNotice
          recordLabel={recordLabel}
          recordPluralLabel={resolvedRecordPluralLabel}
          validRows={preview.validRows}
        />
      ) : null}
      <ActionGroup className="import-actions" label={importActionsLabel}>
        <ImportSubmitButton
          intent="preview"
          label={previewButtonLabel}
          pendingLabel={previewPendingLabel}
          recordLabel={recordLabel}
        />
        {canImport ? (
          <ImportSubmitButton
            intent="import"
            label={importButtonLabel}
            pendingLabel={importPendingLabel}
            recordLabel={recordLabel}
          />
        ) : null}
      </ActionGroup>
      <p className="import-action-helper">
        Preview validates rows without creating records. The import action
        appears after a parsed preview finds valid rows.
      </p>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      {result ? <ImportResultSummary result={result} /> : null}
      {previewContent}
    </form>
  );
}

export function isImportReady(preview?: ImportPreviewReadyState) {
  return Boolean(
    preview && preview.parseErrors.length === 0 && preview.validRows > 0,
  );
}

export function ImportSubmitButton({
  intent,
  label,
  pendingLabel,
  recordLabel,
}: {
  intent: string;
  label: string;
  pendingLabel: string;
  recordLabel: string;
}) {
  const { pending } = useFormStatus();
  const actionLabel = importSubmitActionLabel(intent, recordLabel);

  return (
    <button
      aria-label={actionLabel}
      className={intent === "import" ? "button-secondary" : "button-primary"}
      type="submit"
      name="intent"
      value={intent}
      disabled={pending}
      title={actionLabel}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function importSubmitActionLabel(intent: string, recordLabel: string) {
  const recordNoun =
    recordLabel === "organization"
      ? "organization records"
      : `${recordLabel} records`;
  return intent === "import"
    ? `Create validated ${recordNoun} from CSV`
    : `Preview ${recordLabel} CSV without creating records`;
}

export function ImportPreviewSummary({
  metrics,
  unsupportedColumns,
  unsupportedColumnsMessage = "Ignored columns:",
}: {
  metrics: ImportPreviewMetric[];
  unsupportedColumns?: string[];
  unsupportedColumnsMessage?: string;
}) {
  return (
    <>
      <CompactTitleRow title="Preview results" />
      <div className="import-summary">
        {metrics.map((metric) => (
          <span key={metric.label}>
            {metric.value} {metric.label}
          </span>
        ))}
      </div>
      {unsupportedColumns && unsupportedColumns.length > 0 ? (
        <ImportUnsupportedColumnsNotice
          columns={unsupportedColumns}
          message={unsupportedColumnsMessage}
        />
      ) : null}
    </>
  );
}

export function ImportUnsupportedColumnsNotice({
  columns,
  message,
}: {
  columns: string[];
  message: string;
}) {
  return (
    <FormCallout
      className="import-unsupported-columns-notice"
      role="status"
      title={message}
    >
      {columns.join(", ")}
    </FormCallout>
  );
}

export function ImportFormGuidance({ children }: { children: ReactNode }) {
  return (
    <FormIntroCallout
      className="import-form-guidance"
      title="Preview before import"
    >
      {children}
    </FormIntroCallout>
  );
}

export function ImportColumnGuidance({
  customFieldNote,
  lifecycleNote,
  optionalColumns,
  optionalLabel = "Optional columns",
  recordIntro,
  requiredColumns,
  requiredLabel = "Required columns",
  workspaceNote,
}: ImportColumnGuidanceProps) {
  return (
    <>
      {recordIntro} {requiredLabel}: {requiredColumns}.
      {optionalColumns ? (
        <>
          {" "}
          {optionalLabel}: {optionalColumns}.
        </>
      ) : null}
      {workspaceNote ? <> {workspaceNote}</> : null}
      {customFieldNote ? <> {customFieldNote}</> : null}
      {lifecycleNote ? <> {lifecycleNote}</> : null}
    </>
  );
}

export function ImportCsvInputGroup({
  defaultValue,
  guidance,
  id,
  label,
  name,
  placeholder,
  rows = 8,
}: ImportCsvInputGroupProps) {
  return (
    <>
      <label className="form-label" htmlFor={id}>
        <FormFieldLabel required>{label}</FormFieldLabel>
      </label>
      <textarea
        className="import-textarea"
        defaultValue={defaultValue}
        id={id}
        name={name}
        placeholder={placeholder}
        rows={rows}
      />
      <ImportFormGuidance>{guidance}</ImportFormGuidance>
    </>
  );
}

export function ImportPreviewTable({
  ariaLabel,
  children,
}: {
  ariaLabel: string;
  children: ReactNode;
}) {
  return <TableScroll aria-label={ariaLabel}>{children}</TableScroll>;
}

export function ImportPreviewEmptyState({
  recordLabel,
}: {
  recordLabel: string;
}) {
  return (
    <EmptyState
      className="empty-state-compact empty-state-panel import-preview-empty"
      description="The CSV parsed, but it did not include any data rows to review. Add at least one data row below the header, then preview again."
      title={`No ${recordLabel} rows found`}
    />
  );
}

export function ImportReadyNotice({
  recordLabel,
  recordPluralLabel,
  validRows,
}: {
  recordLabel: string;
  recordPluralLabel: string;
  validRows: number;
}) {
  const importLabel = validRows === 1 ? recordLabel : recordPluralLabel;

  return (
    <FormCallout
      className="import-ready-notice"
      role="status"
      title={`Ready to create ${validRows} valid ${importLabel}`}
    >
      Import creates only validated rows. Duplicate and invalid rows stay
      skipped; unsupported columns are ignored.
    </FormCallout>
  );
}

export function ImportResultSummary({
  result,
}: {
  result: ImportResultCounts;
}) {
  const failedRows = result.failedRows ?? [];

  return (
    <div className="import-preview">
      <CompactTitleRow title="Import results" />
      <div className="import-summary">
        <span>{result.createdCount} created</span>
        <span>{result.skippedDuplicateCount} duplicates skipped</span>
        <span>{result.skippedInvalidCount} invalid rows skipped</span>
        <span>{result.errorCount} errors</span>
      </div>
      {failedRows.length > 0 ? (
        <FormCallout
          className="import-result-warning"
          details={
            <ul className="import-message-list">
              {failedRows.map((row) => (
                <li key={`${row.rowNumber}-${row.reason}`}>
                  Row {row.rowNumber}: {row.reason}
                </li>
              ))}
            </ul>
          }
          role="alert"
          title="Some validated rows were not created"
        >
          These rows were valid in preview but were not created during import.
        </FormCallout>
      ) : null}
    </div>
  );
}

export function ImportPreviewIssues({ errors }: { errors: string[] }) {
  return (
    <div className="import-preview">
      <CompactTitleRow title="Preview issues" />
      <ul className="import-message-list">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

export function ImportPreviewRowNotes({
  skipReasons,
  warnings,
}: {
  skipReasons: string[];
  warnings: string[];
}) {
  const note =
    skipReasons.length > 0 ? skipReasons.join(" ") : warnings.join(" ") || "-";

  return <span className="table-secondary-text">{note}</span>;
}

export function ImportPreviewStatusBadge({
  status,
}: {
  status: "valid" | "duplicate" | "invalid";
}) {
  return <StatusBadge status={status} />;
}

function defaultImportRecordPluralLabel(recordLabel: string) {
  return recordLabel === "organization" ? "organizations" : `${recordLabel}s`;
}
