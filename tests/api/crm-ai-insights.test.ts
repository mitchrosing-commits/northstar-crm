import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildActivityQueueAiInsight,
  buildDashboardAiInsight,
  buildLeadQualificationAiInsight
} from "@/lib/services/crm-ai-insight-service";

const serviceSource = readFileSync(join(process.cwd(), "lib/services/crm-ai-insight-service.ts"), "utf8");
const componentSource = readFileSync(join(process.cwd(), "components/crm-ai-insight-card.tsx"), "utf8");
const crmBarrel = readFileSync(join(process.cwd(), "lib/services/crm.ts"), "utf8");
const dashboardPage = readFileSync(join(process.cwd(), "app/dashboard/page.tsx"), "utf8");
const activitiesPage = readFileSync(join(process.cwd(), "app/activities/page.tsx"), "utf8");
const leadsPage = readFileSync(join(process.cwd(), "app/leads/page.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

describe("CRM AI insights", () => {
  it("builds a review-first dashboard work focus without mutating CRM records", () => {
    const insight = buildDashboardAiInsight(
      {
        commercialSnapshot: {
          draftQuotes: 1,
          openDealsWithoutQuotes: 2,
          openValueWithoutLineItems: 1
        },
        metrics: {
          activeLeadsMissingNextActivity: 3,
          dueTodayActivitiesCount: 2,
          openDealsCount: 5,
          overdueActivitiesCount: 4
        },
        onboarding: { isCleanWorkspace: false },
        pipelineHealth: { openDealsWithoutNextActivity: 2 }
      },
      [{ reason: "A deal needs source review.", title: "Deal needs review" }],
      fixedNow()
    );

    expect(insight.reviewFirst).toBe(true);
    expect(insight.summary).toContain("review-first suggestions");
    expect(insight.items).toHaveLength(4);
    expect(insight.items.every((item) => item.reviewFirst)).toBe(true);
    expect(insight.items[0]).toMatchObject({
      href: "/activities?status=open&due=overdue",
      tone: "attention"
    });
    expect(JSON.stringify(insight)).not.toMatch(secretOrInternalTerms);
  });

  it("prioritizes activity queues from due dates, links, and filters only", () => {
    const insight = buildActivityQueueAiInsight(
      {
        hasActiveFilters: true,
        query: "renewal",
        summary: {
          completedRecently: 1,
          dueToday: 2,
          openTotal: 8,
          overdue: 1,
          unscheduled: 3,
          upcoming: 2
        },
        visibleActivities: [
          {
            completedAt: null,
            dueAt: null,
            title: "Review renewal"
          }
        ]
      },
      fixedNow()
    );

    expect(insight.reviewFirst).toBe(true);
    expect(insight.sourceBasis).toContain("Current list filters");
    expect(JSON.stringify(insight)).toContain("Clear filters before treating this as the whole queue.");
    expect(JSON.stringify(insight)).toContain("/activities?status=open&due=unscheduled");
    expect(JSON.stringify(insight)).not.toMatch(secretOrInternalTerms);
  });

  it("surfaces lead qualification gaps without converting or editing leads", () => {
    const insight = buildLeadQualificationAiInsight(
      [
        {
          activities: [],
          organization: null,
          owner: null,
          person: null,
          source: null,
          status: "NEW",
          title: "Acme inquiry"
        },
        {
          activities: [{ dueAt: "2030-01-03T12:00:00.000Z" }],
          organization: { name: "Northstar Foods" },
          owner: { email: "owner@example.test", name: null },
          person: null,
          source: "Referral",
          status: "QUALIFIED",
          title: "Expansion lead"
        }
      ],
      fixedNow()
    );

    expect(insight.reviewFirst).toBe(true);
    expect(insight.title).toBe("AI lead qualification");
    expect(insight.summary).toContain("Review each lead before editing or converting.");
    expect(JSON.stringify(insight)).toContain("/leads?followUp=missing");
    expect(JSON.stringify(insight)).not.toMatch(secretOrInternalTerms);
  });

  it("renders reusable compact cards on three major surfaces", () => {
    expect(crmBarrel).toContain('export * from "./crm-ai-insight-service"');
    expect(componentSource).toContain("Suggestions are review-first");
    expect(componentSource).toContain("does not apply CRM changes automatically");
    expect(componentSource).toContain("sourceBasis.join");
    expect(dashboardPage).toContain("buildDashboardAiInsight(summary, needsAttention)");
    expect(dashboardPage).toContain("<CrmAiInsightCard insight={dashboardAiInsight} />");
    expect(activitiesPage).toContain("buildActivityQueueAiInsight");
    expect(activitiesPage).toContain("<CrmAiInsightCard insight={activityAiInsight} />");
    expect(leadsPage).toContain("buildLeadQualificationAiInsight(allLeads)");
    expect(leadsPage).toContain("<CrmAiInsightCard insight={leadAiInsight} />");
    expect(globalStyles).toContain(".crm-ai-insight-card");
    expect(globalStyles).toContain(".crm-ai-insight-list");
  });

  it("keeps the insight layer deterministic and free of provider diagnostics", () => {
    expect(serviceSource).not.toContain("prisma.");
    expect(serviceSource).not.toContain("emailConnectionSecret");
    expect(serviceSource).not.toContain("encryptedAccessToken");
    expect(serviceSource).not.toContain("raw provider");
    expect(serviceSource).not.toMatch(/\b(create|update|delete|upsert)\s*\(/);
    expect(serviceSource).not.toMatch(secretOrInternalTerms);
  });
});

const secretOrInternalTerms = /\b(OAuth|token|secret|encrypted|provider payload|stack trace|internal diagnostic)\b/i;

function fixedNow() {
  return new Date("2030-01-02T12:00:00.000Z");
}
