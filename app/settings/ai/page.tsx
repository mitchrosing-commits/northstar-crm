import Link from "next/link";
import type { Route } from "next";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/badge";
import { FormActionBar } from "@/components/form-action-bar";
import { FormFieldLabel } from "@/components/form-field-label";
import { PageHeader } from "@/components/page-header";
import { PanelTitleRow } from "@/components/panel-title-row";
import { getCurrentWorkspaceContext } from "@/lib/auth/request-context";
import {
  aiPreferenceOptions,
  draftAiPreferenceChangesFromText,
  getAiPreferences,
  listAiHygieneSuggestions
} from "@/lib/services/crm";

import { resetAiPreferencesAction, updateAiPreferencesAction } from "./actions";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ reset?: string; saved?: string }>;
};

export default async function AiSettingsPage({ searchParams }: PageProps) {
  const resolvedSearchParams = await searchParams;
  const { workspace, actor } = await getCurrentWorkspaceContext();
  const [preferences, hygieneSuggestions] = await Promise.all([
    getAiPreferences(actor),
    listAiHygieneSuggestions(actor)
  ]);
  const instructionDraft = preferences.naturalLanguageInstructions
    ? draftAiPreferenceChangesFromText(preferences.naturalLanguageInstructions)
    : null;

  return (
    <AppShell workspace={workspace}>
      <PageHeader
        actions={
          <Link className="button-secondary" href={"/settings" as Route}>
            Back to settings
          </Link>
        }
        eyebrow="AI settings"
        subtitle="Personalize review-first summaries, drafts, CRM hygiene checks, and Assistant detail without enabling automatic CRM changes."
        title="AI Preferences"
      />

      {resolvedSearchParams?.saved ? <p className="form-success">AI preferences saved.</p> : null}
      {resolvedSearchParams?.reset ? <p className="form-success">AI preferences reset to defaults.</p> : null}

      <section className="panel section-separated" id="ai-preferences">
        <PanelTitleRow
          actions={<Badge>Review-first</Badge>}
          description="Preferences guide AI explanations and defaults. Suggestions still require human review before anything is applied."
          title="Assistant Behavior"
        />
        <form action={updateAiPreferencesAction} className="inline-form section-spaced">
          <div className="form-grid">
            <PreferenceSelect
              defaultValue={preferences.assistantNamePreset}
              label="Assistant name"
              name="assistantNamePreset"
              options={aiPreferenceOptions.assistantNamePreset}
            />
            <label className="form-field">
              <FormFieldLabel>Custom assistant name</FormFieldLabel>
              <input defaultValue={preferences.assistantCustomName ?? ""} maxLength={40} name="assistantCustomName" placeholder="Use when Assistant name is Custom" />
            </label>
            <PreferenceSelect
              defaultValue={preferences.assistantTonePreset}
              label="Assistant tone"
              name="assistantTonePreset"
              options={aiPreferenceOptions.assistantTonePreset}
            />
            <PreferenceSelect
              defaultValue={preferences.recordSummaryStyle}
              label="Record summary style"
              name="recordSummaryStyle"
              options={aiPreferenceOptions.recordSummaryStyle}
            />
            <PreferenceSelect
              defaultValue={preferences.assistantDetailLevel}
              label="Assistant detail"
              name="assistantDetailLevel"
              options={aiPreferenceOptions.assistantDetailLevel}
            />
            <PreferenceSelect
              defaultValue={preferences.suggestionAggressiveness}
              label="Suggestion level"
              name="suggestionAggressiveness"
              options={aiPreferenceOptions.suggestionAggressiveness}
            />
            <PreferenceSelect
              defaultValue={preferences.diagnosticsDetailLevel}
              label="Diagnostics detail"
              name="diagnosticsDetailLevel"
              options={aiPreferenceOptions.diagnosticsDetailLevel}
            />
            <PreferenceSelect
              defaultValue={preferences.replyTone}
              label="Email reply tone"
              name="replyTone"
              options={aiPreferenceOptions.replyTone}
            />
            <PreferenceSelect
              defaultValue={preferences.emailSummaryLength}
              label="Stored email summaries"
              name="emailSummaryLength"
              options={aiPreferenceOptions.emailSummaryLength}
            />
            <PreferenceSelect
              defaultValue={preferences.relationshipMemoryUsage}
              label="Relationship Memory usage"
              name="relationshipMemoryUsage"
              options={aiPreferenceOptions.relationshipMemoryUsage}
            />
            <PreferenceSelect
              defaultValue={preferences.meetingIntelligenceNoteStyle}
              label="Meeting notes"
              name="meetingIntelligenceNoteStyle"
              options={aiPreferenceOptions.meetingIntelligenceNoteStyle}
            />
            <label className="form-field form-field-wide">
              <FormFieldLabel>Natural language guidance</FormFieldLabel>
              <textarea
                defaultValue={preferences.naturalLanguageInstructions ?? ""}
                maxLength={1200}
                name="naturalLanguageInstructions"
                rows={4}
              />
            </label>
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
                  <span>{labelFromValue(area)}</span>
                </label>
              ))}
            </fieldset>
            <label className="form-field form-field-wide">
              <FormFieldLabel>Onboarding goals</FormFieldLabel>
              <textarea
                defaultValue={preferences.onboardingGoals ?? ""}
                maxLength={1200}
                name="onboardingGoals"
                placeholder="Tell Northstar what you want help setting up first."
                rows={3}
              />
            </label>
          </div>
          {instructionDraft ? (
            <div className="ai-preference-draft">
              <strong>Preference parser preview</strong>
              <span>{instructionDraft.summary}</span>
              {Object.keys(instructionDraft.proposedChanges).length > 0 ? (
                <span>{Object.entries(instructionDraft.proposedChanges).map(([key, value]) => `${labelFromValue(key)}: ${labelFromValue(String(value))}`).join(" · ")}</span>
              ) : null}
            </div>
          ) : null}
          <FormActionBar isSaving={false} submitActionLabel="Save AI preferences" submitLabel="Save preferences" />
        </form>
        <form action={resetAiPreferencesAction} className="section-spaced">
          <button className="button-secondary button-compact" type="submit">
            Reset to defaults
          </button>
        </form>
      </section>

      <section className="panel section-separated" id="ai-hygiene">
        <PanelTitleRow
          actions={<Badge>{hygieneSuggestions.length} review items</Badge>}
          description="Workspace-scoped cleanup suggestions. Northstar does not merge, link, or rewrite records from this panel."
          title="CRM Hygiene Suggestions"
        />
        {hygieneSuggestions.length > 0 ? (
          <ul className="northstar-assistant-list section-spaced">
            {hygieneSuggestions.slice(0, 8).map((suggestion) => (
              <li key={suggestion.id}>
                <strong>{suggestion.title}</strong>
                <span>{suggestion.detail}</span>
                <small>{suggestion.evidence.slice(0, 3).join(" · ")} · Review before apply</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-copy section-separated">No obvious duplicate, stale follow-up, or unlinked email hygiene issues were found in the current workspace snapshot.</p>
        )}
      </section>

      <section className="panel section-separated">
        <PanelTitleRow actions={<Badge>Reserved</Badge>} title="Future AI Preferences" />
        <p className="empty-copy section-separated">
          Provider-specific model choice, automatic email body summarization, and background digest cadence are reserved until the underlying sync and review flows are ready.
        </p>
      </section>
    </AppShell>
  );
}

function PreferenceSelect<T extends readonly string[]>({
  defaultValue,
  label,
  name,
  options
}: {
  defaultValue: T[number];
  label: string;
  name: string;
  options: T;
}) {
  return (
    <label className="form-field">
      <FormFieldLabel>{label}</FormFieldLabel>
      <select defaultValue={defaultValue} name={name}>
        {options.map((option) => (
          <option key={option} value={option}>
            {labelFromValue(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function labelFromValue(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
