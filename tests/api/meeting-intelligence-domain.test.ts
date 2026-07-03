import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/responses";
import { analyzeMeetingIntelligence } from "@/lib/meeting-intelligence/analyze";
import { extractMeetingText } from "@/lib/meeting-intelligence/extractors";
import { normalizeMeetingMarkdown } from "@/lib/meeting-intelligence/markdown-normalizer";
import { createConfiguredMeetingMediaProvider, getMeetingMediaProviderReadiness } from "@/lib/meeting-intelligence/media-providers";
import { deterministicMeetingAnalysisProvider } from "@/lib/meeting-intelligence/providers";
import { detectMeetingSource } from "@/lib/meeting-intelligence/source-detection";
import { formatMeetingIntakeFailureMessage } from "@/lib/services/meeting-intelligence-service";

const pdfFixtureBase64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggMTQ3ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIChNZWV0aW5nIGRhdGU6IDIwMzAtMDQtMDEpIFRqIDAgLTE4IFRkIChBY3Rpb246IHNlbmQgU09XIGJ5IDIwMzAtMDQtMDUuKSBUaiAwIC0xOCBUZCAoQ3VycmVudCBXTVMgaGFzIGludmVudG9yeSBwYWluLikgVGogRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyNDEgMDAwMDAgbiAKMDAwMDAwMDMxMSAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDYgL1Jvb3QgMSAwIFIgPj4Kc3RhcnR4cmVmCjUwOQolJUVPRgo=";
const scannedPdfFixtureBase64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8ID4+ID4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNCAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKMjA4CiUlRU9GCg==";
const docxFixtureBase64 =
  "UEsDBAoAAAAIAFJ34lzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMECgAAAAAAUnfiXAAAAAAAAAAAAAAAAAYAAABfcmVscy9QSwMECgAAAAgAUnfiXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMECgAAAAAAUnfiXAAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACABSd+Jcen7lpwIBAADNAQAAEQAAAHdvcmQvZG9jdW1lbnQueG1sjVHLasMwELznKxada0tJHxRhO5RCTw0tTYvPirSxDdYDSYnrv69kCL2Uksuww7KzO7PV9luPcEYfBmtqsi4ZATTSqsF0Nfn6fCkeCYQojBKjNViTGQPZNqtq4srKk0YTISmYwKea9DE6TmmQPWoRSuvQpN7Rei1ior6jk/XKeSsxhLRAj3TD2APVYjCkWQEk1YNVcy4X4poEPkNsdogxzYASETls2C0r2F3B1hXN3Yx+Qffn9FOMaBRi4LAXGj6GZFncwCsitNZ014k8n7zPhtvdHnoRYDDnRK2fwSUH5ZWXyJii5hDSPbB/a+Ew/7q5/0ckoIzvni450UtQubo8ovkBUEsBAhQACgAAAAgAUnfiXNd5hOrxAAAAuAEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAABSd+JcAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAAAiAQAAX3JlbHMvUEsBAhQACgAAAAgAUnfiXCAbhuqyAAAALgEAAAsAAAAAAAAAAAAAAAAARgEAAF9yZWxzLy5yZWxzUEsBAhQACgAAAAAAUnfiXAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAQAAAAIQIAAHdvcmQvUEsBAhQACgAAAAgAUnfiXHp+5acCAQAAzQEAABEAAAAAAAAAAAAAAAAARAIAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAAFAAUAIAEAAHUDAAAAAA==";

