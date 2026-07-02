import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { CompactTitleRow } from "@/components/compact-title-row";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";

export const dynamic = "force-dynamic";

const resourceAreas = [
  {
    title: "Pipeline Settings",
    status: "Live",
    description: "Workspace-scoped pipelines and stages for deal boards and stage movement.",
    endpoints: [
      "GET /pipelines",
      "POST /pipelines",
      "PATCH /pipelines/:pipelineId",
      "DELETE /pipelines/:pipelineId",
      "GET /pipelines/:pipelineId/stages",
      "POST /pipelines/:pipelineId/stages",
      "PATCH /stages/:stageId",
      "DELETE /stages/:stageId"
    ]
  },
  {
    title: "Deals",
    status: "Live",
    description: "Create, update, close, reopen, move stages, add line items, and create quotes from deals.",
    endpoints: [
      "GET /deals",
      "POST /deals",
      "GET /deals/:dealId",
      "PATCH /deals/:dealId",
      "DELETE /deals/:dealId",
      "POST /deals/:dealId/close",
      "POST /deals/:dealId/reopen"
    ]
  },
  {
    title: "Contacts / People",
    status: "Live",
    description: "Workspace-scoped person records for customer contacts and buying committee members.",
    endpoints: ["GET /people", "POST /people", "GET /people/:personId", "PATCH /people/:personId", "DELETE /people/:personId"]
  },
  {
    title: "Organizations",
    status: "Live",
    description: "Workspace-scoped company/account records with related contacts, deals, activities, and notes.",
    endpoints: [
      "GET /organizations",
      "POST /organizations",
      "GET /organizations/:organizationId",
      "PATCH /organizations/:organizationId",
      "DELETE /organizations/:organizationId"
    ]
  },
  {
    title: "Leads",
    status: "Live",
    description: "Capture, update, and convert unqualified leads into deals without cross-workspace leakage.",
    endpoints: ["GET /leads", "POST /leads", "GET /leads/:leadId", "PATCH /leads/:leadId", "POST /leads/:leadId/convert"]
  },
  {
    title: "Activities",
    status: "Live",
    description: "Create and update follow-up work attached to deals, leads, contacts, or organizations.",
    endpoints: ["GET /activities", "POST /activities", "PATCH /activities/:activityId", "DELETE /activities/:activityId"]
  },
  {
    title: "Notes / Timeline Inputs",
    status: "Live",
    description: "Notes, manual email logs, and audit logs power record timelines. Timeline rendering remains an app view.",
    endpoints: ["GET /notes", "POST /notes", "DELETE /notes/:noteId", "GET /email-logs", "POST /email-logs", "GET /audit-logs"]
  },
  {
    title: "Meeting Intelligence",
    status: "Live",
    description: "Review-first meeting artifact intakes that propose notes and activities without silent CRM mutation.",
    endpoints: [
      "GET /meeting-intakes",
      "POST /meeting-intakes",
      "GET /meeting-intakes/:intakeId",
      "POST /meeting-intakes/:intakeId/apply"
    ]
  },
  {
    title: "Custom Fields",
    status: "Live",
    description: "Workspace-scoped custom field definitions and value updates for core CRM records.",
    endpoints: ["GET /custom-fields", "POST /custom-fields", "PATCH /custom-field-values"]
  },
  {
    title: "Email Templates",
    status: "Live",
    description: "Reusable manual email log templates for workspace CRM history, not provider sending.",
    endpoints: [
      "GET /email-templates",
      "POST /email-templates",
      "PATCH /email-templates/:templateId",
      "POST /email-templates/:templateId/deactivate",
      "POST /email-templates/:templateId/activate"
    ]
  },
  {
    title: "Quotes",
    status: "Live",
    description: "Draft quotes, lifecycle transitions, public links, adjustments, PDFs, and accepted-quote value sync.",
    endpoints: [
      "POST /deals/:dealId/quotes",
      "POST /quotes/:quoteId/mark-sent",
      "POST /quotes/:quoteId/accept",
      "POST /quotes/:quoteId/decline",
      "PATCH /quotes/:quoteId/adjustments",
      "POST /quotes/:quoteId/public-link",
      "DELETE /quotes/:quoteId/public-link",
      "POST /quotes/:quoteId/sync-deal-value"
    ]
  },
  {
    title: "Contract Workflow",
    status: "Live",
    description: "Local NDA, MSA, and SOW tracking steps for open deal agreement workflows.",
    endpoints: [
      "GET /deals/:dealId/contracts",
      "POST /deals/:dealId/contracts",
      "PATCH /contract-steps/:contractStepId"
    ]
  },
  {
    title: "Products / Line Items",
    status: "Live",
    description: "Workspace product catalog and deal line-item snapshots for quote creation.",
    endpoints: [
      "GET /products",
      "POST /products",
      "PATCH /products/:productId",
      "POST /products/:productId/deactivate",
      "POST /products/:productId/activate",
      "POST /deals/:dealId/line-items",
      "DELETE /deal-line-items/:lineItemId"
    ]
  },
  {
    title: "Import / Export",
    status: "Mixed",
    description: "CSV exports are REST endpoints. CSV imports are browser/server-action preview flows today.",
    endpoints: [
      "GET /exports/deals",
      "GET /exports/contacts",
      "GET /exports/organizations",
      "GET /exports/leads",
      "GET /exports/activities",
      "GET /exports/products",
      "GET /exports/quotes"
    ]
  },
  {
    title: "Background Jobs",
    status: "Internal",
    description: "Job commands support password-reset email delivery and worker maintenance. No public job API is exposed.",
    endpoints: ["npm run jobs:status", "npm run jobs:run-once", "npm run jobs:work", "npm run jobs:cleanup"]
  }
];

