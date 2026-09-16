import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { presentTelegramFile, sendTelegramMessage } from "./telegram";

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
  ) => ({
    id,
    name: input.name ?? "Notes",
    parentId: input.parentId ?? null,
  })
);
const updateFile = vi.fn(
  async (
    _owner: number,
    id: number,
    input: { name?: string; content?: string; folderId?: number | null }
  ) => ({
    id,
    name: input.name ?? "welcome.md",
    content: input.content ?? "",
    folderId: input.folderId ?? null,
  })
);
const deleteFile = vi.fn(async () => true);
const deleteFolder = vi.fn(async () => true);
const telegramCredentials = vi.fn(async () => undefined);
const getDatabaseTime = vi.fn(async () => new Date("2026-09-16T05:00:00.000Z"));
const hasAgentStopAfter = vi.fn(async () => false);
const computer = vi.fn(async () => ({
  workspace: { id: 41, persistentSandboxId: "sbx-vm" },
  folders: [
    { id: 10, name: "Notes" },
    { id: 11, name: "Archive" },
  ],
  files: [{ id: 15, name: "welcome.md", content: "Hello" }],
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
  updateWorkspaceFolderForUser: updateFolder,
  updateWorkspaceFileForUser: updateFile,
  deleteWorkspaceFileForUser: deleteFile,
  deleteWorkspaceFolderForUser: deleteFolder,
  getTelegramCredentialsForUser: telegramCredentials,
  getUserIdentityForUser: async () => ({ username: null, name: "Test User", email: "test@example.com" }),
  getDatabaseTime,
  hasAgentStopAfter,
}));

const completeWithNvidiaGateway = vi.fn();
const chatWithNvidiaGateway = vi.fn();
const getNvidiaGatewayStatus = vi.fn(() => ({
  configured: true,
  reachable: true,
  providerConfigured: true,
  providerConfigurationKnown: true,
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  allowance: {
    usedRequests: 0,
    maxRequests: 50,
    remainingRequests: 50,
    exhausted: false,
  },
}));
class NvidiaGatewayClientError extends Error {
  kind: "configuration" | "unavailable" | "rate_limit" | "invalid_response";
  constructor(message, kind) {
    super(message);
    this.name = "NvidiaGatewayClientError";
    this.kind = kind;
  }
}
vi.mock("./nvidiaGateway", () => ({
  completeWithNvidiaGateway,
  chatWithNvidiaGateway,
  getNvidiaGatewayStatus,
  NvidiaGatewayClientError,
}));

// startAgentVmRun (imported by workspaceAgent) pulls the E2B client; keep a
// lightweight mock so the real e2b SDK is never loaded in the test worker.
vi.mock("./e2b", () => ({
  getE2BClient: vi.fn(),
  isE2BConfigured: vi.fn(() => false),
  runE2BTaskInPersistentSandbox: vi.fn(),
  ensurePersistentSandbox: vi.fn(),
  getE2BSandboxStatus: vi.fn(),
  withE2BWorkspaceLock: vi.fn(),
}));

vi.mock("./workspaceSync", () => ({
  persistE2BWorkspace: vi.fn(async () => 0),
  restoreWorkspaceToE2B: vi.fn(async () => 0),
}));

vi.mock("./telegram", () => ({
  sendTelegramMessage: vi.fn(async () => ({ message_id: 77 })),
  presentTelegramFile: vi.fn(async () => ({ messageId: 78, as: "document" })),
}));

const {
  runWorkspaceAgent,
  autoTitleChatForUser,
  setGatewayRetryDelaysForTests,
  TOOL_ACTIVITY_MESSAGE_PREFIX,
  workspaceToolsForConnectors,
  getConnectedConnectorToolkits,
} = await import("./workspaceAgent");

