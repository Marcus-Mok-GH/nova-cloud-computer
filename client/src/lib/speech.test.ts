import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserSpeechLanguage,
  chunkSpokenText,
  resolveSpeechEngine,
  speakMessage,
  speechRequestUrl,
  stopAllSpeech,
  stripMarkdownForSpeech,
} from "./speech";

/** A minimal stand-in for `window.speechSynthesis` with no voices listed. */
function silentSynthesis() {
  const events: string[] = [];
  return {
    getVoices: () => [],
    speaking: false,
    pending: false,
    paused: false,
    cancel: () => {},
    speak: () => events.push("speak"),
    resume: () => {},
    onvoiceschanged: null,
    events,
  };
}

/** A minimal stand-in for `window.speechSynthesis` that has one voice. */
function voicedSynthesis() {
  return {
    ...silentSynthesis(),
    getVoices: () => [{ default: true, lang: "en-US", name: "Test Voice" }],
  };
}

/** A minimal stand-in for the `<audio>` element the server engine plays. */
function fakeAudio() {
  const listeners = new Map<string, () => void>();
  return {
    src: "",
    playbackRate: 1,
    paused: false,
    listeners,
    play: vi.fn(async () => {}),
    pause: () => {
      // Nothing to pause in the stub.
    },
    addEventListener: (_type: string, handler: () => void) =>
      listeners.set(_type, handler),
    emit: (type: string) => listeners.get(type)?.(),
    ended: false,
  };
}

let originalWindow: unknown;
let originalFetch: unknown;
let originalAudio: unknown;
let originalCreateObjectURL: unknown;

/** Installs a fake `window`, `fetch`, `Audio` and `URL.createObjectURL`. */
function installBrowser(options: {
  synthesis?: "none" | "silent" | "voiced";
  fetch?: ReturnType<typeof vi.fn>;
  events?: string[];
}) {
  const events = options.events ?? [];
  const synthesis =
    options.synthesis === "silent"
      ? silentSynthesis()
      : options.synthesis === "voiced"
        ? voicedSynthesis()
        : undefined;
  const localWindow: Record<string, unknown> = {
    dispatchEvent: (event: Event) => {
      events.push((event as CustomEvent).type);
      return true;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  if (synthesis) localWindow.speechSynthesis = synthesis;
  if (options.synthesis !== "none") {
    localWindow.SpeechSynthesisUtterance = class {};
    localWindow.CustomEvent = CustomEvent;
  }
  (globalThis as Record<string, unknown>).window = localWindow;
  return { localWindow, synthesis };
}

function fetchOk(body = new Uint8Array([0xff, 0xf3, 0x84, 0xc4, 1, 2, 3])) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => ({ size: body.length, body }),
  }));
}

beforeEach(() => {
  originalWindow = (globalThis as Record<string, unknown>).window;
  originalFetch = (globalThis as Record<string, unknown>).fetch;
  originalAudio = (globalThis as Record<string, unknown>).Audio;
  originalCreateObjectURL = URL.createObjectURL;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).window = originalWindow;
  (globalThis as Record<string, unknown>).fetch = originalFetch;
  (globalThis as Record<string, unknown>).Audio = originalAudio;
  URL.createObjectURL = originalCreateObjectURL as typeof URL.createObjectURL;
  vi.useRealTimers();
});

describe("resolveSpeechEngine", () => {
  it("uses the browser engine when a voice is available", async () => {
    installBrowser({ synthesis: "voiced" });
    await expect(resolveSpeechEngine()).resolves.toBe("browser");
  });

  it("falls back to the server engine when the browser has no speech API", async () => {
    delete (globalThis as Record<string, unknown>).window;
    await expect(resolveSpeechEngine()).resolves.toBe("server");
  });

  it("falls back when the speech API exists but reports no voice", async () => {
    // The reported failure: a browser where speechSynthesis is present but the
    // OS ships no voices, so speak() never utters and no error is raised.
    installBrowser({ synthesis: "silent" });
    await expect(resolveSpeechEngine()).resolves.toBe("server");
  });
});

