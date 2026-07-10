import type { Metadata } from "next";

import { EmptyState } from "@/components/empty-state";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormFieldLabel } from "@/components/form-field-label";
import { FormSuccessMessage } from "@/components/form-success-message";
import { ApiError } from "@/lib/api/responses";
import { getPublicSchedulerLinkByToken } from "@/lib/services/crm";
import { submitPublicSchedulerBookingAction } from "./actions";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Schedule a meeting",
  robots: {
    index: false,
    follow: false,
    nocache: true
  }
};

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ booked?: string; error?: string; unavailable?: string }>;
};

export default async function PublicSchedulerPage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const query = await searchParams;
  const schedulerLink = await getPublicSchedulerLinkByToken(token).catch((error: unknown) => {
    if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
    throw error;
  });

  if (!schedulerLink || query?.unavailable === "1") {
    return (
      <main className="public-form-page">
        <section className="public-form-sheet">
          <EmptyState
            as="section"
            className="empty-state-panel"
            description="This scheduling link is unavailable. Please contact the team another way."
            title="Scheduling unavailable"
            titleLevel="h1"
          />
        </section>
      </main>
    );
  }

  if (query?.booked === "1") {
    return (
      <main className="public-form-page">
        <section className="public-form-sheet">
          <FormSuccessMessage>Your booking request was received. The team can follow up from the meeting activity.</FormSuccessMessage>
        </section>
      </main>
    );
  }

  return (
    <main className="public-form-page">
      <section className="public-form-sheet">
        <header className="public-form-header">
          <p className="page-kicker">Northstar-configured availability</p>
          <h1 className="page-title">{schedulerLink.meetingTitle}</h1>
          {schedulerLink.description ? <p className="public-form-description">{schedulerLink.description}</p> : null}
          <dl className="scheduler-public-summary">
            <div>
              <dt>Duration</dt>
              <dd>{schedulerLink.durationMinutes} minutes</dd>
            </div>
            <div>
              <dt>Timezone</dt>
              <dd>{schedulerLink.timezone}</dd>
            </div>
          </dl>
        </header>

        {query?.error === "validation" ? (
          <FormErrorMessage>Please choose an available time and enter your name and valid email.</FormErrorMessage>
        ) : null}

        {schedulerLink.choices.length > 0 ? (
          <form action={submitPublicSchedulerBookingAction} className="public-form">
            <input name="token" type="hidden" value={token} />
            <div aria-hidden="true" className="web-form-honeypot">
              <label>
                Company website
                <input autoComplete="off" name="website" tabIndex={-1} />
              </label>
            </div>
            <fieldset className="scheduler-public-times">
              <legend>Available choices</legend>
              {schedulerLink.choices.map((choice, index) => (
                <label className="scheduler-public-time-option" key={choice.value}>
                  <input defaultChecked={index === 0} name="startAt" required type="radio" value={choice.value} />
                  <span>{choice.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="form-field">
              <FormFieldLabel required>Your name</FormFieldLabel>
              <input autoComplete="name" maxLength={120} name="attendeeName" placeholder="Jordan Lee" required />
            </label>
            <label className="form-field">
              <FormFieldLabel required>Email</FormFieldLabel>
              <input autoComplete="email" maxLength={254} name="attendeeEmail" placeholder="jordan@example.com" required type="email" />
            </label>
            <label className="form-field">
              <FormFieldLabel>Company</FormFieldLabel>
              <input autoComplete="organization" maxLength={120} name="attendeeCompany" placeholder="Acme Co." />
            </label>
            <label className="form-field">
              <FormFieldLabel>Note</FormFieldLabel>
              <textarea maxLength={1200} name="attendeeNote" placeholder="Anything the team should know before the meeting?" rows={4} />
            </label>
            <div className="form-actions">
              <button className="button-primary" type="submit">
                Request booking
              </button>
            </div>
          </form>
        ) : (
          <EmptyState
            className="empty-state-compact empty-state-panel"
            description="No Northstar-configured times are currently available. Please contact the team another way."
            title="No times available"
            titleLevel="h2"
          />
        )}
      </section>
    </main>
  );
}
