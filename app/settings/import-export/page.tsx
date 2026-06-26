import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { exportResources, type ExportResource } from "@/lib/services/crm";
import { ContactImportForm } from "./contact-import-form";
import { DealImportForm } from "./deal-import-form";
import { LeadImportForm } from "./lead-import-form";
import { OrganizationImportForm } from "./organization-import-form";

export const dynamic = "force-dynamic";

const exportLabels: Record<ExportResource, { title: string; description: string }> = {
  deals: {
    title: "Deals",
    description: "Pipeline, stage, value, owner, contact, organization, and deal custom fields."
  },
  contacts: {
    title: "Contacts",
    description: "Names, email, phone, owner, organization, timestamps, and contact custom fields."
  },
  organizations: {
    title: "Organizations",
    description: "Company names, domains, owner, related record counts, timestamps, and organization custom fields."
  },
  leads: {
    title: "Leads",
    description: "Lead status, source, owner, contact, organization, timestamps, and lead custom fields."
  },
  activities: {
    title: "Activities",
    description: "Follow-up title, type, status, due/completed dates, owner, related records, and description."
  },
  quotes: {
    title: "Quotes",
    description: "Quote number, status, deal, contact, organization, totals, item count, and timestamps."
  }
};

export default async function ImportExportPage() {
  const { workspace } = await getCurrentWorkspaceContext();

  return (
    <AppShell workspace={workspace}>
      <header className="page-header">
        <div>
          <p className="page-kicker">Settings</p>
          <h1 className="page-title">Import / Export</h1>
        </div>
        <div className="header-actions">
          <Link className="button-secondary" href="/settings">
            Back to settings
          </Link>
        </div>
      </header>

      <section className="panel">
        <h2 className="panel-title">CSV Exports</h2>
        <p className="empty-copy">
          Exports include core columns plus workspace custom fields for the selected record type.
        </p>
        <div className="export-grid">
          {exportResources.map((resource) => {
            const label = exportLabels[resource];
            return (
              <div className="export-item" key={resource}>
                <div>
                  <h3>{label.title}</h3>
                  <p>{label.description}</p>
                </div>
                <Link
                  className="button-primary"
                  href={`/api/v1/workspaces/${workspace.id}/exports/${resource}` as Route}
                >
                  Download CSV
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2 className="panel-title">Deals Import Preview</h2>
        <p className="empty-copy">
          Paste a small Deals CSV to validate pipeline and stage references, detect deal duplicates, and check associations
          before creating valid deals.
        </p>
        <DealImportForm />
      </section>

      <section className="panel">
        <h2 className="panel-title">Organizations Import Preview</h2>
        <p className="empty-copy">
          Paste a small Organizations CSV to validate rows and detect likely duplicates before importing. This preview does
          not create records until you import valid organizations.
        </p>
        <OrganizationImportForm />
      </section>

      <section className="panel">
        <h2 className="panel-title">Contacts Import Preview</h2>
        <p className="empty-copy">
          Paste a small Contacts CSV to validate rows, detect email duplicates, and check organization references before
          creating valid contacts.
        </p>
        <ContactImportForm />
      </section>

      <section className="panel">
        <h2 className="panel-title">Leads Import Preview</h2>
        <p className="empty-copy">
          Paste a small Leads CSV to validate titles, detect title duplicates, and check organization references before
          creating valid leads.
        </p>
        <LeadImportForm />
      </section>
    </AppShell>
  );
}
