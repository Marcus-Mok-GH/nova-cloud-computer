// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  layoutDeck,
  paletteFor,
  SLIDE_H,
  SLIDE_W,
  tonesForDeck,
  wrapText,
} from "./deckLayout";
import { getTheme, normaliseDeck, type Slide } from "./deckModel";

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

function build(overrides: { design?: unknown; slides?: Slide[] } = {}) {
  const parsed = normaliseDeck({
    title: "Quarterly Review",
    design: overrides.design ?? { theme: "swiss-blue" },
    slides: overrides.slides ?? slides,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.value;
}

describe("layoutDeck", () => {
  it("lays out every slide type inside the canvas with a mono footer", () => {
    const specs = layoutDeck(build());
    expect(specs).toHaveLength(8);

    specs.forEach(spec => {
      expect(spec.texts.length).toBeGreaterThan(0);
      expect(spec.shapes.length).toBeGreaterThan(0);
      expect(spec.texts.some(item => item.text === "NOVA / PRESENTATION")).toBe(true);
      const badge = spec.texts.find(item => item.text === "Made with Nova")!;
      expect(badge.href).toBe("https://nova-cloud-computer.vercel.app");
      expect(badge.align).toBe("right");
      expect(badge.box.x + badge.box.w).toBeGreaterThan(SLIDE_W - 3);
      for (const item of spec.texts) {
        expect(item.box.x).toBeGreaterThanOrEqual(0);
        expect(item.box.y).toBeGreaterThanOrEqual(0);
        expect(item.box.x + item.box.w).toBeLessThanOrEqual(SLIDE_W + 0.01);
        expect(item.box.y + item.box.h).toBeLessThanOrEqual(SLIDE_H + 0.01);
        expect(item.size).toBeGreaterThanOrEqual(10);
      }
      for (const shape of spec.shapes) {
        expect(shape.box.x).toBeGreaterThanOrEqual(0);
        expect(shape.box.y).toBeGreaterThanOrEqual(0);
        expect(shape.box.x + shape.box.w).toBeLessThanOrEqual(SLIDE_W + 0.01);
        expect(shape.box.y + shape.box.h).toBeLessThanOrEqual(SLIDE_H + 0.01);
      }
    });
  });

  it("gives the cover a dark background, tinted panel, mono marker and large title", () => {
    const deck = build();
    const cover = layoutDeck(deck)[0];
    const theme = getTheme(deck.design.theme);
    expect(cover.tone).toBe("dark");
    expect(cover.background).toBe(theme.inkTint);
    expect(cover.shapes.some(shape => shape.kind === "rect" && shape.box.x > 8 && shape.box.w > 4)).toBe(true);
    expect(cover.texts.some(item => item.text === "N" && item.font === theme.monoFont && item.size >= 40)).toBe(true);
    expect(cover.texts.some(item => item.text.includes(deck.title) && item.font === theme.titleFont && item.size >= 40)).toBe(true);
  });

  it("uses only colours from the chosen theme palette", () => {
    for (const theme of ["ink-classic", "swiss-yellow", "forest-ink"] as const) {
      const deck = build({ design: { theme } });
      layoutDeck(deck).forEach(spec => {
        const palette = paletteFor(deck.design, spec.tone);
        expect(palette.colors.has(spec.background)).toBe(true);
        for (const item of spec.texts) expect(palette.colors.has(item.color)).toBe(true);
        for (const shape of spec.shapes) expect(palette.colors.has(shape.color)).toBe(true);
      });
    }
  });

  it("keeps a dark/light rhythm with no three identical tones in a row", () => {
    const tones = tonesForDeck(build());
    expect(tones[0]).toBe("dark");
    expect(tones[tones.length - 1]).toBe("dark");
    for (let index = 2; index < tones.length; index++) {
      expect(tones.slice(index - 2, index + 1).every(tone => tone === tones[index])).toBe(false);
    }
    expect(tones).toContain("dark");
    expect(tones).toContain("light");
  });

  it("uses title, body and mono font roles from the theme", () => {
    const deck = build();
    const theme = getTheme(deck.design.theme);
    const specs = layoutDeck(deck);
    expect(specs.some(spec => spec.texts.some(item => item.font === theme.titleFont && item.bold))).toBe(true);
    expect(specs.some(spec => spec.texts.some(item => item.font === theme.monoFont))).toBe(true);
    const fonts: string[] = [theme.titleFont, theme.bodyFont, theme.monoFont];
    expect(specs.every(spec => spec.texts.every(item => fonts.includes(item.font)))).toBe(true);
  });

  it("keeps six metric cards inside a 3x2 grid", () => {
    const deck = normaliseDeck({
      title: "Six metrics",
      design: { theme: "ink-classic" },
      slides: [{
        id: "m", layout: "metrics", title: "Six numbers",
        items: Array.from({ length: 6 }, (_, index) => ({ label: `Label ${index}`, value: `${index}0%` })),
      }],
    });
    if (!deck.ok) throw new Error(deck.reason);
    const spec = layoutDeck(deck.value)[0];
    const cards = spec.shapes.filter(shape => shape.kind === "rect");
    expect(cards).toHaveLength(6);
    for (const card of cards) expect(card.box.y + card.box.h).toBeLessThanOrEqual(6.7);
  });

  it("fits long titles into the box by breaking lines and reducing size", () => {
    const long = "The operating model we built to make every customer conversation count";
    const wrapped = wrapText(long, 7, 34);
    expect(wrapped).toContain("\n");
    const spec = layoutDeck(build({
      slides: [{ id: "c", layout: "cover", title: "Long" }],
    }))[0];
    const title = spec.texts.find(item => item.size >= 40)!;
    expect(title.size).toBeLessThanOrEqual(60);
  });

  it("keeps small accent labels readable on both light and dark backgrounds", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeGreaterThan(10);
    for (const theme of ["swiss-yellow", "swiss-green", "ink-classic"] as const) {
      for (const tone of ["dark", "light"] as const) {
        const palette = paletteFor({ theme, density: "balanced" }, tone);
        expect(contrastRatio(palette.accentSmall, palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.muted, palette.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(palette.muted, palette.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
