import { NOVA_PUBLIC_APP_URL } from "@shared/const";
import { NOVA_BADGE_TEXT } from "../novaBadge";
import { getTheme, type Deck, type Design, type Slide, type Theme } from "./deckModel";

export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;
export const MARGIN = 0.85;
export const GRID_GAP = 0.22;
export const GRID_COL = (SLIDE_W - MARGIN * 2 - GRID_GAP * 11) / 12;

/** 12-column Swiss grid, scaled from the skill's 10" reference canvas. */
export function span(columns: number, offset = 0) {
  return {
    x: MARGIN + offset * (GRID_COL + GRID_GAP),
    w: columns * GRID_COL + (columns - 1) * GRID_GAP,
  };
}

export type Box = { x: number; y: number; w: number; h: number };
export type TextSpec = {
  kind: "text";
  box: Box;
  text: string;
  size: number;
  color: string;
  font: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle";
  lineSpacing?: number;
  href?: string;
};
export type ShapeSpec = {
  kind: "rect" | "ellipse" | "line";
  box: Box;
  color: string;
};
export type Tone = "dark" | "light";
export type SlideSpec = {
  background: string;
  tone: Tone;
  shapes: ShapeSpec[];
  texts: TextSpec[];
};

export function mixColor(a: string, b: string, amount: number): string {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  return `#${[ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount]
    .map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(hex: string) {
  const channel = (value: number) => {
    const linear = value / 255;
    return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string) {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export type Palette = {
  background: string;
  surface: string;
  ink: string;
  muted: string;
  accentSmall: string;
  accentLarge: string;
  titleFont: string;
  bodyFont: string;
  monoFont: string;
  style: Theme["style"];
  colors: Set<string>;
};

/** Every colour is a theme token or a tint mixed from two theme tokens. */
export function paletteFor(design: Design, tone: Tone): Palette {
  const theme = getTheme(design.theme);
  const background = tone === "dark" ? theme.inkTint : theme.paper;
  const ink = tone === "dark" ? theme.paper : theme.ink;
  const surface = tone === "dark"
    ? mixColor(theme.ink, theme.paper, 0.08)
    : mixColor(theme.paperTint, theme.ink, 0.06);
  const muted = mixColor(ink, background, tone === "dark" ? 0.24 : 0.22);
  const readableAccent = (minimum: number) =>
    contrastRatio(theme.accent, background) >= minimum ? theme.accent : ink;
  return {
    background,
    surface,
    ink,
    muted,
    accentSmall: readableAccent(4.5),
    accentLarge: readableAccent(3),
    titleFont: theme.titleFont,
    bodyFont: theme.bodyFont,
    monoFont: theme.monoFont,
    style: theme.style,
    colors: new Set([
      theme.ink,
      theme.paper,
      theme.paperTint,
      theme.inkTint,
      theme.accent,
      surface,
      muted,
    ]),
  };
}

const text = (
  colors: Palette,
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
  font: colors.bodyFont,
  // Single-line labels get tight leading; multi-line fits pass their own value.
  lineSpacing: 1,
  ...extra,
});

/** Conservative width estimate in ems; CJK glyphs are full width. */
function charWidth(char: string, mono: boolean) {
  if (mono) return 0.6;
  if (/[\u3000-\u9fff\uff00-\uffef]/.test(char)) return 1;
  if (char === " ") return 0.3;
  if (/[.,:;!|'’`]/.test(char)) return 0.28;
  if (/[ilI1]/.test(char)) return 0.32;
  if (/[MW@%]/.test(char)) return 0.85;
  return 0.54;
}

