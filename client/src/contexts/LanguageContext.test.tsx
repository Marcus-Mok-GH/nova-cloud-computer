import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LANGUAGE, languages, resolveLanguage, translate } from "@/i18n";
import { LanguageProvider, useTranslation } from "./LanguageContext";

type LanguageModule = typeof import("./LanguageContext");

/** Renders the provider's resolved language so a test can assert on it. */
function renderLanguage(module: LanguageModule): string {
  function LanguageProbe() {
    return <span>{module.useTranslation().language}</span>;
  }
  return renderToStaticMarkup(
    <module.LanguageProvider>
      <LanguageProbe />
    </module.LanguageProvider>
  ).replace(/<\/?span>/g, "");
}

/**
 * Loads a fresh copy of the module with a stored language in place, so the
 * one-time hydration flag cannot leak into other tests.
 */
async function loadWithStoredLanguage(id: string) {
  const stored = new Map<string, string>([["nova.language", id]]);
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
  return import("./LanguageContext");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("language catalog", () => {
  it("exposes unique languages that all resolve", () => {
    const ids = languages.map(language => language.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_LANGUAGE);
    for (const id of ids) expect(resolveLanguage(id)).toBe(id);
  });

  it("resolves browser tags and falls back to English", () => {
    expect(resolveLanguage("es-MX")).toBe("es");
    expect(resolveLanguage("zh-Hans-CN")).toBe("zh");
    expect(resolveLanguage("fr")).toBe("fr");
    expect(resolveLanguage("not-a-language")).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage(null)).toBe(DEFAULT_LANGUAGE);
    expect(resolveLanguage("")).toBe(DEFAULT_LANGUAGE);
  });
});

describe("translate", () => {
  it("looks up keys per language with English fallback", () => {
    expect(translate("en", "common.save")).toBe("Save");
    for (const language of languages) {
      const value = translate(language.id, "common.save");
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
      expect(value).not.toBe("common.save");
    }
    // An unknown language falls back to English.
    expect(translate("klingon", "common.save")).toBe("Save");
  });

  it("interpolates {{tokens}} and leaves unknown tokens intact", () => {
    expect(translate("en", "layout.navUnread", { label: "Chats", count: 3 })).toBe("Chats, 3 unread");
    expect(translate("en", "layout.navUnread")).toBe("{{label}}, {{count}} unread");
  });
});

describe("LanguageProvider", () => {
  it("renders children and defaults to English", () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider>
        <span>language child</span>
      </LanguageProvider>
    );
    expect(markup).toContain("language child");
  });

  it("useTranslation falls back to English outside a provider", () => {
    function Probe() {
      const { t, language } = useTranslation();
      return <span>{`${language}:${t("common.save")}`}</span>;
    }
    expect(renderToStaticMarkup(<Probe />)).toContain("en:Save");
  });

  it("reads the stored language on a normal client render", async () => {
    const module = await loadWithStoredLanguage("de");
    expect(renderLanguage(module)).toBe("de");
  });

  it("defers the stored language so the hydration render matches the server markup", async () => {
    const module = await loadWithStoredLanguage("de");
    module.beginLanguageHydrationPass();
    expect(renderLanguage(module)).toBe(DEFAULT_LANGUAGE);
  });
});
