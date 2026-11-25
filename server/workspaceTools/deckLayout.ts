import { deriveInk, type Deck, type Slide } from "./deckModel";

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

export type Box = { x: number; y: number; w: number; h: number };
export type TextSpec = {
  kind: "text";
  box: Box;
  text: string;
  size: number;
  color: string;
  font: string;
  bold?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle";
};
export type ShapeSpec = {
  kind: "rect" | "ellipse" | "line";
  box: Box;
  color: string;
};
export type SlideSpec = {
  background: string;
  shapes: ShapeSpec[];
  texts: TextSpec[];
};

const rgb = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});
const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("")}`;

export function mixColor(a: string, b: string, amount: number): string {
  const first = rgb(a);
  const second = rgb(b);
  return hex(
    first.r + (second.r - first.r) * amount,
    first.g + (second.g - first.g) * amount,
    first.b + (second.b - first.b) * amount
  );
}

type Palette = {
  background: string;
  ink: string;
  muted: string;
  accent: string;
  surface: string;
  font: string;
};

function palette(deck: Deck): Palette {
  const background = deck.design.background;
  const ink = deriveInk(background);
  const surface = mixColor(background, ink, ink === "#241C17" ? 0.07 : 0.12);
  const supplied = /^#[0-9a-fA-F]{6}$/.test(deck.design.muted)
    ? deck.design.muted
    : mixColor(background, ink, 0.45);
  return {
    background,
    ink,
    muted: supplied,
    accent: deck.design.accent,
    surface,
    font: deck.design.font,
  };
}

const text = (
  paletteValue: Palette,
  box: Box,
  content: string,
  size: number,
  color: string,
  extra: Partial<TextSpec> = {}
): TextSpec => ({
  kind: "text",
  box,
  text: content,
  size,
  color,
  font: extra.font ?? paletteValue.font,
  ...extra,
});

function footer(spec: SlideSpec, colors: Palette, index: number, total: number) {
  spec.shapes.push({
    kind: "line",
    box: { x: 0.85, y: 6.88, w: 1.15, h: 0 },
    color: colors.accent,
  });
  spec.texts.push(
    text(colors, { x: 0.85, y: 6.98, w: 2, h: 0.25 }, "NOVA", 9, colors.muted, { bold: true }),
    text(colors, { x: 10.5, y: 6.98, w: 1.98, h: 0.25 },
      `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
      9, colors.muted, { align: "right" })
  );
}

function kicker(spec: SlideSpec, colors: Palette, label: string) {
  spec.shapes.push({
    kind: "rect",
    box: { x: 0.85, y: 0.78, w: 0.42, h: 0.055 },
    color: colors.accent,
  });
  spec.texts.push(
    text(colors, { x: 1.42, y: 0.62, w: 10.5, h: 0.35 }, label.toUpperCase(), 10, colors.accent, { bold: true })
  );
}

function layoutCover(slide: Slide, colors: Palette, deck: Deck): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  const panel = mixColor(colors.accent, colors.background, 0.66);
  spec.shapes.push(
    { kind: "rect", box: { x: 8.35, y: 0, w: 4.98, h: SLIDE_H }, color: panel },
    { kind: "ellipse", box: { x: 9.05, y: 1.25, w: 3.55, h: 3.55 }, color: mixColor(colors.accent, colors.background, 0.22) },
    { kind: "line", box: { x: 8.9, y: 5.35, w: 3.8, h: 0 }, color: mixColor(colors.accent, colors.background, 0.35) },
    { kind: "line", box: { x: 8.9, y: 5.75, w: 2.4, h: 0 }, color: mixColor(colors.accent, colors.background, 0.35) },
    { kind: "ellipse", box: { x: 9.4, y: 1.6, w: 2.85, h: 2.85 }, color: panel },
    { kind: "line", box: { x: 8.35, y: 0, w: 0, h: SLIDE_H }, color: mixColor(colors.accent, colors.background, 0.55) },
    { kind: "rect", box: { x: 0.85, y: 3.35, w: 1.65, h: 0.075 }, color: colors.accent }
  );
  spec.texts.push(
    text(colors, { x: 9.05, y: 2.05, w: 3.55, h: 1.6 }, "01", 118, mixColor(colors.accent, colors.background, 0.34), { bold: true, align: "center" }),
    text(colors, { x: 0.85, y: 1.28, w: 6.9, h: 0.35 }, "NOVA · PRESENTATION", 11, colors.accent, { bold: true }),
    text(colors, { x: 0.85, y: 2.15, w: 7.05, h: 1.05 }, deck.title, 46, colors.ink, { bold: true }),
    text(colors, { x: 0.85, y: 3.72, w: 6.9, h: 0.6 }, slide.bullets?.[0] ?? "Prepared with Nova", 17, colors.muted)
  );
  (slide.bullets ?? []).slice(1, 4).forEach((bullet, index) => {
    const x = 0.85 + index * 2.32;
    spec.shapes.push({ kind: "rect", box: { x, y: 5.75, w: 2.1, h: 0.62 }, color: colors.surface });
    spec.texts.push(text(colors, { x: x + 0.18, y: 5.9, w: 1.76, h: 0.34 }, bullet, 11, colors.ink));
  });
  return spec;
}

