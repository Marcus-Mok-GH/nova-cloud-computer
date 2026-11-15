import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DARK_THEME,
  DEFAULT_LIGHT_THEME,
  themes,
} from "./contexts/ThemeContext";

/**
 * `client/index.html` applies the stored palette to <html> before first paint,
 * which is what keeps a dark-theme visitor from seeing a light flash while the
 * bundle loads. That logic is inline (it cannot import ThemeContext), so these
 * tests run it against a stubbed document and keep its duplicated palette
 * catalog in sync with ThemeContext's.
 */
const INDEX_HTML = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8"
);

function bootGuardScript(): string {
  const script = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .find(source => source.includes("Boot guard"));
  if (!script)
    throw new Error("client/index.html no longer contains the boot guard script");
  return script;
}

type HtmlState = {
  attributes: Record<string, string>;
  classes: Set<string>;
  style: Record<string, string>;
};

/** Runs the boot guard's inline script against a localStorage of `entries`. */
function runBootGuard(entries: Record<string, string>): HtmlState {
  const attributes: Record<string, string> = {};
  const classes = new Set<string>();
  const style: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => entries[key] ?? null,
    setItem: () => {},
    removeItem: () => {},
  };
  const documentStub = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
      getAttribute: (name: string) => attributes[name] ?? null,
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force) classes.add(name);
          else classes.delete(name);
        },
      },
      style,
    },
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute: () => {} }),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { appendChild: () => {} },
    readyState: "complete",
  };

  const run = new Function(
    "localStorage",
    "sessionStorage",
    "document",
    "window",
    "location",
    "navigator",
    "setTimeout",
    "clearTimeout",
    bootGuardScript()
  );
  run(
    storage,
    storage,
    documentStub,
    { addEventListener: () => {} },
    { search: "", href: "http://localhost/" },
    { userAgent: "vitest" },
    () => 0,
    () => 0
  );

  return { attributes, classes, style };
}

/** Palette ids listed in the boot guard's `DARK`/`LIGHT` maps. */
function bootGuardPaletteIds(script: string, name: "DARK" | "LIGHT") {
  const body = new RegExp(`var ${name} = \\{([^}]*)\\};`).exec(script)?.[1];
  if (body === undefined)
    throw new Error(`the boot guard no longer defines ${name}`);
  return body
    .split(",")
    .map(entry => entry.split(":")[0].trim())
    .filter(Boolean)
    .sort();
}

const themeIds = (mode: "light" | "dark") =>
  themes
    .filter(theme => theme.mode === mode)
    .map(theme => theme.id)
    .sort();

/**
 * `client/index.html` paints the boot wordmark before any JavaScript runs: a
 * solid base word with an animated light band clipped over it. These keep the
 * animation from silently becoming a static word - the failure mode being a
 * sweep range that parks the band off-canvas for the whole loop.
 */
