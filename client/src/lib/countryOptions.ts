import { COUNTRY_CODES } from "@shared/countries";

export interface CountryOption {
  code: string;
  /** The country's name in `locale`, falling back to the raw ISO code. */
  name: string;
}

/**
 * Every ISO country as `{ code, name }`, named through Intl.DisplayNames in
 * `locale` and sorted by that name - so the picker relabels and re-sorts
 * itself the moment the interface language changes. Runtimes without
 * Intl.DisplayNames fall back to the raw codes.
 */
export function buildCountryOptions(locale: string): CountryOption[] {
  let displayNames: Intl.DisplayNames | null = null;
  try {
    displayNames = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    /* Intl.DisplayNames is unavailable - fall back to the codes */
  }
  return COUNTRY_CODES.map(code => ({
    code,
    name: displayNames?.of(code) ?? code,
  })).sort((a, b) => a.name.localeCompare(b.name, locale));
}