function layoutStatement(slide: Slide, colors: Palette): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  spec.shapes.push(
    { kind: "ellipse", box: { x: -1.2, y: 3.6, w: 5.5, h: 5.5 }, color: mixColor(colors.accent, colors.background, 0.86) },
    { kind: "rect", box: { x: 9.9, y: 0.9, w: 2.5, h: 0.07 }, color: colors.accent }
  );
  kicker(spec, colors, "The idea");
  spec.texts.push(text(colors, { x: 1.35, y: 2.25, w: 10.6, h: 2.3 }, slide.title, 42, colors.ink, { bold: true }));
  if (slide.bullets?.[0])
    spec.texts.push(text(colors, { x: 1.38, y: 4.75, w: 9.6, h: 0.8 }, slide.bullets[0], 18, colors.muted));
  return spec;
}

function layoutBullets(slide: Slide, colors: Palette, dense: boolean): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  kicker(spec, colors, "Details");
  spec.texts.push(text(colors, { x: 0.85, y: 1.12, w: 11.6, h: 0.9 }, slide.title, 32, colors.ink, { bold: true }));
  spec.shapes.push({ kind: "line", box: { x: 0.85, y: 2.02, w: 11.63, h: 0 }, color: mixColor(colors.ink, colors.background, 0.78) });

  const bullets = (slide.bullets ?? []).slice(0, 6);
  const columns = bullets.length > 3 ? 2 : 1;
  const perColumn = Math.ceil(bullets.length / columns);
  bullets.forEach((bullet, index) => {
    const column = Math.floor(index / perColumn);
    const row = index % perColumn;
    const x = 0.85 + column * 6.0;
    const y = 2.35 + row * (dense ? 1.15 : 1.45);
    const w = columns === 2 ? 5.55 : 10.9;
    spec.shapes.push(
      { kind: "rect", box: { x, y, w, h: dense ? 0.96 : 1.2 }, color: colors.surface },
      { kind: "rect", box: { x, y, w: 0.055, h: dense ? 0.96 : 1.2 }, color: colors.accent }
    );
    spec.texts.push(
      text(colors, { x: x + 0.3, y: y + 0.12, w: 0.7, h: 0.35 }, String(index + 1).padStart(2, "0"), 11, colors.accent, { bold: true }),
      text(colors, { x: x + 0.95, y: y + 0.1, w: w - 1.25, h: dense ? 0.74 : 0.98 }, bullet, dense ? 15 : 17, colors.ink)
    );
  });
  return spec;
}

function layoutSplit(slide: Slide, colors: Palette): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  spec.shapes.push(
    { kind: "rect", box: { x: 7.55, y: 0, w: 5.79, h: SLIDE_H }, color: mixColor(colors.accent, colors.background, 0.76) },
    { kind: "ellipse", box: { x: 9.15, y: 2.1, w: 3.0, h: 3.0 }, color: mixColor(colors.accent, colors.background, 0.45) }
  );
  kicker(spec, colors, "Focus");
  spec.texts.push(text(colors, { x: 0.85, y: 1.3, w: 6.1, h: 1.8 }, slide.title, 36, colors.ink, { bold: true }));
  (slide.bullets ?? []).slice(0, 4).forEach((bullet, index) => {
    spec.texts.push(
      text(colors, { x: 0.88, y: 3.25 + index * 0.72, w: 0.5, h: 0.35 }, "—", 14, colors.accent, { bold: true }),
      text(colors, { x: 1.35, y: 3.22 + index * 0.72, w: 5.5, h: 0.6 }, bullet, 15, colors.ink)
    );
  });
  return spec;
}

