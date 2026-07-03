import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const settingsPage = readFileSync(
  join(process.cwd(), "app/settings/page.tsx"),
  "utf8",
);
const settingsSection = readFileSync(
  join(process.cwd(), "app/settings/settings-section.tsx"),
  "utf8",
);
const settingsGuideCard = readFileSync(
  join(process.cwd(), "app/settings/settings-guide-card.tsx"),
  "utf8",
);
const emailTemplatesPanel = readFileSync(
  join(process.cwd(), "app/settings/email-templates-panel.tsx"),
  "utf8",
);
const supplyChainPanel = readFileSync(
  join(process.cwd(), "app/settings/supply-chain-vertical-panel.tsx"),
  "utf8",
);
const globalStyles = readFileSync(
  join(process.cwd(), "app/globals.css"),
  "utf8",
);
const inlineEmptyStateText = readFileSync(
  join(process.cwd(), "components/inline-empty-state-text.tsx"),
  "utf8",
);
const statCard = readFileSync(
  join(process.cwd(), "components/stat-card.tsx"),
  "utf8",
);

describe("settings admin UX patterns", () => {
  it("uses a shared settings section shell for repeated admin panels", () => {
    expect(settingsSection).toContain("export function SettingsSection");
    expect(settingsSection).toContain('className = "panel section-separated"');
    expect(settingsSection).toContain("PanelTitleRow");
    expect(settingsSection).toContain('import { Badge } from "@/components/badge"');
    expect(settingsSection).toContain(
      "const badgeLabel = badge ? `${title}: ${badge}` : undefined",
    );
    expect(settingsSection).toContain(
      "actions={action ?? (badge ? <Badge label={badgeLabel}>{badge}</Badge> : null)}",
    );
    expect(settingsSection).toContain(
      'introClassName = "empty-copy section-separated"',
    );
    expect(settingsSection).toContain("aria-labelledby={titleId}");
    expect(settingsSection).toContain("titleId={titleId}");
    expect(settingsGuideCard).toContain("export function SettingsGuideCard");
    expect(settingsGuideCard).toContain("CompactTitleRow");
    expect(settingsGuideCard).toContain('className="inline-link"');
    expect(settingsGuideCard).toContain('ComponentProps<typeof Link>["href"]');
    expect(settingsGuideCard).toContain(
      "const guideActionLabel = `${title}: ${actionLabel}`",
    );
    expect(settingsGuideCard).toContain("aria-label={guideActionLabel}");
    expect(settingsGuideCard).toContain("title={guideActionLabel}");
    expect(settingsPage).toContain("PanelTitleRow");
    expect(settingsPage).toContain("CompactTitleRow");
    expect(settingsPage).toContain("FormIntroCallout");
    expect(settingsPage).toContain("StatCard");
    expect(settingsPage).toContain('valueClassName="stat-value-compact"');
    expect(statCard).toContain("export function StatCard");
    expect(statCard).toContain('className="stat-card"');
    expect(settingsPage).toContain(
      'import { SettingsGuideCard } from "./settings-guide-card"',
    );
    expect(settingsPage).toContain(
      'import { SettingsSection } from "./settings-section"',
    );
    expect(settingsPage).toContain('title="Import / Export"');
    expect(settingsPage).toContain('title="Developer / API"');
    expect(settingsPage).toContain(
      'const importExportActionLabel = "Open import and export settings"',
    );
    expect(settingsPage).toContain(
      'const developerApiActionLabel = "Open developer API surface"',
    );
    expect(settingsPage).toContain("aria-label={importExportActionLabel}");
    expect(settingsPage).toContain("title={importExportActionLabel}");
    expect(settingsPage).toContain("Open import/export");
    expect(settingsPage).toContain("Download workspace-scoped CSV exports or preview CSV imports before creating records.");
    expect(settingsPage).toContain("aria-label={developerApiActionLabel}");
    expect(settingsPage).toContain("title={developerApiActionLabel}");
    expect(settingsPage).toContain('title="Hosted Use Notes"');
    expect(settingsPage).toContain('title="Create Workspace"');
    expect(settingsPage).toContain('title="Admin Readiness Checklist"');
    expect(settingsPage).toContain('title="Admin Guide"');
    expect(settingsPage).toContain('badge="Admin hub"');
    expect(settingsPage).toContain('aria-label="Settings admin guide"');
    expect(settingsPage).toContain('href="/custom-fields"');
    expect(settingsPage).toContain("Configure custom fields");
    expect(settingsPage).toContain("Open import/export");
    expect(settingsPage).toContain('href="#email-connections"');
    expect(settingsPage).toContain('title="Connection status"');
    expect(settingsPage).toContain('className="settings-status-callout"');
    expect(settingsPage).not.toContain(
      '{statusCopy ? <p className="empty-copy">{statusCopy}</p> : null}',
    );
    expect(globalStyles).toContain(".settings-status-callout");
    expect(settingsPage).toContain("Open developer API");
    expect(settingsPage).toContain("settings-guide-grid section-spaced");
    expect(settingsPage).not.toContain(
      '<CompactTitleRow title="Data model" />',
    );
    expect(settingsPage).not.toContain("panel-subtitle");
    expect(settingsPage).toContain('title="Pipeline / Stage Settings"');
    expect(settingsPage).toContain('badge="Workspace admin"');
    expect(settingsPage).toContain("InlineEmptyStateText");
    expect(settingsPage).toContain("<InlineEmptyStateText>Unknown</InlineEmptyStateText>");
    expect(settingsPage).toContain("<InlineEmptyStateText>No pending invitations.</InlineEmptyStateText>");
    expect(settingsPage).not.toContain("No pending invitations.\n                    </td>");
    expect(inlineEmptyStateText).toContain("inline-empty-state-text");
    expect(settingsPage).toContain('import { Badge } from "@/components/badge"');
    expect(settingsPage).toContain('actions={<Badge>{invitationEmailReadiness.configured ? "Email delivery configured" : "Manual link fallback"}</Badge>}');
    expect(settingsPage).toContain(
      '<Badge label={`${invitation.email} invited role: ${invitation.roleLabel}`}>',
    );
    expect(settingsPage).toContain("const invitationActionsLabel = `${invitation.email} invitation actions`");
    expect(settingsPage).toContain("label={invitationActionsLabel}");
    expect(settingsPage).toContain(
      '<Badge label={`${member.email} workspace role: ${member.roleLabel}`}>',
    );
    expect(settingsPage).not.toContain('<span className="badge">{invitation.roleLabel}</span>');
    expect(settingsPage).not.toContain('<span className="badge">{member.roleLabel}</span>');
    expect(settingsPage).toContain(
      "const membershipActionsLabel = `${member.email} membership actions`",
    );
    expect(settingsPage).toContain("function WorkspaceMemberActions");
    expect(settingsPage).toContain("type WorkspaceMemberSummary = Awaited<");
    expect(settingsPage).toContain("<WorkspaceMemberActions");
    expect(settingsPage).toContain("actorUserId={actorUserId}");
    expect(settingsPage).toContain("adminMemberCount={adminMemberCount}");
    expect(settingsPage).toContain("currentUserIsOwner={currentUserIsOwner}");
    expect(settingsPage).toContain("member={member}");
    expect(settingsPage).toContain("const roleActionLabel =");
    expect(settingsPage).toContain(
      "Make member: remove settings admin access for ${member.email}",
    );
    expect(settingsPage).toContain(
      "Make admin: grant settings admin access to ${member.email}",
    );
    expect(settingsPage).toContain(
      "const transferOwnerLabel = `Transfer workspace ownership to ${member.email}`",
    );
    expect(settingsPage).toContain(
      "const removeMemberLabel = `Remove ${member.email} from workspace`",
    );
    expect(settingsPage).toContain("import { ActionGroup }");
    expect(settingsPage).toContain("label={membershipActionsLabel}");
    expect(settingsPage).toContain('className="table-row-actions"');
    expect(settingsPage).toContain("const canRemoveMember = member.role !== \"ADMIN\" || currentUserIsOwner");
    expect(settingsPage).toContain("aria-label={roleActionLabel}");
    expect(settingsPage).toContain("title={roleActionLabel}");
    expect(settingsPage).toContain("aria-label={transferOwnerLabel}");
    expect(settingsPage).toContain("title={transferOwnerLabel}");
    expect(settingsPage).toContain("aria-label={removeMemberLabel}");
    expect(settingsPage).toContain("title={removeMemberLabel}");
    expect(settingsPage).toContain("function MemberActionStatus");
    expect(settingsPage).toContain('className="badge settings-member-action-status"');
    expect(settingsPage).toContain("label={label}");
    expect(settingsPage).toContain('<MemberActionStatus label="Current user" />');
    expect(settingsPage).toContain('<MemberActionStatus label="Owner removal blocked" />');
    expect(settingsPage).toContain('<MemberActionStatus label="Last admin" />');
    expect(settingsPage).toContain('<MemberActionStatus label="Owner action required" />');
    expect(settingsPage).not.toContain('<span className="muted">Current user</span>');
    expect(settingsPage).not.toContain('<span className="muted">Owner removal blocked</span>');
    expect(settingsPage).not.toContain('<span className="muted">Last admin</span>');
    expect(globalStyles).toContain(".settings-member-action-status");
    expect(settingsPage).toContain("label={`${status.label}: ${status.configured ? \"Configured\" : \"Needs setup\"}`}");
    expect(settingsPage).not.toContain('<span\n              className={status.configured ? "badge badge-qualified" : "badge"}');
    expect(settingsPage).toContain(
      "const stageActionsLabel = `${stage.name} stage actions`",
    );
    expect(settingsPage).toContain("import { FormActionBar }");
    expect(settingsPage).toContain("submitActionLabel={savePipelineLabel}");
    expect(settingsPage).toContain("actionsLabel={stageActionsLabel}");
    expect(settingsPage).toContain("submitActionLabel={saveStageLabel}");
    expect(settingsPage).toContain("submitActionLabel={addStageLabel}");
    expect(settingsPage).toContain('submitLabel="Save pipeline"');
    expect(settingsPage).toContain('submitLabel="Save stage"');
    expect(settingsPage).toContain('submitLabel="Add stage"');
    expect(settingsPage).toContain('className="form-hint">Stage removal deferred.</p>');
    expect(settingsPage).toContain(
      "const providerActionsLabel = `${provider.name} provider actions`",
    );
    expect(settingsPage).toContain("label={providerActionsLabel}");
    expect(settingsPage).toContain('className="filter-actions"');
    expect(settingsPage).toContain("import { FormFieldLabel }");
    expect(settingsPage).toContain(
      "<FormFieldLabel required>Pipeline name</FormFieldLabel>",
    );
    expect(settingsPage).toContain(
      "<FormFieldLabel required>Stage name</FormFieldLabel>",
    );
    expect(settingsPage).toContain(
      "<FormFieldLabel required>New stage</FormFieldLabel>",
    );
    expect(settingsPage).toContain(
      "<FormFieldLabel>Probability</FormFieldLabel>",
    );
    expect(supplyChainPanel).toContain("SettingsSection");
    expect(supplyChainPanel).toContain("const setupActionLabel = everythingApplied");
    expect(supplyChainPanel).toContain("Recheck supply-chain implementation setup");
    expect(supplyChainPanel).toContain("Apply safe supply-chain implementation presets");
    expect(supplyChainPanel).toContain("aria-label={setupActionLabel}");
    expect(supplyChainPanel).toContain("title={setupActionLabel}");
    expect(supplyChainPanel).toContain("SettingsGuideCard");
    expect(supplyChainPanel).toContain("FormSuccessMessage");
    expect(supplyChainPanel).toContain("FormErrorMessage");
    expect(supplyChainPanel).not.toContain(
      'className="form-success section-spaced"',
    );
    expect(supplyChainPanel).not.toContain(
      'className="form-error section-spaced"',
    );
    expect(supplyChainPanel).toContain("FormIntroCallout");
    expect(supplyChainPanel).toContain("supply-chain-dashboard-callout");
    expect(supplyChainPanel).toContain("supply-chain-boundary-callout");
    expect(supplyChainPanel).not.toContain("panel-subtitle");
    expect(supplyChainPanel).toContain('titleId="supply-chain-vertical-title"');
    expect(emailTemplatesPanel).toContain("FormIntroCallout");
    expect(emailTemplatesPanel).toContain("import { FormFieldLabel }");
    expect(emailTemplatesPanel).toContain(
      "<FormFieldLabel required>Name</FormFieldLabel>",
    );
    expect(emailTemplatesPanel).toContain(
      "<FormFieldLabel required>Subject</FormFieldLabel>",
    );
    expect(emailTemplatesPanel).toContain(
      "<FormFieldLabel required>Body</FormFieldLabel>",
    );
    expect(emailTemplatesPanel).toContain(
      'className="email-template-status-callout"',
    );
    expect(emailTemplatesPanel).toContain('title="Template status"');
    expect(emailTemplatesPanel).toContain(
      "const templateActionsLabel = `${template.name} template actions`",
    );
    expect(emailTemplatesPanel).toContain("import { ActionGroup }");
    expect(emailTemplatesPanel).toContain(
      '<ActionGroup className="filter-actions" label={templateActionsLabel}>',
    );
    expect(emailTemplatesPanel).not.toContain(
      '{notice ? <p className="empty-copy">{notice}</p> : null}',
    );
  });
});
