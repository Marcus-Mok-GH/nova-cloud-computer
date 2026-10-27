# Nova Brand Kit

**Version 1.0 — Soft & Lightweight**

Nova is a personal cloud computer. The brand should feel like a warm, quiet room you can work in: soft surfaces, generous space, nothing shouting. Weight is the enemy — every choice below exists to keep the product feeling airy rather than dense.

The kit has four parts:

| File | Purpose |
| --- | --- |
| `tokens.css` | Drop-in CSS. Defines the palette, maps it onto Nova's existing `--background` / `--primary` / etc. variables, and ships type, spacing, radius and motion tokens. |
| `BRAND.md` | This document — the rules. |
| `brand-board.html` | Visual reference. Open it in a browser to see every colour, type style, and component in light and dark. |
| `logo/` | The mark in every size and mode the app needs. |

---

## 1. The idea

**Soft is a structural choice, not a decoration.**

Nova's warmth comes from three things, in this order:

1. **A warm neutral base.** Nothing is pure grey. The page sits on `cloud` (#FCF8F3), a paper tone with a trace of sunlight in it. Cards are `feather` (#FFFFFF) so they lift off the base without needing heavy borders.
2. **One warm accent, used sparingly.** `ember` (#D2622C) is the only saturated colour in the system. It marks the one thing you want the person to do. If two things on a screen are ember, neither is primary.
3. **Space and softness over contrast.** Generous padding, large radii, hairline borders, low-spread shadows. We earn hierarchy through space first, colour second, weight last.

**The test:** squint at a screen. You should see a calm field with one warm point of focus. If you see stripes of colour, boxes inside boxes, or heavy black type, it is off-brand.

---

## 2. Colour

### Core palette

| Token | Hex | OKLCH | Role |
| --- | --- | --- | --- |
| `--nova-cloud` | `#FCF8F3` | `oklch(0.981 0.0079 73.7)` | Page background, light mode |
| `--nova-mist` | `#F4ECE3` | `oklch(0.947 0.0148 70.9)` | Recessed surfaces, muted fills, secondary |
| `--nova-feather` | `#FFFFFF` | `oklch(1 0 0)` | Cards, popovers, elevated surfaces |
| `--nova-apricot` | `#FDEEE1` | `oklch(0.957 0.0238 63.5)` | Accent wash, selected states, callout backgrounds |
| `--nova-glow` | `#FFD9B8` | `oklch(0.909 0.0608 62.9)` | Accent text on dark, highlight edges |
| `--nova-sunrise` | `#F08A3C` | `oklch(0.730 0.1531 54.5)` | Primary in dark mode |
| `--nova-ember` | `#D2622C` | `oklch(0.625 0.1563 43.8)` | Primary in light mode, the brand colour |
| `--nova-ember-strong` | `#B84E1E` | `oklch(0.555 0.1495 42.0)` | Ember text on light, pressed states |
| `--nova-ink` | `#2A211C` | `oklch(0.257 0.0167 50.7)` | Primary text |
| `--nova-bark` | `#5E5047` | `oklch(0.443 0.0237 54.7)` | Secondary text, icons |
| `--nova-line` | `#E9DED2` | `oklch(0.906 0.0202 70.0)` | Default borders |
| `--nova-line-strong` | `#DCCDBD` | `oklch(0.856 0.0275 69.2)` | Input borders, dividers on emphasis |

### Status

| Token | Hex | Use |
| --- | --- | --- |
| `--nova-success` | `#57895F` | Confirmations, completed states |
| `--nova-warning` | `#B5812A` | Caution, degraded states |
| `--nova-danger` | `#BE5343` | Destructive actions, errors |
| `--nova-info` | `#557BA3` | Neutral notices |

Status colours are desaturated on purpose so they sit inside the warm field instead of fighting it. Use them as a small dot, a 1px border, or a text tint — never as a large fill.

### Dark mode

| Token | Hex | Role |
| --- | --- | --- |
| `--nova-night` | `#17130F` | Page background |
| `--nova-night-card` | `#201A15` | Cards, popovers |
| `--nova-night-line` | `#3A2F26` | Borders |

Dark mode is not an inverted light mode. It is warm charcoal, not black, and the accent steps up to `sunrise` (#F08A3C) because `ember` goes muddy on dark. Text is `oklch(0.955 0.006 70)` — warm off-white, never #FFFFFF.

### Contrast rules

Measured against `cloud`:

- `ink` on `cloud` — **14.9:1**. Body copy. Safe everywhere.
- `bark` on `cloud` — **7.3:1**. Secondary copy. Passes AA at all sizes.
- `ember` on `cloud` — **3.6:1**. **Fails AA for text.** Do not use ember for body copy or small labels. Use `ember-strong` (4.8:1) for ember-coloured text, and reserve pure `ember` for fills, icons ≥ 24px, and borders.
- `feather` on `ember` — **3.8:1**. Acceptable for button labels at 16px semibold and above; do not use for long text.

**Non-negotiable:** never put `bark` on `night` (2.4:1). On dark surfaces, text starts at warm off-white and steps down only to `oklch(0.72 0.014 68)`.

---

## 3. Typography

**DM Sans** for everything functional. **DM Serif Display** for display lines only.

Both are already loaded by the app's `index.css`, so no extra request is needed.

| Style | Font | Size | Weight | Tracking | Leading |
| --- | --- | --- | --- | --- | --- |
| Display | DM Serif Display | 60 / 48 / 36 | 400 | -0.02em | 1.15 |
| Heading | DM Sans | 28 / 22 | 600 | -0.01em | 1.35 |
| Subheading | DM Sans | 18 | 600 | 0 | 1.35 |
| Body | DM Sans | 16 / 14 | 400 | 0 | 1.65 |
| Label | DM Sans | 14 | 500 | 0 | 1.35 |
| Caption | DM Sans | 12 | 500 | 0.01em | 1.35 |
| Code | mono stack | 14 | 400 | 0 | 1.5 |

Rules:

- **One serif line per screen, maximum.** The serif is a signature, not a workhorse. If the page has a serif headline, every other heading on that page is DM Sans.
- **Body copy never below 14px.** 12px is for captions and metadata only.
- **Measure:** 60–75 characters. On wide layouts, constrain prose to `max-width: 68ch`.
- **Weight discipline:** 400 and 600 only. 500 is allowed for labels. Never 700 for body text — it thickens the page.
- **Never letterspace body text.** Positive tracking appears only on 12px all-caps captions.

---

## 4. Shape, space, depth

**Radii.** `sm` 8px (chips, inputs) · `md` 12px (buttons, small cards) · `lg` 16px (cards, panels) · `xl` 24px (hero surfaces, modals) · `pill` 999px (tags, avatars, segmented controls).

**Spacing** is a 4px base scale: 4, 8, 12, 16, 24, 32, 48, 64, 96. Use the larger end more than feels natural — a section gap of 64–96px is normal here. Cramped layouts are the fastest way to look off-brand.

**Depth.** Shadows are wide, low-opacity, and warm-tinted:

```
--nova-shadow-soft:  0 1px 2px oklch(0.257 0.0167 50.7 / 0.04),
                     0 8px 24px oklch(0.257 0.0167 50.7 / 0.06);
--nova-shadow-lift:  0 2px 4px oklch(0.257 0.0167 50.7 / 0.05),
                     0 16px 40px oklch(0.257 0.0167 50.7 / 0.08);
--nova-glow:         0 8px 32px oklch(0.730 0.1531 54.5 / 0.18);
```

Prefer **one elevation step**. A card sits on the page; it does not also contain cards that cast their own shadows. Nested elevation is the primary way Nova layouts start looking heavy.

**Motion.** Default `240ms` with `cubic-bezier(0.22, 1, 0.36, 1)` — fast out, settled in. Use `140ms` for hover and press feedback, `420ms` only for entrances and page transitions. Nothing bounces. Nothing spins faster than it needs to.

---

## 5. The mark

**Files** (in `logo/`):

| File | Use |
| --- | --- |
| `brand-icon-1024.png` | Master light mark |
| `brand-icon-dark-1024.png` | Master dark mark |
| `logo-96.png` | App chrome, small placements |
| `favicon-32.png` / `favicon-dark-32.png` | Browser tab |
| `apple-touch-icon.png` | iOS home screen |

**Clear space:** a margin equal to 25% of the mark's height on every side. Nothing enters that box — no text, no border, no other icon.

**Minimum size:** 24px. Below that, use the favicon crop rather than scaling the full mark.

**Placement:**

- On `cloud` or `feather` — light mark.
- On `night` or any surface below oklch(0.35) — dark mark.
- Never place the mark on `ember`, `sunrise`, or a photograph.
- Never add a glow, drop shadow, or outline to the mark.

**Don't:**

- Recolour the mark to ember or any status colour.
- Stretch, rotate, or apply a gradient.
- Rebuild the mark in a different typeface or redraw its curves.
- Put it inside another shape (a circle badge, a rounded square) unless that shape is the app icon itself.

---

## 6. Components

**Buttons.**

- *Primary* — `ember` fill (`sunrise` in dark), `feather` label, `md` radius, 40px height, horizontal padding 20px. One per view.
- *Secondary* — `feather` fill, `line` 1px border, `ink` label. Pairs with primary.
- *Ghost* — no fill, no border until hover (`mist` wash appears). For tertiary actions in dense toolbars.
- *Destructive* — `danger` text with a `danger`/20% wash on hover. Never a solid red button unless the action is irreversible and confirmed.

Hover: darken one step or add the `mist` wash. Never move the button, and never scale it.

**Inputs.** 40px height, `line-strong` border, `md` radius, `feather` fill. Focus is a 2px `ring` outline with a 2px offset — a visible halo, not a border colour swap. Placeholder text uses `bark` at 60% opacity, never grey.

**Cards.** `feather` on `cloud`, `line` hairline border, `lg` radius, `shadow-soft`, padding 24px. A card's content starts 24px from its edge — never 12px.

**Empty states.** Centred, 96px of vertical space, one icon in `bark` at 40% opacity, a sentence of `ink` at 18px, one primary action, and nothing else. Empty states carry the softness of the brand more visibly than any other screen — do not fill them with illustrations.

**Focus and keyboard.** Every interactive element gets the `nova-focus` treatment. Focus rings are `ember` at 2px and are never removed for aesthetics.

---

## 7. Writing

Nova speaks plainly and quietly.

- **Sentence case** for headings, buttons, labels, and menu items. Never Title Case.
- **Second person.** "Your workspace", not "the user's workspace".
- **Short.** Buttons are 1–3 words. Errors say what happened and what to do next, in one sentence.
- **No exclamation marks.** No "Oops!". No emoji in product UI.
- **Name things what they are.** "Files", not "Assets Hub". "Delete", not "Remove permanently".

Examples:

| Instead of | Write |
| --- | --- |
| "Oops! Something went wrong." | "Couldn't save your file. Try again." |
| "Click Here To Get Started!" | "Get started" |
| "Your Agentic Workspace Awaits" | "Your workspace" |

---

## 8. Using the kit

Add the token file before the app's own stylesheet so the app's variables can build on it:

```css
@import "./brand/tokens.css";
```

`tokens.css` redeclares the app's existing `--background`, `--card`, `--primary`, `--border`, `--ring`, `--surface` and related variables, so the whole product picks up the palette without touching component code. The `.dark` and `[data-theme="midnight"]` blocks do the same for dark mode.

Named themes that already exist in `ThemeContext` (`ocean`, `meadow`, `blossom`, `sandstone`, `deepsea`, `pine`, `nebula`, `ember`) continue to work — this kit only redefines the `daylight` and `midnight` defaults. A `[data-theme]` selector is more specific than `:root`, so an explicitly chosen theme still wins.

For the full visual reference, open `brand-board.html`.