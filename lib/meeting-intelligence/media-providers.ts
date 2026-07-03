import { ApiError } from "@/lib/api/responses";

import type { MeetingSourceType } from "./types";

export const meetingMediaExtractionJobType = "meeting_intake.extract_media";

export type MediaExtractionKind = "audio" | "image" | "video";

export type MediaProviderBinaryInput = {
  bytes: Uint8Array;
  filename?: string;
  mimeType?: string;
  sourceType: MediaExtractionKind;
};

export type MediaProviderTextResult = {
  confidence?: "high" | "medium" | "low";
  metadata?: Record<string, string | number | boolean | null>;
  providerId: string;
  providerName?: string;
  text: string;
  warnings: string[];
};

export type MediaExtractionProvider = {
  extract(input: MediaProviderBinaryInput): Promise<MediaProviderTextResult>;
  id: string;
  name: string;
  supports(sourceType: MediaExtractionKind): boolean;
};

export type MediaProviderReadiness = {
  configured: boolean;
  message: string;
  providerId?: string;
  providerName?: string;
  supportedSourceTypes: MediaExtractionKind[];
};

export type MeetingMediaProviderEnv = {
  [key: string]: string | undefined;
  MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN?: string;
  MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL?: string;
};

type MediaProviderHttpResponse = {
  confidence?: unknown;
  markdown?: unknown;
  metadata?: unknown;
  text?: unknown;
  transcript?: unknown;
  warnings?: unknown;
};

const providerId = "provider-http";
const providerName = "Configured media extraction provider";

export function getMeetingMediaProviderReadiness(env: MeetingMediaProviderEnv = process.env): MediaProviderReadiness {
  const url = readNonEmpty(env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL);
  if (!url) {
    return {
      configured: false,
      message:
        "Meeting media extraction provider is not configured. Set MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL to enable image OCR and audio/video transcription.",
      supportedSourceTypes: []
    };
  }
  return {
    configured: true,
    message: "Meeting media extraction provider is configured.",
    providerId,
    providerName,
    supportedSourceTypes: ["image", "audio", "video"]
  };
}

export function createConfiguredMeetingMediaProvider(
  env: MeetingMediaProviderEnv = process.env,
  fetchImpl: typeof fetch = fetch
): MediaExtractionProvider | null {
  const url = readNonEmpty(env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL);
  if (!url) return null;
  const token = readNonEmpty(env.MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN);

  return {
    id: providerId,
    name: providerName,
    supports(sourceType) {
      return sourceType === "image" || sourceType === "audio" || sourceType === "video";
    },
    async extract(input) {
      if (!this.supports(input.sourceType)) {
        throw new ApiError("MEETING_INTAKE_PROVIDER_UNAVAILABLE", `No media extraction provider supports ${input.sourceType}.`, 422);
      }

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            fileBase64: Buffer.from(input.bytes).toString("base64"),
            filename: input.filename,
            mimeType: input.mimeType,
            sourceType: input.sourceType
          })
        });
      } catch {
        throw new ApiError("MEETING_INTAKE_PROVIDER_FAILED", "Meeting media extraction provider request failed.", 502);
      }

      if (!response.ok) {
        throw new ApiError("MEETING_INTAKE_PROVIDER_FAILED", "Meeting media extraction provider returned an error.", 502);
      }

      const body = await response.json().catch(() => null) as MediaProviderHttpResponse | null;
      const text = readNonEmpty(body?.markdown) ?? readNonEmpty(body?.text) ?? readNonEmpty(body?.transcript);
      if (!text) {
        throw new ApiError("MEETING_INTAKE_PROVIDER_EMPTY_RESULT", "Meeting media extraction provider returned no text.", 422);
      }

      return {
        confidence: normalizeConfidence(body?.confidence),
        metadata: normalizeProviderMetadata(body?.metadata),
        providerId,
        providerName,
        text,
        warnings: normalizeWarnings(body?.warnings)
      };
    }
  };
}

export function isMediaProviderSourceType(sourceType: MeetingSourceType): sourceType is MediaExtractionKind {
  return sourceType === "image" || sourceType === "audio" || sourceType === "video";
}

export function mediaProviderRequiredMessage(sourceType: MediaExtractionKind) {
  if (sourceType === "image") return "Image and whiteboard extraction requires a configured OCR or vision provider.";
  if (sourceType === "audio") return "Audio transcription requires a configured transcription provider.";
  return "Video transcription requires a configured transcription or media processing provider.";
}

function normalizeConfidence(value: unknown) {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function normalizeProviderMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
      if (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) {
        return [[key, item]];
      }
      return [];
    })
  );
}

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => readNonEmpty(item)).filter((item): item is string => Boolean(item)).slice(0, 10);
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
