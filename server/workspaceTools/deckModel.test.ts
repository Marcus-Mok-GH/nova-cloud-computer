import { describe, expect, it } from "vitest";
import { deriveInk, normaliseDeck, parseDeck } from "./deckModel";

describe("normaliseDeck", () => {
  it("creates a full deck with a generated design spec", () => {
    const result = normaliseDeck({
      title: "  Q3 plan  ",
      design: { background: "#FFF4E6", accent: "#C56A32", font: "Times" },
      slides: [
        { id: "s1", layout: "cover", title: "Q3 plan", bullets: [] },
        { id: "s2", layout: "bullets", title: "Wins", bullets: ["Revenue up"] },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe("Q3 plan");
    expect(result.value.design.motif).toBe("rule");
    expect(result.value.design.density).toBe("balanced");
    expect(result.value.slides).toHaveLength(2);
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
