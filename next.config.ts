import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1,
    parallelServerBuildTraces: false,
    parallelServerCompiles: false,
    staticGenerationMaxConcurrency: 1,
    staticGenerationMinPagesPerWorker: 1,
    workerThreads: false,
    webpackBuildWorker: false
  },
  generateBuildId: async () =>
    process.env.NEXT_BUILD_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "northstar-local-build",
  typedRoutes: true
};

export default nextConfig;
