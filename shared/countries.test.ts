import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, languageForCountry } from "./countries";
import { languages } from "../client/src/i18n/languages";

describe("shared country registry", () => {
  it("holds unique uppercase ISO 3166-1 alpha-2 codes", () => {
    expect(COUNTRY_CODES.length).toBe(249);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("maps a country to a language Nova actually ships", () => {
    const known = new Set(languages.map(language => language.id));
    // One representative country per mapped language; hi ships no country
    // (India stays unmapped), which the unmapped test below documents.
    const samples: Record<string, string> = {
      MX: "es",
      FR: "fr",
      DE: "de",
      BR: "pt",
      CN: "zh",
      JP: "ja",
      KR: "ko",
      RU: "ru",
      PL: "pl",
      NL: "nl",
      IT: "it",
      TR: "tr",
      VN: "vi",
      ID: "id",
      SA: "ar",
      US: "en",
    };
    for (const [code, language] of Object.entries(samples)) {
      expect(languageForCountry(code)).toBe(language);
      expect(known.has(language)).toBe(true);
    }
    // Every mapped id must exist in the language registry.
    for (const code of COUNTRY_CODES) {
      const language = languageForCountry(code);
      if (language) expect(known.has(language)).toBe(true);
    }
  });

  it("leaves multilingual and unsupported-language countries unmapped", () => {
    // Two or more supported languages share the formal role there: the
    // browser's language has to decide instead of a guess.
    for (const code of ["CA", "BE", "CH", "LU", "IN"]) {
      expect(languageForCountry(code)).toBeNull();
    }
    // The country's own language is not one Nova ships.
    for (const code of ["TH", "SE", "UA", "MY", "LK", "BD", "SO"]) {
      expect(languageForCountry(code)).toBeNull();
    }
    // Unknown/absent codes never map.
    expect(languageForCountry("XX")).toBeNull();
    expect(languageForCountry(null)).toBeNull();
    expect(languageForCountry(undefined)).toBeNull();
    expect(languageForCountry("")).toBeNull();
  });

  it("accepts lowercase and whitespace-padded codes", () => {
    expect(languageForCountry(" mx ")).toBe("es");
    expect(languageForCountry("fr")).toBe("fr");
  });
});
