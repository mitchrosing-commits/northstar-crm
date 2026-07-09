import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { FormActionBar } from "@/components/form-action-bar";
import { FormFieldLabel } from "@/components/form-field-label";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import { aiPreferenceOptions, getAiPreferences } from "@/lib/services/crm";

import { updateOnboardingAiPreferencesAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ saved?: string }>;
};

const coreAreas = [
  ["Dashboard / Today", "Start each day with urgent follow-ups, pipeline health, recent quotes, and setup next steps."],
  ["Inbox", "Review connected email context, priority signals, reply drafts, and follow-up suggestions when email is configured."],
  ["Contacts / Organizations", "Keep people, accounts, relationship context, notes, activities, and linked opportunities together."],
  ["Leads / Deals / Pipeline", "Capture early demand, qualify opportunities, and move deals through the New Business pipeline."],
  ["Products / Quotes", "Maintain the sellable catalog, scope deal line items, and create internal quote snapshots for review."],
  ["Web Forms", "Use public lead capture forms when that workspace feature is configured."],
  ["Meeting Intelligence", "Turn notes or transcripts into reviewable CRM suggestions without automatic writes."],
  ["Assistant", "Ask read-only CRM questions and draft supported low-risk work for review."]
] as const;

const currentPermissions = [
  "Answers read-only CRM questions from workspace-scoped context.",
  "Drafts actions and saves supported actions to the review queue.",
  "Applies only approved low-risk activity and note actions where already supported."
] as const;

const futurePermissions = [
  "Autonomous actions",
  "Contact, organization, deal, or quote creation",
  "Email send",
  "Relationship Memory writes",
  "AI preference automation"
] as const;

const toneDescriptions = {
  custom_later: "Custom later",
  detailed_analytical: "Detailed and analytical",
  direct_action_oriented: "Direct and action-oriented",
  professional_concise: "Professional and concise",
  warm_helpful: "Warm and helpful"
} as const;

const helpAreaLabels = {
  draft_email_replies: "Draft email replies",
  guide_around_app: "Guide around the app",
  help_create_quotes: "Help create quotes",
  prep_for_meetings: "Prep for meetings",
  prioritize_inbox: "Prioritize Inbox",
  suggest_crm_updates_from_emails: "Suggest CRM updates from emails",
  suggest_follow_ups: "Suggest follow-ups",
  summarize_contact_relationships: "Summarize contact relationships",
  watch_stale_deals: "Watch stale deals"
} as const;

export default async function OnboardingPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, user, actor } = await getCurrentWorkspaceContext();
  const preferences = await getAiPreferences(actor);
  const assistantDisplayName = preferences.assistantNamePreset === "Custom" && preferences.assistantCustomName
    ? preferences.assistantCustomName
    : preferences.assistantNamePreset;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link className="button-secondary" href={"/dashboard" as Route}>
            Go to dashboard
          </Link>
        }
        eyebrow="Guided setup"
        subtitle={`${assistantDisplayName} can help ${user.name ?? "you"} learn Northstar, choose review-first AI preferences, and decide what to set up first.`}
        title="First-Run AI-Guided Onboarding"
      />

      {resolvedSearchParams?.saved ? <p className="form-success">Onboarding preferences saved.</p> : null}

      <section className="onboarding-hero panel">
        <PanelTitleRow
          actions={<Badge>Review-first AI guide</Badge>}
          description="Northstar CRM keeps relationships, pipeline, follow-ups, products, quotes, and customer context in one workspace. Your AI guide helps you understand the system and prepare work, while you stay in control of every material change."
          title={`Meet ${assistantDisplayName}`}
        />
        <div className="onboarding-area-grid section-spaced" aria-label="Northstar core areas">
          {coreAreas.map(([title, description]) => (
            <article className="onboarding-area-card" key={title}>
              <strong>{title}</strong>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel section-separated" id="ai-guide-setup">
        <PanelTitleRow
          actions={<Badge>Preferences</Badge>}
          description="These choices personalize guidance and defaults. Help areas are preferences, not permission grants."
          title="Personalize Your AI Guide"
        />
        <form action={updateOnboardingAiPreferencesAction} className="inline-form section-spaced">
          <div className="form-grid">
            <fieldset className="form-field form-field-wide onboarding-choice-grid">
              <legend>Assistant name</legend>
              <p className="form-hint form-field-wide">Choose Stella, Nova, Lyra, Astra, Orion, Maris, Sage, or Custom.</p>
              {aiPreferenceOptions.assistantNamePreset.map((name) => (
                <label className="checkbox-card" key={name}>
                  <input
                    defaultChecked={preferences.assistantNamePreset === name}
                    name="assistantNamePreset"
                    type="radio"
                    value={name}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </fieldset>

            <label className="form-field form-field-wide">
              <FormFieldLabel>Custom name</FormFieldLabel>
              <input
                defaultValue={preferences.assistantCustomName ?? ""}
                maxLength={40}
                name="assistantCustomName"
                placeholder="Choose Custom, then enter a short name"
              />
            </label>

            <fieldset className="form-field form-field-wide onboarding-choice-grid">
              <legend>Assistant personality and tone</legend>
              {aiPreferenceOptions.assistantTonePreset.map((tone) => (
                <label className="checkbox-card" key={tone}>
                  <input
                    defaultChecked={preferences.assistantTonePreset === tone}
                    name="assistantTonePreset"
                    type="radio"
                    value={tone}
                  />
                  <span>{toneDescriptions[tone]}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="form-field form-field-wide onboarding-choice-grid">
              <legend>Where the assistant helps</legend>
              {aiPreferenceOptions.assistantHelpAreas.map((area) => (
                <label className="checkbox-card" key={area}>
                  <input
                    defaultChecked={preferences.assistantHelpAreas.includes(area)}
                    name="assistantHelpAreas"
                    type="checkbox"
                    value={area}
                  />
                  <span>{helpAreaLabels[area]}</span>
                </label>
              ))}
            </fieldset>

            <label className="form-field form-field-wide">
              <FormFieldLabel>Onboarding goals</FormFieldLabel>
              <textarea
                defaultValue={preferences.onboardingGoals ?? ""}
                maxLength={1200}
                name="onboardingGoals"
                placeholder="Example: help me import contacts, set up products, then create my first quote."
                rows={4}
              />
            </label>
          </div>
          <FormActionBar isSaving={false} submitActionLabel="Save onboarding preferences" submitLabel="Save onboarding preferences" />
        </form>
      </section>

      <section className="panel section-separated" id="assistant-permissions">
        <PanelTitleRow
          actions={<Badge>Current limits</Badge>}
          description="Permission level is fixed to review-first in this V1 setup. This page does not add any new Assistant apply paths."
          title="What Your AI Guide Can Do Today"
        />
        <div className="onboarding-permission-grid section-spaced">
          <div>
            <h3>Available now</h3>
            <ul className="onboarding-bullet-list">
              {currentPermissions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Future, not yet available</h3>
            <ul className="onboarding-bullet-list">
              {futurePermissions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
