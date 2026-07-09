import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import { ApiError } from "@/lib/api/responses";
import { getPublicWebFormByToken } from "@/lib/services/crm";
import { submitPublicWebFormAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Lead capture form",
  robots: {
    index: false,
    follow: false,
    nocache: true
  }
};

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string; submitted?: string; unavailable?: string }>;
};

export default async function PublicWebFormPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const query = await searchParams;
  const webForm = await getPublicWebFormByToken(token).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
    throw error;
  });

  if (!webForm || query?.unavailable === "1") {
    return (
      <main className="public-form-page">
        <section className="public-form-sheet">
          <EmptyState
            as="section"
            className="empty-state-panel"
            description="This form is unavailable. Please contact the team another way."
            title="Form unavailable"
            titleLevel="h1"
          />
        </section>
      </main>
    );
  }

  if (query?.submitted === "1") {
    return (
      <main className="public-form-page">
        <section className="public-form-sheet">
          <FormSuccessMessage>Your request was received. The team can follow up from the lead inbox.</FormSuccessMessage>
        </section>
      </main>
    );
  }

  return (
    <main className="public-form-page">
      <section className="public-form-sheet">
        <header className="public-form-header">
          <p className="page-kicker">Lead capture</p>
          <h1 className="page-title">{webForm.publicTitle}</h1>
          {webForm.publicDescription ? <p className="public-form-description">{webForm.publicDescription}</p> : null}
        </header>

        {query?.error === "validation" ? (
          <FormErrorMessage>
            Please add a valid name, email, phone, company, message, or lead title before submitting.
          </FormErrorMessage>
        ) : null}

        <form action={submitPublicWebFormAction} className="public-form">
          <input name="token" type="hidden" value={token} />
          <div aria-hidden="true" className="web-form-honeypot">
            <label>
              Company website
              <input autoComplete="off" name="website" tabIndex={-1} />
            </label>
          </div>
          <label className="form-field">
            <FormFieldLabel required={webForm.requireLeadTitle}>What should we call this?</FormFieldLabel>
            <input
              maxLength={160}
              name="leadTitle"
              placeholder="Implementation project, pricing question, partnership request"
              required={webForm.requireLeadTitle}
            />
          </label>
          <label className="form-field">
            <FormFieldLabel>Your name</FormFieldLabel>
            <input autoComplete="name" maxLength={120} name="personName" placeholder="Jordan Lee" />
          </label>
          <label className="form-field">
            <FormFieldLabel>Email</FormFieldLabel>
            <input autoComplete="email" maxLength={254} name="email" placeholder="jordan@example.com" type="email" />
          </label>
          <label className="form-field">
            <FormFieldLabel>Phone</FormFieldLabel>
            <input autoComplete="tel" maxLength={40} name="phone" placeholder="+1 555 0100" type="tel" />
          </label>
          <label className="form-field">
            <FormFieldLabel>Company</FormFieldLabel>
            <input autoComplete="organization" maxLength={120} name="organizationName" placeholder="Acme Co." />
          </label>
          <label className="form-field">
            <FormFieldLabel>Message</FormFieldLabel>
            <textarea maxLength={2000} name="message" placeholder="How can we help?" rows={5} />
          </label>
          <div className="form-actions">
            <button className="button-primary" type="submit">
              Submit
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
