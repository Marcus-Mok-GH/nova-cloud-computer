export const LAYOUTS = [
  "cover", "statement", "bullets", "split", "metrics", "timeline", "quote", "closing",
] as const;

/**
 * Preset themes from the ppt-design-skill design system. A deck picks exactly
 * one theme; callers never supply raw hex values. Colours stay in the theme's
 * own ink / paper / tint family so the two renderers can share one palette.
 */
export const THEMES = [
  {
    name: "ink-classic",
    style: "magazine",
    ink: "#0A0A0B",
    paper: "#F1EFEA",
    paperTint: "#E8E5DE",
    inkTint: "#18181A",
    accent: "#D4A574",
    titleFont: "Cambria",
    bodyFont: "Calibri",
    monoFont: "Consolas",
  },
  {
    name: "indigo-porcelain",
    style: "magazine",
    ink: "#0A1F3D",
    paper: "#F1F3F5",
    paperTint: "#E4E8EC",
    inkTint: "#152A4A",
    accent: "#4A90A4",
    titleFont: "Cambria",
    bodyFont: "Calibri",
    monoFont: "Consolas",
  },
  {
    name: "forest-ink",
    style: "magazine",
    ink: "#1A2E1F",
    paper: "#F5F1E8",
    paperTint: "#ECE7DA",
    inkTint: "#253D2C",
    accent: "#6B8E5A",
    titleFont: "Cambria",
    bodyFont: "Calibri",
    monoFont: "Consolas",
  },
  {
    name: "kraft-paper",
    style: "magazine",
    ink: "#2A1E13",
    paper: "#EEDFC7",
    paperTint: "#E0D0B6",
    inkTint: "#3A2A1D",
    accent: "#B87333",
    titleFont: "Cambria",
    bodyFont: "Calibri",
    monoFont: "Consolas",
  },
  {
    name: "dune",
    style: "magazine",
    ink: "#1F1A14",
    paper: "#F0E6D2",
    paperTint: "#E3D7BF",
    inkTint: "#2D2620",
    accent: "#C4A265",
    titleFont: "Cambria",
    bodyFont: "Calibri",
    monoFont: "Consolas",
  },
  {
    name: "swiss-blue",
    style: "swiss",
    ink: "#1A1A1A",
    paper: "#F5F5F5",
    paperTint: "#E6E6E6",
    inkTint: "#333333",
    accent: "#002FA7",
    titleFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Consolas",
  },
  {
    name: "swiss-yellow",
    style: "swiss",
    ink: "#1A1A1A",
    paper: "#F5F5F5",
    paperTint: "#E6E6E6",
    inkTint: "#333333",
    accent: "#FFD700",
    titleFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Consolas",
  },
  {
    name: "swiss-green",
    style: "swiss",
    ink: "#1A1A1A",
    paper: "#F5F5F5",
    paperTint: "#E6E6E6",
    inkTint: "#333333",
    accent: "#CCFF00",
    titleFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Consolas",
  },
  {
    name: "swiss-orange",
    style: "swiss",
    ink: "#1A1A1A",
    paper: "#F5F5F5",
    paperTint: "#E6E6E6",
    inkTint: "#333333",
    accent: "#FF5F00",
    titleFont: "Arial",
    bodyFont: "Arial",
    monoFont: "Consolas",
  },
] as const;

export type Theme = (typeof THEMES)[number];
export type ThemeName = Theme["name"];
export type DesignStyle = Theme["style"];
const DENSITIES = ["airy", "balanced"] as const;
export type Density = (typeof DENSITIES)[number];

export type Design = { theme: ThemeName; density: Density };
export type Slide = {
  id: string;
  layout: Layout;
  title: string;
  bullets?: string[];
  items?: Array<{ label: string; value: string }>;
  notes?: string;
};
export type Deck = {
  version: 1;
  title: string;
  design: Design;
  slides: Slide[];
  /** Ids of the exported files, so a later export updates instead of duplicating. */
  exports?: Partial<Record<"pptx" | "pdf", number>>;
};
export type Layout = (typeof LAYOUTS)[number];

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

export function getTheme(name: ThemeName): Theme {
  return THEMES.find(theme => theme.name === name) ?? THEMES[0];
}

/** Kept for stored decks created by the old palette system and for tone tests. */
export function deriveInk(background: string): string {
  const hex = HEX.test(background) ? background : "#FBF8F3";
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.35 ? "#241C17" : "#F7F1E8";
}

const rgb = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const distance = (a: string, b: string) => {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return (ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2;
};

/**
 * Old decks stored arbitrary custom hex colours. Map them once onto the
 * closest preset so they keep rendering under the codified design system.
 */
function legacyTheme(background: string, accent: string, font: string): Theme {
  if (!HEX.test(background) && !HEX.test(accent)) return THEMES[0];
  let best: Theme = THEMES[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const theme of THEMES) {
    const backgroundScore = HEX.test(background)
      ? Math.min(distance(background, theme.paper), distance(background, theme.ink))
      : 0;
    const accentScore = HEX.test(accent) ? distance(accent, theme.accent) : 0;
    const fontScore = font === "Times" && theme.style === "magazine" ? 2000 : 0;
    const score = backgroundScore + accentScore * 2 + fontScore;
    if (score < bestScore) {
      best = theme;
      bestScore = score;
    }
  }
  return best;
}

export function normaliseDesign(input: unknown): Design {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const density = oneOf(DENSITIES, raw.density, "balanced");
  const theme = oneOf<ThemeName>(
    THEMES.map(item => item.name),
    raw.theme,
    legacyTheme(str(raw.background), str(raw.accent), str(raw.font)).name
  );
  return { theme, density };
}

const normaliseSlide = (value: unknown, index: number): Slide | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = str(raw.title);
  if (!title || title.length > 160) return null;
  // The playbook caps a content page at five list entries.
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.map(str).filter(Boolean).slice(0, 5)
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
  const exportsMap: NonNullable<Deck["exports"]> = {};
  const rawExports = (raw.exports ?? {}) as Record<string, unknown>;
  for (const format of ["pptx", "pdf"] as const) {
    const id = Number(rawExports[format]);
    if (Number.isInteger(id) && id > 0) exportsMap[format] = id;
  }
  return {
    ok: true,
    value: {
      version: 1,
      title,
      design: normaliseDesign(raw.design),
      slides: slides as Slide[],
      ...(Object.keys(exportsMap).length ? { exports: exportsMap } : {}),
    },
  };
}

export function parseDeck(json: string): Deck | null {
  try {
    const result = normaliseDeck(JSON.parse(json));
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}
