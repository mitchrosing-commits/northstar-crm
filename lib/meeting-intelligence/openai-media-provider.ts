import { ApiError } from "@/lib/api/responses";

import type {
  MediaExtractionKind,
  MediaExtractionProvider,
  MediaProviderBinaryInput,
  MediaProviderReadiness,
  MediaProviderTextResult
} from "./media-providers";

export const internalMeetingMediaExtractionRoutePath = "/api/internal/meeting-intelligence/media-extract";

export type OpenAIMediaProviderEnv = {
  [key: string]: string | undefined;
  MEETING_INTELLIGENCE_MEDIA_PROVIDER?: string;
  MEETING_INTELLIGENCE_OPENAI_TRANSCRIPTION_MODEL?: string;
  MEETING_INTELLIGENCE_OPENAI_VISION_MODEL?: string;
  OPENAI_API_KEY?: string;
};

type OpenAIResponseBody = {
  error?: { message?: unknown };
  output?: unknown;
  output_text?: unknown;
  text?: unknown;
};

type OpenAITranscriptionBody = {
  error?: { message?: unknown };
  text?: unknown;
};

const openaiProviderId = "openai";
const openaiProviderName = "OpenAI media extraction";
const defaultVisionModel = "gpt-5.5";
const defaultTranscriptionModel = "gpt-4o-transcribe";
const maxProviderBytes = 8 * 1024 * 1024;
const supportedImageMimeTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const supportedAudioMimeTypes = new Set([
  "audio/aac",
  "audio/flac",
  "audio/m4a",
  "audio/mp3",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "audio/x-wav"
]);

export function getOpenAIMediaProviderReadiness(env: OpenAIMediaProviderEnv = process.env): MediaProviderReadiness {
  const provider = readNonEmpty(env.MEETING_INTELLIGENCE_MEDIA_PROVIDER) ?? openaiProviderId;
  if (provider !== openaiProviderId) {
    return {
      configured: false,
      message: `Internal Meeting Intelligence media extraction provider "${provider}" is not supported by this route.`,
      supportedSourceTypes: []
    };
  }
  if (!readNonEmpty(env.OPENAI_API_KEY)) {
    return {
      configured: false,
      message: "OpenAI media extraction is not configured. Set OPENAI_API_KEY to enable image OCR/vision and audio transcription.",
      providerId: openaiProviderId,
      providerName: openaiProviderName,
      supportedSourceTypes: []
    };
  }
  return {
    configured: true,
    message: "OpenAI media extraction is configured for image OCR/vision and audio transcription.",
    providerId: openaiProviderId,
    providerName: openaiProviderName,
    supportedSourceTypes: ["image", "audio"]
  };
}

export function createOpenAIMediaExtractionProvider(
  env: OpenAIMediaProviderEnv = process.env,
  fetchImpl: typeof fetch = fetch
): MediaExtractionProvider | null {
  const readiness = getOpenAIMediaProviderReadiness(env);
  if (!readiness.configured) return null;
  const apiKey = readNonEmpty(env.OPENAI_API_KEY);
  if (!apiKey) return null;

  return {
    id: openaiProviderId,
    name: openaiProviderName,
    supports(sourceType) {
      return sourceType === "image" || sourceType === "audio";
    },
    async extract(input) {
      assertSupportedInput(input);
      if (input.sourceType === "image") return extractImageMarkdown(input, env, apiKey, fetchImpl);
      if (input.sourceType === "audio") return transcribeAudio(input, env, apiKey, fetchImpl);
      throw unsupportedVideoError();
    }
  };
}

export function unsupportedVideoError() {
  return new ApiError(
    "MEETING_INTAKE_PROVIDER_UNSUPPORTED_MEDIA",
    "The internal OpenAI media extraction route does not process video yet. Upload audio directly or configure a video-capable provider until audio extraction/storage is added.",
    422
  );
}

