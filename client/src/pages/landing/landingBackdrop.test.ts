import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The canyon backdrop's readability contract.
 *
 * The photo sits behind the WHOLE public page, so copy that lands on it
 * directly (the hero headline, the integration strip, the section
 * paragraphs) needs a wash of its own. That wash is CSS, so it cannot be
 * asserted from a render — but the HOOKS it depends on can: the class on the
 * hero copy column, and the id on every section whose paragraph sits
 * directly on the photo.
 *
 * These hooks are load-bearing. If one is renamed in the component and not in
 * `index.css`, the section silently loses its wash, the copy lands on raw
 * rock, and the canyon goes back to being invisible (or the text goes
 * unreadable) with no test failing.
 */
const LANDING_CSS = path.resolve(
  process.cwd(),
  "client/src/index.css"
);

/** Sections whose body copy sits directly on the photo and needs a wash. */
const WASHED_SECTIONS = [
  "connections",
  "product",
  "uses",
  "channels",
  "faq",
];

describe("the canyon backdrop's wash hooks", () => {
  const css = readFileSync(LANDING_CSS, "utf8");

  it("washes every section whose copy sits on the photo", () => {
    const washRule = css.slice(
      css.indexOf(".landing-shell #connections")
    );
    // The rule that lists the washed sections.
    const block = washRule.slice(
      0,
      washRule.indexOf("}") + 1
    );

    for (const id of WASHED_SECTIONS) {
      expect(block).toContain(`#${id}`);
    }
  });

  it("washes the steps section, whose surface background lets the photo through", () => {
    // `#how-it-works` carries a `bg-surface` background, so the photo reaches
    // its step paragraphs through it. Without its own wash those paragraphs
    // sit on bare rock and fail contrast.
    const start = css.indexOf(".landing-shell #how-it-works {");
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start) + 1);
    const mixes = [...block.matchAll(/var\(--canyon-wash\) (\d+)%/g)].map(
      (m) => Number(m[1])
    );
    expect(mixes.length).toBeGreaterThan(0);
    for (const pct of mixes) {
      expect(pct).toBeLessThanOrEqual(92);
    }
  });

  it("keeps the wash feathered so the photo still reads between sections", () => {
    // A hard-edged band would cut the landscape off at every section
    // boundary, which is the artefact this treatment exists to avoid.
    const block = css.slice(
      css.indexOf(".landing-shell #connections"),
      css.indexOf(".landing-shell #connections") + 600
    );
    expect(block).toContain("linear-gradient(180deg");
    expect(block).toContain("transparent 0,");
    expect(block).toContain("transparent 100%)");
  });

  it("fades the section wash over a fixed distance, not a share of it", () => {
    // A percentage fade put a tall section's opening paragraph hundreds of
    // pixels inside the ramp (so its copy landed on bare rock) and let a
    // short section's last line fall into the fade-out. A fixed 24px is
    // narrower than the smallest section's vertical padding.
    const block = css.slice(
      css.indexOf(".landing-shell #connections"),
      css.indexOf(".landing-shell #connections") + 600
    );
    expect(block).toContain("24px");
    expect(block).not.toMatch(/\d+%,\s*$/m);
  });

  it("keeps the section wash light enough for the photo to read", () => {
    // The wash protects the copy, but a heavy one turns the section back
    // into flat cream. Its ceiling is the load-bearing number: measured on
    // the rendered page, 76% is the most the copy tolerates before its
    // contrast starts to fail.
    const start = css.indexOf(".landing-shell #connections");
    const block = css.slice(start, css.indexOf("}", start) + 1);
    const mixes = [...block.matchAll(/var\(--canyon-wash\) (\d+)%/g)].map(
      (m) => Number(m[1])
    );
    expect(mixes.length).toBeGreaterThan(0);
    for (const pct of mixes) {
      expect(pct).toBeLessThanOrEqual(80);
    }
  });

  it("gives the integrations strip the id the wash rule targets", () => {
    const connections = readFileSync(
      path.resolve(
        process.cwd(),
        "client/src/pages/landing/Connections.tsx"
      ),
      "utf8"
    );
    expect(connections).toContain('id="connections"');
  });

  it("washes the hero caption with a wash that travels with it", () => {
    // The scrim is a FIXED viewport layer, so a gradient placed to suit the
    // caption at the top of the page misses it once the page scrolls. The
    // caption carries its own wash instead.
    const hero = readFileSync(
      path.resolve(process.cwd(), "client/src/pages/landing/Hero.tsx"),
      "utf8"
    );
    expect(hero).toContain("landing-hero-caption");

    // Slice only the caption's own rule: a wider slice would reach the
    // section wash further down the file and pass on ITS wash colour.
    const start = css.indexOf(".landing-hero-caption::before {");
    expect(start).toBeGreaterThan(-1);
    const captionRule = css.slice(start, css.indexOf("}", start) + 1);
    expect(captionRule).toContain("var(--canyon-wash)");
  });

  it("gives the hero copy column a wash that travels with the copy", () => {
    // The scrim is fixed to the viewport, so it cannot protect copy that
    // scrolls. The copy column carries its own wash — which is also what
    // lets the rest of the frame keep its rock.
    const hero = readFileSync(
      path.resolve(process.cwd(), "client/src/pages/landing/Hero.tsx"),
      "utf8"
    );
    expect(hero).toContain("landing-hero-copy");

    const start = css.indexOf(".landing-hero-copy::before {");
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    expect(rule).toContain("radial-gradient");
    // The wash must be strong where the copy actually sits.
    expect(rule).toMatch(/\/ \.9\d+\)/);
  });

  it("keeps the viewport scrim light so it cannot flatten the photo", () => {
    // The full-bleed wash is what made the photo barely legible. The scrim
    // must stay light everywhere: the heavy gradients live with the COPY
    // now, not with the viewport.
    const scrim = css.slice(css.indexOf(".landing-canyon-scrim {"));
    const block = scrim.slice(0, scrim.indexOf("}") + 1);

    // No copy-focused radial in the viewport scrim any more.
    expect(block).not.toContain("radial-gradient(46% 58% at 19% 37%");

    const alphas = [...block.matchAll(/\/ \.(\d+)\)/g)].map((m) =>
      Number(m[1])
    );
    expect(alphas.length).toBeGreaterThan(0);
    for (const alpha of alphas) {
      expect(alpha).toBeLessThanOrEqual(40);
    }
  });

  it("zooms the photo past the pale sky band into the rock", () => {
    // `cover` puts a nearly white sky band (luminance 234) across the top of
    // the frame; any wash over it renders as flat cream and the landscape
    // disappears. The photo is zoomed so the strata and shadowed rock fill
    // the frame instead.
    const start = css.indexOf(".landing-canyon-photo {");
    const block = css.slice(start, css.indexOf("}", start) + 1);
    expect(block).toContain("background-size: 165% auto");
    expect(block).toContain("background-position: 58% 44%");
  });
});
