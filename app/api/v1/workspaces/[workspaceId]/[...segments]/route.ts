import { NextRequest } from "next/server";

import { created, handleApiError, json, noContent, ApiError } from "@/lib/api/responses";
import { getWorkspaceRequestContext } from "@/lib/auth/request-context";
import { searchParamsToListSearchParams } from "@/lib/list-page-query";
import {
  createActivity,
  createCustomField,
  createDeal,
  createDealContractStep,
  createEmailLog,
  createEmailTemplate,
  createLead,
  createNote,
  createOrganization,
  createPerson,
  createPipeline,
  createProduct,
  createQuotePublicLink,
  createQuoteFromDeal,
  createDealLineItem,
  createStage,
  exportWorkspaceCsv,
  closeDeal,
  convertLeadToDeal,
  getDeal,
  getLead,
  getOrganization,
  getPerson,
  listActivities,
  listAuditLogs,
  listCustomFields,
  listDealContractSteps,
  listDeals,
  listEmailLogs,
  listEmailTemplates,
  listLeads,
  listMeetingIntakes,
  listNotes,
  listOrganizations,
  listPeople,
  listPipelines,
  listProducts,
  listStages,
  removeDealLineItem,
  reopenDeal,
  revokeQuotePublicLink,
  applyMeetingIntake,
  createMeetingIntake,
  getMeetingIntake,
  setProductActive,
  setEmailTemplateActive,
  softDeleteActivity,
  softDeleteDeal,
  softDeleteNote,
  softDeleteOrganization,
  softDeletePerson,
  softDeletePipeline,
  softDeleteStage,
  syncAcceptedQuoteToDealValue,
  updateQuoteAdjustments,
  updateActivity,
  updateDeal,
  updateDealContractStep,
  updateEmailTemplate,
  updateLead,
  upsertCustomFieldValues,
  updateOrganization,
  updatePerson,
  updatePipeline,
  updateProduct,
  updateQuoteStatus,
  updateStage
} from "@/lib/services/crm";
import {
  createActivitySchema,
  createCustomFieldSchema,
  createDealSchema,
  createDealContractStepSchema,
  createEmailLogSchema,
  createEmailTemplateSchema,
  createLeadSchema,
  createNoteSchema,
  createOrganizationSchema,
  createPersonSchema,
  createPipelineSchema,
  createProductSchema,
  createDealLineItemSchema,
  createStageSchema,
  closeDealSchema,
  convertLeadSchema,
  updateActivitySchema,
  updateDealSchema,
  updateDealContractStepSchema,
  updateEmailTemplateSchema,
  updateLeadSchema,
  upsertCustomFieldValuesSchema,
  updateOrganizationSchema,
  updatePersonSchema,
  updatePipelineSchema,
  updateProductSchema,
  updateQuoteAdjustmentsSchema,
  updateStageSchema
} from "@/lib/validators/crm";

type RouteContext = {
  params: Promise<{
    workspaceId: string;
    segments?: string[];
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context, "GET");
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context, "POST");
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context, "PATCH");
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handle(request, context, "DELETE");
}

