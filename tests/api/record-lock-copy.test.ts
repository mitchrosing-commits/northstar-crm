import { describe, expect, it } from "vitest";

import {
  closedDealLockedLabel,
  closedDealLockMessage,
  convertedLeadLockedLabel,
  convertedLeadLockMessage,
} from "@/lib/record-lock-copy";

describe("record lifecycle lock copy", () => {
  it("keeps closed-deal lock messages consistent across record panels", () => {
    expect(closedDealLockedLabel).toBe("Closed deal locked");
    expect(closedDealLockMessage("stage")).toBe("Stage movement is locked after a deal is closed.");
    expect(closedDealLockMessage("contractWorkflow")).toBe(
      "Closed deals are locked. Contract workflow steps are read-only.",
    );
    expect(closedDealLockMessage("quoteDrafts")).toBe("Closed deals are locked. Quote drafts are read-only.");
    expect(closedDealLockMessage("customFields")).toBe("Closed deals are locked. Custom fields are read-only.");
    expect(closedDealLockMessage("activities")).toBe("Closed deals are locked. Activities are read-only.");
    expect(closedDealLockMessage("notes")).toBe("Closed deals are locked. Notes are read-only.");
    expect(closedDealLockMessage("emailLogs")).toBe("Closed deals are locked. Email logs are read-only.");
  });

  it("keeps converted-lead lock messages consistent across record panels", () => {
    expect(convertedLeadLockedLabel).toBe("Converted lead locked");
    expect(convertedLeadLockMessage("customFields")).toBe(
      "This lead has been converted. Custom fields are read-only.",
    );
    expect(convertedLeadLockMessage("activities")).toBe(
      "This lead has been converted. Create follow-up activities on the converted deal.",
    );
    expect(convertedLeadLockMessage("notes")).toBe(
      "This lead has been converted. Add new context on the converted deal.",
    );
    expect(convertedLeadLockMessage("emailLogs")).toBe(
      "This lead has been converted. Log new email context on the converted deal.",
    );
  });
});
