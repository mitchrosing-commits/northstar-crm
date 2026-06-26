import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIntegrationFixture, disconnectPrisma } from "./fixtures";
import { invokeQuotePdfRoute, invokeWorkspaceApi, invokeWorkspacesApi, readJson } from "./route-handler";

type Fixture = Awaited<ReturnType<typeof createIntegrationFixture>>;
type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

let fixture: Fixture | undefined;

beforeEach(async () => {
  fixture = await createIntegrationFixture();
});

afterEach(async () => {
  await fixture?.cleanup();
  fixture = undefined;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("database-backed CRM route handlers", () => {
  it("uses shared request context on the root workspaces API", async () => {
    const fx = currentFixture();

    const listResponse = await invokeWorkspacesApi({
      method: "GET",
      actorUserId: fx.userA.id
    });
    const workspaces = await readJson<Array<{ id: string }>>(listResponse);

    expect(listResponse.status).toBe(200);
    expect(workspaces.map((workspace) => workspace.id)).toEqual([fx.workspaceA.id]);

    const createResponse = await invokeWorkspacesApi({
      method: "POST",
      actorUserId: fx.userA.id,
      body: {
        name: `Created Workspace ${Date.now()}`,
        slug: `created-workspace-${Date.now()}`
      }
    });
    const created = await readJson<{ id: string }>(createResponse);
    const membership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
      where: {
        workspaceId_userId: {
          workspaceId: created.id,
          userId: fx.userA.id
        }
      }
    });

    expect(createResponse.status).toBe(201);
    expect(membership.role).toBe("OWNER");

    await fx.prisma.auditLog.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.pipelineStage.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.pipeline.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.workspaceMembership.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.workspace.delete({ where: { id: created.id } });
  });

  it("creates, updates, and closes a deal through the workspace API", async () => {
    const fx = currentFixture();

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "API Created Deal",
        valueCents: 420000,
        currency: "USD",
        expectedCloseAt: "2030-03-01T00:00:00.000Z"
      }
    });
    const createdDeal = await readJson<{ id: string; title: string; stageId: string; valueCents: number }>(createResponse);

    expect(createResponse.status).toBe(201);
    expect(createdDeal.title).toBe("API Created Deal");
    expect(createdDeal.stageId).toBe(fx.recordsA.stageOne.id);
    expect(createdDeal.valueCents).toBe(420000);

    const updateResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id],
      body: {
        title: "API Updated Deal",
        stageId: fx.recordsA.stageTwo.id,
        valueCents: 430000
      }
    });
    const updatedDeal = await readJson<{ id: string; title: string; stageId: string; valueCents: number }>(updateResponse);

    expect(updateResponse.status).toBe(200);
    expect(updatedDeal.title).toBe("API Updated Deal");
    expect(updatedDeal.stageId).toBe(fx.recordsA.stageTwo.id);
    expect(updatedDeal.valueCents).toBe(430000);

    const closeResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id, "close"],
      body: { status: "LOST", lostReason: "No budget this quarter" }
    });
    const closedDeal = await readJson<{ id: string; status: string; stageId: string }>(closeResponse);

    expect(closeResponse.status).toBe(200);
    expect(closedDeal.status).toBe("LOST");
    expect(closedDeal.stageId).toBe(fx.recordsA.stageTwo.id);

    const reopenResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id, "reopen"]
    });
    const reopenedDeal = await readJson<{ id: string; status: string; stageId: string }>(reopenResponse);

    expect(reopenResponse.status).toBe(200);
    expect(reopenedDeal.status).toBe("OPEN");
    expect(reopenedDeal.stageId).toBe(fx.recordsA.stageTwo.id);
  });

  it("exports quote PDFs through authenticated workspace-scoped routes", async () => {
    const fx = currentFixture();

    const productResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      body: {
        name: "PDF Export Package",
        description: "PDF export proof",
        unitPriceCents: 125050,
        currency: "USD"
      }
    });
    const product = await readJson<{ id: string }>(productResponse);
    const lineItemResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "line-items"],
      body: {
        productId: product.id,
        quantity: 2
      }
    });
    const quoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "quotes"]
    });
    const quote = await readJson<{ id: string; number: string }>(quoteResponse);
    const adjustmentResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "adjustments"],
      body: {
        discountType: "FIXED",
        discountValue: 5000,
        taxType: "PERCENT",
        taxValue: 1000
      }
    });
    const adjustedQuote = await readJson<{ totalCents: number; discountCents: number; taxCents: number }>(adjustmentResponse);
    const invalidAdjustmentResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "adjustments"],
      body: {
        discountType: "PERCENT",
        discountValue: 10001,
        taxType: "NONE",
        taxValue: 0
      }
    });

    expect(productResponse.status).toBe(201);
    expect(lineItemResponse.status).toBe(201);
    expect(quoteResponse.status).toBe(201);
    expect(adjustmentResponse.status).toBe(200);
    expect(invalidAdjustmentResponse.status).toBe(422);
    expect(adjustedQuote).toMatchObject({ discountCents: 5000, taxCents: 24510, totalCents: 269610 });

    const missingAuthResponse = await invokeQuotePdfRoute({
      dealId: fx.recordsA.deal.id,
      quoteId: quote.id
    });
    const pdfResponse = await invokeQuotePdfRoute({
      actorUserId: fx.userA.id,
      selectedWorkspaceId: fx.workspaceA.id,
      dealId: fx.recordsA.deal.id,
      quoteId: quote.id
    });
    const crossWorkspaceResponse = await invokeQuotePdfRoute({
      actorUserId: fx.userA.id,
      selectedWorkspaceId: fx.workspaceA.id,
      dealId: fx.recordsB.deal.id,
      quoteId: quote.id
    });
    const pdfText = Buffer.from(await pdfResponse.arrayBuffer()).toString("latin1");

    expect(missingAuthResponse.status).toBe(401);
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
    expect(pdfResponse.headers.get("content-disposition")).toContain(`quote-${quote.number}.pdf`);
    expect(pdfResponse.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(pdfResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(pdfText).toContain("%PDF-1.4");
    expect(pdfText).toContain(quote.number);
    expect(pdfText).toContain("Alpha Needle Deal");
    expect(pdfText).toContain("Alpha Orbit Organization");
    expect(pdfText).toContain("Alpha Contact");
    expect(pdfText).toContain("PDF Export Package");
    expect(pdfText).toContain("$1,250.50");
    expect(pdfText).toContain("Quote-level discount");
    expect(pdfText).toContain("Quote-level tax");
    expect(pdfText).toContain("$2,696.10");
    expect(crossWorkspaceResponse.status).toBe(404);
  });

  it("creates and converts a lead through the workspace API", async () => {
    const fx = currentFixture();

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads"],
      body: {
        ownerId: fx.userA.id,
        personId: fx.recordsA.person.id,
        organizationId: fx.recordsA.organization.id,
        title: "API Created Lead",
        source: "API integration",
        status: "QUALIFIED"
      }
    });
    const createdLead = await readJson<{ id: string; title: string; status: string }>(createResponse);

    expect(createResponse.status).toBe(201);
    expect(createdLead.title).toBe("API Created Lead");
    expect(createdLead.status).toBe("QUALIFIED");

    const convertResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads", createdLead.id, "convert"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageTwo.id,
        title: "API Converted Deal"
      }
    });
    const convertedDeal = await readJson<{ id: string; title: string; pipelineId: string; stageId: string }>(convertResponse);
    const lead = await fx.prisma.lead.findUniqueOrThrow({ where: { id: createdLead.id } });

    expect(convertResponse.status).toBe(201);
    expect(convertedDeal.title).toBe("API Converted Deal");
    expect(convertedDeal.pipelineId).toBe(fx.recordsA.pipeline.id);
    expect(convertedDeal.stageId).toBe(fx.recordsA.stageTwo.id);
    expect(lead.status).toBe("CONVERTED");
  });

  it("creates and completes an activity and creates a note through the workspace API", async () => {
    const fx = currentFixture();
    const completedAt = "2030-03-04T10:30:00.000Z";

    const createActivityResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities"],
      body: {
        ownerId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        type: "TASK",
        title: "API Follow-up",
        description: "Confirm the next buying step.",
        dueAt: "2030-03-03T09:00:00.000Z"
      }
    });
    const activity = await readJson<{ id: string; dealId: string; title: string; completedAt: string | null }>(createActivityResponse);

    expect(createActivityResponse.status).toBe(201);
    expect(activity.dealId).toBe(fx.recordsA.deal.id);
    expect(activity.title).toBe("API Follow-up");
    expect(activity.completedAt).toBeNull();

    const completeActivityResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", activity.id],
      body: { completedAt }
    });
    const completedActivity = await readJson<{ id: string; completedAt: string | null }>(completeActivityResponse);

    expect(completeActivityResponse.status).toBe(200);
    expect(completedActivity.completedAt).toBe(completedAt);

    const createNoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes"],
      body: {
        dealId: fx.recordsA.deal.id,
        body: "API-created deal note"
      }
    });
    const note = await readJson<{ id: string; dealId: string; body: string }>(createNoteResponse);

    expect(createNoteResponse.status).toBe(201);
    expect(note.dealId).toBe(fx.recordsA.deal.id);
    expect(note.body).toBe("API-created deal note");
  });

  it("soft-deletes activities and notes through the workspace API", async () => {
    const fx = currentFixture();

    const activityDeleteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", fx.recordsA.activity.id]
    });
    const noteDeleteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes", fx.recordsA.note.id]
    });
    const [activity, note] = await Promise.all([
      fx.prisma.activity.findUniqueOrThrow({ where: { id: fx.recordsA.activity.id } }),
      fx.prisma.note.findUniqueOrThrow({ where: { id: fx.recordsA.note.id } })
    ]);

    expect(activityDeleteResponse.status).toBe(204);
    expect(noteDeleteResponse.status).toBe(204);
    expect(activity.deletedAt).toBeInstanceOf(Date);
    expect(note.deletedAt).toBeInstanceOf(Date);
  });

  it("returns a validation error response for invalid payloads", async () => {
    const fx = currentFixture();

    const response = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: ""
      }
    });
    const body = await readJson<ApiErrorBody>(response);

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("The request payload is invalid.");
    expect(body.error.details).toMatchObject({
      fieldErrors: {
        title: expect.any(Array)
      }
    });
  });

  it("returns a stable not-found error for unknown API resources or unsupported methods", async () => {
    const fx = currentFixture();

    const unknownResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["not-a-resource"]
    });
    const unknownBody = await readJson<ApiErrorBody>(unknownResponse);
    const unsupportedMethodResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads", fx.recordsA.lead.id]
    });
    const unsupportedMethodBody = await readJson<ApiErrorBody>(unsupportedMethodResponse);

    expect(unknownResponse.status).toBe(404);
    expect(unknownBody).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route was not found."
      }
    });
    expect(unsupportedMethodResponse.status).toBe(404);
    expect(unsupportedMethodBody).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route was not found."
      }
    });
  });

  it("returns workspace-scoped errors through the API boundary", async () => {
    const fx = currentFixture();

    const forbiddenResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceB.id,
      actorUserId: fx.userA.id,
      segments: ["deals"]
    });
    const forbiddenBody = await readJson<ApiErrorBody>(forbiddenResponse);

    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenBody.error.code).toBe("FORBIDDEN");

    const notFoundResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsB.deal.id],
      body: { title: "Cross-workspace API edit" }
    });
    const notFoundBody = await readJson<ApiErrorBody>(notFoundResponse);

    expect(notFoundResponse.status).toBe(404);
    expect(notFoundBody.error.code).toBe("NOT_FOUND");
  });

  it("returns a consistent missing-session response in trusted-header mode", async () => {
    const fx = currentFixture();
    const previousAuthMode = process.env.AUTH_MODE;
    const previousAuthUserIdHeader = process.env.AUTH_USER_ID_HEADER;
    process.env.AUTH_MODE = "trusted-header";
    process.env.AUTH_USER_ID_HEADER = "x-user-id";

    try {
      const rootResponse = await invokeWorkspacesApi({
        method: "GET"
      });
      const rootBody = await readJson<ApiErrorBody>(rootResponse);
      const response = await invokeWorkspaceApi({
        method: "GET",
        workspaceId: fx.workspaceA.id,
        segments: ["deals"]
      });
      const body = await readJson<ApiErrorBody>(response);

      expect(rootResponse.status).toBe(401);
      expect(rootBody).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "A signed-in user is required."
        }
      });
      expect(response.status).toBe(401);
      expect(body).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "A signed-in user is required."
        }
      });
    } finally {
      restoreEnv("AUTH_MODE", previousAuthMode);
      restoreEnv("AUTH_USER_ID_HEADER", previousAuthUserIdHeader);
    }
  });

  it("returns a consistent missing-session response in local auth mode", async () => {
    const fx = currentFixture();
    const previousAuthMode = process.env.AUTH_MODE;
    const previousAuthSessionSecret = process.env.AUTH_SESSION_SECRET;
    process.env.AUTH_MODE = "local";
    process.env.AUTH_SESSION_SECRET = "integration-local-session-secret-123";

    try {
      const response = await invokeWorkspaceApi({
        method: "GET",
        workspaceId: fx.workspaceA.id,
        segments: ["deals"]
      });
      const body = await readJson<ApiErrorBody>(response);

      expect(response.status).toBe(401);
      expect(body).toEqual({
        error: {
          code: "UNAUTHENTICATED",
          message: "A signed-in user is required."
        }
      });
    } finally {
      restoreEnv("AUTH_MODE", previousAuthMode);
      restoreEnv("AUTH_SESSION_SECRET", previousAuthSessionSecret);
    }
  });

  it("exports workspace-scoped CSV without leaking cross-workspace records", async () => {
    const fx = currentFixture();
    await Promise.all([
      fx.prisma.deal.update({
        where: { id: fx.recordsA.deal.id },
        data: { title: "Alpha \"Quoted\", Deal\nLine" }
      }),
      fx.prisma.deal.update({
        where: { id: fx.recordsB.deal.id },
        data: { title: "Beta private deal" }
      })
    ]);

    const dealResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["exports", "deals"]
    });
    const dealCsv = await dealResponse.text();

    expect(dealResponse.status).toBe(200);
    expect(dealResponse.headers.get("content-type")).toContain("text/csv");
    expect(dealResponse.headers.get("content-disposition")).toContain("northstar-deals.csv");
    expect(dealCsv.split("\n")[0]).toBe(
      "title,status,value,currency,pipeline,stage,expectedCloseAt,contactName,contactEmail,organizationName,ownerEmail,createdAt,updatedAt"
    );
    expect(dealCsv).toContain("\"Alpha \"\"Quoted\"\", Deal\nLine\"");
    expect(dealCsv).not.toContain(fx.recordsA.deal.id);
    expect(dealCsv).not.toContain("Beta private deal");

    for (const resource of ["contacts", "organizations", "leads"]) {
      const response = await invokeWorkspaceApi({
        method: "GET",
        workspaceId: fx.workspaceA.id,
        actorUserId: fx.userA.id,
        segments: ["exports", resource]
      });
      const csv = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      expect(csv).toContain("Alpha");
      expect(csv).not.toContain("Beta");
      expect(csv).not.toContain(fx.workspaceA.id);
      expect(csv).not.toContain(fx.workspaceB.id);
    }
  });

  it("exports record-type custom field columns without leaking other workspaces or record types", async () => {
    const fx = currentFixture();
    const [dealApprovedField, dealBlankField, dealQuotedField, dealSelectField] = await Promise.all([
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          name: "A Deal Approved",
          key: "a_deal_approved",
          fieldType: "BOOLEAN"
        }
      }),
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          name: "B Deal Blank",
          key: "b_deal_blank",
          fieldType: "TEXT"
        }
      }),
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          name: "C Deal \"Quoted\", Field",
          key: "c_deal_quoted_field",
          fieldType: "TEXT"
        }
      }),
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "DEAL",
          name: "D Deal Segment",
          key: "d_deal_segment",
          fieldType: "SELECT"
        }
      })
    ]);
    const [contactField, organizationField, leadField, otherTypeDealField, otherWorkspaceDealField] = await Promise.all([
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "PERSON",
          name: "Contact Tier",
          key: "contact_tier",
          fieldType: "TEXT"
        }
      }),
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "ORGANIZATION",
          name: "Organization Region",
          key: "organization_region",
          fieldType: "TEXT"
        }
      }),
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "LEAD",
          name: "Lead Quality",
          key: "lead_quality",
          fieldType: "NUMBER"
        }
      }),
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceA.id,
          entityType: "PERSON",
          name: "Person Only Field",
          key: "person_only_field",
          fieldType: "TEXT"
        }
      }),
      fx.prisma.customFieldDefinition.create({
        data: {
          workspaceId: fx.workspaceB.id,
          entityType: "DEAL",
          name: "Cross Workspace Deal Field",
          key: "cross_workspace_deal_field",
          fieldType: "TEXT"
        }
      })
    ]);

    await fx.prisma.customFieldValue.createMany({
      data: [
        {
          workspaceId: fx.workspaceA.id,
          fieldId: dealApprovedField.id,
          entityType: "DEAL",
          entityId: fx.recordsA.deal.id,
          value: true
        },
        {
          workspaceId: fx.workspaceA.id,
          fieldId: dealQuotedField.id,
          entityType: "DEAL",
          entityId: fx.recordsA.deal.id,
          value: "Needs \"care\",\nfast"
        },
        {
          workspaceId: fx.workspaceA.id,
          fieldId: dealSelectField.id,
          entityType: "DEAL",
          entityId: fx.recordsA.deal.id,
          value: "Strategic"
        },
        {
          workspaceId: fx.workspaceA.id,
          fieldId: contactField.id,
          entityType: "PERSON",
          entityId: fx.recordsA.person.id,
          value: "Gold"
        },
        {
          workspaceId: fx.workspaceA.id,
          fieldId: organizationField.id,
          entityType: "ORGANIZATION",
          entityId: fx.recordsA.organization.id,
          value: "North"
        },
        {
          workspaceId: fx.workspaceA.id,
          fieldId: leadField.id,
          entityType: "LEAD",
          entityId: fx.recordsA.lead.id,
          value: 7
        },
        {
          workspaceId: fx.workspaceA.id,
          fieldId: otherTypeDealField.id,
          entityType: "PERSON",
          entityId: fx.recordsA.person.id,
          value: "Do not show on deals"
        },
        {
          workspaceId: fx.workspaceB.id,
          fieldId: otherWorkspaceDealField.id,
          entityType: "DEAL",
          entityId: fx.recordsB.deal.id,
          value: "Beta private custom field"
        }
      ]
    });

    const dealResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["exports", "deals"]
    });
    const dealCsv = await dealResponse.text();
    const dealHeader = dealCsv.split("\n")[0];

    expect(dealHeader).toContain(
      ",Custom: A Deal Approved,Custom: B Deal Blank,\"Custom: C Deal \"\"Quoted\"\", Field\",Custom: D Deal Segment"
    );
    expect(dealCsv).toContain("Yes,,\"Needs \"\"care\"\",\nfast\",Strategic");
    expect(dealCsv).not.toContain(dealApprovedField.id);
    expect(dealCsv).not.toContain("Person Only Field");
    expect(dealCsv).not.toContain("Do not show on deals");
    expect(dealCsv).not.toContain("Cross Workspace Deal Field");
    expect(dealCsv).not.toContain("Beta private custom field");

    const exportChecks = [
      { resource: "contacts", header: "Custom: Contact Tier", value: "Gold", hidden: "Custom: A Deal Approved" },
      { resource: "organizations", header: "Custom: Organization Region", value: "North", hidden: "Custom: Contact Tier" },
      { resource: "leads", header: "Custom: Lead Quality", value: "7", hidden: "Custom: Organization Region" }
    ];

    for (const check of exportChecks) {
      const response = await invokeWorkspaceApi({
        method: "GET",
        workspaceId: fx.workspaceA.id,
        actorUserId: fx.userA.id,
        segments: ["exports", check.resource]
      });
      const csv = await response.text();

      expect(response.status).toBe(200);
      expect(csv.split("\n")[0]).toContain(check.header);
      expect(csv).toContain(check.value);
      expect(csv).not.toContain(check.hidden);
      expect(csv).not.toContain(otherWorkspaceDealField.id);
    }
  });

  it("enforces access behavior on CSV export routes", async () => {
    const fx = currentFixture();
    const previousAuthMode = process.env.AUTH_MODE;
    const previousAuthUserIdHeader = process.env.AUTH_USER_ID_HEADER;
    process.env.AUTH_MODE = "trusted-header";
    process.env.AUTH_USER_ID_HEADER = "x-user-id";

    try {
      const missingSessionResponse = await invokeWorkspaceApi({
        method: "GET",
        workspaceId: fx.workspaceA.id,
        segments: ["exports", "contacts"]
      });
      const missingSessionBody = await readJson<ApiErrorBody>(missingSessionResponse);

      expect(missingSessionResponse.status).toBe(401);
      expect(missingSessionBody.error.code).toBe("UNAUTHENTICATED");
    } finally {
      restoreEnv("AUTH_MODE", previousAuthMode);
      restoreEnv("AUTH_USER_ID_HEADER", previousAuthUserIdHeader);
    }

    const nonMemberResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceB.id,
      actorUserId: fx.userA.id,
      segments: ["exports", "contacts"]
    });
    const nonMemberBody = await readJson<ApiErrorBody>(nonMemberResponse);

    expect(nonMemberResponse.status).toBe(403);
    expect(nonMemberBody.error.code).toBe("FORBIDDEN");

    const unsupportedResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["exports", "notes"]
    });
    const unsupportedBody = await readJson<ApiErrorBody>(unsupportedResponse);

    expect(unsupportedResponse.status).toBe(404);
    expect(unsupportedBody.error.code).toBe("NOT_FOUND");
  });
});

function currentFixture() {
  if (!fixture) throw new Error("Integration fixture was not created.");
  return fixture;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
