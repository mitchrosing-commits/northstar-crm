import { NextRequest } from "next/server";

import { ApiError, created, handleApiError, json } from "@/lib/api/responses";
import { getRequestContext } from "@/lib/auth/request-context";
import { createWorkspace, listWorkspaces } from "@/lib/services/crm";
import { createWorkspaceSchema } from "@/lib/validators/crm";

export async function GET() {
  try {
    const { actorUserId } = await getRequestContext();
    return json(await listWorkspaces(actorUserId));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { actorUserId } = await getRequestContext();
    const payload = createWorkspaceSchema.parse(await body(request));
    return created(await createWorkspace(actorUserId, payload));
  } catch (error) {
    return handleApiError(error);
  }
}

async function body(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    if (request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new ApiError("VALIDATION_ERROR", "The request payload is invalid.", 422);
    }
    return {};
  }
}