const chatResult = (
  overrides: Partial<{
    text: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
  }> = {}
) => ({
  text: overrides.text ?? "",
  toolCalls: overrides.toolCalls ?? [],
  model: "nvidia/nemotron-3.5-lightning-30b-a3b",
  usage: null,
  allowance: {
    usedRequests: 1,
    maxRequests: 50,
    remainingRequests: 49,
    exhausted: false,
  },
});

describe("Nova tool-calling workspace agent", () => {
  beforeEach(() => {
    setGatewayRetryDelaysForTests([0, 0]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs every message through the model with workspace tools exposed", async () => {
    chatWithNvidiaGateway.mockResolvedValueOnce(
      chatResult({ text: "Sure — what should it contain?" })
    );
    await runWorkspaceAgent(1, 3, "hi");
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(1);
    const [owner, messages, options] = chatWithNvidiaGateway.mock.calls[0];
    expect(owner).toBe(1);
    expect(options.tools.length).toBeGreaterThan(10);
    const toolNames = options.tools.map(
      (tool: { function: { name: string } }) => tool.function.name
    );
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "create_file",
        "edit_file",
        "read_file",
        "delete_file",
        "create_folder",
        "rename_file",
        "move_file",
      ])
    );
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("Notes");
    expect(messages[0].content).toContain("welcome.md");
    expect(messages.at(-1)).toEqual({ role: "user", content: "hi" });
    expect(computer).toHaveBeenCalled();
  });

  it("creates a file when the model calls create_file, then finishes with a reply", async () => {
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_file",
              arguments: JSON.stringify({
                name: "notes.txt",
                content: "hello world",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Created notes.txt for you." })
      );
    const onChunk = vi.fn();
    const onEvent = vi.fn();
    const result = await runWorkspaceAgent(
      1,
      3,
      "create a file named notes.txt with hello world",
      {
        onChunk,
        onEvent,
      }
    );
    expect(createFile).toHaveBeenCalledWith(1, {
      name: "notes.txt",
      content: "hello world",
      folderId: null,
    });
    expect(result.actions).toEqual([
      { kind: "file", name: "notes.txt", operation: "created" },
    ]);
    // The tool loop fed the tool result back to the model.
    const secondCallMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondCallMessages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-1",
      content: "Created notes.txt (id 2).",
    });
    // Tool activity is emitted and persisted, then the final reply.
    expect(onEvent).toHaveBeenCalled();
    const persistedToolActivity = append.mock.calls
      .map(callArgs => callArgs[1])
      .find(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    expect(persistedToolActivity.content).toContain("create_file");
    expect(onChunk).toHaveBeenCalledWith("Created notes.txt for you.");
    expect(result.message.content).toBe("Created notes.txt for you.");
  });

  it("sends a model-driven progress update when the model calls send_progress_update", async () => {
    telegramCredentials.mockResolvedValueOnce({ token: "bot-token", chatId: "42" });
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-progress",
              name: "send_progress_update",
              arguments: JSON.stringify({
                text: "I'll get this done within about 30 seconds.",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "All done." }));
    const result = await runWorkspaceAgent(1, 3, "organize my files", {
      channel: "telegram",
    });
    expect(sendTelegramMessage).toHaveBeenCalledWith(
      "bot-token",
      "42",
      "I'll get this done within about 30 seconds."
    );
    // The tool result confirms delivery back to the model.
    const secondCallMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondCallMessages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-progress",
      content: "Sent the progress update (message #77).",
    });
    expect(result.actions).toEqual([
      {
        kind: "telegram",
        name: "I'll get this done within about 30 seconds.",
        operation: "sent",
      },
    ]);
  });

  it("sends uploaded images to the model as vision input on the user turn", async () => {
    const dataUri = "data:image/jpeg;base64,aGVsbG8=";
    chatWithNvidiaGateway.mockResolvedValueOnce(chatResult({ text: "Nice photo of a dog." }));
    await runWorkspaceAgent(1, 3, "what is in this picture?", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    const messages = chatWithNvidiaGateway.mock.calls[0][1];
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: [
        { type: "text", text: "what is in this picture?" },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    });
  });

  it("drops the attachment instead of failing when the model cannot see images", async () => {
    const dataUri = "data:image/png;base64,aGVsbG8=";
    chatWithNvidiaGateway.mockImplementation(async (_owner, messages) => {
      const last = messages.at(-1);
      if (Array.isArray(last.content)) throw new NvidiaGatewayClientError("image input is not supported by this model", "unavailable");
      return chatResult({ text: "I cannot see that image." });
    });
    const result = await runWorkspaceAgent(1, 3, "describe this", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    const plainCalls = chatWithNvidiaGateway.mock.calls.filter(
      call => typeof call[1].at(-1).content === "string"
    );
    expect(plainCalls.length).toBeGreaterThan(0);
    const retriedContent = plainCalls.at(-1)[1].at(-1).content;
    expect(retriedContent).toContain("cannot view image attachments");
    expect(result.message.content).toContain("I cannot see that image.");
  });

  it("presents a workspace file over Telegram when the model calls present_file", async () => {
    telegramCredentials.mockResolvedValueOnce({ token: "bot-token", chatId: "42" });
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-present",
              name: "present_file",
              arguments: JSON.stringify({ file: "welcome.md", caption: "Your file" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Here it is." }));
    const result = await runWorkspaceAgent(1, 3, "make me a welcome file", {
      channel: "telegram",
    });
    expect(presentTelegramFile).toHaveBeenCalledWith(
      "bot-token",
      "42",
      { name: "welcome.md", content: "Hello", mimeType: undefined },
      "Your file"
    );
    const secondCallMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondCallMessages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-present",
      content: "Presented welcome.md to the user as a document (message #78) — they can view or download it in the chat.",
    });
    expect(result.actions).toEqual([
      { kind: "file", name: "welcome.md", operation: "presented" },
    ]);
  });

  it("fails gracefully when Telegram is not connected for a present_file call", async () => {
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-present",
              name: "present_file",
              arguments: JSON.stringify({ file: "welcome.md" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Sorry — Telegram is not connected." }));
    await runWorkspaceAgent(1, 3, "send me the file", { channel: "telegram" });
    expect(presentTelegramFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondCallMessages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("Telegram is not connected"),
    });
  });

  it("recovers a tool call the model spelled out as text and executes it anyway", async () => {
    telegramCredentials.mockResolvedValueOnce({ token: "bot-token", chatId: "42" });
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          text: 'The function call that best answers the given prompt is {"name": "present_file", "parameters": {"file": "welcome.md", "caption": "Your file"}}',
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Sent!" }));
    const result = await runWorkspaceAgent(1, 3, "send me the file", {
      channel: "telegram",
    });
    // The embedded call ran as a real tool call, with its parameters.
    expect(presentTelegramFile).toHaveBeenCalledWith(
      "bot-token",
      "42",
      { name: "welcome.md", content: "Hello", mimeType: undefined },
      "Your file"
    );
    // The gateway saw a genuine assistant tool call and its tool result.
    const secondCallMessages = chatWithNvidiaGateway.mock.calls[1][1];
    expect(secondCallMessages.at(-2)).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          function: {
            name: "present_file",
            arguments: JSON.stringify({ file: "welcome.md", caption: "Your file" }),
          },
        },
      ],
    });
    expect(secondCallMessages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("Presented welcome.md"),
    });
    // The raw JSON never became the user-facing reply.
    expect(result.message.content).toBe("Sent!");
    expect(result.actions).toEqual([
      { kind: "file", name: "welcome.md", operation: "presented" },
    ]);
  });

  it("leaves ordinary JSON in replies alone", async () => {
    chatWithNvidiaGateway.mockResolvedValueOnce(
      chatResult({ text: 'Here is the payload: {"name": "unknown_thing", "parameters": {}}' })
    );
    const result = await runWorkspaceAgent(1, 3, "show me the payload", {});
    expect(result.message.content).toContain("unknown_thing");
    expect(presentTelegramFile).not.toHaveBeenCalled();
  });

  it("exposes present_file only to the Telegram bot, never to the web app", async () => {
    chatWithNvidiaGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi", { channel: "telegram" });
    chatWithNvidiaGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi");
    const telegramTools = chatWithNvidiaGateway.mock.calls[0][2].tools.map(
      tool => tool.function.name
    );
    const webTools = chatWithNvidiaGateway.mock.calls[1][2].tools.map(
      tool => tool.function.name
    );
    expect(telegramTools).toContain("present_file");
    expect(webTools).not.toContain("present_file");
  });

  it("reports the request channel and progress guidance through the system prompt", async () => {
    chatWithNvidiaGateway.mockResolvedValueOnce(chatResult({ text: "Sure." }));
    await runWorkspaceAgent(1, 3, "hi", { channel: "telegram" });
    const telegramPrompt = chatWithNvidiaGateway.mock.calls[0][1][0].content;
    expect(telegramPrompt).toContain("Telegram");
    expect(telegramPrompt).toContain(
      "the user only sees the messages you send"
    );
    expect(telegramPrompt).toContain("send_progress_update");
    expect(telegramPrompt).toContain("present it with present_file");
    expect(telegramPrompt).toContain("time estimate");
    expect(telegramPrompt).toContain("own the ETA");
    expect(telegramPrompt).toContain("revised range");
    expect(telegramPrompt).toContain("never let more than a minute or so pass in silence");

    chatWithNvidiaGateway.mockResolvedValueOnce(chatResult({ text: "Sure." }));
    await runWorkspaceAgent(1, 3, "hi");
    const webPrompt = chatWithNvidiaGateway.mock.calls[1][1][0].content;
    expect(webPrompt).toContain("the Nova web app");
    expect(webPrompt).toContain("the user sees your tool activity live");

    // The progress tool is exposed to the model either way.
    const tools = chatWithNvidiaGateway.mock.calls[1][2].tools;
    expect(tools.map(tool => tool.function.name)).toContain(
      "send_progress_update"
    );
  });


  it("edits an existing file's content through edit_file", async () => {
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-2",
              name: "edit_file",
              arguments: JSON.stringify({
                file: "welcome.md",
                content: "Hello, updated!",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Updated welcome.md." }));
    const result = await runWorkspaceAgent(
      1,
      3,
      "change welcome.md to say Hello, updated!"
    );
    expect(updateFile).toHaveBeenCalledWith(1, 15, {
      content: "Hello, updated!",
    });
    expect(result.actions).toEqual([
      { kind: "file", name: "welcome.md", operation: "updated" },
    ]);
  });

  it("reports tool failures back to the model instead of claiming success", async () => {
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-3",
              name: "delete_file",
              arguments: JSON.stringify({ file: "missing.txt" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "I couldn't find a file named missing.txt.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "delete missing.txt");
    expect(deleteFile).not.toHaveBeenCalled();
    expect(result.message.content).toBe(
      "I couldn't find a file named missing.txt."
    );
    expect(result.actions).toEqual([]);
    const toolRows = append.mock.calls
      .map(callArgs => callArgs[1])
      .filter(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    // The running state is persisted first, then the final failed state.
    expect(toolRows).toHaveLength(2);
    expect(
      JSON.parse(toolRows[0].content.slice(TOOL_ACTIVITY_MESSAGE_PREFIX.length))
        .state
    ).toBe("running");
    expect(
      JSON.parse(toolRows[1].content.slice(TOOL_ACTIVITY_MESSAGE_PREFIX.length))
        .state
    ).toBe("failed");
  });

  it("runs tool rounds without a step cap until the model stops calling tools", async () => {
    // The model requests 12 (failing) tool calls before finishing with text.
    // The old 8-round cap would have stopped it; the agent now keeps going.
    chatWithNvidiaGateway.mockImplementation(async () => {
      const calls = chatWithNvidiaGateway.mock.calls.length;
      if (calls >= 12) return chatResult({ text: "Done after 12 rounds." });
      return chatResult({
        toolCalls: [
          {
            id: `call-${calls}`,
            name: "delete_file",
            arguments: JSON.stringify({ file: "missing.txt" }),
          },
        ],
      });
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "loop forever", {
      onChunk,
    });
    expect(chatWithNvidiaGateway.mock.calls.length).toBe(12);
    expect(result.message.content).toContain("Done after 12 rounds.");
  });

  it("stops the run at the next round boundary when /stop was requested", async () => {
    chatWithNvidiaGateway.mockReset().mockImplementation(() =>
      Promise.resolve(
        chatWithNvidiaGateway.mock.calls.length === 1
          ? chatResult({
              toolCalls: [
                { id: "call-1", name: "create_file", arguments: JSON.stringify({ name: "plan.md", content: "x" }) },
              ],
            })
          : chatResult({ text: "This reply should never be produced." })
      )
    );
    // round 0 executes its tool normally; by round 1 the stop request exists.
    hasAgentStopAfter.mockReset().mockImplementation(async () => hasAgentStopAfter.mock.calls.length >= 2);

    const result = await runWorkspaceAgent(1, 3, "do something long", {});
    expect(createFile).toHaveBeenCalledTimes(1);
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("⏹️ Stopped");
    expect(result.message.content).toContain("/stop");
    chatWithNvidiaGateway.mockReset();
    hasAgentStopAfter.mockReset();
  });

  it("stops between tool calls so a long research run cannot continue", async () => {
    chatWithNvidiaGateway.mockReset().mockImplementation(() =>
      Promise.resolve(
        chatResult({
          toolCalls: [
            { id: "call-1", name: "create_file", arguments: JSON.stringify({ name: "a.md", content: "x" }) },
            { id: "call-2", name: "create_file", arguments: JSON.stringify({ name: "b.md", content: "y" }) },
          ],
        })
      )
    );
    // first tool allowed, stop discovered before the second tool
    hasAgentStopAfter.mockReset().mockImplementation(async () => hasAgentStopAfter.mock.calls.length >= 2);

    const result = await runWorkspaceAgent(1, 3, "two tools", {});
    expect(createFile).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("⏹️ Stopped");
    chatWithNvidiaGateway.mockReset();
    hasAgentStopAfter.mockReset();
  });

  it("surfaces a disabled Telegram tool to the model", async () => {
    chatWithNvidiaGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-4",
              name: "send_telegram_message",
              arguments: JSON.stringify({ text: "ping" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Connect Telegram in Settings first." })
      );
    const result = await runWorkspaceAgent(
      1,
      3,
      "send a telegram message saying ping"
    );
    expect(result.actions).toEqual([]);
    const toolMessage = chatWithNvidiaGateway.mock.calls[1][1].at(-1);
    expect(toolMessage.content).toContain("Telegram is not connected");
    expect(result.message.content).toBe("Connect Telegram in Settings first.");
  });

  it("streams reply chunks to onChunk as the model produces them", async () => {
    chatWithNvidiaGateway.mockImplementationOnce(async (owner, messages, options) => {
      options?.onChunk?.("Hello");
      options?.onChunk?.(" world");
      return chatResult({ text: "Hello world" });
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "tell me a story", {
      onChunk,
    });
    expect(onChunk).toHaveBeenCalledWith("Hello");
    expect(onChunk).toHaveBeenCalledWith(" world");
    // The streamed reply is not re-sent as one bulk chunk.
    expect(onChunk).not.toHaveBeenCalledWith("Hello world");
    expect(result.message.content).toBe("Hello world");
  });

  it("reports NVIDIA is unavailable when every retry fails", async () => {
    chatWithNvidiaGateway.mockRejectedValue(
      new NvidiaGatewayClientError("boom", "unavailable")
    );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(result.message.content).toContain("NVIDIA");
    expect(onChunk).toHaveBeenCalled();
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(3);
  });

  it("reports configuration error when the gateway is not configured", async () => {
    getNvidiaGatewayStatus.mockReturnValueOnce({
      configured: false,
      reachable: false,
      providerConfigured: false,
      providerConfigurationKnown: false,
      model: null,
      allowance: {
        usedRequests: 0,
        maxRequests: 50,
        remainingRequests: 50,
        exhausted: false,
      },
    });
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("not configured");
    expect(chatWithNvidiaGateway).not.toHaveBeenCalled();
  });

  it("reports unreachable gateway when health check fails", async () => {
    getNvidiaGatewayStatus.mockReturnValueOnce({
      configured: true,
      reachable: false,
      providerConfigured: false,
      providerConfigurationKnown: false,
      model: null,
      allowance: {
        usedRequests: 0,
        maxRequests: 50,
        remainingRequests: 50,
        exhausted: false,
      },
    });
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("unreachable");
    expect(chatWithNvidiaGateway).not.toHaveBeenCalled();
  });

  it("reports allowance exhausted when request cap is reached", async () => {
    getNvidiaGatewayStatus.mockReturnValueOnce({
      configured: true,
      reachable: true,
      providerConfigured: true,
      providerConfigurationKnown: true,
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      allowance: {
        usedRequests: 50,
        maxRequests: 50,
        remainingRequests: 0,
        exhausted: true,
      },
    });
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("exhausted");
    expect(chatWithNvidiaGateway).not.toHaveBeenCalled();
  });

  it("returns rate-limit message when the chat throws a rate_limit error", async () => {
    chatWithNvidiaGateway.mockRejectedValueOnce(
      new NvidiaGatewayClientError("cap", "rate_limit")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("allowance");
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(1);
  });

  it("returns configuration message when the chat throws a configuration error", async () => {
    chatWithNvidiaGateway.mockRejectedValueOnce(
      new NvidiaGatewayClientError("no key", "configuration")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("not connected");
  });

  it("returns invalid-response message when every retry is invalid", async () => {
    chatWithNvidiaGateway.mockRejectedValue(
      new NvidiaGatewayClientError("bad", "invalid_response")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("invalid response");
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(3);
  });

  it("recovers from a transient gateway failure by retrying the round", async () => {
    chatWithNvidiaGateway
      .mockRejectedValueOnce(
        new NvidiaGatewayClientError("blip", "unavailable")
      )
      .mockResolvedValueOnce(chatResult({ text: "All good." }));
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(2);
    expect(result.message.content).toBe("All good.");
    expect(onChunk).toHaveBeenCalledWith("All good.");
  });

  it("does not retry once text has already streamed to the client", async () => {
    // Simulate a mid-stream failure: a chunk reached the client, then the
    // gateway round aborted. Retrying would duplicate what the user saw.
    chatWithNvidiaGateway.mockImplementationOnce(
      async (owner, messages, options) => {
        options?.onChunk?.("Partial ");
        throw new NvidiaGatewayClientError("blip", "unavailable");
      }
    );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(chatWithNvidiaGateway).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith("Partial ");
    // The partial reply the user already watched is kept, with a note that the
    // gateway dropped — not replaced by a bare error notice.
    expect(result.message.content).toContain("Partial");
    expect(result.message.content).toContain("lost the connection");
    // The streamed partial is not re-emitted; only the failure note follows.
    const emitted = onChunk.mock.calls.map(call => call[0]).join("");
    expect(emitted).toBe("Partial " + "\n\nNova lost the connection to the inference gateway before this reply finished. Everything so far is saved — send another message and I will continue from here.");
  });

  it("keeps tool-narration text streamed in earlier rounds when the final round fails", async () => {
    // Round 1 streams "Checking your files" and requests a tool; round 2
    // fails with nothing streamed — the user still keeps what they watched.
    chatWithNvidiaGateway
      .mockImplementationOnce(async (owner, messages, options) => {
        options?.onChunk?.("Checking your files. ");
        return chatResult({
          text: "Checking your files. ",
          toolCalls: [
            {
              id: "call_1",
              name: "create_folder",
              arguments: JSON.stringify({ name: "Sprint" }),
            },
          ],
        });
      })
      .mockRejectedValue(
        new NvidiaGatewayClientError("dead", "invalid_response")
      );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "make a folder", { onChunk });
    expect(result.message.content).toContain("Checking your files");
    expect(result.message.content).toContain("lost the connection");
    expect(result.message.content).not.toContain("invalid response");
  });
});

describe("autoTitleChatForUser", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renames a default-titled chat from its first messages via NVIDIA NIM", async () => {
    completeWithNvidiaGateway.mockResolvedValueOnce({
      text: "Sprint planning",
    });
    await autoTitleChatForUser(1, 3);
    expect(renameChat).toHaveBeenCalledWith(
      1,
      3,
      "Sprint planning",
      expect.any(Array)
    );
  });

  it("leaves already-titled chats alone", async () => {
    chat.mockResolvedValueOnce({ id: 3, title: "Custom title" });
    await autoTitleChatForUser(1, 3);
    expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it("does nothing before the first assistant reply", async () => {
    chatMessages.mockResolvedValueOnce([
      { id: 1, role: "user", content: "Help me plan a sprint." },
    ]);
    await autoTitleChatForUser(1, 3);
    expect(completeWithNvidiaGateway).not.toHaveBeenCalled();
  });

  it("strips wrapping quotes and newlines from the model title", async () => {
    completeWithNvidiaGateway.mockResolvedValueOnce({
      text: '"Sprint\nplanning ideas"',
    });
    await autoTitleChatForUser(1, 3);
    expect(renameChat).toHaveBeenCalledWith(1, 3, "Sprint", expect.any(Array));
  });

  it("does not rename when the NVIDIA title is missing", async () => {
    completeWithNvidiaGateway.mockResolvedValueOnce({ text: "" });
    await autoTitleChatForUser(1, 3);
    expect(renameChat).not.toHaveBeenCalled();
  });
});

describe("connector tool gating", () => {
  it("drops connector tools when nothing is connected", () => {
    const tools = workspaceToolsForConnectors([]);
    expect(tools.find(tool => tool.function.name === "use_connector_tool")).toBeUndefined();
    expect(tools.find(tool => tool.function.name === "list_connector_tools")).toBeUndefined();
    expect(tools.find(tool => tool.function.name === "run_vm_task")).toBeDefined();
  });

  it("exposes connector tools restricted to the connected toolkit", () => {
    const tools = workspaceToolsForConnectors(["github"]);
    const listTool = tools.find(tool => tool.function.name === "list_connector_tools");
    expect(listTool).toBeDefined();
    const properties = (listTool!.function.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
    expect(properties.connector.enum).toEqual(["github"]);
    const useTool = tools.find(tool => tool.function.name === "use_connector_tool");
    expect((useTool!.function.parameters as { properties: Record<string, { enum?: string[] }> }).properties.connector.enum).toEqual(["github"]);
  });

  it("exposes both connector toolkits when both are connected", () => {
    const tools = workspaceToolsForConnectors(["github", "gmail"]);
    const listTool = tools.find(tool => tool.function.name === "list_connector_tools");
    expect((listTool!.function.parameters as { properties: Record<string, { enum?: string[] }> }).properties.connector.enum).toEqual(["github", "gmail"]);
  });

  it("status failures degrade to no connected toolkits", async () => {
    const failing = vi.fn(async () => { throw new Error("composio down"); });
    const connected = await getConnectedConnectorToolkits(1, failing as never);
    expect(connected).toEqual([]);
  });

  it("reports only connected toolkits", async () => {
    const check = async (_owner: number, toolkit: string) => ({ connected: toolkit === "gmail" });
    const connected = await getConnectedConnectorToolkits(1, check as never);
    expect(connected).toEqual(["gmail"]);
  });
});