function layoutMetrics(slide: Slide, colors: Palette): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  kicker(spec, colors, "By the numbers");
  spec.texts.push(text(colors, { x: 0.85, y: 1.15, w: 11.6, h: 0.9 }, slide.title, 32, colors.ink, { bold: true }));
  const items = (slide.items ?? []).slice(0, 4);
  const width = items.length ? 11.6 / items.length : 11.6;
  const centered = items.length <= 2;
  items.forEach((item, index) => {
    const x = 0.85 + index * width;
    if (index > 0)
      spec.shapes.push({ kind: "line", box: { x: x - 0.1, y: 2.5, w: 0, h: 2.6 }, color: mixColor(colors.ink, colors.background, 0.8) });
    spec.texts.push(
      text(colors, { x, y: 2.65, w: width - 0.4, h: 1.3 }, item.value, 50, colors.accent, { bold: true, align: centered ? "center" : "left" }),
      text(colors, { x, y: 4.1, w: width - 0.4, h: 0.8 }, item.label, 15, colors.ink, { align: centered ? "center" : "left" })
    );
  });
  (slide.bullets ?? []).slice(0, 1).forEach(bullet =>
    spec.texts.push(text(colors, { x: 0.85, y: 5.7, w: 11.6, h: 0.6 }, bullet, 14, colors.muted))
  );
  return spec;
}

function layoutTimeline(slide: Slide, colors: Palette): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  kicker(spec, colors, "Sequence");
  spec.texts.push(text(colors, { x: 0.85, y: 1.15, w: 11.6, h: 0.9 }, slide.title, 32, colors.ink, { bold: true }));
  const items = (slide.items ?? []).slice(0, 5);
  if (!items.length) return spec;
  const start = 1.4;
  const gap = items.length > 1 ? 10.2 / (items.length - 1) : 0;
  spec.shapes.push({ kind: "line", box: { x: start, y: 4.1, w: gap * (items.length - 1), h: 0 }, color: mixColor(colors.accent, colors.background, 0.45) });
  items.forEach((item, index) => {
    const x = start + index * gap;
    spec.shapes.push({ kind: "ellipse", box: { x: x - 0.11, y: 3.99, w: 0.22, h: 0.22 }, color: colors.accent });
    spec.texts.push(
      text(colors, { x: x - 1.0, y: index % 2 ? 2.65 : 4.45, w: 2.0, h: 0.9 }, item.label, 13, colors.ink, { align: "center", bold: true }),
      text(colors, { x: x - 1.0, y: index % 2 ? 3.25 : 5.05, w: 2.0, h: 0.6 }, item.value, 12, colors.muted, { align: "center" })
    );
  });
  return spec;
}

function layoutQuote(slide: Slide, colors: Palette): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  spec.shapes.push(
    { kind: "rect", box: { x: 0.85, y: 1.5, w: 0.07, h: 3.9 }, color: colors.accent },
    { kind: "ellipse", box: { x: 10.7, y: 4.9, w: 2.4, h: 2.4 }, color: mixColor(colors.accent, colors.background, 0.84) }
  );
  spec.texts.push(
    text(colors, { x: 1.35, y: 1.25, w: 3, h: 1.2 }, "“", 72, colors.accent, { bold: true, font: "Times" }),
    text(colors, { x: 1.35, y: 2.35, w: 10.2, h: 2.3 }, slide.title, 30, colors.ink, { font: "Times" }),
    text(colors, { x: 1.38, y: 4.85, w: 9.8, h: 0.7 }, slide.bullets?.[0] ?? "", 14, colors.muted)
  );
  return spec;
}

function layoutClosing(slide: Slide, colors: Palette, deck: Deck): SlideSpec {
  const spec: SlideSpec = { background: colors.background, shapes: [], texts: [] };
  spec.shapes.push(
    { kind: "rect", box: { x: 5.95, y: 1.7, w: 1.43, h: 0.08 }, color: colors.accent },
    { kind: "ellipse", box: { x: -1.8, y: -2.0, w: 5.5, h: 5.5 }, color: mixColor(colors.accent, colors.background, 0.88) }
  );
  spec.texts.push(
    text(colors, { x: 1.5, y: 2.05, w: 10.33, h: 1.2 }, slide.title || "Thank you", 46, colors.ink, { bold: true, align: "center" }),
    text(colors, { x: 2.0, y: 3.35, w: 9.33, h: 0.8 }, slide.bullets?.[0] ?? deck.title, 17, colors.muted, { align: "center" })
  );
  return spec;
}

export function layoutDeck(deck: Deck): SlideSpec[] {
  const colors = palette(deck);
  return deck.slides.map((slide, index) => {
    let spec: SlideSpec;
    switch (slide.layout) {
      case "cover":
        spec = layoutCover(slide, colors, deck);
        break;
      case "statement":
        spec = layoutStatement(slide, colors);
        break;
      case "split":
        spec = layoutSplit(slide, colors);
        break;
      case "metrics":
        spec = layoutMetrics(slide, colors);
        break;
      case "timeline":
        spec = layoutTimeline(slide, colors);
        break;
      case "quote":
        spec = layoutQuote(slide, colors);
        break;
      case "closing":
        spec = layoutClosing(slide, colors, deck);
        break;
      default:
        spec = layoutBullets(slide, colors, deck.design.density === "balanced");
    }
    footer(spec, colors, index, deck.slides.length);
    return spec;
  });
}
