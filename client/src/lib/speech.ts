/**
 * Free client-side text-to-speech for chat messages.
 *
 * Uses the browser's built-in Web Speech API (`speechSynthesis`), so there is
 * no server cost, no API key, and no network dependency. Long messages are
 * split into sentence-aligned chunks because some browsers truncate a single
 * very long utterance.
 */

/** True when the current browser can read text aloud. */
export function isSpeechSynthesisSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/**
 * Strips Markdown / chat formatting down to plain speakable prose. Code
 * blocks become a short placeholder so the reader does not spell out syntax.
 */
export function stripMarkdownForSpeech(raw: string): string {
  let text = (raw ?? "").replace(/\r\n/g, "\n");
  // Fenced code blocks -> placeholder (or drop when empty).
  text = text.replace(/```[\s\S]*?```/g, " code sample. ");
  // Inline code keeps its content but drops the backticks.
  text = text.replace(/`([^`\n]+)`/g, "$1");
  // Images ![alt](url) -> alt only.
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  // Links [label](url) -> label only.
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Headings, quotes, list markers, rules, emphasis.
  text = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, " ")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)([^*_]+?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1");
  // Bare URLs are noise when spoken.
  text = text.replace(/https?:\/\/[^\s<>()\[\]]+/g, " link. ");
  // Collapse whitespace.
  text = text.replace(/[ \t\f\v]+/g, " ").replace(/\n{2,}/g, ". ");
  text = text.replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();
  return text;
}

/**
 * Splits speakable text into sentence-aligned chunks so no single utterance
 * is long enough for browsers to cut off.
 */
export function chunkSpokenText(
  text: string,
  maxChunkLength = 220
): string[] {
  const clean = (text ?? "").trim().replace(/\s+/g, " ");
  if (!clean) return [];
  if (clean.length <= maxChunkLength) return [clean];
  // Split on sentence ends, keep the punctuation with the sentence.
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
      // A single run-on sentence: hard-split on word boundaries.
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

/** Event fired so every Speak button but the starter flips back to idle. */
export const TTS_START_EVENT = "nova-tts-start";
export const TTS_STOP_EVENT = "nova-tts-stop";

// Bumps on every new speech run and every stop, so a stale utterance's
// onend/onerror (fired by cancel()) can never advance a dead queue and
// interleave its next chunk after the new message.
let activeGeneration = 0;

/** Cancels any in-flight speech and notifies all buttons to reset. */
export function stopAllSpeech(): void {
  activeGeneration += 1;
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* Speech may be unavailable - nothing to stop. */
  }
  try {
    window.dispatchEvent(new CustomEvent(TTS_STOP_EVENT));
  } catch {
    /* Non-DOM environment - nothing to notify. */
  }
}

/** Picks a reasonable default voice (English when available). */
export function pickDefaultVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    return (
      voices.find(
        voice => voice.default && voice.lang?.toLowerCase().startsWith("en")
      ) ??
      voices.find(voice => voice.lang?.toLowerCase().startsWith("en")) ??
      voices.find(voice => voice.default) ??
      voices[0] ??
      null
    );
  } catch {
    return null;
  }
}

export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
}

/**
 * Speaks already-cleaned chunks in order. Returns a stop function. Only one
 * call should be active at a time - callers must `cancel()` first (this helper
 * does that itself before queueing).
 */
export function speakChunks(
  chunks: string[],
  options: SpeakOptions = {}
): () => void {
  const stop = () => stopAllSpeech();
  if (!isSpeechSynthesisSupported() || chunks.length === 0) {
    options.onEnd?.();
    return stop;
  }
  const synthesis = window.speechSynthesis;
  synthesis.cancel();
  activeGeneration += 1;
  const generation = activeGeneration;
  const voice = pickDefaultVoice();
  let cancelled = false;
  let index = 0;
  const originalStop = stopAllSpeech;
  const cancelThis = () => {
    cancelled = true;
    originalStop();
  };
  const speakNext = () => {
    if (cancelled || generation !== activeGeneration || index >= chunks.length) {
      if (!cancelled && generation === activeGeneration) options.onEnd?.();
      return;
    }
    const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;
    if (voice) utterance.voice = voice;
    index += 1;
    utterance.onend = () => {
      if (cancelled || generation !== activeGeneration) return;
      if (index >= chunks.length) options.onEnd?.();
      else speakNext();
    };
    utterance.onerror = () => {
      if (cancelled || generation !== activeGeneration) return;
      options.onError?.();
    };
    synthesis.speak(utterance);
  };
  try {
    window.dispatchEvent(new CustomEvent(TTS_START_EVENT));
  } catch {
    /* ignore */
  }
  // Some browsers load voices asynchronously; a late list must not restart
  // speech, it only affects the next call via pickDefaultVoice().
  try {
    if (synthesis.getVoices().length === 0) {
      synthesis.onvoiceschanged = () => {
        synthesis.onvoiceschanged = null;
      };
    }
  } catch {
    /* ignore */
  }
  speakNext();
  return cancelThis;
}
