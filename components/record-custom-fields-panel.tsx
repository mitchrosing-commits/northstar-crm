import Link from "next/link";
import type { Route } from "next";

import { ActionGroup } from "@/components/action-group";
import { Badge } from "@/components/badge";
import { PanelTitleRow } from "@/components/panel-title-row";
import {
  RecordCustomFieldsForm,
  RecordCustomFieldsReadOnly,
  type RecordCustomField,
  type RecordCustomFieldEntityType,
} from "@/components/record-custom-fields-form";

type CustomFieldRecord = {
  id: string;
  name: string;
  key: string;
  fieldType: RecordCustomField["fieldType"];
  required: boolean;
  options?: unknown;
  values?: Array<{ value: unknown }>;
};

type RecordCustomFieldsPanelProps = {
  emptyMessage: string;
  entityId: string;
  entityType: RecordCustomFieldEntityType;
  fields: CustomFieldRecord[];
  id?: string;
  lockedMessage?: string;
  readOnly?: boolean;
  title?: string;
  workspaceId: string;
};

export function RecordCustomFieldsPanel({
  emptyMessage,
  entityId,
  entityType,
  fields,
  id = "custom-fields",
  lockedMessage,
  readOnly = false,
  title = "Custom Fields",
  workspaceId,
}: RecordCustomFieldsPanelProps) {
  const mappedFields = fields.map((field) => ({
    id: field.id,
    name: field.name,
    key: field.key,
    fieldType: field.fieldType,
    required: field.required,
    options: field.options,
    value: field.values?.[0]?.value ?? null,
  }));
  const customFieldActionsLabel = "Custom field actions";
  const fieldCountLabel = `${mappedFields.length} ${mappedFields.length === 1 ? "custom field" : "custom fields"} available in ${title}`;
  const manageFieldsLabel = `${title}: manage workspace custom field definitions`;

  return (
    <section className="data-card record-custom-fields-panel" id={id}>
      <PanelTitleRow
        actions={
          <ActionGroup className="filter-actions" label={customFieldActionsLabel}>
            <Badge label={fieldCountLabel}>
              {mappedFields.length} {mappedFields.length === 1 ? "field" : "fields"}
            </Badge>
            <Link
              aria-label={manageFieldsLabel}
              className="button-secondary button-compact"
              href={"/custom-fields#new-custom-field" as Route}
              title={manageFieldsLabel}
            >
              Manage fields
            </Link>
          </ActionGroup>
        }
        description="Record-specific values from your workspace custom-field definitions."
        title={title}
      />
      {readOnly ? (
        <RecordCustomFieldsReadOnly
          emptyMessage={emptyMessage}
          fields={mappedFields}
          lockedMessage={lockedMessage}
        />
      ) : (
        <RecordCustomFieldsForm
          emptyMessage={emptyMessage}
          entityId={entityId}
          entityType={entityType}
          fields={mappedFields}
          workspaceId={workspaceId}
        />
      )}
    </section>
  );
}
