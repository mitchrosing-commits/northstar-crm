import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const packageJson = readFileSync(join(process.cwd(), "package.json"), "utf8");
const packageManifest = JSON.parse(packageJson) as { scripts: Record<string, string> };
const railwayConfig = readFileSync(join(process.cwd(), "railway.json"), "utf8");
const railwayStartScript = readFileSync(join(process.cwd(), "scripts/railway-start.mjs"), "utf8");

describe("Railway service role startup", () => {
  it("uses a role-aware Railway start dispatcher", () => {
    expect(packageManifest.scripts["railway:start"]).toBe("node scripts/railway-start.mjs");
    expect(packageManifest.scripts.start).toBe("next start");
    expect(packageManifest.scripts["jobs:work"]).toBe("tsx scripts/jobs-work.ts");
    expect(railwayConfig).toContain("\"startCommand\": \"npm run railway:start\"");
  });

  it("runs the web app by default and the job worker when Railway service role is worker", () => {
    expect(railwayStartScript).toContain("RAILWAY_SERVICE_ROLE");
    expect(railwayStartScript).toContain("SERVICE_ROLE");
    expect(railwayStartScript).toContain("[\"worker\", \"jobs\", \"job-worker\"]");
    expect(railwayStartScript).toContain("runCommand(\"npm\", [\"run\", \"jobs:work\"])");
    expect(railwayStartScript).toContain("runCommand(\"npm\", [\"run\", \"start\"])");
    expect(railwayStartScript).toContain("northstar-crm-worker");
    expect(railwayStartScript).not.toContain("RESEND_API_KEY");
    expect(railwayStartScript).not.toContain("DATABASE_URL");
  });
});
