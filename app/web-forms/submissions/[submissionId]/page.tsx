import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { AppShell } from "@/components/app-shell";
import { ApiError } from "@/lib/api/responses";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { getWebFormSubmissionDetail } from "@/lib/services/crm";
import { CopySubmittedFieldControl } from "./copy-submitted-field-control";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ submissionId: string }>;
  searchParams?: Promise<{
    form?: string | string[];
    from?: string | string[];
    q?: string | string[];
    returnTo?: string | string[];
    source?: string | string[];
    status?: string | string[];
    to?: string | string[];
  }>;
};

const LEAD_STATUS_LABELS: Record<string, string> = {
  NEW: "New",
  QUALIFIED: "Qualified",
  DISQUALIFIED: "Disqualified",
  CONVERTED: "Converted"
};
const RETURN_FOCUS_TARGET = "accepted-submissions";
const VALID_RETURN_STATUSES = new Set(Object.keys(LEAD_STATUS_LABELS));

export default async function WebFormSubmissionDetailPage({ params, searchParams }: PageProps) {
  const { submissionId } = await params;
  const query = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const submission = await getWebFormSubmissionDetail(actor, submissionId).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const backHref = buildBackHref(submission.webForm.id, query);
  const leadTitle = submission.leadTitle ?? submission.lead.title;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <div className="filter-actions">
            <Link className="button-secondary" href={backHref}>
              Back to Review
            </Link>
            <Link className="button-primary" href={`/leads/${submission.lead.id}` as Route}>
              Open Lead
            </Link>
          </div>
        }
        eyebrow="Accepted Web Form submission"
        subtitle="Review the sanitized submitted fields, source context, and linked CRM records for this accepted submission."
        title={leadTitle}
      />

      <section className="panel section-separated">
        <PanelTitleRow actions={<Badge label="Submission state: Accepted">Accepted</Badge>} title="Submitted Values" />
        <dl className="web-form-submission-detail-grid" aria-label="Submitted Web Form values">
          <DetailItem label="Name" value={submission.personName} />
          <SubmittedCopyItem copyLabel="email" label="Email" value={submission.email} />
          <SubmittedCopyItem copyLabel="phone" label="Phone" value={submission.phone} />
          <DetailItem label="Company" value={submission.organizationName} />
          <DetailItem label="Lead title" value={submission.leadTitle} />
          <div className="web-form-detail-wide">
            <dt>Message</dt>
            <dd>
              {submission.message ? (
                <p className="web-form-submission-message">{submission.message}</p>
              ) : (
                "Unavailable in this historical submission."
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel section-separated">
        <PanelTitleRow description="Metadata is derived from the accepted submission and its source form." title="Source Context" />
        <dl className="web-form-submission-detail-grid" aria-label="Web Form source metadata">
          <DetailItem label="Accepted at" value={formatDateTime(submission.submittedAt)} />
          <div>
            <dt>Source form</dt>
            <dd>
              <Link href={`/web-forms/${submission.webForm.id}` as Route}>{submission.webForm.name}</Link>
            </dd>
          </div>
          <DetailItem label="Source label" value={submission.webForm.sourceLabel} />
        </dl>
      </section>

      <section className="panel">
        <PanelTitleRow description="Linked CRM records are read-only from this review page." title="Linked CRM Records" />
        <dl className="web-form-submission-detail-grid" aria-label="Linked CRM records">
          <div>
            <dt>Linked Lead</dt>
            <dd>
              <Link href={`/leads/${submission.lead.id}` as Route}>{submission.lead.title}</Link>
            </dd>
          </div>
          <DetailItem label="Lead status" value={leadStatusLabel(submission.lead.status)} />
          <div>
            <dt>Source form review</dt>
            <dd>
              <Link href={`/web-forms/${submission.webForm.id}` as Route}>Open source form review</Link>
            </dd>
          </div>
          <div className="web-form-detail-wide">
            <dt>Lead Note context</dt>
            <dd>
              {submission.leadNote ? (
                <span className="table-primary-cell">
                  <span className="table-secondary-text">Created {formatDateTime(submission.leadNote.createdAt)}</span>
                  <span className="web-form-submission-note">{submission.leadNote.body}</span>
                </span>
              ) : (
                "No single submission-created Lead Note could be identified."
              )}
            </dd>
          </div>
        </dl>
      </section>
    </AppShell>
  );
}

