import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generatePollinationsImage,
  generatedImageFileName,
  POLLINATIONS_IMAGE_MODEL,
} from "./imageGeneration";

describe("generatePollinationsImage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requests the configured community model and returns its image bytes", async () => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const fetchImpl = vi.fn(async () => new Response(bytes, {
      headers: { "content-type": "image/png" },
    }));

    const result = await generatePollinationsImage({
      prompt: "A little red fox",
      apiKey: "test-key",
      aspectRatio: "portrait",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [requestUrl, requestInit] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(requestUrl.origin).toBe("https://gen.pollinations.ai");
    expect(requestUrl.pathname).toBe(`/image/${encodeURIComponent("A little red fox")}`);
    expect(requestUrl.searchParams.get("model")).toBe(POLLINATIONS_IMAGE_MODEL);
    expect(requestUrl.searchParams.get("width")).toBe("768");
    expect(requestUrl.searchParams.get("height")).toBe("1024");
    expect(requestInit.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(result).toEqual({
      dataUri: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
      mimeType: "image/png",
      extension: "png",
    });
  });

  it("does not call Pollinations without a server API key", async () => {
    const fetchImpl = vi.fn();

    await expect(generatePollinationsImage({
      prompt: "A little red fox",
      apiKey: " ",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow("Image generation is not configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects provider errors and non-image responses", async () => {
    const failedFetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(generatePollinationsImage({
      prompt: "A fox",
      apiKey: "test-key",
      fetchImpl: failedFetch as unknown as typeof fetch,
    })).rejects.toThrow("Pollinations image generation failed (503)");

    const textFetch = vi.fn(async () => new Response("not an image", {
      headers: { "content-type": "text/plain" },
    }));
    await expect(generatePollinationsImage({
      prompt: "A fox",
      apiKey: "test-key",
      fetchImpl: textFetch as unknown as typeof fetch,
    })).rejects.toThrow("did not return a supported image");
  });

  it("maps a jpeg response to the jpg extension", async () => {
    const result = await generatePollinationsImage({
      prompt: "A fox",
      apiKey: "test-key",
      fetchImpl: vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      })) as unknown as typeof fetch,
    });
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.extension).toBe("jpg");
  });

  it("rejects an image larger than the storage cap", async () => {
    const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
    await expect(generatePollinationsImage({
      prompt: "A fox",
      apiKey: "test-key",
      fetchImpl: vi.fn(async () => new Response(oversized, {
        headers: { "content-type": "image/png" },
      })) as unknown as typeof fetch,
    })).rejects.toThrow("empty or oversized image");
  });
});

describe("generatedImageFileName", () => {
  it("derives a safe, timestamped, unique name from the prompt", () => {
    const at = new Date("2026-11-18T08:30:12Z").getTime();
    const name = generatedImageFileName("png", "  A red fox, in snow!  ", at);
    expect(name).toMatch(/^A-red-fox-in-snow-\d{14}-[a-z0-9]{5}\.png$/);
    expect(generatedImageFileName("png", "A red fox", at)).not.toBe(
      generatedImageFileName("png", "A red fox", at)
    );
  });

  it("falls back to a plain image name for an unusable prompt", () => {
    expect(generatedImageFileName("webp", "???", 0)).toMatch(
      /^image-\d{14}-[a-z0-9]{5}\.webp$/
    );
  });
});
