import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, ThemeProvider, getTheme, resolveThemeId, themes } from "./ThemeContext";

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
