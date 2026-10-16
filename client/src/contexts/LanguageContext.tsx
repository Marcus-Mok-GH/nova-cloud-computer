import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LANGUAGE,
  languages,
  languageLocale,
  resolveLanguage,
  translate,
  type LanguageOption,
  type TranslationKey,
  type TranslationVars,
} from "@/i18n";

const STORAGE_KEY = "nova.language";

export type { TranslationVars };

export type TranslateFn = (key: TranslationKey, vars?: TranslationVars) => string;

/** Picks the `_one`/`_other` variant of a key by count (both exist per pair). */
export type TranslatePluralFn = (
  oneKey: TranslationKey,
  otherKey: TranslationKey,
  count: number,
  vars?: TranslationVars
) => string;

/** The language the visitor last chose, or null when they never chose one. */
function readStoredLanguage(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return resolveLanguage(stored);
  } catch {
    /* localStorage can be unavailable (SSR, privacy mode) */
  }
  return null;
}

/** The visitor's browser language when it is one Nova supports, else null. */
function detectBrowserLanguage(): string | null {
  try {
    const detected = resolveLanguage(navigator.language);
    return detected === DEFAULT_LANGUAGE && !navigator.language.toLowerCase().startsWith("en")
      ? null
      : detected;
  } catch {
    return null;
  }
}

/**
 * Armed by main.tsx right before hydrateRoot. The render that adopts the
 * server-rendered landing page must reproduce the server's markup exactly,
 * and the server cannot know the visitor's stored language - so the provider
 * defers its storage read until that render has committed (mirrors
 * ThemeContext's hydration pass).
 */
let hydrationPass = false;

/** Defers the stored-language read to just after hydration. */
export function beginLanguageHydrationPass() {
  hydrationPass = true;
}

interface LanguageContextType {
  /** Active language id, e.g. "en" or "zh". */
  language: string;
  /** BCP-47 locale tag for the active language (dates, document.lang). */
  locale: string;
  /** All selectable languages. */
  languages: LanguageOption[];
  setLanguage: (id: string) => void;
  t: TranslateFn;
  tPlural: TranslatePluralFn;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

function makeTranslate(language: string): TranslateFn {
  return (key, vars) => translate(language, key, vars);
}

function makeTranslatePlural(t: TranslateFn): TranslatePluralFn {
  return (oneKey, otherKey, count, vars) =>
    t(count === 1 ? oneKey : otherKey, { ...vars, count });
}

/**
 * English fallback used when a component renders without a provider (unit
 * tests render pages directly). Keeps `useTranslation()` safe everywhere.
 */
const fallbackValue: LanguageContextType = {
  language: DEFAULT_LANGUAGE,
  locale: languageLocale(DEFAULT_LANGUAGE),
  languages,
  setLanguage: () => {},
  t: makeTranslate(DEFAULT_LANGUAGE),
  tPlural: (oneKey, otherKey, count, vars) =>
    translate(DEFAULT_LANGUAGE, count === 1 ? oneKey : otherKey, { ...vars, count }),
};

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<string>(() => {
    // The hydration render skips the stored language so its markup matches the
    // server's; the effect below adopts it once that render has committed.
    if (hydrationPass) return DEFAULT_LANGUAGE;
    return readStoredLanguage() ?? detectBrowserLanguage() ?? DEFAULT_LANGUAGE;
  });

  // True for the render that adopts the server markup (armed by
  // beginLanguageHydrationPass) until the stored language has been applied.
  const pendingHydrationAdoption = React.useRef(hydrationPass);

  useEffect(() => {
    if (pendingHydrationAdoption.current) {
      pendingHydrationAdoption.current = false;
      const stored = readStoredLanguage();
      if (stored && stored !== language) {
        setLanguageState(stored);
        return;
      }
    }
    document.documentElement.lang = languageLocale(language);
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* ignore write failures */
    }
  }, [language]);

  const setLanguage = useCallback((id: string) => setLanguageState(resolveLanguage(id)), []);

  const value = useMemo<LanguageContextType>(() => {
    const t = makeTranslate(language);
    return {
      language,
      locale: languageLocale(language),
      languages,
      setLanguage,
      t,
      tPlural: makeTranslatePlural(t),
    };
  }, [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * Translates UI strings. Outside a LanguageProvider it returns the English
 * base strings, so server renders and provider-less test renders are safe.
 */
export function useTranslation(): LanguageContextType {
  return useContext(LanguageContext) ?? fallbackValue;
}
