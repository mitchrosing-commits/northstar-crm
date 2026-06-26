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
    expect(body).toEqual({
      status: "ok",
      service: "northstar-crm"
    });
  });
});