/** The layout engine owns line breaks so PPTX and PDF show the same lines. */
export function wrapText(content: string, width: number, size: number, mono = false): string {
  const limit = Math.max(width * 72 / size, 1);
  return content.split("\n").map(paragraph => {
    const words = paragraph.split(/(\s+)/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    let used = 0;
    for (const word of words) {
      const wordWidth = word.split("").reduce((sum, char) => sum + charWidth(char, mono), 0);
      if (used > 0 && used + wordWidth > limit) {
        lines.push(line.trimEnd());
        line = "";
        used = 0;
      }
      // Break very long single tokens (URLs, CJK runs) at character boundaries.
      if (wordWidth > limit) {
        for (const char of word.split("")) {
          const width = charWidth(char, mono);
          if (used + width > limit && line) {
            lines.push(line.trimEnd());
            line = "";
            used = 0;
          }
          line += char;
          used += width;
        }
      } else {
        line += word;
        used += wordWidth;
      }
    }
    lines.push(line.trimEnd());
    return lines.join("\n");
  }).join("\n");
}

function fitText(
  content: string,
  box: Box,
  base: number,
  minimum: number,
  mono = false,
  lineSpacing = 1.15
) {
  for (let size = base; size > minimum; size -= 2) {
    const wrapped = wrapText(content, box.w - 0.1, size, mono);
    const lines = wrapped.split("\n").length;
    // pptxgenjs/PowerPoint render a line at ~1.2x the point size; the layout
    // gate uses the same estimate so both exporters stay inside their boxes.
    if (lines * (size / 72) * 1.2 * lineSpacing <= box.h) return { text: wrapped, size };
  }
  const size = minimum;
  return { text: wrapText(content, box.w - 0.1, size, mono), size };
}

const stripQuotes = (value: string) => value.replace(/^[“"'\s]+|[”"'\s]+$/g, "").trim();
const stripDash = (value: string) => value.replace(/^[-—–\s]+/, "").trim();

function kicker(spec: SlideSpec, colors: Palette, label: string) {
  spec.texts.push(
    text(colors, { x: MARGIN, y: 0.52, w: span(12).w, h: 0.3 }, `— ${label.toUpperCase()}`, 11,
      colors.accentSmall, { font: colors.monoFont, bold: true })
  );
}

function contentTitle(spec: SlideSpec, colors: Palette, title: string) {
  const box = { x: MARGIN, y: 0.95, w: span(12).w, h: 0.95 };
  const fitted = fitText(title, box, 34, 26, false, 1.1);
  spec.texts.push(
    text(colors, box, fitted.text, fitted.size, colors.ink, {
      font: colors.titleFont, bold: true, lineSpacing: 1.1,
    })
  );
}

function footer(spec: SlideSpec, colors: Palette, index: number, total: number) {
  const page = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  spec.texts.push(
    text(colors, { x: MARGIN, y: SLIDE_H - 0.42, w: 4, h: 0.24 }, "NOVA / PRESENTATION", 11,
      colors.muted, { font: colors.monoFont }),
    text(colors, { x: SLIDE_W - MARGIN - 4.7, y: SLIDE_H - 0.42, w: 2.2, h: 0.24 }, page, 11,
      colors.muted, { font: colors.monoFont, align: "right" }),
    text(colors, { x: SLIDE_W - MARGIN - 2.3, y: SLIDE_H - 0.42, w: 2.3, h: 0.24 }, NOVA_BADGE_TEXT, 11,
      colors.accentSmall, { font: colors.monoFont, align: "right", href: NOVA_PUBLIC_APP_URL })
  );
}

function base(tone: Tone, colors: Palette): SlideSpec {
  return { background: colors.background, tone, shapes: [], texts: [] };
}

/** Cover, hero and closing pages are dark; no three adjacent pages share a tone. */
export function tonesForDeck(deck: Deck): Tone[] {
  const hero = new Set(["cover", "statement", "quote", "closing"]);
  const isBody = (index: number) => index > 0 && index < deck.slides.length - 1;
  const tones: Tone[] = deck.slides.map((slide, index) =>
    hero.has(slide.layout) || (index === 0 && slide.layout === "cover") ? "dark" : "light"
  );
  if (deck.slides.length >= 8 && !tones.some((tone, index) => tone === "dark" && isBody(index))) {
    const metric = deck.slides.findIndex((slide, index) => isBody(index) && slide.layout === "metrics");
    const target = metric >= 0 ? metric : deck.slides.findIndex((_, index) => isBody(index));
    if (target >= 0) tones[target] = "dark";
  }
  for (let index = 2; index < tones.length; index++) {
    if (tones[index] === tones[index - 1] && tones[index] === tones[index - 2]) {
      tones[index] = tones[index] === "dark" ? "light" : "dark";
    }
  }
  return tones;
}

function layoutCover(slide: Slide, deck: Deck, colors: Palette): SlideSpec {
  const spec = base("dark", colors);
  // A monogram in a ring is the deck's repeatable motif; no duplicate folio.
  spec.shapes.push(
    { kind: "rect", box: { x: 9.15, y: 0, w: SLIDE_W - 9.15, h: SLIDE_H }, color: colors.surface },
    { kind: "ellipse", box: { x: 9.75, y: 1.85, w: 2.9, h: 2.9 }, color: colors.background },
    { kind: "ellipse", box: { x: 10.25, y: 2.35, w: 1.9, h: 1.9 }, color: colors.surface }
  );
  spec.texts.push(text(colors, { x: 10.25, y: 2.82, w: 1.9, h: 0.9 }, "N", 52,
    colors.accentLarge, { font: colors.monoFont, bold: true, align: "center" }));
  const box = { x: MARGIN, y: 1.75, w: 8.0, h: 2.6 };
  const fitted = fitText(deck.title, box, 60, 40, false, 1.08);
  spec.texts.push(text(colors, box, fitted.text, fitted.size, colors.ink, {
    font: colors.titleFont, bold: true, lineSpacing: 1.08,
  }));
  if (slide.bullets?.[0]) {
    const sub = { x: MARGIN, y: 4.55, w: 8.0, h: 0.8 };
    const wrap = fitText(slide.bullets[0], sub, 21, 15);
    spec.texts.push(text(colors, sub, wrap.text, wrap.size, colors.muted));
  }
  const meta = (slide.bullets ?? []).slice(1, 3).join("  ·  ") || deck.title;
  const metaBox = { x: MARGIN, y: 5.75, w: 8.0, h: 0.4 };
  const metaFitted = fitText(meta, metaBox, 13, 11, true);
  spec.texts.push(text(colors, metaBox, metaFitted.text, metaFitted.size,
    colors.muted, { font: colors.monoFont }));
  return spec;
}

function layoutStatement(slide: Slide, colors: Palette): SlideSpec {
  const spec = base("dark", colors);
  kicker(spec, colors, "Thesis");
  const box = { x: MARGIN, y: 1.95, w: 7.9, h: 2.9 };
  const fitted = fitText(slide.title, box, 52, 34, false, 1.1);
  spec.texts.push(text(colors, box, fitted.text, fitted.size, colors.ink, {
    font: colors.titleFont, bold: true, lineSpacing: 1.1,
  }));
  if (slide.bullets?.[0]) {
    const card = { x: 9.2, y: 2.15, w: 3.3, h: 3.1 };
    spec.shapes.push({ kind: "rect", box: card, color: colors.surface });
    spec.texts.push(
      text(colors, { x: card.x + 0.25, y: card.y + 0.25, w: card.w - 0.5, h: 0.3 }, "THESIS", 11,
        colors.accentSmall, { font: colors.monoFont, bold: true }),
      text(colors, { x: card.x + 0.25, y: card.y + 0.75, w: card.w - 0.5, h: 2.0 },
        fitText(slide.bullets[0], { x: card.x + 0.25, y: card.y + 0.75, w: card.w - 0.5, h: 2.0 }, 18, 14).text,
        17, colors.ink, { lineSpacing: 1.3 })
    );
  }
  return spec;
}

function layoutBullets(slide: Slide, colors: Palette, dense: boolean): SlideSpec {
  const spec = base("light", colors);
  kicker(spec, colors, "Details");
  contentTitle(spec, colors, slide.title);
  const bullets = (slide.bullets ?? []).slice(0, 6);
  if (!bullets.length) return spec;
  // Fill the canvas with an intentional card grid, never a narrow left column.
  const columns = Math.min(3, bullets.length);
  const rows = Math.ceil(bullets.length / columns);
  const gap = 0.22;
  const cardW = (span(12).w - gap * (columns - 1)) / columns;
  const cardH = rows === 1 ? 2.8 : 1.85;
  const groupH = rows * cardH + (rows - 1) * gap;
  const yStart = 2.25 + Math.max(0, (4.75 - groupH) / 2);
  const size = dense ? 15 : 16;
  bullets.forEach((bullet, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = MARGIN + column * (cardW + gap);
    const y = yStart + row * (cardH + gap);
    spec.shapes.push({ kind: "rect", box: { x, y, w: cardW, h: cardH }, color: colors.surface });
    spec.texts.push(text(colors, { x: x + 0.22, y: y + 0.18, w: 0.7, h: 0.3 },
      String(index + 1).padStart(2, "0"), 11, colors.accentSmall, { font: colors.monoFont, bold: true }));
    const bodyH = Math.min(1.5, cardH - 1.0);
    const bodyBox = { x: x + 0.22, y: y + (cardH - bodyH) / 2, w: cardW - 0.44, h: bodyH };
    const fitted = fitText(bullet, bodyBox, size, 14, false, 1.3);
    spec.texts.push(text(colors, bodyBox, fitted.text, fitted.size, colors.ink,
      { lineSpacing: 1.3, valign: "middle" }));
  });
  return spec;
}

function layoutSplit(slide: Slide, colors: Palette): SlideSpec {
  const spec = base("light", colors);
  kicker(spec, colors, "Focus");
  contentTitle(spec, colors, slide.title);
  const left = span(7);
  const right = span(5, 7);
  const panel = { kind: "rect" as const, box: { x: right.x, y: 2.15, w: right.w, h: 3.6 }, color: colors.surface };
  spec.shapes.push(panel);
  (slide.bullets ?? []).slice(1, 5).forEach((bullet, index) => {
    const y = 2.5 + index * 0.85;
    spec.texts.push(
      text(colors, { x: left.x, y, w: 0.4, h: 0.3 }, String(index + 1).padStart(2, "0"), 11,
        colors.accentSmall, { font: colors.monoFont, bold: true }),
      text(colors, { x: left.x + 0.55, y: y - 0.05, w: left.w - 0.65, h: 0.7 },
        fitText(bullet, { x: left.x + 0.55, y: y - 0.05, w: left.w - 0.65, h: 0.7 }, 16, 14).text,
        16, colors.ink, { lineSpacing: 1.3 })
    );
  });
  if (slide.bullets?.[0]) {
    const pullBox = { x: right.x + 0.32, y: 2.6, w: right.w - 0.64, h: 2.7 };
    const pull = fitText(slide.bullets[0], pullBox, 28, 20, false, 1.15);
    spec.texts.push(text(colors, pullBox, pull.text, pull.size, colors.ink,
      { font: colors.titleFont, bold: true, lineSpacing: 1.15 }));
  }
  return spec;
}

function layoutMetrics(slide: Slide, colors: Palette, tone: Tone): SlideSpec {
  const spec = base(tone, colors);
  kicker(spec, colors, "By the numbers");
  contentTitle(spec, colors, slide.title);
  const items = slide.items ?? [];
  if (!items.length) return spec;
  const columns = items.length <= 3 ? items.length : items.length === 4 ? 2 : 3;
  const rows = Math.ceil(items.length / columns);
  const gap = 0.22;
  const cardW = (span(12).w - gap * (columns - 1)) / columns;
  const cardH = rows === 1 ? 3.6 : 2.05;
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = MARGIN + column * (cardW + gap);
    const y = 2.3 + row * (cardH + gap);
    spec.shapes.push({ kind: "rect", box: { x, y, w: cardW, h: cardH }, color: colors.surface });
    const valueBox = { x: x + 0.2, y: y + 0.55, w: cardW - 0.4, h: rows === 1 ? 1.5 : 0.95 };
    const value = fitText(item.value, valueBox, rows === 1 ? 58 : 44, 30, true, 1.05);
    spec.texts.push(text(colors, valueBox, value.text, value.size, colors.accentLarge, {
      font: colors.monoFont, bold: true, lineSpacing: 1.05,
    }));
    spec.shapes.push({ kind: "line", box: { x: x + 0.22, y: y + cardH - 1.08, w: cardW - 0.44, h: 0 }, color: colors.muted });
    const labelBox = { x: x + 0.22, y: y + cardH - 0.9, w: cardW - 0.44, h: 0.65 };
    const label = fitText(item.label, labelBox, 16, 14, false, 1.25);
    spec.texts.push(text(colors, labelBox, label.text, label.size, colors.ink, { lineSpacing: 1.25 }));
  });
  if (slide.bullets?.[0]) {
    const note = fitText(slide.bullets[0], { x: MARGIN, y: 6.05, w: span(12).w, h: 0.5 }, 14, 14);
    spec.texts.push(text(colors, { x: MARGIN, y: 6.05, w: span(12).w, h: 0.5 }, note.text, 14, colors.muted));
  }
  return spec;
}

function layoutTimeline(slide: Slide, colors: Palette): SlideSpec {
  const spec = base("light", colors);
  kicker(spec, colors, "Sequence");
  contentTitle(spec, colors, slide.title);
  const items = slide.items ?? [];
  if (!items.length) return spec;
  const axisY = 4.25;
  const step = span(12).w / items.length;
  spec.shapes.push({
    kind: "line",
    box: { x: MARGIN + step / 2, y: axisY, w: step * (items.length - 1), h: 0 },
    color: colors.muted,
  });
  items.forEach((item, index) => {
    const center = MARGIN + step * (index + 0.5);
    const labelBox = { x: center - step / 2 + 0.1, y: 3.15, w: step - 0.2, h: 0.7 };
    const valueBox = { x: center - step / 2 + 0.1, y: 4.7, w: step - 0.2, h: 0.7 };
    spec.shapes.push({
      kind: "ellipse", box: { x: center - 0.11, y: axisY - 0.11, w: 0.22, h: 0.22 },
      color: colors.accentLarge,
    });
    const label = fitText(item.label, labelBox, 16, 14, true, 1.15);
    const value = fitText(item.value, valueBox, 15, 14, false, 1.25);
    spec.texts.push(
      text(colors, { x: center - 0.45, y: 2.75, w: 0.9, h: 0.3 },
        String(index + 1).padStart(2, "0"), 11, colors.accentSmall,
        { font: colors.monoFont, bold: true, align: "center" }),
      text(colors, labelBox, label.text, label.size, colors.ink,
        { font: colors.titleFont, bold: true, align: "center", lineSpacing: 1.15 }),
      text(colors, valueBox, value.text, value.size, colors.muted,
        { align: "center", lineSpacing: 1.25 })
    );
  });
  return spec;
}

function layoutQuote(slide: Slide, colors: Palette): SlideSpec {
  const spec = base("dark", colors);
  kicker(spec, colors, "In their words");
  spec.texts.push(text(colors, { x: 10.4, y: 1.05, w: 2.1, h: 1.5 }, "“", 120,
    colors.muted, { font: colors.titleFont, align: "right" }));
  const box = { x: MARGIN, y: 1.75, w: 10.1, h: 3.1 };
  const fitted = fitText(stripQuotes(slide.title), box, 46, 28, false, 1.15);
  spec.texts.push(text(colors, box, fitted.text, fitted.size, colors.ink, {
    font: colors.style === "magazine" ? colors.titleFont : colors.bodyFont,
    italic: colors.style === "magazine",
    bold: colors.style === "swiss",
    lineSpacing: 1.15,
  }));
  if (slide.bullets?.[0]) {
    spec.shapes.push({ kind: "rect", box: { x: MARGIN, y: 5.15, w: 7.0, h: 0.62 }, color: colors.surface });
    spec.texts.push(text(colors, { x: MARGIN + 0.2, y: 5.25, w: 9.5, h: 0.4 }, `— ${stripDash(slide.bullets[0])}`, 12,
      colors.accentSmall, { font: colors.monoFont }));
  }
  return spec;
}

function layoutClosing(slide: Slide, deck: Deck, colors: Palette): SlideSpec {
  const spec = base("dark", colors);
  kicker(spec, colors, "Closing");
  // Mirror the cover's monogram panel so the deck has a deliberate bookend.
  spec.shapes.push(
    { kind: "rect", box: { x: 0, y: 0, w: 4.6, h: SLIDE_H }, color: colors.surface },
    { kind: "ellipse", box: { x: 1.15, y: 2.15, w: 2.3, h: 2.3 }, color: colors.background },
    { kind: "ellipse", box: { x: 1.52, y: 2.52, w: 1.56, h: 1.56 }, color: colors.surface }
  );
  spec.texts.push(text(colors, { x: 1.52, y: 2.92, w: 1.56, h: 0.7 }, "N", 44,
    colors.accentLarge, { font: colors.monoFont, bold: true, align: "center" }));
  const box = { x: 5.15, y: 2.05, w: 7.3, h: 2.3 };
  const fitted = fitText(slide.title || "Thank you", box, 50, 34, false, 1.1);
  spec.texts.push(text(colors, box, fitted.text, fitted.size, colors.ink, {
    font: colors.titleFont, bold: true, lineSpacing: 1.1,
  }));
  const detailBox = { x: 5.15, y: 4.65, w: 7.3, h: 0.8 };
  const detail = fitText(slide.bullets?.[0] ?? deck.title, detailBox, 20, 15);
  spec.texts.push(text(colors, detailBox, detail.text, detail.size, colors.muted));
  return spec;
}

export function layoutDeck(deck: Deck): SlideSpec[] {
  const tones = tonesForDeck(deck);
  return deck.slides.map((slide, index) => {
    const tone = tones[index];
    const colors = paletteFor(deck.design, tone);
    let spec: SlideSpec;
    switch (slide.layout) {
      case "cover":
        spec = layoutCover(slide, deck, colors);
        break;
      case "statement":
        spec = layoutStatement(slide, colors);
        break;
      case "split":
        spec = layoutSplit(slide, colors);
        break;
      case "metrics":
        spec = layoutMetrics(slide, colors, tone);
        break;
      case "timeline":
        spec = layoutTimeline(slide, colors);
        break;
      case "quote":
        spec = layoutQuote(slide, colors);
        break;
      case "closing":
        spec = layoutClosing(slide, deck, colors);
        break;
      default:
        spec = layoutBullets(slide, colors, deck.design.density === "balanced");
    }
    footer(spec, colors, index, deck.slides.length);
    return spec;
  });
}
