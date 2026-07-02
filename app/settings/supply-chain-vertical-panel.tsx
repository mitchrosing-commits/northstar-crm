import { CompactList } from "@/components/compact-list";
import { FormErrorMessage } from "@/components/form-error-message";
import { FormIntroCallout } from "@/components/form-intro-callout";
import { FormSuccessMessage } from "@/components/form-success-message";
import {
  supplyChainDashboardQuestions,
  supplyChainDealFieldTemplates,
  supplyChainDeferredBoundaries,
  supplyChainSavedViewRecommendations,
  supplyChainServiceCatalogExamples
} from "@/lib/supply-chain-implementation-config";
import type { SupplyChainVerticalSetupStatus } from "@/lib/services/crm";
import { applySupplyChainVerticalSetupAction } from "./actions";
import { SettingsGuideCard } from "./settings-guide-card";
import { SettingsSection } from "./settings-section";

export function SupplyChainVerticalPanel({
  setupStatus,
  status
}: {
  setupStatus?: string;
  status: SupplyChainVerticalSetupStatus;
}) {
  const topDealFields = supplyChainDealFieldTemplates.slice(0, 5);
  const topViews = supplyChainSavedViewRecommendations.slice(0, 4);
  const topServices = supplyChainServiceCatalogExamples.slice(0, 6);
  const everythingApplied =
    status.customFields.missing === 0 &&
    status.savedViews.missing === 0 &&
    status.products.missing === 0;
  const setupActionLabel = everythingApplied
    ? "Recheck supply-chain implementation setup"
    : "Apply safe supply-chain implementation presets";

  return (
    <SettingsSection
      action={
        <form action={applySupplyChainVerticalSetupAction}>
          <button aria-label={setupActionLabel} className="button-primary" title={setupActionLabel} type="submit">
            {everythingApplied ? "Recheck setup" : "Apply safe presets"}
          </button>
        </form>
      }
      badge={everythingApplied ? "Configured" : "Optional setup"}
      intro="Apply optional CRM presets for teams selling advisory, software selection, implementation, optimization, and support work. This keeps Northstar a CRM, not a WMS, OMS, project system, or support desk."
      introClassName="empty-copy"
      title="Supply-chain implementation setup"
      titleId="supply-chain-vertical-title"
    >
      {setupStatus === "applied" ? (
        <FormSuccessMessage className="section-spaced">Supply-chain implementation setup was applied. Existing records were preserved.</FormSuccessMessage>
      ) : null}
      {setupStatus === "error" ? (
        <FormErrorMessage className="section-spaced">Supply-chain implementation setup could not be applied. No unsupported subsystem was created.</FormErrorMessage>
      ) : null}

      <div className="settings-setup-status-grid section-spaced" aria-label="Supply-chain setup status">
        <SetupStatusCard label="Custom fields" status={status.customFields} />
        <SetupStatusCard label="Saved views" status={status.savedViews} />
        <SetupStatusCard label="Service catalog" status={status.products} />
      </div>

      <div className="settings-guide-grid section-spaced">
        <SettingsGuideCard actionLabel="Configure custom fields" href="/custom-fields" title="Deal fields">
          <ul className="checklist">
            {topDealFields.map((field) => (
              <li key={field.key}>
                <strong>{field.name}</strong>
                <span>{field.use}</span>
              </li>
            ))}
          </ul>
        </SettingsGuideCard>

        <SettingsGuideCard actionLabel="Build saved views from filtered lists" href="/deals" title="Saved views">
          <ul className="checklist">
            {topViews.map((view) => (
              <li key={`${view.recordType}-${view.name}`}>
                <strong>{view.name}</strong>
                <span>{view.filterHint}</span>
              </li>
            ))}
          </ul>
        </SettingsGuideCard>

        <SettingsGuideCard actionLabel="Configure service catalog" href="/products" title="Service catalog">
          <ul className="checklist">
            {topServices.map((service) => (
              <li key={service}>
                <strong>{service}</strong>
                <span>Use as a product catalog item or quote line-item package.</span>
              </li>
            ))}
          </ul>
        </SettingsGuideCard>
      </div>

      <FormIntroCallout className="section-spaced supply-chain-dashboard-callout" title="Dashboard questions">
        {supplyChainDashboardQuestions.slice(0, 3).join(" ")}
      </FormIntroCallout>

      <FormIntroCallout
        className="supply-chain-boundary-callout"
        details={
          <CompactList as="ul">
            {status.unsupported.slice(0, 3).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </CompactList>
        }
        title="Kept out of this CRM setup"
      >
        {supplyChainDeferredBoundaries.join(" ")}
      </FormIntroCallout>
    </SettingsSection>
  );
}

function SetupStatusCard({
  label,
  status
}: {
  label: string;
  status: SupplyChainVerticalSetupStatus["customFields"];
}) {
  return (
    <div className="setup-status-card">
      <span>{label}</span>
      <strong>
        {status.existing}/{status.total} existing
      </strong>
      <small>
        {status.missing} missing
        {status.created ? `, ${status.created} just created` : ""}
        {status.skipped ? `, ${status.skipped} skipped` : ""}
        {status.deferred ? `, ${status.deferred} deferred` : ""}
      </small>
    </div>
  );
}
