import { afterEach, describe, expect, it, vi } from "vitest";

const append = vi.fn(
  async (_owner: number, input: { role: string; content: string }) => ({
    id: 1,
    ...input,
  })
);
const createFile = vi.fn(
  async (_owner: number, input: { name: string; content?: string }) => ({
    id: 2,
    ...input,
  })
);
const createFolder = vi.fn(async (_owner: number, input: { name: string }) => ({
  id: 3,
  ...input,
}));
const updateFolder = vi.fn(
  async (
    _owner: number,
    id: number,
    input: { name?: string; parentId?: number | null }
  ) => ({ id, name: input.name ?? "Notes", parentId: input.parentId ?? null })
);
const updateFile = vi.fn(
  async (_owner: number, id: number, input: { folderId?: number | null }) => ({
    id,
    name: "welcome.md",
    folderId: input.folderId ?? null,
  })
);
const deleteFile = vi.fn(async () => true);
const deleteFolder = vi.fn(async () => true);
const telegramCredentials = vi.fn(async () => undefined);
const computer = vi.fn(async () => ({
  workspace: { id: 41, persistentSandboxId: "sbx-vm" },
  folders: [
    { id: 10, name: "Notes" },
    { id: 11, name: "Archive" },
  ],
  files: [{ id: 15, name: "welcome.md" }],
}));
const chat = vi.fn(async () => ({
  id: 3,
  title: "New workspace conversation",
}));
const chatMessages = vi.fn(async () => [
  { id: 1, role: "user", content: "Help me plan a sprint." },
  { id: 2, role: "assistant", content: "Here is a two-week plan." },
]);
const renameChat = vi.fn(
  async (
    _owner: number,
    _chatId: number,
    title: string,
    _defaults: string[]
  ) => ({ id: 3, title })
);

vi.mock("./db", () => ({
  appendChatMessageForUser: append,
  getChatForUser: chat,
  listChatMessagesForUser: chatMessages,
  renameChatIfDefaultForUser: renameChat,
  createWorkspaceFileForUser: createFile,
  createWorkspaceFolderForUser: createFolder,
  getWorkspaceComputer: computer,
  updateWorkspacePersistentSandbox: vi.fn(async () => undefined),
  updateWorkspaceFolderForUser: updateFolder,
  updateWorkspaceFileForUser: updateFile,
  deleteWorkspaceFileForUser: deleteFile,
  deleteWorkspaceFolderForUser: deleteFolder,
  getTelegramCredentialsForUser: telegramCredentials,
}));

const getE2BClient = vi.fn();
const runOpencodeChat = vi.fn();
vi.mock("./e2b", () => ({
  getE2BClient,
  ensurePersistentSandbox: vi.fn(
    async (
      _client: unknown,
      _workspaceId: number,
      _ownerId: number,
      sandboxId?: string | null
    ) => ({
      sandboxId: sandboxId ?? "sbx-vm",
      commands: { run: vi.fn() },
      files: { write: vi.fn(), read: vi.fn(), list: vi.fn() },
    })
  ),
  runOpencodeChatInPersistentSandbox: runOpencodeChat,
}));

vi.mock("./workspaceSync", () => ({
  persistE2BWorkspace: vi.fn(async () => 0),
  persistWorkspaceToObjectStorage: vi.fn(async () => ({
    workspaceId: 41,
    uploaded: 0,
  })),
  restoreWorkspaceToE2B: vi.fn(async () => 0),
}));

vi.mock("./_core/env", () => ({
  ENV: {
    appId: "",
    cookieSecret: "",
    oAuthServerUrl: "",
    ownerOpenId: "",
    opencodeZenModel: "big-pickle",
    databaseUrl: "",
    neonAuthBaseUrl: "",
    modelCredentialSecret: "",
    isProduction: false,
  },
}));

const { runWorkspaceAgent, autoTitleChatForUser } = await import(
  "./workspaceAgent"
);

