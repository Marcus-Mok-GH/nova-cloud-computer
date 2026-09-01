import { afterEach, describe, expect, it, vi } from "vitest";

const append = vi.fn(async (_owner: number, input: { role: string; content: string }) => ({ id: 1, ...input }));
const createFile = vi.fn(async (_owner: number, input: { name: string; content?: string }) => ({ id: 2, ...input }));
const updateFolder = vi.fn(async (_owner: number, id: number, input: { name?: string; parentId?: number | null }) => ({ id, name: input.name ?? "Notes", parentId: input.parentId ?? null }));
const updateFile = vi.fn(async (_owner: number, id: number, input: { folderId?: number | null }) => ({ id, name: "welcome.md", folderId: input.folderId ?? null }));
const deleteFile = vi.fn(async () => true);
const deleteFolder = vi.fn(async () => true);
const telegramCredentials = vi.fn(async () => undefined);
const computer = vi.fn(async () => ({ workspace: { id: 41 }, folders: [{ id: 10, name: "Notes" }, { id: 11, name: "Archive" }], files: [{ id: 15, name: "welcome.md" }] }));
const chat = vi.fn(async () => ({ id: 3, title: "New workspace conversation" }));
const chatMessages = vi.fn(async () => [
  { id: 1, role: "user", content: "Help me plan a sprint." },
  { id: 2, role: "assistant", content: "Here is a two-week plan." },
]);
const renameChat = vi.fn(async (_owner: number, _chatId: number, title: string, _defaults: string[]) => ({ id: 3, title }));
const invoke = vi.fn();

const getWorkspaceModelSettingsForUser = vi.fn(async () => ({
  activeProvider: "anthropic",
  activeModelId: "claude-sonnet",
  activeCustomModelId: null,
  workspaceRules: null,
}));

vi.mock("./db", () => ({
  appendChatMessageForUser: append,
  getChatForUser: chat,
  listChatMessagesForUser: chatMessages,
  renameChatIfDefaultForUser: renameChat,
  createWorkspaceFileForUser: createFile,
  createWorkspaceFolderForUser: vi.fn(),
  getWorkspaceComputer: computer,
  updateWorkspaceFolderForUser: updateFolder,
  updateWorkspaceFileForUser: updateFile,
  deleteWorkspaceFileForUser: deleteFile,
  deleteWorkspaceFolderForUser: deleteFolder,
  getTelegramCredentialsForUser: telegramCredentials,
  getWorkspaceModelSettingsForUser,
}));
vi.mock("./_core/llm", () => ({ invokeLLM: invoke }));

const getDaytonaClient = vi.fn();
const runBash = vi.fn();
vi.mock("./daytona", () => ({
  getDaytonaClient,
  runBashCommandInPersistentSandbox: runBash,
}));

const envState = { nvidiaNimApiKey: "" };
vi.mock("./_core/env", () => ({
  ENV: {
    appId: "",
    cookieSecret: "",
    oAuthServerUrl: "",
    ownerOpenId: "",
    nvidiaNimApiUrl: "https://integrate.api.nvidia.com/v1",
    get nvidiaNimApiKey() { return envState.nvidiaNimApiKey; },
    databaseUrl: "",
    neonAuthBaseUrl: "",
    modelCredentialSecret: "",
    isProduction: false,
  }
}));

