import { meetingSourceTypes, type MeetingSourceType, type SourceDetectionInput, type SourceDetectionResult } from "./types";

const extensionTypes: Record<string, MeetingSourceType> = {
  ".doc": "unsupported",
  ".docx": "docx",
  ".jpeg": "image",
  ".jpg": "image",
  ".m4a": "audio",
  ".md": "markdown",
  ".mov": "video",
  ".mp3": "audio",
  ".mp4": "video",
  ".pdf": "pdf",
  ".png": "image",
  ".text": "text_file",
  ".txt": "text_file",
  ".wav": "audio",
  ".webm": "video"
};

export function detectMeetingSource(input: SourceDetectionInput): SourceDetectionResult {
  const explicit = normalizeSourceType(input.explicitSourceType);
  const filename = readText(input.filename);
  const mimeType = readText(input.mimeType)?.toLowerCase();
  const text = readText(input.text);
  const sourceType = explicit ?? sourceTypeFromMime(mimeType) ?? sourceTypeFromFilename(filename) ?? sourceTypeFromText(text);

  return withCapability(sourceType ?? "unsupported");
}

export function normalizeSourceType(value: unknown): MeetingSourceType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  return meetingSourceTypes.includes(normalized as MeetingSourceType) ? (normalized as MeetingSourceType) : undefined;
}

export function acceptedMeetingFileExtensions() {
  return Object.keys(extensionTypes).sort();
}

function sourceTypeFromFilename(filename: string | undefined) {
  if (!filename) return undefined;
  const lower = filename.toLowerCase();
  const extension = Object.keys(extensionTypes)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => lower.endsWith(candidate));
  return extension ? extensionTypes[extension] : "unsupported";
}

function sourceTypeFromMime(mimeType: string | undefined): MeetingSourceType | undefined {
  if (!mimeType) return undefined;
  if (mimeType === "text/markdown") return "markdown";
  if (mimeType.startsWith("text/")) return "text_file";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/msword") return "unsupported";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return undefined;
}

function sourceTypeFromText(text: string | undefined): MeetingSourceType | undefined {
  if (!text) return undefined;
  if (/^#{1,6}\s+\S/m.test(text) || /^\s*[-*]\s+\[[ x]\]/im.test(text)) return "markdown";
  return "pasted_text";
}

function withCapability(sourceType: MeetingSourceType): SourceDetectionResult {
  if (
    sourceType === "pasted_text" ||
    sourceType === "markdown" ||
    sourceType === "text_file" ||
    sourceType === "pdf" ||
    sourceType === "docx"
  ) {
    return { capability: "supported", sourceType };
  }
  if (sourceType === "image") {
    return {
      capability: "provider_required",
      message: "Image and whiteboard extraction requires an OCR or vision provider integration.",
      sourceType
    };
  }
  if (sourceType === "audio") {
    return {
      capability: "provider_required",
      message: "Audio transcription requires a transcription provider integration.",
      sourceType
    };
  }
  if (sourceType === "video") {
    return {
      capability: "provider_required",
      message: "Video transcription requires a transcription or media processing provider integration.",
      sourceType
    };
  }
  return {
    capability: "unsupported",
    message: "This source type is not supported by Meeting Intelligence. Legacy .doc files should be converted to .docx before intake.",
    sourceType
  };
}

function readText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
