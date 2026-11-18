import { fileStamp } from "@shared/text";

export const POLLINATIONS_IMAGE_MODEL = "community/scriptsnsenses-sys/flux-2-dev-free";
const POLLINATIONS_IMAGE_ENDPOINT = "https://gen.pollinations.ai/image/";
const MAX_PROMPT_LENGTH = 2_000;
/**
 * Upper bound on a stored generation. The bytes are kept twice - once as the
 * workspace file, once in the chat row that renders the picture inline - so
 * the cap keeps a single turn from flooding the chat history. Typical
 * Pollinations PNGs at these sizes sit far below it.
 */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export type ImageAspectRatio = "square" | "landscape" | "portrait";

export type GeneratedImage = {
  dataUri: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  extension: "png" | "jpg" | "webp";
};

export async function generatePollinationsImage(options: {
  prompt: string;
  apiKey: string | undefined;
  aspectRatio?: ImageAspectRatio;
  fetchImpl?: typeof fetch;
}): Promise<GeneratedImage> {
  const prompt = options.prompt.trim();
  if (!options.apiKey?.trim()) {
    throw new Error("Image generation is not configured on this server.");
  }
  if (!prompt) throw new Error("A prompt is required to generate an image.");
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`The image prompt must be ${MAX_PROMPT_LENGTH} characters or less.`);
  }

  const dimensions = {
    square: [1024, 1024],
    landscape: [1024, 768],
    portrait: [768, 1024],
  } as const;
  const [width, height] = dimensions[options.aspectRatio ?? "square"];
  const url = new URL(`${encodeURIComponent(prompt)}`, POLLINATIONS_IMAGE_ENDPOINT);
  url.searchParams.set("model", POLLINATIONS_IMAGE_MODEL);
  url.searchParams.set("width", String(width));
  url.searchParams.set("height", String(height));
  url.searchParams.set("nologo", "true");

  const response = await (options.fetchImpl ?? fetch)(url, {
    headers: { Authorization: `Bearer ${options.apiKey.trim()}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    // Do not echo provider response bodies; they may contain operational data.
    throw new Error(`Pollinations image generation failed (${response.status}).`);
  }

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const formats = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  } as const;
  if (!mimeType || !(mimeType in formats)) {
    throw new Error("Pollinations did not return a supported image format.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Pollinations returned an empty or oversized image.");
  }

  const supportedMime = mimeType as keyof typeof formats;
  return {
    dataUri: `data:${supportedMime};base64,${Buffer.from(bytes).toString("base64")}`,
    mimeType: supportedMime,
    extension: formats[supportedMime],
  };
}

/**
 * A safe, sortable, near-unique workspace file name for a generated image,
 * e.g. `red-fox-20261118080000-a1b2c.png`. The prompt becomes part of the
 * name so the Files page still says what the picture was, and the random
 * suffix means two generations from one prompt never collide.
 */
export function generatedImageFileName(
  extension: string,
  prompt: string,
  atMs = Date.now()
): string {
  const stamp = fileStamp(atMs);
  const suffix = Math.random().toString(36).slice(2, 7);
  const base =
    prompt
      .replace(/\s+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 40) || "image";
  return `${base}-${stamp}-${suffix}.${extension}`;
}
