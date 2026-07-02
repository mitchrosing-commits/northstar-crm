import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const meetingIntelligenceForm = readFileSync(
  join(process.cwd(), "components/meeting-intelligence-form.tsx"),
  "utf8",
);
const meetingIntelligencePage = readFileSync(
  join(process.cwd(), "app/meeting-intelligence/page.tsx"),
  "utf8",
);
const meetingIntelligenceReview = readFileSync(
  join(process.cwd(), "components/meeting-intelligence-review.tsx"),
  "utf8",
);
const meetingIntelligenceDetailPage = readFileSync(
  join(process.cwd(), "app/meeting-intelligence/[intakeId]/page.tsx"),
  "utf8",
);
const compactList = readFileSync(
  join(process.cwd(), "components/compact-list.tsx"),
  "utf8",
);

describe("meeting intelligence UX", () => {
  it("uses shared CRM primitives for intake, review, and result actions", () => {
    expect(meetingIntelligenceForm).toContain("FormActionBar");
    expect(meetingIntelligenceForm).toContain('submitLabel="Analyze intake"');
    expect(meetingIntelligenceForm).toContain("panel-actions-row");
    expect(meetingIntelligencePage).toContain("import { CompactList }");
    expect(meetingIntelligencePage).toContain(
      '<CompactList className="meeting-intake-list">',
    );
    expect(meetingIntelligencePage).toContain(
      'className="meeting-intake-row"',
    );
    expect(meetingIntelligencePage).not.toContain(
      '<div className="compact-list meeting-intake-list">',
    );

    expect(meetingIntelligenceReview).toContain("import { ActionGroup }");
    expect(meetingIntelligenceReview).toContain(
      'import { CompactList, CompactListItem } from "@/components/compact-list";',
    );
    expect(meetingIntelligenceReview).toContain("import { EmptyState }");
    expect(meetingIntelligenceReview).toContain("import { PanelTitleRow }");
    for (const titleRow of [
      '<PanelTitleRow title="Meeting Log" titleId="meeting-proposal-heading" />',
      '<PanelTitleRow title="Matches and Warnings" titleId="matches-heading" />',
      '<PanelTitleRow title="Proposed Notes" titleId="notes-heading" />',
      '<PanelTitleRow title="Follow-Ups" titleId="next-steps-heading" />',
      '<PanelTitleRow title="Normalized Markdown" titleId="markdown-preview-heading" />',
      '<PanelTitleRow title="Apply Summary" titleId="apply-summary-heading" />',
      '<PanelTitleRow title="Applied Updates" titleId="applied-updates-heading" />',
    ]) {
      expect(meetingIntelligenceReview).toContain(titleRow);
    }
    expect(meetingIntelligenceReview).toContain(
      'aria-labelledby="applied-updates-heading"',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<h2 className="panel-title" id="meeting-proposal-heading">',
    );
    expect(meetingIntelligenceReview).toContain("<CompactList>");
    expect(meetingIntelligenceReview).toContain("<CompactListItem>");
    expect(meetingIntelligenceReview).toContain("<CompactListItem key=");
    expect(meetingIntelligenceReview).toContain("import { CompactTitleRow }");
    expect(meetingIntelligenceReview).toContain('<CompactTitleRow title="Skipped" />');
    expect(meetingIntelligenceReview).not.toContain(
      '<h3 className="panel-title">Skipped</h3>',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<div className="compact-list">',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<div className="compact-list-item"',
    );
    expect(compactList).toContain("export function CompactList");
    expect(compactList).toContain("export function CompactListItem");
    expect(compactList).toContain('as?: "div" | "ul"');
    expect(compactList).toContain('as?: "div" | "li"');
    expect(compactList).toContain('"compact-list"');
    expect(compactList).toContain('"compact-list-item"');
    expect(meetingIntelligenceReview).toContain(
      'const createAnotherActionsLabel = "Applied meeting intake actions";',
    );
    expect(meetingIntelligenceReview).toContain(
      'const createAnotherActionLabel = "Create another meeting intelligence intake";',
    );
    expect(meetingIntelligenceReview).toContain(
      '<ActionGroup className="form-actions" label={createAnotherActionsLabel}>',
    );
    expect(meetingIntelligenceReview).toContain(
      "aria-label={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceReview).toContain(
      "title={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<div className="form-actions">',
    );
    for (const emptyTitle of [
      'title="No meeting activity proposed"',
      'title="No notes proposed"',
      'title="No follow-ups proposed"',
      'title="No CRM updates created"',
    ]) {
      expect(meetingIntelligenceReview).toContain(emptyTitle);
    }
    expect(meetingIntelligenceReview).toContain(
      'className="empty-state-compact empty-state-panel"',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<p className="muted">No notes are proposed.</p>',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<p className="muted">No next-step activities are proposed.</p>',
    );
    expect(meetingIntelligenceReview).not.toContain(
      '<p className="muted">No CRM updates were created.</p>',
    );

    expect(meetingIntelligenceDetailPage).toContain("import { ActionGroup }");
    expect(meetingIntelligenceDetailPage).toContain("import { EmptyState }");
    expect(meetingIntelligenceDetailPage).toContain(
      'const failedActionsLabel = "Failed meeting intake actions";',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      '<ActionGroup className="form-actions" label={failedActionsLabel}>',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      "aria-label={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceDetailPage).toContain(
      "title={createAnotherActionLabel}",
    );
    expect(meetingIntelligenceDetailPage).not.toContain(
      '<div className="form-actions">',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      '<EmptyState',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      'className="empty-state-compact"',
    );
    expect(meetingIntelligenceDetailPage).toContain(
      'title="No reviewable proposal yet"',
    );
    expect(meetingIntelligenceDetailPage).not.toContain(
      '<p className="muted">This intake does not have a reviewable proposal yet.</p>',
    );
  });
});
