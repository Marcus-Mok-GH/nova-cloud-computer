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

describe("boot guard theme application", () => {
  it("applies a saved dark palette before React hydrates", () => {
    const state = runBootGuard({ "nova.theme": "nebula" });
    expect(state.attributes["data-theme"]).toBe("nebula");
    expect(state.classes.has("dark")).toBe(true);
    expect(state.style.colorScheme).toBe("dark");
  });

  it("applies a saved light palette without the dark class", () => {
    const state = runBootGuard({ "nova.theme": "ocean" });
    expect(state.attributes["data-theme"]).toBe("ocean");
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
    const state = runBootGuard({ "nova.theme": "pine", theme: "light" });
    expect(state.attributes["data-theme"]).toBe("pine");
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
