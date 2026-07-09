import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import { formatDate } from "@/components/format";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";
import { WebFormPublicLinkControls } from "@/components/web-form-public-link-controls";
import { AppShell } from "@/components/app-shell";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { buildPublicWebFormUrl } from "@/lib/public-url";
import { listWebForms } from "@/lib/services/crm";
import { createWebFormAction, setWebFormEnabledAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ created?: string; disabled?: string; enabled?: string }>;
};

export default async function WebFormsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const webForms = await listWebForms(actor);

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Lead capture"
        subtitle="Create public forms that capture website inquiries into the Leads Inbox without deals, email sending, or provider automation."
        title="Web Forms"
      />

      {query?.created === "1" ? (
        <FormSuccessMessage className="section-separated">Web form created. Copy the public link when you are ready to publish it.</FormSuccessMessage>
      ) : null}
      {query?.enabled === "1" ? (
        <FormSuccessMessage className="section-separated">Web form enabled.</FormSuccessMessage>
      ) : null}
      {query?.disabled === "1" ? (
        <FormSuccessMessage className="section-separated">Web form disabled. Its public link now shows an unavailable state.</FormSuccessMessage>
      ) : null}

      <section className="panel section-separated">
        <PanelTitleRow
          description="Keep the public copy simple. Submissions create one lead and attach the submitted details as a lead note."
          title="Create Lead Capture Form"
        />
        <form action={createWebFormAction} className="web-form-builder-grid">
          <label className="form-field">
            <FormFieldLabel required>Internal name</FormFieldLabel>
            <input maxLength={120} name="name" placeholder="Website contact form" required />
          </label>
          <label className="form-field">
            <FormFieldLabel required>Public title</FormFieldLabel>
            <input maxLength={160} name="publicTitle" placeholder="Talk with our team" required />
          </label>
          <label className="form-field web-form-field-wide">
            <FormFieldLabel>Public description</FormFieldLabel>
            <textarea
              maxLength={500}
              name="publicDescription"
              placeholder="Tell us a little about what you are looking for."
              rows={3}
            />
          </label>
          <label className="form-field">
            <FormFieldLabel>Source label</FormFieldLabel>
            <input maxLength={120} name="sourceLabel" placeholder="Web Form / Website contact form" />
          </label>
          <label className="checkbox-field web-form-checkbox-field">
            <input name="requireLeadTitle" type="checkbox" />
            <span>Require visitors to enter a lead title</span>
          </label>
          <div className="form-actions web-form-field-wide">
            <button className="button-primary" type="submit">
              Create form
            </button>
          </div>
        </form>
      </section>

      {webForms.length > 0 ? (
        <section className="panel">
          <PanelTitleRow
            actions={<Badge label={`${webForms.length} web forms`}>{webForms.length}</Badge>}
            description="Enabled links accept public submissions. Disabled links return a safe unavailable page."
            title="Lead Capture Forms"
          />
          <TableScroll aria-label="Web forms table">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Status</th>
                  <th>Lead source</th>
                  <th>Submissions</th>
                  <th>Updated</th>
                  <th>Public link</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {webForms.map((webForm) => {
                  const publicUrl = buildPublicWebFormUrl(webForm.token);
                  return (
                    <tr key={webForm.id}>
                      <td data-label="Form">
                        <span className="table-primary-cell">
                          <strong>{webForm.name}</strong>
                          <span className="table-secondary-text">{webForm.publicTitle}</span>
                        </span>
                      </td>
                      <td data-label="Status">
                        <Badge label={`Web form status: ${webForm.isEnabled ? "Enabled" : "Disabled"}`}>
                          {webForm.isEnabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </td>
                      <td data-label="Lead source">{webForm.sourceLabel}</td>
                      <td data-label="Submissions">{webForm._count.submissions}</td>
                      <td data-label="Updated">{formatDate(webForm.updatedAt)}</td>
                      <td data-label="Public link">
                        <WebFormPublicLinkControls
                          formName={webForm.name}
                          isEnabled={webForm.isEnabled}
                          publicUrl={publicUrl}
                        />
                      </td>
                      <td className="table-actions-cell" data-label="Actions">
                        <a className="button-secondary button-compact" href={publicUrl} rel="noreferrer" target="_blank">
                          Open
                        </a>
                        <form action={setWebFormEnabledAction}>
                          <input name="webFormId" type="hidden" value={webForm.id} />
                          <input name="enabled" type="hidden" value={webForm.isEnabled ? "false" : "true"} />
                          <button className="button-secondary button-compact" type="submit">
                            {webForm.isEnabled ? "Disable" : "Enable"}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </section>
      ) : (
        <EmptyState
          as="section"
          className="empty-state-panel"
          description="Create your first public lead capture form, then add its link to a website, campaign page, or contact page."
          title="No web forms yet"
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}
