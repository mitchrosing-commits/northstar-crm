import Link from "next/link";
import type { Route } from "next";
import type { ComponentType, ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { FieldMetric } from "@/components/field-metric";
import {
  buildListExportHref,
  exportRowCountLabel,
  fullWorkspaceExportHelperText
} from "@/components/list-export-link";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { exportResourceDetails, exportResources, getWorkspaceExportOverview } from "@/lib/services/crm";
import { ContactImportForm } from "./contact-import-form";
import { DealImportForm } from "./deal-import-form";
import { LeadImportForm } from "./lead-import-form";
import { OrganizationImportForm } from "./organization-import-form";

export const dynamic = "force-dynamic";

const importSamples = [
  {
    title: "Contacts",
    required: "firstName or name",
    optional: "lastName, email, phone, organizationName, ownerEmail",
    csv: "name,email,phone,organizationName,ownerEmail\nAvery Stone,avery@example.test,555-0101,Acme Corporation,owner@example.test"
  },
  {
    title: "Organizations",
    required: "name",
    optional: "domain, ownerEmail",
    csv: "name,domain,ownerEmail\nAcme Corporation,acme.example,owner@example.test"
  },
  {
    title: "Leads",
    required: "title",
    optional: "status, source, contactEmail, contactName, organizationName, ownerEmail",
    csv: "title,status,source,contactEmail,organizationName\nWebsite inquiry,NEW,Website,avery@example.test,Acme Corporation"
  },
  {
    title: "Deals",
    required: "title, pipeline, stage",
    optional: "status, value, currency, expectedCloseAt, contactEmail, organizationName, ownerEmail",
    csv: "title,pipeline,stage,value,currency,status,contactEmail,organizationName\nExpansion deal,New Business,Qualified,1200.00,USD,OPEN,avery@example.test,Acme Corporation"
  }
] as const;

const importPreviewPanels: Array<{
  Form: ComponentType;
  description: string;
  id: string;
  title: string;
}> = [
  {
    Form: OrganizationImportForm,
    description:
      "Paste a small Organizations CSV to validate rows and detect likely duplicates before importing. This preview does not create records until you import valid organizations.",
    id: "organizations-import",
    title: "Organizations Import Preview"
  },
  {
    Form: ContactImportForm,
    description:
      "Paste a small Contacts CSV to validate rows, detect email duplicates, and check organization references before creating valid contacts.",
    id: "contacts-import",
    title: "Contacts Import Preview"
  },
  {
    Form: LeadImportForm,
    description:
      "Paste a small Leads CSV to validate titles, detect title duplicates, and check organization references before creating valid leads.",
    id: "leads-import",
    title: "Leads Import Preview"
  },
  {
    Form: DealImportForm,
    description:
      "Paste a small Deals CSV to validate pipeline and stage references, detect deal duplicates, and check associations before creating valid deals.",
    id: "deals-import",
    title: "Deals Import Preview"
  }
];

export default async function ImportExportPage() {
  const { actor, workspace } = await getCurrentWorkspaceContext();
  const exportOverview = await getWorkspaceExportOverview(actor);
  const backToSettingsLabel = "Back to settings from import and export";

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link
            aria-label={backToSettingsLabel}
            className="button-secondary"
            href="/settings"
            title={backToSettingsLabel}
          >
            Back to settings
          </Link>
        }
        eyebrow="Settings"
        subtitle="Move CRM data safely with filter-aware exports and preview-first CSV imports."
        title="Import / Export"
      />

      <section className="panel">
        <PanelTitleRow
          actions={<Badge label="CSV exports are scoped to the active workspace">Workspace scoped</Badge>}
          description="Settings exports download full workspace snapshots with core columns and workspace custom fields. For filtered exports, apply filters on a list page and use that page's CSV export."
          title="CSV Exports"
        />
        <div className="export-grid">
          {exportResources.map((resource) => {
            const label = exportResourceDetails[resource];
            const overview = exportOverview[resource];
            const exportActionLabel = `Download ${label.title} full workspace CSV`;
            return (
              <DataTransferCard
                action={
                  <Link
                    aria-label={exportActionLabel}
                    className="button-primary"
                    href={buildListExportHref(workspace.id, resource, {}) as Route}
                    title={exportActionLabel}
                  >
                    Download CSV
                  </Link>
                }
                description={label.description}
                helper={fullWorkspaceExportHelperText(overview)}
                key={resource}
                meta={
                  <ExportCardMeta
                    customFieldCount={overview.customFieldCount}
                    rowCount={overview.rowCount}
                  />
                }
                title={label.title}
              />
            );
          })}
        </div>
      </section>

      <section className="panel">
        <PanelTitleRow
          description="Use these small samples as starting points. Imports remain preview-first: paste a CSV, review validation, then import valid rows."
          title="Sample CSV Templates"
        />
        <div className="sample-csv-grid">
          {importSamples.map((sample) => (
            <DataTransferCard className="sample-csv-card" key={sample.title} title={sample.title}>
              <p>
                <strong>Required:</strong> {sample.required}
              </p>
              <p>
                <strong>Optional:</strong> {sample.optional}
              </p>
              <pre>{sample.csv}</pre>
            </DataTransferCard>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitleRow
          actions={<Badge label="CSV imports require preview and validation before records are created">Preview first</Badge>}
          description="Imports are intentionally conservative. Preview the CSV first, then create only the rows Northstar can validate against this workspace."
          title="Import Safety Rules"
        />
        <div className="field-grid">
          <FieldMetric label="Preview first" value="No records are created until you choose an import action after validation." />
          <FieldMetric label="Row-level results" value="Valid, duplicate, invalid, and unsupported-column outcomes are shown before import." />
          <FieldMetric label="Workspace scoped" value="Owners and related records must already exist in the active workspace." />
          <FieldMetric label="Custom fields" value="Exports include custom fields; custom-field import remains deferred until mapping is explicit." />
        </div>
      </section>

      {importPreviewPanels.map(({ Form, description, id, title }) => (
        <ImportPreviewSection description={description} id={id} key={title} title={title}>
          <Form />
        </ImportPreviewSection>
      ))}
    </AppShell>
  );
}

function DataTransferCard({
  action,
  children,
  className = "export-item",
  description,
  helper,
  meta,
  title
}: {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  helper?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className={className}>
      <CompactTitleRow actions={action} description={description} title={title} />
      {meta}
      {children}
      {helper ? <p className="export-scope-note">{helper}</p> : null}
    </div>
  );
}

function ExportCardMeta({
  customFieldCount,
  rowCount
}: {
  customFieldCount: number;
  rowCount: number;
}) {
  const rowCountLabel = exportRowCountLabel(rowCount);
  const rowCountBadgeLabel = `Export row count: ${rowCountLabel}`;
  const customFieldBadgeLabel = `Export includes ${customFieldCount} custom ${customFieldCount === 1 ? "field" : "fields"}`;

  return (
    <div className="import-export-card-meta">
      <Badge label={rowCountBadgeLabel}>{rowCountLabel}</Badge>
      {customFieldCount > 0 ? (
        <Badge label={customFieldBadgeLabel}>
          {customFieldCount} custom {customFieldCount === 1 ? "field" : "fields"}
        </Badge>
      ) : null}
    </div>
  );
}

function ImportPreviewSection({
  children,
  description,
  id,
  title
}: {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}) {
  return (
    <section className="panel" id={id}>
      <PanelTitleRow description={description} title={title} />
      {children}
    </section>
  );
}