describe("boot wordmark animation", () => {
  const bootMarkup = (): string => {
    const boot = /<div id="boot"[\s\S]*?<\/div>\s*<\/div>/.exec(INDEX_HTML)?.[0];
    if (!boot) throw new Error("client/index.html no longer contains the boot screen");
    return boot;
  };

  const bootStyles = (): string => {
    const style = [...INDEX_HTML.matchAll(/<style>([\s\S]*?)<\/style>/g)]
      .map(match => match[1])
      .find(source => source.includes("#boot-word"));
    if (!style) throw new Error("client/index.html no longer styles #boot-word");
    return style;
  };

  it("renders the wordmark with a solid base layer and an animated overlay", () => {
    const boot = bootMarkup();
    expect(boot).toContain('id="boot-word"');
    // a base word (fallback if the gradient or clip does not paint) plus the
    // animated layer on top
    expect((boot.match(/<span/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(boot).toContain('class="bw-flow"');
    // the wordmark carries the brand capitalisation, in both layers
    expect((boot.match(/>Nova</g) || []).length).toBe(2);
  });

  it("stands in for the old 'Starting Nova...' line while loading", () => {
    const boot = bootMarkup();
    // the animated wordmark IS the loading state; the headline is reserved for
    // the error path, so it ships empty
    expect(boot).not.toContain("Starting Nova");
    const title = /<p id="boot-title"[^>]*>([\s\S]*?)<\/p>/.exec(boot);
    expect(title).toBeDefined();
    expect(title![1].trim()).toBe("");
  });

  it("keeps the boot-title slot, because the error screen writes its headline there", () => {
    // Deleting #boot-title to "remove the text" would silently disable the boot
    // error state: fail() looks the element up and returns early when it is
    // missing, so the reload button and the message would never appear. These
    // assertions pin the element AND the behaviour that needs it.
    expect(bootMarkup()).toContain('id="boot-title"');
    expect(bootGuardScript()).toContain("Nova could not start");

    // run the real fail() path against a stub carrying the boot elements
    const elements: Record<string, { textContent: string; hidden?: boolean }> = {
      "boot-title": { textContent: "" },
      "boot-sub": { textContent: "" },
      "boot-retry": { textContent: "", hidden: true },
    };
    const attributes: Record<string, string> = {};
    const documentStub = {
      documentElement: {
        setAttribute: (n: string, v: string) => { attributes[n] = v; },
        getAttribute: (n: string) => attributes[n] ?? null,
        classList: { toggle: () => {} },
        style: {},
      },
      getElementById: (id: string) => elements[id] ?? null,
      createElement: () => ({ style: {}, setAttribute: () => {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { appendChild: () => {} },
      readyState: "complete",
    };
    const windowStub: { addEventListener: () => void; __novaFail?: (r?: string) => void } = {
      addEventListener: () => {},
    };
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    new Function(
      "localStorage", "sessionStorage", "document", "window", "location",
      "navigator", "setTimeout", "clearTimeout", bootGuardScript()
    )(
      storage, storage, documentStub, windowStub,
      { search: "", href: "http://localhost/" }, { userAgent: "vitest" },
      () => 0, () => 0
    );

    expect(typeof windowStub.__novaFail).toBe("function");
    windowStub.__novaFail!("boom");
    expect(elements["boot-title"].textContent).toBe("Nova could not start");
    expect(elements["boot-retry"].hidden).toBe(false);
  });

  it("clips the flowing band to the letterforms", () => {
    const styles = bootStyles();
    expect(styles).toMatch(/background-clip:\s*text/);
    expect(styles).toMatch(/-webkit-background-clip:\s*text/);
  });

  it("sweeps the band ACROSS the word rather than parking it off-canvas", () => {
    const styles = bootStyles();
    // With background-size (S x 100%) the painted image is S times the box wide,
    // and background-position p% shifts it by -(S-1)*box*p/100. A band sitting at
    // fraction b of the image therefore lands at the normalised box position
    //     x = b*S - (S-1)*(p/100)
    // (x=0 is the box's left edge, 1 its right edge; negative is off the left,
    // above 1 is off the right). The sweep must carry the band from off one side
    // to off the other, passing over the glyphs on the way. Ranges that keep
    // every stop on the same side - e.g. 195% -> 140% with S=2 gives x = -0.95 ->
    // -0.40 for a band at the image centre - render a static word that merely
    // looks like it should be moving, which is the bug this guards.
    const size = /background-size:\s*([\d.]+)%/.exec(styles);
    // capture the whole keyframes block: a lazy `\{([\s\S]*?)\}` stops at the
    // first inner `}` (the end of the 0% rule) and sees only one stop.
    const sweep = /@keyframes\s+nova-boot-flow\s*\{([\s\S]*?)\n\s*\}/.exec(styles);
    expect(size?.[1]).toBeDefined();
    expect(sweep?.[1]).toBeDefined();

    const S = Number(size![1]) / 100;
    const positions = [...sweep![1].matchAll(/background-position:\s*(-?[\d.]+)%/g)]
      .map(match => Number(match[1]));
    expect(positions.length).toBeGreaterThanOrEqual(2);

    // the band lives in the middle of the gradient, so b = 0.5
    const bandX = (p: number) => 0.5 * S - (S - 1) * (p / 100);
    const startX = bandX(positions[0]);
    const endX = bandX(positions[positions.length - 1]);

    // starts off the LEFT edge, passes over the glyphs, ends off the RIGHT edge
    // (measured in a real browser: 130% -> -30% with S=2 gives x = -0.30 -> 1.30)
    expect(startX).toBeLessThan(endX);
    expect(startX).toBeLessThan(0); // begins off the left edge
    expect(endX).toBeGreaterThan(1); // finishes off the right edge
  });

  it("stops animating for prefers-reduced-motion", () => {
    const styles = bootStyles();
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}/.exec(styles);
    expect(reduced?.[1]).toMatch(/animation:\s*none/);
  });

  it("keeps the boot screen's supporting text so it is never blank", () => {
    const boot = bootMarkup();
    // the animated wordmark is the loading state now, so the loading copy is the
    // wordmark plus the sub-line - and the error affordances must survive too
    expect(boot).toContain('id="boot-word"');
    expect(boot).toContain('id="boot-sub"');
    expect(boot).toContain("Loading your workspace");
    expect(boot).toContain('id="boot-retry"');
  });
});

describe("boot guard theme application", () => {
  it("applies a saved dark palette before React hydrates", () => {
    const state = runBootGuard({ "nova.theme": "midnight" });
    expect(state.attributes["data-theme"]).toBe("midnight");
    expect(state.classes.has("dark")).toBe(true);
    expect(state.style.colorScheme).toBe("dark");
  });

  it("applies a saved light palette without the dark class", () => {
    const state = runBootGuard({ "nova.theme": "daylight" });
    expect(state.attributes["data-theme"]).toBe("daylight");
    expect(state.classes.has("dark")).toBe(false);
    expect(state.style.colorScheme).toBe("light");
  });

  it("maps the legacy light/dark keys onto ThemeContext's defaults", () => {
    const dark = runBootGuard({ theme: "dark" });
    expect(dark.attributes["data-theme"]).toBe(DEFAULT_DARK_THEME);
    expect(dark.classes.has("dark")).toBe(true);

    const light = runBootGuard({ theme: "light" });
    expect(light.attributes["data-theme"]).toBe(DEFAULT_LIGHT_THEME);
    expect(light.classes.has("dark")).toBe(false);
  });

  it("prefers the current key over the legacy one", () => {
    const state = runBootGuard({ "nova.theme": "midnight", theme: "light" });
    expect(state.attributes["data-theme"]).toBe("midnight");
    expect(state.classes.has("dark")).toBe(true);
  });

  it("leaves the document untouched when nothing usable is stored", () => {
    for (const entries of [{}, { "nova.theme": "not-a-theme" }]) {
      const state = runBootGuard(entries);
      expect(state.attributes["data-theme"]).toBeUndefined();
      expect(state.classes.has("dark")).toBe(false);
      expect(state.style.colorScheme).toBeUndefined();
    }
  });

  it("ignores inherited object keys such as toString", () => {
    const state = runBootGuard({ "nova.theme": "toString" });
    expect(state.attributes["data-theme"]).toBeUndefined();
    expect(state.classes.has("dark")).toBe(false);
  });

  it("keeps its palette catalog and legacy mapping in sync with ThemeContext", () => {
    const script = bootGuardScript();
    expect(bootGuardPaletteIds(script, "DARK")).toEqual(themeIds("dark"));
    expect(bootGuardPaletteIds(script, "LIGHT")).toEqual(themeIds("light"));

    const legacy =
      /stored === "dark" \? "([^"]+)" : stored === "light" \? "([^"]+)"/.exec(
        script
      );
    expect(legacy?.[1]).toBe(DEFAULT_DARK_THEME);
    expect(legacy?.[2]).toBe(DEFAULT_LIGHT_THEME);
  });
});