describe("speakMessage", () => {
  it("speaks locally when a voice is available", async () => {
    const { synthesis } = installBrowser({ synthesis: "voiced" });
    const fetchMock = fetchOk();
    (globalThis as Record<string, unknown>).fetch = fetchMock;
    await speakMessage("Hello there.");
    expect(synthesis?.events).toContain("speak");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests server audio when the browser cannot speak", async () => {
    installBrowser({ synthesis: "silent" });
    const fetchMock = fetchOk();
    (globalThis as Record<string, unknown>).fetch = fetchMock;
    const audio = fakeAudio();
    (globalThis as Record<string, unknown>).Audio = vi.fn(() => audio);
    URL.createObjectURL = (() => "blob:nova") as typeof URL.createObjectURL;

    await speakMessage("Hello from Nova.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/speech?");
    expect(url).toContain("text=Hello+from+Nova.");
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src).toBe("blob:nova");
  });

  it("falls back to the server voice when the local engine fails", async () => {
    // The reported symptom in its subtler form: the browser reports the Web
    // Speech API and even has a voice listed, then fails to utter anything.
    const spoken: { onerror?: (event: unknown) => void; text?: string }[] = [];
    const { localWindow } = installBrowser({ synthesis: "voiced" });
    const fetchMock = fetchOk();
    (globalThis as Record<string, unknown>).fetch = fetchMock;
    const audio = fakeAudio();
    (globalThis as Record<string, unknown>).Audio = vi.fn(() => audio);
    URL.createObjectURL = (() => "blob:nova") as typeof URL.createObjectURL;
    (localWindow as Record<string, unknown>).SpeechSynthesisUtterance = class {
      constructor(text: string) {
        this.text = text;
        spoken.push(this);
      }
    };

    await speakMessage("Hello from Nova.");
    expect(spoken).toHaveLength(1);

    // The local engine reports a real playback failure.
    (spoken[0].onerror as (event: unknown) => void)?.({
      error: "synthesis-failed",
    });
    // The retry is scheduled off the error, so let the microtasks drain.
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/speech?");
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("reports an error and asks for nothing when there is no text", async () => {
    installBrowser({ synthesis: "voiced" });
    const fetchMock = fetchOk();
    (globalThis as Record<string, unknown>).fetch = fetchMock;
    const onError = vi.fn();
    await speakMessage("   ", { onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an error when the server route answers with a failure", async () => {
    installBrowser({ synthesis: "silent" });
    (globalThis as Record<string, unknown>).fetch = vi.fn(async () => ({
      ok: false,
      status: 502,
      blob: async () => ({ size: 0 }),
    }));
    const audio = fakeAudio();
    (globalThis as Record<string, unknown>).Audio = vi.fn(() => audio);
    URL.createObjectURL = (() => "blob:nova") as typeof URL.createObjectURL;

    const onError = vi.fn();
    await speakMessage("Hello from Nova.", { onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(audio.play).not.toHaveBeenCalled();
  });
});

describe("speechRequestUrl", () => {
  it("sends the text to the speech endpoint", () => {
    const url = speechRequestUrl("Hello there.");
    expect(url.startsWith("/api/speech?text=Hello+there.")).toBe(true);
    expect(url).not.toContain("lang=");
  });

  it("forwards a language tag when there is one", () => {
    const url = speechRequestUrl("Ola", "pt-BR");
    expect(url).toContain("lang=pt-BR");
  });

  it("keeps a long message intact", () => {
    const text = "word ".repeat(500).trim();
    const params = new URLSearchParams(speechRequestUrl(text).split("?")[1]);
    expect(params.get("text")).toBe(text);
  });
});

describe("browserSpeechLanguage", () => {
  it("returns a well-formed language tag", () => {
    const value = browserSpeechLanguage();
    expect(value).toMatch(/^[a-z]{2}(?:-[a-z]{2})?$/i);
  });

  it("returns null for a tag that must not be forwarded", () => {
    const original = navigator.language;
    Object.defineProperty(navigator, "language", {
      value: "en-US-x?",
      configurable: true,
    });
    try {
      expect(browserSpeechLanguage()).toBeNull();
    } finally {
      Object.defineProperty(navigator, "language", {
        value: original,
        configurable: true,
      });
    }
  });
});

describe("stopAllSpeech", () => {
  it("notifies every button when called with no browser globals", () => {
    delete (globalThis as Record<string, unknown>).window;
    expect(() => stopAllSpeech()).not.toThrow();
  });
});

describe("speech text preparation", () => {
  it("still strips Markdown before speaking", () => {
    expect(stripMarkdownForSpeech("**bold** [link](https://x.test)")).toBe(
      "bold link"
    );
  });

  it("still splits long text into bounded chunks", () => {
    const chunks = chunkSpokenText("word ".repeat(400), 220);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(220);
  });
});
