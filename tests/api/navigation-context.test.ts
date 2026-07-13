import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseReturnToHref, returnToLabel } from "@/lib/return-to";

const assistantPage = readFileSync(join(process.cwd(), "app/assistant/page.tsx"), "utf8");
const assistantConsole = readFileSync(join(process.cwd(), "components/assistant-console.tsx"), "utf8");
const assistantCommandForm = readFileSync(join(process.cwd(), "components/assistant-command-form.tsx"), "utf8");
const returnTo = readFileSync(join(process.cwd(), "lib/return-to.ts"), "utf8");

describe("navigation context and page density", () => {
  it("allows safe internal return targets with query and section anchors while rejecting external URLs", () => {
    expect(parseReturnToHref("/assistant?queue=applied#assistant-review-queue", "/dashboard")).toBe("/assistant?queue=applied#assistant-review-queue");
    expect(parseReturnToHref("/settings/ai?saved=1#ai-preferences", "/dashboard")).toBe("/settings/ai?saved=1#ai-preferences");
    expect(parseReturnToHref("/meeting-intelligence/intake_123#review", "/dashboard")).toBe("/meeting-intelligence/intake_123#review");
    expect(parseReturnToHref("/web-forms/form_123?q=Acme#accepted-submissions", "/dashboard")).toBe("/web-forms/form_123?q=Acme#accepted-submissions");
    expect(parseReturnToHref("/scheduler/link_123?updated=1#booking-requests", "/dashboard")).toBe("/scheduler/link_123?updated=1#booking-requests");
    expect(parseReturnToHref("/products?q=setup#catalog", "/dashboard")).toBe("/products?q=setup#catalog");
    expect(parseReturnToHref("/quotes?status=SENT#quote-list", "/dashboard")).toBe("/quotes?status=SENT#quote-list");
    expect(parseReturnToHref("https://evil.example.test/settings", "/dashboard")).toBe("/dashboard");
    expect(parseReturnToHref("//evil.example.test/settings", "/dashboard")).toBe("/dashboard");
    expect(parseReturnToHref("/api/v1/workspaces", "/dashboard")).toBe("/dashboard");
  });

  it("labels first-class return destinations without dropping users at generic page tops", () => {
    expect(returnToLabel("/assistant?queue=applied#assistant-review-queue")).toBe("Back to Assistant");
    expect(returnToLabel("/settings/ai?saved=1#ai-preferences")).toBe("Back to settings");
    expect(returnToLabel("/meeting-intelligence/intake_123#review")).toBe("Back to Meeting Intelligence");
    expect(returnToLabel("/web-forms/form_123?q=Acme#accepted-submissions")).toBe("Back to web forms");
    expect(returnToLabel("/scheduler/link_123?updated=1#booking-requests")).toBe("Back to scheduler");
    expect(returnToLabel("/products?q=setup#catalog")).toBe("Back to products");
    expect(returnToLabel("/quotes?status=SENT#quote-list")).toBe("Back to quotes");
    expect(returnTo).toContain('"/settings"');
    expect(returnTo).toContain('"/web-forms"');
    expect(returnTo).toContain('"/scheduler"');
    expect(returnTo).toContain('"/meeting-intelligence"');
  });

  it("adds compact Assistant section navigation and restores Ask results to the chat composer", () => {
    expect(assistantPage).toContain("RecordPanelJumpNav");
    expect(assistantPage).toContain('ariaLabel="Assistant page sections"');
    expect(assistantPage).toContain('href: "#assistant-chat-composer" as Route');
    expect(assistantPage).toContain('href: "#assistant-chat-thread" as Route');
    expect(assistantPage).toContain('href: "#assistant-today-command-center-title" as Route');
    expect(assistantPage).toContain('href: "#assistant-review-queue" as Route');
    expect(assistantPage).toContain('label="Sections"');
    expect(assistantConsole).toContain('id="assistant-ask"');
    expect(assistantConsole).toContain('id="assistant-chat-thread"');
    expect(assistantCommandForm).toContain('id="assistant-chat-composer"');
    expect(assistantCommandForm).toContain("sendAssistantConversationMessageAction");
  });
});
