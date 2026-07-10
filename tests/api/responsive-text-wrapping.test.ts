import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const globals = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const smoke = readFileSync(join(process.cwd(), "tests/browser/smoke.spec.ts"), "utf8");
const representativeLabels = [
  "app/activities/page.tsx",
  "app/email/page.tsx",
  "components/deal-close-actions.tsx",
  "components/assistant-today-command-center.tsx"
].map((filePath) => readFileSync(join(process.cwd(), filePath), "utf8")).join("\n");

describe("responsive text wrapping safeguards", () => {
  it("keeps shared UI labels on word-boundary wrapping instead of character stacking", () => {
    expect(globals).toContain("Shared text wrapping safeguards");
    expect(globals).toContain(".button-primary");
    expect(globals).toContain(".button-secondary");
    expect(globals).toContain(".button-compact");
    expect(globals).toContain(".badge");
    expect(globals).toContain(".count-badge");
    expect(globals).toContain(".search-action-link strong");
    expect(globals).toContain(".search-result-main > strong");
    expect(globals).toContain(".table-primary-cell strong");
    expect(globals).toContain(".table-secondary-text");
    expect(globals).toContain(".field-label");
    expect(globals).toContain(".field-value");
    expect(globals).toContain(".email-reader-participants");
    expect(globals).toContain(".meeting-prep-attendee");
    expect(globals).toContain("overflow-wrap: break-word;");
    expect(globals).toContain("word-break: normal;");
    expect(globals).not.toContain("word-break: break-all");
  });

  it("keeps long Email provider values breakable without weakening short label safeguards", () => {
    const providerBodyCss = cssBlock(".provider-card p");
    const providerBadgeCss = cssBlock(".provider-card .badge");
    const providerButtonCss = cssBlock(".provider-card .button-primary,\n.provider-card .button-secondary");
    const sharedSafeguardsCss = globals.match(/\/\* Shared text wrapping safeguards[\s\S]*?\.northstar-assistant-footer span \{[\s\S]*?\n\}/)?.[0] ?? "";

    expect(providerBodyCss).toContain("overflow-wrap: anywhere;");
    expect(providerBodyCss).toContain("word-break: normal;");
    expect(providerBadgeCss).toContain("overflow-wrap: break-word;");
    expect(providerBadgeCss).toContain("word-break: normal;");
    expect(providerButtonCss).toContain("overflow-wrap: break-word;");
    expect(providerButtonCss).toContain("word-break: normal;");
    expect(sharedSafeguardsCss).toContain("overflow-wrap: break-word;");
    expect(sharedSafeguardsCss).toContain("word-break: normal;");
    expect(sharedSafeguardsCss).not.toContain("overflow-wrap: anywhere;");
    expect(representativeLabels).toContain("Waiting on customer");
  });

  it("covers representative mobile pages for horizontal overflow and one-character text stacking", () => {
    expect(smoke).toContain("expectNoPageHorizontalOverflow(page, path)");
    expect(smoke).toContain("expectNoOneCharacterTextStacking(page, path)");
    expect(representativeLabels).toContain("Due today");
    expect(representativeLabels).toContain("Waiting on customer");
    expect(representativeLabels).toContain("Mark won");
    expect(representativeLabels).toContain("Show hidden");
    expect(smoke).toContain('"/dashboard"');
    expect(smoke).toContain('"/assistant"');
    expect(smoke).toContain('"/email"');
    expect(smoke).toContain('"/activities"');
    expect(smoke).toContain('"/pipeline"');
    expect(smoke).toContain('"/contacts"');
    expect(smoke).toContain('"/organizations"');
    expect(smoke).toContain('"/meeting-intelligence"');
    expect(smoke).toContain('"/products"');
    expect(smoke).toContain('"/quotes"');
    expect(smoke).toContain('"/web-forms"');
    expect(smoke).toContain('"/settings"');
  });
});

function cssBlock(selectorStart: string) {
  const escaped = selectorStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = globals.match(new RegExp(`${escaped} \\{[\\s\\S]*?\\n\\}`));
  return match?.[0] ?? "";
}
