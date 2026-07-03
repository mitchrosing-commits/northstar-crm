import { z } from "zod";

import { ApiError, handleApiError, json } from "@/lib/api/responses";
import { createOpenAIMediaExtractionProvider, unsupportedVideoError } from "@/lib/meeting-intelligence/openai-media-provider";
import type { MediaExtractionProvider } from "@/lib/meeting-intelligence/media-providers";

type InternalMediaRouteOptions = {
  env?: InternalMediaRouteEnv;
  mediaProvider?: MediaExtractionProvider | null;
};

type InternalMediaRouteEnv = {
  [key: string]: string | undefined;
  MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN?: string;
};

const internalMediaExtractSchema = z.object({
  fileBase64: z.string().trim().min(1),
  filename: z.string().trim().optional(),
  mimeType: z.string().trim().optional(),
  sourceType: z.enum(["image", "audio", "video"])
});

export async function POST(request: Request) {
  return handleInternalMeetingMediaExtract(request);
}

export async function handleInternalMeetingMediaExtract(request: Request, options: InternalMediaRouteOptions = {}) {
  try {
    const env = options.env ?? process.env;
    authorizeInternalRequest(request, env);
    const payload = internalMediaExtractSchema.parse(await readJsonBody(request));
    if (payload.sourceType === "video") throw unsupportedVideoError();

    const provider = options.mediaProvider ?? createOpenAIMediaExtractionProvider(env);
    if (!provider?.supports(payload.sourceType)) {
      throw new ApiError(
        "MEETING_INTAKE_PROVIDER_NOT_CONFIGURED",
        "OpenAI media extraction is not configured. Set OPENAI_API_KEY and MEETING_INTELLIGENCE_MEDIA_PROVIDER=openai to enable this internal route.",
        503
      );
    }

    const result = await provider.extract({
      bytes: decodeBase64(payload.fileBase64, payload.sourceType),
      filename: payload.filename,
      mimeType: payload.mimeType,
      sourceType: payload.sourceType
    });

    return json({
      confidence: result.confidence,
      markdown: result.text,
      metadata: result.metadata,
      providerId: result.providerId,
      providerName: result.providerName,
      text: result.text,
      warnings: result.warnings
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function authorizeInternalRequest(request: Request, env: InternalMediaRouteEnv) {
  const expectedToken = readNonEmpty(env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN);
  if (!expectedToken) {
    throw new ApiError(
      "MEETING_INTAKE_PROVIDER_NOT_CONFIGURED",
      "Meeting media extraction internal token is not configured.",
      503
    );
  }
  if (request.headers.get("authorization") !== `Bearer ${expectedToken}`) {
    throw new ApiError("UNAUTHORIZED", "Internal media extraction authorization failed.", 401);
  }
}

async function readJsonBody(request: Request) {
  return request.json().catch(() => {
    throw new ApiError("VALIDATION_ERROR", "The request payload is invalid.", 422);
  });
}

function decodeBase64(value: string, sourceType: "audio" | "image" | "video") {
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${sourceType.toUpperCase()} file content was empty.`, 422);
  }
  return new Uint8Array(bytes);
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
