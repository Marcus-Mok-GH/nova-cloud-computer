import { describe, expect, it } from "vitest";
import { normaliseDeck } from "./deckModel";
import { renderDeckPdf, renderDeckPptx } from "./deckRender";

const deck = normaliseDeck({
  title: "Deck",
  design: { background: "#FFF4E6", accent: "#C56A32", motif: "dots", font: "Times" },
  slides: [
    { id: "s1", layout: "cover", title: "Deck" },
    { id: "s2", layout: "bullets", title: "Wins", bullets: ["Revenue up", "Costs flat"] },
  ],
});
if (!deck.ok) throw new Error(deck.reason);

describe("renderDeckPptx", () => {
  it("returns a real PPTX zip buffer", async () => {
    const buffer = await renderDeckPptx(deck.value);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(2000);
  });
});

describe("renderDeckPdf", () => {
  it("returns a real PDF buffer", async () => {
    const buffer = await renderDeckPdf(deck.value);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
