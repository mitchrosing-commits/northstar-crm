import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appShell = readFileSync(join(process.cwd(), "components/app-shell.tsx"), "utf8");
const primaryNav = readFileSync(join(process.cwd(), "components/primary-nav.tsx"), "utf8");
const globalStyles = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const smokeSpec = readFileSync(join(process.cwd(), "tests/browser/smoke.spec.ts"), "utf8");

describe("main navigation visibility", () => {
  it("keeps Settings in the primary navigation and workspace shortcut area", () => {
    expect(primaryNav).toContain("href: \"/settings\"");
    expect(primaryNav).toContain("label: \"Settings\"");
    expect(appShell).toContain("sidebar-settings-link");
    expect(appShell).toContain("Settings");
  });

  it("prevents the fixed desktop sidebar from hiding lower navigation items", () => {
    expect(globalStyles).toContain(".sidebar {\n  position: sticky;");
    expect(globalStyles).toContain("display: flex;");
    expect(globalStyles).toContain("flex-direction: column;");
    expect(globalStyles).toContain(".sidebar nav");
    expect(globalStyles).toContain("overflow-y: auto;");
    expect(globalStyles).toContain("margin-top: auto;");
    expect(globalStyles).not.toContain("bottom: 16px;\n  left: 16px;");
  });

  it("browser smoke verifies the Settings link is visible and usable from the app shell", () => {
    expect(smokeSpec).toContain("sidebar-settings-link");
    expect(smokeSpec).toContain("Expected Settings shortcut to be visible in the app shell");
    expect(smokeSpec).toContain("await settingsShortcut.click()");
  });
});
