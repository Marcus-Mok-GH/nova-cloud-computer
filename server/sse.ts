/**
 * One SSE line-framing implementation shared by every server-side stream
 * reader: the two gateway readers in aiGateway.ts and the Exa research
 * stream in exa.ts. Each consumer reads bytes its own way (plain reader,
 * stall-guarded reader) and interprets payloads its own way, but the framing
 * was copy-pasted three times: split on `\n`, carry the trailing partial line
 * to the next chunk, CR-trim complete lines, and optionally bound the
 * retained partial line so a newline-less stream cannot grow memory until a
 * timeout fires.
 */

export type SseLineFramer = {
  /** Feed one decoded text chunk; every complete line hits `onLine` in order. */
  push(chunk: string): void;
  /**
   * The trailing partial line the stream has not newline-terminated yet.
   * For consumers that flush it when the stream ends.
   */
  pending(): string;
};

/**
 * Builds a line framer for one stream. `push` throws whatever
 * `lineLengthError` returns when the retained partial line exceeds
 * `maxLineLength`, after the lines already complete in that chunk have been
 * delivered - exactly where an inline splitter would have thrown.
 */
export function createSseLineFramer(
  onLine: (line: string) => void,
  options?: {
    /** Cap on the retained (unterminated) line, in characters. */
    maxLineLength?: number;
    /** Error thrown when the cap is exceeded. */
    lineLengthError?: () => Error;
  }
): SseLineFramer {
  let buffer = "";
  const maxLineLength = options?.maxLineLength ?? Number.MAX_SAFE_INTEGER;
  return {
    push(chunk: string) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        onLine(buffer.slice(0, newlineIndex).replace(/\r$/, ""));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
      if (buffer.length > maxLineLength) {
        throw (
          options?.lineLengthError?.() ??
          new Error("SSE stream exceeded the maximum line length.")
        );
      }
    },
    pending: () => buffer,
  };
}

/** The payload of an SSE `data:` line, or null for any other line. */
export function sseDataPayload(line: string): string | null {
  if (!line.startsWith("data:")) return null;
  return line.slice(5).trim();
}
