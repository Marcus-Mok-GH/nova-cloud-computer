import { afterEach, describe, expect, it, vi } from "vitest";

const append = vi.fn(async (_owner: number, input: { role: string; content: string }) => ({ id: 1, ...input }));
const createFile = vi.fn(async (_owner: number, input: { name: string; content?: string }) => ({ id: 2, ...input }));

vi.mock("./db", () => ({
  appendChatMessageForUser: append,
  createWorkspaceFileForUser: createFile,
  createWorkspaceFolderForUser: vi.fn(),
  getWorkspaceComputer: vi.fn(),
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
});