describe("meeting intelligence source detection", () => {
  it.each([
    ["notes.txt", "", "text_file", "supported"],
    ["notes.md", "", "markdown", "supported"],
    ["notes.rtf", "", "rtf", "supported"],
    ["summary.html", "", "html", "supported"],
    ["summary.htm", "", "html", "supported"],
    ["actions.csv", "", "csv", "supported"],
    ["transcript.json", "", "json", "supported"],
    ["discovery.pdf", "", "pdf", "supported"],
    ["sow.docx", "", "docx", "supported"],
    ["deck.pptx", "", "pptx", "unsupported"],
    ["tracker.xlsx", "", "xlsx", "unsupported"],
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
    await expect(extractMeetingText({ filename: "call.mp3" })).rejects.toThrow(/transcription provider/);
    await expect(extractMeetingText({ filename: "recording.mp4" })).rejects.toThrow(/media processing provider/);
    await expect(extractMeetingText({ filename: "review.pptx" })).rejects.toThrow(/dedicated local presentation parser/);
    await expect(extractMeetingText({ filename: "actions.xlsx" })).rejects.toThrow(/dedicated local spreadsheet parser/);
  });

  it.each([
    ["image", "whiteboard.png", "image/png", "provider-ocr"],
    ["audio", "call.mp3", "audio/mpeg", "provider-transcription"],
    ["video", "recording.mp4", "video/mp4", "provider-transcription"]
  ] as const)("uses an injected media provider for real %s extraction results", async (sourceType, filename, mimeType, extractionMethod) => {
    const extracted = await extractMeetingText(
      {
        explicitSourceType: sourceType,
        fileBase64: Buffer.from("fake-image-bytes").toString("base64"),
        filename,
        mimeType
      },
      {
        mediaProvider: {
          id: "test-vision",
          name: "Test media provider",
          supports: (candidate) => candidate === sourceType,
          async extract() {
            return {
              providerId: "test-vision",
              providerName: "Test media provider",
              text: "Decision: approve WMS discovery.\nAction: send SOW by 2030-04-05.",
              warnings: ["Low contrast whiteboard photo."]
            };
          }
        }
      }
    );

    expect(extracted.rawText).toContain("Action: send SOW by 2030-04-05.");
    expect(extracted.metadata).toMatchObject({
      conversionMode: "provider_required",
      extractionMethod,
      processor: "test-vision",
      providerName: "Test media provider",
      sourceType
    });
    expect(extracted.warnings).toEqual(["Low contrast whiteboard photo."]);
  });

  it("surfaces media provider configuration readiness and HTTP adapter behavior", async () => {
    expect(getMeetingMediaProviderReadiness({})).toMatchObject({
      configured: false,
      supportedSourceTypes: []
    });
    const fetchCalls: unknown[] = [];
    const provider = createConfiguredMeetingMediaProvider(
      {
        MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN: "provider-token",
        MEETING_INTELLIGENCE_MEDIA_PROVIDER_URL: "https://provider.example.test/extract"
      },
      async (url, init) => {
        fetchCalls.push({ init, url });
        return Response.json({
          text: "Transcript: Action: schedule UAT workshop by 2030-04-05.",
          warnings: ["Provider normalized background noise."]
        });
      }
    );

    expect(provider).toBeTruthy();
    await expect(
      provider?.extract({
        bytes: new Uint8Array([1, 2, 3]),
        filename: "call.mp3",
        mimeType: "audio/mpeg",
        sourceType: "audio"
      })
    ).resolves.toMatchObject({
      providerId: "provider-http",
      text: "Transcript: Action: schedule UAT workshop by 2030-04-05.",
      warnings: ["Provider normalized background noise."]
    });
    expect(fetchCalls[0]).toMatchObject({
      url: "https://provider.example.test/extract",
      init: {
        headers: {
          Authorization: "Bearer provider-token",
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    });
  });

  it("includes local/provider processor metadata in detection results", () => {
    expect(detectMeetingSource({ filename: "notes.txt" })).toMatchObject({
      capability: "supported",
      conversionMode: "local",
      extractionMethod: "local-text",
      sourceType: "text_file"
    });
    expect(detectMeetingSource({ filename: "meeting.pdf" })).toMatchObject({
      capability: "supported",
      conversionMode: "local",
      extractionMethod: "local-pdf",
      sourceType: "pdf"
    });
    expect(detectMeetingSource({ filename: "whiteboard.png" })).toMatchObject({
      capability: "provider_required",
      conversionMode: "provider_required",
      extractionMethod: "provider-required",
      requiredProvider: "ocr_or_vision",
      sourceType: "image"
    });
    expect(detectMeetingSource({ filename: "actions.csv" })).toMatchObject({
      capability: "supported",
      conversionMode: "local",
      extractionMethod: "local-csv",
      sourceType: "csv"
    });
    expect(detectMeetingSource({ filename: "deck.pptx" })).toMatchObject({
      capability: "unsupported",
      conversionMode: "unsupported",
      extractionMethod: "unavailable",
      requiredProvider: "document_conversion",
      sourceType: "pptx"
    });
  });

  it("extracts real text from text-based PDFs", async () => {
    const extracted = await extractMeetingText({
      fileBase64: pdfFixtureBase64,
      filename: "meeting.pdf",
      mimeType: "application/pdf"
    });

    expect(extracted.rawText).toContain("Action: send SOW by 2030-04-05.");
    expect(extracted.metadata).toMatchObject({
      conversionMode: "local",
      extractionMethod: "local-pdf",
      pageCount: 1,
      processor: "local-pdf",
      processorCapability: "supported",
      sourceType: "pdf"
    });
    expect(extracted.warnings).toEqual([]);
  });

  it("fails scanned PDFs with an OCR provider-required message instead of fake text", async () => {
    await expect(
      extractMeetingText({
        fileBase64: scannedPdfFixtureBase64,
        filename: "scanned-meeting.pdf",
        mimeType: "application/pdf"
      })
    ).rejects.toThrow(/OCR or vision provider integration is required for scanned PDFs/);
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
    expect(extracted.metadata).toMatchObject({
      conversionMode: "local",
      extractionMethod: "local-docx",
      processor: "local-docx",
      processorCapability: "supported",
      sourceType: "docx"
    });
  });

  it("fails DOCX extraction clearly when file content is missing", async () => {
    await expect(
      extractMeetingText({
        filename: "meeting.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      })
    ).rejects.toThrow(/DOCX extraction requires uploaded DOCX file content/);
  });

  it("extracts RTF notes locally into readable text with metadata warnings", async () => {
    const extracted = await extractMeetingText({
      fileText: "{\\rtf1\\ansi\\b Meeting date:\\b0{} 2030-04-01\\par Action: send SOW by 2030-04-05.}",
      filename: "meeting.rtf",
      mimeType: "application/rtf"
    });

    expect(extracted.rawText).toContain("Meeting date: 2030-04-01");
    expect(extracted.rawText).toContain("Action: send SOW by 2030-04-05.");
    expect(extracted.metadata).toMatchObject({
      conversionMode: "local",
      extractionMethod: "local-rtf",
      processor: "local-rtf",
      sourceType: "rtf"
    });
    expect(extracted.warnings).toContain("RTF formatting was flattened to plain markdown-like text.");
  });

  it("extracts HTML meeting summaries locally into markdown-like text", async () => {
    const extracted = await extractMeetingText({
      fileText: [
        "<html><head><style>.x{}</style></head><body>",
        "<h1>Discovery Recap</h1><p>Decision: approve WMS discovery.</p>",
        "<ul><li>Action: schedule UAT workshop by 2030-04-05.</li></ul>",
        "<script>window.secret = true;</script></body></html>"
      ].join(""),
      filename: "summary.html",
      mimeType: "text/html"
    });

    expect(extracted.rawText).toContain("# Discovery Recap");
    expect(extracted.rawText).toContain("Decision: approve WMS discovery.");
    expect(extracted.rawText).toContain("- Action: schedule UAT workshop by 2030-04-05.");
    expect(extracted.rawText).not.toContain("window.secret");
    expect(extracted.metadata).toMatchObject({ extractionMethod: "local-html", sourceType: "html" });
    expect(extracted.warnings).toContain("Script, style, and non-content HTML blocks were ignored.");
  });

  it("extracts CSV action trackers locally into markdown tables", async () => {
    const extracted = await extractMeetingText({
      fileText: "Owner,Action,Due\nSam,send SOW,2030-04-05\nLee,schedule UAT,2030-04-06",
      filename: "actions.csv",
      mimeType: "text/csv"
    });

    expect(extracted.rawText).toContain("| Owner | Action | Due |");
    expect(extracted.rawText).toContain("| Sam | send SOW | 2030-04-05 |");
    expect(extracted.metadata).toMatchObject({ extractionMethod: "local-csv", sourceType: "csv" });
    expect(extracted.warnings).toEqual([]);
  });

  it("extracts JSON meeting exports locally into readable markdown", async () => {
    const extracted = await extractMeetingText({
      fileText: JSON.stringify({
        action_items: [
          { due: "2030-04-05", owner: "Sam", task: "send SOW" },
          { due: "2030-04-06", owner: "Lee", task: "schedule UAT" }
        ],
        meeting_date: "2030-04-01",
        summary: "Current WMS has inventory pain."
      }),
      filename: "meeting.json",
      mimeType: "application/json"
    });

    expect(extracted.rawText).toContain("- **Meeting Date:** 2030-04-01");
    expect(extracted.rawText).toContain("## Action Items");
    expect(extracted.rawText).toContain("| due | owner | task |");
    expect(extracted.metadata).toMatchObject({ extractionMethod: "local-json", sourceType: "json" });
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
    expect(normalized.markdown).toContain("Meeting date: 2030-04-01");
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
    expect(draft.meetingActivity?.associatedTargets).toEqual([{ id: "deal-1", label: "Alpha Needle Deal", type: "deal" }]);
    expect(draft.meetingActivity?.description).toContain("Associated CRM records:");
    expect(draft.notes[0]).toMatchObject({ include: true, target: { id: "deal-1", type: "deal" } });
    expect(draft.notes[0].body).toContain("Target: Deal - Alpha Needle Deal");
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
