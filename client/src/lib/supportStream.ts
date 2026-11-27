/**
 * Incremental SSE framing for the public Q&A stream.
 *
 * `ReadableStream` chunks do not line up with SSE events: one chunk can hold
 * half a line, or several. This framer carries the trailing partial line to
 * the next chunk, exactly like the server-side `createSseLineFramer`, and
 * hands complete lines to the handler in order.
 */
export function createSupportStreamFramer(
  onLine: (line: string) => void
): {
  push(chunk: string): void;
  flush(): void;
} {
  let pending = "";
  return {
    push(chunk: string) {
      pending += chunk;
      let start = 0;
      let newline = pending.indexOf("\n", start);
      while (newline !== -1) {
        const line = pending.slice(start, newline).replace(/\r$/, "");
        if (line) onLine(line);
        start = newline + 1;
        newline = pending.indexOf("\n", start);
      }
      if (start > 0) pending = pending.slice(start);
    },
    flush() {
      if (pending) onLine(pending.replace(/\r$/, ""));
      pending = "";
    },
  };
}

export type SupportStreamEvent = {
  delta?: string;
  error?: string;
  done?: boolean;
};

/**
 * Parses one SSE `data:` line. Returns null for keep-alives, the `[DONE]`
 * sentinel, or malformed fragments, so a partial stream never breaks the
 * answer mid-sentence.
 */
export function parseSupportStreamLine(line: string): SupportStreamEvent | null {
  if (!line.startsWith("data:")) return null;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return null;
  try {
    const event = JSON.parse(data) as SupportStreamEvent;
    return event && typeof event === "object" ? event : null;
  } catch {
    return null;
  }
}