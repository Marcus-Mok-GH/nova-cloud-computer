import { inflateRawSync, inflateSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normaliseDeck, THEMES } from "./deckModel";
import { renderDeckPdf, renderDeckPptx } from "./deckRender";

vi.mock("./deckLayout", async importOriginal => {
  const actual = await importOriginal<typeof import("./deckLayout")>();
  return { ...actual, layoutDeck: vi.fn(actual.layoutDeck) };
});

import { layoutDeck, SLIDE_H, SLIDE_W } from "./deckLayout";

function zipEntry(zip: Buffer, name: string): string | null {
  let position = 0;
  for (;;) {
    const signature = zip.indexOf("PK\x03\x04", position);
    if (signature < 0) return null;
    const method = zip.readUInt16LE(signature + 8);
    const size = zip.readUInt32LE(signature + 18);
    const nameLength = zip.readUInt16LE(signature + 26);
    const extraLength = zip.readUInt16LE(signature + 28);
    const start = signature + 30 + nameLength + extraLength;
    if (zip.subarray(signature + 30, signature + 30 + nameLength).toString() === name) {
      const data = zip.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(data) : data).toString();
    }
    position = signature + 4;
  }
}

function pdfStreamsContain(pdf: Buffer, needle: string) {
  const pattern = /stream\r?\n([\s\S]*?)endstream/g;
  for (const match of pdf.toString("latin1").matchAll(pattern)) {
    try {
      if (inflateSync(Buffer.from(match[1], "latin1")).toString("latin1").includes(needle)) return true;
    } catch {}
  }
  return false;
}

const parsed = normaliseDeck({
  title: "Deck",
  design: { theme: "forest-ink" },
  slides: [
    { id: "s1", layout: "cover", title: "Deck", bullets: ["2026"] },
    { id: "s2", layout: "quote", title: "Design is how it works.", bullets: ["Steve Jobs"] },
    { id: "s3", layout: "metrics", title: "By the numbers", items: [{ label: "Active", value: "1,240" }] },
  ],
});
if (!parsed.ok) throw new Error(parsed.reason);
const deck = parsed.value;

beforeEach(() => vi.clearAllMocks());

describe("renderDeckPptx", () => {
  it("returns a real PPTX zip buffer from the shared layout engine", async () => {
    const buffer = await renderDeckPptx(deck);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    expect(buffer.length).toBeGreaterThan(2000);
    expect(vi.mocked(layoutDeck)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(layoutDeck)).toHaveBeenCalledWith(deck);
  });

  it("uses the same 13.333x7.5 canvas as the PDF renderer", async () => {
    const xml = zipEntry(await renderDeckPptx(deck), "ppt/presentation.xml");
    const size = xml?.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
    expect(size).not.toBeNull();
    expect(Number(size![1]) / 914400).toBeCloseTo(SLIDE_W, 2);
    expect(Number(size![2]) / 914400).toBeCloseTo(SLIDE_H, 2);
  });
});

describe("renderDeckPdf", () => {
  it("returns a real PDF buffer from the same shared layout engine", async () => {
    const buffer = await renderDeckPdf(deck);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(1000);
    expect(vi.mocked(layoutDeck)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(layoutDeck)).toHaveBeenCalledWith(deck);
  });
});

describe("both renderers", () => {
  it("render every preset theme, including italic quote pages", async () => {
    for (const theme of THEMES) {
      const themed = normaliseDeck({ ...deck, design: { theme: theme.name } });
      if (!themed.ok) throw new Error(themed.reason);
      const pptx = await renderDeckPptx(themed.value);
      const pdf = await renderDeckPdf(themed.value);
      expect(pptx.subarray(0, 2).toString()).toBe("PK");
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("makes the Made with Nova badge clickable in PPTX and PDF", async () => {
    const pptx = await renderDeckPptx(deck);
    const pdf = await renderDeckPdf(deck);
    expect(pptx.toString("latin1")).toContain("https://nova-cloud-computer.vercel.app");
    expect(pdfStreamsContain(pdf, "https://nova-cloud-computer.vercel.app")).toBe(true);
  });
});
