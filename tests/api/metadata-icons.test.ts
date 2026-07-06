import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
const iconSvg = readFileSync(join(process.cwd(), "app/icon.svg"), "utf8");
const faviconIco = readFileSync(join(process.cwd(), "app/favicon.ico"));
const appleIcon = readFileSync(join(process.cwd(), "app/apple-icon.png"));

describe("app metadata icons", () => {
  it("wires Northstar favicon and app icons through root metadata", () => {
    expect(layout).toContain("applicationName: \"Northstar CRM\"");
    expect(layout).toContain("icons: {");
    expect(layout).toContain('{ url: "/favicon.ico", sizes: "any" }');
    expect(layout).toContain('{ url: "/icon.svg", type: "image/svg+xml" }');
    expect(layout).toContain('{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }');
    expect(layout).toContain("shortcut: [\"/favicon.ico\"]");
    expect(layout).toContain("appleWebApp");
    expect(layout).toContain("title: \"Northstar CRM\"");
  });

  it("ships small branded icon assets in Next app icon locations", () => {
    expect(existsSync(join(process.cwd(), "app/favicon.ico"))).toBe(true);
    expect(existsSync(join(process.cwd(), "app/icon.svg"))).toBe(true);
    expect(existsSync(join(process.cwd(), "app/apple-icon.png"))).toBe(true);
    expect(iconSvg).toContain("Northstar CRM icon");
    expect(iconSvg).toContain('fill="#0f766e"');
    expect(iconSvg).toContain('fill="#d9f99d"');
    expect(faviconIco.subarray(0, 6).toString("hex")).toBe("000001000300");
    expect(appleIcon.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
});
