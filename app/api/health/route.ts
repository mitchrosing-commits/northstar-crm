import { validateRuntimeEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const env = validateRuntimeEnv();

  if (!env.ok) {
    return healthResponse("error", 503);
  }

  try {
    const { prisma } = await import("@/lib/db/prisma");
    await prisma.$queryRaw`SELECT 1`;
    return healthResponse("ok", 200);
  } catch {
    return healthResponse("error", 503);
  }
}

function healthResponse(status: "ok" | "error", httpStatus: 200 | 503) {
  return Response.json(
    {
      status,
      service: "northstar-crm"
    },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff"
      },
      status: httpStatus
    }
  );
}