function DetailItem({ label, value }: { label: string; value: Date | string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ? String(value) : "Unavailable in this historical submission."}</dd>
    </div>
  );
}

function SubmittedCopyItem({
  copyLabel,
  label,
  value
}: {
  copyLabel: "email" | "phone";
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        {value ? (
          <span className="web-form-submitted-copy-value">
            <span>{value}</span>
            <CopySubmittedFieldControl label={copyLabel} value={value} />
          </span>
        ) : (
          "Unavailable in this historical submission."
        )}
      </dd>
    </div>
  );
}

function buildBackHref(
  webFormId: string,
  query:
    | {
        form?: string | string[];
        from?: string | string[];
        q?: string | string[];
        returnTo?: string | string[];
        source?: string | string[];
        status?: string | string[];
        to?: string | string[];
      }
    | undefined
) {
  const returnTo = safeReturnTo(firstQueryValue(query?.returnTo), webFormId);
  if (returnTo) return returnTo as Route;

  const source = firstQueryValue(query?.source);
  const params = normalizedReturnParams(query, source === "all");
  if (source === "all") {
    const suffix = params.toString();
    return withReturnFocus(`/web-forms/submissions${suffix ? `?${suffix}` : ""}`) as Route;
  }

  const suffix = params.toString();
  return withReturnFocus(`/web-forms/${webFormId}${suffix ? `?${suffix}` : ""}`) as Route;
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function safeReturnTo(value: string | undefined, webFormId: string) {
  if (!value || value.startsWith("//")) return null;

  try {
    const url = new URL(value, "https://northstar.local");
    if (url.origin !== "https://northstar.local") return null;

    if (url.pathname === "/web-forms/submissions") {
      const params = normalizedReturnParams(Object.fromEntries(url.searchParams), true);
      const suffix = params.toString();
      return withReturnFocus(`/web-forms/submissions${suffix ? `?${suffix}` : ""}`);
    }

    if (url.pathname === `/web-forms/${webFormId}`) {
      const params = normalizedReturnParams(Object.fromEntries(url.searchParams), false);
      const suffix = params.toString();
      return withReturnFocus(`/web-forms/${webFormId}${suffix ? `?${suffix}` : ""}`);
    }
  } catch {
    return null;
  }

  return null;
}

function normalizedReturnParams(
  query:
    | {
        form?: string | string[];
        from?: string | string[];
        q?: string | string[];
        status?: string | string[];
        to?: string | string[];
      }
    | Record<string, string>
    | undefined,
  includeForm: boolean
) {
  const params = new URLSearchParams();
  const q = normalizeReturnQuery(firstQueryValue(query?.q));
  const from = normalizeReturnDate(firstQueryValue(query?.from));
  const to = normalizeReturnDate(firstQueryValue(query?.to));
  const status = normalizeReturnStatus(firstQueryValue(query?.status));
  const form = includeForm ? normalizeReturnId(firstQueryValue(query?.form)) : null;

  if (form) params.set("form", form);
  if (q) params.set("q", q);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (status) params.set("status", status);
  return params;
}

function normalizeReturnQuery(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return normalized || null;
}

function normalizeReturnDate(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeReturnStatus(value: string | undefined) {
  return value && VALID_RETURN_STATUSES.has(value) ? value : null;
}

function normalizeReturnId(value: string | undefined) {
  return value && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}

function withReturnFocus(path: string) {
  return `${path}#${RETURN_FOCUS_TARGET}`;
}

function leadStatusLabel(status: string) {
  return LEAD_STATUS_LABELS[status] ?? status;
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
