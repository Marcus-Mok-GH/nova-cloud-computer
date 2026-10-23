/**
 * Helpers for the non-image files (documents, audio, archives...) a Nova web
 * chat message can carry alongside its images. The browser composer encodes
 * each dragged/picked file to a base64 data URI; these helpers validate that
 * payload, turn it into a safe workspace file name, and tell the agent how to
 * open it. This mirrors the Telegram upload path, which stores arbitrary
 * uploads in the workspace and points the agent at the saved file.
 */

import {
  BLOCKED_CHAT_FILE_MIME,
  MAX_CHAT_ATTACHMENT_TOTAL_CHARS,
  MAX_CHAT_FILE_ATTACHMENTS,
  MAX_CHAT_FILE_DATA_URI_CHARS,
} from "@shared/const";
import { base64DataUriMimeType, fileStamp } from "@shared/text";

/*
 * The attachment limits and the blocked content types are the byte-for-byte
 * contract with the browser composer (`@shared/const`), which encodes each
 * dropped/picked file to a base64 data URI before sending it.
 */
export { MAX_CHAT_ATTACHMENT_TOTAL_CHARS, MAX_CHAT_FILE_ATTACHMENTS, MAX_CHAT_FILE_DATA_URI_CHARS };

/** One validated non-image attachment of a chat request. */
export type ChatFileUpload = {
  name: string;
  mimeType: string;
  dataUri: string;
};

/** The file payload of a chat request, or the reason it was rejected. */
export type ChatFileParseResult =
  | { files: ChatFileUpload[]; error?: undefined }
  | { files: ChatFileUpload[]; error: string };

/**
 * Reads and validates the `files` field of a `/api/chat/stream` body. An
 * absent field is valid and means no file attachments; anything malformed is
 * rejected outright rather than silently dropped. `alreadyEncodedChars` is
 * the encoded size the request's images already occupy, so images and files
 * share one total budget inside the endpoint's body limit.
 */
export function readChatFileAttachments(
  body: unknown,
  alreadyEncodedChars = 0
): ChatFileParseResult {
  const value = (body as { files?: unknown } | null | undefined)?.files;
  if (value === undefined || value === null) return { files: [] };
  if (!Array.isArray(value))
    return { files: [], error: "`files` must be an array of file attachments." };
  if (value.length > MAX_CHAT_FILE_ATTACHMENTS)
    return {
      files: [],
      error: `Attach at most ${MAX_CHAT_FILE_ATTACHMENTS} files per message.`,
    };
  const files: ChatFileUpload[] = [];
  let totalChars = alreadyEncodedChars;
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null)
      return {
        files: [],
        error:
          "Each file must carry a name, a mime type, and a base64 data URI.",
      };
    const { name, mimeType, dataUri } = entry as {
      name?: unknown;
      mimeType?: unknown;
      dataUri?: unknown;
    };
    if (
      typeof name !== "string" ||
      typeof mimeType !== "string" ||
      typeof dataUri !== "string"
    )
      return {
        files: [],
        error:
          "Each file must carry a name, a mime type, and a base64 data URI.",
      };
    const mime = mimeType.toLowerCase();
    // Block active content first: image/svg+xml would otherwise read as "an
    // image - use `images`", but it never belongs in either field.
    if (BLOCKED_CHAT_FILE_MIME.includes(mime))
      return {
        files: [],
        error: `"${name}" is a ${mime} file, which cannot be attached.`,
      };
    // Images ride through the `images` field, where they get vision input.
    if (mime.startsWith("image/"))
      return {
        files: [],
        error: "Images belong in the `images` field of a chat message.",
      };
    if (base64DataUriMimeType(dataUri) !== mime)
      return {
        files: [],
        error: "Each file must be a base64 data URI matching its mime type.",
      };
    if (dataUri.length > MAX_CHAT_FILE_DATA_URI_CHARS)
      return {
        files: [],
        error: `"${name}" is too large. Please attach a smaller file.`,
      };
    totalChars += dataUri.length;
    if (totalChars > MAX_CHAT_ATTACHMENT_TOTAL_CHARS)
      return {
        files: [],
        error:
          "Those attachments are too large together. Please attach smaller ones.",
      };
    files.push({ name, mimeType: mime, dataUri });
  }
  return { files };
}

/**
 * A safe workspace file name for an uploaded chat file: the user's own file
 * name when it can be used as-is (so the agent can quote it back), otherwise
 * a generated one. Path segments, control characters, and characters unsafe
 * on any filesystem are stripped.
 */
export function chatFileAttachmentFileName(
  upload: ChatFileUpload,
  index: number,
  atMs = Date.now()
): string {
  const base = upload.name.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 100)
    .trim();
  if (cleaned) return cleaned;
  return `attachment-${fileStamp(atMs)}-${index + 1}`;
}

/**
 * The fallback name for an upload whose safe name collided with a workspace
 * file that already exists: prefixed with the creation stamp so it sorts in
 * time order and inserts cleanly.
 */
export function chatFileStampedFileName(
  safeName: string,
  atMs = Date.now()
): string {
  return `${fileStamp(atMs)}-${safeName}`;
}

/** How the agent is told to open one attached file, by content type. */
function fileReadGuide(mimeType: string): string {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("audio/"))
    return "it is audio - decode the data URI in a short Python task with run_vm_task (for example with pydub) and work from the result";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/yaml" ||
    mime === "application/toml"
  )
    return "read its contents with read_file";
  if (mime === "application/pdf")
    return "read it in a short Python task with run_vm_task that decodes the data URI (for example with pypdf)";
  return "read it in a short Python task with run_vm_task that decodes the base64 data URI and parses the format";
}

/**
 * The attachment note appended to the agent's turn (never to the chat
 * bubble): which images are visible on the message directly, which files were
 * saved to the workspace and how to open each, and anything that failed to
 * save. Empty when there are no attachments.
 */
export function buildChatUploadContext(
  savedImages: Array<{ name: string; id: number }>,
  savedFiles: Array<{ name: string; id: number; mimeType: string }>,
  missedFiles = 0
): string {
  if (!savedImages.length && !savedFiles.length && !missedFiles) return "";
  const parts: string[] = [];
  if (savedImages.length) {
    const count = savedImages.length;
    parts.push(
      `The user attached ${count === 1 ? "an image" : `${count} images`}, saved in the workspace as ${savedImages
        .map(file => `"${file.name}" (file id ${file.id})`)
        .join(", ")}. ${count === 1 ? "The image is" : "The images are"} attached to this message - you can see ${
          count === 1 ? "it" : "them"
        } directly.`
    );
  }
  if (savedFiles.length) {
    const count = savedFiles.length;
    parts.push(
      `The user attached ${count === 1 ? "a file" : `${count} files`}, saved in the workspace as ${savedFiles
        .map(
          file =>
            `"${file.name}" (file id ${file.id}) - ${fileReadGuide(file.mimeType)}`
        )
        .join("; ")}.`
    );
  }
  if (missedFiles)
    parts.push(
      `${missedFiles === 1 ? "One attachment" : `${missedFiles} attachments`} could not be saved to the workspace - mention that and carry on with the rest.`
    );
  return `\n\n📎 (${parts.join(" ")} Acknowledge briefly and work with the attachments as the conversation requires.)`;
}
