/**
 * Caps command/tool output flowing back to the model. Command output can
 * contain NUL bytes that break the model's tokenizer, and the cut must be
 * visible so a truncated result is never mistaken for the whole thing.
 * Shared by the workspace sandbox bash runner and the desktop browser's
 * capture output, which used to keep byte-identical private copies.
 */
/** Precompiled so the common no-NUL case never allocates a new RegExp. */
const NUL_BYTES = /\u0000/g;

export function truncateOutput(
  value: string | undefined,
  limit: number
): string {
  const raw = value ?? "";
  // Command output is usually NUL-free, and `replace` copies the whole string
  // even when nothing matches - skip it entirely unless a NUL is present.
  const text = raw.includes("\u0000") ? raw.replace(NUL_BYTES, "") : raw;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…(truncated)`;
}
