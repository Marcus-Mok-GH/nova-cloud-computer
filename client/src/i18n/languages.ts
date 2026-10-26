/**
 * The language registry, kept free of dictionary imports so tooling (e.g.
 * scripts/translate-locales.ts) can use it without pulling in every locale.
 */
export interface LanguageOption {
  id: string;
  /** The language's own name for itself, shown in the picker. */
  label: string;
  /** BCP-47 tag used for `document.lang` and date/number formatting. */
  locale: string;
  /** English name, used as the translation target in generator prompts. */
  englishName: string;
  /** Writes right to left, so the layout has to mirror. */
  rtl?: boolean;
}

export const DEFAULT_LANGUAGE = "en";

/** Every selectable interface language. */
export const languages: LanguageOption[] = [
  { id: "en", label: "English", locale: "en", englishName: "English" },
  { id: "es", label: "Español", locale: "es", englishName: "Spanish" },
  { id: "fr", label: "Français", locale: "fr", englishName: "French" },
  { id: "de", label: "Deutsch", locale: "de", englishName: "German" },
  { id: "pt", label: "Português", locale: "pt", englishName: "Portuguese" },
  { id: "zh", label: "中文（简体）", locale: "zh-CN", englishName: "Simplified Chinese" },
  { id: "ja", label: "日本語", locale: "ja", englishName: "Japanese" },
  { id: "ko", label: "한국어", locale: "ko-KR", englishName: "Korean" },
  { id: "hi", label: "हिन्दी", locale: "hi-IN", englishName: "Hindi" },
  { id: "ru", label: "Русский", locale: "ru-RU", englishName: "Russian" },
  { id: "pl", label: "Polski", locale: "pl-PL", englishName: "Polish" },
  { id: "nl", label: "Nederlands", locale: "nl-NL", englishName: "Dutch" },
  { id: "it", label: "Italiano", locale: "it-IT", englishName: "Italian" },
  { id: "tr", label: "Türkçe", locale: "tr-TR", englishName: "Turkish" },
  { id: "vi", label: "Tiếng Việt", locale: "vi-VN", englishName: "Vietnamese" },
  { id: "id", label: "Bahasa Indonesia", locale: "id-ID", englishName: "Indonesian" },
  { id: "ar", label: "العربية", locale: "ar", englishName: "Arabic", rtl: true },
];

/** Accepts any stored/detected value and returns a supported language id. */
export function resolveLanguage(value: string | null | undefined): string {
  if (!value) return DEFAULT_LANGUAGE;
  if (languages.some(language => language.id === value)) return value;
  // Browser tags arrive as e.g. "es-MX": match on the base subtag.
  const base = value.toLowerCase().split(/[-_]/)[0];
  if (languages.some(language => language.id === base)) return base;
  return DEFAULT_LANGUAGE;
}

/** BCP-47 locale tag for a language id (for dates and `document.lang`). */
export function languageLocale(id: string): string {
  return languages.find(language => language.id === id)?.locale ?? "en";
}

/** Text direction for a language id (for `document.dir` and mirrored layouts). */
export function languageDirection(id: string): "ltr" | "rtl" {
  return languages.find(language => language.id === id)?.rtl ? "rtl" : "ltr";
}
