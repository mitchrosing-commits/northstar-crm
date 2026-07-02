import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/responses";
import { analyzeMeetingIntelligence } from "@/lib/meeting-intelligence/analyze";
import { extractMeetingText } from "@/lib/meeting-intelligence/extractors";
import { normalizeMeetingMarkdown } from "@/lib/meeting-intelligence/markdown-normalizer";
import { deterministicMeetingAnalysisProvider } from "@/lib/meeting-intelligence/providers";
import { detectMeetingSource } from "@/lib/meeting-intelligence/source-detection";
import { formatMeetingIntakeFailureMessage } from "@/lib/services/meeting-intelligence-service";

const pdfFixtureBase64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTQ3ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIChNZWV0aW5nIGRhdGU6IDIwMzAtMDQtMDEpIFRqIDAgLTE4IFRkIChBY3Rpb246IHNlbmQgU09XIGJ5IDIwMzAtMDQtMDUuKSBUaiAwIC0xOCBUZCAoQ3VycmVudCBXTVMgaGFzIGludmVudG9yeSBwYWluLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjUwOQolJUVPRgo=";
const docxFixtureBase64 =
  "UEsDBAoAAAAIAFJ34lzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMECgAAAAAAUnfiXAAAAAAAAAAAAAAAAAYAAABfcmVscy9QSwMECgAAAAgAUnfiXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMECgAAAAAAUnfiXAAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACABSd+Jcen7lpwIBAADNAQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sjVHLasMwELznKxada0tJHxRhO5RCTw0tTYvPirSxDdYDSYnrv69kCL2Uksuww7KzO7PV9luPcEYfBmtqsi4ZATTSqsF0Nfn6fCkeCYQojBKjNViTGQPZNqtq4srKk0YTISmYwKea9DE6TmmQPWoRSuvQpN7Rei1ior6jk/XKeSsxhLRAj3TD2APVYjCkWQEk1YNVcy4X4poEPkNsdogxzYASETls2C0r2F3B1hXN3Yx+Qffn9FOMaBRi4LAXGj6GZFncwCsitNZ014k8n7zPhtvdHnoRYDDnRK2fwSUH5ZWXyJii5hDSPbB/a+Ew/7q5/0ckoIzvni450UtQubo8ovkBUEsBAhQACgAAAAgAUnfiXNd5hOrxAAAAuAEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAABSd+JcAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAAAiAQAAX3JlbHMvUEsBAhQACgAAAAgAUnfiXCAbhuqyAAAALgEAAAsAAAAAAAAAAAAAAAAARgEAAF9yZWxzLy5yZWxzUEsBAhQACgAAAAAAUnfiXAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAQAAAAIQIAAHdvcmQvUEsBAhQACgAAAAgAUnfiXHp+5acCAQAAzQEAABEAAAAAAAAAAAAAAAAARAIAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAAFAAUAIAEAAHUDAAAAAA==";

