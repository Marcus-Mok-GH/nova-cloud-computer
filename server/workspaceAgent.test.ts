import { afterEach, describe, expect, it, vi } from "vitest";

const append = vi.fn(async (_owner: number, input: { role: string; content: string }) => ({ id: 1, ...input }));
const createFile = vi.fn(async (_owner: number, input: { name: string; content?: string }) => ({ id: 2, ...input }));
const updateFolder = vi.fn(async (_owner: number, id: number, input: { name?: string; parentId?: number | null }) => ({ id, name: input.name ?? "Notes", parentId: input.parentId ?? null }));
const updateFile = vi.fn(async (_owner: number, id: number, input: { folderId?: number | null }) => ({ id, name: "welcome.md", folderId: input.folderId ?? null }));
const deleteFile = vi.fn(async () => true);
const deleteFolder = vi.fn(async () => true);
const telegramCredentials = vi.fn(async () => undefined);
const computer = vi.fn(async () => ({ folders: [{ id: 10, name: "Notes" }, { id: 11, name: "Archive" }], files: [{ id: 15, name: "welcome.md" }] }));
const invoke = vi.fn();

vi.mock("./db", () => ({
  appendChatMessageForUser: append,
  createWorkspaceFileForUser: createFile,
  createWorkspaceFolderForUser: vi.fn(),
  getWorkspaceComputer: computer,
  updateWorkspaceFolderForUser: updateFolder,
  updateWorkspaceFileForUser: updateFile,
  deleteWorkspaceFileForUser: deleteFile,
  deleteWorkspaceFolderForUser: deleteFolder,
  getTelegramCredentialsForUser: telegramCredentials,
}));
vi.mock("./_core/llm", () => ({ invokeLLM: invoke }));

const envState = { nvidiaNimApiKey: "", forgeApiKey: "" };
vi.mock("./_core/env", () => ({
  ENV: {
    appId: "",
    cookieSecret: "",
    oAuthServerUrl: "",
    ownerOpenId: "",
    forgeApiUrl: "",
    get forgeApiKey() { return envState.forgeApiKey; },
    nvidiaNimApiUrl: "https://integrate.api.nvidia.com/v1",
    get nvidiaNimApiKey() { return envState.nvidiaNimApiKey; },
    databaseUrl: "",
    neonAuthBaseUrl: "",
    modelCredentialSecret: "",
    isProduction: false,
  }
}));

const { runWorkspaceAgent } = await import("./workspaceAgent");

describe("Nova keyless workspace agent", () => {
  const originalBuiltIn = process.env.BUILT_IN_FORGE_API_KEY;
  const originalOpenAi = process.env.OPENAI_API_KEY;
  const originalNim = process.env.NVIDIA_NIM_API_KEY;
  afterEach(() => {
    process.env.BUILT_IN_FORGE_API_KEY = originalBuiltIn;
    process.env.OPENAI_API_KEY = originalOpenAi;
    if (originalNim === undefined) {
      delete process.env.NVIDIA_NIM_API_KEY;
    } else {
      process.env.NVIDIA_NIM_API_KEY = originalNim;
    }
    envState.nvidiaNimApiKey = "";
    envState.forgeApiKey = "";
    vi.clearAllMocks();
  });

  it("creates a requested plain-text file without a hosted model key", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY;
    const result = await runWorkspaceAgent(7, 3, "Create a plain text file named welcome.md containing exactly: Hello from Nova.");
    expect(createFile).toHaveBeenCalledWith(7, { name: "welcome.md", content: "Hello from Nova." });
    expect(result.actions).toEqual([{ kind: "file", name: "welcome.md" }]);
    expect(append).toHaveBeenLastCalledWith(7, expect.objectContaining({ role: "assistant", content: expect.stringContaining("welcome.md") }));
  });

  it("renames and moves folders through explicit keyless workspace requests", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY;
    await expect(runWorkspaceAgent(7, 3, "Rename folder Notes to Research")).resolves.toMatchObject({ actions: [{ kind: "folder", operation: "renamed", name: "Research" }] });
    await expect(runWorkspaceAgent(7, 3, "Move folder Notes into folder Archive")).resolves.toMatchObject({ actions: [{ kind: "folder", operation: "moved", name: "Notes" }] });
    expect(updateFolder).toHaveBeenCalledWith(7, 10, { parentId: 11 });
  });

  it("moves a file with the keyless agent path", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY;
    await expect(runWorkspaceAgent(7, 3, "Move file welcome.md into folder Archive")).resolves.toMatchObject({ actions: [{ kind: "file", operation: "moved", name: "welcome.md" }] });
    expect(updateFile).toHaveBeenCalledWith(7, 15, { folderId: 11 });
  });

  it("deletes a requested file even when the sentence ends with punctuation", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.NVIDIA_NIM_API_KEY;
    await expect(runWorkspaceAgent(7, 3, "Delete file welcome.md.")).resolves.toMatchObject({ actions: [{ kind: "file", operation: "deleted", name: "welcome.md" }] });
    expect(deleteFile).toHaveBeenCalledWith(7, 15);
  });

  it("uses the managed model for ordinary chat when the NIM credential is absent", async () => {
    delete process.env.NVIDIA_NIM_API_KEY;
    envState.forgeApiKey = "managed-forge-key";
    invoke.mockResolvedValueOnce({ choices: [{ message: { content: "PINEAPPLE" } }] });

    await expect(runWorkspaceAgent(7, 3, "Please reply with exactly this one word: PINEAPPLE.")).resolves.toMatchObject({
      actions: [],
      message: expect.objectContaining({ role: "assistant", content: "PINEAPPLE" }),
    });

    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5-mini" }));
    expect(invoke).not.toHaveBeenCalledWith(expect.objectContaining({ apiKey: expect.anything() }));
  });

  it("executes folder deletion from the hosted-model tool path", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    process.env.NVIDIA_NIM_API_KEY = "configured-nim-key";
    envState.nvidiaNimApiKey = "configured-nim-key";
    invoke.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: "tool-1", function: { name: "delete_folder", arguments: '{"name":"Archive"}' } }] } }] });
    invoke.mockResolvedValueOnce({ choices: [{ message: { content: "Deleted Archive." } }] });
    await expect(runWorkspaceAgent(7, 3, "Delete folder Archive")).resolves.toMatchObject({ actions: [{ kind: "folder", operation: "deleted", name: "Archive" }] });
    expect(deleteFolder).toHaveBeenCalledWith(7, 11);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "configured-nim-key", apiUrl: "https://integrate.api.nvidia.com/v1", model: "z-ai/glm-5.3" }));
  });
});
