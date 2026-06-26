import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const seed = readFileSync(join(process.cwd(), "prisma/seed.ts"), "utf8");

describe("seed data", () => {
  it("creates a coherent sample workspace graph", () => {
    expect(seed).toContain("northstar-revenue");
    expect(seed).toContain("New Business");
    expect(seed).toContain("Orbit Labs pilot");
    expect(seed).toContain("Canopy Works expansion");
    expect(seed).toContain("Implementation Risk");
    expect(seed).toContain("Contract Type");
    expect(seed).toContain("NDA Status");
    expect(seed).toContain("MSA Status");
    expect(seed).toContain("SOW Status");
    expect(seed).toContain("Preferred Channel");
    expect(seed).toContain("Industry Segment");
    expect(seed).toContain("Qualification Score");
    expect(seed).toContain("Northstar CRM Platform");
    expect(seed).toContain("Q-DEMO-0001");
    expect(seed).toContain("Q-DEMO-0006");
  });

  it("seeds visible quote and contract-status demo records for high-signal deals", () => {
    expect(seed).toContain("[\"atlasTraining\", \"success\", 1, \"Manager training and enablement package\", \"Q-DEMO-0006\", QuoteStatus.SENT]");
    expect(seed).toContain("[\"evergreenKiosk\", \"implementation\", 1, \"Station kiosk pilot implementation\", \"Q-DEMO-0005\", QuoteStatus.DRAFT]");
    expect(seed).toContain("return [\"Not Started\", \"Requested\", \"In Review\", \"Sent\", \"Signed\", \"Blocked\"]");
    expect(seed).toContain("entityId: deals.atlasTraining.id");
    expect(seed).toContain("entityId: deals.evergreenKiosk.id");
    expect(seed).toContain("value: \"Signed\"");
    expect(seed).toContain("value: \"Sent\"");
    expect(seed).toContain("value: \"Blocked\"");
  });

  it("seeds demo-only manual email logs for visible communication history", () => {
    expect(seed).toContain("await createEmailLogs(workspace.id, owners, organizations, people, deals)");
    expect(seed).toContain("NDA sent for Orbit enterprise expansion");
    expect(seed).toContain("MSA follow-up from Lumen legal");
    expect(seed).toContain("Quote shared for manager training package");
    expect(seed).toContain("SOW review blocker for kiosk pilot");
    expect(seed).toContain("EmailDirection.OUTBOUND");
    expect(seed).toContain("EmailDirection.INBOUND");
    expect(seed).toContain("Q-DEMO-0006");
  });

  it("resets tenant data in dependency order before reseeding", () => {
    const order = [
      "auditLog.deleteMany",
      "savedView.deleteMany",
      "customFieldValue.deleteMany",
      "customFieldDefinition.deleteMany",
      "emailLog.deleteMany",
      "emailTemplate.deleteMany",
      "quotePublicLink.deleteMany",
      "quoteItem.deleteMany",
      "quote.deleteMany",
      "dealLineItem.deleteMany",
      "note.deleteMany",
      "activity.deleteMany",
      "deal.deleteMany",
      "lead.deleteMany",
      "person.deleteMany",
      "organization.deleteMany",
      "product.deleteMany",
      "pipelineStage.deleteMany",
      "pipeline.deleteMany"
    ];

    for (const operation of order) {
      expect(seed).toContain(operation);
    }
  });
});
