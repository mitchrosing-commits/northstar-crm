import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPublicWebFormUrl } from "@/lib/public-url";
import { redactSensitiveText } from "@/lib/security/redaction";
import { generatePublicWebFormToken } from "@/lib/services/web-form-service";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const service = readFileSync(join(process.cwd(), "lib/services/web-form-service.ts"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const adminPage = readFileSync(join(process.cwd(), "app/web-forms/page.tsx"), "utf8");
const allSubmissionsPage = readFileSync(join(process.cwd(), "app/web-forms/submissions/page.tsx"), "utf8");
const submissionDetailPage = readFileSync(join(process.cwd(), "app/web-forms/submissions/[submissionId]/page.tsx"), "utf8");
const submissionCopyControl = readFileSync(
  join(process.cwd(), "app/web-forms/submissions/[submissionId]/copy-submitted-field-control.tsx"),
  "utf8"
);
const adminActions = readFileSync(join(process.cwd(), "app/web-forms/actions.ts"), "utf8");
const publicPage = readFileSync(join(process.cwd(), "app/f/[token]/page.tsx"), "utf8");
const publicActions = readFileSync(join(process.cwd(), "app/f/[token]/actions.ts"), "utf8");
const linkControls = readFileSync(join(process.cwd(), "components/web-form-public-link-controls.tsx"), "utf8");
const navigation = readFileSync(join(process.cwd(), "lib/navigation.ts"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("web forms lead capture v1", () => {
  it("adds a focused schema for public lead capture without exposing sequential ids", () => {
    expect(schema).toContain("model WebForm");
    expect(schema).toContain("model WebFormSubmission");
    expect(schema).toContain("token               String              @unique");
    expect(schema).toContain("requireLeadTitle    Boolean             @default(false)");
    expect(schema).toContain("fingerprint      String");
    expect(schema).toContain("leadTitle        String?");
    expect(schema).toContain("personName       String?");
    expect(schema).toContain("organizationName String?");
    expect(schema).toContain("@@index([workspaceId, fingerprint, submittedAt])");
    expect(schema).toContain("webForms                    WebForm[]");
    expect(schema).toContain("webFormSubmissions          WebFormSubmission[]");
  });

  it("keeps lead capture behavior conservative and service-backed", () => {
    expect(crmBarrel).toContain('export * from "./web-form-service"');
    expect(service).toContain("export async function createWebForm");
    expect(service).toContain("export async function listWebForms");
    expect(service).toContain("export async function getWebFormReview");
    expect(service).toContain("export async function getWebFormSubmissionReview");
    expect(service).toContain("export async function getWebFormSubmissionDetail");
    expect(service).toContain("export async function getPublicWebFormByToken");
    expect(service).toContain("export async function submitPublicWebForm");
    expect(service).toContain("normalizeWebFormReviewFilters");
    expect(service).toContain("buildWebFormReviewSubmissionWhere");
    expect(service).toContain("WEB_FORM_REVIEW_SUBMISSION_LIMIT");
    expect(service).toContain("tx.lead.create");
    expect(service).toContain("tx.note.create");
    expect(service).toContain("web_form.submission_received");
    expect(service).toContain("lead.created_from_web_form");
    expect(service).toContain("honeypotFilled");
    expect(service).toContain("DUPLICATE_WINDOW_MS");
    expect(service).toContain("personName: normalized.personName");
    expect(service).toContain("message: normalized.message");
    expect(service).not.toContain("tx.deal.create");
    expect(service).not.toContain("createDeal");
    expect(service).not.toContain("sendEmail");
    expect(service).not.toContain("gmail.metadata");
  });

  it("exposes an internal Web Forms admin page and navigation item", () => {
    expect(navigation).toContain('href: "/web-forms" as Route');
    expect(navigation).toContain('label: "Web Forms"');
    expect(navigation).toContain('helper: "Lead capture"');
    expect(adminPage).toContain("export default async function WebFormsPage");
    expect(adminPage).toContain("createWebFormAction");
    expect(adminPage).toContain("setWebFormEnabledAction");
    expect(adminPage).toContain("WebFormPublicLinkControls");
    expect(adminPage).toContain("buildPublicWebFormUrl");
    expect(adminPage).toContain("Latest activity");
    expect(adminPage).toContain('href="/web-forms/submissions"');
    expect(adminPage).toContain('href={`/web-forms/${webForm.id}` as Route}');
    expect(readFileSync(join(process.cwd(), "app/web-forms/[webFormId]/page.tsx"), "utf8")).toContain("getWebFormReview");
    expect(adminActions).toContain("createWebForm(actor");
    expect(adminActions).toContain("updateWebForm(actor");
    expect(linkControls).toContain("navigator.clipboard.writeText(publicUrl)");
  });

  it("adds an internal submission review page without public token leakage", () => {
    const reviewPage = readFileSync(join(process.cwd(), "app/web-forms/[webFormId]/page.tsx"), "utf8");

    expect(reviewPage).toContain("export default async function WebFormReviewPage");
    expect(reviewPage).toContain("Recent Accepted Submissions");
    expect(reviewPage).toContain("Filter Submissions");
    expect(reviewPage).toContain('name="q"');
    expect(reviewPage).toContain('name="from"');
    expect(reviewPage).toContain('name="to"');
    expect(reviewPage).toContain('name="status"');
    expect(reviewPage).toContain("Clear filters");
    expect(reviewPage).toContain("No submissions match these filters");
    expect(reviewPage).toContain("Accepted submissions");
    expect(reviewPage).toContain("Latest accepted activity");
    expect(reviewPage).toContain("Suppressed duplicate and honeypot attempts are not shown");
    expect(reviewPage).toContain("submissionDetailHref");
    expect(reviewPage).toContain('href={`/leads/${submission.lead.id}` as Route}');
    expect(reviewPage).toContain('href={submissionDetailHref(submission.id, webForm)}');
    expect(reviewPage).toContain('id="accepted-submissions"');
    expect(reviewPage).toContain("tabIndex={-1}");
    expect(reviewPage).toContain("returnTo");
    expect(reviewPage).toContain("notFound()");
    expect(reviewPage).not.toContain(".token");
    expect(reviewPage).not.toContain("website");
  });

  it("adds an internal all-forms submissions page without public token leakage", () => {
    expect(allSubmissionsPage).toContain("export default async function WebFormSubmissionsPage");
    expect(allSubmissionsPage).toContain("getWebFormSubmissionReview");
    expect(allSubmissionsPage).toContain("Web Form Submissions");
    expect(allSubmissionsPage).toContain("Filter Submissions");
    expect(allSubmissionsPage).toContain('name="form"');
    expect(allSubmissionsPage).toContain('name="q"');
    expect(allSubmissionsPage).toContain('name="from"');
    expect(allSubmissionsPage).toContain('name="to"');
    expect(allSubmissionsPage).toContain('name="status"');
    expect(allSubmissionsPage).toContain("Clear filters");
    expect(allSubmissionsPage).toContain("No submissions match these filters");
    expect(allSubmissionsPage).toContain('href={`/leads/${submission.lead.id}` as Route}');
    expect(allSubmissionsPage).toContain('href={`/web-forms/${submission.webForm.id}` as Route}');
    expect(allSubmissionsPage).toContain("submissionDetailHref");
    expect(allSubmissionsPage).toContain("buildAllSubmissionsReturnHref");
    expect(allSubmissionsPage).toContain('href={submissionDetailHref(submission.id, review.filters)}');
    expect(allSubmissionsPage).toContain('id="accepted-submissions"');
    expect(allSubmissionsPage).toContain("tabIndex={-1}");
    expect(allSubmissionsPage).toContain("returnTo");
    expect(allSubmissionsPage).not.toContain(".token");
    expect(allSubmissionsPage).not.toContain("website");
  });

  it("adds an internal submission detail page without public token leakage or mutation", () => {
    expect(submissionDetailPage).toContain("export default async function WebFormSubmissionDetailPage");
    expect(submissionDetailPage).toContain("getWebFormSubmissionDetail");
    expect(submissionDetailPage).toContain("Submitted Values");
    expect(submissionDetailPage).toContain("Source Context");
    expect(submissionDetailPage).toContain("Linked CRM Records");
    expect(submissionDetailPage).toContain("Lead Note context");
    expect(submissionDetailPage).toContain("Back to Review");
    expect(submissionDetailPage).toContain("CopySubmittedFieldControl");
    expect(submissionDetailPage).toContain("Unavailable in this historical submission.");
    expect(submissionDetailPage).toContain("safeReturnTo");
    expect(submissionDetailPage).toContain("normalizedReturnParams");
    expect(submissionDetailPage).toContain('url.pathname === "/web-forms/submissions"');
    expect(submissionDetailPage).toContain('url.pathname === `/web-forms/${webFormId}`');
    expect(submissionDetailPage).toContain("RETURN_FOCUS_TARGET");
    expect(submissionDetailPage).toContain('href={`/leads/${submission.lead.id}` as Route}');
    expect(submissionDetailPage).toContain('href={`/web-forms/${submission.webForm.id}` as Route}');
    expect(submissionDetailPage).toContain("notFound()");
    expect(submissionDetailPage).not.toContain(".token");
    expect(submissionDetailPage).not.toContain("website");
    expect(submissionDetailPage).not.toContain("Action");
    expect(submissionDetailPage).not.toContain("form action");
    expect(submissionDetailPage).not.toContain("submitPublicWebForm");
    expect(submissionCopyControl).toContain('"use client"');
    expect(submissionCopyControl).toContain("navigator.clipboard.writeText(value)");
    expect(submissionCopyControl).toContain("Copy submitted");
    expect(submissionCopyControl).toContain("Submitted ${label} copied.");
    expect(submissionCopyControl).toContain("Submitted ${label} could not be copied.");
    expect(submissionCopyControl).not.toContain("console.");
    expect(globalStyles).toContain("#accepted-submissions:focus-visible");
    expect(globalStyles).toContain(".web-form-copy-control");
  });

  it("adds a public no-chrome form route with honeypot and safe states", () => {
    expect(publicPage).toContain("export default async function PublicWebFormPage");
    expect(publicPage).toContain("getPublicWebFormByToken");
    expect(publicPage).toContain("submitPublicWebFormAction");
    expect(publicPage).toContain('className="web-form-honeypot"');
    expect(publicPage).toContain('robots:');
    expect(publicPage).toContain("Form unavailable");
    expect(publicPage).toContain("Your request was received.");
    expect(publicPage).not.toContain("AppShell");
    expect(publicPage).not.toContain("PrimaryNav");
    expect(publicActions).toContain("submitPublicWebForm(token");
    expect(publicActions).toContain("?submitted=1");
    expect(publicActions).toContain("?error=validation");
    expect(globalStyles).toContain(".public-form-page");
    expect(globalStyles).toContain(".web-form-honeypot");
  });

  it("generates and redacts public form links safely", () => {
    const token = generatePublicWebFormToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    expect(buildPublicWebFormUrl("abc123", "https://crm.example.test")).toBe("https://crm.example.test/f/abc123");
    expect(
      buildPublicWebFormUrl("abc123", "http://crm.example.test", {
        NODE_ENV: "production"
      })
    ).toBe("/f/abc123");

    const redacted = redactSensitiveText(
      `Public form failed at https://crm.example.test/f/${token} and /f/${token}`
    );
    expect(redacted).toBe("Public form failed at https://crm.example.test/f/[redacted] and /f/[redacted]");
    expect(redacted).not.toContain(token);
  });
});
