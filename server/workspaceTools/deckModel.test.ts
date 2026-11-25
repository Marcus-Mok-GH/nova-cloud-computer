import { describe, expect, it } from "vitest";
import { deriveInk, getTheme, normaliseDeck, normaliseDesign, parseDeck, THEMES } from "./deckModel";

describe("normaliseDeck", () => {
  it("creates a full deck with a preset theme instead of custom colours", () => {
    const result = normaliseDeck({
      title: "  Q3 plan  ",
      design: { theme: "swiss-blue", density: "airy" },
      slides: [
        { id: "s1", layout: "cover", title: "Q3 plan", bullets: [] },
        { id: "s2", layout: "bullets", title: "Wins", bullets: ["Revenue up"] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Q3 plan");
    expect(result.value.design).toEqual({ theme: "swiss-blue", density: "airy" });
    expect(result.value.slides).toHaveLength(2);
  });

  it("accepts every registered theme and defaults sensibly", () => {
    for (const theme of THEMES) {
      expect(normaliseDesign({ theme: theme.name }).theme).toBe(theme.name);
    }
    expect(normaliseDesign({})).toEqual({ theme: "ink-classic", density: "balanced" });
    expect(normaliseDesign({ theme: "not-a-theme" }).theme).toBe("ink-classic");
    expect(getTheme("forest-ink").style).toBe("magazine");
  });

  it("migrates legacy hex designs onto a theme and caps content density", () => {
    const result = normaliseDeck({
      title: "Legacy",
      design: { background: "#FFF4E6", accent: "#C56A32", font: "Times", motif: "dots" },
      slides: [
        {
          id: "s1",
          layout: "bullets",
          title: "Wins",
          bullets: ["1", "2", "3", "4", "5", "6"],
          items: Array.from({ length: 9 }, (_, index) => ({ label: `L${index}`, value: `${index}` })),
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(THEMES.map(theme => theme.name)).toContain(result.value.design.theme);
    expect(JSON.stringify(result.value.design)).not.toContain("#");
    expect(result.value.slides[0].bullets).toHaveLength(5);
    expect(result.value.slides[0].items).toHaveLength(6);
  });

  it("rejects no slides, malformed slides and too many slides", () => {
    expect(normaliseDeck({ title: "x", slides: [] }).ok).toBe(false);
    expect(normaliseDeck({ title: "x", slides: [{ title: 4 }] }).ok).toBe(false);
    expect(
      normaliseDeck({
        title: "x",
        slides: Array.from({ length: 21 }, (_, i) => ({ id: `s${i}`, layout: "bullets", title: "x" })),
      }).ok
    ).toBe(false);
  });
});

describe("deriveInk", () => {
  it("picks dark ink on light backgrounds and light ink on dark ones", () => {
    expect(deriveInk("#FFF4E6")).toBe("#241C17");
    expect(deriveInk("#1F1A17")).toBe("#F7F1E8");
  });
});

describe("parseDeck", () => {
  it("round-trips a stored deck file", () => {
    const deck = normaliseDeck({
      title: "D", design: {}, slides: [{ id: "s1", layout: "cover", title: "D" }],
    });
    expect(deck.ok).toBe(true);
    if (!deck.ok) return;
    expect(parseDeck(JSON.stringify(deck.value))).toEqual(deck.value);
  });
});
