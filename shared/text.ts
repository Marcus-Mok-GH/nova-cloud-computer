/**
 * Small text helpers shared by the server and the client. Kept free of any
 * other dependency so every side can import them.
 */

/** Escapes a literal string so it can be safely embedded in a RegExp source. */
export const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A UTC `YYYYMMDDHHMMSS` stamp for generated file names, so repeated captures
 * of the same thing sort in time order and do not collide.
 */
export const fileStamp = (atMs: number) =>
  new Date(atMs).toISOString().replace(/[-:T]/g, "").slice(0, 14);

/**
 * The declared mime type of a base64 data URI (`data:<type>;base64,...`), or
 * null when the value is not one. Both the chat-image and chat-file request
 * validators read this same prefix, so the pattern lives here rather than in
 * either of them.
 */
export function base64DataUriMimeType(value: string): string | null {
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,/i.exec(value);
  return match ? match[1].toLowerCase() : null;
}
