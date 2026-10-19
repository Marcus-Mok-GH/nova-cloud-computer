/**
 * Free client-side text-to-speech for chat messages.
 *
 * The preferred engine is the browser's built-in Web Speech API
 * (`speechSynthesis`), because it is instant, offline and costs nothing. It is
 * not universally usable, though: the API object exists in every current
 * browser, so a feature check reports success, but any browser that has no
 * installed voice - a Linux install with no speech-dispatcher, a hardened
 * container, some Firefox builds - stays silent when `speak()` is called, and
 * some raise no error at all. The "Read aloud is not supported in this
 * browser" toast was that dead end.
 *
 * So this module picks its engine at speak time:
 *
 *   - "browser" - `speechSynthesis` exists and reports at least one voice.
 *   - "server"  - otherwise, `/api/speech` synthesises an MP3 on the server
 *                 with a free provider that needs no key (see
 *                 server/speech.ts) and this module plays it back.
 *
 * The choice is per message, so a machine that reads fine keeps using the local
 * voice and a machine that cannot reads through the network instead. Long
 * messages are split into sentence-aligned chunks because some browsers
 * truncate a single very long utterance.
 */

import { splitSpeechText } from "@shared/speech";

/** True when the current browser can read text aloud. */
function isSpeechSynthesisSupported(): boolean {
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
  // An unclosed fence (e.g. a truncated reply): everything from the opening
  // fence on is code, so it carries no speakable content.
  text = text.replace(/^\s*```[\s\S]*$/m, " code sample. ");
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
  text = text
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text;
}

/**
 * Splits speakable text into sentence-aligned chunks so no single utterance
 * is long enough for browsers to cut off. The splitting itself is shared with
 * the server synthesiser (`@shared/speech`) so the two cannot drift.
 */
export function chunkSpokenText(text: string, maxChunkLength = 220): string[] {
  return splitSpeechText(text, maxChunkLength);
}

/** Event fired so every Speak button but the starter flips back to idle. */
export const TTS_START_EVENT = "nova-tts-start";
export const TTS_STOP_EVENT = "nova-tts-stop";

/**
 * Where the browser asks for a server-synthesised voice. Same origin, so no
 * CORS: the upstream free provider the endpoint calls is not CORS-enabled and
 * rate-limits per requester IP, both of which make a browser-direct call fail.
 */
const SPEECH_ENDPOINT = "/api/speech";

/** How long to wait for a browser that loads its voice list asynchronously. */
const VOICE_LOAD_TIMEOUT_MS = 300;

// Bumps on every new speech run and every stop, so a stale utterance's
// onend/onerror (fired by cancel()) can never advance a dead queue and
// interleave its next chunk after the new message.
let activeGeneration = 0;

/**
 * The blob URL of the audio element playing a server-synthesised message, so a
 * stop can release it. Tracked beside `activeAudio` rather than in the UI so
 * the one stop path silences both engines and leaks nothing.
 */
let activeAudioUrl: string | null = null;

/**
 * The audio element playing a server-synthesised message, if any.
 */
let activeAudio: HTMLAudioElement | null = null;

/** Cancels any in-flight speech and notifies all buttons to reset. */
export function stopAllSpeech(): void {
  activeGeneration += 1;
  if (typeof window === "undefined") return;
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* Speech may be unavailable - nothing to stop. */
  }
  if (activeAudio) {
    const audio = activeAudio;
    activeAudio = null;
    try {
      audio.pause();
    } catch {
      /* Already stopped - nothing to pause. */
    }
  }
  if (activeAudioUrl) {
    const url = activeAudioUrl;
    activeAudioUrl = null;
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* Already revoked - nothing to release. */
    }
  }
  try {
    window.dispatchEvent(new CustomEvent(TTS_STOP_EVENT));
  } catch {
    /* Non-DOM environment - nothing to notify. */
  }
}

/** Picks a reasonable default voice (English when available). */
function pickDefaultVoice(): SpeechSynthesisVoice | null {
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

interface SpeakOptions {
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
function speakChunks(
  chunks: string[],
  options: SpeakOptions = {}
): () => void {
  const stop = () => stopAllSpeech();
  if (!isSpeechSynthesisSupported() || chunks.length === 0) {
    options.onEnd?.();
    return stop;
  }
  const synthesis = window.speechSynthesis;
  // Bump first: cancel() may synchronously fire the previous run's end
  // handlers in some browsers, and they must already read as stale.
  activeGeneration += 1;
  const generation = activeGeneration;
  // Chrome drops a speak() issued in the same task as cancel(): the async
  // cancel clears the just-queued utterance, so playback never starts and
  // no sound plays. Only cancel when something is actually queued/playing,
  // and defer the first speak past the cancel when we did cancel.
  let needsDelay = false;
  try {
    needsDelay = synthesis.speaking || synthesis.pending;
    if (needsDelay) synthesis.cancel();
  } catch {
    /* Speech may be unavailable - speak anyway. */
  }
  // Chrome can leave synthesis paused across cancel(); queued utterances
  // then sit silent until resumed.
  try {
    if (synthesis.paused) synthesis.resume();
  } catch {
    /* ignore */
  }
  const voice = pickDefaultVoice();
  let cancelled = false;
  let index = 0;
  let retries = 0;
  let resumeTimer: ReturnType<typeof setInterval> | null = null;
  const cleanup = () => {
    if (resumeTimer) {
      clearInterval(resumeTimer);
      resumeTimer = null;
    }
  };
  const originalStop = stopAllSpeech;
  const cancelThis = () => {
    cancelled = true;
    cleanup();
    originalStop();
  };
  const speakNext = () => {
    if (
      cancelled ||
      generation !== activeGeneration ||
      index >= chunks.length
    ) {
      if (!cancelled && generation === activeGeneration) {
        cleanup();
        options.onEnd?.();
      } else {
        cleanup();
      }
      return;
    }
    const utterance = new window.SpeechSynthesisUtterance(chunks[index]);
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;
    if (voice) utterance.voice = voice;
    index += 1;
    utterance.onend = () => {
      if (cancelled || generation !== activeGeneration) return;
      retries = 0;
      if (index >= chunks.length) {
        cleanup();
        options.onEnd?.();
      } else speakNext();
    };
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (cancelled || generation !== activeGeneration) return;
      // "canceled"/"interrupted" fires for utterances cleared by cancel()
      // (including the Chrome cancel-then-speak race). It is not a real
      // playback failure: re-queue the same chunk instead of toasting.
      const code = (event as SpeechSynthesisErrorEvent | undefined)?.error;
      if (code === "canceled" || code === "interrupted") {
        if (retries < 2) {
          retries += 1;
          index -= 1;
          setTimeout(() => {
            if (!cancelled && generation === activeGeneration) speakNext();
          }, 80);
        } else {
          cleanup();
          options.onEnd?.();
        }
        return;
      }
      retries = 0;
      cleanup();
      options.onError?.();
    };
    try {
      // Belt-and-braces: a paused engine queues but never plays.
      if (synthesis.paused) synthesis.resume();
    } catch {
      /* ignore */
    }
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
  // Chrome auto-pauses long synthesis (~15s); without a nudge playback goes
  // silent mid-message with the button stuck on "Stop".
  try {
    resumeTimer = setInterval(() => {
      try {
        // An external stop bumps the generation without touching this
        // run's timer; self-clear so a superseded run never leaks.
        if (cancelled || generation !== activeGeneration) {
          cleanup();
          return;
        }
        if (synthesis.paused && (synthesis.speaking || synthesis.pending)) {
          synthesis.resume();
        }
      } catch {
        /* ignore */
      }
    }, 2000);
  } catch {
    /* ignore */
  }
  if (needsDelay) {
    // Let the async cancel() settle before queueing, or Chrome swallows the
    // first chunk and nothing plays.
    setTimeout(() => {
      if (!cancelled && generation === activeGeneration) speakNext();
      else cleanup();
    }, 60);
  } else {
    speakNext();
  }
  return cancelThis;
}

/** Where a browser that cannot speak locally gets its voice from. */
type SpeechEngine = "browser" | "server";

/**
 * Waits briefly for a browser that loads its voice list asynchronously.
 * Chrome and Safari populate `getVoices()` on a later task, so a voice list
 * that is empty right now does not prove the machine has no voices - but a list
 * still empty after the wait does.
 */
function waitForSpeechVoices(
  timeoutMs = VOICE_LOAD_TIMEOUT_MS
): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    if (typeof window === "undefined" || !isSpeechSynthesisSupported()) {
      resolve([]);
      return;
    }
    try {
      const immediate = window.speechSynthesis.getVoices();
      if (immediate.length) {
        resolve(immediate);
        return;
      }
    } catch {
      /* getVoices threw: treat it as voiceless rather than crashing. */
      resolve([]);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        window.speechSynthesis.onvoiceschanged = null;
      } catch {
        /* Non-DOM environment - nothing to unhook. */
      }
      try {
        resolve(window.speechSynthesis.getVoices());
      } catch {
        resolve([]);
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      window.speechSynthesis.onvoiceschanged = finish;
    } catch {
      /* Cannot observe the change - settle on the timeout only. */
    }
  });
}

/**
 * Decides how to speak: locally when the browser has a voice, over the network
 * when it does not.
 */
export async function resolveSpeechEngine(): Promise<SpeechEngine> {
  if (!isSpeechSynthesisSupported()) return "server";
  const voices = await waitForSpeechVoices();
  return voices.length ? "browser" : "server";
}

/** The language tag the server synthesises with, e.g. `en` or `pt-BR`. */
export function browserSpeechLanguage(): string | null {
  if (typeof navigator === "undefined") return null;
  const tag = navigator.language;
  return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(tag) ? tag : null;
}

/** Builds the `/api/speech` request URL for a message. */
export function speechRequestUrl(
  text: string,
  language?: string | null
): string {
  const params = new URLSearchParams({ text });
  if (language) params.set("lang", language);
  return `${SPEECH_ENDPOINT}?${params.toString()}`;
}

/**
 * Plays server-synthesised audio for `text`. Returns a stop function that also
 * revokes the object URL, so a cancelled message never leaks a blob.
 */
async function speakWithServerAudio(
  text: string,
  options: SpeakOptions = {}
): Promise<() => void> {
  let url: string | null = null;
  let audio: HTMLAudioElement | null = null;
  const cleanup = () => {
    if (activeAudioUrl === url) activeAudioUrl = null;
    if (activeAudio === audio) activeAudio = null;
    const toRelease = url;
    url = null;
    if (toRelease) {
      try {
        URL.revokeObjectURL(toRelease);
      } catch {
        /* Already revoked - nothing to release. */
      }
    }
  };
  try {
    const response = await fetch(
      speechRequestUrl(text, browserSpeechLanguage()),
      {
        credentials: "include",
      }
    );
    if (!response.ok)
      throw new Error(`Speech request failed (${response.status})`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("Speech response was empty");
    // A blob URL is used because the MP3 arrives as a body, not a resource the
    // browser can stream straight into an audio element.
    url = URL.createObjectURL(blob);
    audio = new Audio();
    audio.src = url;
    if (options.rate) audio.playbackRate = options.rate;
    // `play()` rejects when the browser or a newer run refuses playback; the
    // handlers below ignore it via the activeAudio identity check.
    await audio.play();
    activeAudio = audio;
    activeAudioUrl = url;
    audio.onended = () => {
      cleanup();
      options.onEnd?.();
    };
    audio.onerror = () => {
      cleanup();
      options.onError?.();
    };
    return () => {
      const playing = audio;
      if (!playing) return;
      try {
        playing.pause();
      } catch {
        /* Nothing was playing. */
      }
      cleanup();
    };
  } catch {
    try {
      audio?.pause();
    } catch {
      /* Nothing was playing. */
    }
    cleanup();
    options.onError?.();
    return () => {};
  }
}

/**
 * Reads `text` aloud with whichever engine this browser can actually speak,
 * and returns a stop function. `text` must already be cleaned for speech via
 * `stripMarkdownForSpeech`.
 *
 * Prefers the local voice, falls back to the server one when the browser has no
 * voice at all, and falls back again if the local engine fails mid-message -
 * the classic symptom of a machine whose speechSynthesis exists but has nothing
 * to speak with, which reports no error until playback is abandoned.
 */
export async function speakMessage(
  text: string,
  options: SpeakOptions = {}
): Promise<() => void> {
  const stop = () => stopAllSpeech();
  const clean = (text ?? "").trim();
  if (!clean) {
    options.onError?.();
    return stop;
  }
  const engine = await resolveSpeechEngine();
  if (engine === "server") return speakWithServerAudio(clean, options);

  let usingServerFallback = false;
  const stopLocal = speakChunks(chunkSpokenText(clean), {
    ...options,
    onError: () => {
      if (usingServerFallback) {
        options.onError?.();
        return;
      }
      // One failure is enough: a second erroring chunk must not trigger a
      // second network read.
      usingServerFallback = true;
      // The local engine failed. Retry the whole message over the network
      // before telling the user it could not be read.
      void speakWithServerAudio(clean, options);
    },
  });
  return stopLocal;
}
