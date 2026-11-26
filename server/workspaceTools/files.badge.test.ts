// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ created: [] as Array<{ name: string; content: string }>, updated: [] as string[] }));

vi.mock("../db", () => ({
  createWorkspaceFileForUser: vi.fn(async (_owner: number, input: { name: string; content: string }) => {
    state.created.push({ name: input.name, content: input.content });
    return { id: 1, name: input.name, folderId: null };
  }),
  deleteWorkspaceFileForUser: vi.fn(async () => true),
  updateWorkspaceFileForUser: vi.fn(async (_owner: number, _id: number, input: { content?: string }) => {
    if (input.content) state.updated.push(input.content);
    return { id: 1, name: "site.html", folderId: null };
  }),
}));

import { toolCreateFile, toolEditFile } from "./files";
import type { ToolCtx } from "./types";

function ctx(args: Record<string, unknown>, existingContent = ""): ToolCtx {
  return {
    args,
    str: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
    ownerId: 1,
    computer: {
      files: [{ id: 1, name: "site.html", content: existingContent, folderId: null }],
      folders: [],
    },
    folderRows: [],
    mirror: vi.fn(async () => undefined),
  } as unknown as ToolCtx;
}

describe("HTML workspace files", () => {
  it("injects the badge when the agent creates a page", async () => {
    const result = await toolCreateFile(ctx({ name: "index.html", content: "<html><body>Hi</body></html>" }));
    expect(result.ok).toBe(true);
    expect(state.created[0].content).toContain("Made with Nova");
    expect(state.created[0].content).toContain("https://nova-cloud-computer.vercel.app");
  });

  it("keeps the badge when the agent edits a page", async () => {
    const result = await toolEditFile(ctx({ file: "site.html", content: "<html><body>Updated</body></html>" }));
    expect(result.ok).toBe(true);
    expect(state.updated[0]).toContain("Made with Nova");
  });

  it("does not badge non-HTML files", async () => {
    await toolCreateFile(ctx({ name: "notes.txt", content: "<html><body>Hi</body></html>" }));
    expect(state.created.at(-1)!.content).not.toContain("Made with Nova");
  });
});
