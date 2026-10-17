/**
 * Caps command/tool output flowing back to the model. Command output can
 * contain NUL bytes that break the model's tokenizer, and the cut must be
 * visible so a truncated result is never mistaken for the whole thing.
 * Shared by the workspace sandbox bash runner and the desktop browser's
 * capture output, which used to keep byte-identical private copies.
 */
export function truncateOutput(
  value: string | undefined,
  limit: number
): string {
  const text = (value ?? "").replace(/\u0000/g, "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…(truncated)`;
}