describe("Nova VM-agent workspace", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a requested plain-text file without any hosted model key", async () => {
    const result = await runWorkspaceAgent(
      7,
      3,
      "Create a plain text file named welcome.md containing exactly: Hello from Nova."
    );
    expect(createFile).toHaveBeenCalledWith(7, {
      name: "welcome.md",
      content: "Hello from Nova.",
    });
    expect(result.actions).toEqual([{ kind: "file", name: "welcome.md" }]);
    expect(append).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("welcome.md"),
      })
    );
  });

  it("creates a requested folder directly without a model round-trip", async () => {
    const result = await runWorkspaceAgent(
      7,
      3,
      "Create a folder named Research."
    );
    expect(createFolder).toHaveBeenCalledWith(7, { name: "Research" });
    expect(result.actions).toEqual([{ kind: "folder", name: "Research" }]);
    expect(runOpencodeChat).not.toHaveBeenCalled();
  });

  it("renames and moves folders through explicit direct requests", async () => {
    await expect(
      runWorkspaceAgent(7, 3, "Rename folder Notes to Research")
    ).resolves.toMatchObject({
      actions: [{ kind: "folder", operation: "renamed", name: "Research" }],
    });
    await expect(
      runWorkspaceAgent(7, 3, "Move folder Notes into folder Archive")
    ).resolves.toMatchObject({
      actions: [{ kind: "folder", operation: "moved", name: "Notes" }],
    });
    expect(updateFolder).toHaveBeenCalledWith(7, 10, { parentId: 11 });
  });

  it("moves a file directly", async () => {
    await expect(
      runWorkspaceAgent(7, 3, "Move file welcome.md into folder Archive")
    ).resolves.toMatchObject({
      actions: [{ kind: "file", operation: "moved", name: "welcome.md" }],
    });
    expect(updateFile).toHaveBeenCalledWith(7, 15, { folderId: 11 });
  });

  it("deletes a requested file even when the sentence ends with punctuation", async () => {
    await expect(
      runWorkspaceAgent(7, 3, "Delete file welcome.md.")
    ).resolves.toMatchObject({
      actions: [{ kind: "file", operation: "deleted", name: "welcome.md" }],
    });
    expect(deleteFile).toHaveBeenCalledWith(7, 15);
  });

  it("deletes a requested folder directly", async () => {
    const result = await runWorkspaceAgent(7, 3, "Delete folder Archive");
    expect(deleteFolder).toHaveBeenCalledWith(7, 11);
    expect(result.actions).toEqual([
      { kind: "folder", operation: "deleted", name: "Archive" },
    ]);
    expect(runOpencodeChat).not.toHaveBeenCalled();
  });

  it("streams a conversational reply via the VM's opencode CLI", async () => {
    getE2BClient.mockReturnValue({
      connect: vi.fn(async () => ({
        sandboxId: "sbx-vm",
        commands: { run: vi.fn() },
        files: { write: vi.fn(), read: vi.fn(), list: vi.fn() },
      })),
    });
    runOpencodeChat.mockResolvedValue({
      reply: "Hello from the VM.",
      sandboxId: "sbx-vm",
    });

    await expect(
      runWorkspaceAgent(
        7,
        3,
        "Please reply with exactly this one word: PINEAPPLE."
      )
    ).resolves.toMatchObject({
      actions: [],
      message: expect.objectContaining({
        role: "assistant",
        content: "Hello from the VM.",
      }),
    });

    expect(runOpencodeChat).toHaveBeenCalledWith(
      expect.objectContaining({ connect: expect.any(Function) }),
      expect.objectContaining({
        workspaceId: 41,
        ownerId: 7,
        model: "big-pickle",
        prompt: expect.stringContaining("PINEAPPLE"),
      })
    );
  });

  it("reports the VM is unavailable when no E2B client is configured", async () => {
    getE2BClient.mockReturnValue(undefined);
    await expect(
      runWorkspaceAgent(
        7,
        3,
        "Please reply with exactly this one word: PINEAPPLE."
      )
    ).resolves.toMatchObject({
      actions: [],
      message: expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("VM"),
      }),
    });
    expect(runOpencodeChat).not.toHaveBeenCalled();
  });

  it("reports the VM is unavailable when the opencode chat throws", async () => {
    getE2BClient.mockReturnValue({});
    runOpencodeChat.mockRejectedValue(new Error("sandbox down"));
    await expect(
      runWorkspaceAgent(
        7,
        3,
        "Please reply with exactly this one word: PINEAPPLE."
      )
    ).resolves.toMatchObject({
      actions: [],
      message: expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("VM"),
      }),
    });
  });
});

describe("autoTitleChatForUser", () => {
  afterEach(() => {
    chat.mockImplementation(async () => ({
      id: 3,
      title: "New workspace conversation",
    }));
    chatMessages.mockImplementation(async () => [
      { id: 1, role: "user", content: "Help me plan a sprint." },
      { id: 2, role: "assistant", content: "Here is a two-week plan." },
    ]);
    vi.clearAllMocks();
  });

  it("renames a default-titled chat from its first messages via the VM", async () => {
    getE2BClient.mockReturnValue({});
    runOpencodeChat.mockResolvedValue({
      reply: "Sprint planning help",
      sandboxId: "sbx-vm",
    });
    await autoTitleChatForUser(7, 3);
    expect(renameChat).toHaveBeenCalledWith(7, 3, "Sprint planning help", [
      "New workspace conversation",
      "New conversation",
      "Telegram Chat",
    ]);
  });

  it("leaves already-titled chats alone", async () => {
    chat.mockResolvedValue({ id: 3, title: "Sprint planning help" });
    await autoTitleChatForUser(7, 3);
    expect(runOpencodeChat).not.toHaveBeenCalled();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it("does nothing before the first assistant reply", async () => {
    chatMessages.mockResolvedValue([
      { id: 1, role: "user", content: "Hello?" },
    ]);
    await autoTitleChatForUser(7, 3);
    expect(runOpencodeChat).not.toHaveBeenCalled();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it("strips wrapping quotes and newlines from the model title", async () => {
    getE2BClient.mockReturnValue({});
    runOpencodeChat.mockResolvedValue({
      reply: '""Sprint\nplanning"\n',
      sandboxId: "sbx-vm",
    });
    await autoTitleChatForUser(7, 3);
    expect(renameChat).toHaveBeenCalledWith(7, 3, "Sprint", [
      "New workspace conversation",
      "New conversation",
      "Telegram Chat",
    ]);
  });

  it("does not rename when the VM title is missing", async () => {
    getE2BClient.mockReturnValue({});
    runOpencodeChat.mockResolvedValue({ reply: "", sandboxId: "sbx-vm" });
    await autoTitleChatForUser(7, 3);
    expect(renameChat).not.toHaveBeenCalled();
  });
});
