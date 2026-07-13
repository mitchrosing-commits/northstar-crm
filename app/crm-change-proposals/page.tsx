import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { TableScroll } from "@/components/table-scroll";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { listCrmChangeProposals } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ status?: string | string[] }>;
};

const statusTabs = ["PENDING", "APPLIED", "REJECTED", "FAILED", "ALL"] as const;

export default async function CrmChangeProposalsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const status = firstValue(query?.status);
  const { actor, workspace } = await getCurrentWorkspaceContext();
  const review = await listCrmChangeProposals(actor, { status: status === "ALL" ? "" : status });

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        eyebrow="Review-first CRM changes"
        subtitle="Review proposed contact and organization changes before anything mutates CRM records."
        title="CRM Change Proposals"
      />

      <section className="panel section-separated">
        <PanelTitleRow
          actions={<Badge>{review.proposals.length} visible</Badge>}
          description={`Newest proposals first. Results are capped at ${review.proposalLimit}.`}
          title="Proposal Queue"
        />
        <nav aria-label="CRM change proposal status filters" className="assistant-review-queue-tabs">
          {statusTabs.map((tab) => (
            <Link
              aria-current={(review.status ?? "ALL") === tab ? "page" : undefined}
              className={(review.status ?? "ALL") === tab ? "button-primary button-compact" : "button-secondary button-compact"}
              href={tab === "ALL" ? "/crm-change-proposals" : (`/crm-change-proposals?status=${tab}` as Route)}
              key={tab}
            >
              {tab}
            </Link>
          ))}
        </nav>
      </section>

      {review.proposals.length > 0 ? (
        <section className="panel">
          <TableScroll aria-label="CRM change proposals">
            <table className="table crm-list-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Proposal</th>
                  <th>Source</th>
                  <th>Permission</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {review.proposals.map((proposal) => (
                  <tr key={proposal.id}>
                    <td data-label="Created">{formatDateTime(proposal.createdAt)}</td>
                    <td data-label="Proposal">
                      <span className="table-primary-cell">
                        <strong>{proposal.title}</strong>
                        <span className="table-secondary-text">{proposal.targetLabel}</span>
                      </span>
                    </td>
                    <td data-label="Source">{proposal.sourceLabel ?? proposal.sourceType}</td>
                    <td data-label="Permission">{proposal.permissionLabel}</td>
                    <td data-label="Status">{proposal.status}</td>
                    <td className="table-actions-cell" data-label="Actions">
                      <Link className="button-secondary button-compact" href={`/crm-change-proposals/${proposal.id}` as Route}>
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </section>
      ) : (
        <EmptyState
          as="section"
          className="empty-state-panel"
          description="AI-producing systems can create reviewed CRM proposals here instead of directly mutating contacts or organizations."
          title="No CRM change proposals"
          titleLevel="h2"
        />
      )}
    </AppShell>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}