const { runWorkspaceAgent, autoTitleChatForUser } = await import("./workspaceAgent");

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

  it("reports an unavailable model connection instead of a canned AI reply", async () => {
    delete process.env.NVIDIA_NIM_API_KEY;
    envState.nvidiaNimApiKey = "";
    

    await expect(runWorkspaceAgent(7, 3, "Please reply with exactly this one word: PINEAPPLE.")).resolves.toMatchObject({
      actions: [],
      message: expect.objectContaining({ role: "assistant", content: expect.stringContaining("AI model is not connected") }),
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports an unavailable model connection when no provider is configured", async () => {
    delete process.env.NVIDIA_NIM_API_KEY;
    envState.nvidiaNimApiKey = "";

    await expect(runWorkspaceAgent(7, 3, "Please reply with exactly this one word: PINEAPPLE.")).resolves.toMatchObject({
      actions: [],
      message: expect.objectContaining({ role: "assistant", content: expect.stringContaining("AI model is not connected") }),
    });

    expect(invoke).not.toHaveBeenCalled();
  });

  it("executes folder deletion from the hosted-model tool path", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    process.env.NVIDIA_NIM_API_KEY = "configured-nim-key";
    envState.nvidiaNimApiKey = "configured-nim-key";
    invoke.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: "tool-1", function: { name: "delete_folder", arguments: '{"name":"Archive"}' } }] } }] });
    invoke.mockResolvedValueOnce({ choices: [{ message: { content: "Deleted Archive." } }] });
    const toolEvents: unknown[] = [];
    await expect(runWorkspaceAgent(7, 3, "Delete folder Archive", { onEvent: event => toolEvents.push(event) })).resolves.toMatchObject({ actions: [{ kind: "folder", operation: "deleted", name: "Archive" }] });
    expect(deleteFolder).toHaveBeenCalledWith(7, 11);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "configured-nim-key", apiUrl: "https://integrate.api.nvidia.com/v1", model: "claude-sonnet" }));
    expect(toolEvents).toEqual([
      { type: "tool", tool: { id: "tool-1", name: "delete_folder", state: "running", args: { name: "Archive" } } },
      { type: "tool", tool: { id: "tool-1", name: "delete_folder", state: "completed", args: { name: "Archive" }, summary: "Deleted folder: Archive." } },
    ]);
  });

  it("runs a bash command when the model calls the shell tool and feeds its output back", async () => {
    delete process.env.BUILT_IN_FORGE_API_KEY;
    process.env.NVIDIA_NIM_API_KEY = "configured-nim-key";
    envState.nvidiaNimApiKey = "configured-nim-key";
    getDaytonaClient.mockReturnValue({});
    runBash.mockResolvedValue({ ok: true, exitCode: 0, output: "2 items in /home/daytona/workspace", sandboxId: "sbx-bash" });
    invoke.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ id: "tool-bash", function: { name: "run_bash_command", arguments: '{"command":"ls /home/daytona/workspace"}' } }] } }] });
    invoke.mockResolvedValueOnce({ choices: [{ message: { content: "Your workspace contains 2 items." } }] });

    await expect(runWorkspaceAgent(7, 3, "Use a shell to list my workspace")).resolves.toMatchObject({
      actions: [{ kind: "vm", operation: "completed", name: "bash: ls /home/daytona/workspace" }],
    });

    expect(runBash).toHaveBeenCalledWith({}, { workspaceId: 41, ownerId: 7, command: "ls /home/daytona/workspace" });
    const finalCall = invoke.mock.calls.at(-1)?.[0];
    expect(finalCall.messages).toContainEqual({ role: "tool", tool_call_id: "tool-bash", content: JSON.stringify({ ok: true, output: "2 items in /home/daytona/workspace" }) });
  });
});

describe("autoTitleChatForUser", () => {
  afterEach(() => {
    envState.nvidiaNimApiKey = "";
    chat.mockImplementation(async () => ({ id: 3, title: "New workspace conversation" }));
    chatMessages.mockImplementation(async () => [
      { id: 1, role: "user", content: "Help me plan a sprint." },
      { id: 2, role: "assistant", content: "Here is a two-week plan." },
    ]);
    vi.clearAllMocks();
  });

  it("renames a default-titled chat from its first messages", async () => {
    envState.nvidiaNimApiKey = "configured-nim-key";
    invoke.mockResolvedValueOnce({ choices: [{ message: { content: 'Sprint planning help' } }] });
    await autoTitleChatForUser(7, 3);
    expect(renameChat).toHaveBeenCalledWith(7, 3, "Sprint planning help", ["New workspace conversation", "New conversation", "Telegram Chat"]);
  });

  it("leaves already-titled chats alone", async () => {
    chat.mockResolvedValue({ id: 3, title: "Sprint planning help" });
    await autoTitleChatForUser(7, 3);
    expect(invoke).not.toHaveBeenCalled();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it("does nothing before the first assistant reply", async () => {
    envState.nvidiaNimApiKey = "configured-nim-key";
    chatMessages.mockResolvedValue([{ id: 1, role: "user", content: "Hello?" }]);
    await autoTitleChatForUser(7, 3);
    expect(invoke).not.toHaveBeenCalled();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it("strips wrapping quotes and newlines from the model title", async () => {
    envState.nvidiaNimApiKey = "configured-nim-key";
    invoke.mockResolvedValueOnce({ choices: [{ message: { content: '""Sprint\nplanning"\n' } }] });
    await autoTitleChatForUser(7, 3);
    expect(renameChat).toHaveBeenCalledWith(7, 3, "Sprint", ["New workspace conversation", "New conversation", "Telegram Chat"]);
  });

  it("does not overwrite a concurrent rename that lands before the conditional update", async () => {
    envState.nvidiaNimApiKey = "configured-nim-key";
    invoke.mockResolvedValueOnce({ choices: [{ message: { content: "Sprint planning help" } }] });
    renameChat.mockResolvedValueOnce(undefined);
    await expect(autoTitleChatForUser(7, 3)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
