import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildDealAttentionBadges, salesAssistantThresholds } from "@/lib/sales-assistant";

const dashboardPage = readFileSync(join(process.cwd(), "app/dashboard/page.tsx"), "utf8");
const pipelineBoard = readFileSync(join(process.cwd(), "components/pipeline-board.tsx"), "utf8");
const pipelineService = readFileSync(join(process.cwd(), "lib/services/pipeline-service.ts"), "utf8");
const dealDetailPage = readFileSync(join(process.cwd(), "app/deals/[dealId]/page.tsx"), "utf8");
const salesAssistant = readFileSync(join(process.cwd(), "lib/sales-assistant.ts"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("Sales Assistant / Needs Attention v1", () => {
  it("classifies deterministic deal attention badges without AI or background jobs", () => {
    const now = new Date("2030-03-20T12:00:00.000Z");

    expect(buildDealAttentionBadges({ status: "OPEN", activities: [] }, now)).toEqual([
      { kind: "no-next-activity", label: "No next activity" }
    ]);
    expect(
      buildDealAttentionBadges(
        { status: "OPEN", activities: [{ dueAt: "2030-03-19T09:00:00.000Z" }] },
        now
      )
    ).toContainEqual({ kind: "overdue", label: "Overdue" });
    expect(
      buildDealAttentionBadges(
        { status: "OPEN", updatedAt: "2030-03-01T09:00:00.000Z", activities: [{ dueAt: "2030-04-01T09:00:00.000Z" }] },
        now
      )
    ).toContainEqual({ kind: "stale", label: "Stale" });
    expect(
      buildDealAttentionBadges(
        { status: "OPEN", contractFields: [{ key: "msa_status", name: "MSA Status", value: "Blocked" }] },
        now
      )
    ).toContainEqual({ kind: "contract-blocked", label: "Contract attention" });
    expect(
      buildDealAttentionBadges(
        { status: "OPEN", quotes: [{ status: "SENT", createdAt: "2030-03-01T00:00:00.000Z", updatedAt: "2030-03-01T00:00:00.000Z" }] },
        now
      )
    ).toContainEqual({ kind: "quote-waiting", label: "Quote waiting" });
    expect(
      buildDealAttentionBadges(
        { status: "OPEN", activities: [], emailLogs: [{ direction: "INBOUND", occurredAt: "2030-03-19T12:00:00.000Z" }] },
        now
      )
    ).toContainEqual({ kind: "email-follow-up", label: "Email follow-up" });
    expect(
      buildDealAttentionBadges({ status: "OPEN", expectedCloseAt: "2030-03-24T00:00:00.000Z" }, now)
    ).toContainEqual({ kind: "closing-soon", label: "Closing soon" });
  });

  it("documents the fixed assistant thresholds in code", () => {
    expect(salesAssistantThresholds).toMatchObject({
      closingSoonDays: 7,
      quoteWaitingDays: 7,
      recentInboundEmailDays: 7,
      staleDealDays: 14
    });
    expect(salesAssistant).toContain("No activity, note, quote, or email update");
    expect(salesAssistant).not.toContain("openai");
    expect(salesAssistant).not.toContain("automation");
  });

  it("adds a dashboard Needs Attention panel with friendly clean-workspace copy", () => {
    expect(dashboardPage).toContain("getNeedsAttentionSummary(actor)");
    expect(dashboardPage).toContain("NeedsAttentionPanel");
    expect(dashboardPage).toContain("Sales Assistant");
    expect(dashboardPage).toContain("Needs Attention");
    expect(dashboardPage).toContain("As you add real deals, activities, quotes, and emails");
    expect(dashboardPage).toContain("Overdue work, stale deals, waiting quotes, and contract follow-ups");
  });

  it("surfaces compact attention badges on pipeline cards using existing deal data", () => {
    expect(pipelineService).toContain("notes:");
    expect(pipelineService).toContain("emailLogs:");
    expect(pipelineService).toContain("quotes:");
    expect(pipelineBoard).toContain("buildDealAttentionBadges(deal).slice(0, 3)");
    expect(pipelineBoard).toContain("deal-card-badges");
    expect(pipelineBoard).toContain('import { AttentionBadge } from "@/components/attention-badge"');
    expect(pipelineBoard).toContain('classNamePrefix="deal-attention-badge"');
    expect(globalStyles).toContain(".stage-column");
    expect(globalStyles).toContain("min-width: 276px");
    expect(globalStyles).toContain(".stage-title");
    expect(globalStyles).toContain(".deal-card-detail strong");
    expect(globalStyles).toContain("-webkit-line-clamp: 2");
    expect(globalStyles).toContain(".pipeline-card-move");
    expect(globalStyles).toContain(".pipeline-card-move .button-compact");
    expect(salesAssistant).toContain("No next activity");
  });

  it("improves the deal detail Next Step panel with sales-assistant cues", () => {
    expect(dealDetailPage).toContain("listEmailLogsForRecord(actor, { type: \"DEAL\", id: deal.id })");
    expect(dealDetailPage).toContain("buildDealAttentionBadges");
    expect(dealDetailPage).toContain("deal-next-step-cues");
    expect(dealDetailPage).toContain("deal-next-step-cue");
    expect(dealDetailPage).toContain("title=\"Email follow-up\"");
    expect(dealDetailPage).toContain("A recent inbound email is linked to this deal");
    expect(dealDetailPage).toContain("Review contract workflow");
    expect(dealDetailPage).toContain("title=\"Quote follow-up\"");
    expect(dealDetailPage).toContain("A sent quote is waiting for a response");
    expect(globalStyles).toContain(".deal-next-step-cue");
    expect(globalStyles).toContain(".deal-next-step-card > strong");
    expect(globalStyles).toContain(".deal-next-step-card .empty-copy");
    expect(globalStyles).toContain(".deal-context-metrics strong");
  });
});
