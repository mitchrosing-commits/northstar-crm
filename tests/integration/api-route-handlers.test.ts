import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dealValueCentsMax, productIntColumnMax, quoteIntColumnMax, sortOrderIntColumnMax } from "@/lib/product-limits";
import { defaultPipelineName, defaultPipelineStages } from "@/lib/services/pipeline-service";
import { getPublicQuoteByToken } from "@/lib/services/crm";
import type { MeetingIntelligenceDraft } from "@/lib/meeting-intelligence/types";
import { workspaceNameMaxLength, workspaceSlugMaxLength } from "@/lib/workspace-validation";
import { createIntegrationFixture, disconnectPrisma } from "./fixtures";
import { invokeQuotePdfRoute, invokeWorkspaceApi, invokeWorkspaceDetailApi, invokeWorkspacesApi, readJson } from "./route-handler";

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
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
    const created = await readJson<{ id: string; name: string; slug: string }>(createResponse);
    const membership = await fx.prisma.workspaceMembership.findUniqueOrThrow({
      where: {
        workspaceId_userId: {
          workspaceId: created.id,
          userId: fx.userA.id
        }
      }
    });
    const defaultPipeline = await fx.prisma.pipeline.findFirstOrThrow({
      where: {
        workspaceId: created.id,
        name: defaultPipelineName,
        deletedAt: null
      },
      include: {
        stages: {
          where: { deletedAt: null },
          orderBy: { sortOrder: "asc" }
        }
      }
    });
    const auditLog = await fx.prisma.auditLog.findFirst({
      where: {
        workspaceId: created.id,
        actorId: fx.userA.id,
        action: "workspace.created",
        entityType: "Workspace",
        entityId: created.id
      }
    });

    expect(createResponse.status).toBe(201);
    expect(membership.role).toBe("OWNER");
    expect(defaultPipeline.stages.map((stage) => ({ name: stage.name, probability: stage.probability }))).toEqual(
      [...defaultPipelineStages]
    );
    expect(auditLog).toMatchObject({
      metadata: { name: created.name }
    });

    const duplicateSlugResponse = await invokeWorkspacesApi({
      method: "POST",
      actorUserId: fx.userA.id,
      body: {
        name: "Duplicate API Workspace Slug",
        slug: created.slug
      }
    });
    const duplicateSlugBody = await readJson<ApiErrorBody>(duplicateSlugResponse);

    expect(duplicateSlugResponse.status).toBe(409);
    expect(duplicateSlugBody.error).toMatchObject({
      code: "WORKSPACE_SLUG_EXISTS",
      message: "A workspace with this slug already exists."
    });

    await fx.prisma.auditLog.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.pipelineStage.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.pipeline.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.workspaceMembership.deleteMany({ where: { workspaceId: created.id } });
    await fx.prisma.workspace.delete({ where: { id: created.id } });
  });

  it("enforces membership on the workspace detail API", async () => {
    const fx = currentFixture();

    const detailResponse = await invokeWorkspaceDetailApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id
    });
    const detail = await readJson<{
      id: string;
      name: string;
      memberships: Array<{ user: { email: string } }>;
    }>(detailResponse);

    expect(detailResponse.status).toBe(200);
    expect(detail).toMatchObject({
      id: fx.workspaceA.id,
      name: fx.workspaceA.name
    });
    expect(detail.memberships.map((membership) => membership.user.email)).toEqual([fx.userA.email]);

    const nonMemberResponse = await invokeWorkspaceDetailApi({
      method: "GET",
      workspaceId: fx.workspaceB.id,
      actorUserId: fx.userA.id
    });
    const nonMemberBody = await readJson<ApiErrorBody>(nonMemberResponse);

    expect(nonMemberResponse.status).toBe(403);
    expect(nonMemberBody.error).toMatchObject({
      code: "FORBIDDEN",
      message: "You do not have access to this workspace."
    });

    const previousAuthMode = process.env.AUTH_MODE;
    const previousAuthUserIdHeader = process.env.AUTH_USER_ID_HEADER;
    process.env.AUTH_MODE = "trusted-header";
    process.env.AUTH_USER_ID_HEADER = "x-user-id";

    try {
      const missingSessionResponse = await invokeWorkspaceDetailApi({
        method: "GET",
        workspaceId: fx.workspaceA.id
      });
      const missingSessionBody = await readJson<ApiErrorBody>(missingSessionResponse);

      expect(missingSessionResponse.status).toBe(401);
      expect(missingSessionBody.error.code).toBe("UNAUTHENTICATED");
    } finally {
      restoreEnv("AUTH_MODE", previousAuthMode);
      restoreEnv("AUTH_USER_ID_HEADER", previousAuthUserIdHeader);
    }
  });

  it("returns a controlled validation error for malformed workspace API JSON bodies", async () => {
    const fx = currentFixture();
    const productCountBefore = await fx.prisma.product.count({ where: { workspaceId: fx.workspaceA.id } });

    const response = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      rawBody: "{\"name\":\"Broken JSON\""
    });
    const body = await readJson<ApiErrorBody>(response);

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    await expect(fx.prisma.product.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(productCountBefore);
  });

  it("validates workspace names on the root workspaces API before creating records", async () => {
    const fx = currentFixture();
    const blankSlug = `blank-workspace-${Date.now()}`;
    const overlongSlug = `overlong-workspace-${Date.now()}`;
    const malformedSlug = `malformed-workspace-${Date.now()}`;
    const invalidSlugName = `Invalid Slug Workspace ${Date.now()}`;
    const invalidSlug = `invalid-slug-${Date.now()}-`;
    const tooLongSlug = "x".repeat(workspaceSlugMaxLength + 1);

    const whitespaceResponse = await invokeWorkspacesApi({
      method: "POST",
      actorUserId: fx.userA.id,
      body: {
        name: "   ",
        slug: blankSlug
      }
    });
    const whitespaceBody = await readJson<ApiErrorBody>(whitespaceResponse);
    const overlongResponse = await invokeWorkspacesApi({
      method: "POST",
      actorUserId: fx.userA.id,
      body: {
        name: "x".repeat(workspaceNameMaxLength + 1),
        slug: overlongSlug
      }
    });
    const overlongBody = await readJson<ApiErrorBody>(overlongResponse);
    const malformedJsonResponse = await invokeWorkspacesApi({
      method: "POST",
      actorUserId: fx.userA.id,
      rawBody: `{"name":"Malformed Workspace","slug":"${malformedSlug}","resetToken":"raw-reset-token","apiKey":"raw-api-key"`
    });
    const malformedJsonBody = await readJson<ApiErrorBody>(malformedJsonResponse);
    const malformedJsonSerialized = JSON.stringify(malformedJsonBody);
    const invalidSlugResponse = await invokeWorkspacesApi({
      method: "POST",
      actorUserId: fx.userA.id,
      body: {
        name: invalidSlugName,
        slug: invalidSlug
      }
    });
    const invalidSlugBody = await readJson<ApiErrorBody>(invalidSlugResponse);
    const tooLongSlugResponse = await invokeWorkspacesApi({
      method: "POST",
      actorUserId: fx.userA.id,
      body: {
        name: "Too Long Slug Workspace",
        slug: tooLongSlug
      }
    });
    const tooLongSlugBody = await readJson<ApiErrorBody>(tooLongSlugResponse);
    const invalidCreatedCount = await fx.prisma.workspace.count({
      where: { slug: { in: [blankSlug, overlongSlug, malformedSlug, invalidSlug, tooLongSlug] } }
    });
    const invalidSlugSideEffectCount = await fx.prisma.workspace.count({
      where: { name: invalidSlugName }
    });

    expect(whitespaceResponse.status).toBe(422);
    expect(whitespaceBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Workspace name is required."
    });
    expect(overlongResponse.status).toBe(422);
    expect(overlongBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: `Workspace name must be ${workspaceNameMaxLength} characters or fewer.`
    });
    expect(malformedJsonResponse.status).toBe(422);
    expect(malformedJsonBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(malformedJsonSerialized).not.toContain("raw-reset-token");
    expect(malformedJsonSerialized).not.toContain("raw-api-key");
    expect(invalidSlugResponse.status).toBe(422);
    expect(invalidSlugBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(tooLongSlugResponse.status).toBe(422);
    expect(tooLongSlugBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(invalidCreatedCount).toBe(0);
    expect(invalidSlugSideEffectCount).toBe(0);
  });

  it("keeps planned developer platform endpoints disabled at the workspace API boundary", async () => {
    const fx = currentFixture();

    const plannedEndpoints = [
      { segments: ["api-keys"], method: "GET" as const },
      { segments: ["api-keys"], method: "POST" as const },
      { segments: ["api-keys", "key_123", "rotate"], method: "POST" as const },
      { segments: ["webhooks"], method: "GET" as const },
      { segments: ["webhooks"], method: "POST" as const },
      { segments: ["oauth-apps"], method: "GET" as const },
      { segments: ["oauth-apps"], method: "POST" as const }
    ];

    for (const endpoint of plannedEndpoints) {
      const response = await invokeWorkspaceApi({
        method: endpoint.method,
        workspaceId: fx.workspaceA.id,
        actorUserId: fx.userA.id,
        segments: endpoint.segments,
        body:
          endpoint.method === "POST"
            ? {
                name: "Preview Platform Control",
                secret: "super-secret-api-key-value",
                targetUrl: "https://example.test/webhook?token=raw-webhook-token"
              }
            : undefined
      });
      const body = await readJson<ApiErrorBody>(response);

      expect(response.status).toBe(404);
      expect(body.error).toMatchObject({
        code: "NOT_FOUND",
        message: "Route was not found."
      });
      expect(JSON.stringify(body)).not.toContain("super-secret-api-key-value");
      expect(JSON.stringify(body)).not.toContain("raw-webhook-token");
    }
  });

  it("routes meeting intelligence intakes through the workspace API without cross-workspace leakage", async () => {
    const fx = currentFixture();

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["meeting-intakes"],
      body: {
        contextText: "Meeting date: 2030-06-01\nAttendees: Alpha Contact",
        hints: {
          dealId: fx.recordsA.deal.id,
          organizationId: fx.recordsA.organization.id,
          personIds: [fx.recordsA.person.id]
        },
        text: [
          `Met with ${fx.recordsA.person.firstName} ${fx.recordsA.person.lastName} at ${fx.recordsA.organization.name}.`,
          `${fx.recordsA.deal.title} needs an implementation follow-up and executive recap.`,
          `Ignore unrelated workspace record ${fx.recordsB.deal.title}.`,
          "Action: send recap by 2030-06-05."
        ].join("\n")
      }
    });
    const created = await readJson<{
      id: string;
      proposedChangesJson: MeetingIntelligenceDraft;
      status: string;
      workspaceId: string;
    }>(createResponse);
    const proposal = JSON.stringify(created.proposedChangesJson);

    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({
      status: "READY_FOR_REVIEW",
      workspaceId: fx.workspaceA.id
    });
    expect(proposal).toContain(fx.recordsA.deal.id);
    expect(proposal).not.toContain(fx.recordsB.deal.id);
    expect(proposal).not.toContain(fx.recordsB.organization.id);

    const listResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["meeting-intakes"]
    });
    const intakes = await readJson<Array<{ id: string; workspaceId: string }>>(listResponse);
    const getResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["meeting-intakes", created.id]
    });
    const fetched = await readJson<{ id: string; workspaceId: string }>(getResponse);
    const crossWorkspaceGetResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceB.id,
      actorUserId: fx.userB.id,
      segments: ["meeting-intakes", created.id]
    });
    const crossWorkspaceGetBody = await readJson<ApiErrorBody>(crossWorkspaceGetResponse);

    expect(listResponse.status).toBe(200);
    expect(intakes).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, workspaceId: fx.workspaceA.id })]));
    expect(getResponse.status).toBe(200);
    expect(fetched).toMatchObject({ id: created.id, workspaceId: fx.workspaceA.id });
    expect(crossWorkspaceGetResponse.status).toBe(404);
    expect(crossWorkspaceGetBody.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Meeting intake was not found."
    });

    const draft = created.proposedChangesJson;
    const applyResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["meeting-intakes", created.id, "apply"],
      body: {
        meetingActivity: draft.meetingActivity ? { ...draft.meetingActivity, include: true } : null,
        nextStepActivities: draft.nextStepActivities.map((activity, index) => ({ ...activity, include: index === 0 })),
        notes: draft.notes.map((note, index) => ({ ...note, include: index === 0 }))
      }
    });
    const applyResult = await readJson<{
      created: Array<{ id: string; type: string }>;
      skipped: Array<{ type: string }>;
    }>(applyResponse);
    const applied = await fx.prisma.meetingIntake.findUniqueOrThrow({ where: { id: created.id } });

    expect(applyResponse.status).toBe(200);
    expect(applyResult.created.some((item) => item.type === "note")).toBe(true);
    expect(applyResult.created.some((item) => item.type === "activity")).toBe(true);
    expect(applied.status).toBe("APPLIED");
    expect(applied.workspaceId).toBe(fx.workspaceA.id);
  });

  it("rejects empty meeting intelligence intakes through the workspace API without creating failed records", async () => {
    const fx = currentFixture();
    const countBefore = await fx.prisma.meetingIntake.count({ where: { workspaceId: fx.workspaceA.id } });

    const response = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["meeting-intakes"],
      body: {
        contextText: "Meeting date: 2030-06-01",
        explicitSourceType: "pasted_text",
        text: "   "
      }
    });
    const body = await readJson<ApiErrorBody>(response);

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Paste meeting notes or upload a meeting artifact before creating an intake."
    });
    await expect(fx.prisma.meetingIntake.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(countBefore);
  });

  it("reports safe Meeting Intelligence upload capabilities for local/dev storage without provider config", async () => {
    const fx = currentFixture();

    const response = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["meeting-intake-upload-capabilities"]
    });
    const capabilities = await readJson<{
      base64Request: { maxEncodedCharacters: number; providerFallbackMaxBytes: number };
      directUpload: { available: boolean; reason: string; sourceTypes: string[] };
      localExtraction: { maxBinaryBytes: number; sourceTypes: string[] };
      multipartUpload: { supported: boolean };
      providerExtraction: { configured: boolean; support: Record<string, { available: boolean; reason?: string }>; supportedSourceTypes: string[] };
      storage: { backendCategory: string; directUploadSupported: boolean; private: boolean };
      unsupportedSourceTypes: Array<{ sourceType: string }>;
    }>(response);
    const serialized = JSON.stringify(capabilities);

    expect(response.status).toBe(200);
    expect(capabilities).toMatchObject({
      directUpload: {
        available: false,
        sourceTypes: []
      },
      multipartUpload: { supported: false },
      providerExtraction: {
        configured: false,
        supportedSourceTypes: []
      },
      storage: {
        backendCategory: "local-filesystem",
        directUploadSupported: false,
        private: true
      }
    });
    expect(capabilities.localExtraction.sourceTypes).toContain("docx");
    expect(capabilities.localExtraction.sourceTypes).toContain("pdf");
    expect(capabilities.providerExtraction.support.image).toMatchObject({ available: false });
    expect(capabilities.unsupportedSourceTypes.map((item) => item.sourceType)).toEqual(["pptx", "xlsx", "unsupported"]);
    expect(serialized).not.toContain("test-secret");
    expect(serialized).not.toContain("MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY");
    expect(serialized).not.toContain(".northstar-private");
    expect(serialized).not.toContain("storedFile");
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("content.bin");
  });

  it("reports direct upload capabilities only when S3-compatible storage and provider support are configured", async () => {
    const fx = currentFixture();

    await withS3StorageEnv(async () => {
      await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
        const response = await invokeWorkspaceApi({
          method: "GET",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-capabilities"]
        });
        const capabilities = await readJson<{
          directUpload: { available: boolean; maxBytes: number; minBytes: number; sourceTypes: string[] };
          multipartUpload: {
            abortSupported: boolean;
            maxBytes: number;
            maxParts: number;
            minBytes: number;
            partSizeBytes: number;
            sourceTypes: string[];
            supported: boolean;
          };
          providerExtraction: { configured: boolean; support: Record<string, { available: boolean; directUpload: boolean }>; supportedSourceTypes: string[] };
          storage: { backendCategory: string; directUploadSupported: boolean };
        }>(response);
        const serialized = JSON.stringify(capabilities);

        expect(response.status).toBe(200);
        expect(capabilities).toMatchObject({
          directUpload: {
            available: true,
            maxBytes: 25 * 1024 * 1024,
            minBytes: 1024 * 1024
          },
          multipartUpload: {
            abortSupported: true,
            maxBytes: 50 * 1024 * 1024,
            maxParts: 10_000,
            minBytes: 25 * 1024 * 1024 + 1,
            partSizeBytes: 8 * 1024 * 1024,
            sourceTypes: ["image", "audio", "video", "pdf"],
            supported: true
          },
          providerExtraction: {
            configured: true,
            supportedSourceTypes: ["image", "audio", "video", "pdf"]
          },
          storage: {
            backendCategory: "s3-compatible",
            directUploadSupported: true
          }
        });
        expect(capabilities.directUpload.sourceTypes).toEqual(["image", "audio", "video", "pdf"]);
        expect(capabilities.multipartUpload.sourceTypes).toEqual(["image", "audio", "video", "pdf"]);
        expect(capabilities.providerExtraction.support.pdf).toMatchObject({ available: true, directUpload: true });
        expect(serialized).not.toContain("test-secret");
        expect(serialized).not.toContain("provider.example.test");
        expect(serialized).not.toContain("s3.example.test");
        expect(serialized).not.toContain("northstar-mi-test");
        expect(serialized).not.toContain("storedFile");
        expect(serialized).not.toContain("X-Amz-Signature");
      });
    });
  });

  it("creates and finalizes Meeting Intelligence direct upload sessions without file bytes in job JSON", async () => {
    const fx = currentFixture();
    const s3 = mockS3Storage();
    const bytes = Buffer.from("direct route audio bytes");
    const sha256 = testSha256(bytes);

    await withS3StorageEnv(async () => {
      await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
        vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
          const url = requestUrl(input);
          if (url.hostname === "s3.example.test") return s3.handle(input, init);
          return new Response(null, { status: 404 });
        });

        const sessionResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "audio",
            originalFilename: "direct-route-call.mp3",
            originalMimeType: "audio/mpeg",
            sha256
          }
        });
        const session = await readJson<{
          acceptedSourceType: string;
          intakeId: string;
          maxBytes: number;
          upload: { headers: Record<string, string>; method: "PUT"; url: string };
          uploadSessionId: string;
        }>(sessionResponse);
        const sessionJson = JSON.stringify(session);
        const uploadUrl = new URL(session.upload.url);
        const objectKey = decodeURIComponent(uploadUrl.pathname.replace(/^\/northstar-mi-test\/?/, "").replace(/\/content\.bin$/, ""));

        expect(sessionResponse.status).toBe(201);
        expect(session).toMatchObject({
          acceptedSourceType: "audio",
          intakeId: session.uploadSessionId,
          maxBytes: expect.any(Number),
          upload: {
            headers: { "content-type": "audio/mpeg" },
            method: "PUT"
          }
        });
        expect(sessionJson).not.toContain("test-secret");
        expect(sessionJson).not.toContain("storedFile");
        expect(sessionJson).not.toContain(".northstar-private");
        expect(uploadUrl.searchParams.get("X-Amz-Expires")).toBe("900");
        expect(s3.objects.has(`${objectKey}/metadata.json`)).toBe(true);
        expect(s3.objects.has(`${objectKey}/content.bin`)).toBe(false);

        const uploadResponse = await fetch(session.upload.url, {
          body: bytes,
          headers: session.upload.headers,
          method: "PUT"
        });
        expect(uploadResponse.status).toBe(200);

        const finalizeResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions", session.uploadSessionId, "finalize"],
          body: {
            byteLength: bytes.byteLength,
            contextText: "Meeting date: 2030-06-01",
            explicitSourceType: "audio",
            hints: { dealId: fx.recordsA.deal.id },
            originalFilename: "direct-route-call.mp3",
            originalMimeType: "audio/mpeg",
            sha256
          }
        });
        const finalized = await readJson<{ id: string; status: string; workspaceId: string }>(finalizeResponse);
        expect(finalizeResponse.status).toBe(200);
        expect(finalized).toMatchObject({ id: session.intakeId, status: "EXTRACTING", workspaceId: fx.workspaceA.id });
        const queuedIntake = await fx.prisma.meetingIntake.findUniqueOrThrow({
          where: { id: session.intakeId },
          select: { analysisJson: true }
        });
        const queuedAnalysis = queuedIntake.analysisJson as Record<string, unknown>;
        expect(queuedAnalysis.directUploadSession).toEqual({ status: "queued" });
        const job = await fx.prisma.job.findFirstOrThrow({
          where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" }
        });
        const jobPayload = job.payload as Record<string, unknown>;

        expect(jobPayload.fileBase64).toBeUndefined();
        expect(jobPayload).toMatchObject({
          sourceType: "audio",
          storedFile: {
            backend: "s3-compatible",
            byteLength: bytes.byteLength,
            sourceType: "audio",
            workspaceId: fx.workspaceA.id
          }
        });
        expect(JSON.stringify(jobPayload)).not.toContain(bytes.toString("base64"));

        const repeatedFinalizeResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions", session.uploadSessionId, "finalize"],
          body: {
            byteLength: bytes.byteLength,
            contextText: "Meeting date: 2030-06-01",
            explicitSourceType: "audio",
            hints: { dealId: fx.recordsA.deal.id },
            originalFilename: "direct-route-call.mp3",
            originalMimeType: "audio/mpeg",
            sha256
          }
        });
        const repeatedFinalizeBody = await readJson<ApiErrorBody>(repeatedFinalizeResponse);
        expect(repeatedFinalizeResponse.status).toBe(409);
        expect(repeatedFinalizeBody.error.code).toBe("MEETING_INTAKE_DIRECT_UPLOAD_INVALID_STATE");
        await expect(
          fx.prisma.job.count({ where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" } })
        ).resolves.toBe(1);
      });
    });
  });

  it("creates, signs, completes, and aborts Meeting Intelligence multipart upload sessions without file bytes in job JSON", async () => {
    const fx = currentFixture();
    const s3 = mockS3Storage();
    const bytes = Buffer.concat([
      Buffer.alloc(8 * 1024 * 1024, "a"),
      Buffer.alloc(8 * 1024 * 1024, "b"),
      Buffer.alloc(8 * 1024 * 1024, "c"),
      Buffer.from("route-tail")
    ]);
    const sha256 = testSha256(bytes);

    await withS3StorageEnv(async () => {
      await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
        vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
          const url = requestUrl(input);
          if (url.hostname === "s3.example.test") return s3.handle(input, init);
          return new Response(null, { status: 404 });
        });

        const sessionResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "audio",
            originalFilename: "multipart-route-call.mp3",
            originalMimeType: "audio/mpeg",
            sha256
          }
        });
        const session = await readJson<{
          acceptedSourceType: string;
          intakeId: string;
          multipart: {
            abortSupported: boolean;
            maxParts: number;
            partCount: number;
            partSizeBytes: number;
            signPartExpiresInSeconds: number;
          };
          uploadSessionId: string;
        }>(sessionResponse);
        const sessionJson = JSON.stringify(session);

        expect(sessionResponse.status).toBe(201);
        expect(session).toMatchObject({
          acceptedSourceType: "audio",
          intakeId: session.uploadSessionId,
          multipart: {
            abortSupported: true,
            maxParts: 10_000,
            partCount: 4,
            partSizeBytes: 8 * 1024 * 1024,
            signPartExpiresInSeconds: 900
          }
        });
        expect(sessionJson).not.toContain("test-secret");
        expect(sessionJson).not.toContain("storedFile");
        expect(sessionJson).not.toContain("s3.example.test");
        expect(sessionJson).not.toContain("northstar-mi-test");
        expect(sessionJson).not.toContain("multipart-route-call.mp3");
        expect(s3.multipartUploads.size).toBe(1);

        const crossWorkspaceInspectResponse = await invokeWorkspaceApi({
          method: "GET",
          workspaceId: fx.workspaceB.id,
          actorUserId: fx.userB.id,
          segments: ["meeting-intake-multipart-upload-sessions", session.uploadSessionId]
        });
        const crossWorkspaceInspectBody = await readJson<ApiErrorBody>(crossWorkspaceInspectResponse);
        expect(crossWorkspaceInspectResponse.status).toBe(404);
        expect(crossWorkspaceInspectBody.error.code).toBe("NOT_FOUND");

        const invalidPartResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", session.uploadSessionId, "parts"],
          body: { partNumbers: [999] }
        });
        const invalidPartBody = await readJson<ApiErrorBody>(invalidPartResponse);
        expect(invalidPartResponse.status).toBe(422);
        expect(invalidPartBody.error.code).toBe("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID");

        const completedParts: Array<{ etag: string; partNumber: number }> = [];
        for (let partNumber = 1; partNumber <= session.multipart.partCount; partNumber += 1) {
          const partsResponse = await invokeWorkspaceApi({
            method: "POST",
            workspaceId: fx.workspaceA.id,
            actorUserId: fx.userA.id,
            segments: ["meeting-intake-multipart-upload-sessions", session.uploadSessionId, "parts"],
            body: { partNumbers: [partNumber] }
          });
          const signed = await readJson<{
            parts: Array<{ partNumber: number; upload: { headers: Record<string, string>; method: "PUT"; url: string } }>;
            uploadSessionId: string;
          }>(partsResponse);
          const uploadPart = signed.parts[0];
          expect(partsResponse.status).toBe(200);
          expect(uploadPart).toMatchObject({ partNumber });
          expect(JSON.stringify(signed)).not.toContain("test-secret");
          expect(JSON.stringify(signed)).not.toContain("multipart-route-call.mp3");
          const start = (partNumber - 1) * session.multipart.partSizeBytes;
          const end = Math.min(start + session.multipart.partSizeBytes, bytes.byteLength);
          const uploadResponse = await fetch(uploadPart.upload.url, {
            body: bytes.subarray(start, end),
            headers: uploadPart.upload.headers,
            method: uploadPart.upload.method
          });
          expect(uploadResponse.status).toBe(200);
          completedParts.push({ etag: uploadResponse.headers.get("etag") ?? "", partNumber });
        }

        const inspectResponse = await invokeWorkspaceApi({
          method: "GET",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", session.uploadSessionId]
        });
        const inspected = await readJson<{
          abortAllowed: boolean;
          byteLength: number;
          multipart: {
            partCount: number;
            uploadedPartCount: number;
            uploadedParts: Array<{ etag: string; partNumber: number; sizeBytes: number }>;
          };
          resumeAllowed: boolean;
          status: string;
        }>(inspectResponse);
        const inspectedJson = JSON.stringify(inspected);
        expect(inspectResponse.status).toBe(200);
        expect(inspected).toMatchObject({
          abortAllowed: true,
          byteLength: bytes.byteLength,
          multipart: {
            partCount: 4,
            uploadedPartCount: 4,
            uploadedParts: completedParts.map((part, index) => ({
              etag: part.etag,
              partNumber: part.partNumber,
              sizeBytes: index === 3 ? Buffer.byteLength("route-tail") : 8 * 1024 * 1024
            }))
          },
          resumeAllowed: true,
          status: "awaiting_parts"
        });
        expect(inspectedJson).not.toContain("test-secret");
        expect(inspectedJson).not.toContain("storedFile");
        expect(inspectedJson).not.toContain("s3.example.test");
        expect(inspectedJson).not.toContain("northstar-mi-test");
        expect(inspectedJson).not.toContain("multipart-route-call.mp3");

        const completeResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", session.uploadSessionId, "complete"],
          body: {
            byteLength: bytes.byteLength,
            contextText: "Meeting date: 2030-06-02",
            explicitSourceType: "audio",
            hints: { dealId: fx.recordsA.deal.id },
            originalFilename: "multipart-route-call.mp3",
            originalMimeType: "audio/mpeg",
            parts: completedParts,
            sha256
          }
        });
        const completed = await readJson<{ id: string; status: string; workspaceId: string }>(completeResponse);
        expect(completeResponse.status).toBe(200);
        expect(completed).toMatchObject({ id: session.intakeId, status: "EXTRACTING", workspaceId: fx.workspaceA.id });
        expect(s3.multipartUploads.size).toBe(0);
        const job = await fx.prisma.job.findFirstOrThrow({
          where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" }
        });
        const jobPayload = job.payload as Record<string, unknown>;
        expect(jobPayload.fileBase64).toBeUndefined();
        expect(jobPayload).toMatchObject({
          sourceType: "audio",
          storedFile: {
            backend: "s3-compatible",
            byteLength: bytes.byteLength,
            sourceType: "audio",
            workspaceId: fx.workspaceA.id
          }
        });
        expect(JSON.stringify(jobPayload)).not.toContain(bytes.toString("base64"));

        const inspectQueuedResponse = await invokeWorkspaceApi({
          method: "GET",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", session.uploadSessionId]
        });
        const inspectQueued = await readJson<{ resumeAllowed: boolean; status: string; uploadSessionId: string }>(inspectQueuedResponse);
        expect(inspectQueuedResponse.status).toBe(200);
        expect(inspectQueued).toMatchObject({
          resumeAllowed: false,
          status: "queued",
          uploadSessionId: session.uploadSessionId
        });

        const repeatedCompleteResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", session.uploadSessionId, "complete"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "audio",
            parts: completedParts,
            sha256
          }
        });
        const repeatedCompleteBody = await readJson<ApiErrorBody>(repeatedCompleteResponse);
        expect(repeatedCompleteResponse.status).toBe(409);
        expect(repeatedCompleteBody.error.code).toBe("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE");
        await expect(
          fx.prisma.job.count({ where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" } })
        ).resolves.toBe(1);

        const abortSessionResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "audio",
            originalFilename: "aborted-multipart-route-call.mp3",
            originalMimeType: "audio/mpeg",
            sha256
          }
        });
        const abortSession = await readJson<{ uploadSessionId: string }>(abortSessionResponse);
        expect(abortSessionResponse.status).toBe(201);
        expect(s3.multipartUploads.size).toBe(1);
        const abortResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", abortSession.uploadSessionId, "abort"]
        });
        const aborted = await readJson<{ errorMessage: string; status: string }>(abortResponse);
        expect(abortResponse.status).toBe(200);
        expect(aborted).toMatchObject({ errorMessage: "Multipart upload was aborted.", status: "FAILED" });
        expect(s3.multipartUploads.size).toBe(0);
        const completeAfterAbortResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", abortSession.uploadSessionId, "complete"],
          body: { byteLength: bytes.byteLength, explicitSourceType: "audio", parts: completedParts, sha256 }
        });
        const completeAfterAbortBody = await readJson<ApiErrorBody>(completeAfterAbortResponse);
        expect(completeAfterAbortResponse.status).toBe(409);
        expect(completeAfterAbortBody.error.code).toBe("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE");
        const inspectAfterAbortResponse = await invokeWorkspaceApi({
          method: "GET",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-multipart-upload-sessions", abortSession.uploadSessionId]
        });
        const inspectAfterAbortBody = await readJson<ApiErrorBody>(inspectAfterAbortResponse);
        expect(inspectAfterAbortResponse.status).toBe(409);
        expect(inspectAfterAbortBody.error.code).toBe("MEETING_INTAKE_MULTIPART_UPLOAD_INVALID_STATE");
      });
    });
  });

  it("rejects local direct upload sessions and invalid finalization metadata clearly", async () => {
    const fx = currentFixture();
    const bytes = Buffer.from("direct route image bytes");
    const sha256 = testSha256(bytes);
    const localCountBefore = await fx.prisma.meetingIntake.count({ where: { workspaceId: fx.workspaceA.id } });

    await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
      const localResponse = await invokeWorkspaceApi({
        method: "POST",
        workspaceId: fx.workspaceA.id,
        actorUserId: fx.userA.id,
        segments: ["meeting-intake-upload-sessions"],
        body: {
          byteLength: bytes.byteLength,
          explicitSourceType: "image",
          originalFilename: "whiteboard.png",
          originalMimeType: "image/png",
          sha256
        }
      });
      const localBody = await readJson<ApiErrorBody>(localResponse);

      expect(localResponse.status).toBe(422);
      expect(localBody.error).toMatchObject({
        code: "MEETING_INTAKE_DIRECT_UPLOAD_UNAVAILABLE"
      });
      await expect(fx.prisma.meetingIntake.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(localCountBefore);

      const localMultipartResponse = await invokeWorkspaceApi({
        method: "POST",
        workspaceId: fx.workspaceA.id,
        actorUserId: fx.userA.id,
        segments: ["meeting-intake-multipart-upload-sessions"],
        body: {
          byteLength: bytes.byteLength,
          explicitSourceType: "image",
          originalFilename: "whiteboard.png",
          originalMimeType: "image/png",
          sha256
        }
      });
      const localMultipartBody = await readJson<ApiErrorBody>(localMultipartResponse);

      expect(localMultipartResponse.status).toBe(422);
      expect(localMultipartBody.error).toMatchObject({
        code: "MEETING_INTAKE_MULTIPART_UPLOAD_UNAVAILABLE"
      });
      await expect(fx.prisma.meetingIntake.count({ where: { workspaceId: fx.workspaceA.id } })).resolves.toBe(localCountBefore);
    });

    const s3 = mockS3Storage();
    await withS3StorageEnv(async () => {
      await withMeetingMediaProviderEnv("https://provider.example.test/meeting-media", async () => {
        vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => s3.handle(input, init));
        const sessionResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "image",
            originalFilename: "whiteboard.png",
            originalMimeType: "image/png",
            sha256
          }
        });
        const session = await readJson<{ upload: { headers: Record<string, string>; method: "PUT"; url: string }; uploadSessionId: string }>(
          sessionResponse
        );
        await fetch(session.upload.url, { body: bytes, headers: session.upload.headers, method: "PUT" });

        const mismatchResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions", session.uploadSessionId, "finalize"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "video",
            originalFilename: "whiteboard.png",
            originalMimeType: "image/png",
            sha256
          }
        });
        const mismatchBody = await readJson<ApiErrorBody>(mismatchResponse);

        expect(mismatchResponse.status).toBe(422);
        expect(mismatchBody.error).toMatchObject({
          code: "MEETING_INTAKE_STORED_FILE_INVALID"
        });
        const sizeMismatchResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions", session.uploadSessionId, "finalize"],
          body: {
            byteLength: bytes.byteLength + 1,
            explicitSourceType: "image",
            originalFilename: "whiteboard.png",
            originalMimeType: "image/png",
            sha256
          }
        });
        const sizeMismatchBody = await readJson<ApiErrorBody>(sizeMismatchResponse);
        expect(sizeMismatchResponse.status).toBe(422);
        expect(sizeMismatchBody.error).toMatchObject({
          code: "MEETING_INTAKE_STORED_FILE_SIZE_MISMATCH"
        });
        const checksumMismatchResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions", session.uploadSessionId, "finalize"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "image",
            originalFilename: "whiteboard.png",
            originalMimeType: "image/png",
            sha256: testSha256(Buffer.from("different"))
          }
        });
        const checksumMismatchBody = await readJson<ApiErrorBody>(checksumMismatchResponse);
        expect(checksumMismatchResponse.status).toBe(422);
        expect(checksumMismatchBody.error).toMatchObject({
          code: "MEETING_INTAKE_STORED_FILE_CHECKSUM_MISMATCH"
        });
        const crossWorkspaceFinalizeResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceB.id,
          actorUserId: fx.userB.id,
          segments: ["meeting-intake-upload-sessions", session.uploadSessionId, "finalize"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "image",
            originalFilename: "whiteboard.png",
            originalMimeType: "image/png",
            sha256
          }
        });
        const crossWorkspaceFinalizeBody = await readJson<ApiErrorBody>(crossWorkspaceFinalizeResponse);
        expect(crossWorkspaceFinalizeResponse.status).toBe(404);
        expect(crossWorkspaceFinalizeBody.error.code).toBe("NOT_FOUND");

        const expiredSessionResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "image",
            originalFilename: "expired-whiteboard.png",
            originalMimeType: "image/png",
            sha256
          }
        });
        const expiredSession = await readJson<{ upload: { headers: Record<string, string>; method: "PUT"; url: string }; uploadSessionId: string }>(
          expiredSessionResponse
        );
        await fetch(expiredSession.upload.url, { body: bytes, headers: expiredSession.upload.headers, method: "PUT" });
        const expiredObjectKey = decodeURIComponent(
          new URL(expiredSession.upload.url).pathname.replace(/^\/northstar-mi-test\/?/, "").replace(/\/content\.bin$/, "")
        );
        const expiredMetadataKey = `${expiredObjectKey}/metadata.json`;
        const expiredMetadata = JSON.parse(s3.objects.get(expiredMetadataKey)?.toString("utf8") ?? "{}") as Record<string, unknown>;
        s3.objects.set(
          expiredMetadataKey,
          Buffer.from(JSON.stringify({ ...expiredMetadata, expiresAt: "2000-01-01T00:00:00.000Z" }))
        );
        const expiredFinalizeResponse = await invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["meeting-intake-upload-sessions", expiredSession.uploadSessionId, "finalize"],
          body: {
            byteLength: bytes.byteLength,
            explicitSourceType: "image",
            originalFilename: "expired-whiteboard.png",
            originalMimeType: "image/png",
            sha256
          }
        });
        const expiredFinalizeBody = await readJson<ApiErrorBody>(expiredFinalizeResponse);
        expect(expiredFinalizeResponse.status).toBe(410);
        expect(expiredFinalizeBody.error.code).toBe("MEETING_INTAKE_STORED_FILE_EXPIRED");
        await expect(
          fx.prisma.job.count({ where: { workspaceId: fx.workspaceA.id, type: "meeting_intake.extract_media" } })
        ).resolves.toBe(0);
      });
    });
  });

  it("validates pipeline and stage sort orders before writing records through the workspace API", async () => {
    const fx = currentFixture();

    const oversizedPipelineResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["pipelines"],
      body: {
        name: "Oversized Pipeline Order",
        sortOrder: sortOrderIntColumnMax + 1
      }
    });
    const oversizedPipelineBody = await readJson<ApiErrorBody>(oversizedPipelineResponse);
    const oversizedStageResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["pipelines", fx.recordsA.pipeline.id, "stages"],
      body: {
        name: "Oversized Stage Order",
        probability: 10,
        sortOrder: sortOrderIntColumnMax + 1
      }
    });
    const oversizedStageBody = await readJson<ApiErrorBody>(oversizedStageResponse);
    const oversizedStageUpdateResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["stages", fx.recordsA.stageOne.id],
      body: {
        sortOrder: sortOrderIntColumnMax + 1
      }
    });
    const oversizedStageUpdateBody = await readJson<ApiErrorBody>(oversizedStageUpdateResponse);
    const inUsePipelineDeleteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["pipelines", fx.recordsA.pipeline.id]
    });
    const inUsePipelineDeleteBody = await readJson<ApiErrorBody>(inUsePipelineDeleteResponse);
    const inUseStageDeleteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["stages", fx.recordsA.stageOne.id]
    });
    const inUseStageDeleteBody = await readJson<ApiErrorBody>(inUseStageDeleteResponse);
    const unusedPipelineCreateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["pipelines"],
      body: {
        name: "Unused API Delete Pipeline",
        sortOrder: 99
      }
    });
    const unusedPipeline = await readJson<{ id: string }>(unusedPipelineCreateResponse);
    const unusedStageCreateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["pipelines", unusedPipeline.id, "stages"],
      body: {
        name: "Unused API Delete Stage",
        sortOrder: 1
      }
    });
    const unusedStage = await readJson<{ id: string }>(unusedStageCreateResponse);
    const unusedStageDeleteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["stages", unusedStage.id]
    });
    const unusedPipelineDeleteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["pipelines", unusedPipeline.id]
    });

    expect(oversizedPipelineResponse.status).toBe(422);
    expect(oversizedPipelineBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(JSON.stringify(oversizedPipelineBody.error.details)).toContain("Sort order is too large.");
    expect(oversizedStageResponse.status).toBe(422);
    expect(JSON.stringify(oversizedStageBody.error.details)).toContain("Sort order is too large.");
    expect(oversizedStageUpdateResponse.status).toBe(422);
    expect(JSON.stringify(oversizedStageUpdateBody.error.details)).toContain("Sort order is too large.");
    expect(inUsePipelineDeleteResponse.status).toBe(409);
    expect(inUsePipelineDeleteBody.error).toMatchObject({
      code: "PIPELINE_IN_USE",
      message: "Move or delete active deals before deleting this pipeline."
    });
    expect(inUseStageDeleteResponse.status).toBe(409);
    expect(inUseStageDeleteBody.error).toMatchObject({
      code: "STAGE_IN_USE",
      message: "Move or delete active deals before deleting this stage."
    });
    expect(unusedPipelineCreateResponse.status).toBe(201);
    expect(unusedStageCreateResponse.status).toBe(201);
    expect(unusedStageDeleteResponse.status).toBe(204);
    expect(unusedPipelineDeleteResponse.status).toBe(204);
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
    const malformedPatchResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id],
      rawBody: "{\"title\":\"Malformed API Deal\",\"resetToken\":\"deal-reset-token\",\"apiKey\":\"deal-api-key\""
    });
    const malformedPatchBody = await readJson<ApiErrorBody>(malformedPatchResponse);
    const malformedPatchSerialized = JSON.stringify(malformedPatchBody);
    const oversizedCreateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Oversized API Deal",
        valueCents: dealValueCentsMax + 1,
        currency: "USD"
      }
    });
    const oversizedCreateBody = await readJson<ApiErrorBody>(oversizedCreateResponse);
    const oversizedUpdateResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id],
      body: {
        valueCents: dealValueCentsMax + 1
      }
    });
    const oversizedUpdateBody = await readJson<ApiErrorBody>(oversizedUpdateResponse);
    const invalidStageCreateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsB.stageOne.id,
        title: "Wrong workspace stage API deal",
        valueCents: 10000,
        currency: "USD"
      }
    });
    const invalidStageCreateBody = await readJson<ApiErrorBody>(invalidStageCreateResponse);
    const invalidStageUpdateResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id],
      body: {
        stageId: fx.recordsB.stageOne.id
      }
    });
    const invalidStageUpdateBody = await readJson<ApiErrorBody>(invalidStageUpdateResponse);
    const invalidPipelineMoveResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id],
      body: {
        pipelineId: fx.recordsB.pipeline.id,
        stageId: fx.recordsB.stageOne.id
      }
    });
    const invalidPipelineMoveBody = await readJson<ApiErrorBody>(invalidPipelineMoveResponse);
    const invalidRelationCreateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        personId: fx.recordsB.person.id,
        title: "Wrong workspace contact API deal",
        valueCents: 10000,
        currency: "USD"
      }
    });
    const invalidRelationCreateBody = await readJson<ApiErrorBody>(invalidRelationCreateResponse);
    const invalidRelationUpdateResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id],
      body: {
        organizationId: fx.recordsB.organization.id
      }
    });
    const invalidRelationUpdateBody = await readJson<ApiErrorBody>(invalidRelationUpdateResponse);

    expect(updateResponse.status).toBe(200);
    expect(updatedDeal.title).toBe("API Updated Deal");
    expect(updatedDeal.stageId).toBe(fx.recordsA.stageTwo.id);
    expect(updatedDeal.valueCents).toBe(430000);
    expect(malformedPatchResponse.status).toBe(422);
    expect(malformedPatchBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(malformedPatchSerialized).not.toContain("deal-reset-token");
    expect(malformedPatchSerialized).not.toContain("deal-api-key");
    expect(oversizedCreateResponse.status).toBe(422);
    expect(oversizedCreateBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(JSON.stringify(oversizedCreateBody.error.details)).toContain("Deal value is too large.");
    expect(oversizedUpdateResponse.status).toBe(422);
    expect(oversizedUpdateBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(JSON.stringify(oversizedUpdateBody.error.details)).toContain("Deal value is too large.");
    expect(invalidStageCreateResponse.status).toBe(422);
    expect(invalidStageCreateBody.error).toMatchObject({
      code: "INVALID_STAGE",
      message: "The stage must belong to the selected pipeline and workspace."
    });
    expect(invalidStageUpdateResponse.status).toBe(422);
    expect(invalidStageUpdateBody.error).toMatchObject({
      code: "INVALID_STAGE",
      message: "The stage must belong to the selected pipeline and workspace."
    });
    expect(invalidPipelineMoveResponse.status).toBe(422);
    expect(invalidPipelineMoveBody.error).toMatchObject({
      code: "INVALID_PIPELINE_MOVE",
      message: "Move the deal within its current pipeline."
    });
    expect(invalidRelationCreateResponse.status).toBe(404);
    expect(invalidRelationCreateBody.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Record was not found in this workspace."
    });
    expect(invalidRelationUpdateResponse.status).toBe(404);
    expect(invalidRelationUpdateBody.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Record was not found in this workspace."
    });
    await expect(fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id, title: "Wrong workspace stage API deal" } })).resolves.toBe(0);
    await expect(fx.prisma.deal.count({ where: { workspaceId: fx.workspaceA.id, title: "Wrong workspace contact API deal" } })).resolves.toBe(0);
    await expect(fx.prisma.deal.findUniqueOrThrow({ where: { id: createdDeal.id } })).resolves.toMatchObject({
      pipelineId: fx.recordsA.pipeline.id,
      stageId: fx.recordsA.stageTwo.id,
      organizationId: fx.recordsA.organization.id,
      title: "API Updated Deal",
      valueCents: 430000
    });

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

    const deleteClosedResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id]
    });
    const deleteClosedBody = await readJson<ApiErrorBody>(deleteClosedResponse);

    expect(deleteClosedResponse.status).toBe(409);
    expect(deleteClosedBody.error.code).toBe("DEAL_CLOSED");

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

    const deleteOpenResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", createdDeal.id]
    });
    const deletedDeal = await fx.prisma.deal.findUniqueOrThrow({ where: { id: createdDeal.id } });

    expect(deleteOpenResponse.status).toBe(204);
    expect(deletedDeal.deletedAt).toBeInstanceOf(Date);
  });

  it("blocks deal line item mutations on closed deals through the workspace API", async () => {
    const fx = currentFixture();

    const productResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      body: {
        name: "Closed Deal Line Item Package",
        description: "Lifecycle lock proof",
        unitPriceCents: 97500,
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
        quantity: 1
      }
    });
    const lineItem = await readJson<{ id: string }>(lineItemResponse);

    const closeResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "close"],
      body: { status: "WON" }
    });

    const createAfterCloseResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "line-items"],
      body: {
        productId: product.id,
        quantity: 2
      }
    });
    const createAfterCloseBody = await readJson<ApiErrorBody>(createAfterCloseResponse);

    const deleteAfterCloseResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deal-line-items", lineItem.id]
    });
    const deleteAfterCloseBody = await readJson<ApiErrorBody>(deleteAfterCloseResponse);

    expect(productResponse.status).toBe(201);
    expect(lineItemResponse.status).toBe(201);
    expect(closeResponse.status).toBe(200);
    expect(createAfterCloseResponse.status).toBe(409);
    expect(createAfterCloseBody.error.code).toBe("DEAL_CLOSED");
    expect(deleteAfterCloseResponse.status).toBe(409);
    expect(deleteAfterCloseBody.error.code).toBe("DEAL_CLOSED");
    await expect(fx.prisma.dealLineItem.findUnique({ where: { id: lineItem.id } })).resolves.toMatchObject({
      id: lineItem.id,
      dealId: fx.recordsA.deal.id
    });
  });

  it("rejects cross-workspace products when adding deal line items through the workspace API", async () => {
    const fx = currentFixture();
    const otherWorkspaceProduct = await fx.prisma.product.create({
      data: {
        workspaceId: fx.workspaceB.id,
        name: "Other Workspace Line Item Package",
        unitPriceCents: 99000,
        currency: "USD",
        active: true
      }
    });
    const initialLineItemCount = await fx.prisma.dealLineItem.count({
      where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id }
    });

    const response = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "line-items"],
      body: {
        productId: otherWorkspaceProduct.id,
        quantity: 1
      }
    });
    const body = await readJson<ApiErrorBody>(response);
    const lineItemCount = await fx.prisma.dealLineItem.count({
      where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id }
    });

    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Product was not found."
    });
    expect(lineItemCount).toBe(initialLineItemCount);
    await expect(fx.prisma.product.findUniqueOrThrow({ where: { id: otherWorkspaceProduct.id } })).resolves.toMatchObject({
      workspaceId: fx.workspaceB.id,
      active: true
    });
  });

  it("rejects inactive products when adding deal line items through the workspace API", async () => {
    const fx = currentFixture();

    const productResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      body: {
        name: "Inactive Line Item Package",
        description: "Should not be addable after deactivation",
        unitPriceCents: 64000,
        currency: "USD"
      }
    });
    const product = await readJson<{ id: string }>(productResponse);
    const deactivateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products", product.id, "deactivate"]
    });
    const initialLineItemCount = await fx.prisma.dealLineItem.count({
      where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id }
    });
    const initialLineItemAuditCount = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "deal_line_item.created",
        entityType: "DealLineItem"
      }
    });

    const response = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "line-items"],
      body: {
        productId: product.id,
        quantity: 1
      }
    });
    const body = await readJson<ApiErrorBody>(response);
    const lineItemCount = await fx.prisma.dealLineItem.count({
      where: { workspaceId: fx.workspaceA.id, dealId: fx.recordsA.deal.id }
    });
    const lineItemAuditCount = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "deal_line_item.created",
        entityType: "DealLineItem"
      }
    });

    expect(productResponse.status).toBe(201);
    expect(deactivateResponse.status).toBe(200);
    expect(response.status).toBe(404);
    expect(body.error).toMatchObject({
      code: "NOT_FOUND",
      message: "Product was not found."
    });
    expect(lineItemCount).toBe(initialLineItemCount);
    expect(lineItemAuditCount).toBe(initialLineItemAuditCount);
    await expect(fx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).resolves.toMatchObject({
      workspaceId: fx.workspaceA.id,
      active: false
    });
  });

  it("rejects product prices that exceed integer storage through the workspace API", async () => {
    const fx = currentFixture();
    const productName = `Oversized Product ${Date.now()}`;

    const response = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      body: {
        name: productName,
        unitPriceCents: productIntColumnMax + 1,
        currency: "USD"
      }
    });
    const body = await readJson<ApiErrorBody>(response);
    const productCount = await fx.prisma.product.count({
      where: { workspaceId: fx.workspaceA.id, name: productName }
    });

    expect(response.status).toBe(422);
    expect(body.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(JSON.stringify(body.error.details)).toContain("Product unit price is too large.");
    expect(productCount).toBe(0);
  });

  it("toggles product activity through the workspace API without crossing workspaces", async () => {
    const fx = currentFixture();
    const product = await fx.prisma.product.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Route Toggle Product",
        unitPriceCents: 42000,
        currency: "USD",
        active: true
      }
    });
    const otherWorkspaceProduct = await fx.prisma.product.create({
      data: {
        workspaceId: fx.workspaceB.id,
        name: "Other Workspace Route Product",
        unitPriceCents: 99000,
        currency: "USD",
        active: true
      }
    });

    const deactivateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products", product.id, "deactivate"]
    });
    const deactivatedProduct = await readJson<{ id: string; active: boolean }>(deactivateResponse);
    const crossWorkspaceDeactivateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products", otherWorkspaceProduct.id, "deactivate"]
    });
    const crossWorkspaceDeactivateBody = await readJson<ApiErrorBody>(crossWorkspaceDeactivateResponse);
    const activateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products", product.id, "activate"]
    });
    const activatedProduct = await readJson<{ id: string; active: boolean }>(activateResponse);

    expect(deactivateResponse.status).toBe(200);
    expect(deactivatedProduct).toMatchObject({ id: product.id, active: false });
    expect(crossWorkspaceDeactivateResponse.status).toBe(404);
    expect(crossWorkspaceDeactivateBody.error.code).toBe("NOT_FOUND");
    expect(activateResponse.status).toBe(200);
    expect(activatedProduct).toMatchObject({ id: product.id, active: true });
    await expect(fx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).resolves.toMatchObject({
      active: true
    });
    await expect(
      fx.prisma.product.findUniqueOrThrow({ where: { id: otherWorkspaceProduct.id } })
    ).resolves.toMatchObject({
      active: true
    });
    await expect(
      fx.prisma.auditLog.findMany({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Product",
          entityId: product.id
        },
        orderBy: { createdAt: "asc" }
      })
    ).resolves.toEqual([
      expect.objectContaining({ action: "product.deactivated" }),
      expect.objectContaining({ action: "product.reactivated" })
    ]);
  });

  it("blocks deal line item removal after the parent deal is deleted through the workspace API", async () => {
    const fx = currentFixture();

    const productResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      body: {
        name: "Deleted Deal Line Item Package",
        description: "Deleted lifecycle lock proof",
        unitPriceCents: 87500,
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
        quantity: 1
      }
    });
    const lineItem = await readJson<{ id: string }>(lineItemResponse);

    const deleteDealResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id]
    });

    const deleteLineItemResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deal-line-items", lineItem.id]
    });
    const deleteLineItemBody = await readJson<ApiErrorBody>(deleteLineItemResponse);

    expect(productResponse.status).toBe(201);
    expect(lineItemResponse.status).toBe(201);
    expect(deleteDealResponse.status).toBe(204);
    expect(deleteLineItemResponse.status).toBe(404);
    expect(deleteLineItemBody.error.code).toBe("NOT_FOUND");
    await expect(fx.prisma.dealLineItem.findUnique({ where: { id: lineItem.id } })).resolves.toMatchObject({
      id: lineItem.id,
      dealId: fx.recordsA.deal.id
    });
  });

  it("manages deal contract workflow through workspace-scoped API routes", async () => {
    const fx = currentFixture();

    const emptyListResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"]
    });
    const emptySteps = await readJson<unknown[]>(emptyListResponse);

    expect(emptyListResponse.status).toBe(200);
    expect(emptySteps).toEqual([]);

    const blockedMsaResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "MSA",
        status: "SENT"
      }
    });
    const blockedMsaBody = await readJson<ApiErrorBody>(blockedMsaResponse);

    expect(blockedMsaResponse.status).toBe(409);
    expect(blockedMsaBody.error.code).toBe("CONTRACT_SEQUENCE_BLOCKED");
    expect(blockedMsaBody.error.message).toBe("MSA cannot move forward until NDA is signed or skipped.");

    const ndaResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "NDA",
        status: "SIGNED",
        ownerId: fx.userA.id,
        dueAt: "2030-04-01T00:00:00.000Z",
        notes: "  API NDA signed.  ",
        externalReference: "  doc-nda-api  "
      }
    });
    const nda = await readJson<{
      id: string;
      type: string;
      status: string;
      ownerId: string;
      owner: { email: string };
      dueAt: string;
      sentAt: string;
      signedAt: string;
      notes: string;
      externalReference: string;
    }>(ndaResponse);

    expect(ndaResponse.status).toBe(201);
    expect(nda).toMatchObject({
      type: "NDA",
      status: "SIGNED",
      ownerId: fx.userA.id,
      owner: { email: fx.userA.email },
      dueAt: "2030-04-01T00:00:00.000Z",
      notes: "API NDA signed.",
      externalReference: "doc-nda-api"
    });
    expect(nda.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(nda.signedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const duplicateNdaResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "NDA",
        status: "SKIPPED"
      }
    });
    const duplicateNdaBody = await readJson<ApiErrorBody>(duplicateNdaResponse);

    expect(duplicateNdaResponse.status).toBe(409);
    expect(duplicateNdaBody.error.code).toBe("CONTRACT_STEP_EXISTS");

    const msaResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "MSA",
        status: "SENT",
        sentAt: "2030-04-02T00:00:00.000Z"
      }
    });
    const msa = await readJson<{ id: string; type: string; status: string; sentAt: string }>(msaResponse);

    expect(msaResponse.status).toBe(201);
    expect(msa).toMatchObject({
      type: "MSA",
      status: "SENT",
      sentAt: "2030-04-02T00:00:00.000Z"
    });

    const invalidOwnerResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["contract-steps", msa.id],
      body: {
        ownerId: fx.userB.id
      }
    });
    const invalidOwnerBody = await readJson<ApiErrorBody>(invalidOwnerResponse);

    expect(invalidOwnerResponse.status).toBe(404);
    expect(invalidOwnerBody.error.code).toBe("NOT_FOUND");
    expect(invalidOwnerBody.error.message).toBe("User was not found in this workspace.");

    const sowBlockedResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "SOW",
        status: "SENT"
      }
    });
    const sowBlockedBody = await readJson<ApiErrorBody>(sowBlockedResponse);

    expect(sowBlockedResponse.status).toBe(409);
    expect(sowBlockedBody.error.code).toBe("CONTRACT_SEQUENCE_BLOCKED");
    expect(sowBlockedBody.error.message).toBe("SOW cannot move forward until MSA is signed or skipped.");

    const signedMsaResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["contract-steps", msa.id],
      body: {
        status: "SIGNED",
        signedAt: "2030-04-03T00:00:00.000Z"
      }
    });
    const signedMsa = await readJson<{ id: string; status: string; signedAt: string }>(signedMsaResponse);

    expect(signedMsaResponse.status).toBe(200);
    expect(signedMsa.status).toBe("SIGNED");
    expect(signedMsa.signedAt).toBe("2030-04-03T00:00:00.000Z");

    const sowResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "SOW",
        status: "IN_PROGRESS"
      }
    });
    const sow = await readJson<{ id: string; type: string; status: string }>(sowResponse);

    expect(sowResponse.status).toBe(201);
    expect(sow).toMatchObject({ type: "SOW", status: "IN_PROGRESS" });

    const listResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"]
    });
    const listedSteps = await readJson<Array<{ id: string; type: string; status: string }>>(listResponse);

    expect(listResponse.status).toBe(200);
    expect(listedSteps.map((step) => [step.id, step.type, step.status])).toEqual([
      [nda.id, "NDA", "SIGNED"],
      [msa.id, "MSA", "SIGNED"],
      [sow.id, "SOW", "IN_PROGRESS"]
    ]);

    const crossWorkspaceDealResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsB.deal.id, "contracts"]
    });
    const crossWorkspaceDealBody = await readJson<ApiErrorBody>(crossWorkspaceDealResponse);

    expect(crossWorkspaceDealResponse.status).toBe(404);
    expect(crossWorkspaceDealBody.error.code).toBe("NOT_FOUND");

    const crossWorkspaceStepResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceB.id,
      actorUserId: fx.userB.id,
      segments: ["contract-steps", nda.id],
      body: {
        status: "SKIPPED"
      }
    });
    const crossWorkspaceStepBody = await readJson<ApiErrorBody>(crossWorkspaceStepResponse);

    expect(crossWorkspaceStepResponse.status).toBe(404);
    expect(crossWorkspaceStepBody.error.code).toBe("NOT_FOUND");
  });

  it("blocks contract workflow mutations on closed deals through the workspace API", async () => {
    const fx = currentFixture();

    const ndaResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "NDA",
        status: "IN_PROGRESS",
        notes: "Before close"
      }
    });
    const nda = await readJson<{ id: string }>(ndaResponse);

    await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "close"],
      body: { status: "WON" }
    });

    const createAfterCloseResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts"],
      body: {
        type: "MSA",
        status: "SENT"
      }
    });
    const createAfterCloseBody = await readJson<ApiErrorBody>(createAfterCloseResponse);

    const updateAfterCloseResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["contract-steps", nda.id],
      body: {
        status: "SIGNED",
        notes: "After close"
      }
    });
    const updateAfterCloseBody = await readJson<ApiErrorBody>(updateAfterCloseResponse);

    expect(ndaResponse.status).toBe(201);
    expect(createAfterCloseResponse.status).toBe(409);
    expect(createAfterCloseBody.error.code).toBe("DEAL_CLOSED");
    expect(updateAfterCloseResponse.status).toBe(409);
    expect(updateAfterCloseBody.error.code).toBe("DEAL_CLOSED");
    await expect(fx.prisma.dealContractStep.findUnique({ where: { id: nda.id } })).resolves.toMatchObject({
      status: "IN_PROGRESS",
      notes: "Before close"
    });
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
    const oversizedFixedAdjustmentResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "adjustments"],
      body: {
        discountType: "NONE",
        discountValue: 0,
        taxType: "FIXED",
        taxValue: quoteIntColumnMax + 1
      }
    });
    const oversizedFixedAdjustmentBody = await readJson<ApiErrorBody>(oversizedFixedAdjustmentResponse);
    const maxProductResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      body: {
        name: "Max quote total product",
        unitPriceCents: productIntColumnMax,
        currency: "USD"
      }
    });
    const maxProduct = await readJson<{ id: string }>(maxProductResponse);
    const maxDealResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "Quote total overflow deal",
        valueCents: 0,
        currency: "USD"
      }
    });
    const maxDeal = await readJson<{ id: string }>(maxDealResponse);
    const maxLineItemResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", maxDeal.id, "line-items"],
      body: {
        productId: maxProduct.id,
        quantity: 1
      }
    });
    const maxQuoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", maxDeal.id, "quotes"]
    });
    const maxQuote = await readJson<{ id: string }>(maxQuoteResponse);
    const computedTotalOverflowResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", maxQuote.id, "adjustments"],
      body: {
        discountType: "NONE",
        discountValue: 0,
        taxType: "FIXED",
        taxValue: 1
      }
    });
    const computedTotalOverflowBody = await readJson<ApiErrorBody>(computedTotalOverflowResponse);
    const draftPublicLinkResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "public-link"]
    });
    const draftPublicLinkError = await readJson<ApiErrorBody>(draftPublicLinkResponse);
    const sentResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "mark-sent"]
    });
    const publicLinkResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "public-link"]
    });
    const publicLink = await readJson<{ id: string; token: string }>(publicLinkResponse);
    const repeatedPublicLinkResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "public-link"]
    });
    const repeatedPublicLink = await readJson<{ id: string; token: string }>(repeatedPublicLinkResponse);
    const declineResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "decline"]
    });
    const terminalPublicLinkResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "public-link"]
    });
    const terminalPublicLinkError = await readJson<ApiErrorBody>(terminalPublicLinkResponse);

    expect(productResponse.status).toBe(201);
    expect(lineItemResponse.status).toBe(201);
    expect(quoteResponse.status).toBe(201);
    expect(adjustmentResponse.status).toBe(200);
    expect(invalidAdjustmentResponse.status).toBe(422);
    expect(oversizedFixedAdjustmentResponse.status).toBe(422);
    expect(oversizedFixedAdjustmentBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "The request payload is invalid."
    });
    expect(JSON.stringify(oversizedFixedAdjustmentBody.error.details)).toContain("Tax value is too large.");
    expect(maxProductResponse.status).toBe(201);
    expect(maxDealResponse.status).toBe(201);
    expect(maxLineItemResponse.status).toBe(201);
    expect(maxQuoteResponse.status).toBe(201);
    expect(computedTotalOverflowResponse.status).toBe(422);
    expect(computedTotalOverflowBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Quote total is too large."
    });
    expect(draftPublicLinkResponse.status).toBe(422);
    expect(draftPublicLinkError.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Public quote links can only be generated while the quote is SENT."
    });
    expect(sentResponse.status).toBe(200);
    expect(publicLinkResponse.status).toBe(201);
    expect(repeatedPublicLinkResponse.status).toBe(201);
    expect(repeatedPublicLink).toMatchObject({ id: publicLink.id, token: publicLink.token });
    expect(declineResponse.status).toBe(200);
    expect(terminalPublicLinkResponse.status).toBe(422);
    expect(terminalPublicLinkError.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Public quote links can only be generated while the quote is SENT."
    });
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
    const otherWorkspaceADealResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "PDF route wrong deal",
        valueCents: 10000,
        currency: "USD"
      }
    });
    const otherWorkspaceADeal = await readJson<{ id: string }>(otherWorkspaceADealResponse);
    const sameWorkspaceWrongDealResponse = await invokeQuotePdfRoute({
      actorUserId: fx.userA.id,
      selectedWorkspaceId: fx.workspaceA.id,
      dealId: otherWorkspaceADeal.id,
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
    expect(sameWorkspaceWrongDealResponse.status).toBe(404);
    expect(crossWorkspaceResponse.status).toBe(404);
  });

  it("revokes public quote links through the authenticated workspace API", async () => {
    const fx = currentFixture();
    const productResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products"],
      body: {
        name: "API Public Link Revocation Package",
        unitPriceCents: 42000,
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
        quantity: 1
      }
    });
    const quoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "quotes"]
    });
    const quote = await readJson<{ id: string }>(quoteResponse);
    const sentResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "mark-sent"]
    });
    const publicLinkResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "public-link"]
    });
    const publicLink = await readJson<{ id: string; token: string }>(publicLinkResponse);
    const publicQuoteBeforeRevoke = await getPublicQuoteByToken(publicLink.token);
    const revokeResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "public-link"]
    });
    const revokeBody = await readJson<{ revoked: boolean }>(revokeResponse);
    const repeatRevokeResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", quote.id, "public-link"]
    });
    const repeatRevokeBody = await readJson<{ revoked: boolean }>(repeatRevokeResponse);
    const reloadedPublicLink = await fx.prisma.quotePublicLink.findUniqueOrThrow({
      where: { id: publicLink.id }
    });
    const activePublicLinkCount = await fx.prisma.quotePublicLink.count({
      where: {
        quoteId: quote.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    });
    const revocationAuditCount = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        entityType: "Quote",
        entityId: quote.id,
        action: "quote.public_link_revoked"
      }
    });

    expect(productResponse.status).toBe(201);
    expect(lineItemResponse.status).toBe(201);
    expect(quoteResponse.status).toBe(201);
    expect(sentResponse.status).toBe(200);
    expect(publicLinkResponse.status).toBe(201);
    expect(publicQuoteBeforeRevoke.id).toBe(quote.id);
    expect(revokeResponse.status).toBe(200);
    expect(revokeBody).toEqual({ revoked: true });
    expect(repeatRevokeResponse.status).toBe(200);
    expect(repeatRevokeBody).toEqual({ revoked: false });
    expect(reloadedPublicLink.revokedAt).toBeInstanceOf(Date);
    expect(activePublicLinkCount).toBe(0);
    expect(revocationAuditCount).toBe(1);
    await expect(getPublicQuoteByToken(publicLink.token)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
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

    const editConvertedResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads", createdLead.id],
      body: {
        title: "Edited after conversion"
      }
    });
    const editConvertedBody = await readJson<ApiErrorBody>(editConvertedResponse);

    expect(editConvertedResponse.status).toBe(409);
    expect(editConvertedBody.error.code).toBe("LEAD_LOCKED");
    await expect(fx.prisma.lead.findUniqueOrThrow({ where: { id: createdLead.id } })).resolves.toMatchObject({
      status: "CONVERTED",
      title: "API Created Lead"
    });

    const createConvertedLeadActivityResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities"],
      body: {
        ownerId: fx.userA.id,
        leadId: createdLead.id,
        type: "TASK",
        title: "Converted lead follow-up"
      }
    });
    const createConvertedLeadNoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes"],
      body: {
        leadId: createdLead.id,
        body: "Converted lead note"
      }
    });
    const createConvertedLeadEmailResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-logs"],
      body: {
        leadId: createdLead.id,
        direction: "INBOUND",
        occurredAt: "2030-03-06T10:00:00.000Z",
        subject: "Converted lead email",
        body: "Converted lead email body"
      }
    });
    const [
      createConvertedLeadActivityBody,
      createConvertedLeadNoteBody,
      createConvertedLeadEmailBody,
      convertedLeadActivityCount,
      convertedLeadNoteCount,
      convertedLeadEmailCount
    ] = await Promise.all([
      readJson<ApiErrorBody>(createConvertedLeadActivityResponse),
      readJson<ApiErrorBody>(createConvertedLeadNoteResponse),
      readJson<ApiErrorBody>(createConvertedLeadEmailResponse),
      fx.prisma.activity.count({ where: { workspaceId: fx.workspaceA.id, leadId: createdLead.id } }),
      fx.prisma.note.count({ where: { workspaceId: fx.workspaceA.id, leadId: createdLead.id } }),
      fx.prisma.emailLog.count({ where: { workspaceId: fx.workspaceA.id, leadId: createdLead.id } })
    ]);

    expect(createConvertedLeadActivityResponse.status).toBe(409);
    expect(createConvertedLeadActivityBody.error).toMatchObject({
      code: "LEAD_CONVERTED",
      message: "Create follow-up activities on the converted deal."
    });
    expect(createConvertedLeadNoteResponse.status).toBe(409);
    expect(createConvertedLeadNoteBody.error).toMatchObject({
      code: "LEAD_CONVERTED",
      message: "Add new context on the converted deal."
    });
    expect(createConvertedLeadEmailResponse.status).toBe(409);
    expect(createConvertedLeadEmailBody.error).toMatchObject({
      code: "LEAD_CONVERTED",
      message: "Log email context on the converted deal."
    });
    expect(convertedLeadActivityCount).toBe(0);
    expect(convertedLeadNoteCount).toBe(0);
    expect(convertedLeadEmailCount).toBe(0);
  });

  it("reattaches pre-existing lead context after conversion through the workspace API", async () => {
    const fx = currentFixture();

    const createLeadResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads"],
      body: {
        ownerId: fx.userA.id,
        title: "API lifecycle lead",
        status: "QUALIFIED"
      }
    });
    const lead = await readJson<{ id: string }>(createLeadResponse);
    const createActivityResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities"],
      body: {
        ownerId: fx.userA.id,
        leadId: lead.id,
        type: "TASK",
        title: "Lead follow-up before conversion",
        dueAt: "2030-03-08T09:00:00.000Z"
      }
    });
    const activity = await readJson<{ id: string }>(createActivityResponse);
    const createNoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes"],
      body: {
        leadId: lead.id,
        body: "Lead note before conversion"
      }
    });
    const note = await readJson<{ id: string }>(createNoteResponse);
    const createEmailResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-logs"],
      body: {
        leadId: lead.id,
        direction: "INBOUND",
        occurredAt: "2030-03-08T10:00:00.000Z",
        subject: "Lead email before conversion",
        body: "Lead email context before conversion"
      }
    });
    const emailLog = await readJson<{ id: string }>(createEmailResponse);

    const convertResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads", lead.id, "convert"],
      body: {
        pipelineId: fx.recordsA.pipeline.id,
        stageId: fx.recordsA.stageOne.id,
        title: "API lifecycle converted deal"
      }
    });
    const convertedDeal = await readJson<{ id: string }>(convertResponse);
    const [movedActivity, movedNote, movedEmailLog, convertedLead] = await Promise.all([
      fx.prisma.activity.findUniqueOrThrow({ where: { id: activity.id } }),
      fx.prisma.note.findUniqueOrThrow({ where: { id: note.id } }),
      fx.prisma.emailLog.findUniqueOrThrow({ where: { id: emailLog.id } }),
      fx.prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })
    ]);

    expect(createLeadResponse.status).toBe(201);
    expect(createActivityResponse.status).toBe(201);
    expect(createNoteResponse.status).toBe(201);
    expect(createEmailResponse.status).toBe(201);
    expect(convertResponse.status).toBe(201);
    expect(convertedLead.status).toBe("CONVERTED");
    expect(movedActivity).toMatchObject({
      dealId: convertedDeal.id,
      deletedAt: null,
      dueAt: new Date("2030-03-08T09:00:00.000Z"),
      leadId: null,
      title: "Lead follow-up before conversion"
    });
    expect(movedNote).toMatchObject({
      body: "Lead note before conversion",
      dealId: convertedDeal.id,
      deletedAt: null
    });
    expect(movedNote.leadId).toBeNull();
    expect(movedEmailLog).toMatchObject({
      body: "Lead email context before conversion",
      dealId: convertedDeal.id,
      leadId: null,
      subject: "Lead email before conversion"
    });
  });

  it("rejects lead, contact, and organization relation writes across workspace boundaries through the workspace API", async () => {
    const fx = currentFixture();
    const deletedOwner = await fx.prisma.user.create({
      data: {
        email: `api-deleted-owner-${Date.now()}@example.test`,
        name: "API Deleted Owner",
        deletedAt: new Date("2030-01-01T00:00:00.000Z")
      }
    });
    await fx.prisma.workspaceMembership.create({
      data: {
        workspaceId: fx.workspaceA.id,
        userId: deletedOwner.id,
        role: "MEMBER"
      }
    });

    const invalidLeadOwnerResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads"],
      body: {
        ownerId: fx.userB.id,
        title: "API invalid owner lead"
      }
    });
    const invalidLeadDeletedOwnerResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads"],
      body: {
        ownerId: deletedOwner.id,
        title: "API invalid deleted owner lead"
      }
    });
    const invalidLeadPersonResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads"],
      body: {
        personId: fx.recordsB.person.id,
        title: "API invalid contact lead"
      }
    });
    const invalidLeadOrganizationResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["leads", fx.recordsA.lead.id],
      body: {
        organizationId: fx.recordsB.organization.id
      }
    });
    const invalidPersonOrganizationResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["people"],
      body: {
        firstName: "API Invalid",
        lastName: "Contact",
        email: "api-invalid-contact-relation@example.test",
        organizationId: fx.recordsB.organization.id
      }
    });
    const invalidPersonOwnerResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["people", fx.recordsA.person.id],
      body: {
        ownerId: fx.userB.id
      }
    });
    const invalidOrganizationOwnerCreateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["organizations"],
      body: {
        name: "API invalid owner organization",
        ownerId: fx.userB.id
      }
    });
    const invalidOrganizationDeletedOwnerCreateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["organizations"],
      body: {
        name: "API invalid deleted owner organization",
        ownerId: deletedOwner.id
      }
    });
    const invalidOrganizationOwnerUpdateResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["organizations", fx.recordsA.organization.id],
      body: {
        ownerId: fx.userB.id
      }
    });
    const errorBodies = await Promise.all([
      readJson<ApiErrorBody>(invalidLeadOwnerResponse),
      readJson<ApiErrorBody>(invalidLeadDeletedOwnerResponse),
      readJson<ApiErrorBody>(invalidLeadPersonResponse),
      readJson<ApiErrorBody>(invalidLeadOrganizationResponse),
      readJson<ApiErrorBody>(invalidPersonOrganizationResponse),
      readJson<ApiErrorBody>(invalidPersonOwnerResponse),
      readJson<ApiErrorBody>(invalidOrganizationOwnerCreateResponse),
      readJson<ApiErrorBody>(invalidOrganizationDeletedOwnerCreateResponse),
      readJson<ApiErrorBody>(invalidOrganizationOwnerUpdateResponse)
    ]);

    expect([
      invalidLeadOwnerResponse.status,
      invalidLeadDeletedOwnerResponse.status,
      invalidLeadPersonResponse.status,
      invalidLeadOrganizationResponse.status,
      invalidPersonOrganizationResponse.status,
      invalidPersonOwnerResponse.status,
      invalidOrganizationOwnerCreateResponse.status,
      invalidOrganizationDeletedOwnerCreateResponse.status,
      invalidOrganizationOwnerUpdateResponse.status
    ]).toEqual([404, 404, 404, 404, 404, 404, 404, 404, 404]);
    for (const body of errorBodies) {
      expect(body.error.code).toBe("NOT_FOUND");
    }
    expect(errorBodies.map((body) => body.error.message)).toEqual(
      expect.arrayContaining([
        "User was not found in this workspace.",
        "Record was not found in this workspace."
      ])
    );
    await expect(
      fx.prisma.lead.count({
        where: {
          workspaceId: fx.workspaceA.id,
          title: { in: ["API invalid owner lead", "API invalid deleted owner lead", "API invalid contact lead"] }
        }
      })
    ).resolves.toBe(0);
    await expect(
      fx.prisma.person.count({
        where: { workspaceId: fx.workspaceA.id, email: "api-invalid-contact-relation@example.test" }
      })
    ).resolves.toBe(0);
    await expect(
      fx.prisma.organization.count({
        where: {
          workspaceId: fx.workspaceA.id,
          name: { in: ["API invalid owner organization", "API invalid deleted owner organization"] }
        }
      })
    ).resolves.toBe(0);
    await expect(fx.prisma.lead.findUniqueOrThrow({ where: { id: fx.recordsA.lead.id } })).resolves.toMatchObject({
      organizationId: fx.recordsA.organization.id
    });
    await expect(fx.prisma.person.findUniqueOrThrow({ where: { id: fx.recordsA.person.id } })).resolves.toMatchObject({
      ownerId: fx.userA.id
    });
    await expect(
      fx.prisma.organization.findUniqueOrThrow({ where: { id: fx.recordsA.organization.id } })
    ).resolves.toMatchObject({
      ownerId: fx.userA.id
    });
    await fx.prisma.lead.deleteMany({ where: { workspaceId: fx.workspaceA.id, ownerId: deletedOwner.id } });
    await fx.prisma.organization.deleteMany({ where: { workspaceId: fx.workspaceA.id, ownerId: deletedOwner.id } });
    await fx.prisma.workspaceMembership.deleteMany({ where: { userId: deletedOwner.id } });
    await fx.prisma.user.deleteMany({ where: { id: deletedOwner.id } });
  });

  it("creates and completes an activity and creates a note through the workspace API", async () => {
    const fx = currentFixture();
    const dueAt = "2030-03-03T09:00:00.000Z";
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
        dueAt
      }
    });
    const activity = await readJson<{ id: string; dealId: string; title: string; completedAt: string | null; dueAt: string | null }>(
      createActivityResponse
    );

    const orphanActivityResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities"],
      body: {
        ownerId: fx.userA.id,
        type: "TASK",
        title: "API orphan follow-up"
      }
    });
    const orphanActivityBody = await readJson<ApiErrorBody>(orphanActivityResponse);

    expect(createActivityResponse.status).toBe(201);
    expect(activity.dealId).toBe(fx.recordsA.deal.id);
    expect(activity.title).toBe("API Follow-up");
    expect(activity.dueAt).toBe(dueAt);
    expect(activity.completedAt).toBeNull();
    expect(orphanActivityResponse.status).toBe(422);
    expect(orphanActivityBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Attach the activity to a CRM record."
    });
    await expect(
      fx.prisma.activity.count({
        where: {
          workspaceId: fx.workspaceA.id,
          title: "API orphan follow-up"
        }
      })
    ).resolves.toBe(0);

    const renameActivityResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", activity.id],
      body: { title: "API Follow-up renamed" }
    });
    const renamedActivity = await readJson<{ id: string; title: string; dueAt: string | null }>(renameActivityResponse);

    expect(renameActivityResponse.status).toBe(200);
    expect(renamedActivity.title).toBe("API Follow-up renamed");
    expect(renamedActivity.dueAt).toBe(dueAt);
    await expect(fx.prisma.activity.findUnique({ where: { id: activity.id } })).resolves.toMatchObject({
      dueAt: new Date(dueAt),
      title: "API Follow-up renamed"
    });

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

    const editCompletedActivityResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", activity.id],
      body: {
        title: "Edited completed activity",
        dueAt: "2030-03-05T09:00:00.000Z"
      }
    });
    const editCompletedActivityBody = await readJson<ApiErrorBody>(editCompletedActivityResponse);
    const deleteCompletedActivityResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", activity.id]
    });
    const deleteCompletedActivityBody = await readJson<ApiErrorBody>(deleteCompletedActivityResponse);

    expect(editCompletedActivityResponse.status).toBe(409);
    expect(editCompletedActivityBody.error.code).toBe("ACTIVITY_COMPLETED");
    expect(deleteCompletedActivityResponse.status).toBe(409);
    expect(deleteCompletedActivityBody.error).toMatchObject({
      code: "ACTIVITY_COMPLETED",
      message: "Completed activities cannot be removed."
    });
    await expect(fx.prisma.activity.findUnique({ where: { id: activity.id } })).resolves.toMatchObject({
      completedAt: new Date(completedAt),
      deletedAt: null,
      dueAt: new Date(dueAt),
      title: "API Follow-up renamed"
    });

    const orphanNoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes"],
      body: {
        body: "API orphan note"
      }
    });
    const orphanNoteBody = await readJson<ApiErrorBody>(orphanNoteResponse);

    expect(orphanNoteResponse.status).toBe(422);
    expect(orphanNoteBody.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Attach the note to a CRM record."
    });
    await expect(
      fx.prisma.note.count({
        where: {
          workspaceId: fx.workspaceA.id,
          body: "API orphan note"
        }
      })
    ).resolves.toBe(0);

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

  it("rejects stale converted-lead activity mutations through the workspace API", async () => {
    const fx = currentFixture();
    const convertedLead = await fx.prisma.lead.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        title: "API stale converted activity lead",
        status: "CONVERTED"
      }
    });
    const staleActivity = await fx.prisma.activity.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        leadId: convertedLead.id,
        type: "TASK",
        title: "Stale converted lead activity",
        dueAt: new Date("2030-03-07T09:00:00.000Z")
      }
    });

    const editResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", staleActivity.id],
      body: { title: "Mutated stale converted lead activity" }
    });
    const completeResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", staleActivity.id],
      body: { completedAt: "2030-03-07T10:00:00.000Z" }
    });
    const deleteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", staleActivity.id]
    });
    const [editBody, completeBody, deleteBody, persistedActivity, auditCount] = await Promise.all([
      readJson<ApiErrorBody>(editResponse),
      readJson<ApiErrorBody>(completeResponse),
      readJson<ApiErrorBody>(deleteResponse),
      fx.prisma.activity.findUniqueOrThrow({ where: { id: staleActivity.id } }),
      fx.prisma.auditLog.count({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "Activity",
          entityId: staleActivity.id,
          action: { in: ["activity.updated", "activity.completed", "activity.deleted"] }
        }
      })
    ]);

    expect(editResponse.status).toBe(409);
    expect(completeResponse.status).toBe(409);
    expect(deleteResponse.status).toBe(409);
    expect(editBody.error).toMatchObject({
      code: "LEAD_CONVERTED",
      message: "Update follow-up activities on the converted deal."
    });
    expect(completeBody.error.code).toBe("LEAD_CONVERTED");
    expect(deleteBody.error.code).toBe("LEAD_CONVERTED");
    expect(persistedActivity).toMatchObject({
      completedAt: null,
      deletedAt: null,
      title: "Stale converted lead activity"
    });
    expect(auditCount).toBe(0);
  });

  it("rejects locked-parent note deletion through the workspace API", async () => {
    const fx = currentFixture();
    const closedDealNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        body: "Closed deal stale note"
      }
    });
    const convertedLead = await fx.prisma.lead.create({
      data: {
        workspaceId: fx.workspaceA.id,
        ownerId: fx.userA.id,
        title: "API stale converted note lead",
        status: "CONVERTED"
      }
    });
    const convertedLeadNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        leadId: convertedLead.id,
        body: "Converted lead stale note"
      }
    });
    await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "close"],
      body: { status: "WON" }
    });

    const deleteClosedDealNoteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes", closedDealNote.id]
    });
    const deleteConvertedLeadNoteResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes", convertedLeadNote.id]
    });
    const [deleteClosedDealNoteBody, deleteConvertedLeadNoteBody, persistedClosedDealNote, persistedConvertedLeadNote, auditCount] =
      await Promise.all([
        readJson<ApiErrorBody>(deleteClosedDealNoteResponse),
        readJson<ApiErrorBody>(deleteConvertedLeadNoteResponse),
        fx.prisma.note.findUniqueOrThrow({ where: { id: closedDealNote.id } }),
        fx.prisma.note.findUniqueOrThrow({ where: { id: convertedLeadNote.id } }),
        fx.prisma.auditLog.count({
          where: {
            workspaceId: fx.workspaceA.id,
            entityType: "Note",
            entityId: { in: [closedDealNote.id, convertedLeadNote.id] },
            action: "note.deleted"
          }
        })
      ]);

    expect(deleteClosedDealNoteResponse.status).toBe(409);
    expect(deleteClosedDealNoteBody.error).toMatchObject({
      code: "DEAL_CLOSED",
      message: "Closed deals cannot be edited."
    });
    expect(deleteConvertedLeadNoteResponse.status).toBe(409);
    expect(deleteConvertedLeadNoteBody.error).toMatchObject({
      code: "LEAD_CONVERTED",
      message: "Converted lead notes cannot be removed. Update the converted deal instead."
    });
    expect(persistedClosedDealNote).toMatchObject({
      body: "Closed deal stale note",
      deletedAt: null
    });
    expect(persistedConvertedLeadNote).toMatchObject({
      body: "Converted lead stale note",
      deletedAt: null
    });
    expect(auditCount).toBe(0);
  });

  it("keeps the workspace email-log API bounded by the default list limit", async () => {
    const fx = currentFixture();
    const emailLogCount = 30;

    await fx.prisma.emailLog.createMany({
      data: Array.from({ length: emailLogCount }, (_, index) => ({
        workspaceId: fx.workspaceA.id,
        createdById: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: new Date(Date.UTC(2030, 3, index + 1, 12, 0, 0)),
        subject: `Bounded API email ${index.toString().padStart(2, "0")}`,
        body: `Email body ${index}`
      }))
    });

    const response = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-logs"]
    });
    const emailLogs = await readJson<Array<{ subject: string }>>(response);

    expect(response.status).toBe(200);
    expect(emailLogs).toHaveLength(25);
    expect(emailLogs[0]?.subject).toBe("Bounded API email 29");
    expect(emailLogs.map((emailLog) => emailLog.subject)).not.toContain("Bounded API email 00");
    expect(emailLogs.map((emailLog) => emailLog.subject)).not.toContain("Beta private email");
  });

  it("blocks manual email logging on closed deals through the workspace API", async () => {
    const fx = currentFixture();
    const blockedSubject = "Closed deal API email should not persist";

    const closeResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "close"],
      body: { status: "WON" }
    });
    const createEmailLogResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-logs"],
      body: {
        dealId: fx.recordsA.deal.id,
        direction: "OUTBOUND",
        occurredAt: "2030-04-15T12:00:00.000Z",
        subject: blockedSubject,
        body: "Closed deal email log should be rejected."
      }
    });
    const createEmailLogBody = await readJson<ApiErrorBody>(createEmailLogResponse);
    const blockedEmailLogCount = await fx.prisma.emailLog.count({
      where: { workspaceId: fx.workspaceA.id, subject: blockedSubject }
    });

    expect(closeResponse.status).toBe(200);
    expect(createEmailLogResponse.status).toBe(409);
    expect(createEmailLogBody.error).toMatchObject({
      code: "DEAL_CLOSED",
      message: "Closed deals cannot be edited."
    });
    expect(blockedEmailLogCount).toBe(0);
  });

  it("rejects manual email logs attached to deleted CRM records through the workspace API", async () => {
    const fx = currentFixture();
    const deletedAt = new Date("2030-04-16T12:00:00.000Z");
    const deletedAttachmentChecks = [
      {
        field: "dealId",
        id: fx.recordsA.deal.id,
        subject: "Deleted deal API email should not persist"
      },
      {
        field: "leadId",
        id: fx.recordsA.lead.id,
        subject: "Deleted lead API email should not persist"
      },
      {
        field: "personId",
        id: fx.recordsA.person.id,
        subject: "Deleted contact API email should not persist"
      },
      {
        field: "organizationId",
        id: fx.recordsA.organization.id,
        subject: "Deleted organization API email should not persist"
      }
    ] as const;

    await Promise.all([
      fx.prisma.deal.update({ where: { id: fx.recordsA.deal.id }, data: { deletedAt } }),
      fx.prisma.lead.update({ where: { id: fx.recordsA.lead.id }, data: { deletedAt } }),
      fx.prisma.person.update({ where: { id: fx.recordsA.person.id }, data: { deletedAt } }),
      fx.prisma.organization.update({ where: { id: fx.recordsA.organization.id }, data: { deletedAt } })
    ]);

    const responses = await Promise.all(
      deletedAttachmentChecks.map((check) =>
        invokeWorkspaceApi({
          method: "POST",
          workspaceId: fx.workspaceA.id,
          actorUserId: fx.userA.id,
          segments: ["email-logs"],
          body: {
            [check.field]: check.id,
            direction: "OUTBOUND",
            occurredAt: "2030-04-16T13:00:00.000Z",
            subject: check.subject,
            body: "Deleted record email log should be rejected."
          }
        })
      )
    );
    const bodies = await Promise.all(responses.map((response) => readJson<ApiErrorBody>(response)));
    const blockedEmailLogCount = await fx.prisma.emailLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        subject: { in: deletedAttachmentChecks.map((check) => check.subject) }
      }
    });

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
    expect(bodies.map((body) => body.error)).toEqual([
      expect.objectContaining({ code: "NOT_FOUND", message: "Record was not found in this workspace." }),
      expect.objectContaining({ code: "NOT_FOUND", message: "Record was not found in this workspace." }),
      expect.objectContaining({ code: "NOT_FOUND", message: "Record was not found in this workspace." }),
      expect.objectContaining({ code: "NOT_FOUND", message: "Record was not found in this workspace." })
    ]);
    expect(blockedEmailLogCount).toBe(0);
  });

  it("accepts partial email template updates through the workspace API", async () => {
    const fx = currentFixture();

    const createResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates"],
      body: {
        name: "API partial template",
        subject: "Original API subject",
        body: "Original API body."
      }
    });
    const template = await readJson<{ id: string }>(createResponse);
    const patchResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates", template.id],
      body: {
        subject: "Patched API subject"
      }
    });
    const patchedTemplate = await readJson<{ name: string; subject: string; body: string }>(patchResponse);
    const noopPatchResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates", template.id],
      body: {}
    });
    const noopTemplate = await readJson<{ name: string; subject: string; body: string }>(noopPatchResponse);
    const updateAuditCount = await fx.prisma.auditLog.count({
      where: {
        workspaceId: fx.workspaceA.id,
        action: "email_template.updated",
        entityType: "EmailTemplate",
        entityId: template.id
      }
    });

    expect(createResponse.status).toBe(201);
    expect(patchResponse.status).toBe(200);
    expect(patchedTemplate).toMatchObject({
      name: "API partial template",
      subject: "Patched API subject",
      body: "Original API body."
    });
    expect(noopPatchResponse.status).toBe(200);
    expect(noopTemplate).toMatchObject({
      name: "API partial template",
      subject: "Patched API subject",
      body: "Original API body."
    });
    expect(updateAuditCount).toBe(1);
  });

  it("toggles email template activity through the workspace API without crossing workspaces", async () => {
    const fx = currentFixture();
    const template = await fx.prisma.emailTemplate.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Route toggle template",
        subject: "Route toggle subject",
        body: "Route toggle body.",
        active: true
      }
    });
    const otherWorkspaceTemplate = await fx.prisma.emailTemplate.create({
      data: {
        workspaceId: fx.workspaceB.id,
        name: "Other workspace route template",
        subject: "Other route subject",
        body: "Other route body.",
        active: true
      }
    });

    const deactivateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates", template.id, "deactivate"]
    });
    const deactivatedTemplate = await readJson<{ id: string; active: boolean }>(deactivateResponse);
    const crossWorkspaceDeactivateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates", otherWorkspaceTemplate.id, "deactivate"]
    });
    const crossWorkspaceDeactivateBody = await readJson<ApiErrorBody>(crossWorkspaceDeactivateResponse);
    const activateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates", template.id, "activate"]
    });
    const activatedTemplate = await readJson<{ id: string; active: boolean }>(activateResponse);

    expect(deactivateResponse.status).toBe(200);
    expect(deactivatedTemplate).toMatchObject({ id: template.id, active: false });
    expect(crossWorkspaceDeactivateResponse.status).toBe(404);
    expect(crossWorkspaceDeactivateBody.error.code).toBe("NOT_FOUND");
    expect(activateResponse.status).toBe(200);
    expect(activatedTemplate).toMatchObject({ id: template.id, active: true });
    await expect(fx.prisma.emailTemplate.findUniqueOrThrow({ where: { id: template.id } })).resolves.toMatchObject({
      active: true
    });
    await expect(
      fx.prisma.emailTemplate.findUniqueOrThrow({ where: { id: otherWorkspaceTemplate.id } })
    ).resolves.toMatchObject({
      active: true
    });
    await expect(
      fx.prisma.auditLog.findMany({
        where: {
          workspaceId: fx.workspaceA.id,
          entityType: "EmailTemplate",
          entityId: template.id
        },
        orderBy: { createdAt: "asc" }
      })
    ).resolves.toEqual([
      expect.objectContaining({ action: "email_template.deactivated" }),
      expect.objectContaining({ action: "email_template.reactivated" })
    ]);
  });

  it("excludes notes attached to deleted parent records from the workspace notes API", async () => {
    const fx = currentFixture();
    const deletedParentNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        dealId: fx.recordsA.deal.id,
        body: "Note attached to deleted deal"
      }
    });
    const visibleNote = await fx.prisma.note.create({
      data: {
        workspaceId: fx.workspaceA.id,
        authorId: fx.userA.id,
        organizationId: fx.recordsA.organization.id,
        body: "Visible organization note"
      }
    });
    await fx.prisma.deal.update({
      where: { id: fx.recordsA.deal.id },
      data: { deletedAt: new Date("2030-03-07T12:00:00.000Z") }
    });

    const response = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["notes"]
    });
    const notes = await readJson<Array<{ id: string; body: string }>>(response);

    expect(response.status).toBe(200);
    expect(notes.map((note) => note.id)).toContain(visibleNote.id);
    expect(notes.map((note) => note.id)).not.toContain(deletedParentNote.id);
    expect(notes.map((note) => note.body)).not.toContain("Note attached to deleted deal");
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

  it("returns not-found for unsupported nested workspace resource paths", async () => {
    const fx = currentFixture();
    const stageCountBefore = await fx.prisma.pipelineStage.count({
      where: { pipelineId: fx.recordsA.pipeline.id }
    });
    const product = await fx.prisma.product.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Malformed route product",
        unitPriceCents: 2500,
        currency: "USD"
      }
    });
    const routeLineItem = await fx.prisma.dealLineItem.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: fx.recordsA.deal.id,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPriceCents: product.unitPriceCents,
        lineTotalCents: product.unitPriceCents,
        currency: product.currency
      }
    });
    const draftQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: fx.recordsA.deal.id,
        number: `MALFORMED-DRAFT-${Date.now()}`,
        status: "DRAFT",
        currency: "USD",
        subtotalCents: routeLineItem.lineTotalCents,
        totalCents: routeLineItem.lineTotalCents
      }
    });
    const sentQuote = await fx.prisma.quote.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: fx.recordsA.deal.id,
        number: `MALFORMED-SENT-${Date.now()}`,
        status: "SENT",
        currency: "USD",
        subtotalCents: routeLineItem.lineTotalCents,
        totalCents: routeLineItem.lineTotalCents
      }
    });
    const contractStep = await fx.prisma.dealContractStep.create({
      data: {
        workspaceId: fx.workspaceA.id,
        dealId: fx.recordsA.deal.id,
        type: "NDA",
        status: "IN_PROGRESS",
        notes: "Should remain unchanged."
      }
    });
    const activeTemplate = await fx.prisma.emailTemplate.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Malformed route active template",
        subject: "Active template",
        body: "Should remain active.",
        active: true
      }
    });
    const inactiveTemplate = await fx.prisma.emailTemplate.create({
      data: {
        workspaceId: fx.workspaceA.id,
        name: "Malformed route inactive template",
        subject: "Inactive template",
        body: "Should remain inactive.",
        active: false
      }
    });
    const customField = await fx.prisma.customFieldDefinition.create({
      data: {
        workspaceId: fx.workspaceA.id,
        entityType: "DEAL",
        name: "Malformed route field",
        key: `malformed_route_field_${Date.now()}`,
        fieldType: "TEXT"
      }
    });
    const publicLink = await fx.prisma.quotePublicLink.create({
      data: {
        workspaceId: fx.workspaceA.id,
        quoteId: sentQuote.id,
        token: `malformed-route-token-${Date.now()}`
      }
    });
    const lineItemCountBefore = await fx.prisma.dealLineItem.count({ where: { dealId: fx.recordsA.deal.id } });
    const contractStepCountBefore = await fx.prisma.dealContractStep.count({ where: { dealId: fx.recordsA.deal.id } });
    const sentQuotePublicLinkCountBefore = await fx.prisma.quotePublicLink.count({ where: { quoteId: sentQuote.id } });
    const customFieldValueCountBefore = await fx.prisma.customFieldValue.count({
      where: { fieldId: customField.id, entityId: fx.recordsA.deal.id }
    });

    const createStageResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["pipelines", fx.recordsA.pipeline.id, "stages", "unexpected"],
      body: {
        name: "Unexpected nested stage create"
      }
    });
    const stageResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["stages", fx.recordsA.stageOne.id, "unexpected"],
      body: {
        name: "Unexpected nested stage edit"
      }
    });
    const closeDealResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "close", "unexpected"],
      body: {
        status: "WON"
      }
    });
    const createLineItemResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "line-items", "unexpected"],
      body: {
        productId: product.id,
        quantity: 3
      }
    });
    const deleteLineItemResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deal-line-items", routeLineItem.id, "unexpected"]
    });
    const createContractStepResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["deals", fx.recordsA.deal.id, "contracts", "unexpected"],
      body: {
        type: "MSA",
        status: "SENT"
      }
    });
    const updateContractStepResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["contract-steps", contractStep.id, "unexpected"],
      body: {
        status: "SIGNED",
        notes: "Unexpected nested contract edit"
      }
    });
    const deactivateProductResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["products", product.id, "deactivate", "unexpected"]
    });
    const markSentQuoteResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", draftQuote.id, "mark-sent", "unexpected"]
    });
    const adjustQuoteResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", draftQuote.id, "adjustments", "unexpected"],
      body: {
        discountType: "FIXED",
        discountValue: 100,
        taxType: "NONE",
        taxValue: 0
      }
    });
    const syncDealValueResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", sentQuote.id, "sync-deal-value", "unexpected"]
    });
    const publicLinkResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", sentQuote.id, "public-link", "unexpected"]
    });
    const revokePublicLinkResponse = await invokeWorkspaceApi({
      method: "DELETE",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["quotes", sentQuote.id, "public-link", "unexpected"]
    });
    const deactivateTemplateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates", activeTemplate.id, "deactivate", "unexpected"]
    });
    const activateTemplateResponse = await invokeWorkspaceApi({
      method: "POST",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["email-templates", inactiveTemplate.id, "activate", "unexpected"]
    });
    const personResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["people", fx.recordsA.person.id, "unexpected"]
    });
    const organizationResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["organizations", fx.recordsA.organization.id, "unexpected"],
      body: {
        name: "Unexpected nested organization edit"
      }
    });
    const activityResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["activities", fx.recordsA.activity.id, "unexpected"],
      body: {
        title: "Unexpected nested activity edit"
      }
    });
    const customFieldValuesResponse = await invokeWorkspaceApi({
      method: "PATCH",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["custom-field-values", "unexpected"],
      body: {
        entityType: "DEAL",
        entityId: fx.recordsA.deal.id,
        values: { [customField.id]: "Unexpected custom value" }
      }
    });
    const bodies = await Promise.all([
      readJson<ApiErrorBody>(createStageResponse),
      readJson<ApiErrorBody>(stageResponse),
      readJson<ApiErrorBody>(closeDealResponse),
      readJson<ApiErrorBody>(createLineItemResponse),
      readJson<ApiErrorBody>(deleteLineItemResponse),
      readJson<ApiErrorBody>(createContractStepResponse),
      readJson<ApiErrorBody>(updateContractStepResponse),
      readJson<ApiErrorBody>(deactivateProductResponse),
      readJson<ApiErrorBody>(markSentQuoteResponse),
      readJson<ApiErrorBody>(adjustQuoteResponse),
      readJson<ApiErrorBody>(syncDealValueResponse),
      readJson<ApiErrorBody>(publicLinkResponse),
      readJson<ApiErrorBody>(revokePublicLinkResponse),
      readJson<ApiErrorBody>(deactivateTemplateResponse),
      readJson<ApiErrorBody>(activateTemplateResponse),
      readJson<ApiErrorBody>(personResponse),
      readJson<ApiErrorBody>(organizationResponse),
      readJson<ApiErrorBody>(activityResponse),
      readJson<ApiErrorBody>(customFieldValuesResponse)
    ]);

    expect([
      createStageResponse.status,
      stageResponse.status,
      closeDealResponse.status,
      createLineItemResponse.status,
      deleteLineItemResponse.status,
      createContractStepResponse.status,
      updateContractStepResponse.status,
      deactivateProductResponse.status,
      markSentQuoteResponse.status,
      adjustQuoteResponse.status,
      syncDealValueResponse.status,
      publicLinkResponse.status,
      revokePublicLinkResponse.status,
      deactivateTemplateResponse.status,
      activateTemplateResponse.status,
      personResponse.status,
      organizationResponse.status,
      activityResponse.status,
      customFieldValuesResponse.status
    ]).toEqual([
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404,
      404
    ]);
    for (const responseBody of bodies) {
      expect(responseBody).toEqual({
        error: {
          code: "NOT_FOUND",
          message: "Route was not found."
        }
      });
    }
    await expect(fx.prisma.pipelineStage.findUniqueOrThrow({ where: { id: fx.recordsA.stageOne.id } })).resolves.toMatchObject({
      name: fx.recordsA.stageOne.name
    });
    await expect(fx.prisma.pipelineStage.count({ where: { pipelineId: fx.recordsA.pipeline.id } })).resolves.toBe(stageCountBefore);
    await expect(fx.prisma.deal.findUniqueOrThrow({ where: { id: fx.recordsA.deal.id } })).resolves.toMatchObject({
      status: "OPEN",
      valueCents: fx.recordsA.deal.valueCents
    });
    await expect(fx.prisma.dealLineItem.findUniqueOrThrow({ where: { id: routeLineItem.id } })).resolves.toMatchObject({
      quantity: 1
    });
    await expect(fx.prisma.dealLineItem.count({ where: { dealId: fx.recordsA.deal.id } })).resolves.toBe(
      lineItemCountBefore
    );
    await expect(fx.prisma.dealContractStep.findUniqueOrThrow({ where: { id: contractStep.id } })).resolves.toMatchObject({
      status: "IN_PROGRESS",
      notes: "Should remain unchanged."
    });
    await expect(fx.prisma.dealContractStep.count({ where: { dealId: fx.recordsA.deal.id } })).resolves.toBe(
      contractStepCountBefore
    );
    await expect(fx.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).resolves.toMatchObject({
      active: true
    });
    await expect(fx.prisma.quote.findUniqueOrThrow({ where: { id: draftQuote.id } })).resolves.toMatchObject({
      status: "DRAFT",
      discountValue: 0,
      taxValue: 0
    });
    await expect(fx.prisma.quotePublicLink.count({ where: { quoteId: sentQuote.id } })).resolves.toBe(
      sentQuotePublicLinkCountBefore
    );
    await expect(fx.prisma.quotePublicLink.findUniqueOrThrow({ where: { id: publicLink.id } })).resolves.toMatchObject({
      revokedAt: null
    });
    await expect(fx.prisma.emailTemplate.findUniqueOrThrow({ where: { id: activeTemplate.id } })).resolves.toMatchObject({
      active: true
    });
    await expect(fx.prisma.emailTemplate.findUniqueOrThrow({ where: { id: inactiveTemplate.id } })).resolves.toMatchObject({
      active: false
    });
    await expect(fx.prisma.organization.findUniqueOrThrow({ where: { id: fx.recordsA.organization.id } })).resolves.toMatchObject({
      name: fx.recordsA.organization.name
    });
    await expect(fx.prisma.activity.findUniqueOrThrow({ where: { id: fx.recordsA.activity.id } })).resolves.toMatchObject({
      title: fx.recordsA.activity.title
    });
    await expect(
      fx.prisma.customFieldValue.count({ where: { fieldId: customField.id, entityId: fx.recordsA.deal.id } })
    ).resolves.toBe(customFieldValueCountBefore);
  });

  it("returns recent workspace-only audit logs through the workspace API", async () => {
    const fx = currentFixture();
    await fx.prisma.auditLog.deleteMany({
      where: { workspaceId: { in: [fx.workspaceA.id, fx.workspaceB.id] } }
    });
    const oldWorkspaceAEvents = await Promise.all(
      Array.from({ length: 105 }, (_unused, index) =>
        fx.prisma.auditLog.create({
          data: {
            workspaceId: fx.workspaceA.id,
            actorId: fx.userA.id,
            action: `audit.route.old_${index}`,
            entityType: "Deal",
            entityId: fx.recordsA.deal.id,
            createdAt: new Date(Date.UTC(2030, 0, 1, 0, index, 0))
          }
        })
      )
    );
    const recentWorkspaceAEvent = await fx.prisma.auditLog.create({
      data: {
        workspaceId: fx.workspaceA.id,
        actorId: fx.userA.id,
        action: "audit.route.recent",
        entityType: "Deal",
        entityId: fx.recordsA.deal.id,
        createdAt: new Date("2030-01-02T00:00:00.000Z")
      }
    });
    const workspaceBEvent = await fx.prisma.auditLog.create({
      data: {
        workspaceId: fx.workspaceB.id,
        actorId: fx.userB.id,
        action: "audit.route.other_workspace",
        entityType: "Deal",
        entityId: fx.recordsB.deal.id,
        createdAt: new Date("2030-01-03T00:00:00.000Z")
      }
    });

    const response = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["audit-logs"]
    });
    const events = await readJson<Array<{ id: string; action: string; actor: { email: string } }>>(response);

    expect(response.status).toBe(200);
    expect(events).toHaveLength(100);
    expect(events[0]).toMatchObject({
      id: recentWorkspaceAEvent.id,
      action: "audit.route.recent",
      actor: { email: fx.userA.email }
    });
    expect(events.map((event) => event.id)).not.toContain(workspaceBEvent.id);
    expect(events.map((event) => event.id)).not.toContain(oldWorkspaceAEvents[0]?.id);
    expect(events.map((event) => event.action)).not.toContain("audit.route.other_workspace");

    const nonMemberResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceB.id,
      actorUserId: fx.userA.id,
      segments: ["audit-logs"]
    });
    const nonMemberBody = await readJson<ApiErrorBody>(nonMemberResponse);

    expect(nonMemberResponse.status).toBe(403);
    expect(nonMemberBody.error.code).toBe("FORBIDDEN");
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
      }),
      fx.prisma.deal.create({
        data: {
          workspaceId: fx.workspaceA.id,
          pipelineId: fx.recordsA.pipeline.id,
          stageId: fx.recordsA.stageOne.id,
          title: "Alpha Paginated Export Deal",
          valueCents: 125000,
          currency: "USD"
        }
      }),
      fx.prisma.deal.create({
        data: {
          workspaceId: fx.workspaceA.id,
          pipelineId: fx.recordsA.pipeline.id,
          stageId: fx.recordsA.stageOne.id,
          title: "Gamma Filtered Export Deal",
          valueCents: 250000,
          currency: "USD"
        }
      }),
      fx.prisma.product.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "Alpha Export Product",
          description: "Visible product export row",
          unitPriceCents: 12345,
          currency: "USD"
        }
      }),
      fx.prisma.product.create({
        data: {
          workspaceId: fx.workspaceA.id,
          name: "=API Export Formula Product",
          description: "+spreadsheet formula should export as text",
          unitPriceCents: 11111,
          currency: "USD"
        }
      }),
      fx.prisma.product.create({
        data: {
          workspaceId: fx.workspaceB.id,
          name: "Beta private product",
          description: "Hidden product export row",
          unitPriceCents: 54321,
          currency: "USD"
        }
      }),
      fx.prisma.quote.create({
        data: {
          workspaceId: fx.workspaceA.id,
          dealId: fx.recordsA.deal.id,
          number: "Q-API-EXPORT-A",
          status: "SENT",
          currency: "USD",
          subtotalCents: 12345,
          totalCents: 12345
        }
      }),
      fx.prisma.quote.create({
        data: {
          workspaceId: fx.workspaceB.id,
          dealId: fx.recordsB.deal.id,
          number: "Q-API-EXPORT-B",
          status: "SENT",
          currency: "USD",
          subtotalCents: 54321,
          totalCents: 54321
        }
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
    expect(dealResponse.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(dealResponse.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dealCsv.split("\n")[0]).toBe(
      "title,status,value,currency,pipeline,stage,expectedCloseAt,contactName,contactEmail,organizationName,ownerEmail,lineItemCount,quoteCount,latestQuoteNumber,latestQuoteStatus,latestQuoteTotal,createdAt,updatedAt"
    );
    expect(dealCsv).toContain("\"Alpha \"\"Quoted\"\", Deal\nLine\"");
    expect(dealCsv).not.toContain(fx.recordsA.deal.id);
    expect(dealCsv).not.toContain("Beta private deal");

    const filteredDealResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["exports", "deals"],
      query: new URLSearchParams([
        ["q", "Alpha"],
        ["q", "Gamma"],
        ["page", "9"],
        ["pageSize", "1"],
        ["token", "raw-export-filter-token"]
      ])
    });
    const filteredDealCsv = await filteredDealResponse.text();

    expect(filteredDealResponse.status).toBe(200);
    expect(filteredDealCsv).toContain("Alpha \"\"Quoted\"\", Deal");
    expect(filteredDealCsv).toContain("Alpha Paginated Export Deal");
    expect(filteredDealCsv).not.toContain("Gamma Filtered Export Deal");
    expect(filteredDealCsv).not.toContain("raw-export-filter-token");

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

    for (const check of [
      {
        resource: "products",
        filename: "northstar-products.csv",
        expected: "Alpha Export Product",
        hidden: "Beta private product"
      },
      {
        resource: "quotes",
        filename: "northstar-quotes.csv",
        expected: "Q-API-EXPORT-A",
        hidden: "Q-API-EXPORT-B"
      }
    ]) {
      const response = await invokeWorkspaceApi({
        method: "GET",
        workspaceId: fx.workspaceA.id,
        actorUserId: fx.userA.id,
        segments: ["exports", check.resource]
      });
      const csv = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/csv");
      expect(response.headers.get("content-disposition")).toContain(check.filename);
      expect(csv).toContain(check.expected);
      if (check.resource === "products") {
        expect(csv).toContain("'=API Export Formula Product");
        expect(csv).toContain("'+spreadsheet formula should export as text");
      }
      expect(csv).not.toContain(check.hidden);
      expect(csv).not.toContain(fx.workspaceA.id);
      expect(csv).not.toContain(fx.workspaceB.id);
    }
  });

  it("applies activity search query filters to CSV exports", async () => {
    const fx = currentFixture();

    await Promise.all([
      fx.prisma.activity.create({
        data: {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: fx.recordsA.deal.id,
          type: "TASK",
          title: "API Export Activity Keep Needle",
          description: "This searched activity should be exported.",
          dueAt: new Date("2030-05-01T09:00:00.000Z")
        }
      }),
      fx.prisma.activity.create({
        data: {
          workspaceId: fx.workspaceA.id,
          ownerId: fx.userA.id,
          dealId: fx.recordsA.deal.id,
          type: "TASK",
          title: "API Export Activity Hidden Haystack",
          description: "This same-workspace activity should not match the export search.",
          dueAt: new Date("2030-05-02T09:00:00.000Z")
        }
      })
    ]);

    const response = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["exports", "activities"],
      query: new URLSearchParams([["q", "Keep Needle"]])
    });
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(csv).toContain("API Export Activity Keep Needle");
    expect(csv).not.toContain("API Export Activity Hidden Haystack");
    expect(csv).not.toContain("Beta Needle Activity");
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
    const nestedExportResponse = await invokeWorkspaceApi({
      method: "GET",
      workspaceId: fx.workspaceA.id,
      actorUserId: fx.userA.id,
      segments: ["exports", "deals", "unexpected"],
      query: new URLSearchParams([
        ["token", "raw-export-route-token"],
        ["q", "Alpha"]
      ])
    });
    const nestedExportBody = await readJson<ApiErrorBody>(nestedExportResponse);
    const nestedExportSerialized = JSON.stringify(nestedExportBody);

    expect(unsupportedResponse.status).toBe(404);
    expect(unsupportedBody.error.code).toBe("NOT_FOUND");
    expect(nestedExportResponse.status).toBe(404);
    expect(nestedExportResponse.headers.get("content-type")).toContain("application/json");
    expect(nestedExportResponse.headers.get("content-disposition")).toBeNull();
    expect(nestedExportBody).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route was not found."
      }
    });
    expect(nestedExportSerialized).not.toContain("raw-export-route-token");
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

