import { describe, expect, it } from "vitest";
import { applyDeckOperations } from "./deckEdit";
import { normaliseDeck } from "./deckModel";

const made = normaliseDeck({
  title: "Deck",
  design: {},
  slides: [
    { id: "s1", layout: "cover", title: "Deck" },
    { id: "s2", layout: "bullets", title: "Old", bullets: ["A"] },
  ],
});
if (!made.ok) throw new Error(made.reason);

describe("applyDeckOperations", () => {
  it("updates a slide without touching the others", () => {
    const next = applyDeckOperations(made.value, [
      { op: "update_slide", id: "s2", patch: { title: "New", bullets: ["B"] } },
    ]);
    expect(next.slides[1].title).toBe("New");
    expect(next.slides[1].bullets).toEqual(["B"]);
    expect(next.slides[0].title).toBe("Deck");
  });

  it("adds, removes and reorders slides, and changes the design", () => {
    const next = applyDeckOperations(made.value, [
      { op: "add_slide", slide: { id: "s3", layout: "quote", title: "Quote" }, after: "s2" },
      { op: "remove_slide", id: "s1" },
      { op: "move_slide", id: "s3", before: "s2" },
      { op: "set_design", patch: { theme: "swiss-green" } },
    ]);
    expect(next.slides.map(slide => slide.id)).toEqual(["s3", "s2"]);
    expect(next.design.theme).toBe("swiss-green");
  });
});
