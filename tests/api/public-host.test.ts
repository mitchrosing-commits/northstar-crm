import { describe, expect, it } from "vitest";

import { isLocalDevelopmentHost, isPublicHost, isPublicHttpsUrl } from "@/lib/public-host";

describe("public host classification", () => {
  it("rejects local and private network hosts in direct and canonicalized URL forms", () => {
    for (const rawUrl of [
      "https://localhost:3000",
      "https://127.0.0.1",
      "https://10.0.0.5",
      "https://172.16.0.10",
      "https://192.168.1.10",
      "https://192.0.2.10",
      "https://2130706433",
      "https://0x7f.0.0.1",
      "https://0300.0250.0001.0012",
      "https://[::1]",
      "https://[fd00::1]",
      "https://[fe80::1]",
      "https://[2001:db8::1]",
      "https://[::ffff:192.168.1.10]",
      "https://[::192.168.1.10]",
      "https://[64:ff9b::192.168.1.10]"
    ]) {
      expect(isPublicHttpsUrl(new URL(rawUrl)), rawUrl).toBe(false);
    }
  });

  it("allows normal public HTTPS hosts and public embedded IPv4 forms", () => {
    expect(isPublicHttpsUrl(new URL("https://crm.example.test"))).toBe(true);
    expect(isPublicHttpsUrl(new URL("https://8.8.8.8"))).toBe(true);
    expect(isPublicHttpsUrl(new URL("https://[::8.8.8.8]"))).toBe(true);
    expect(isPublicHttpsUrl(new URL("https://[64:ff9b::8.8.8.8]"))).toBe(true);
  });

  it("requires HTTPS and forbids embedded URL credentials for public app URLs", () => {
    expect(isPublicHttpsUrl(new URL("http://crm.example.test"))).toBe(false);
    expect(isPublicHttpsUrl(new URL("https://preview:secret@crm.example.test"))).toBe(false);
  });

  it("keeps local-development host detection narrow", () => {
    expect(isLocalDevelopmentHost("localhost")).toBe(true);
    expect(isLocalDevelopmentHost("app.localhost")).toBe(true);
    expect(isLocalDevelopmentHost("127.0.0.1")).toBe(true);
    expect(isLocalDevelopmentHost("0.0.0.0")).toBe(true);
    expect(isLocalDevelopmentHost("crm.example.test")).toBe(false);
    expect(isPublicHost("crm.example.test")).toBe(true);
  });
});
