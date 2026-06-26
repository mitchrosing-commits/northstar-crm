import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";

export const dynamic = "force-dynamic";

const resourceAreas = [
  {
    title: "Deals",
    status: "Live",
    description: "Create, update, close, reopen, move stages, add line items, and create quotes from deals.",
    endpoints: ["GET /deals", "POST /deals", "PATCH /deals/:dealId", "POST /deals/:dealId/close"]
  },
  {
    title: "Contacts / People",
    status: "Live",
    description: "Workspace-scoped person records for customer contacts and buying committee members.",
    endpoints: ["GET /people", "POST /people", "PATCH /people/:personId", "DELETE /people/:personId"]
  },
  {
    title: "Organizations",
    status: "Live",
    description: "Workspace-scoped company/account records with related contacts, deals, activities, and notes.",
    endpoints: ["GET /organizations", "POST /organizations", "PATCH /organizations/:organizationId"]
  },
  {
    title: "Leads",
    status: "Live",
    description: "Capture, update, and convert unqualified leads into deals without cross-workspace leakage.",
    endpoints: ["GET /leads", "POST /leads", "PATCH /leads/:leadId", "POST /leads/:leadId/convert"]
  },
  {
    title: "Activities",
    status: "Live",
    description: "Create and update follow-up work attached to deals, leads, contacts, or organizations.",
    endpoints: ["GET /activities", "POST /activities", "PATCH /activities/:activityId"]
  },
  {
    title: "Notes / Timeline Inputs",
    status: "Live",
    description: "Notes, manual email logs, and audit logs power record timelines. Timeline rendering remains an app view.",
    endpoints: ["GET /notes", "POST /notes", "GET /email-logs", "GET /audit-logs"]
  },
  {
    title: "Quotes",
    status: "Live",
    description: "Draft quotes, lifecycle transitions, public links, adjustments, PDFs, and accepted-quote value sync.",
    endpoints: ["POST /deals/:dealId/quotes", "POST /quotes/:quoteId/mark-sent", "POST /quotes/:quoteId/public-link"]
  },
  {
    title: "Products / Line Items",
    status: "Live",
    description: "Workspace product catalog and deal line-item snapshots for quote creation.",
    endpoints: ["GET /products", "POST /products", "PATCH /products/:productId", "POST /deals/:dealId/line-items"]
  },
  {
    title: "Import / Export",
    status: "Mixed",
    description: "CSV exports are REST endpoints. CSV imports are browser/server-action preview flows today.",
    endpoints: ["GET /exports/deals", "GET /exports/contacts", "GET /exports/organizations", "GET /exports/quotes"]
  },
  {
    title: "Background Jobs",
    status: "Internal",
    description: "Job commands support password-reset email delivery and worker maintenance. No public job API is exposed.",
    endpoints: ["npm run jobs:status", "npm run jobs:run-once", "npm run jobs:work"]
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

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Settings</p>
          <h1 className="page-title">Developer / API</h1>
        </div>
        <div className="header-actions">
          <Link className="button-secondary" href="/settings">
            Back to settings
          </Link>
        </div>
      </header>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">API v0</h2>
          <span className="badge">Workspace scoped</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 14 }}>
          Northstar exposes a growing REST surface for core CRM records. Current API access uses the signed-in browser
          session in local auth or a trusted upstream user header in trusted-header mode; public API keys are not live yet.
        </p>
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

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Resource Areas</h2>
          <Link className="button-secondary button-compact" href="/settings/import-export">
            Import / Export
          </Link>
        </div>
        <div className="api-resource-grid">
          {resourceAreas.map((resource) => (
            <article className="api-resource-card" key={resource.title}>
              <div className="api-resource-header">
                <h3>{resource.title}</h3>
                <span className="badge">{resource.status}</span>
              </div>
              <p>{resource.description}</p>
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

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-title-row">
          <h2 className="panel-title">Reference Docs</h2>
          <span className="badge">Repo docs</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 14 }}>
          The API reference is hand-maintained for this preview. Treat workspace IDs as tenant boundaries and keep all
          imports, exports, and record writes scoped to the active workspace.
        </p>
        <div className="export-grid">
          <div className="export-item">
            <div>
              <h3>OpenAPI spec</h3>
              <p>Workspace REST contract and schema reference.</p>
            </div>
            <code className="code-pill">docs/openapi.yaml</code>
          </div>
          <div className="export-item">
            <div>
              <h3>Route map</h3>
              <p>Browser pages, REST routes, and implementation notes.</p>
            </div>
            <code className="code-pill">docs/api-route-map.md</code>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title-row">
          <h2 className="panel-title">Platform Controls</h2>
          <span className="badge">Preview</span>
        </div>
        <p className="empty-copy" style={{ marginBottom: 16 }}>
          These controls are visible so evaluators can see the intended platform direction. They are disabled until the
          underlying API-key, webhook, and app authorization systems exist.
        </p>
        <div className="provider-card-grid">
          {plannedSurfaces.map((surface) => (
            <div className="provider-card" key={surface.title}>
              <div>
                <h3>{surface.title}</h3>
                <span className="badge">{surface.status}</span>
              </div>
              <p>{surface.description}</p>
              <button className="button-secondary button-compact" disabled type="button">
                {surface.status}
              </button>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
