import {
  meetingSourceTypes,
  type MeetingSourceProviderRequirement,
  type MeetingSourceType,
  type SourceDetectionInput,
  type SourceDetectionResult
} from "./types";

const extensionTypes: Record<string, MeetingSourceType> = {
  ".csv": "csv",
  ".doc": "unsupported",
  ".docx": "docx",
  ".htm": "html",
  ".html": "html",
  ".jpeg": "image",
  ".jpg": "image",
  ".json": "json",
  ".m4a": "audio",
  ".md": "markdown",
  ".mov": "video",
  ".mp3": "audio",
  ".mp4": "video",
  ".pdf": "pdf",
  ".png": "image",
  ".pptx": "pptx",
  ".rtf": "rtf",
  ".text": "text_file",
  ".txt": "text_file",
  ".wav": "audio",
  ".webm": "video",
  ".xlsx": "xlsx"
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
  if (mimeType === "application/rtf" || mimeType === "application/x-rtf" || mimeType === "text/rtf") return "rtf";
  if (mimeType === "text/html" || mimeType === "application/xhtml+xml") return "html";
  if (mimeType === "text/csv" || mimeType === "application/csv") return "csv";
  if (mimeType === "application/json" || mimeType.endsWith("+json")) return "json";
  if (mimeType.startsWith("text/")) return "text_file";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/msword") return "unsupported";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
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
  const localProcessor = localExtractionMethod(sourceType);
  if (localProcessor) {
    return {
      capability: "supported",
      conversionMode: "local",
      extractionMethod: localProcessor,
      sourceType
    };
  }
  if (sourceType === "image") {
    return providerRequired(sourceType, "ocr_or_vision", "Image and whiteboard extraction requires an OCR or vision provider integration.");
  }
  if (sourceType === "audio") {
    return providerRequired(sourceType, "transcription", "Audio transcription requires a transcription provider integration.");
  }
  if (sourceType === "video") {
    return providerRequired(
      sourceType,
      "media_processing",
      "Video transcription requires a transcription or media processing provider integration."
    );
  }
  if (sourceType === "pptx") {
    return {
      capability: "unsupported",
      conversionMode: "unsupported",
      extractionMethod: "unavailable",
      message:
        "PPTX slide deck extraction needs a dedicated local presentation parser. Export the deck to PDF, DOCX, markdown, HTML, or text before intake.",
      requiredProvider: "document_conversion",
      sourceType
    };
  }
  if (sourceType === "xlsx") {
    return {
      capability: "unsupported",
      conversionMode: "unsupported",
      extractionMethod: "unavailable",
      message:
        "XLSX spreadsheet extraction needs a dedicated local spreadsheet parser. Export the workbook to CSV, markdown, HTML, or text before intake.",
      requiredProvider: "document_conversion",
      sourceType
    };
  }
  return {
    capability: "unsupported",
    conversionMode: "unsupported",
    extractionMethod: "unavailable",
    message: "This source type is not supported by Meeting Intelligence. Legacy .doc files should be converted to .docx before intake.",
    requiredProvider: "document_conversion",
    sourceType
  };
}

function localExtractionMethod(sourceType: MeetingSourceType) {
  if (sourceType === "pasted_text" || sourceType === "markdown" || sourceType === "text_file") return "local-text";
  if (sourceType === "rtf") return "local-rtf";
  if (sourceType === "html") return "local-html";
  if (sourceType === "csv") return "local-csv";
  if (sourceType === "json") return "local-json";
  if (sourceType === "pdf") return "local-pdf";
  if (sourceType === "docx") return "local-docx";
  return null;
}

function providerRequired(
  sourceType: MeetingSourceType,
  requiredProvider: MeetingSourceProviderRequirement,
  message: string
): SourceDetectionResult {
  return {
    capability: "provider_required",
    conversionMode: "provider_required",
    extractionMethod: "provider-required",
    message,
    requiredProvider,
    sourceType
  };
}

function readText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