async function withMeetingMediaProviderEnv(url: string, callback: () => Promise<void>) {
  const previousUrl = process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL;
  const previousToken = process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN;
  process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL = url;
  process.env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN = "test-provider-token";
  try {
    await callback();
  } finally {
    restoreEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL", previousUrl);
    restoreEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", previousToken);
  }
}

async function withS3StorageEnv(callback: () => Promise<void>) {
  const previousValues = {
    accessKeyId: process.env.MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID,
    backend: process.env.MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND,
    bucket: process.env.MEETING_INTELLIGENCE_S3_BUCKET,
    endpoint: process.env.MEETING_INTELLIGENCE_S3_ENDPOINT,
    forcePathStyle: process.env.MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE,
    region: process.env.MEETING_INTELLIGENCE_S3_REGION,
    secretAccessKey: process.env.MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY
  };
  process.env.MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND = "s3";
  process.env.MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID = "test-access";
  process.env.MEETING_INTELLIGENCE_S3_BUCKET = "northstar-mi-test";
  process.env.MEETING_INTELLIGENCE_S3_ENDPOINT = "https://s3.example.test";
  process.env.MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE = "true";
  process.env.MEETING_INTELLIGENCE_S3_REGION = "auto";
  process.env.MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY = "test-secret";
  try {
    await callback();
  } finally {
    restoreEnv("MEETING_INTELLIGENCE_FILE_STORAGE_BACKEND", previousValues.backend);
    restoreEnv("MEETING_INTELLIGENCE_S3_ACCESS_KEY_ID", previousValues.accessKeyId);
    restoreEnv("MEETING_INTELLIGENCE_S3_BUCKET", previousValues.bucket);
    restoreEnv("MEETING_INTELLIGENCE_S3_ENDPOINT", previousValues.endpoint);
    restoreEnv("MEETING_INTELLIGENCE_S3_FORCE_PATH_STYLE", previousValues.forcePathStyle);
    restoreEnv("MEETING_INTELLIGENCE_S3_REGION", previousValues.region);
    restoreEnv("MEETING_INTELLIGENCE_S3_SECRET_ACCESS_KEY", previousValues.secretAccessKey);
  }
}

