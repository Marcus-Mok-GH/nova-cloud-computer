// @vitest-environment node
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  store: new Map<number, { id: number; name: string; content: string; mimeType: string; folderId: number | null }>(),
  files: [] as Array<{ id: number; name: string; content: string; mimeType: string; folderId: number | null }>,
  nextId: 1,
}));

vi.mock("../db", () => ({
  createWorkspaceFileForUser: vi.fn(async (_owner: number, input: { name: string; content?: string; mimeType?: string }) => {
    if ([...state.store.values()].some(file => file.name === input.name)) return undefined;
    const row = {
      id: state.nextId++,
      name: input.name,
      content: input.content ?? "",
      mimeType: input.mimeType ?? "text/plain",
      folderId: null,
    };
    state.store.set(row.id, row);
    state.files.push(row);
    return row;
  }),
  getWorkspaceFileForUser: vi.fn(async (_owner: number, id: number) => state.store.get(id) ?? null),
  updateWorkspaceFileForUser: vi.fn(async (_owner: number, id: number, input: { content?: string }) => {
    const row = state.store.get(id);
    if (!row) return undefined;
    if (input.content !== undefined) row.content = input.content;
    const index = state.files.findIndex(file => file.id === id);
    if (index >= 0) state.files[index] = { ...row };
    return row;
  }),
}));

import {
  toolEditPresentation,
  toolExportPresentation,
  toolGeneratePresentation,
} from "./presentation";

function ctx(args: Record<string, unknown>) {
  return {
    ownerId: 7,
    args,
    computer: { files: state.files, folders: [] },
    str: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
  } as unknown as Parameters<typeof toolGeneratePresentation>[0];
}

const OUT = join(tmpdir(), "nova-presentation-verify");

beforeEach(() => {
  state.store.clear();
  state.files.length = 0;
  state.nextId = 1;
  mkdirSync(OUT, { recursive: true });
});

describe("real presentation pipeline", () => {
  it("generates, edits and exports a genuine PPTX and PDF", async () => {
    const generated = await toolGeneratePresentation(ctx({
      title: "Nova Systems Briefing",
      design: { background: "#18313A", accent: "#F2A65A", muted: "#9AB3BA", font: "Helvetica", motif: "grid", cover: "left", density: "airy" },
      slides: [
        { id: "s1", layout: "cover", title: "Nova Systems Briefing", bullets: ["November 2026"] },
        { id: "s2", layout: "bullets", title: "What we shipped", bullets: ["Scroll reveals", "Presentations"], notes: "Mention the agent tools" },
      ],
    }));
    expect(generated.ok).toBe(true);
    expect(state.files.map(file => file.name)).toEqual([
      "Nova-Systems-Briefing.deck.json",
      "Nova-Systems-Briefing.pptx",
    ]);

    const deckRow = state.files.find(file => file.name.endsWith(".deck.json"))!;
    const deck = JSON.parse(deckRow.content);
    expect(deck.design.background).toBe("#18313A");
    expect(deck.slides).toHaveLength(2);

    const edited = await toolEditPresentation(ctx({
      deck_id: deckRow.id,
      operations: [
        { op: "update_slide", id: "s2", patch: { title: "What changed", bullets: ["Scroll reveals", "Presentations", "Unique designs"] } },
        { op: "add_slide", after: "s2", slide: { id: "s3", layout: "metrics", title: "By the numbers", items: [{ label: "Slides", value: "3" }] } },
        { op: "set_design", patch: { motif: "dots" } },
      ],
    }));
    expect(edited.ok).toBe(true);
    const afterEdit = JSON.parse(state.store.get(deckRow.id)!.content);
    expect(afterEdit.slides.map((slide: { id: string }) => slide.id)).toEqual(["s1", "s2", "s3"]);
    expect(afterEdit.slides[1].title).toBe("What changed");
    expect(afterEdit.design.motif).toBe("dots");

    const exported = await toolExportPresentation(ctx({ deck_id: deckRow.id, formats: ["pptx", "pdf"] }));
    expect(exported.ok).toBe(true);

    for (const file of state.files) {
      const prefix = file.content.startsWith("data:") ? file.content.split(",", 2)[1] : file.content;
      const buffer = Buffer.from(prefix, file.content.startsWith("data:") ? "base64" : "utf8");
      writeFileSync(`${OUT}/${file.name}`, buffer);
    }
    console.log("FILES", state.files.map(file => `${file.name}:${file.content.length}`));
    console.log("RESULT", generated.result, "|", edited.result, "|", exported.result);

    const pptx = state.files.find(file => file.name.endsWith(".pptx"))!;
    const pdf = state.files.find(file => file.name.endsWith(".pdf"))!;
    expect(Buffer.from(pptx.content.split(",", 2)[1], "base64").subarray(0, 2).toString()).toBe("PK");
    expect(Buffer.from(pdf.content.split(",", 2)[1], "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("exports by stored file id when the workspace snapshot is stale in the same round", async () => {
    const generated = await toolGeneratePresentation(ctx({
      title: "Same Round Deck",
      design: { background: "#FBF8F3", accent: "#B96A3C" },
      slides: [{ id: "s1", layout: "cover", title: "Same Round Deck" }],
    }));
    expect(generated.ok).toBe(true);
    const deckRow = state.files.find(file => file.name.endsWith(".deck.json"))!;
    // Simulate the model calling export in the SAME assistant round: the
    // computer snapshot was taken before generate wrote its files.
    state.files.length = 0;
    const exported = await toolExportPresentation(ctx({ deck_id: deckRow.id, formats: ["pptx"] }));
    expect(exported.ok).toBe(true);
    expect(exported.result).toContain("updated file id 2");
    expect(state.store.size).toBe(2);
    expect(state.store.get(2)!.name).toBe("Same-Round-Deck.pptx");
    expect(JSON.parse(state.store.get(deckRow.id)!.content).exports.pptx).toBe(2);
  });
});
