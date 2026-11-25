export const LAYOUTS = [
  "cover", "statement", "bullets", "split", "metrics", "timeline", "quote", "closing",
] as const;
const FONTS = ["Helvetica", "Times", "Courier"] as const;
const MOTIFS = ["none", "rule", "dots", "grid"] as const;
const COVERS = ["centered", "left", "banner"] as const;
const DENSITIES = ["airy", "balanced"] as const;

export type Layout = (typeof LAYOUTS)[number];
export type Design = {
  background: string;
  accent: string;
  muted: string;
  font: (typeof FONTS)[number];
  motif: (typeof MOTIFS)[number];
  cover: (typeof COVERS)[number];
  density: (typeof DENSITIES)[number];
};
export type Slide = {
  id: string;
  layout: Layout;
  title: string;
  bullets?: string[];
  items?: Array<{ label: string; value: string }>;
  notes?: string;
};
export type Deck = { version: 1; title: string; design: Design; slides: Slide[] };

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

export function deriveInk(background: string): string {
  const hex = HEX.test(background) ? background : "#FBF8F3";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.35 ? "#241C17" : "#F7F1E8";
}

const normaliseSlide = (value: unknown, index: number): Slide | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = str(raw.title);
  if (!title || title.length > 160) return null;
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.map(str).filter(Boolean).slice(0, 6)
    : [];
  const items = Array.isArray(raw.items)
    ? raw.items.slice(0, 6).flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        const label = str(row.label);
        const val = str(row.value);
        return label && val ? [{ label, value: val }] : [];
      })
    : undefined;
  return {
    id: str(raw.id) || `s${index + 1}`,
    layout: oneOf(LAYOUTS, raw.layout, index === 0 ? "cover" : "bullets"),
    title,
    bullets,
    ...(items?.length ? { items } : {}),
    notes: str(raw.notes) || undefined,
  };
};

type Result = { ok: true; value: Deck } | { ok: false; reason: string };

export function normaliseDeck(input: unknown): Result {
  if (!input || typeof input !== "object") return { ok: false, reason: "A deck needs a title and slides." };
  const raw = input as Record<string, unknown>;
  const title = str(raw.title);
  if (!title || title.length > 160) return { ok: false, reason: "title must be 1-160 characters." };
  if (!Array.isArray(raw.slides) || raw.slides.length < 1 || raw.slides.length > 20)
    return { ok: false, reason: "Provide 1-20 slides." };
  const slides = raw.slides.map(normaliseSlide);
  if (slides.some(slide => slide === null)) return { ok: false, reason: "Every slide needs a title." };
  if (new Set(slides.map(slide => slide!.id)).size !== slides.length)
    return { ok: false, reason: "Slide ids must be unique." };
  const rawDesign = (raw.design ?? {}) as Record<string, unknown>;
  const background = HEX.test(str(rawDesign.background)) ? str(rawDesign.background) : "#FBF8F3";
  const design: Design = {
    background,
    accent: HEX.test(str(rawDesign.accent)) ? str(rawDesign.accent) : "#B96A3C",
    muted: HEX.test(str(rawDesign.muted)) ? str(rawDesign.muted) : "#6B5B4E",
    font: oneOf(FONTS, rawDesign.font, "Helvetica"),
    motif: oneOf(MOTIFS, rawDesign.motif, "rule"),
    cover: oneOf(COVERS, rawDesign.cover, "centered"),
    density: oneOf(DENSITIES, rawDesign.density, "balanced"),
  };
  return { ok: true, value: { version: 1, title, design, slides: slides as Slide[] } };
}

export function parseDeck(json: string): Deck | null {
  try {
    const result = normaliseDeck(JSON.parse(json));
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}