function mockS3Storage() {
  const objects = new Map<string, Buffer>();
  const multipartUploads = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  const requests: Array<{ authorization: string; method: string; presigned: boolean; url: string }> = [];
  async function handle(input: string | URL | Request, init?: RequestInit) {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const presigned = url.searchParams.has("X-Amz-Signature");
    requests.push({ authorization: headers.get("authorization") ?? "", method, presigned, url: url.toString() });
    expect(url.pathname.startsWith("/northstar-mi-test")).toBe(true);
    if (presigned) {
      expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
      expect(url.toString()).not.toContain("test-secret");
    } else {
      expect(headers.get("authorization")).toContain("AWS4-HMAC-SHA256");
      expect(headers.get("authorization")).not.toContain("test-secret");
    }

    if (url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const keys = Array.from(objects.keys()).filter((key) => key.startsWith(prefix));
      return new Response(
        [
          "<ListBucketResult>",
          "<IsTruncated>false</IsTruncated>",
          ...keys.map((key) => `<Contents><Key>${xmlEscape(key)}</Key></Contents>`),
          "</ListBucketResult>"
        ].join(""),
        { status: 200 }
      );
    }

    const key = decodeURIComponent(url.pathname.replace(/^\/northstar-mi-test\/?/, ""));
    if (method === "POST" && url.searchParams.has("uploads")) {
      const uploadId = `upload-${multipartUploads.size + 1}`;
      multipartUploads.set(uploadId, { key, parts: new Map() });
      return new Response(`<InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`, { status: 200 });
    }
    if (method === "POST" && url.searchParams.has("uploadId")) {
      const uploadId = url.searchParams.get("uploadId") ?? "";
      const upload = multipartUploads.get(uploadId);
      if (!upload) return new Response(null, { status: 404 });
      const xml = await new Response(init?.body as BodyInit).text();
      const partNumbers = Array.from(xml.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g), (match) => Number(match[1]));
      objects.set(upload.key, Buffer.concat(partNumbers.map((partNumber) => upload.parts.get(partNumber) ?? Buffer.alloc(0))));
      multipartUploads.delete(uploadId);
      return new Response("<CompleteMultipartUploadResult />", { status: 200 });
    }
    if (method === "GET" && url.searchParams.has("uploadId")) {
      const uploadId = url.searchParams.get("uploadId") ?? "";
      const upload = multipartUploads.get(uploadId);
      if (!upload) return new Response(null, { status: 404 });
      return new Response(
        [
          "<ListPartsResult>",
          "<IsTruncated>false</IsTruncated>",
          ...Array.from(upload.parts.entries()).map(([partNumber, body]) => [
            "<Part>",
            `<PartNumber>${partNumber}</PartNumber>`,
            `<ETag>${xmlEscape(`"part-${partNumber}-${body.byteLength}"`)}</ETag>`,
            `<Size>${body.byteLength}</Size>`,
            "</Part>"
          ].join("")),
          "</ListPartsResult>"
        ].join(""),
        { status: 200 }
      );
    }
    if (method === "PUT") {
      const uploadId = url.searchParams.get("uploadId");
      const partNumber = Number(url.searchParams.get("partNumber"));
      if (uploadId && partNumber) {
        const upload = multipartUploads.get(uploadId);
        if (!upload) return new Response(null, { status: 404 });
        const body = Buffer.from(await new Response(init?.body as BodyInit).arrayBuffer());
        upload.parts.set(partNumber, body);
        return new Response(null, { status: 200, headers: { etag: `"part-${partNumber}-${body.byteLength}"` } });
      }
      objects.set(key, Buffer.from(await new Response(init?.body as BodyInit).arrayBuffer()));
      return new Response(null, { status: 200 });
    }
    if (method === "GET") {
      const body = objects.get(key);
      return body
        ? new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { status: 200 })
        : new Response(null, { status: 404 });
    }
    if (method === "DELETE") {
      const uploadId = url.searchParams.get("uploadId");
      if (uploadId) {
        multipartUploads.delete(uploadId);
        return new Response(null, { status: 204 });
      }
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }
  return { handle, multipartUploads, objects, requests };
}

function requestUrl(input: string | URL | Request) {
  return new URL(input instanceof Request ? input.url : String(input));
}

function testSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function xmlEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
