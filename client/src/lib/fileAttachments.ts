/**
 * Browser-side preparation for the non-image files (documents, audio,
 * archives...) the web composer accepts - by drag & drop on desktop, or
 * alongside pasted/picked images. Each file is encoded to a base64 data URI;
 * `/api/chat/stream` later stores it in the workspace and tells the agent how
 * to open it.
 *
 * The size caps and the blocked content types are the byte-for-byte contract
 * with the server's request validation (`@shared/const`).
 */

import {
  BLOCKED_CHAT_FILE_MIME,
  MAX_CHAT_FILE_DATA_URI_CHARS,
  MAX_CHAT_ATTACHMENT_TOTAL_CHARS,
  MAX_CHAT_FILE_ATTACHMENTS,
  MAX_CHAT_IMAGE_ATTACHMENTS,
} from "@shared/const";
import { collectPreparedAttachments, newAttachmentId } from "./attachments";
import type { ChatImageAttachment } from "./imageAttachments";

/** Attachment limits shared with the server's request validation (`@shared/const`). */
export {
  MAX_CHAT_ATTACHMENT_TOTAL_CHARS,
  MAX_CHAT_FILE_ATTACHMENTS,
  MAX_CHAT_FILE_DATA_URI_CHARS,
} from "@shared/const";

export type ChatFileAttachment = {
  /** Discriminator in the composer's mixed image/file attachment list. */
  kind: "file";
  id: string;
  name: string;
  mimeType: string;
  dataUri: string;
  sizeBytes: number;
};

/** One attachment of the composer tray: an image or another file. */
export type ChatComposerAttachment = ChatImageAttachment | ChatFileAttachment;

/** The wire shape `/api/chat/stream` accepts for a non-image attachment. */
export type ChatFileUpload = Pick<
  ChatFileAttachment,
  "name" | "mimeType" | "dataUri"
>;

/** Mime type used when the browser reports none for a picked file. */
const UNKNOWN_FILE_MIME = "application/octet-stream";

/** Downscaled/encoded byte budget of a data URI for a file of this size. */
const dataUriBudgetFor = (bytes: number) => Math.ceil((bytes * 4) / 3);

/** Encodes one dropped/picked non-image file, or explains why it cannot be used. */
export async function prepareChatFileAttachment(
  file: File
): Promise<{ attachment: ChatFileAttachment } | { error: string }> {
  const mime = file.type.toLowerCase() || UNKNOWN_FILE_MIME;
  if (mime.startsWith("image/"))
    return {
      error: `${file.name || "That file"} is an image - images attach through the image button or by pasting them.`,
    };
  if (BLOCKED_CHAT_FILE_MIME.includes(mime))
    return {
      error: `${file.name || "That file"} is a ${mime} file, which cannot be attached.`,
    };
  if (dataUriBudgetFor(file.size) > MAX_CHAT_FILE_DATA_URI_CHARS)
    return {
      error: `${file.name || "That file"} is too large (limit ~2 MB per file).`,
    };
  try {
    const dataUri = await encodeChatFile(file, mime);
    return {
      attachment: {
        kind: "file",
        id: newAttachmentId(),
        name: file.name || "attachment",
        mimeType: mime,
        dataUri,
        sizeBytes: file.size,
      },
    };
  } catch {
    return { error: `Could not read ${file.name || "that file"}.` };
  }
}

/** Collects a batch of dropped/picked non-image files into prepared attachments. */
export async function collectChatFileAttachments(
  files: Iterable<File>
): Promise<{ attachments: ChatFileAttachment[]; error?: string }> {
  const picked = Array.from(files);
  if (!picked.length) return { attachments: [] };
  const results = await Promise.all(picked.map(prepareChatFileAttachment));
  return collectPreparedAttachments(results);
}

/**
 * Merges prepared attachments into what the composer already holds, enforcing
 * the per-kind counts and the shared size budget both sides validate with.
 * Returns what fits and how many prepared attachments were left out.
 */
export function queueComposerAttachments(
  current: ChatComposerAttachment[],
  prepared: ChatComposerAttachment[]
): { accepted: ChatComposerAttachment[]; overflow: number } {
  let imageCount = current.filter(attachment => attachment.kind === "image").length;
  let fileCount = current.filter(attachment => attachment.kind === "file").length;
  let totalChars = current.reduce(
    (sum, attachment) => sum + attachment.dataUri.length,
    0
  );
  const accepted: ChatComposerAttachment[] = [];
  for (const attachment of prepared) {
    if (
      accepted.length + current.length >=
      MAX_CHAT_IMAGE_ATTACHMENTS + MAX_CHAT_FILE_ATTACHMENTS
    )
      break;
    // Each kind has its own per-message count, so the server never has to
    // reject a message the composer already showed as attached.
    if (attachment.kind === "image" && imageCount >= MAX_CHAT_IMAGE_ATTACHMENTS)
      continue;
    if (attachment.kind === "file" && fileCount >= MAX_CHAT_FILE_ATTACHMENTS)
      continue;
    if (totalChars + attachment.dataUri.length > MAX_CHAT_ATTACHMENT_TOTAL_CHARS)
      continue;
    accepted.push(attachment);
    totalChars += attachment.dataUri.length;
    if (attachment.kind === "image") imageCount += 1;
    else fileCount += 1;
  }
  return { accepted, overflow: prepared.length - accepted.length };
}

/** Encodes a file as a base64 data URI without holding a giant binary string. */
async function encodeChatFile(file: File, mimeType: string): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // Sliced so fromCharCode never sees more arguments than a call can hold.
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK)
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(offset, offset + CHUNK))
    );
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** True when a drag event's data transfer carries files (vs text/selection drags). */
export function dragCarriesFiles(
  types: readonly string[] | undefined | null
): boolean {
  return Boolean(types && Array.from(types).includes("Files"));
}

/**
 * Drag & drop attachment is a desktop-pointer affordance: on touch devices the
 * overlay never shows and drags keep their native behavior. Returns false
 * during SSR or where the media query is unsupported.
 */
export function isDesktopDragDrop(
  target?: Pick<Window, "matchMedia">
): boolean {
  const view =
    target ?? (typeof window === "undefined" ? undefined : window);
  return Boolean(
    view?.matchMedia?.("(hover: hover) and (pointer: fine)").matches
  );
}
