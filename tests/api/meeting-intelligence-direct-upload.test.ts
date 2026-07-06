import { describe, expect, it } from "vitest";

import {
  isMeetingDirectUploadCandidate,
  meetingDirectUploadMinBytes,
  meetingDirectUploadSourceType
} from "@/lib/meeting-intelligence/direct-upload-eligibility";

describe("Meeting Intelligence direct upload eligibility", () => {
  it("selects direct upload only for large provider-backed source types", () => {
    expect(
      meetingDirectUploadSourceType({
        byteLength: meetingDirectUploadMinBytes,
        filename: "call.mp3",
        mimeType: "audio/mpeg"
      })
    ).toBe("audio");
    expect(
      meetingDirectUploadSourceType({
        byteLength: meetingDirectUploadMinBytes,
        filename: "whiteboard.png",
        mimeType: "image/png"
      })
    ).toBe("image");
    expect(
      meetingDirectUploadSourceType({
        byteLength: meetingDirectUploadMinBytes,
        filename: "scanned.pdf",
        mimeType: "application/pdf"
      })
    ).toBe("pdf");
    expect(
      meetingDirectUploadSourceType({
        byteLength: meetingDirectUploadMinBytes,
        filename: "recording.mp4",
        mimeType: "video/mp4"
      })
    ).toBe("video");

    expect(isMeetingDirectUploadCandidate({
      byteLength: meetingDirectUploadMinBytes - 1,
      filename: "small-call.mp3",
      mimeType: "audio/mpeg"
    })).toBe(false);
    expect(isMeetingDirectUploadCandidate({
      byteLength: meetingDirectUploadMinBytes,
      filename: "notes.txt",
      mimeType: "text/plain"
    })).toBe(false);
    expect(isMeetingDirectUploadCandidate({
      byteLength: meetingDirectUploadMinBytes,
      filename: "meeting.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    })).toBe(false);
  });

  it("honors explicit provider-backed source type when filename metadata is weak", () => {
    expect(
      meetingDirectUploadSourceType({
        byteLength: meetingDirectUploadMinBytes,
        explicitSourceType: "audio",
        filename: "download",
        mimeType: "application/octet-stream"
      })
    ).toBe("audio");
  });
});
