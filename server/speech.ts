/**
 * Free text-to-speech for browsers whose Web Speech API does not work.
 *
 * Chrome, Safari and most Edge builds speak `speechSynthesis` locally, but the
 * API is missing wherever the OS ships no speech voices - headless Linux, a
 * minimal container image, Firefox without speech-dispatcher - and the browser
 * then reports the feature as present while silently refusing to utter. Nova
 * keeps the local engine as a first choice (see client/src/lib/speech.ts) and
 * routes around it with a server-side synthesiser so the Read aloud button
 * always has a voice.
 *
 * This module is that route-around. It uses Google Translate's public speech
 * endpoint, which needs no key, no account and no quota beyond fair use - the
 * only free option that had no signup and no auth when the alternatives were
 * checked (StreamElements now returns 401 without a JWT, and every hosted
 * provider, Pollinations included, requires an API key). Google is an
 * undocumented endpoint, so treat it as replaceable: all of the protocol lives
 * in this file behind `synthesizeSpeech()`, and nothing else in the server
 * imports it.
 *
 * Two behaviours of the endpoint shape the implementation:
 *
 * 1. It silently truncates any request longer than ~200 characters - the
 *    response simply stops early - so text is split into short chunks.
 * 2. Each response is a bare MPEG audio stream (raw ADTS frames, no ID3 tag),
 *    so the chunk buffers concatenate straight into one playable MP3.
 */

/** Google stops speaking past roughly this many characters per request. */
export const MAX_SPEECH_CHUNK_CHARS = 190;

/** Most characters one `/api/speech` request will read aloud. */
export const MAX_SPEECH_REQUEST_CHARS = 8000;

/**
 * How long one chunk request may take. Google answers in well under a second;
 * anything hanging is a dead connection rather than a slow voice.
 */
const CHUNK_TIMEOUT_MS = 15_000;

/**
 * Ceiling for the whole request, chunked as `ceil(chars / 190)`. Long messages
 * fetch their chunks in parallel, so this stays generous without letting a
 * wedged upstream pin the request handler open.
 */
const TOTAL_TIMEOUT_MS = 90_000;

/** How many chunk requests are in flight at once. Serially they feel slow. */
const CHUNK_CONCURRENCY = 4;

const SPEECH_ENDPOINT = "https://translate.google.com/translate_tts";

/** A plain browser UA: the endpoint rejects some non-browser clients. */
const REQUEST_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** An acceptably formatted `tl` (target language) value, e.g. `en` or `pt-BR`. */
const LANGUAGE_PATTERN = /^[a-z]{2}(?:-[a-z]{2})?$/i;

/** A caller-supplied language, or null when it must not be forwarded upstream. */
export function normalizeSpeechLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return LANGUAGE_PATTERN.test(trimmed) ? trimmed : null;
}

/** Collapses whitespace and drops nothing else - Google needs the exact prose. */
function normalizeText(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Splits text into pieces Google will read in full, keeping sentences intact
 * wherever possible so prosody does not reset mid-sentence.
 */
export function chunkTextForSpeech(
  text: string,
  maxChunkLength = MAX_SPEECH_CHUNK_CHARS
): string[] {
  const clean = normalizeText(text);
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
      // One run-on sentence: hard-split on word boundaries rather than dropping
      // the overflow, which the endpoint would do silently.
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

/**
 * Removes a leading ID3v2 tag. Google replies with bare MPEG frames today, but
 * a tag inserted between two chunks would break the joined stream, and a
 * missing tag is free to keep.
 */
export function stripId3v2(buffer: Buffer): Buffer {
  if (buffer.length < 10) return buffer;
  const isId3 =
    buffer[0] === 0x49 && // "I"
    buffer[1] === 0x44 && // "D"
    buffer[2] === 0x33; // "3"
  if (!isId3) return buffer;
  const size =
    ((buffer[6] & 0x7f) << 21) |
    ((buffer[7] & 0x7f) << 14) |
    ((buffer[8] & 0x7f) << 7) |
    (buffer[9] & 0x7f);
  const bodyStart = 10 + size;
  return bodyStart >= buffer.length
    ? buffer.subarray(0, 0)
    : buffer.subarray(bodyStart);
}

/** Joins MPEG chunk buffers into one continuous audio stream. */
export function joinSpeechChunks(chunks: Buffer[]): Buffer {
  return Buffer.concat(chunks.map(stripId3v2));
}

/** Builds the upstream Google request URL for one chunk of text. */
export function speechChunkUrl(text: string, language: string): URL {
  const params = new URLSearchParams({
    ie: "UTF-8",
    q: text,
    tl: language,
    client: "tw-ob",
  });
  return new URL(`${SPEECH_ENDPOINT}?${params.toString()}`);
}

/** Reads one chunk as MP3 bytes, rejecting on any non-2xx or short response. */
async function fetchSpeechChunk(
  text: string,
  language: string,
  signal: AbortSignal
): Promise<Buffer> {
  const response = await fetch(speechChunkUrl(text, language), {
    headers: {
      "User-Agent": REQUEST_USER_AGENT,
      Accept: "audio/mpeg, audio/*",
    },
    signal: AbortSignal.any([signal, AbortSignal.timeout(CHUNK_TIMEOUT_MS)]),
  });
  if (!response.ok) {
    throw new Error(
      `Speech upstream rejected the request (${response.status})`
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  const audio = Buffer.from(await response.arrayBuffer());
  // A truncated or policy-blocked reply can still arrive as a 200, so reject
  // anything that is neither clearly audio nor large enough to be a chunk.
  if (!contentType.includes("audio") || audio.length < 64) {
    throw new Error("Speech upstream returned no audio");
  }
  return audio;
}

/** Runs `worker` over `items` with a bounded number of parallel calls. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }
  );
  await Promise.all(runners);
  return results;
}

export interface SynthesizeSpeechOptions {
  /** BCP-47 language passed upstream as `tl`. Defaults to English. */
  language?: string | null;
  /** Pre-normalized text; `chunkTextForSpeech` runs on it. */
  text: string;
}

/**
 * Reads `text` aloud and returns one playable MP3 buffer, or throws when the
 * free provider cannot serve it.
 */
export async function synthesizeSpeech(
  options: SynthesizeSpeechOptions
): Promise<Buffer> {
  const text = normalizeText(options.text);
  if (!text) throw new Error("There is no text to read aloud.");
  if (text.length > MAX_SPEECH_REQUEST_CHARS) {
    throw new Error("That message is too long to read aloud.");
  }
  const language = normalizeSpeechLanguage(options.language) ?? "en";
  const chunks = chunkTextForSpeech(text);
  if (!chunks.length) throw new Error("There is no text to read aloud.");

  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  try {
    const audio = await mapWithConcurrency(chunks, CHUNK_CONCURRENCY, chunk =>
      fetchSpeechChunk(chunk, language, controller.signal)
    );
    return joinSpeechChunks(audio);
  } finally {
    clearTimeout(totalTimer);
  }
}