describe("meeting intelligence source detection", () => {
  it.each([
    ["notes.txt", "", "text_file", "supported"],
    ["notes.md", "", "markdown", "supported"],
    ["discovery.pdf", "", "pdf", "supported"],
    ["sow.docx", "", "docx", "supported"],
    ["legacy.doc", "", "unsupported", "unsupported"],
    ["whiteboard.png", "", "image", "provider_required"],
    ["photo.jpg", "", "image", "provider_required"],
    ["call.mp3", "", "audio", "provider_required"],
    ["call.m4a", "", "audio", "provider_required"],
    ["call.wav", "", "audio", "provider_required"],
    ["recording.mp4", "", "video", "provider_required"],
    ["recording.mov", "", "video", "provider_required"],
    ["artifact.bin", "", "unsupported", "unsupported"],
    ["", "text/plain", "text_file", "supported"]
  ])("detects %s %s", (filename, mimeType, sourceType, capability) => {
    expect(detectMeetingSource({ filename, mimeType })).toMatchObject({ capability, sourceType });
  });

  it("fails unsupported processors clearly instead of faking extraction", async () => {
    await expect(extractMeetingText({ filename: "whiteboard.png" })).rejects.toThrow(/OCR or vision provider/);
  });

  it("extracts real text from text-based PDFs", async () => {
    const extracted = await extractMeetingText({
      fileBase64: pdfFixtureBase64,
      filename: "meeting.pdf",
      mimeType: "application/pdf"
    });

    expect(extracted.rawText).toContain("Action: send SOW by 2030-04-05.");
    expect(extracted.metadata).toMatchObject({ pageCount: 1, processor: "local-pdf", sourceType: "pdf" });
    expect(extracted.warnings).toEqual([]);
  });

  it("fails PDF extraction clearly when file content is missing", async () => {
    await expect(extractMeetingText({ filename: "meeting.pdf", mimeType: "application/pdf" })).rejects.toThrow(
      /PDF extraction requires uploaded PDF file content/
    );
  });

  it("extracts real text from DOCX files", async () => {
    const extracted = await extractMeetingText({
      fileBase64: docxFixtureBase64,
      filename: "meeting.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });

    expect(extracted.rawText).toContain("Attendees: Sam Rivera, Lee Wong");
    expect(extracted.rawText).toContain("Current WMS has inventory pain.");
    expect(extracted.metadata).toMatchObject({ processor: "local-docx", sourceType: "docx" });
  });

  it("fails DOCX extraction clearly when file content is missing", async () => {
    await expect(
      extractMeetingText({
        filename: "meeting.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    ).rejects.toThrow(/DOCX extraction requires uploaded DOCX file content/);
  });
});

describe("meeting intelligence markdown and proposals", () => {
  it("normalizes context, action items, decisions, risks, and notes without losing raw text", () => {
    const normalized = normalizeMeetingMarkdown({
      contextText: "Meeting date: 2030-04-01\nAttendees: Sam Rivera, Lee Wong",
      rawText: "Decision: approve WMS discovery.\nAction: Sam to send SOW by 2030-04-05.\nRisk: ERP integration timeline.",
      metadata: { pageCount: 2, processor: "pdf", sourceType: "pdf", wordCount: 12 },
      sourceType: "pasted_text"
    });

    expect(normalized.markdown).toContain("## User Context");
    expect(normalized.markdown).toContain("- Pages: 2");
    expect(normalized.markdown).toContain("Sam to send SOW");
    expect(normalized.sections.actionItems).toContain("Action: Sam to send SOW by 2030-04-05.");
    expect(normalized.sections.decisions).toContain("Decision: approve WMS discovery.");
    expect(normalized.sections.risks).toContain("Risk: ERP integration timeline.");
  });

  it("builds deterministic reviewable proposals", () => {
    const draft = analyzeMeetingIntelligence({
      contextText: "Meeting date: 2030-04-01",
      markdown: [
        "# Meeting Intake",
        "Alpha Orbit Organization wants WMS implementation support.",
        "Budget is approved and legal needs the SOW.",
        "Action: Owner: Sam. send SOW by 2030-04-05."
      ].join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Alpha Needle Deal",
          evidenceExcerpt: "Alpha Needle Deal",
          id: "deal-1",
          matchedReason: "Manual record hint",
          objectType: "deal",
          status: "OPEN"
        }
      ],
      unmatchedEntities: []
    });

    expect(draft.meetingActivity).toMatchObject({ include: true, target: { id: "deal-1", type: "deal" } });
    expect(draft.notes[0]).toMatchObject({ include: true, target: { id: "deal-1", type: "deal" } });
    expect(draft.nextStepActivities[0]).toMatchObject({
      dueAt: "2030-04-05T00:00:00.000Z",
      include: true,
      title: "Owner: Sam. send SOW by 2030-04-05."
    });
    expect(draft.nextStepActivities[0].description).toContain("Owner hint: Sam");
  });

  it("includes evidence, confidence, and supply-chain fact notes in deterministic provider output", async () => {
    const draft = await deterministicMeetingAnalysisProvider.analyzeMeetingMarkdown({
      contextText: "Meeting date: 2030-04-01",
      markdown: [
        "# Meeting Intake",
        "Attendees: Sam Rivera, Lee Wong",
        "Current WMS is creating inventory accuracy pain across 4 DCs.",
        "UAT starts before go-live and data migration is a blocker.",
        "Decision: approve discovery and prepare SOW.",
        "Open question: who owns ERP integration?",
        "Action: Owner: Lee. schedule UAT workshop by next week."
      ].join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Alpha Orbit Organization",
          evidenceExcerpt: "Alpha Orbit Organization",
          id: "org-1",
          matchedReason: "Context hint match",
          objectType: "organization"
        },
        {
          confidence: "high",
          displayName: "Alpha Needle Deal",
          evidenceExcerpt: "Alpha Needle Deal",
          id: "deal-1",
          matchedReason: "Context hint match",
          objectType: "deal",
          status: "OPEN"
        }
      ],
      unmatchedEntities: []
    });

    expect(draft.notes.some((note) => note.kind === "company_fact" && note.body.includes("Current WMS"))).toBe(true);
    const ownerAction = draft.nextStepActivities.find((activity) => activity.title === "Owner: Lee. schedule UAT workshop by next week.");
    expect(ownerAction).toMatchObject({
      confidence: "high",
      matchedReason: "Context hint match",
    });
    expect(ownerAction?.evidence).toContain("Action: Owner: Lee. schedule UAT workshop by next week.");
    expect(draft.warnings).not.toContain("No deal or lead was confidently matched.");
  });

  it("keeps deterministic proposal counts bounded for noisy transcript-like text", () => {
    const draft = analyzeMeetingIntelligence({
      markdown: Array.from({ length: 30 }, (_, index) => `Action: follow up on warehouse item ${index + 1} by 2030-04-05.`).join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Alpha Needle Deal",
          evidenceExcerpt: "Alpha Needle Deal",
          id: "deal-1",
          matchedReason: "Context hint match",
          objectType: "deal",
          status: "OPEN"
        }
      ],
      unmatchedEntities: []
    });

    expect(draft.nextStepActivities).toHaveLength(6);
    expect(draft.notes.length).toBeLessThanOrEqual(8);
  });
});

describe("meeting intelligence failure safety", () => {
  it("redacts sensitive values before persisting or returning processor failure reasons", () => {
    expect(
      formatMeetingIntakeFailureMessage(
        new ApiError(
          "MEETING_INTAKE_PROCESSOR_FAILED",
          "Provider failed for founder@example.test with token=raw-meeting-token and Bearer raw-bearer-token",
          502
        )
      )
    ).toBe("Provider failed for [redacted email] with token=[redacted] and Bearer [redacted]");
    expect(
      formatMeetingIntakeFailureMessage(
        "Parser failed at /reset-password?token=raw-reset-token for buyer@example.test"
      )
    ).toBe("Parser failed at [redacted reset url] for [redacted email]");
    expect(formatMeetingIntakeFailureMessage({ failed: true }, "Could not apply update.")).toBe("Could not apply update.");
  });
});
