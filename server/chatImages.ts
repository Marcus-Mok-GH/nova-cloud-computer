/**
 * Helpers for the images a Nova web chat message can carry. The browser
 * downscales and encodes each image to a base64 data URI before sending it to
 * `/api/chat/stream`; these helpers validate that payload and turn it into a
 * workspace file name. This mirrors the Telegram upload path, which stores
 * images in the workspace as data URIs and passes the same URIs to the agent
 * as vision input.
 */

/** Most images one chat message may carry. */
export const MAX_CHAT_IMAGE_ATTACHMENTS = 4;
/**
 * Per-image cap on the encoded data URI. Base64 inflates by ~33%, so this
 * keeps a full set of attachments comfortably under the endpoint's body
 * limit while still fitting a large screenshot.
 */
export const MAX_CHAT_IMAGE_DATA_URI_CHARS = 3_000_000;
/**
 * Combined encoded size of one message's images. Keeps the whole JSON body
 * inside the endpoint's body limit even when every attachment is large.
 */
export const MAX_CHAT_IMAGE_TOTAL_CHARS = 3_500_000;

/** Image types the composer accepts, mapped to their file extension. */
const SUPPORTED_IMAGE_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The image payload of a chat request, or the reason it was rejected. */
export type ChatImageParseResult =
  | { images: string[]; error?: undefined }
  | { images: string[]; error: string };

/**
 * Reads and validates the `images` field of a `/api/chat/stream` body. An
 * absent field is valid and means no attachments; anything malformed is
 * rejected outright rather than silently dropped.
 */
export function readChatImageAttachments(body: unknown): ChatImageParseResult {
  const value = (body as { images?: unknown } | null | undefined)?.images;
  if (value === undefined || value === null) return { images: [] };
  if (!Array.isArray(value))
    return { images: [], error: "`images` must be an array of image data URIs." };
  if (value.length > MAX_CHAT_IMAGE_ATTACHMENTS)
    return {
      images: [],
      error: `Attach at most ${MAX_CHAT_IMAGE_ATTACHMENTS} images per message.`,
    };
  const images: string[] = [];
  let totalChars = 0;
  for (const entry of value) {
    if (typeof entry !== "string" || !parseChatImageDataUri(entry))
      return {
        images: [],
        error: "Each image must be a base64 data URI of a supported image type.",
      };
    if (entry.length > MAX_CHAT_IMAGE_DATA_URI_CHARS)
      return { images: [], error: "That image is too large. Please attach a smaller one." };
    totalChars += entry.length;
    if (totalChars > MAX_CHAT_IMAGE_TOTAL_CHARS)
      return { images: [], error: "Those images are too large together. Please attach smaller ones." };
    images.push(entry);
  }
  return { images };
}

/**
 * Parses a base64 image data URI, returning its mime type and a matching file
 * extension. Only the image types the composer produces are accepted, so an
 * SVG or other scriptable payload can never be stored as an "image".
 */
export function parseChatImageDataUri(
  dataUri: string
): { mimeType: string; extension: string } | null {
  if (typeof dataUri !== "string") return null;
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i.exec(dataUri);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const extension = SUPPORTED_IMAGE_MIME[mimeType];
  return extension ? { mimeType, extension } : null;
}

/**
 * A safe, sortable, near-unique workspace file name for an uploaded chat
 * image, e.g. `image-20261002153012-1-a1b2c.png`. Returns null when the data
 * URI is not a supported image.
 */
export function chatImageAttachmentFileName(
  dataUri: string,
  index: number,
  atMs = Date.now()
): { name: string; mimeType: string } | null {
  const parsed = parseChatImageDataUri(dataUri);
  if (!parsed) return null;
  const stamp = new Date(atMs).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 7);
  return {
    name: `image-${stamp}-${index + 1}-${suffix}.${parsed.extension}`,
    mimeType: parsed.mimeType,
  };
}
