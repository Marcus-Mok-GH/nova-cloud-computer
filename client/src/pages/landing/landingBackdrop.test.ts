import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The canyon backdrop's readability contract.
 *
 * The photo sits behind the WHOLE public page, so copy that lands on it
 * directly (the hero headline, the integration strip, the section
 * paragraphs) needs a wash of its own. That wash is CSS, so it cannot be
 * asserted from a render — but the HOOKS it depends on can: the id on the
 * connections strip, and the id on every section whose paragraph sits
 * directly on the photo.
 *
 * These ids are load-bearing. If one is renamed in the component and not in
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

  it("keeps the scrim copy-focused instead of washing the whole photo", () => {
    // The full-bleed base wash is what made the photo barely legible: it
    // pushed the backdrop's saturation from 90 down to 45. The scrim must
    // stay a light wash with heavy gradients only behind copy.
    const scrim = css.slice(css.indexOf(".landing-canyon-scrim {"));
    const block = scrim.slice(0, scrim.indexOf("}") + 1);

    // The copy-focused radial behind the headline is the load-bearing part.
    expect(block).toContain("radial-gradient(46% 58% at 19% 37%");

    // The BASE wash is the last layer, and it covers the whole frame, so
    // every stop in it must stay light. A heavy stop here is what flattened
    // the photo in the first place.
    const baseWash = block.slice(block.lastIndexOf("linear-gradient(180deg"));
    const alphas = [...baseWash.matchAll(/\/ \.(\d+)\)/g)].map((m) =>
      Number(m[1])
    );
    expect(alphas.length).toBeGreaterThan(0);
    for (const alpha of alphas) {
      expect(alpha).toBeLessThanOrEqual(40);
    }
  });
});
