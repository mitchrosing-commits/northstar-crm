import { cookies } from "next/headers";

import { handleApiError } from "@/lib/api/responses";
import {
  activeWorkspaceCookieName,
  getRequestContext,
  resolveCurrentWorkspaceSelectionContext
} from "@/lib/auth/request-context";
import { generateQuotePdf, quotePdfFilename } from "@/lib/pdf/quote-pdf";
import { getQuote } from "@/lib/services/crm";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ dealId: string; quoteId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { dealId, quoteId } = await context.params;
    const requestContext = await getRequestContext();
    const cookieStore = await cookies();
    const { actor, workspace } = await resolveCurrentWorkspaceSelectionContext({
      actorUserId: requestContext.actorUserId,
      user: requestContext.user,
      selectedWorkspaceId: cookieStore.get(activeWorkspaceCookieName)?.value,
      fallbackWorkspaceSlug: process.env.DEV_WORKSPACE_SLUG ?? "northstar-revenue"
    });
    const quote = await getQuote(actor, dealId, quoteId);
    const pdf = generateQuotePdf({ workspaceName: workspace.name, quote });

    return new Response(pdf, {
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "content-disposition": `attachment; filename="${quotePdfFilename(quote.number)}"`,
        "content-type": "application/pdf",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
