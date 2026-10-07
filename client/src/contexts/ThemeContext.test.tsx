import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, ThemeProvider, getTheme, resolveThemeId, themes } from "./ThemeContext";

type ThemeModule = typeof import("./ThemeContext");

/** Renders the provider's resolved palette so a test can assert on it. */
function renderThemeName(module: ThemeModule): string {
  function ThemeProbe() {
    return <span>{module.useTheme().themeName}</span>;
  }
  const markup = renderToStaticMarkup(
    <module.ThemeProvider defaultTheme="light" switchable>
      <ThemeProbe />
    </module.ThemeProvider>
  );
  return markup.replace(/<\/?span>/g, "");
}

/**
 * Loads a fresh copy of the module with a stored palette in place, so the
 * one-time hydration flag cannot leak into other tests.
 */
async function loadWithStoredTheme() {
  const stored = new Map<string, string>([["nova.theme", "nebula"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  });
  vi.resetModules();
  return import("./ThemeContext");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ThemeContext theme catalog", () => {
  it("exposes unique light and dark themes", () => {
    const ids = themes.map(theme => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(themes.filter(theme => theme.mode === "light").length).toBeGreaterThan(1);
    expect(themes.filter(theme => theme.mode === "dark").length).toBeGreaterThan(1);
  });

  it("keeps the default theme ids valid and correctly typed", () => {
    expect(getTheme(DEFAULT_LIGHT_THEME).mode).toBe("light");
    expect(getTheme(DEFAULT_DARK_THEME).mode).toBe("dark");
  });

  it("resolves palette ids and legacy light/dark values", () => {
    expect(resolveThemeId("ocean")).toBe("ocean");
    expect(resolveThemeId("deepsea")).toBe("deepsea");
    expect(resolveThemeId("light")).toBe(DEFAULT_LIGHT_THEME);
    expect(resolveThemeId("dark")).toBe(DEFAULT_DARK_THEME);
    expect(resolveThemeId(null)).toBe(DEFAULT_LIGHT_THEME);
    expect(resolveThemeId("not-a-theme")).toBe(DEFAULT_LIGHT_THEME);
  });

  it("falls back to the default light theme when an id is unknown", () => {
    expect(getTheme("nope").id).toBe(DEFAULT_LIGHT_THEME);
  });

  it("renders children for any configured default theme", () => {
    const markup = renderToStaticMarkup(
      <ThemeProvider defaultTheme="pine">
        <span>theme child</span>
      </ThemeProvider>
    );
    expect(markup).toContain("theme child");
  });
});

describe("ThemeContext hydration pass", () => {
  it("reads the stored palette on a normal client render", async () => {
    const module = await loadWithStoredTheme();
    expect(renderThemeName(module)).toBe("nebula");
  });

  it("defers the stored palette so the hydration render matches the server markup", async () => {
    const module = await loadWithStoredTheme();
    module.beginHydrationPass();
    expect(renderThemeName(module)).toBe(DEFAULT_LIGHT_THEME);
  });
});
