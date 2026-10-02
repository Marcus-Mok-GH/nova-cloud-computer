/**
 * Browser-side preparation for images attached to a chat message. Raw camera
 * photos are multiples of the request body limit, so anything large is
 * downscaled and re-encoded to JPEG before it becomes a data URI. Small files
 * are kept byte-for-byte so screenshots stay sharp and transparency/animation
 * survives.
 */

/** Most images one chat message may carry; mirrors the server's cap. */
export const MAX_CHAT_IMAGE_ATTACHMENTS = 4;
/** Longest edge an oversized image is scaled down to. */
export const MAX_CHAT_IMAGE_DIMENSION = 1280;
/**
 * Total encoded size one message's attachments may add up to. Keeps the JSON
 * request comfortably inside the server's body limit even with a full set.
 */
export const MAX_CHAT_IMAGE_TOTAL_CHARS = 3_500_000;
/** Below this size a supported image is attached unchanged. */
const KEEP_ORIGINAL_BYTES = 700_000;
const JPEG_QUALITY = 0.82;

export type ChatImageAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUri: string;
};

export function isSupportedChatImage(file: File): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/i.test(file.type);
}

/** Downscales/encodes one picked file, or explains why it cannot be used. */
export async function prepareChatImageAttachment(
  file: File
): Promise<{ attachment: ChatImageAttachment } | { error: string }> {
  if (!isSupportedChatImage(file))
    return {
      error: `${file.name || "That file"} is not a supported image (PNG, JPEG, WebP, or GIF).`,
    };
  try {
    const dataUri = await encodeChatImage(file);
    return {
      attachment: {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || "image",
        mimeType: dataUri.slice(5, dataUri.indexOf(";")),
        dataUri,
      },
    };
  } catch {
    return { error: `Could not read ${file.name || "that image"}.` };
  }
}

/** Collects a batch of picked files into prepared attachments. */
export async function collectChatImageAttachments(
  files: Iterable<File>
): Promise<{ attachments: ChatImageAttachment[]; error?: string }> {
  const picked = Array.from(files).filter(file => file.type.startsWith("image/"));
  if (!picked.length) return { attachments: [] };
  const results = await Promise.all(picked.map(prepareChatImageAttachment));
  const attachments = results.flatMap(result =>
    "attachment" in result ? [result.attachment] : []
  );
  const error = results.find(result => "error" in result)?.error;
  return { attachments, ...(error ? { error } : {}) };
}

async function encodeChatImage(file: File): Promise<string> {
  const original = await readFileAsDataUri(file);
  if (file.size <= KEEP_ORIGINAL_BYTES) return original;
  const image = await loadImage(original);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale =
    longestEdge > MAX_CHAT_IMAGE_DIMENSION
      ? MAX_CHAT_IMAGE_DIMENSION / longestEdge
      : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return original;
  // Flatten transparency onto white so JPEG encoding does not blacken it.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("read-failed"));
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image-load-failed"));
    image.src = dataUri;
  });
}
