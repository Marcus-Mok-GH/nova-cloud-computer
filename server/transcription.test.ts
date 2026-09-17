import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  env: {
    transcriptionApiBaseUrl: "https://api.example.com/v1",
    transcriptionApiKey: "key-123",
    transcriptionModel: "whisper-1",
  },
}));

vi.mock("./_core/env", () => ({ ENV: spies.env }));

const { transcribeAudio, isTranscriptionConfigured } = await import("./transcription");

describe("Voice transcription", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    spies.env.transcriptionApiKey = "key-123";
  });

  it("returns null when transcription is not configured", async () => {
    spies.env.transcriptionApiKey = "";
    expect(isTranscriptionConfigured()).toBe(false);
    expect(await transcribeAudio(Buffer.from("abc"), "audio/ogg", "voice.ogg")).toBeNull();
  });

  it("posts the audio to the provider and returns the trimmed transcript", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "  book me a table for two  " }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const text = await transcribeAudio(Buffer.from("abc"), "audio/ogg", "voice.ogg");
    expect(text).toBe("book me a table for two");

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo, { headers: Record<string, string>; body: FormData }];
    expect(String(url)).toBe("https://api.example.com/v1/audio/transcriptions");
    expect(init.headers).toEqual({ authorization: "Bearer key-123" });
    expect(init.body.get("model")).toBe("whisper-1");
  });

  it("throws a clear error when the provider rejects the audio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "file too large" } }), { status: 400 })));
    await expect(transcribeAudio(Buffer.from("abc"), "audio/ogg", "voice.ogg")).rejects.toThrow("file too large");
  });

  it("throws when the provider returns no text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    await expect(transcribeAudio(Buffer.from("abc"), "audio/ogg", "voice.ogg")).rejects.toThrow("no text");
  });
});
