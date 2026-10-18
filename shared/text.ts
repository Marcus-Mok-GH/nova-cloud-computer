/**
 * Small text helpers shared by the server and the client. Kept free of any
 * other dependency so every side can import them.
 */

/** Escapes a literal string so it can be safely embedded in a RegExp source. */
export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