const plannedSurfaces = [
  {
    title: "API Keys",
    status: "Coming soon",
    description: "API-key issuance, rotation, scopes, and last-used tracking are not implemented yet."
  },
  {
    title: "Webhooks",
    status: "Planned",
    description: "Customer-configurable webhooks for deal, quote, import, and activity events are not live."
  },
  {
    title: "OAuth Apps",
    status: "Planned",
    description: "Third-party app authorization and marketplace-style app installs are outside the current preview."
  }
];

export default async function DeveloperApiPage() {
  const { workspace } = await getCurrentWorkspaceContext();
  const backToSettingsLabel = "Back to settings from developer API";
  const importExportActionLabel = "Open import and export settings from developer API";

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
        subtitle="Review workspace-scoped REST coverage, export endpoints, and integration guardrails."
        title="Developer / API"
      />

      <section className="panel section-separated">
        <PanelTitleRow
          actions={<Badge>Workspace scoped</Badge>}
          description="Northstar exposes a growing REST surface for core CRM records. Current API access uses the signed-in browser session in local auth or a trusted upstream user header in trusted-header mode; public API keys are not live yet."
          title="API v1"
        />
        <div className="api-reference-grid" id="route-reference">
          <div>
            <p className="stat-label">Workspace API base</p>
            <code className="code-pill">/api/v1/workspaces/{workspace.id}</code>
          </div>
          <div>
            <p className="stat-label">Auth boundary</p>
            <p className="empty-copy">401 for missing session, 403 for non-members, safe 404s for cross-workspace records.</p>
          </div>
        </div>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          actions={
            <Link
              aria-label={importExportActionLabel}
              className="button-secondary button-compact"
              href="/settings/import-export"
              title={importExportActionLabel}
            >
              Import / Export
            </Link>
          }
          title="Resource Areas"
        />
        <div className="api-resource-grid">
          {resourceAreas.map((resource) => (
            <article className="api-resource-card" key={resource.title}>
              <CompactTitleRow
                actions={<Badge>{resource.status}</Badge>}
                description={resource.description}
                title={resource.title}
              />
              <ul className="endpoint-list">
                {resource.endpoints.map((endpoint) => (
                  <li key={endpoint}>
                    <code>{endpoint}</code>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow
          actions={<Badge>Repo docs</Badge>}
          description="The API reference is hand-maintained for this preview. Treat workspace IDs as tenant boundaries and keep all imports, exports, and record writes scoped to the active workspace."
          title="Reference Docs"
        />
        <div className="export-grid">
          <div className="export-item">
            <CompactTitleRow
              actions={<code className="code-pill">docs/openapi.yaml</code>}
              description="Workspace REST contract and schema reference."
              title="OpenAPI spec"
            />
          </div>
          <div className="export-item">
            <CompactTitleRow
              actions={<code className="code-pill">docs/api-route-map.md</code>}
              description="Browser pages, REST routes, and implementation notes."
              title="Route map"
            />
          </div>
        </div>
      </section>

      <section className="panel">
        <PanelTitleRow actions={<Badge>Preview</Badge>} title="Platform Controls" />
        <p className="empty-copy section-separated">
          These controls are visible so evaluators can see the intended platform direction. They are disabled until the
          underlying API-key, webhook, and app authorization systems exist.
        </p>
        <div className="provider-card-grid">
          {plannedSurfaces.map((surface) => {
            const plannedSurfaceActionLabel = `${surface.title} controls are planned and not yet available`;

            return (
              <div className="provider-card" key={surface.title}>
                <CompactTitleRow actions={<Badge>{surface.status}</Badge>} title={surface.title} />
                <p>{surface.description}</p>
                <button
                  aria-label={plannedSurfaceActionLabel}
                  className="button-secondary button-compact"
                  disabled
                  title={plannedSurfaceActionLabel}
                  type="button"
                >
                  {surface.status}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
