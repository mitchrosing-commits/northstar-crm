import { afterAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/route";
import { disconnectPrisma } from "./fixtures";

describe("health route", () => {
  afterAll(async () => {
    await disconnectPrisma();
  });

  it("returns a generic ok response when env and database are ready", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body).toEqual({
      status: "ok",
      service: "northstar-crm"
    });
    expect(Object.keys(body).sort()).toEqual(["service", "status"]);
  });

  it("returns a generic error response when runtime env is invalid", async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "";

    try {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(body).toEqual({
        status: "error",
        service: "northstar-crm"
      });
      expect(Object.keys(body).sort()).toEqual(["service", "status"]);
      expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
      if (previousDatabaseUrl) {
        expect(JSON.stringify(body)).not.toContain(previousDatabaseUrl);
      }
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
