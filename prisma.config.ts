import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig, env } from "prisma/config";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  engine: "classic",
  datasource: {
    url: env("DATABASE_URL")
  },
  migrations: {
    seed: "tsx prisma/seed.ts"
  }
});
