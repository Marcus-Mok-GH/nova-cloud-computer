/**
 * Small text helpers shared by the server and the client. Kept free of any
 * other dependency so every side can import them.
 */

/** Escapes a literal string so it can be safely embedded in a RegExp source. */
export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A UTC `YYYYMMDDHHMMSS` stamp for generated file names, so repeated captures
 * of the same thing sort in time order and do not collide.
 */
export const fileStamp = (atMs: number) =>
  new Date(atMs).toISOString().replace(/[-:T]/g, "").slice(0, 14);