async function handle(request: NextRequest, context: RouteContext, method: string) {
  try {
    const { workspaceId, segments = [] } = await context.params;
    const { actor } = await getWorkspaceRequestContext(workspaceId);
    const [resource, idOrNested, nestedResource, extraSegment] = segments;

    if (!resource) {
      throw new ApiError("NOT_FOUND", "Route was not found.", 404);
    }

    if (resource === "exports" && idOrNested && !nestedResource && method === "GET") {
      const result = await exportWorkspaceCsv(
        actor,
        idOrNested,
        searchParamsToListSearchParams(new URL(request.url).searchParams)
      );
      return csv(result.csv, result.filename);
    }

    if (resource === "pipelines" && !idOrNested) {
      if (method === "GET") return json(await listPipelines(actor));
      if (method === "POST") return created(await createPipeline(actor, createPipelineSchema.parse(await body(request))));
    }

    if (resource === "pipelines" && idOrNested && !nestedResource) {
      if (method === "PATCH") return json(await updatePipeline(actor, idOrNested, updatePipelineSchema.parse(await body(request))));
      if (method === "DELETE") {
        await softDeletePipeline(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "pipelines" && idOrNested && nestedResource === "stages" && !extraSegment) {
      if (method === "GET") return json(await listStages(actor, idOrNested));
      if (method === "POST") return created(await createStage(actor, idOrNested, createStageSchema.parse(await body(request))));
    }

    if (resource === "stages" && idOrNested && !nestedResource) {
      if (method === "PATCH") return json(await updateStage(actor, idOrNested, updateStageSchema.parse(await body(request))));
      if (method === "DELETE") {
        await softDeleteStage(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "deals" && !idOrNested) {
      if (method === "GET") return json(await listDeals(actor));
      if (method === "POST") return created(await createDeal(actor, createDealSchema.parse(await body(request))));
    }

    if (resource === "deals" && idOrNested && nestedResource === "close" && !extraSegment) {
      if (method === "POST") return json(await closeDeal(actor, idOrNested, closeDealSchema.parse(await body(request))));
    }

    if (resource === "deals" && idOrNested && nestedResource === "reopen" && !extraSegment) {
      if (method === "POST") return json(await reopenDeal(actor, idOrNested));
    }

    if (resource === "deals" && idOrNested && nestedResource === "line-items" && !extraSegment) {
      if (method === "POST") {
        const payload = createDealLineItemSchema.parse(await body(request));
        return created(await createDealLineItem(actor, { dealId: idOrNested, ...payload }));
      }
    }

    if (resource === "deals" && idOrNested && nestedResource === "contracts" && !extraSegment) {
      if (method === "GET") return json(await listDealContractSteps(actor, idOrNested));
      if (method === "POST") return created(await createDealContractStep(actor, idOrNested, createDealContractStepSchema.parse(await body(request))));
    }

    if (resource === "deals" && idOrNested && nestedResource === "quotes" && !extraSegment) {
      if (method === "POST") return created(await createQuoteFromDeal(actor, idOrNested));
    }

    if (resource === "deals" && idOrNested && !nestedResource) {
      if (method === "GET") return json(await getDeal(actor, idOrNested));
      if (method === "PATCH") return json(await updateDeal(actor, idOrNested, updateDealSchema.parse(await body(request))));
      if (method === "DELETE") {
        await softDeleteDeal(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "deal-line-items" && idOrNested && !nestedResource) {
      if (method === "DELETE") {
        await removeDealLineItem(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "contract-steps" && idOrNested && !nestedResource) {
      if (method === "PATCH") return json(await updateDealContractStep(actor, idOrNested, updateDealContractStepSchema.parse(await body(request))));
    }

    if (resource === "quotes" && idOrNested && nestedResource === "mark-sent" && !extraSegment) {
      if (method === "POST") return json(await updateQuoteStatus(actor, idOrNested, "SENT"));
    }

    if (resource === "quotes" && idOrNested && nestedResource === "accept" && !extraSegment) {
      if (method === "POST") return json(await updateQuoteStatus(actor, idOrNested, "ACCEPTED"));
    }

    if (resource === "quotes" && idOrNested && nestedResource === "decline" && !extraSegment) {
      if (method === "POST") return json(await updateQuoteStatus(actor, idOrNested, "DECLINED"));
    }

    if (resource === "quotes" && idOrNested && nestedResource === "sync-deal-value" && !extraSegment) {
      if (method === "POST") return json(await syncAcceptedQuoteToDealValue(actor, idOrNested));
    }

    if (resource === "quotes" && idOrNested && nestedResource === "adjustments" && !extraSegment) {
      if (method === "PATCH") return json(await updateQuoteAdjustments(actor, idOrNested, updateQuoteAdjustmentsSchema.parse(await body(request))));
    }

    if (resource === "quotes" && idOrNested && nestedResource === "public-link" && !extraSegment) {
      if (method === "POST") return created(await createQuotePublicLink(actor, idOrNested));
      if (method === "DELETE") return json(await revokeQuotePublicLink(actor, idOrNested));
    }

    if (resource === "products" && !idOrNested) {
      if (method === "GET") return json(await listProducts(actor));
      if (method === "POST") return created(await createProduct(actor, createProductSchema.parse(await body(request))));
    }

    if (resource === "products" && idOrNested && nestedResource === "deactivate" && !extraSegment) {
      if (method === "POST") return json(await setProductActive(actor, idOrNested, false));
    }

    if (resource === "products" && idOrNested && nestedResource === "activate" && !extraSegment) {
      if (method === "POST") return json(await setProductActive(actor, idOrNested, true));
    }

    if (resource === "products" && idOrNested && !nestedResource) {
      if (method === "PATCH") return json(await updateProduct(actor, idOrNested, updateProductSchema.parse(await body(request))));
    }

    if (resource === "leads" && !idOrNested) {
      if (method === "GET") return json(await listLeads(actor));
      if (method === "POST") return created(await createLead(actor, createLeadSchema.parse(await body(request))));
    }

    if (resource === "leads" && idOrNested && nestedResource === "convert" && !extraSegment) {
      if (method === "POST") return created(await convertLeadToDeal(actor, idOrNested, convertLeadSchema.parse(await body(request))));
    }

    if (resource === "leads" && idOrNested && !nestedResource) {
      if (method === "GET") return json(await getLead(actor, idOrNested));
      if (method === "PATCH") return json(await updateLead(actor, idOrNested, updateLeadSchema.parse(await body(request))));
    }

    if (resource === "people" && !idOrNested) {
      if (method === "GET") return json(await listPeople(actor));
      if (method === "POST") return created(await createPerson(actor, createPersonSchema.parse(await body(request))));
    }

    if (resource === "people" && idOrNested && !nestedResource) {
      if (method === "GET") return json(await getPerson(actor, idOrNested));
      if (method === "PATCH") return json(await updatePerson(actor, idOrNested, updatePersonSchema.parse(await body(request))));
      if (method === "DELETE") {
        await softDeletePerson(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "organizations" && !idOrNested) {
      if (method === "GET") return json(await listOrganizations(actor));
      if (method === "POST") return created(await createOrganization(actor, createOrganizationSchema.parse(await body(request))));
    }

    if (resource === "organizations" && idOrNested && !nestedResource) {
      if (method === "GET") return json(await getOrganization(actor, idOrNested));
      if (method === "PATCH") return json(await updateOrganization(actor, idOrNested, updateOrganizationSchema.parse(await body(request))));
      if (method === "DELETE") {
        await softDeleteOrganization(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "activities" && !idOrNested) {
      if (method === "GET") return json(await listActivities(actor));
      if (method === "POST") return created(await createActivity(actor, createActivitySchema.parse(await body(request))));
    }

    if (resource === "activities" && idOrNested && !nestedResource) {
      if (method === "PATCH") return json(await updateActivity(actor, idOrNested, updateActivitySchema.parse(await body(request))));
      if (method === "DELETE") {
        await softDeleteActivity(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "notes" && !idOrNested) {
      if (method === "GET") return json(await listNotes(actor));
      if (method === "POST") return created(await createNote(actor, createNoteSchema.parse(await body(request))));
    }

    if (resource === "notes" && idOrNested && !nestedResource) {
      if (method === "DELETE") {
        await softDeleteNote(actor, idOrNested);
        return noContent();
      }
    }

    if (resource === "meeting-intakes" && !idOrNested) {
      if (method === "GET") return json(await listMeetingIntakes(actor));
      if (method === "POST") return created(await createMeetingIntake(actor, await body(request)));
    }

    if (resource === "meeting-intakes" && idOrNested && !nestedResource) {
      if (method === "GET") return json(await getMeetingIntake(actor, idOrNested));
    }

    if (resource === "meeting-intakes" && idOrNested && nestedResource === "apply" && !extraSegment) {
      if (method === "POST") return json(await applyMeetingIntake(actor, idOrNested, await body(request)));
    }

    if (resource === "email-logs" && !idOrNested) {
      if (method === "GET") return json(await listEmailLogs(actor));
      if (method === "POST") return created(await createEmailLog(actor, createEmailLogSchema.parse(await body(request))));
    }

    if (resource === "email-templates" && !idOrNested) {
      if (method === "GET") return json(await listEmailTemplates(actor));
      if (method === "POST") return created(await createEmailTemplate(actor, createEmailTemplateSchema.parse(await body(request))));
    }

    if (resource === "email-templates" && idOrNested && nestedResource === "deactivate" && !extraSegment) {
      if (method === "POST") return json(await setEmailTemplateActive(actor, idOrNested, false));
    }

    if (resource === "email-templates" && idOrNested && nestedResource === "activate" && !extraSegment) {
      if (method === "POST") return json(await setEmailTemplateActive(actor, idOrNested, true));
    }

    if (resource === "email-templates" && idOrNested && !nestedResource) {
      if (method === "PATCH") return json(await updateEmailTemplate(actor, idOrNested, updateEmailTemplateSchema.parse(await body(request))));
    }

    if (resource === "custom-fields" && !idOrNested) {
      if (method === "GET") return json(await listCustomFields(actor));
      if (method === "POST") {
        const payload = createCustomFieldSchema.parse(await body(request));
        return created(
          await createCustomField(actor, {
            ...payload,
            options: payload.options == null ? null : JSON.parse(JSON.stringify(payload.options))
          })
        );
      }
    }

    if (resource === "custom-field-values" && !idOrNested) {
      if (method === "PATCH") {
        const payload = upsertCustomFieldValuesSchema.parse(await body(request));
        return json(await upsertCustomFieldValues(actor, payload));
      }
    }

    if (resource === "audit-logs" && !idOrNested && method === "GET") {
      return json(await listAuditLogs(actor));
    }

    throw new ApiError("NOT_FOUND", "Route was not found.", 404);
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

function csv(data: string, filename: string) {
  return new Response(data, {
    status: 200,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "x-content-type-options": "nosniff"
    }
  });
}