async function extractImageMarkdown(
  input: MediaProviderBinaryInput,
  env: OpenAIMediaProviderEnv,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<MediaProviderTextResult> {
  const model = readNonEmpty(env.MEETING_INTELLIGENCE_OPENAI_VISION_MODEL) ?? defaultVisionModel;
  const mimeType = normalizeImageMimeType(input.mimeType);
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract all readable meeting notes, whiteboard text, decisions, risks, customer facts, attendees, dates, and action items from this image. Return concise Markdown only. Do not invent content."
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`
            }
          ]
        }
      ],
      max_output_tokens: 2000,
      model
    })
  });
  const body = await readOpenAIJson<OpenAIResponseBody>(response, "OpenAI image extraction request failed.");
  const text = readNonEmpty(body.output_text) ?? extractResponsesOutputText(body.output) ?? readNonEmpty(body.text);
  if (!text) throw new ApiError("MEETING_INTAKE_PROVIDER_EMPTY_RESULT", "OpenAI image extraction returned no text.", 422);

  return {
    confidence: "medium",
    metadata: { model, processor: "responses", sourceMimeType: mimeType },
    providerId: openaiProviderId,
    providerName: openaiProviderName,
    text,
    warnings: []
  };
}

async function transcribeAudio(
  input: MediaProviderBinaryInput,
  env: OpenAIMediaProviderEnv,
  apiKey: string,
  fetchImpl: typeof fetch
): Promise<MediaProviderTextResult> {
  const model = readNonEmpty(env.MEETING_INTELLIGENCE_OPENAI_TRANSCRIPTION_MODEL) ?? defaultTranscriptionModel;
  const mimeType = normalizeAudioMimeType(input.mimeType);
  const filename = readNonEmpty(input.filename) ?? defaultAudioFilename(mimeType);
  const audioBuffer = input.bytes.buffer.slice(input.bytes.byteOffset, input.bytes.byteOffset + input.bytes.byteLength) as ArrayBuffer;
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), filename);
  formData.append("model", model);
  formData.append("response_format", "json");
  formData.append("prompt", "Meeting notes, sales discovery, CRM relationship context, decisions, risks, and follow-up action items.");

  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData
  });
  const body = await readOpenAIJson<OpenAITranscriptionBody>(response, "OpenAI audio transcription request failed.");
  const text = readNonEmpty(body.text);
  if (!text) throw new ApiError("MEETING_INTAKE_PROVIDER_EMPTY_RESULT", "OpenAI audio transcription returned no text.", 422);

  return {
    confidence: "medium",
    metadata: { model, processor: "audio-transcriptions", sourceMimeType: mimeType },
    providerId: openaiProviderId,
    providerName: openaiProviderName,
    text,
    warnings: []
  };
}

async function readOpenAIJson<T extends OpenAIResponseBody | OpenAITranscriptionBody>(response: Response, message: string) {
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok) {
    throw new ApiError("MEETING_INTAKE_PROVIDER_FAILED", message, 502);
  }
  return body ?? ({} as T);
}

function assertSupportedInput(input: MediaProviderBinaryInput) {
  if (input.bytes.byteLength === 0) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${input.sourceType.toUpperCase()} file content was empty.`, 422);
  }
  if (input.bytes.byteLength > maxProviderBytes) {
    throw new ApiError("MEETING_INTAKE_PROCESSOR_FAILED", `${input.sourceType.toUpperCase()} files are limited to 8 MB for provider extraction.`, 422);
  }
  if (input.sourceType === "image") {
    normalizeImageMimeType(input.mimeType);
    return;
  }
  if (input.sourceType === "audio") {
    normalizeAudioMimeType(input.mimeType);
    return;
  }
  throw unsupportedVideoError();
}

function normalizeImageMimeType(mimeType: string | undefined) {
  const normalized = readNonEmpty(mimeType)?.toLowerCase() ?? "image/png";
  if (!supportedImageMimeTypes.has(normalized)) {
    throw new ApiError("MEETING_INTAKE_UNSUPPORTED_MEDIA_TYPE", "Image extraction supports PNG, JPEG, and WebP files.", 422);
  }
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
}

function normalizeAudioMimeType(mimeType: string | undefined) {
  const normalized = readNonEmpty(mimeType)?.toLowerCase() ?? "audio/mpeg";
  if (!supportedAudioMimeTypes.has(normalized)) {
    throw new ApiError("MEETING_INTAKE_UNSUPPORTED_MEDIA_TYPE", "Audio transcription supports common MP3, MP4/M4A, WAV, WebM, OGG, FLAC, and AAC files.", 422);
  }
  return normalized;
}

function defaultAudioFilename(mimeType: string) {
  if (mimeType.includes("wav")) return "meeting-audio.wav";
  if (mimeType.includes("webm")) return "meeting-audio.webm";
  if (mimeType.includes("ogg")) return "meeting-audio.ogg";
  if (mimeType.includes("flac")) return "meeting-audio.flac";
  if (mimeType.includes("aac")) return "meeting-audio.aac";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "meeting-audio.m4a";
  return "meeting-audio.mp3";
}

function extractResponsesOutputText(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;
  const text = output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((contentItem) => {
        if (!contentItem || typeof contentItem !== "object") return [];
        const value = contentItem as { text?: unknown; type?: unknown };
        if (value.type === "output_text" || value.type === "text") {
          const entry = readNonEmpty(value.text);
          return entry ? [entry] : [];
        }
        return [];
      });
    })
    .join("\n")
    .trim();
  return text || undefined;
}

function readNonEmpty(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
