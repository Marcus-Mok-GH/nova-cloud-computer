/**
 * Speech chunking shared by the server synthesiser (`server/speech.ts`) and
 * the browser's read-aloud fallback (`client/src/lib/speech.ts`).
 *
 * Both engines truncate a single very long utterance - Google stops reading
 * past ~200 characters, some browsers cut off long messages - so text is
 * split into sentence-aligned pieces with the punctuation kept attached. The
 * algorithm lives here so the two sides cannot drift; each caller supplies
 * its own chunk-length limit.
 */

/** Collapses whitespace and drops nothing else - the exact prose is spoken. */
export function normalizeSpeechText(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Splits text into pieces no longer than `maxChunkLength`, keeping sentences
 * intact wherever possible so prosody does not reset mid-sentence. A single
 * run-on sentence is hard-split on word boundaries rather than dropped.
 */
export function splitSpeechText(
  text: string,
  maxChunkLength: number
): string[] {
  const clean = normalizeSpeechText(text);
  if (!clean) return [];
  if (clean.length <= maxChunkLength) return [clean];
  // Split on sentence ends and keep the punctuation with its sentence.
  const sentences = clean.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) ?? [clean];
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = "";
  };
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if (piece.length > maxChunkLength) {
      // One run-on sentence: hard-split on word boundaries rather than
      // dropping the overflow.
      push();
      const words = piece.split(" ");
      let part = "";
      for (const word of words) {
        const next = part ? `${part} ${word}` : word;
        if (next.length > maxChunkLength && part) {
          chunks.push(part);
          part = word;
        } else {
          part = next;
        }
      }
      if (part.trim()) chunks.push(part.trim());
      continue;
    }
    const next = current ? `${current} ${piece}` : piece;
    if (next.length > maxChunkLength && current) {
      push();
      current = piece;
    } else {
      current = next;
    }
  }
  push();
  return chunks;
}
