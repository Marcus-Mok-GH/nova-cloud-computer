import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createWorkspaceFileForUser: vi.fn(async (_owner: number, input: { name: string }) => ({ id: 10 + input.name.length, name: input.name })),
  updateWorkspaceFileForUser: vi.fn(async () => ({ id: 99 })),
  getWorkspaceFileForUser: vi.fn(async () => null),
}));
vi.mock("../db", () => db);

const render = vi.hoisted(() => ({
  renderDeckPptx: vi.fn(async () => Buffer.from("PPTX")),
  renderDeckPdf: vi.fn(async () => Buffer.from("PDF")),
}));
vi.mock("./deckRender", () => render);

import {
  toolExportPresentation,
  toolGeneratePresentation,
} from "./presentation";

function ctx(args: Record<string, unknown>) {
  return {
    ownerId: 7,
    args,
    computer: { files: [], folders: [] },
    str: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
  } as unknown as Parameters<typeof toolGeneratePresentation>[0];
}

const deckArgs = {
  title: "Q3 plan",
  design: { background: "#FFF4E6", accent: "#C56A32" },
  slides: [{ id: "s1", layout: "cover", title: "Q3 plan" }],
};

beforeEach(() => vi.clearAllMocks());

describe("toolGeneratePresentation", () => {
  it("saves the deck JSON and an initial PPTX", async () => {
    const result = await toolGeneratePresentation(ctx(deckArgs));
    expect(result.ok).toBe(true);
    const names = db.createWorkspaceFileForUser.mock.calls.map(call => call[1].name);
    expect(names).toContain("Q3-plan.deck.json");
    expect(names).toContain("Q3-plan.pptx");
    expect(result.result).toContain("editable");
  });
});

describe("toolExportPresentation", () => {
  it("exports both requested formats", async () => {
    db.getWorkspaceFileForUser.mockResolvedValueOnce({
      id: 42,
      name: "Q3-plan.deck.json",
      content: JSON.stringify(deckArgs),
      mimeType: "application/json",
    } as never);
    const result = await toolExportPresentation(ctx({ deck_id: 42, formats: ["pptx", "pdf"] }));
    expect(result.ok).toBe(true);
    expect(render.renderDeckPptx).toHaveBeenCalled();
    expect(render.renderDeckPdf).toHaveBeenCalled();
    expect(db.createWorkspaceFileForUser.mock.calls.map(c => c[1].name)).toEqual(
      expect.arrayContaining(["Q3-plan.pptx", "Q3-plan.pdf"])
    );
  });
});
