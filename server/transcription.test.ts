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

/* A real 1-second 440Hz OGG/Opus clip (ffmpeg: sine -> libopus), the same container/codec
 * Telegram produces for voice notes. Base64 keeps the test self-contained and binary-safe. */
const VOICE_NOTE_OGG_BASE64 = "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";
const voiceNoteOgg = Buffer.from(VOICE_NOTE_OGG_BASE64, "base64");

describe("Voice transcription", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    spies.env.transcriptionApiKey = "key-123";
    spies.env.transcriptionApiBaseUrl = "https://api.example.com/v1";
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

  it("repackages OGG voice notes as WAV when the provider is Pollinations (no documented OGG support)", async () => {
    spies.env.transcriptionApiBaseUrl = "https://gen.pollinations.ai/v1";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "hello from wav" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const text = await transcribeAudio(voiceNoteOgg, "audio/ogg", "voice-20260917090000.ogg");
    expect(text).toBe("hello from wav");

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo, { body: FormData }];
    const file = init.body.get("file") as File;
    expect(file.name).toBe("voice-20260917090000.wav");
    expect(file.type).toBe("audio/wav");
    const uploaded = Buffer.from(await file.arrayBuffer());
    expect(uploaded.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(uploaded.length).toBeGreaterThan(44 + voiceNoteOgg.length / 10); // real PCM payload, not the compressed original
  });

  it("sends the original OGG bytes unchanged when the provider is not Pollinations", async () => {
    spies.env.transcriptionApiBaseUrl = "https://api.example.com/v1";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: "hello" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await transcribeAudio(voiceNoteOgg, "audio/ogg", "voice.ogg");
    const [, init] = fetchMock.mock.calls[0] as [RequestInfo, { body: FormData }];
    const file = init.body.get("file") as File;
    expect(file.name).toBe("voice.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(Buffer.from(await file.arrayBuffer()).equals(voiceNoteOgg)).toBe(true);
  });

  it("throws a clear error when an OGG voice note cannot be decoded for Pollinations", async () => {
    spies.env.transcriptionApiBaseUrl = "https://gen.pollinations.ai/v1";
    await expect(transcribeAudio(Buffer.from("not really ogg"), "audio/ogg", "voice.ogg")).rejects.toThrow("could not be decoded");
  });
});
