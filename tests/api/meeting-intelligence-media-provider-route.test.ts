import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/internal/meeting-intelligence/media-extract/route";

const routeUrl = "http://localhost/api/internal/meeting-intelligence/media-extract";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("internal Meeting Intelligence media extraction route", () => {
  it("rejects missing and invalid internal bearer tokens", async () => {
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", "internal-media-token");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");

    await expectJsonResponse(
      await POST(
        new Request(routeUrl, {
          method: "POST",
          body: JSON.stringify({ fileBase64: "ZmFrZQ==", sourceType: "image" })
        })
      ),
      401,
      "UNAUTHORIZED"
    );

    await expectJsonResponse(
      await POST(
        new Request(routeUrl, {
          method: "POST",
          headers: { Authorization: "Bearer wrong-token" },
          body: JSON.stringify({ fileBase64: "ZmFrZQ==", sourceType: "image" })
        })
      ),
      401,
      "UNAUTHORIZED"
    );
  });

  it("returns a clear provider-not-configured response when OpenAI is missing", async () => {
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", "internal-media-token");
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER", "openai");

    const response = await postMediaExtract({
      fileBase64: Buffer.from("fake-image").toString("base64"),
      filename: "whiteboard.png",
      mimeType: "image/png",
      sourceType: "image"
    });

    await expectJsonResponse(response, 503, "MEETING_INTAKE_PROVIDER_NOT_CONFIGURED", /OPENAI_API_KEY/);
  });

  it("uses OpenAI vision for image and whiteboard extraction with a mocked provider call", async () => {
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", "internal-media-token");
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    const mediaBase64 = Buffer.from("fake-whiteboard").toString("base64");

    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer openai-test-key",
        "Content-Type": "application/json"
      });
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("gpt-5.5");
      expect(body.input[0].content[1]).toMatchObject({
        type: "input_image",
        image_url: `data:image/png;base64,${mediaBase64}`
      });
      return Response.json({
        output_text: "## Whiteboard notes\nAction: send SOW by 2030-04-05."
      });
    });

    const response = await postMediaExtract({
      fileBase64: mediaBase64,
      filename: "whiteboard.png",
      mimeType: "image/png",
      sourceType: "image"
    });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      markdown: "## Whiteboard notes\nAction: send SOW by 2030-04-05.",
      providerId: "openai",
      providerName: "OpenAI media extraction"
    });
  });

  it("uses OpenAI transcription for audio extraction with a mocked provider call", async () => {
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", "internal-media-token");
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");

    vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/audio/transcriptions");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer openai-test-key" });
      const formData = init?.body as FormData;
      expect(formData.get("model")).toBe("gpt-4o-transcribe");
      expect(formData.get("response_format")).toBe("json");
      const file = formData.get("file");
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe("call.mp3");
      return Response.json({ text: "Transcript: Action: schedule UAT workshop by 2030-04-05." });
    });

    const response = await postMediaExtract({
      fileBase64: Buffer.from("fake-audio").toString("base64"),
      filename: "call.mp3",
      mimeType: "audio/mpeg",
      sourceType: "audio"
    });
    const body = await readJson<Record<string, unknown>>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      markdown: "Transcript: Action: schedule UAT workshop by 2030-04-05.",
      providerId: "openai",
      providerName: "OpenAI media extraction"
    });
  });

  it("keeps video unsupported on the internal OpenAI route without calling a provider", async () => {
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER_TOKEN", "internal-media-token");
    vi.stubEnv("MEETING_INTELLIGENCE_MEDIA_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await postMediaExtract({
      fileBase64: Buffer.from("fake-video").toString("base64"),
      filename: "recording.mp4",
      mimeType: "video/mp4",
      sourceType: "video"
    });

    await expectJsonResponse(response, 422, "MEETING_INTAKE_PROVIDER_UNSUPPORTED_MEDIA", /does not process video yet/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

async function postMediaExtract(body: unknown) {
  return POST(
    new Request(routeUrl, {
      method: "POST",
      headers: {
        Authorization: "Bearer internal-media-token",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    })
  );
}

async function expectJsonResponse(response: Response, status: number, code: string, message?: RegExp) {
  const body = await readJson<{ error: { code: string; message: string } }>(response);
  expect(response.status).toBe(status);
  expect(body.error.code).toBe(code);
  if (message) expect(body.error.message).toMatch(message);
}

async function readJson<T>(response: Response) {
  return JSON.parse(await response.text()) as T;
}
