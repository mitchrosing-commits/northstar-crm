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
    expect(iconSvg).toContain("northstar-logo-gradient");
    expect(iconSvg).toContain('stop-color="#0f766e"');
    expect(iconSvg).toContain('stop-color="#1d4ed8"');
    expect(iconSvg).toContain('fill="none"');
    expect(iconSvg).toContain('stroke="#ffffff"');
    expect(iconSvg).toContain('stroke-linejoin="round"');
    expect(iconSvg).toContain('transform="translate(8 8) scale(2)"');
    expect(iconSvg).toContain(
      "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962",
    );
    expect(iconSvg).toContain("M20 3v4");
    expect(iconSvg).toContain("M22 5h-4");
    expect(faviconIco.subarray(0, 6).toString("hex")).toBe("000001000300");
    expect([0, 1, 2].map((entryIndex) => faviconIco[6 + entryIndex * 16])).toEqual([16, 32, 48]);
    expect([0, 1, 2].map((entryIndex) => faviconIco[7 + entryIndex * 16])).toEqual([16, 32, 48]);
    expect(appleIcon.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(appleIcon.readUInt32BE(16)).toBe(180);
    expect(appleIcon.readUInt32BE(20)).toBe(180);
  });
});
