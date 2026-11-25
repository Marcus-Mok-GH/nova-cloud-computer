// @vitest-environment node
import { describe, expect, it } from "vitest";
import { layoutDeck, SLIDE_H, SLIDE_W } from "./deckLayout";
import { normaliseDeck, type Slide } from "./deckModel";

const slides: Slide[] = [
  { id: "c", layout: "cover", title: "Quarterly Review", bullets: ["November 2026", "Leadership", "Remote"] },
  { id: "s", layout: "statement", title: "Less, but better", bullets: ["Focus on the few things that matter"] },
  { id: "b", layout: "bullets", title: "What we learned", bullets: ["One", "Two", "Three", "Four", "Five", "Six"] },
  { id: "sp", layout: "split", title: "The approach", bullets: ["Listen", "Build", "Measure"] },
  { id: "m", layout: "metrics", title: "By the numbers", items: [{ label: "Active", value: "1,240" }, { label: "NPS", value: "72" }] },
  { id: "t", layout: "timeline", title: "Roadmap", items: [{ label: "Q1", value: "Discovery" }, { label: "Q2", value: "Build" }, { label: "Q3", value: "Launch" }] },
  { id: "q", layout: "quote", title: "Design is how it works.", bullets: ["Steve Jobs"] },
  { id: "e", layout: "closing", title: "Thank you", bullets: ["Questions?"] },
];

describe("layoutDeck", () => {
  it("lays out every slide type inside the canvas with a footer", () => {
    const parsed = normaliseDeck({
      title: "Quarterly Review",
      design: { background: "#18313A", accent: "#F2A65A", font: "Helvetica" },
      slides,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const specs = layoutDeck(parsed.value);
    expect(specs).toHaveLength(8);

    specs.forEach(spec => {
      expect(spec.texts.length).toBeGreaterThan(0);
      expect(spec.shapes.length).toBeGreaterThan(0);
      const hasFooter = spec.texts.some(item => item.text === "NOVA");
      expect(hasFooter).toBe(true);
      for (const item of spec.texts) {
        expect(item.box.x).toBeGreaterThanOrEqual(0);
        expect(item.box.y).toBeGreaterThanOrEqual(0);
        expect(item.box.x + item.box.w).toBeLessThanOrEqual(SLIDE_W + 0.01);
        expect(item.box.y + item.box.h).toBeLessThanOrEqual(SLIDE_H + 0.01);
      }
      // Decorative shapes may intentionally bleed past the canvas edge.
    });
  });

  it("gives the cover a contrasting panel, a ring and a large index numeral", () => {
    const parsed = normaliseDeck({
      title: "Quarterly Review",
      design: { background: "#18313A", accent: "#F2A65A" },
      slides: [slides[0]],
    });
    if (!parsed.ok) throw new Error(parsed.reason);
    const cover = layoutDeck(parsed.value)[0];
    expect(cover.shapes.some(shape => shape.kind === "rect" && shape.box.x > 8 && shape.box.w > 4)).toBe(true);
    expect(cover.shapes.filter(shape => shape.kind === "ellipse").length).toBe(2);
    expect(cover.texts.some(item => item.text === "01" && item.size >= 80)).toBe(true);
  });
});
