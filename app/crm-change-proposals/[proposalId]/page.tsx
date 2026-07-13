import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CrmChangeProposalReview } from "@/components/crm-change-proposal-review";
import { PageHeader } from "@/components/page-header";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getCrmChangeProposal } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ proposalId: string }>;
  searchParams?: Promise<{ status?: string | string[] }>;
};

export default async function CrmChangeProposalDetailPage({ params, searchParams }: PageProps) {
  const { proposalId } = await params;
  const query = await searchParams;
  const { actor, workspace } = await getCurrentWorkspaceContext();
  const proposal = await getCrmChangeProposal(actor, proposalId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link className="button-secondary" href="/crm-change-proposals">
            Back to Proposals
          </Link>
        }
        eyebrow="CRM change review"
        subtitle="Compare current and proposed values, then explicitly apply or reject the pending change."
        title={proposal.title}
      />
      <CrmChangeProposalReview proposal={proposal} status={firstValue(query?.status)} />
    </AppShell>
  );
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
