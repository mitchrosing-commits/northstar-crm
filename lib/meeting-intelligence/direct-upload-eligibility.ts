import { detectMeetingSource } from "./source-detection";
import type { MediaExtractionKind } from "./media-providers";

export const meetingDirectUploadMinBytes = 1024 * 1024;

export type MeetingDirectUploadEligibilityInput = {
  byteLength: number;
  explicitSourceType?: string;
  filename?: string;
  mimeType?: string;
};

export function meetingDirectUploadSourceType(input: MeetingDirectUploadEligibilityInput): MediaExtractionKind | null {
  if (!Number.isInteger(input.byteLength) || input.byteLength < meetingDirectUploadMinBytes) return null;
  const detection = detectMeetingSource({
    explicitSourceType: input.explicitSourceType,
    filename: input.filename,
    mimeType: input.mimeType
  });
  if (
    detection.sourceType === "audio" ||
    detection.sourceType === "image" ||
    detection.sourceType === "pdf" ||
    detection.sourceType === "video"
  ) {
    return detection.sourceType;
  }
  return null;
}

export function isMeetingDirectUploadCandidate(input: MeetingDirectUploadEligibilityInput) {
  return meetingDirectUploadSourceType(input) !== null;
}
