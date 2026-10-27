import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { TranslationKey } from "@/i18n";

type ThemeMode = "light" | "dark";

export interface ThemeOption {
  /** Matches a `[data-theme="..."]` palette block in index.css. */
  id: string;
  /** Translation key for the palette's name. */
  labelKey: TranslationKey;
  mode: ThemeMode;
  /** Translation key for the palette's one-line description. */
  descriptionKey: TranslationKey;
}

/** Every selectable palette. Keep in sync with the blocks in index.css. */
export const themes: ThemeOption[] = [
  { id: "daylight", labelKey: "settings.theme.name.daylight", mode: "light", descriptionKey: "settings.theme.desc.daylight" },
  { id: "midnight", labelKey: "settings.theme.name.midnight", mode: "dark", descriptionKey: "settings.theme.desc.midnight" },
];

export const DEFAULT_LIGHT_THEME = "daylight";
export const DEFAULT_DARK_THEME = "midnight";

const STORAGE_KEY = "nova.theme";
/** Older releases stored only "light" or "dark" under this key. */
const LEGACY_STORAGE_KEY = "theme";

/** Look up a theme by id, falling back to the default light theme. */
export function getTheme(id: string | null | undefined): ThemeOption {
  return themes.find(theme => theme.id === id) ?? themes.find(theme => theme.id === DEFAULT_LIGHT_THEME)!;
}

/**
 * Accepts a palette id or a legacy "light"/"dark" mode and returns a
 * valid theme id.
 */
export function resolveThemeId(value: string | null | undefined): string {
  const match = themes.find(theme => theme.id === value);
  if (match) return match.id;
  if (value === "dark") return DEFAULT_DARK_THEME;
  return DEFAULT_LIGHT_THEME;
}

/** The palette the visitor last chose, or null when they never chose one. */
function readStoredThemeName(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return resolveThemeId(stored);
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return resolveThemeId(legacy);
  } catch {
    /* localStorage can be unavailable (SSR, privacy mode) */
  }
  return null;
}

/**
 * Armed by main.tsx right before hydrateRoot. The render that adopts the
 * server-rendered landing page has to reproduce the server's markup exactly,
 * and the server cannot know the visitor's stored palette - so ThemeProvider
 * defers its storage read until that render has committed, then adopts the
 * stored palette (see the effect in ThemeProvider).
 */
let hydrationPass = false;

/** Defers ThemeProvider's stored-palette read to just after hydration. */
export function beginHydrationPass() {
  hydrationPass = true;
}

interface ThemeContextType {
  /** Active mode, kept for backwards compatibility with existing consumers. */
  theme: ThemeMode;
  /** Active palette id. */
  themeName: string;
  /** All selectable palettes. */
  themes: ThemeOption[];
  setThemeName: (id: string) => void;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  /** A palette id or a legacy "light"/"dark" mode. */
  defaultTheme?: string;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = DEFAULT_LIGHT_THEME,
  switchable = false,
}: ThemeProviderProps) {
  const [themeName, setThemeNameState] = useState<string>(() => {
    // The hydration render skips the stored palette so its markup matches the
    // server's; the effect below adopts it once that render has committed.
    if (!switchable || hydrationPass) return resolveThemeId(defaultTheme);
    return readStoredThemeName() ?? resolveThemeId(defaultTheme);
  });

  const mode: ThemeMode = getTheme(themeName).mode;

  // Remember the most recent pick for each mode so toggling light/dark
  // returns to the palette the user chose rather than a generic default.
  const lastByMode = useRef<Record<ThemeMode, string>>({
    light: mode === "light" ? themeName : DEFAULT_LIGHT_THEME,
    dark: mode === "dark" ? themeName : DEFAULT_DARK_THEME,
  });

  const setThemeName = useCallback((id: string) => {
    const next = getTheme(id);
    lastByMode.current[next.mode] = next.id;
    setThemeNameState(next.id);
  }, []);

  // True for the render that adopts the server markup (armed by
  // beginHydrationPass) until the stored palette has been applied.
  const pendingHydrationAdoption = useRef(hydrationPass);

  useEffect(() => {
    if (pendingHydrationAdoption.current) {
      pendingHydrationAdoption.current = false;
      const stored = switchable ? readStoredThemeName() : null;
      if (stored && stored !== themeName) {
        // The re-render applies the adopted palette and persists it, so the
        // server's default is never written over the visitor's real choice.
        setThemeName(stored);
        return;
      }
    }

    const root = document.documentElement;
    root.dataset.theme = themeName;
    root.classList.toggle("dark", mode === "dark");
    root.style.colorScheme = mode;

    if (switchable) {
      try {
        localStorage.setItem(STORAGE_KEY, themeName);
      } catch {
        /* ignore write failures */
      }
    }
  }, [themeName, mode, switchable, setThemeName]);

  const toggleTheme = switchable
    ? () => {
        const nextMode: ThemeMode = mode === "light" ? "dark" : "light";
        const nextTheme = getTheme(lastByMode.current[nextMode]);
        lastByMode.current[nextMode] = nextTheme.id;
        setThemeNameState(nextTheme.id);
      }
    : undefined;

  const value = useMemo(
    () => ({ theme: mode, themeName, themes, setThemeName, toggleTheme, switchable }),
    [mode, themeName, setThemeName, toggleTheme, switchable]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
