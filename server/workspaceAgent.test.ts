import { afterEach, describe, expect, it, vi } from "vitest";

const append = vi.fn(async (_owner: number, input: { role: string; content: string }) => ({ id: 1, ...input }));
const createFile = vi.fn(async (_owner: number, input: { name: string; content?: string }) => ({ id: 2, ...input }));
const updateFolder = vi.fn(async (_owner: number, id: number, input: { name?: string; parentId?: number | null }) => ({ id, name: input.name ?? "Notes", parentId: input.parentId ?? null }));
const computer = vi.fn(async () => ({ folders: [{ id: 10, name: "Notes" }, { id: 11, name: "Archive" }], files: [] }));

vi.mock("./db", () => ({
  appendChatMessageForUser: append,
  createWorkspaceFileForUser: createFile,
  createWorkspaceFolderForUser: vi.fn(),
  getWorkspaceComputer: computer,
  updateWorkspaceFolderForUser: updateFolder,
  updateWorkspaceFileForUser: vi.fn(),
  deleteWorkspaceFileForUser: vi.fn(),
  deleteWorkspaceFolderForUser: vi.fn(),
}));
vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));

const { runWorkspaceAgent } = await import("./workspaceAgent");

describe("Nova keyless workspace agent", () => {
  const originalBuiltIn = process.env.BUILT_IN_FORGE_API_KEY;
  const originalOpenAi = process.env.OPENAI_API_KEY;
  afterEach(() => { process.env.BUILT_IN_FORGE_API_KEY = originalBuiltIn; process.env.OPENAI_API_KEY = originalOpenAi; vi.clearAllMocks(); });

  it("creates a requested plain-text file without a hosted model key", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const result = await runWorkspaceAgent(7, 3, "Create a plain text file named welcome.md containing exactly: Hello from Nova.");
    expect(createFile).toHaveBeenCalledWith(7, { name: "welcome.md", content: "Hello from Nova." });
    expect(result.actions).toEqual([{ kind: "file", name: "welcome.md" }]);
    expect(append).toHaveBeenLastCalledWith(7, expect.objectContaining({ role: "assistant", content: expect.stringContaining("welcome.md") }));
  });

  it("renames and moves folders through explicit keyless workspace requests", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await expect(runWorkspaceAgent(7, 3, "Rename folder Notes to Research")).resolves.toMatchObject({ actions: [{ kind: "folder", operation: "renamed", name: "Research" }] });
    await expect(runWorkspaceAgent(7, 3, "Move folder Notes into folder Archive")).resolves.toMatchObject({ actions: [{ kind: "folder", operation: "moved", name: "Notes" }] });
    expect(updateFolder).toHaveBeenCalledWith(7, 10, { parentId: 11 });
  });
});
