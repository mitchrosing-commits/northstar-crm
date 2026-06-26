import { handleApiError, json } from "@/lib/api/responses";
import { getWorkspaceRequestContext } from "@/lib/auth/request-context";
import { getWorkspace } from "@/lib/services/crm";

type RouteContext = {
  params: Promise<{ workspaceId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { workspaceId } = await context.params;
    const { actor } = await getWorkspaceRequestContext(workspaceId);
    return json(await getWorkspace(actor));
  } catch (error) {
    return handleApiError(error);
  }
}
