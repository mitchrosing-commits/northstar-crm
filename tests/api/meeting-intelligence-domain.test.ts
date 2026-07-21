import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/responses";
import { analyzeMeetingIntelligence } from "@/lib/meeting-intelligence/analyze";
import { extractMeetingText } from "@/lib/meeting-intelligence/extractors";
import { normalizeMeetingMarkdown } from "@/lib/meeting-intelligence/markdown-normalizer";
import { createConfiguredMeetingMediaProvider, getMeetingMediaProviderReadiness } from "@/lib/meeting-intelligence/media-providers";
import { deterministicMeetingAnalysisProvider } from "@/lib/meeting-intelligence/providers";
import {
  buildSemanticRelationshipBriefPrompt,
  createOpenAISemanticRelationshipBriefProvider,
  parseSemanticRelationshipProviderJson,
  relationshipSemanticExtractionReadiness
} from "@/lib/meeting-intelligence/relationship-semantic-provider";
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

  it("can route scanned PDFs through an injected OCR provider without faking local text", async () => {
    const extracted = await extractMeetingText(
      {
        explicitSourceType: "pdf",
        fileBase64: scannedPdfFixtureBase64,
        filename: "scanned-meeting.pdf",
        mimeType: "application/pdf"
      },
      {
        mediaProvider: {
          id: "test-pdf-ocr",
          name: "Test PDF OCR provider",
          supports: (candidate) => candidate === "pdf",
          async extract(input) {
            expect(input.sourceType).toBe("pdf");
            expect(input.mimeType).toBe("application/pdf");
            return {
              providerId: "test-pdf-ocr",
              providerName: "Test PDF OCR provider",
              text: "Scanned PDF notes.\nAction: send SOW by 2030-04-05.",
              warnings: ["OCR confidence medium."]
            };
          }
        },
        preferMediaProvider: true,
        providerSourceType: "pdf"
      }
    );

    expect(extracted.rawText).toContain("Action: send SOW by 2030-04-05.");
    expect(extracted.metadata).toMatchObject({
      conversionMode: "provider_required",
      extractionMethod: "provider-ocr",
      providerId: "test-pdf-ocr",
      providerName: "Test PDF OCR provider",
      requiredProvider: "ocr_or_vision",
      sourceType: "pdf"
    });
    expect(extracted.warnings).toEqual(["OCR confidence medium."]);
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
    expect(draft.meetingActivity?.description).toContain("Structured meeting summary:");
    expect(draft.meetingActivity?.description).toContain("Source attribution: Meeting Intelligence reviewed intake.");
    expect(draft.meetingActivity?.description).not.toContain("Source meeting markdown:");
    expect(draft.summarySections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "context", title: "Context" }),
        expect.objectContaining({ key: "key_facts", title: "Key facts" }),
        expect.objectContaining({ key: "decisions", title: "Decisions" }),
        expect.objectContaining({ key: "next_steps", title: "Next steps" })
      ])
    );
    expect(draft.summarySections?.find((section) => section.key === "concerns_or_risks")?.items ?? []).not.toContain(
      "Budget is approved and legal needs the SOW."
    );
    expect(draft.notes[0]).toMatchObject({ include: true, target: { id: "deal-1", type: "deal" } });
    expect(draft.notes[0].body).toContain("Target: Deal - Alpha Needle Deal");
    expect(draft.notes[0].body).toContain("Source: Meeting Intelligence reviewed intake (2030-04-01).");
    expect(draft.notes[0].body).toContain("Evidence:");
    expect(draft.nextStepActivities[0]).toMatchObject({
      dueAt: "2030-04-05T00:00:00.000Z",
      include: true,
      title: "Send SOW",
      type: "EMAIL"
    });
    expect(draft.nextStepActivities[0].description).toContain("Owner hint: Sam");
    expect(draft.nextStepActivities[0].description).toContain("Due date supported by source: 2030-04-05");
  });

  it("segments transcript review text and leaves weak associations unselected", () => {
    const sourceMetadata = {
      processor: "provider-http",
      providerName: "Configured media extraction provider",
      sourceType: "audio" as const,
      transcriptionConfidence: "low" as const,
      warnings: ["Speaker label confidence is low."]
    };
    const normalized = normalizeMeetingMarkdown({
      contextText: "Meeting date: 2030-04-01\nAttendees: Jordan Lee, Jordan Li, Casey Ray",
      metadata: sourceMetadata,
      rawText: [
        "[00:01] Jordan Lee: My title is VP Operations.",
        "[00:42] Jordan Li: That was not me; I joined only for implementation questions.",
        "[01:10] Casey Ray: My email is casey.ray@example.test."
      ].join("\n"),
      sourceType: "audio"
    });
    const draft = analyzeMeetingIntelligence({
      contextText: "Meeting date: 2030-04-01\nAttendees: Jordan Lee, Jordan Li, Casey Ray",
      markdown: normalized.markdown,
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Jordan Lee",
          evidenceExcerpt: "Jordan Lee: My title is VP Operations.",
          id: "person-jordan-lee",
          matchedReason: "Exact name match",
          objectType: "person"
        },
        {
          confidence: "ambiguous",
          displayName: "Jordan Li",
          evidenceExcerpt: "Jordan Li",
          id: "person-jordan-li",
          matchedReason: "Similar attendee name",
          objectType: "person",
          warning: "Multiple contacts have similar names."
        },
        {
          confidence: "low",
          displayName: "Casey Ray",
          evidenceExcerpt: "Casey Ray",
          id: "person-casey-ray",
          matchedReason: "Weak partial name match",
          objectType: "person",
          warning: "Only a weak name signal was available."
        }
      ],
      sourceMetadata,
      unmatchedEntities: [
        {
          entityType: "organization",
          evidenceExcerpt: "Casey Ray mentioned NewCo Logistics.",
          name: "NewCo Logistics",
          reason: "No reliable CRM organization match."
        }
      ]
    });

    expect(draft.transcriptSegments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ speaker: "Jordan Lee", startTime: "00:01", text: "My title is VP Operations." }),
        expect.objectContaining({ speaker: "Jordan Li", startTime: "00:42" })
      ])
    );
    expect(draft.transcriptSegments?.find((segment) => segment.speaker === "Jordan Lee")?.warnings).toEqual(
      expect.arrayContaining([
        "Low transcription confidence. Verify this segment before using it as CRM evidence.",
        "Speaker label confidence is low."
      ])
    );
    expect(draft.warnings).toContain("Transcription confidence is low. Review speaker labels and source snippets before applying CRM updates.");
    expect(draft.associationReviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mention: "Jordan Lee", selectedTarget: { id: "person-jordan-lee", label: "Jordan Lee", type: "person" } }),
        expect.objectContaining({ mention: "Jordan Li", confidence: "ambiguous", selectedTarget: null }),
        expect.objectContaining({ mention: "Casey Ray", confidence: "low", selectedTarget: null }),
        expect.objectContaining({ mention: "NewCo Logistics", confidence: "unmatched", selectedTarget: null, targetType: "organization" })
      ])
    );
  });

  it("proposes review-first Relationship Brief updates only for matched contacts with explicit safe facts", () => {
    const draft = analyzeMeetingIntelligence({
      contextText: "Meeting date: 2030-04-01",
      markdown: [
        "# Meeting Intake",
        "Jane Contact is a Rockies fan and mentioned a Colorado trip with her kids.",
        "Jane Contact prefers short, concrete follow-up emails.",
        "Jane Contact is concerned about switching costs and implementation disruption.",
        "Next personal follow-up: ask how the Colorado trip went.",
        "Jane Contact mentioned church plans this weekend.",
        "Alpha Needle Deal has approved budget."
      ].join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Jane Contact",
          evidenceExcerpt: "Jane Contact",
          id: "person-1",
          matchedReason: "Contact name match",
          objectType: "person"
        },
        {
          confidence: "high",
          displayName: "Alpha Needle Deal",
          evidenceExcerpt: "Alpha Needle Deal",
          id: "deal-1",
          matchedReason: "Deal title match",
          objectType: "deal",
          status: "OPEN"
        },
        {
          confidence: "ambiguous",
          displayName: "Jane C.",
          evidenceExcerpt: "Jane",
          id: "person-2",
          matchedReason: "Ambiguous contact name",
          objectType: "person"
        }
      ],
      unmatchedEntities: []
    });

    const updates = draft.relationshipBriefUpdates ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      confidence: "high",
      include: true,
      matchedReason: "Contact name match",
      target: { id: "person-1", label: "Jane Contact", type: "person" }
    });
    expect(updates[0].proposed.relationshipPersonalContext).toContain("Rockies fan");
    expect(updates[0].proposed.relationshipCommunicationStyle).toContain("prefers short, concrete follow-up emails");
    expect(updates[0].proposed.relationshipBusinessConcerns).toContain("switching costs");
    expect(updates[0].proposed.relationshipFollowUpReminders).toContain("ask how the Colorado trip went");
    expect(updates[0].proposed.relationshipInternalGuidance).toContain("Use personal context naturally");
    expect(JSON.stringify(updates[0].proposed)).not.toContain("church");
    expect(updates.some((update) => update.target?.id === "deal-1")).toBe(false);
    expect(updates.some((update) => update.target?.id === "person-2")).toBe(false);
  });

  it("does not create noisy empty Relationship Brief proposals", () => {
    const draft = analyzeMeetingIntelligence({
      markdown: "Jane Contact reviewed the agenda and confirmed attendance.",
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Jane Contact",
          evidenceExcerpt: "Jane Contact",
          id: "person-1",
          matchedReason: "Contact name match",
          objectType: "person"
        }
      ],
      unmatchedEntities: []
    });

    expect(draft.relationshipBriefUpdates).toEqual([]);
  });

  it("keeps semantic Relationship Brief extraction provider-gated with deterministic fallback readiness", () => {
    expect(relationshipSemanticExtractionReadiness({})).toMatchObject({
      configured: false,
      missingEnvNames: ["MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER"],
      providerId: "none"
    });
    expect(relationshipSemanticExtractionReadiness({ MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER: "openai" })).toMatchObject({
      configured: false,
      missingEnvNames: ["OPENAI_API_KEY"],
      providerId: "openai"
    });
    expect(
      relationshipSemanticExtractionReadiness({
        MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key"
      })
    ).toMatchObject({
      configured: true,
      missingEnvNames: [],
      providerId: "openai"
    });
  });

  it("builds and parses guarded semantic Relationship Brief provider output", () => {
    const input = semanticRelationshipInput();
    const prompt = buildSemanticRelationshipBriefPrompt(input);

    expect(prompt.system).toContain("Do not infer religion, politics, health");
    expect(prompt.system).toContain("safe_personalization");
    expect(prompt.user).toContain("Jane Contact");
    expect(prompt.user).toContain("targetPersonId");
    expect(prompt.user).toContain("facts");

    const parsed = parseSemanticRelationshipProviderJson(
      JSON.stringify({
        proposals: [
          {
            confidence: "high",
            evidence: ["Jane is a Rockies fan and prefers concise emails."],
            facts: [
              {
                field: "relationshipPersonalContext",
                sensitivity: [
                  {
                    category: "safe_personalization",
                    field: "relationshipPersonalContext",
                    guidance: "Use naturally and sparingly."
                  }
                ],
                text: "Jane is a Rockies fan."
              },
              {
                field: "relationshipCommunicationStyle",
                text: "Prefers concise emails with clear next steps."
              },
              {
                field: "relationshipInternalGuidance",
                text: "Mention church plans directly."
              }
            ],
            proposed: {
              relationshipCommunicationStyle: "Prefers concise emails with clear next steps.",
              relationshipInternalGuidance: "Mention church plans directly.",
              relationshipPersonalContext: "Jane is a Rockies fan."
            },
            sensitivity: [
              {
                category: "safe_personalization",
                field: "relationshipPersonalContext",
                guidance: "Use naturally and sparingly."
              },
              {
                category: "use_cautiously",
                field: "relationshipCommunicationStyle",
                guidance: "Keep follow-up concise."
              }
            ],
            targetPersonId: "person-1",
            warnings: ["Use personal context lightly."]
          },
          {
            proposed: { relationshipPersonalContext: "Unsupported target fact." },
            targetPersonId: "person-missing"
          }
        ],
        warnings: ["Provider caution."]
      }),
      input
    );

    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0]).toMatchObject({
      confidence: "high",
      providerId: "openai",
      target: { id: "person-1", type: "person" }
    });
    expect(parsed.proposals[0].proposed.relationshipPersonalContext).toBe("Jane is a Rockies fan.");
    expect(parsed.proposals[0].proposed.relationshipCommunicationStyle).toBe("Prefers concise emails with clear next steps.");
    expect(parsed.proposals[0].proposed.relationshipInternalGuidance).toBeUndefined();
    expect(parsed.proposals[0].facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "relationshipPersonalContext",
          sensitivity: expect.arrayContaining([expect.objectContaining({ category: "safe_personalization" })]),
          text: "Jane is a Rockies fan."
        }),
        expect.objectContaining({
          field: "relationshipCommunicationStyle",
          text: "Prefers concise emails with clear next steps."
        })
      ])
    );
    expect(parsed.proposals[0].facts?.some((fact) => fact.text.includes("church"))).toBe(false);
    expect(parsed.proposals[0].sensitivity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "safe_personalization" }),
        expect.objectContaining({ category: "use_cautiously" })
      ])
    );
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        "Provider caution.",
        "Protected or sensitive trait detail was excluded from a semantic Relationship Brief fact.",
        "Protected or sensitive trait detail was excluded from a semantic Relationship Brief proposal.",
        "Semantic relationship proposal targeted an unavailable contact and was ignored."
      ])
    );
  });

  it("parses mocked OpenAI semantic Relationship Brief responses without calling providers in fallback mode", async () => {
    const provider = createOpenAISemanticRelationshipBriefProvider(
      {
        MEETING_INTELLIGENCE_RELATIONSHIP_PROVIDER: "openai",
        OPENAI_API_KEY: "openai-test-key"
      },
      (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.input[0].content).toContain("Northstar CRM's semantic Relationship Brief extractor");
        expect(body.input[1].content).toContain("Jane Contact");
        return Response.json({
          output_text: JSON.stringify({
            proposals: [
              {
                confidence: "medium",
                evidence: ["Jane prefers clear follow-up emails."],
                proposed: { relationshipCommunicationStyle: "Prefers clear follow-up emails." },
                sensitivity: [{ category: "safe_personalization", guidance: "Use to shape concise follow-up." }],
                targetPersonId: "person-1"
              }
            ]
          })
        });
      }) as typeof fetch
    );

    await expect(provider?.extract(semanticRelationshipInput())).resolves.toMatchObject({
      proposals: [
        expect.objectContaining({
          proposed: { relationshipCommunicationStyle: "Prefers clear follow-up emails." },
          providerName: "OpenAI relationship extraction"
        })
      ]
    });
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
    const ownerAction = draft.nextStepActivities.find((activity) => activity.title === "Schedule UAT workshop");
    expect(ownerAction).toMatchObject({
      confidence: "high",
      matchedReason: "Context hint match",
      type: "MEETING"
    });
    expect(ownerAction?.evidence).toContain("Action: Owner: Lee. schedule UAT workshop by next week.");
    expect(draft.warnings).not.toContain("No deal or lead was confidently matched.");
  });

  it("routes noteworthy facts to Relationship Briefs or object-specific notes without forcing everything onto contacts", () => {
    const draft = analyzeMeetingIntelligence({
      markdown: [
        "# Meeting Intake",
        "Jane Contact is a Rockies fan and mentioned her kids play soccer.",
        "Jane Contact prefers concise morning emails.",
        "Alpha Orbit Organization is replacing its WMS and has inventory pain across 4 DCs.",
        "Alpha Needle Deal has legal approval risk and a SOW timeline concern.",
        "Alpha Expansion Lead has strong pilot interest and a qualification timeline.",
        "Action: send recap by 2030-04-05."
      ].join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Jane Contact",
          evidenceExcerpt: "Jane Contact",
          id: "person-1",
          matchedReason: "Exact name match",
          objectType: "person"
        },
        {
          confidence: "high",
          displayName: "Alpha Orbit Organization",
          evidenceExcerpt: "Alpha Orbit Organization",
          id: "org-1",
          matchedReason: "Exact organization match",
          objectType: "organization"
        },
        {
          confidence: "high",
          displayName: "Alpha Needle Deal",
          evidenceExcerpt: "Alpha Needle Deal",
          id: "deal-1",
          matchedReason: "Deal title match",
          objectType: "deal",
          status: "OPEN"
        },
        {
          confidence: "high",
          displayName: "Alpha Expansion Lead",
          evidenceExcerpt: "Alpha Expansion Lead",
          id: "lead-1",
          matchedReason: "Lead title match",
          objectType: "lead",
          status: "NEW"
        }
      ],
      unmatchedEntities: []
    });
    const personNote = draft.notes.find((note) => note.target?.id === "person-1");
    const organizationNote = draft.notes.find((note) => note.target?.id === "org-1");
    const dealNote = draft.notes.find((note) => note.target?.id === "deal-1");
    const leadNote = draft.notes.find((note) => note.target?.id === "lead-1");

    expect(personNote).toMatchObject({ kind: "personal_fact", target: { type: "person" } });
    expect(personNote?.body).toContain("kids play soccer");
    expect(organizationNote).toMatchObject({ kind: "company_fact", target: { type: "organization" } });
    expect(organizationNote?.body).toContain("replacing its WMS");
    expect(organizationNote?.body).not.toContain("legal approval risk");
    expect(dealNote).toMatchObject({ kind: "deal_fact", target: { type: "deal" } });
    expect(dealNote?.body).toContain("SOW timeline concern");
    expect(dealNote?.body).not.toContain("replacing its WMS");
    expect(leadNote).toMatchObject({ kind: "lead_fact", target: { type: "lead" } });
    expect(leadNote?.body).toContain("qualification timeline");
    expect(draft.relationshipBriefUpdates).toEqual([
      expect.objectContaining({
        proposed: expect.objectContaining({
          relationshipCommunicationStyle: expect.stringContaining("prefers concise morning emails"),
          relationshipPersonalContext: expect.stringContaining("kids play soccer")
        }),
        target: { id: "person-1", label: "Jane Contact", type: "person" }
      })
    ]);
  });

  it("separates relationship-intelligence proposal categories and summarizes raw transcript lines", () => {
    const draft = analyzeMeetingIntelligence({
      markdown: [
        "# Meeting Intake",
        "Jane Contact: I will be traveling to France with family in about three weeks.",
        "Jane Contact prefers concise morning emails.",
        "Jane Contact is the economic buyer for the rollout.",
        "Alpha Orbit Organization is replacing its WMS and has inventory pain across 4 DCs.",
        "Alpha Needle Deal has approved budget, legal review risk, and a SOW timeline concern.",
        "Action: send recap and pricing by 2030-04-05."
      ].join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Jane Contact",
          evidenceExcerpt: "Jane Contact",
          id: "person-1",
          matchedReason: "Exact name match",
          objectType: "person"
        },
        {
          confidence: "high",
          displayName: "Alpha Orbit Organization",
          evidenceExcerpt: "Alpha Orbit Organization",
          id: "org-1",
          matchedReason: "Exact organization match",
          objectType: "organization"
        },
        {
          confidence: "high",
          displayName: "Alpha Needle Deal",
          evidenceExcerpt: "Alpha Needle Deal",
          id: "deal-1",
          matchedReason: "Deal title match",
          objectType: "deal",
          status: "OPEN"
        }
      ],
      unmatchedEntities: [{ entityType: "unknown", evidenceExcerpt: "France", name: "France", reason: "Not a CRM record." }]
    });
    const relationshipText = JSON.stringify(draft.relationshipBriefUpdates?.[0]?.proposed ?? {});
    const personalFacts = draft.relationshipBriefUpdates?.[0]?.facts ?? [];
    const organizationNote = draft.notes.find((note) => note.category === "organizationFact");
    const dealNote = draft.notes.find((note) => note.category === "dealFact");
    const stakeholderNote = draft.notes.find((note) => note.category === "stakeholderNote");

    expect(draft.relationshipBriefUpdates?.[0]).toMatchObject({
      target: { id: "person-1", type: "person" }
    });
    expect(draft.relationshipBriefUpdates?.[0]?.proposed.relationshipPersonalContext).toContain(
      "Jane Contact mentioned they will be traveling to France with family in about three weeks."
    );
    expect(relationshipText).not.toContain("Jane Contact:");
    expect(relationshipText).not.toContain("WMS");
    expect(relationshipText).not.toContain("SOW");
    expect(relationshipText).not.toContain("economic buyer");
    expect(personalFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "personFact", field: "relationshipPersonalContext" }),
        expect.objectContaining({ category: "personFact", field: "relationshipCommunicationStyle" })
      ])
    );
    expect(organizationNote).toMatchObject({ kind: "company_fact", target: { id: "org-1", type: "organization" } });
    expect(dealNote).toMatchObject({ kind: "deal_fact", target: { id: "deal-1", type: "deal" } });
    expect(stakeholderNote).toMatchObject({ kind: "stakeholder_note", target: { id: "person-1", type: "person" } });
    expect(draft.nextStepActivities[0]).toMatchObject({
      category: "followUpAction",
      target: { id: "deal-1", type: "deal" }
    });
    expect(draft.warnings).toContain("Some mentioned entities were not matched to CRM records.");
  });

  it("cleans titles, sections, implicit actions, due dates, uncertainty, and duplicate review ids", () => {
    const draft = analyzeMeetingIntelligence({
      contextText: "Meeting date: 2030-04-01\nAttendees: Jane Contact, Sam Seller",
      markdown: [
        "# Meeting Intake",
        "Goal: WMS rollout planning and pricing recap.",
        "Decision: approved discovery.",
        "Concern: legal review may block the SOW timeline.",
        "Jane Contact is the economic buyer.",
        "Jane Contact prefers concise morning emails.",
        "Sam Seller to send pricing recap by April 5.",
        "Jane Contact should schedule UAT workshop.",
        "Action: maybe consider future optimization options."
      ].join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Jane Contact",
          evidenceExcerpt: "Jane Contact",
          id: "person-1",
          matchedReason: "Exact name match",
          objectType: "person"
        },
        {
          confidence: "high",
          displayName: "Alpha Needle Deal",
          evidenceExcerpt: "Alpha Needle Deal",
          id: "deal-1",
          matchedReason: "Deal title match",
          objectType: "deal",
          status: "OPEN"
        }
      ],
      unmatchedEntities: []
    });

    expect(draft.meetingActivity?.title).toBe("2030-04-01 - WMS rollout planning and pricing recap with Alpha Needle Deal");
    expect(draft.summarySections?.map((section) => section.title)).toEqual(
      expect.arrayContaining(["Context", "Participants", "Key facts", "Decisions", "Concerns or risks", "Next steps"])
    );
    expect(draft.summarySections?.find((section) => section.key === "key_facts")?.items.join(" ")).not.toContain(
      "economic buyer"
    );
    expect(draft.summarySections?.find((section) => section.key === "concerns_or_risks")?.items).toContain(
      "legal review may block the SOW timeline."
    );
    expect(draft.nextStepActivities.map((activity) => activity.title)).toEqual([
      "Send pricing recap",
      "Schedule UAT workshop"
    ]);
    expect(draft.nextStepActivities[0]).toMatchObject({
      dueAt: "2030-04-05T00:00:00.000Z",
      type: "EMAIL"
    });
    expect(draft.nextStepActivities[1]).toMatchObject({
      dueAt: undefined,
      type: "MEETING"
    });
    expect(draft.nextStepActivities[1]?.description).toContain("Due date not stated clearly");
    expect(draft.nextStepActivities.map((activity) => activity.title).join(" ")).not.toContain("maybe consider");

    const noteIds = draft.notes.map((note) => note.id);
    expect(new Set(noteIds).size).toBe(noteIds.length);
    expect(draft.notes.some((note) => note.kind === "stakeholder_note")).toBe(true);
    expect(draft.relationshipBriefUpdates?.[0]?.proposed.relationshipCommunicationStyle).toContain("prefers concise morning emails");
  });

  it("excludes protected-trait lines from curated Relationship Brief and fact-note suggestions", () => {
    const draft = analyzeMeetingIntelligence({
      markdown: [
        "# Meeting Intake",
        "Jane Contact discussed religion during the meeting.",
        "Jane Contact prefers concise morning emails.",
        "Action: send recap by 2030-04-05."
      ].join("\n"),
      matchedObjects: [
        {
          confidence: "high",
          displayName: "Jane Contact",
          evidenceExcerpt: "Jane Contact",
          id: "person-1",
          matchedReason: "Exact name match",
          objectType: "person"
        }
      ],
      unmatchedEntities: []
    });
    const curatedSuggestions = JSON.stringify({
      notes: draft.notes,
      relationshipBriefUpdates: draft.relationshipBriefUpdates,
      summary: draft.summary
    });

    expect(draft.warnings).toContain("Protected or sensitive trait details were excluded from curated Relationship Brief and fact-note suggestions.");
    expect(curatedSuggestions).not.toContain("religion");
    expect(draft.relationshipBriefUpdates?.[0]?.proposed.relationshipCommunicationStyle).toContain("prefers concise morning emails");
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

  it("deduplicates repeated next steps and avoids vague suggestions as activities", () => {
    const draft = analyzeMeetingIntelligence({
      contextText: "Meeting date: 2030-04-01",
      markdown: [
        "# Meeting Intake",
        "Action: Owner: Sam. send SOW by 2030-04-05.",
        "Action: Owner: Sam. send SOW by 2030-04-05.",
        "Action: maybe consider pricing options.",
        "Action: schedule UAT workshop by next week."
      ].join("\n"),
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

    expect(draft.nextStepActivities.map((activity) => activity.title)).toEqual([
      "Send SOW",
      "Schedule UAT workshop"
    ]);
    expect(draft.nextStepActivities[1]?.dueAt).toBe("2030-04-08T00:00:00.000Z");
  });
});

function semanticRelationshipInput() {
  return {
    contacts: [
      {
        confidence: "high" as const,
        evidenceExcerpt: "Jane Contact",
        id: "person-1",
        label: "Jane Contact",
        matchedReason: "Exact name match"
      }
    ],
    markdown: [
      "# Meeting Intake",
      "Jane Contact is a Rockies fan and mentioned taking her kids to Colorado.",
      "Jane Contact prefers concise follow-up emails with clear next steps."
    ].join("\n"),
    matchedObjects: [
      {
        confidence: "high" as const,
        displayName: "Jane Contact",
        evidenceExcerpt: "Jane Contact",
        id: "person-1",
        matchedReason: "Exact name match",
        objectType: "person" as const
      }
    ],
    unmatchedEntities: []
  };
}

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
