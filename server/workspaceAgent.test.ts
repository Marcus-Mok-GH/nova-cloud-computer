import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_UNAVAILABLE_PREFIX } from "@shared/const";
import { presentTelegramFile, sendTelegramMessage } from "./telegram";
import { ensurePersistentSandbox, getE2BClient, isE2BConfigured } from "./e2b";
import { persistE2BWorkspace, restoreWorkspaceToE2B } from "./workspaceSync";

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
  getDailyCreditStatusForUser: vi.fn(async () => ({
    region: "global",
    creditDay: "2026-09-24",
    dailyCredits: 500,
    usedCredits: 0,
    remainingCredits: 500,
    creditValueCents: 1,
  })),
  getActiveCustomModelForUser: vi.fn(async () => null),
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
  getUserIdentityForUser: async () => ({
    username: null,
    name: "Test User",
    email: "test@example.com",
  }),
  getCommunicationStyleForUser: vi.fn(async () => null),
  setCommunicationStyleForUser: vi.fn(async (_owner: number, style: string) =>
    style.trim().slice(0, 500)
  ),
  getPersonalisationForUser: vi.fn(async () => ({
    enabled: false,
    profile: null,
    tone: null,
    detail: null,
    proactiveness: null,
    expertise: null,
  })),
  setPersonalisationForUser: vi.fn(
    async (
      _owner: number,
      input: {
        enabled?: boolean;
        profile?: string | null;
        tone?: string | null;
        detail?: string | null;
        proactiveness?: string | null;
        expertise?: string | null;
      }
    ) => ({
      enabled: input.enabled ?? false,
      profile: input.profile ?? null,
      tone: input.tone ?? null,
      detail: input.detail ?? null,
      proactiveness: input.proactiveness ?? null,
      expertise: input.expertise ?? null,
    })
  ),
  PERSONALISATION_DETAILS: ["brief", "balanced", "detailed"],
  PERSONALISATION_PROACTIVENESS: ["ask_first", "act_and_tell", "autonomous"],
  PERSONALISATION_EXPERTISE: ["new", "some", "expert"],
  getDatabaseTime,
  hasAgentStopAfter,
  updateWorkspacePersistentSandbox: vi.fn(async () => true),
}));

const completeWithAiGateway = vi.fn();
// A plain reply no longer ends the run: when the loop sends its end-turn
// control nudge, this default mock impl answers the way a well-behaved
// model does - end_turn echoing the last assistant text - so existing
// flows finish in one extra round. Tests that mockReset() restore it.
const endTurnEchoOnNudge = (
  _owner: number,
  messages: Array<{ role: string; content: unknown }>
) => {
  const last = messages?.[messages.length - 1];
  if (
    last &&
    last.role === "user" &&
    typeof last.content === "string" &&
    last.content.startsWith(END_TURN_NUDGE_PREFIX)
  ) {
    const lastAssistant = [...messages]
      .reverse()
      .find(
        m =>
          m.role === "assistant" && typeof m.content === "string" && m.content
      );
    return chatResult({
      toolCalls: [
        {
          id: "call-end",
          name: "end_turn",
          arguments: JSON.stringify({ reply: lastAssistant?.content ?? "" }),
        },
      ],
    });
  }
  return undefined;
};
const chatWithAiGateway = vi.fn(endTurnEchoOnNudge);
const getAiGatewayStatus = vi.fn(() => ({
  configured: true,
  reachable: true,
  providerConfigured: true,
  providerConfigurationKnown: true,
  model: "chat-medium-latest",
  allowance: {
    usedRequests: 0,
    maxRequests: 50,
    remainingRequests: 50,
    exhausted: false,
  },
}));
class AiGatewayClientError extends Error {
  kind:
    | "configuration"
    | "unavailable"
    | "rate_limit"
    | "allowance_reached"
    | "invalid_response";
  constructor(message, kind) {
    super(message);
    this.name = "AiGatewayClientError";
    this.kind = kind;
  }
}
const configuredVisionChatModel = vi.fn(() => undefined);

vi.mock("./aiGateway", () => ({
  completeWithAiGateway,
  chatWithAiGateway,
  getAiGatewayStatus,
  configuredVisionChatModel,
  AiGatewayClientError,
}));

// startAgentVmRun (imported by workspaceAgent) pulls the E2B client; keep a
// lightweight mock so the real e2b SDK is never loaded in the test worker.
vi.mock("./e2b", () => ({
  getE2BClient: vi.fn(),
  isE2BConfigured: vi.fn(() => false),
  runE2BTaskInPersistentSandbox: vi.fn(),
  ensurePersistentSandbox: vi.fn(),
  getE2BSandboxStatus: vi.fn(),
  withE2BWorkspaceLock: vi.fn((_owner, _workspace, operation) => operation()),
  // Mirrors the real primitive: a sandbox with no pause method is left alone.
  pauseE2BSandbox: vi.fn(
    async (sandbox: { pause?: (options?: { keepMemory?: boolean }) => Promise<boolean> } | undefined) => {
      if (!sandbox?.pause) return false;
      const paused = await sandbox.pause({ keepMemory: true });
      return paused !== false;
    }
  ),
  E2B_WORKSPACE_DIR: "/home/user/workspace",
}));

// Memory tools and conversation auto-capture: mocked here so the agent's
// prompt build and run flow can be tested without the memory store; the
// store itself is covered by memories.test.ts.
const appendConversationTurn = vi.fn(async () => null);
const listRecentMemoriesForPrompt = vi.fn(async () => "none yet");
const searchMemoriesForUser = vi.fn(async () => []);
const readMemoryForUser = vi.fn(async () => null);
const saveMemoryForUser = vi.fn(async () => null);
const deleteMemoryForUser = vi.fn(async () => false);
vi.mock("./memories", () => ({
  appendConversationTurn,
  listRecentMemoriesForPrompt,
  searchMemoriesForUser,
  readMemoryForUser,
  saveMemoryForUser,
  deleteMemoryForUser,
}));

const deployWebsite = vi.fn(async () => ({
  ok: true,
  deployment: {
    id: 5,
    siteId: "site-1",
    siteName: "nova-live-site",
    siteUrl: "https://nova-live-site.netlify.app",
    deploymentKey: "d-01",
    description: "portfolio site",
    fileCount: 3,
    status: "live",
  },
}));
const deleteWebsite = vi.fn(async () => ({
  ok: true,
  deleted: [
    {
      key: "d-01",
      siteId: "site-1",
      siteUrl: "https://nova-live-site.netlify.app",
      description: "portfolio site",
    },
  ],
  failed: 0,
}));
vi.mock("./siteDeploy", () => ({
  deployWorkspaceSite: deployWebsite,
  deleteWorkspaceSite: deleteWebsite,
  describeDeploymentsForUser: vi.fn(
    async () =>
      "d-01 (live, https://nova-live-site.netlify.app) - portfolio site"
  ),
}));

const runCoderTaskMock = vi.hoisted(() => vi.fn());
const runAutonomousCoderTaskMock = vi.hoisted(() => vi.fn());
const { NimConfigError } = await import("./nim");
vi.mock("./coder", () => ({
  MIN_CALL_RESERVE_MS: 30_000,
  runCoderTask: runCoderTaskMock,
  runAutonomousCoderTask: runAutonomousCoderTaskMock,
}));

const runThinkerTaskMock = vi.hoisted(() => vi.fn());
vi.mock("./thinker", () => ({
  runThinkerTask: runThinkerTaskMock,
}));

const runBrowserCommandMock = vi.hoisted(() => vi.fn());
vi.mock("./agentBrowser", () => ({
  runBrowserCommand: runBrowserCommandMock,
  warmBrowserInBackground: vi.fn(async () => undefined),
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
  END_TURN_NUDGE_PREFIX,
  FAILURE_NUDGE_PREFIX,
  autoTitleChatForUser,
  setGatewayRetryDelaysForTests,
  setGatewayRateLimitRetryDelayForTests,
  TOOL_ACTIVITY_MESSAGE_PREFIX,
  SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX,
  workspaceToolsForConnectors,
  getConnectedConnectorToolkits,
  CODER_NUDGE_PREFIX,
  isCodeFileName,
  isSubstantialCode,
} = await import("./workspaceAgent");

// A well-formed end_turn tool call carrying the final reply.
const endTurnCall = (reply: string) => ({
  id: "call-end",
  name: "end_turn",
  arguments: JSON.stringify({ reply }),
});

// The run mutates its messages array in place across rounds (draft + nudge
// + end_turn rows keep landing after the first call), so tool-result
// assertions look the row up instead of relying on its position.
const lastToolResult = (
  messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>
) => [...messages].reverse().find(m => m.role === "tool");

const chatResult = (
  overrides: Partial<{
    text: string;
    toolCalls: Array<{ id: string; name: string; arguments: string }>;
  }> = {}
) => ({
  text: overrides.text ?? "",
  toolCalls: overrides.toolCalls ?? [],
  model: "chat-medium-latest",
  usage: null,
  allowance: {
    usedRequests: 1,
    maxRequests: 50,
    remainingRequests: 49,
    exhausted: false,
  },
});

// Queues the well-behaved end_turn echo a text-only reply round needs to
// finish the run (tests near the file end override the gateway's base
// implementation, so the default echo-on-nudge cannot be relied on).
const endTurnReply = ({ reply }: { reply: string }) =>
  chatResult({
    toolCalls: [
      {
        id: "call-end",
        name: "end_turn",
        arguments: JSON.stringify({ reply }),
      },
    ],
  });

// A fake live sandbox: records writes and commands, echoes back results.
const fakeSandbox = () => {
  const writes: Array<{ path: string; content: string }> = [];
  return {
    sandboxId: "sbx-vm",
    writes,
    pause: vi.fn(async () => true),
    files: {
      write: vi.fn(async (path: string, data: unknown) =>
        writes.push({ path, content: String(data) })
      ),
      read: vi.fn(async () => new Uint8Array()),
      list: vi.fn(async () => []),
    },
    commands: {
      run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    },
  };
};

describe("Nova tool-calling workspace agent", () => {
  beforeEach(() => {
    setGatewayRetryDelaysForTests([0, 0]);
    setGatewayRateLimitRetryDelayForTests(0);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setGatewayRateLimitRetryDelayForTests(null);
    // Streaming runs now poll the stop flag mid-response: keep the default.
    hasAgentStopAfter.mockImplementation(async () => false);
    // clearAllMocks keeps mock *implementations*, so a sandbox test that
    // turned E2B on would leak it into every later test: restore the default.
    vi.mocked(isE2BConfigured).mockReturnValue(false);
  });

  it("runs every message through the model with workspace tools exposed", async () => {
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "Sure - what should it contain?" })
    );
    await runWorkspaceAgent(1, 3, "hi");
    // A plain reply no longer ends the run: the answer is followed by the
    // end-turn nudge, which the model answers with end_turn.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(2);
    const [owner, messages, options] = chatWithAiGateway.mock.calls[0];
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
    // The workspace file listing is no longer inlined: recent memories took
    // its place, files are reachable through list_workspace instead.
    expect(messages[0].content).toContain("Recent memories");
    expect(messages[0].content).not.toContain("welcome.md");
    expect(messages).toEqual(
      expect.arrayContaining([{ role: "user", content: "hi" }])
    );
    expect(computer).toHaveBeenCalled();
  });

  it("frames the agent as a capable operator with tool routing", async () => {
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "Sure - what should it contain?" })
    );
    await runWorkspaceAgent(1, 3, "hi");
    const [, messages, options] = chatWithAiGateway.mock.calls[0];
    const system = messages[0].content;
    // Capable-operator framing: finish the goal, use tools when they help.
    expect(system).toContain("get the user's work done end-to-end");
    expect(system).toContain("capable operator");
    expect(system).toContain("Finish the goal");
    expect(system).toContain("Bias to action");
    expect(system).toContain("Work in tight loops");
    // A high quality bar is set explicitly, not just tool routing.
    expect(system).toContain("the user's problem actually being solved");
    expect(system).toContain("never settle for a partial, generic or hedged result");
    // Self-limiting framing is gone.
    expect(system).not.toContain("thin reasoner");
    expect(system).not.toContain("traffic cop");
    expect(system).not.toContain("hybrid supervisor");
    // Overlapping principles are consolidated into the ones above.
    expect(system).not.toContain("Choose your collaboration level");
    expect(system).not.toContain("Chain tools freely.");
    // Keep routing rules that prevent confidently wrong answers.
    expect(system).toContain("Never do math or data work in your head");
    expect(system).toContain("Your memory is tool-backed, not file-backed");
    expect(system).toContain("search_memories");
    // Memories replace the inline workspace file listing.
    expect(system).toContain("Recent memories");
    expect(system).not.toContain("Current files");
    // Explicit triggers on the tool descriptions.
    const tool = (name: string) =>
      options.tools.find(
        (t: { function: { name: string } }) => t.function.name === name
      ).function;
    expect(tool("solve_equation").description).toContain(
      "whenever the user asks to calculate"
    );
    expect(tool("run_vm_task").description).toContain(
      "whenever real computation is needed"
    );
    expect(tool("editor").description).toContain(
      "default for ALL substantial file work"
    );
  });

  it("gives the model the prior conversation instead of starting fresh every turn", async () => {
    // Chat history has an earlier exchange plus a tool-activity row (raw
    // JSON bookkeeping) that must never reach the model as a real turn.
    chatMessages.mockResolvedValueOnce([
      { id: 1, role: "user", content: "Add a game history feature." },
      {
        id: 2,
        role: "assistant",
        content: `${TOOL_ACTIVITY_MESSAGE_PREFIX}{"name":"create_file"}`,
      },
      {
        id: 3,
        role: "assistant",
        content: "Added a local high-score history to the game.",
      },
      { id: 4, role: "user", content: "Are you done?" },
    ]);
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "Yep, all set!" })
    );
    await runWorkspaceAgent(1, 3, "Are you done?");
    const messages = chatWithAiGateway.mock.calls[0][1];
    // The messages array is mutated in place across rounds (draft + end-turn
    // nudge rows land after the first call), so the prior conversation is
    // asserted as the leading rows, in order, without the tool-activity row.
    expect(messages.slice(1, 4)).toEqual([
      { role: "user", content: "Add a game history feature." },
      {
        role: "assistant",
        content: "Added a local high-score history to the game.",
      },
      { role: "user", content: "Are you done?" },
    ]);
  });

  it("creates a file when the model calls create_file, then finishes with a reply", async () => {
    chatWithAiGateway
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
    // The tool loop fed the tool result back to the model (the messages
    // array is mutated in place across rounds, so assert membership).
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
          content: "Created notes.txt (id 2).",
        }),
      ])
    );
    // Tool activity is emitted and persisted, then the final reply.
    expect(onEvent).toHaveBeenCalled();
    const persistedToolActivity = append.mock.calls
      .map(callArgs => callArgs[1])
      .find(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    expect(persistedToolActivity.content).toContain("create_file");
    expect(onChunk).toHaveBeenCalledWith("Created notes.txt for you.");
    expect(result.message.content).toBe("Created notes.txt for you.");
  });

  it("solves an equation when the model calls solve_equation, then finishes with a reply", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-math",
              name: "solve_equation",
              arguments: JSON.stringify({ equation: "20 - (5*2 + 2*(2/3))" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "You get $8.67 back." }));
    const onChunk = vi.fn();
    const onEvent = vi.fn();
    const result = await runWorkspaceAgent(
      1,
      3,
      "I have $20, how much change after 17 apples at 3 for $2?",
      {
        onChunk,
        onEvent,
      }
    );
    // The tool loop fed the exact solved answer back to the model.
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-math",
          content: "20 - (5*2 + 2*(2/3)) = 8.666667",
        }),
      ])
    );
    expect(result.actions).toEqual([
      { kind: "tool", name: "20 - (5*2 + 2*(2/3))", operation: "completed" },
    ]);
    expect(onChunk).toHaveBeenCalledWith("You get $8.67 back.");
    expect(result.message.content).toBe("You get $8.67 back.");
  });

  it("delegates a file task to the NIM editor sub-agent, then places the returned code", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockResolvedValueOnce({
      code: "def add(a, b):\n    return a + b",
      model: "moonshotai/kimi-k3",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-code",
              name: "editor",
              arguments: JSON.stringify({
                task: "write an add function",
                language: "Python",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Added calc.py with an add function." })
      );
    const result = await runWorkspaceAgent(1, 3, "write me an add function");
    // The specialist got the task and language exactly as the model sent them.
    expect(runCoderTaskMock).toHaveBeenCalledWith(
      "write an add function",
      undefined,
      "Python",
      // The editor's own deadline is handed to the single-shot call too.
      expect.any(Number)
    );
    // Its code was fed back to the model as the tool result.
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-code",
          content: "def add(a, b):\n    return a + b",
        }),
      ])
    );
    expect(result.actions).toEqual([
      {
        kind: "tool",
        name: "editor: write an add function",
        operation: "completed",
      },
    ]);
    expect(result.message.content).toBe("Added calc.py with an add function.");
  });

  it("reports an unconfigured editor sub-agent back to the model instead of breaking the run", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockRejectedValueOnce(
      new NimConfigError(
        "The coding specialist is not configured on this workspace - the workspace owner must finish setting it up."
      )
    );
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-code-nc",
              name: "editor",
              arguments: JSON.stringify({ task: "build a todo app" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "The coding specialist is not configured yet - the workspace owner must finish setting it up.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "build me a todo app");
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    const toolRow = [...secondCallMessages]
      .reverse()
      .find(m => m.role === "tool");
    expect(toolRow.tool_call_id).toBe("call-code-nc");
    expect(toolRow.content).toContain(
      "The coding specialist is not configured on this workspace"
    );
    // The failure now carries the no-silent-substitution policy.
    expect(toolRow.content).toContain(
      "do NOT silently write the code yourself"
    );
    expect(runCoderTaskMock).toHaveBeenCalledTimes(1); // config errors are deterministic: no retry
    expect(result.actions).toEqual([
      { kind: "tool", name: "editor: build a todo app", operation: "failed" },
    ]);
  });

  it("retries a transient specialist failure once instead of giving up", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock
      .mockRejectedValueOnce(new Error("NVIDIA NIM responded with status 503."))
      .mockResolvedValueOnce({
        code: "// specialist version",
        model: "moonshotai/kimi-k3",
      });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-code-r",
              name: "editor",
              arguments: JSON.stringify({ task: "build a todo app" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Here is your todo app." }));
    const result = await runWorkspaceAgent(1, 3, "build me a todo app");
    expect(runCoderTaskMock).toHaveBeenCalledTimes(2);
    expect(result.actions).toEqual([
      {
        kind: "tool",
        name: "editor: build a todo app",
        operation: "completed",
      },
    ]);
  });

  it("skips the automatic specialist retry when the budget cannot cover it", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockRejectedValue(
      new Error("NVIDIA NIM responded with status 503.")
    );
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-code-budget",
              name: "editor",
              arguments: JSON.stringify({ task: "build a todo app" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "The specialist is down; nothing was written." })
      );
    // 30s left cannot fit the 1.5s wait plus the reserve the specialist needs
    // just to start, so the retry is skipped instead of beginning work the run
    // deadline would discard.
    const result = await runWorkspaceAgent(1, 3, "build me a todo app", {
      deadlineAtMs: Date.now() + 30_000,
    });
    expect(runCoderTaskMock).toHaveBeenCalledTimes(1);
    expect(result.actions).toEqual([
      { kind: "tool", name: "editor: build a todo app", operation: "failed" },
    ]);
  });

  it("reports the specialist as down after a persistent failure and stops nudging toward the editor", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockRejectedValue(
      new Error("NVIDIA NIM responded with status 500.")
    );
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-code-d1",
              name: "editor",
              arguments: JSON.stringify({ task: "build a website" }),
            },
          ],
        })
      )
      // Same-run self-coding attempt: mechanically blocked - the user has
      // not had a turn to answer the acceptance question yet.
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-code-d2",
              name: "create_file",
              arguments: JSON.stringify({
                name: "index.html",
                content: twentyLineScript,
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "The coding specialist is down - this is my own attempt at your website.",
        })
      );
    await runWorkspaceAgent(1, 3, "build me a website");
    expect(runCoderTaskMock).toHaveBeenCalledTimes(2); // initial call + one retry
    const toolRow = chatWithAiGateway.mock.calls
      .flatMap(
        call =>
          call[1] as Array<{
            role: string;
            tool_call_id?: string;
            content?: string;
          }>
      )
      .find(m => m.role === "tool" && m.tool_call_id === "call-code-d1");
    expect(toolRow?.content).toContain(
      "do NOT silently write the code yourself"
    );
    // The same-run self-write is mechanically blocked: the file is never
    // created and the tool result carries the acceptance question policy.
    const blockedRow = chatWithAiGateway.mock.calls
      .flatMap(
        call =>
          call[1] as Array<{
            role: string;
            tool_call_id?: string;
            content?: string;
          }>
      )
      .find(m => m.role === "tool" && m.tool_call_id === "call-code-d2");
    expect(blockedRow?.content).toContain(
      "the user has not accepted Nova's own coding yet"
    );
    expect(createFile).not.toHaveBeenCalledWith(
      1,
      expect.objectContaining({ name: "index.html" })
    );
    // No coder nudge once the specialist is down.
    expect(coderNudgeMessages()).toHaveLength(0);
    // The run ends with the chat marked pending acceptance.
    expect(append).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        content: `${SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX}pending`,
      })
    );
  });

  it("blocks a pending-acceptance run until accept_own_coding records the user's consent", async () => {
    runCoderTaskMock.mockReset();
    // Both history reads (prior-turn load and the acceptance scan) must
    // see the marker so the run starts gated.
    const pendingHistory = [
      { id: 1, role: "user", content: "Build me a website." },
      {
        id: 2,
        role: "assistant",
        content: "The coding specialist is down - shall I try it myself?",
      },
      {
        id: 3,
        role: "assistant",
        content: `${SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX}pending`,
      },
      { id: 4, role: "user", content: "Yes, go ahead yourself." },
    ];
    chatMessages
      .mockResolvedValueOnce(pendingHistory)
      .mockResolvedValueOnce(pendingHistory);
    chatWithAiGateway
      // The model first tries to self-code without recording acceptance:
      // the gate blocks the substantial write.
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-gate-1",
              name: "create_file",
              arguments: JSON.stringify({
                name: "index.html",
                content: twentyLineScript,
              }),
            },
          ],
        })
      )
      // Proper flow: record the user's explicit consent, then self-code.
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-gate-2", name: "accept_own_coding", arguments: "{}" },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-gate-3",
              name: "create_file",
              arguments: JSON.stringify({
                name: "index.html",
                content: twentyLineScript,
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Done - this is my own version." })
      );
    await runWorkspaceAgent(1, 3, "Yes, go ahead yourself.");
    // Pre-acceptance write: blocked, with the acceptance policy in the result.
    const blockedRow = chatWithAiGateway.mock.calls
      .flatMap(
        call =>
          call[1] as Array<{
            role: string;
            tool_call_id?: string;
            content?: string;
          }>
      )
      .find(m => m.role === "tool" && m.tool_call_id === "call-gate-1");
    expect(blockedRow?.content).toContain(
      "the user has not accepted Nova's own coding yet"
    );
    // The accept tool records the consent durably.
    expect(append).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        content: `${SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX}accepted`,
      })
    );
    // The post-acceptance write now succeeds.
    const acceptedRow = chatWithAiGateway.mock.calls
      .flatMap(
        call =>
          call[1] as Array<{
            role: string;
            tool_call_id?: string;
            content?: string;
          }>
      )
      .find(m => m.role === "tool" && m.tool_call_id === "call-gate-3");
    expect(acceptedRow?.content).toContain("Created index.html");
    // The marker rows never reach the model's history.
    const historySeesMarker = chatWithAiGateway.mock.calls.some(call =>
      (call[1] as Array<{ content?: unknown }>).some(
        m =>
          typeof m.content === "string" &&
          m.content.startsWith(SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX)
      )
    );
    expect(historySeesMarker).toBe(false);
  });

  it("refuses accept_own_coding in the same run as the specialist failure", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockRejectedValue(
      new Error("NVIDIA NIM responded with status 500.")
    );
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-acc-1",
              name: "editor",
              arguments: JSON.stringify({ task: "build a website" }),
            },
          ],
        })
      )
      // The model tries to "accept" on the user's behalf in the same run.
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-acc-2", name: "accept_own_coding", arguments: "{}" },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "The coding specialist is down - shall I try it myself?",
        })
      );
    await runWorkspaceAgent(1, 3, "build me a website");
    const acceptRow = chatWithAiGateway.mock.calls
      .flatMap(
        call =>
          call[1] as Array<{
            role: string;
            tool_call_id?: string;
            content?: string;
          }>
      )
      .find(m => m.role === "tool" && m.tool_call_id === "call-acc-2");
    expect(acceptRow?.content).toContain("failed in this same run");
    expect(append).not.toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        content: `${SPECIALIST_ACCEPTANCE_MESSAGE_PREFIX}accepted`,
      })
    );
  });

  it("treats a missing model-ID config error as non-retryable", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockRejectedValue(
      new NimConfigError(
        "A model ID is required when this workspace uses a custom model endpoint - ask the workspace owner to set one."
      )
    );
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-cfg-1",
              name: "editor",
              arguments: JSON.stringify({ task: "build a website" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "The specialist needs a model configured." })
      );
    await runWorkspaceAgent(1, 3, "build me a website");
    // Config failures are classified by type, not message text: no retry.
    expect(runCoderTaskMock).toHaveBeenCalledTimes(1);
    const toolRow = chatWithAiGateway.mock.calls
      .flatMap(
        call =>
          call[1] as Array<{
            role: string;
            tool_call_id?: string;
            content?: string;
          }>
      )
      .find(m => m.role === "tool" && m.tool_call_id === "call-cfg-1");
    expect(toolRow?.content).toContain("A model ID is required");
  });

  // Coder-delegation guard: the agent loop itself keeps the coding
  // specialist in play - one nudge per run when the model writes
  // substantial code itself without ever calling the editor.
  // The run mutates its messages array in place across rounds, so the same
  // nudge row shows up in every later gateway call - dedupe by content.
  const coderNudgeMessages = () => {
    const seen = new Map<string, string>();
    for (const call of chatWithAiGateway.mock.calls) {
      for (const m of call[1] as Array<{ role: string; content?: unknown }>) {
        if (
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.startsWith(CODER_NUDGE_PREFIX)
        )
          seen.set(m.content, m.content);
      }
    }
    return [...seen.values()].map(content => ({ role: "user", content }));
  };
  const twentyLineScript = [
    "// app",
    ...Array.from({ length: 20 }, (_, i) => `console.log(${i});`),
  ].join("\n");

  it("nudges the model toward the editor when it writes substantial code itself", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockResolvedValueOnce({
      code: "// specialist version",
      model: "moonshotai/kimi-k3",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_file",
              arguments: JSON.stringify({
                name: "app.js",
                content: twentyLineScript,
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-2",
              name: "editor",
              arguments: JSON.stringify({ task: "write app.js properly" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            endTurnCall("Rewrote app.js with the coding specialist."),
          ],
        })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a script");
    // Exactly one coder nudge, naming the file, before the delegation round.
    const nudges = coderNudgeMessages();
    expect(nudges).toHaveLength(1);
    expect(nudges[0].content).toContain("app.js");
    // The model delegated after the nudge, and the specialist got the task.
    expect(runCoderTaskMock).toHaveBeenCalledWith(
      "write app.js properly",
      undefined,
      undefined,
      expect.any(Number)
    );
    expect(result.message.content).toBe(
      "Rewrote app.js with the coding specialist."
    );
  });

  it("does not nudge for non-code files the agent writes itself", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-note",
              name: "create_file",
              arguments: JSON.stringify({
                name: "notes.txt",
                content: twentyLineScript,
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Wrote your notes." }));
    const result = await runWorkspaceAgent(1, 3, "take notes");
    expect(coderNudgeMessages()).toHaveLength(0);
    expect(result.message.content).toBe("Wrote your notes.");
  });

  it("does not nudge for trivial code the agent writes itself", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-tiny",
              name: "create_file",
              arguments: JSON.stringify({
                name: "tiny.js",
                content: "console.log(1);",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Added a one-liner." }));
    const result = await runWorkspaceAgent(1, 3, "log the number one");
    expect(coderNudgeMessages()).toHaveLength(0);
    expect(result.message.content).toBe("Added a one-liner.");
  });

  it("does not nudge again once the specialist has been used this run", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockResolvedValueOnce({
      code: "// specialist version",
      model: "moonshotai/kimi-k3",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-code",
              name: "editor",
              arguments: JSON.stringify({ task: "write app.js" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_file",
              arguments: JSON.stringify({
                name: "app.js",
                content: twentyLineScript,
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [endTurnCall("Placed the specialist's app.js.")],
        })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a script");
    expect(coderNudgeMessages()).toHaveLength(0);
    expect(result.message.content).toBe("Placed the specialist's app.js.");
  });

  it("cancels a pending nudge when the same round also calls the editor", async () => {
    runCoderTaskMock.mockReset();
    runCoderTaskMock.mockResolvedValueOnce({
      code: "// specialist version",
      model: "moonshotai/kimi-k3",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_file",
              arguments: JSON.stringify({
                name: "app.js",
                content: twentyLineScript,
              }),
            },
            {
              id: "call-2",
              name: "editor",
              arguments: JSON.stringify({ task: "review app.js" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [endTurnCall("Written and reviewed with the specialist.")],
        })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a script");
    expect(coderNudgeMessages()).toHaveLength(0);
    expect(runCoderTaskMock).toHaveBeenCalledWith(
      "review app.js",
      undefined,
      undefined,
      expect.any(Number)
    );
    expect(result.message.content).toBe(
      "Written and reviewed with the specialist."
    );
  });

  it("classifies code files and substantial code sizes correctly", () => {
    expect(isCodeFileName("app.js")).toBe(true);
    expect(isCodeFileName("Component.TSX")).toBe(true);
    expect(isCodeFileName("index.html")).toBe(true);
    expect(isCodeFileName("style.css")).toBe(true);
    expect(isCodeFileName("notes.txt")).toBe(false);
    expect(isCodeFileName("readme.md")).toBe(false);
    expect(isCodeFileName("data.json")).toBe(false);
    expect(isCodeFileName("no-extension")).toBe(false);
    expect(isSubstantialCode("one line")).toBe(false);
    expect(
      isSubstantialCode(
        Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n")
      )
    ).toBe(false);
    expect(
      isSubstantialCode(
        Array.from({ length: 16 }, (_, i) => `line ${i}`).join("\n")
      )
    ).toBe(true);
    expect(isSubstantialCode("x".repeat(801))).toBe(true);
  });

  it("reports a failed solve_equation call back to the model instead of breaking the run", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-math-bad",
              name: "solve_equation",
              arguments: JSON.stringify({ equation: "2 +* 3" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Sorry, that one was not solvable." })
      );
    const result = await runWorkspaceAgent(1, 3, "solve garbage");
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    const toolRow = [...secondCallMessages]
      .reverse()
      .find(m => m.role === "tool");
    expect(toolRow).toMatchObject({
      role: "tool",
      tool_call_id: "call-math-bad",
    });
    expect(toolRow.content).toContain("Could not evaluate '2 +* 3'");
    expect(result.actions).toEqual([
      { kind: "tool", name: "2 +* 3", operation: "failed" },
    ]);
    expect(result.message.content).toBe("Sorry, that one was not solvable.");
  });

  describe("sandbox-first workspace", () => {
    const enableSandbox = (sandbox: ReturnType<typeof fakeSandbox>) => {
      vi.mocked(isE2BConfigured).mockReturnValue(true);
      vi.mocked(getE2BClient).mockReturnValue({} as never);
      vi.mocked(ensurePersistentSandbox).mockResolvedValue(sandbox as never);
    };

    beforeEach(() => {
      vi.mocked(ensurePersistentSandbox).mockReset();
      vi.mocked(restoreWorkspaceToE2B).mockReset();
      vi.mocked(restoreWorkspaceToE2B).mockResolvedValue(1);
      vi.mocked(persistE2BWorkspace).mockReset();
      vi.mocked(persistE2BWorkspace).mockResolvedValue(0);
    });

    it("runs the editor autonomously when the sandbox is awake, syncing writes back into the workspace", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      runAutonomousCoderTaskMock
        .mockReset()
        .mockImplementationOnce(
          async (options: {
            onToolActivity?: (activity: {
              id: string;
              name: string;
              state: string;
              args: Record<string, string>;
            }) => Promise<void> | void;
          }) => {
            await options.onToolActivity?.({
              id: "c2",
              name: "write_file",
              state: "running",
              args: { path: "index.html" },
            });
            await options.onToolActivity?.({
              id: "c2",
              name: "write_file",
              state: "completed",
              args: { path: "index.html" },
              summary: "Wrote index.html.",
            });
            return {
              kind: "autonomous",
              summary: "Built and verified the game.",
              writtenPaths: ["index.html"],
              commandsRun: 2,
              rounds: 3,
              model: "moonshotai/kimi-k3",
            };
          }
        );
      runCoderTaskMock.mockReset();
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-code",
                name: "editor",
                arguments: JSON.stringify({ task: "build a game" }),
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          chatResult({ text: "Done - the game is in your workspace." })
        );
      const result = await runWorkspaceAgent(1, 3, "build me a game");
      // The specialist ran autonomously with the live sandbox, not single-shot.
      expect(runAutonomousCoderTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          task: "build a game",
          sandbox: sandbox as never,
          onToolActivity: expect.any(Function),
        })
      );
      expect(runCoderTaskMock).not.toHaveBeenCalled();
      // Its sandbox writes were synced back into the durable store inside
      // the tool call, before the model saw the result.
      expect(persistE2BWorkspace).toHaveBeenCalledWith(1, sandbox);
      // The model heard the summary and the changed-file list, and was told
      // to verify the work.
      const toolResult = lastToolResult(
        chatWithAiGateway.mock.calls[1][1]
      )!;
      expect(toolResult.tool_call_id).toBe("call-code");
      expect(toolResult.content).toContain("worked autonomously");
      expect(toolResult.content).toContain("Built and verified the game.");
      expect(toolResult.content).toContain("index.html");
      expect(toolResult.content).toContain("verify the work");
      expect(result.message.content).toBe(
        "Done - the game is in your workspace."
      );
    });

    it("streams the specialist's own tool calls as activity rows namespaced under the editor call", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      runAutonomousCoderTaskMock
        .mockReset()
        .mockImplementationOnce(
          async (options: {
            onToolActivity?: (activity: {
              id: string;
              name: string;
              state: string;
              args: Record<string, string>;
              summary?: string;
            }) => Promise<void> | void;
          }) => {
            await options.onToolActivity?.({
              id: "c1",
              name: "read_file",
              state: "running",
              args: { path: "index.html" },
            });
            await options.onToolActivity?.({
              id: "c1",
              name: "read_file",
              state: "completed",
              args: { path: "index.html" },
              summary: "Read index.html.",
            });
            return {
              kind: "autonomous",
              summary: "Done.",
              writtenPaths: [],
              commandsRun: 0,
              rounds: 1,
              model: "moonshotai/kimi-k3",
            };
          }
        );
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-code",
                name: "editor",
                arguments: JSON.stringify({ task: "inspect the page" }),
              },
            ],
          })
        )
        .mockResolvedValueOnce(chatResult({ text: "Inspected." }));
      const onEvent = vi.fn();
      await runWorkspaceAgent(1, 3, "look at the page", { onEvent });
      // Both specialist states streamed live, namespaced under the editor
      // call's id and repacked into the { arguments: json } args shape the
      // client's tool labels parse.
      const streamed = onEvent.mock.calls
        .map(callArgs => callArgs[0])
        .filter(
          event =>
            event?.type === "tool" &&
            String(event.tool?.id).startsWith("call-code:")
        );
      expect(streamed.map(e => `${e.tool.id}:${e.tool.state}`)).toEqual([
        "call-code:c1:running",
        "call-code:c1:completed",
      ]);
      expect(JSON.parse(streamed[1].tool.args.arguments)).toEqual({
        path: "index.html",
      });
      // And both rows were persisted to the ledger, latest state last.
      const persistedRows = append.mock.calls
        .map(callArgs => callArgs[1] as { content: string })
        .filter(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX))
        .map(input =>
          JSON.parse(input.content.slice(TOOL_ACTIVITY_MESSAGE_PREFIX.length))
        )
        .filter(
          (activity: { id?: string }) =>
            typeof activity.id === "string" &&
            activity.id.startsWith("call-code:")
        );
      expect(
        persistedRows.map(
          (row: { id: string; state: string }) => `${row.id}:${row.state}`
        )
      ).toEqual(["call-code:c1:running", "call-code:c1:completed"]);
    });

    it("wakes the sandbox at run start, restores the workspace into it, and syncs back at run end", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(chatResult({ text: "All set." }));
      await runWorkspaceAgent(1, 3, "hi");
      expect(ensurePersistentSandbox).toHaveBeenCalledWith(
        expect.anything(),
        41,
        1,
        "sbx-vm"
      );
      expect(restoreWorkspaceToE2B).toHaveBeenCalledWith(1, sandbox);
      expect(persistE2BWorkspace).toHaveBeenCalledWith(1, sandbox);
    });

    it("mirrors create_file onto the sandbox filesystem", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      createFile.mockReset();
      createFile.mockResolvedValue({
        id: 2,
        name: "notes.txt",
        content: "hello world",
      });
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-sbx",
                name: "create_file",
                arguments: JSON.stringify({
                  name: "notes.txt",
                  content: "hello world",
                }),
              },
            ],
          })
        );
      const result = await runWorkspaceAgent(1, 3, "create notes.txt");
      expect(result.actions).toEqual([
        { kind: "file", name: "notes.txt", operation: "created" },
      ]);
      expect(sandbox.files.write).toHaveBeenCalledWith(
        "/home/user/workspace/notes.txt",
        expect.any(Buffer)
      );
    });

    it("runs a bash command on the sandbox via run_bash and feeds stdout back to the model", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      sandbox.commands.run.mockResolvedValue({
        exitCode: 0,
        stdout: "welcome.md",
        stderr: "",
      });
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-bash",
                name: "run_bash",
                arguments: JSON.stringify({ command: "ls" }),
              },
            ],
          })
        );
      const result = await runWorkspaceAgent(1, 3, "list my files with bash");
      expect(sandbox.commands.run).toHaveBeenCalledWith(
        "ls",
        expect.objectContaining({ cwd: "/home/user/workspace" })
      );
      expect(result.actions).toEqual([
        { kind: "vm", name: "bash", operation: "completed" },
      ]);
      const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
      expect(secondCallMessages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            tool_call_id: "call-bash",
            content: expect.stringContaining("Exit code 0."),
          }),
        ])
      );
      const fedBack = secondCallMessages.find(
        (m: { role: string; tool_call_id?: string }) =>
          m.role === "tool" && m.tool_call_id === "call-bash"
      );
      expect(fedBack.content).toContain("stdout:\nwelcome.md");
    });

    it("drives the sandbox browser via browse and feeds the output back to the model", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      runBrowserCommandMock.mockReset();
      runBrowserCommandMock.mockResolvedValue({
        ok: true,
        result: "Exit code 0.\n\nstdout:\npage loaded",
      });
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-browse",
                name: "browse",
                arguments: JSON.stringify({
                  command: "open https://example.com",
                }),
              },
            ],
          })
        );
      const result = await runWorkspaceAgent(
        1,
        3,
        "open example.com in a browser"
      );
      expect(runBrowserCommandMock).toHaveBeenCalledWith(
        sandbox,
        "open https://example.com"
      );
      expect(result.actions).toEqual([
        { kind: "browser", name: "open", operation: "completed" },
      ]);
      const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
      const fedBack = secondCallMessages.find(
        (m: { role: string; tool_call_id?: string }) =>
          m.role === "tool" && m.tool_call_id === "call-browse"
      );
      expect(fedBack.content).toContain("page loaded");
    });

    it("browse without a live sandbox reports the fallback to the model", async () => {
      vi.mocked(isE2BConfigured).mockReturnValue(false);
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-browse-off",
                name: "browse",
                arguments: JSON.stringify({ command: "snapshot" }),
              },
            ],
          })
        );
      const result = await runWorkspaceAgent(1, 3, "browse example.com");
      expect(result.actions).toEqual([
        { kind: "browser", name: "browser", operation: "disabled" },
      ]);
      const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
      const fedBack = secondCallMessages.find(
        (m: { role: string; tool_call_id?: string }) =>
          m.role === "tool" && m.tool_call_id === "call-browse-off"
      );
      expect(fedBack.content).toContain("sandbox is not available");
      expect(fedBack.content).toContain("not set up on this workspace");
    });

    it("run_bash without a live sandbox reports the fallback to the model", async () => {
      vi.mocked(isE2BConfigured).mockReturnValue(false);
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-bash-off",
                name: "run_bash",
                arguments: JSON.stringify({ command: "ls" }),
              },
            ],
          })
        );
      const result = await runWorkspaceAgent(1, 3, "list my files with bash");
      expect(result.actions).toEqual([
        { kind: "vm", name: "bash", operation: "disabled" },
      ]);
      const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
      const fedBack = secondCallMessages.find(
        (m: { role: string; tool_call_id?: string }) =>
          m.role === "tool" && m.tool_call_id === "call-bash-off"
      );
      expect(fedBack.content).toContain("sandbox is not available");
      expect(fedBack.content).toContain("run_vm_task");
    });

    it("does not wake the sandbox when E2B is not configured", async () => {
      vi.mocked(isE2BConfigured).mockReturnValue(false);
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(chatResult({ text: "Hi." }));
      await runWorkspaceAgent(1, 3, "hi");
      expect(ensurePersistentSandbox).not.toHaveBeenCalled();
      expect(restoreWorkspaceToE2B).not.toHaveBeenCalled();
      expect(persistE2BWorkspace).not.toHaveBeenCalled();
    });

    it("pauses the persistent sandbox when the run finishes", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(chatResult({ text: "All done." }));
      await runWorkspaceAgent(1, 3, "finish this up");
      expect(sandbox.pause).toHaveBeenCalledWith({ keepMemory: true });
    });

    it("keeps the sandbox warm when the run chains into an automatic continuation", async () => {
      const sandbox = fakeSandbox();
      enableSandbox(sandbox);
      chatWithAiGateway
        .mockReset()
        .mockImplementation(endTurnEchoOnNudge)
        .mockResolvedValueOnce(chatResult({ text: "Continuing." }));
      await runWorkspaceAgent(1, 3, "keep going", {
        continuationPlanned: true,
      });
      // The next segment resumes within seconds: pausing would add a cold
      // resume to every continuation, so the machine is left running.
      expect(sandbox.pause).not.toHaveBeenCalled();
    });
  });

  it("deletes the live website when the model calls delete_website", async () => {
    deleteWebsite.mockClear();
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "delete_website",
              arguments: JSON.stringify({}),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "Your site is offline - https://nova-live-site.netlify.app deleted.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "take my site down");
    expect(deleteWebsite).toHaveBeenCalledWith(1, {
      deployment: undefined,
      all: false,
      confirmAll: undefined,
    });
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "https://nova-live-site.netlify.app",
        operation: "deleted",
      },
    ]);
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
          content: expect.stringContaining(
            "https://nova-live-site.netlify.app"
          ),
        }),
      ])
    );
  });

  it("gates an all-sites sweep: the first call lists targets and deletes nothing", async () => {
    deleteWebsite.mockClear();
    deleteWebsite.mockResolvedValueOnce({
      ok: false,
      confirmationRequired: true,
      targets: [
        {
          key: "d-01",
          siteId: "site-1",
          siteUrl: "https://nova-live-site.netlify.app",
          description: "portfolio site",
        },
        {
          key: "d-02",
          siteId: "site-0",
          siteUrl: "https://nova-old-site.netlify.app",
          description: "bakery landing page",
        },
      ],
      message:
        "The complete target list is: d-01 (https://nova-live-site.netlify.app - portfolio site); d-02 (https://nova-old-site.netlify.app - bakery landing page). Re-call with all: true and confirm_all set to exactly these deployment IDs - and only after the user has explicitly confirmed deleting every one of them.",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "delete_website",
              arguments: JSON.stringify({ all: true }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "You have two sites. Confirm and I will delete both.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "delete all my sites");
    expect(deleteWebsite).toHaveBeenCalledWith(1, {
      deployment: undefined,
      all: true,
      confirmAll: undefined,
    });
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "d-01, d-02",
        operation: "presented",
      },
    ]);
    // The tool result hands the model the exact target list.
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
          content: expect.stringContaining("https://nova-old-site.netlify.app"),
        }),
      ])
    );
  });

  it("executes the sweep when the model re-calls with confirm_all bound to the listed URLs", async () => {
    deleteWebsite.mockClear();
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "delete_website",
              arguments: JSON.stringify({
                all: true,
                confirm_all: ["d-01", "d-02"],
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Both sites are offline." }));
    const result = await runWorkspaceAgent(1, 3, "yes, delete both sites");
    expect(deleteWebsite).toHaveBeenCalledWith(1, {
      deployment: undefined,
      all: true,
      confirmAll: ["d-01", "d-02"],
    });
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "https://nova-live-site.netlify.app",
        operation: "deleted",
      },
    ]);
  });

  it("reports a failed deletion to the model instead of pretending it worked", async () => {
    deleteWebsite.mockClear();
    deleteWebsite.mockResolvedValueOnce({
      ok: false,
      message: "Netlify responded with status 500.",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "delete_website",
              arguments: JSON.stringify({}),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "The deletion failed - nothing went offline." })
      );
    const result = await runWorkspaceAgent(1, 3, "unpublish my site");
    expect(result.actions).toEqual([
      { kind: "deployment", name: "", operation: "failed" },
    ]);
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
          content: expect.stringContaining("No website was deleted"),
        }),
      ])
    );
  });

  it("deploys the workspace website when the model calls deploy_website", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "deploy_website",
              arguments: JSON.stringify({ directory: "/" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "Your site is live at https://nova-live-site.netlify.app",
        })
      );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      onChunk,
    });
    expect(deployWebsite).toHaveBeenCalledWith(1, null, {
      deployment: undefined,
      description: undefined,
    });
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "https://nova-live-site.netlify.app",
        operation: "deployed",
      },
    ]);
    // The tool result fed the live URL back to the model (the messages
    // array is mutated in place across rounds, so assert membership).
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
          content: expect.stringContaining(
            "https://nova-live-site.netlify.app"
          ),
        }),
      ])
    );
    expect(onChunk).toHaveBeenCalledWith(
      "Your site is live at https://nova-live-site.netlify.app"
    );
    // Tool activity names the deployment in its summary record.
    const persistedToolActivities = append.mock.calls
      .map(callArgs => callArgs[1])
      .filter(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    expect(
      persistedToolActivities.some(activity =>
        activity.content.includes("deploy_website")
      )
    ).toBe(true);
    expect(
      persistedToolActivities.some(activity =>
        activity.content.includes(
          "Deployed the website: https://nova-live-site.netlify.app."
        )
      )
    ).toBe(true);
  });

  it("writes the deadline closing status as a passive progress note when a continuation is planned", async () => {
    // Segmented runs chain automatically, so the closing status must not ask
    // the user to send "continue" - the next segment starts on its own.
    completeWithAiGateway.mockResolvedValueOnce({
      text: "Research done, starting the write-up now.",
    });
    deployWebsite.mockImplementationOnce(() => new Promise(() => {}));
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          {
            id: "call-1",
            name: "deploy_website",
            arguments: JSON.stringify({ directory: "/" }),
          },
        ],
      })
    );
    const result = await runWorkspaceAgent(1, 3, "research and deploy", {
      deadlineAtMs: Date.now() + 25,
      continuationPlanned: true,
    });
    expect(result.message.content).toBe(
      "Research done, starting the write-up now."
    );
    const prompt = String(completeWithAiGateway.mock.calls[0][1]);
    expect(prompt).toContain("continues automatically");
    expect(prompt).toContain("Do not ask the user to reply or wait");
    expect(prompt).not.toContain('send "continue"');
  });

  it("asks the user to send continue at the deadline when no continuation is planned", async () => {
    completeWithAiGateway.mockResolvedValueOnce({
      text: "Out of time - send continue to resume.",
    });
    deployWebsite.mockImplementationOnce(() => new Promise(() => {}));
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          {
            id: "call-1",
            name: "deploy_website",
            arguments: JSON.stringify({ directory: "/" }),
          },
        ],
      })
    );
    const result = await runWorkspaceAgent(1, 3, "research and deploy", {
      deadlineAtMs: Date.now() + 25,
    });
    expect(result.message.content).toBe(
      "Out of time - send continue to resume."
    );
    const prompt = String(completeWithAiGateway.mock.calls[0][1]);
    expect(prompt).toContain('they can send "continue"');
  });

  it("uses the model-written closing status at the deadline when the gateway answers", async () => {
    completeWithAiGateway.mockResolvedValueOnce({
      text: 'I got the research done but ran out of time to write the file. Send "continue" and I will pick up right where I left off.',
    });
    deployWebsite.mockImplementationOnce(() => new Promise(() => {}));
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          {
            id: "call-1",
            name: "deploy_website",
            arguments: JSON.stringify({ directory: "/" }),
          },
        ],
      })
    );
    const result = await runWorkspaceAgent(1, 3, "research and deploy", {
      deadlineAtMs: Date.now() + 25,
    });
    const reply = result.message.content;
    expect(reply).toContain('Send "continue" and I will pick up');
    expect(reply).not.toContain("end of what I can do in one go");
  });

  it("closes with a synthesized reply when the FIRST gateway round hangs past the deadline", async () => {
    // Round 0 used to be unraced: a stalled or retrying first model round
    // could push the whole task past the runtime kill with no reply. It is
    // now raced whenever the budget is not already gone.
    chatWithAiGateway.mockImplementationOnce(() => new Promise(() => {}));
    completeWithAiGateway.mockResolvedValueOnce({
      text: 'I did not finish in time. Send "continue" and I will pick up right where I left off.',
    });
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      deadlineAtMs: Date.now() + 100,
    });
    const reply = result.message.content;
    expect(reply).toBe(
      'I did not finish in time. Send "continue" and I will pick up right where I left off.'
    );
  });

  it("closes with a model-written reply when a later gateway round outlasts the deadline", async () => {
    // A stalled or slow LLM round can run up to the client\u2019s own 120s
    // timeout, which used to slip past the run budget between the
    // round-level checks until Vercel killed the whole background task with
    // no reply delivered. Rounds after the first are now raced against the
    // deadline. Fake time: a new round only starts with more than the 45s
    // final-round margin left, so the race must be observed on fast-forward.
    vi.useFakeTimers();
    try {
      chatWithAiGateway
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              {
                id: "call-1",
                name: "read_file",
                arguments: JSON.stringify({ path: "notes.txt" }),
              },
            ],
          })
        )
        .mockImplementationOnce(() => new Promise(() => {})); // hangs: never resolves
      completeWithAiGateway.mockResolvedValueOnce({
        text: 'I read the file but ran out of time to finish the answer. Send "continue" and I will pick up right where I left off.',
      });
      const run = runWorkspaceAgent(1, 3, "research this topic", {
        deadlineAtMs: Date.now() + 60_000,
      });
      // Round 0 and its tool settle on microtasks; round 1 starts with the
      // budget still healthy and arms the race timer.
      await vi.advanceTimersByTimeAsync(10_000);
      // The hung round 1 is abandoned at the deadline and the run closes.
      await vi.advanceTimersByTimeAsync(55_000);
      const result = await run;
      const reply = result.message.content;
      // The close is model-written and briefed with the round's tool summary.
      expect(reply).toContain('Send "continue"');
      expect(completeWithAiGateway.mock.calls.at(-1)[1]).toContain(
        "read_file"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes with a model-written reply when the run budget runs out before the final model round", async () => {
    // The deploy consumed the request budget: the next gateway round would
    // be killed by maxDuration before the reply could persist.
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          {
            id: "call-1",
            name: "deploy_website",
            arguments: JSON.stringify({ directory: "/" }),
          },
        ],
      })
    );
    completeWithAiGateway.mockResolvedValueOnce({
      text: 'The site is live at https://nova-live-site.netlify.app - I ran out of time for the last checks. Send "continue" and I will pick up right where I left off.',
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      onChunk,
      deadlineAtMs: Date.now() + 1_000,
    });
    // No second model round was started.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
    // The closing reply is model-written, briefed with the tool summary.
    const reply = result.message.content;
    expect(reply).toContain("https://nova-live-site.netlify.app");
    expect(reply).toContain('Send "continue"');
    expect(completeWithAiGateway.mock.calls.at(-1)[1]).toContain(
      "Deployed the website: https://nova-live-site.netlify.app"
    );
    // It streams to the client like any other reply.
    expect(onChunk).toHaveBeenCalledWith(reply);
    // The deployment action still counts as completed work.
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "https://nova-live-site.netlify.app",
        operation: "deployed",
      },
    ]);
  });

  it("interrupts a tool that outlasts the run deadline and still persists a closing reply", async () => {
    // A single long call (a VM task, a deploy) used to blow straight past
    // the 285s budget between the round-level checks: Vercel killed the
    // function mid-tool and the user never saw a reply. The race stops
    // waiting on the call and closes the run instead.
    deployWebsite.mockImplementationOnce(() => new Promise(() => {}));
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          {
            id: "call-1",
            name: "deploy_website",
            arguments: JSON.stringify({ directory: "/" }),
          },
        ],
      })
    );
    completeWithAiGateway.mockResolvedValueOnce({
      text: 'The deploy was still running when I ran out of time and did not finish. Send "continue" and I will pick up right where I left off.',
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      onChunk,
      deadlineAtMs: Date.now() + 25,
    });
    // No second model round - the run closed at the deadline.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
    const reply = result.message.content;
    // The closing reply is model-written; the interrupted step is briefed to
    // it and the reply tells the user how to keep going.
    expect(reply).toContain('Send "continue"');
    const closePrompt = completeWithAiGateway.mock.calls.at(-1)[1];
    expect(closePrompt).toContain("deploy_website");
    expect(closePrompt).toContain("interrupted, not finished");
    // The interrupted call is recorded as failed activity, not left "running".
    const persistedToolActivities = append.mock.calls
      .map(callArgs => callArgs[1])
      .filter(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    expect(
      persistedToolActivities.some(activity =>
        activity.content.includes("was interrupted")
      )
    ).toBe(true);
    // The closing reply streams to the client like any other reply.
    expect(onChunk).toHaveBeenCalledWith(reply);
  });

  it("skips a tool without starting it when the budget is already gone when the call begins", async () => {
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          {
            id: "call-1",
            name: "deploy_website",
            arguments: JSON.stringify({ directory: "/" }),
          },
        ],
      })
    );
    completeWithAiGateway.mockResolvedValueOnce({
      text: 'I did not get to the deploy before time ran out, so it never started. Send "continue" and I will pick up right where I left off.',
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      onChunk,
      deadlineAtMs: Date.now() - 1_000,
    });
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
    // The call's side effects never began - nothing deployed after closing.
    expect(deployWebsite).not.toHaveBeenCalled();
    const reply = result.message.content;
    expect(reply).toContain('Send "continue"');
    const closePrompt = completeWithAiGateway.mock.calls.at(-1)[1];
    expect(closePrompt).toContain("deploy_website");
    expect(closePrompt).toContain("skipped because time ran out");
    // The skipped call is recorded as failed activity with the reason.
    const persistedToolActivities = append.mock.calls
      .map(callArgs => callArgs[1])
      .filter(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    expect(
      persistedToolActivities.some(activity =>
        activity.content.includes("was skipped")
      )
    ).toBe(true);
    expect(onChunk).toHaveBeenCalledWith(reply);
  });

  it("relays the reason back to the model when a deployment fails", async () => {
    deployWebsite.mockResolvedValueOnce({
      ok: false,
      message:
        "Add an index.html file to your workspace first - it is your website's entry page.",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "deploy_website",
              arguments: JSON.stringify({ directory: "/" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "I could not deploy: an index.html is missing." })
      );
    const result = await runWorkspaceAgent(1, 3, "publish my site");
    expect(result.actions).toEqual([
      { kind: "deployment", name: "", operation: "failed" },
    ]);
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "The website was not deployed"
    );
    expect(lastToolResult(secondCallMessages)!.content).toContain("index.html");
    expect(result.message.content).toBe(
      "I could not deploy: an index.html is missing."
    );
  });

  it("saves the communication style when the model calls set_communication_style", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-style",
              name: "set_communication_style",
              arguments: JSON.stringify({
                style: "Keep replies short and direct.",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Got it - short and direct from now on." })
      );

    const result = await runWorkspaceAgent(
      1,
      3,
      "keep replies short please",
      {}
    );
    const { setCommunicationStyleForUser } = await import("./db");
    expect(setCommunicationStyleForUser).toHaveBeenCalledWith(
      1,
      "Keep replies short and direct."
    );
    // The tool result confirmed the save back to the model.
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({
      role: "tool",
      tool_call_id: "call-style",
    });
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "Saved the user's preferred communication style"
    );
    expect(String(result.message?.content)).toContain("short and direct");
  });

  it("injects the saved communication style into the system prompt", async () => {
    const { getCommunicationStyleForUser } = await import("./db");
    vi.mocked(getCommunicationStyleForUser).mockResolvedValueOnce(
      "Short, direct replies. No filler."
    );
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "Done." }));

    await runWorkspaceAgent(1, 3, "do the thing", {});
    const messages = chatWithAiGateway.mock.calls[0][1] as Array<{
      role: string;
      content: string;
    }>;
    const system = messages.find(message => message.role === "system");
    expect(system?.content).toContain(
      "The user's saved preferred communication style"
    );
    expect(system?.content).toContain("Short, direct replies. No filler.");
  });

  it("saves the personalisation profile when the model calls set_personalisation", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-personalisation",
              name: "set_personalisation",
              arguments: JSON.stringify({
                enabled: true,
                profile: "A product designer who ships fast.",
                tone: "warm and direct",
                detail: "brief",
                proactiveness: "act_and_tell",
                expertise: "expert",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Saved - I know how you like to work now." })
      );

    const result = await runWorkspaceAgent(
      1,
      3,
      "set up my personalisation",
      {}
    );
    const { setPersonalisationForUser } = await import("./db");
    expect(setPersonalisationForUser).toHaveBeenCalledWith(1, {
      enabled: true,
      profile: "A product designer who ships fast.",
      tone: "warm and direct",
      detail: "brief",
      proactiveness: "act_and_tell",
      expertise: "expert",
    });
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "Saved the user's personalisation preferences"
    );
    expect(String(result.message?.content)).toContain("how you like to work");
  });

  it("injects saved personalisation into the system prompt", async () => {
    const { getPersonalisationForUser } = await import("./db");
    vi.mocked(getPersonalisationForUser).mockResolvedValueOnce({
      enabled: true,
      profile: "A solo founder writing a novel.",
      tone: "playful",
      detail: "detailed",
      proactiveness: "autonomous",
      expertise: "some",
    });
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "Done." }));

    await runWorkspaceAgent(1, 3, "do the thing", {});
    const messages = chatWithAiGateway.mock.calls[0][1] as Array<{
      role: string;
      content: string;
    }>;
    const system = messages.find(message => message.role === "system");
    expect(system?.content).toContain("Personalisation mode is ON.");
    expect(system?.content).toContain("A solo founder writing a novel.");
    expect(system?.content).toContain("Preferred tone: playful.");
    expect(system?.content).toContain("thorough, detailed replies");
  });

  it("announces an enabled personalisation mode even with no saved preferences", async () => {
    const { getPersonalisationForUser } = await import("./db");
    vi.mocked(getPersonalisationForUser).mockResolvedValueOnce({
      enabled: true,
      profile: null,
      tone: null,
      detail: null,
      proactiveness: null,
      expertise: null,
    });
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "Done." }));

    await runWorkspaceAgent(1, 3, "do the thing", {});
    const messages = chatWithAiGateway.mock.calls[0][1] as Array<{
      role: string;
      content: string;
    }>;
    const system = messages.find(message => message.role === "system");
    expect(system?.content).toContain(
      "Personalisation mode is ON, but the user has no saved preferences yet."
    );
  });

  it("marks saved preferences as OFF when the mode is disabled", async () => {
    const { getPersonalisationForUser } = await import("./db");
    vi.mocked(getPersonalisationForUser).mockResolvedValueOnce({
      enabled: false,
      profile: "A backend engineer.",
      tone: null,
      detail: null,
      proactiveness: null,
      expertise: null,
    });
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "Done." }));

    await runWorkspaceAgent(1, 3, "do the thing", {});
    const messages = chatWithAiGateway.mock.calls[0][1] as Array<{
      role: string;
      content: string;
    }>;
    const system = messages.find(message => message.role === "system");
    expect(system?.content).toContain("Personalisation mode is OFF.");
    expect(system?.content).toContain("A backend engineer.");
  });

  it("deploys a chosen directory when the model passes one", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "deploy_website",
              arguments: JSON.stringify({
                directory: "my-react-app",
                description: "my portfolio app",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "Deployed the my-react-app folder - your site is live.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "publish my portfolio app");
    expect(deployWebsite).toHaveBeenCalledWith(1, "my-react-app", {
      deployment: undefined,
      description: "my portfolio app",
    });
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "https://nova-live-site.netlify.app",
        operation: "deployed",
      },
    ]);
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "published from /my-react-app"
    );
  });

  it("refuses to deploy when the model does not choose a directory", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-1", name: "deploy_website", arguments: "{}" },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Which directory should I deploy?" })
      );
    const result = await runWorkspaceAgent(1, 3, "put my site online");
    expect(deployWebsite).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "You must choose the directory to deploy"
    );
    expect(result.actions).toEqual([]);
  });

  it("scaffolds a project template when the model calls create_project_template", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_project_template",
              arguments: JSON.stringify({
                name: "My Portfolio",
                template: "react",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "Scaffolded your React portfolio - want me to deploy it?",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a react portfolio");
    // Project folder at the workspace root with a slugified name.
    expect(createFolder).toHaveBeenCalledWith(1, {
      name: "my-portfolio",
      parentId: null,
    });
    // Every template file is created, nested folders included.
    const createdFiles = createFile.mock.calls.map(call => call[1].name);
    expect(createdFiles).toEqual(
      expect.arrayContaining([
        "index.html",
        "main.jsx",
        "App.jsx",
        "styles.css",
      ])
    );
    expect(
      createFile.mock.calls.some(call =>
        call[1].content.includes("My Portfolio")
      )
    ).toBe(true);
    expect(result.actions).toEqual([
      { kind: "project", name: "my-portfolio", operation: "created" },
    ]);
    // The tool result teaches the model where to point deploy_website.
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "deploy_website"
    );
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "my-portfolio"
    );
    // Tool activity summary names the scaffolded project.
    const persistedToolActivities = append.mock.calls
      .map(callArgs => callArgs[1])
      .filter(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    expect(
      persistedToolActivities.some(activity =>
        activity.content.includes("Created project: my-portfolio.")
      )
    ).toBe(true);
  });

  it("scaffolds the react template when the model omits the stack", async () => {
    // No template argument at all: the default stack is a real React project,
    // not a loose HTML file, and it is used instead of failing the call.
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_project_template",
              arguments: JSON.stringify({ name: "My Landing Page" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "I started you on a static site - ready to deploy whenever you are.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a landing page");
    expect(createFolder).toHaveBeenCalledWith(1, {
      name: "my-landing-page",
      parentId: null,
    });
    // The tool result names the template that was used so the model can say so.
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "(react template)"
    );
    expect(result.actions).toEqual([
      { kind: "project", name: "my-landing-page", operation: "created" },
    ]);
  });

  it("rejects an unknown template instead of improvising one", async () => {
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_project_template",
              arguments: JSON.stringify({ name: "Blog", template: "svelte" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "I can scaffold static, react, or next templates." })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a svelte blog");
    expect(createFolder).not.toHaveBeenCalled();
    expect(createFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "Unknown template: svelte"
    );
    expect(result.actions).toEqual([]);
  });

  it("refuses to scaffold into an existing project folder that already has files", async () => {
    // Yesterday's traffic-jam-escape failure: the folder existed with an
    // index.html, every template file collided with the unique (folder, name)
    // constraint, and the model retried blind. Now the refusal is up front
    // and tells the model what to do instead.
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [
        { id: 10, name: "Notes", parentId: null },
        { id: 22, name: "traffic-jam-escape", parentId: null },
      ],
      files: [{ id: 99, name: "index.html", content: "old", folderId: 22 }],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_project_template",
              arguments: JSON.stringify({
                name: "traffic-jam-escape",
                template: "react",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "That folder already has a project in it - want a fresh name or should I clear it?",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "make a traffic jam game");
    expect(createFolder).not.toHaveBeenCalled();
    expect(createFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    const toolResult = lastToolResult(secondCallMessages)!.content;
    expect(toolResult).toContain("already exists with files");
    expect(toolResult).toContain("traffic-jam-escape");
    expect(toolResult).toContain("different project name");
    expect(result.actions).toEqual([]);
  });

  it("refuses to scaffold when stale files hide in nested subfolders of the project", async () => {
    // A template's files mostly live in nested folders (src/, out/): a
    // stale scaffold can leave the project root empty while its subfolders
    // still hold files. The refusal must see the whole subtree.
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [
        { id: 22, name: "traffic-jam-escape", parentId: null },
        { id: 23, name: "src", parentId: 22 },
      ],
      files: [{ id: 99, name: "main.jsx", content: "old", folderId: 23 }],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_project_template",
              arguments: JSON.stringify({
                name: "traffic-jam-escape",
                template: "react",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "There is an old project in that folder already - a new name it is.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "rebuild my game");
    expect(createFolder).not.toHaveBeenCalled();
    expect(createFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain(
      "already exists with files"
    );
    expect(result.actions).toEqual([]);
  });

  it("refuses create_file when a same-name file already exists at the same level", async () => {
    // Root-level duplicates bypass the database unique constraint (NULL
    // folderId rows never collide), so the guard lives in the handler.
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [],
      files: [{ id: 30, name: "index.html", content: "old", folderId: null }],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_file",
              arguments: JSON.stringify({ name: "Index.HTML", content: "new" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "That file is already there - I will edit it instead.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "add a file");
    expect(createFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    const toolResult = lastToolResult(secondCallMessages)!.content;
    expect(toolResult).toContain("A file named Index.HTML already exists");
    expect(toolResult).toContain("workspace root");
    expect(result.actions).toEqual([]);
  });

  it("scaffolds into an existing but empty project folder", async () => {
    // A folder exists but holds nothing (a stale empty scaffold): reuse it
    // and fill it with the template instead of refusing.
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [{ id: 22, name: "empty-site", parentId: null }],
      files: [],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_project_template",
              arguments: JSON.stringify({
                name: "empty-site",
                template: "static",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Refilled your empty folder with the template." })
      );
    await runWorkspaceAgent(1, 3, "scaffold my site");
    expect(createFolder).not.toHaveBeenCalled();
    expect(createFile.mock.calls.length).toBeGreaterThan(0);
  });

  it("refuses create_folder when a same-name folder already exists at the same level", async () => {
    // The blind retry also created a second traffic-jam-escape folder;
    // same-name siblings only ever confuse later by-name lookups.
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [{ id: 22, name: "traffic-jam-escape", parentId: null }],
      files: [],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_folder",
              arguments: JSON.stringify({ name: "Traffic-Jam-Escape" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "That folder is already there - I will use it as is.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "make a folder");
    expect(createFolder).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    const toolResult = lastToolResult(secondCallMessages)!.content;
    expect(toolResult).toContain(
      "A folder named Traffic-Jam-Escape already exists"
    );
    expect(result.actions).toEqual([]);
  });

  it("reports the real error and its cause chain when a tool fails unexpectedly", async () => {
    // The failing insert surfaced as a bare "The tool call failed
    // unexpectedly." while the real cause (the unique-constraint violation)
    // stayed only in the server logs. The tool result now carries the actual
    // error with its cause, capped like inference errors.
    const dbError = new Error(
      'Failed query: insert into "workspace_files" values (default, ...) returning "id"'
    );
    (dbError as Error & { cause?: unknown }).cause = new Error(
      'duplicate key value violates unique constraint "workspace_files_folder_name_unique"'
    );
    createFile.mockRejectedValueOnce(dbError);
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_file",
              arguments: JSON.stringify({ name: "index.html", content: "hi" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "That failed because of a name collision - let me use a different name.",
        })
      );
    await runWorkspaceAgent(1, 3, "add a file");
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    const toolResult = lastToolResult(secondCallMessages)!.content;
    expect(toolResult).toContain("The tool call failed unexpectedly:");
    expect(toolResult).toContain(
      "duplicate key value violates unique constraint"
    );
  });

  it("sends a model-driven progress update when the model calls send_progress_update", async () => {
    telegramCredentials.mockResolvedValueOnce({
      token: "bot-token",
      chatId: "42",
    });
    chatWithAiGateway
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
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({
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
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "Nice photo of a dog." })
    );
    await runWorkspaceAgent(1, 3, "what is in this picture?", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    const messages = chatWithAiGateway.mock.calls[0][1];
    expect(
      messages.find(m => m.role === "user" && Array.isArray(m.content))
    ).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "what is in this picture?" },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    });
  });

  it("keeps the attachment note on the model turn but not in the persisted user message", async () => {
    const dataUri = "data:image/jpeg;base64,aGVsbG8=";
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "Nice photo of a dog." })
    );
    await runWorkspaceAgent(1, 3, "what is in this picture?", {
      channel: "web",
      uploadContext: "\n\n📎 (Attachment: image-1.png, file id 9.)",
      imageAttachments: [dataUri],
    });
    const messages = chatWithAiGateway.mock.calls[0][1];
    expect(
      messages.find(m => m.role === "user" && Array.isArray(m.content))
    ).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: "what is in this picture?\n\n📎 (Attachment: image-1.png, file id 9.)",
        },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    });
    expect(append).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        role: "user",
        content: "what is in this picture?",
      })
    );
  });

  it("routes image turns to the configured vision model", async () => {
    configuredVisionChatModel.mockReturnValue("glm-4.6v-flash");
    const dataUri = "data:image/jpeg;base64,aGVsbG8=";
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "A dog." })
    );
    await runWorkspaceAgent(1, 3, "what is in this picture?", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    expect(chatWithAiGateway.mock.calls[0][2]).toMatchObject({
      model: "glm-4.6v-flash",
    });
  });

  it("keeps text turns on the default chat model when a vision model is configured", async () => {
    configuredVisionChatModel.mockReturnValue("glm-4.6v-flash");
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "Hello!" })
    );
    await runWorkspaceAgent(1, 3, "hi");
    const options = chatWithAiGateway.mock.calls[0][2] ?? {};
    expect(options.model).toBeUndefined();
  });

  it("keeps image turns on the default chat model when no vision model is configured", async () => {
    configuredVisionChatModel.mockReturnValue(undefined);
    const dataUri = "data:image/jpeg;base64,aGVsbG8=";
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({ text: "A dog." })
    );
    await runWorkspaceAgent(1, 3, "what is in this picture?", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    const options = chatWithAiGateway.mock.calls[0][2] ?? {};
    expect(options.model).toBeUndefined();
  });

  it("drops the attachment instead of failing when the model cannot see images", async () => {
    const dataUri = "data:image/png;base64,aGVsbG8=";
    chatWithAiGateway
      .mockRejectedValueOnce(
        new AiGatewayClientError(
          "image input is not supported by this model",
          "unavailable"
        )
      )
      .mockRejectedValueOnce(
        new AiGatewayClientError(
          "image input is not supported by this model",
          "unavailable"
        )
      )
      .mockRejectedValueOnce(
        new AiGatewayClientError(
          "image input is not supported by this model",
          "unavailable"
        )
      )
      .mockResolvedValueOnce(chatResult({ text: "I cannot see that image." }))
      .mockResolvedValueOnce(
        chatResult({ toolCalls: [endTurnCall("I cannot see that image.")] })
      );
    const result = await runWorkspaceAgent(1, 3, "describe this", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    const retriedContent = chatWithAiGateway.mock.calls
      .flatMap(call => call[1])
      .find(
        message =>
          typeof message.content === "string" &&
          message.content.includes("cannot view image attachments")
      )?.content;
    expect(retriedContent).toBeDefined();
    expect(result.message.content).toContain("I cannot see that image.");
  });

  it("presents a workspace file over Telegram when the model calls present_file", async () => {
    telegramCredentials.mockResolvedValueOnce({
      token: "bot-token",
      chatId: "42",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-present",
              name: "present_file",
              arguments: JSON.stringify({
                file: "welcome.md",
                caption: "Your file",
              }),
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
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({
      role: "tool",
      tool_call_id: "call-present",
      content:
        "Presented welcome.md to the user as a document (message #78) - they can view or download it in the chat.",
    });
    expect(result.actions).toEqual([
      { kind: "file", name: "welcome.md", operation: "presented" },
    ]);
  });

  it("fails gracefully when Telegram is not connected for a present_file call", async () => {
    chatWithAiGateway
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
      .mockResolvedValueOnce(
        chatResult({ text: "Sorry - Telegram is not connected." })
      );
    await runWorkspaceAgent(1, 3, "send me the file", { channel: "telegram" });
    expect(presentTelegramFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("Telegram is not connected"),
    });
  });

  it("recovers a tool call the model spelled out as text and executes it anyway", async () => {
    telegramCredentials.mockResolvedValueOnce({
      token: "bot-token",
      chatId: "42",
    });
    chatWithAiGateway
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
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(
      secondCallMessages.find(
        m => m.role === "assistant" && Array.isArray(m.tool_calls)
      )
    ).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          function: {
            name: "present_file",
            arguments: JSON.stringify({
              file: "welcome.md",
              caption: "Your file",
            }),
          },
        },
      ],
    });
    expect(lastToolResult(secondCallMessages)).toMatchObject({
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
    chatWithAiGateway.mockResolvedValueOnce(
      chatResult({
        text: 'Here is the payload: {"name": "unknown_thing", "parameters": {}}',
      })
    );
    const result = await runWorkspaceAgent(1, 3, "show me the payload", {});
    expect(result.message.content).toContain("unknown_thing");
    expect(presentTelegramFile).not.toHaveBeenCalled();
  });

  it("exposes the thinker tool and feeds its analysis back to the model", async () => {
    runThinkerTaskMock.mockResolvedValueOnce({
      analysis: "Long detailed analysis of caching trade-offs.",
      model: "moonshotai/kimi-k3",
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-think",
              name: "thinker",
              arguments: JSON.stringify({
                question: "Should we cache?",
                context: "The service does 500 rps.",
              }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Yes - add a short TTL cache." }));
    const result = await runWorkspaceAgent(1, 3, "think about caching", {});
    const tools = chatWithAiGateway.mock.calls[0][2].tools.map(
      (tool: { function: { name: string } }) => tool.function.name
    );
    expect(tools).toContain("thinker");
    expect(runThinkerTaskMock).toHaveBeenCalledWith(
      "Should we cache?",
      "The service does 500 rps."
    );
    expect(lastToolResult(chatWithAiGateway.mock.calls[1][1])).toMatchObject({
      role: "tool",
      tool_call_id: "call-think",
      content: "Long detailed analysis of caching trade-offs.",
    });
    expect(result.message.content).toBe("Yes - add a short TTL cache.");
  });

  it("exposes send_progress_update only to the Telegram bot, never to the web app", async () => {
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi", { channel: "telegram" });
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi");
    const telegramTools = chatWithAiGateway.mock.calls[0][2].tools.map(
      tool => tool.function.name
    );
    const webTools = chatWithAiGateway.mock.calls[2][2].tools.map(
      tool => tool.function.name
    );
    expect(telegramTools).toContain("send_progress_update");
    expect(webTools).not.toContain("send_progress_update");
  });

  it("refuses a web-run send_progress_update call and sends no Telegram ping", async () => {
    // No Telegram credentials here: the channel guard must fire before any
    // credential lookup, so a web run can never reach Telegram.
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-progress",
              name: "send_progress_update",
              arguments: JSON.stringify({ text: "Still working on it..." }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "All done." }));
    await runWorkspaceAgent(1, 3, "organize my files");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({
      role: "tool",
      tool_call_id: "call-progress",
      content: expect.stringContaining("only available over Telegram"),
    });
  });

  it("exposes present_file only to the Telegram bot, never to the web app", async () => {
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi", { channel: "telegram" });
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi");
    const telegramTools = chatWithAiGateway.mock.calls[0][2].tools.map(
      tool => tool.function.name
    );
    const webTools = chatWithAiGateway.mock.calls[2][2].tools.map(
      tool => tool.function.name
    );
    expect(telegramTools).toContain("present_file");
    expect(webTools).not.toContain("present_file");
  });

  it("reports the request channel and progress guidance through the system prompt", async () => {
    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "Sure." }));
    await runWorkspaceAgent(1, 3, "hi", { channel: "telegram" });
    const telegramPrompt = chatWithAiGateway.mock.calls[0][1][0].content;
    expect(telegramPrompt).toContain("Telegram");
    expect(telegramPrompt).toContain(
      "the user only sees the messages you send"
    );
    expect(telegramPrompt).toContain("send_progress_update");
    expect(telegramPrompt).toContain("present it with present_file");
    expect(telegramPrompt).toContain("time estimate");
    expect(telegramPrompt).toContain("own the ETA");
    expect(telegramPrompt).toContain("revised range");
    expect(telegramPrompt).toContain(
      "never let more than a minute or so pass in silence"
    );

    chatWithAiGateway.mockResolvedValueOnce(chatResult({ text: "Sure." }));
    await runWorkspaceAgent(1, 3, "hi");
    const webPrompt = chatWithAiGateway.mock.calls[2][1][0].content;
    expect(webPrompt).toContain("the Nova web app");
    expect(webPrompt).toContain("the user sees your tool activity live");
    // The web prompt keeps the interim-notes guidance but swaps it for the
    // web reality: no progress tool, no stray Telegram pings.
    expect(webPrompt).toContain("skip interim progress notes");
    expect(webPrompt).toContain("Telegram-only");
    expect(webPrompt).not.toContain("own the ETA");
    expect(webPrompt).not.toContain("present it with present_file");

    // The progress tool stays Telegram-only.
    const tools = chatWithAiGateway.mock.calls[2][2].tools;
    expect(tools.map(tool => tool.function.name)).not.toContain(
      "send_progress_update"
    );
  });

  it("edits an existing file's content through edit_file", async () => {
    chatWithAiGateway
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
    chatWithAiGateway
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
    chatWithAiGateway.mockImplementation(async () => {
      const calls = chatWithAiGateway.mock.calls.length;
      if (calls >= 12)
        return chatResult({
          toolCalls: [
            {
              id: "call-end",
              name: "end_turn",
              arguments: JSON.stringify({ reply: "Done after 12 rounds." }),
            },
          ],
        });
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
    expect(chatWithAiGateway.mock.calls.length).toBe(12);
    expect(result.message.content).toContain("Done after 12 rounds.");
  });

  it("stops the run at the next round boundary when /stop was requested", async () => {
    chatWithAiGateway.mockReset().mockImplementation(() =>
      Promise.resolve(
        chatWithAiGateway.mock.calls.length === 1
          ? chatResult({
              toolCalls: [
                {
                  id: "call-1",
                  name: "create_file",
                  arguments: JSON.stringify({ name: "plan.md", content: "x" }),
                },
              ],
            })
          : chatResult({ text: "This reply should never be produced." })
      )
    );
    // round 0 executes its tool normally; by round 1 the stop request exists.
    hasAgentStopAfter
      .mockReset()
      .mockImplementation(async () => hasAgentStopAfter.mock.calls.length >= 2);

    const result = await runWorkspaceAgent(1, 3, "do something long", {});
    expect(createFile).toHaveBeenCalledTimes(1);
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("⏹️ Stopped");
    expect(result.message.content).toContain("at your request");
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    hasAgentStopAfter.mockReset();
  });

  it("aborts a long streamed reply mid-response when /stop arrives", async () => {
    chatWithAiGateway.mockReset().mockImplementation(
      (
        _ownerId: number,
        _messages: unknown,
        gatewayOptions: {
          onChunk?: (chunk: string) => void;
          signal?: AbortSignal;
        }
      ) =>
        new Promise((_resolve, reject) => {
          const emit = () => {
            gatewayOptions?.onChunk?.("more text");
            if (gatewayOptions?.signal?.aborted) {
              reject(new Error("request aborted"));
              return;
            }
            setTimeout(emit, 1);
          };
          emit();
        })
    );
    hasAgentStopAfter.mockReset().mockImplementation(async () => true);

    const result = await runWorkspaceAgent(1, 3, "write a very long essay", {
      onChunk: () => {},
    });
    expect(result.message.content).toContain("\u23f9\ufe0f Stopped");
    expect(result.message.content).toContain("at your request");
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    hasAgentStopAfter.mockReset();
  });

  it("stops between tool calls so a long research run cannot continue", async () => {
    chatWithAiGateway.mockReset().mockImplementation(() =>
      Promise.resolve(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_file",
              arguments: JSON.stringify({ name: "a.md", content: "x" }),
            },
            {
              id: "call-2",
              name: "create_file",
              arguments: JSON.stringify({ name: "b.md", content: "y" }),
            },
          ],
        })
      )
    );
    // first tool allowed, stop discovered before the second tool
    hasAgentStopAfter
      .mockReset()
      .mockImplementation(async () => hasAgentStopAfter.mock.calls.length >= 2);

    const result = await runWorkspaceAgent(1, 3, "two tools", {});
    expect(createFile).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("⏹️ Stopped");
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    hasAgentStopAfter.mockReset();
  });

  it("surfaces a disabled Telegram tool to the model", async () => {
    chatWithAiGateway
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
    const toolMessage = lastToolResult(chatWithAiGateway.mock.calls[1][1]);
    expect(toolMessage!.content).toContain("Telegram is not connected");
    expect(result.message.content).toBe("Connect Telegram in Settings first.");
  });

  it("streams reply chunks to onChunk as the model produces them", async () => {
    chatWithAiGateway
      .mockImplementationOnce(async (owner, messages, options) => {
        options?.onChunk?.("Hello");
        options?.onChunk?.(" world");
        return chatResult({ text: "Hello world" });
      })
      .mockResolvedValueOnce(
        chatResult({ toolCalls: [endTurnCall("Hello world")] })
      );
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

  it("hides the backend error behind a generic notice when every retry fails", async () => {
    chatWithAiGateway.mockRejectedValue(
      new AiGatewayClientError(
        "fetch failed: connection reset by peer",
        "unavailable"
      )
    );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(result.message.content).toContain(AI_UNAVAILABLE_PREFIX);
    // The raw backend error - and any endpoint or service it names - never
    // reaches the chat.
    expect(result.message.content).not.toContain(
      "fetch failed: connection reset by peer"
    );
    expect(result.message.content).not.toContain("Mistral");
    expect(onChunk).toHaveBeenCalled();
    expect(chatWithAiGateway).toHaveBeenCalledTimes(3);
  });

  it("keeps the database cause behind a drizzle Failed query wrapper out of the chat", async () => {
    // Drizzle wraps database errors: its own message is only
    // "Failed query: <sql> params: ..." - the real Postgres error (here, the
    // missing migration column) rides on error.cause. All of it stays in the
    // server logs; the chat only gets a generic notice.
    const cause = new Error(
      'db error: column "deploymentKey" of relation "site_deployments" does not exist'
    );
    const wrapped = new Error(
      'Failed query: select "deploymentKey" from "site_deployments"\nparams: 4,500'
    );
    wrapped.cause = cause;
    chatWithAiGateway.mockRejectedValue(wrapped);
    const result = await runWorkspaceAgent(1, 3, "organize my deployments");
    expect(result.message.content).toContain(AI_UNAVAILABLE_PREFIX);
    expect(result.message.content).not.toContain("Failed query");
    expect(result.message.content).not.toContain("deploymentKey");
  });

  it("reports configuration error when the gateway is not configured", async () => {
    getAiGatewayStatus.mockReturnValueOnce({
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
    expect(result.message.content).toContain("not connected");
    expect(chatWithAiGateway).not.toHaveBeenCalled();
  });

  it("reports unreachable gateway when health check fails", async () => {
    getAiGatewayStatus.mockReturnValueOnce({
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
    expect(chatWithAiGateway).not.toHaveBeenCalled();
  });

  it("reports allowance exhausted when request cap is reached", async () => {
    getAiGatewayStatus.mockReturnValueOnce({
      configured: true,
      reachable: true,
      providerConfigured: true,
      providerConfigurationKnown: true,
      model: "chat-medium-latest",
      allowance: {
        usedRequests: 50,
        maxRequests: 50,
        remainingRequests: 0,
        exhausted: true,
      },
    });
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("exhausted");
    expect(chatWithAiGateway).not.toHaveBeenCalled();
  });

  it("returns the allowance message when the workspace cap is reached", async () => {
    chatWithAiGateway.mockRejectedValueOnce(
      new AiGatewayClientError("cap", "allowance_reached")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("allowance");
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
  });

  it("waits once and retries an upstream 429 instead of failing", async () => {
    chatWithAiGateway
      .mockRejectedValueOnce(
        new AiGatewayClientError("Too Many Requests", "rate_limit")
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Back online - here is your answer." })
      )
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [endTurnCall("Back online - here is your answer.")],
        })
      );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    // One patient retry, then the reply, then the explicit end_turn round.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(3);
    expect(result.message.content).toContain("Back online");
  });

  it("refuses a third identical failing tool call instead of executing it again", async () => {
    // The model keeps re-calling the same read of a file that does not
    // exist - the exact loop from the failed project run screenshot.
    // Earlier tests leave persistent mock rejections behind: start clean.
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    const doomedRead = chatResult({
      toolCalls: [
        {
          id: "call-1",
          name: "read_file",
          arguments: JSON.stringify({ file: "ph-meter/index.html" }),
        },
      ],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(doomedRead)
      .mockResolvedValueOnce(doomedRead)
      .mockResolvedValueOnce(doomedRead);
    const result = await runWorkspaceAgent(1, 3, "show me the ph meter site");
    // The first two rounds execute the read for real; the third identical
    // attempt is refused without execution and the loop answers with the
    // end_turn echo, so the gateway sees exactly 4 rounds.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(4);
    // The refusal reaches the model as a tool result naming the earlier
    // failure, not as another dead-end "File not found".
    const refusal = lastToolResult(chatWithAiGateway.mock.calls[3][1])!;
    expect(refusal.content).toContain("already failed twice");
    expect(refusal.content).toContain("[repeated-failure control]");
    // The refused attempt is persisted as a failed activity with a summary
    // that says why it never executed.
    const persistedToolActivities = append.mock.calls
      .map(callArgs => callArgs[1])
      .filter(input => input.content.startsWith(TOOL_ACTIVITY_MESSAGE_PREFIX));
    expect(
      persistedToolActivities.some(activity =>
        activity.content.includes(
          "Refused: this identical call already failed twice"
        )
      )
    ).toBe(true);
    expect(result.actions).toEqual([]);
  });

  it("resolves read_file by workspace path, tolerating ./ prefixes", async () => {
    // The failed-run loop: the model wrote "ph-meter-2/index.html" (and
    // "./ph-meter-2/index.html") instead of the bare file name and got
    // "File not found" even though the file existed inside the folder.
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [{ id: 22, name: "ph-meter-2", parentId: null }],
      files: [
        { id: 99, name: "index.html", content: "<h1>PH</h1>", folderId: 22 },
      ],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "read_file",
              arguments: JSON.stringify({ file: "./ph-meter-2/index.html" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Read it - the PH meter site is coming along." })
      );
    const result = await runWorkspaceAgent(1, 3, "check my ph meter site");
    const toolResult = lastToolResult(chatWithAiGateway.mock.calls[1][1])!;
    expect(toolResult.content).toContain("Content of index.html");
    expect(toolResult.content).toContain("<h1>PH</h1>");
    expect(result.message.content).toContain("coming along");
  });

  it("resolves dotfiles like .env without stripping the leading dot", async () => {
    // normalizeWorkspaceRef used to strip leading dots, mapping ".env" to
    // "env" and making the dotfile unresolvable.
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [],
      files: [{ id: 90, name: ".env", content: "KEY=1", folderId: null }],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "read_file",
              arguments: JSON.stringify({ file: ".env" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Got your env file." }));
    await runWorkspaceAgent(1, 3, "read my env file");
    const toolResult = lastToolResult(chatWithAiGateway.mock.calls[1][1])!;
    expect(toolResult.content).toContain("Content of .env");
    expect(toolResult.content).toContain("KEY=1");
  });

  it("refuses to delete a basename match from the wrong folder in strict mode", async () => {
    // delete_file("wrong-folder/report.md") must not fall back to deleting
    // the first report.md it finds elsewhere.
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [{ id: 22, name: "reports", parentId: null }],
      files: [{ id: 90, name: "report.md", content: "quarter", folderId: 22 }],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "delete_file",
              arguments: JSON.stringify({ file: "wrong-folder/report.md" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({
          text: "That path does not exist, so nothing was deleted.",
        })
      );
    const result = await runWorkspaceAgent(1, 3, "delete my report");
    expect(deleteFile).not.toHaveBeenCalled();
    const toolResult = lastToolResult(chatWithAiGateway.mock.calls[1][1])!;
    expect(toolResult.content).toContain(
      "File not found: wrong-folder/report.md."
    );
    expect(toolResult.content).toContain("reports/report.md (id 90)");
    expect(result.actions).toEqual([]);
  });

  it("deletes a path-qualified file when the folder matches exactly", async () => {
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [{ id: 22, name: "reports", parentId: null }],
      files: [{ id: 90, name: "report.md", content: "quarter", folderId: 22 }],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "delete_file",
              arguments: JSON.stringify({ file: "reports/report.md" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Deleted the report." }));
    const result = await runWorkspaceAgent(1, 3, "delete my report");
    expect(deleteFile).toHaveBeenCalledWith(1, 90);
    expect(result.actions[0]).toMatchObject({
      kind: "file",
      name: "report.md",
    });
  });

  it("suggests the closest existing files when a read misses, instead of a bare not-found", async () => {
    // "ph-meter/index.html" does not exist, but "ph-meter-2.html" does: the
    // refusal must name it so the model stops guessing path variants.
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    computer.mockResolvedValueOnce({
      workspace: { id: 41, persistentSandboxId: "sbx-vm" },
      folders: [{ id: 22, name: "ph-meter-2", parentId: null }],
      files: [
        {
          id: 99,
          name: "ph-meter-2.html",
          content: "<h1>PH</h1>",
          folderId: 22,
        },
      ],
    });
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "read_file",
              arguments: JSON.stringify({ file: "ph-meter/index.html" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Found it - reading ph-meter-2.html instead." })
      );
    await runWorkspaceAgent(1, 3, "check my ph meter site");
    const toolResult = lastToolResult(chatWithAiGateway.mock.calls[1][1])!;
    expect(toolResult.content).toContain(
      "File not found: ph-meter/index.html."
    );
    expect(toolResult.content).toContain(
      "Closest matches: ph-meter-2/ph-meter-2.html (id 99)"
    );
  });

  it("nudges the model to disclose failed steps in its final reply", async () => {
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "read_file",
              arguments: JSON.stringify({ file: "missing.txt" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Everything is set up - here is your site!" })
      );
    const result = await runWorkspaceAgent(1, 3, "make a site");
    // After the failing round, a one-per-run control message tells the
    // model the final reply must disclose the failure.
    const messagesAfterFailure = chatWithAiGateway.mock.calls[1][1];
    const nudge = messagesAfterFailure.find(
      m =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith(FAILURE_NUDGE_PREFIX)
    );
    expect(nudge?.content).toContain("read_file");
    expect(nudge?.content).toContain("File not found: missing.txt");
    expect(nudge?.content).toContain("final reply MUST state plainly");
    // Only ever one nudge per run: the messages array carries forward, so
    // count within the final round's snapshot rather than across rounds.
    const finalRoundMessages = chatWithAiGateway.mock.calls.at(-1)![1];
    const nudgesInFinalRound = finalRoundMessages.filter(
      m =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.startsWith(FAILURE_NUDGE_PREFIX)
    );
    expect(nudgesInFinalRound.length).toBe(1);
    expect(result.message.content).toContain("Everything is set up");
  });

  it("discloses failed steps when an inference error ends the run mid-flight", async () => {
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "read_file",
              arguments: JSON.stringify({ file: "ph-meter/index.html" }),
            },
          ],
        })
      )
      .mockRejectedValue(
        new AiGatewayClientError(
          "The service may be temporarily overloaded, please try again later",
          "rate_limit"
        )
      );
    const result = await runWorkspaceAgent(1, 3, "make me a ph meter site");
    // The user-facing lead explains the throttle; the raw upstream error text
    // is kept out of the chat, and the tool steps that failed before the run
    // died are listed instead of "everything so far" hiding them.
    expect(result.message.content).toContain("Too many requests right now");
    expect(result.message.content).not.toContain(
      "The service may be temporarily overloaded"
    );
    expect(result.message.content).toContain(
      "Steps that failed during this run"
    );
    expect(result.message.content).toContain("read_file");
    expect(result.message.content).toContain(
      "File not found: ph-meter/index.html"
    );
  });

  it("stops after one patient 429 retry and leads with the provider's own error", async () => {
    chatWithAiGateway
      .mockRejectedValueOnce(
        new AiGatewayClientError("Too Many Requests", "rate_limit")
      )
      .mockRejectedValueOnce(
        new AiGatewayClientError("Too Many Requests", "rate_limit")
      )
      .mockRejectedValueOnce(
        new AiGatewayClientError("Too Many Requests", "rate_limit")
      );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    // The wait happens once per run, never as a fast-retry hammer.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(2);
    // The reply explains the throttle in user-facing terms instead of
    // quoting the upstream provider's raw error text.
    expect(result.message.content).toContain("Too many requests right now");
    expect(result.message.content).not.toContain("Too Many Requests");
    expect(result.message.content).toContain(
      "Everything so far is saved - please try again in a little while."
    );
  });

  it("does not retry permanent client errors from the gateway", async () => {
    // Earlier tests leave queued mock rejections behind (clearAllMocks only
    // clears call history), so start from a clean slate like the other
    // error-path tests do.
    chatWithAiGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    chatWithAiGateway.mockRejectedValue(
      new AiGatewayClientError("Model not found", "client_error")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    // A 4xx rejection cannot succeed by retrying, so the agent stops at once.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("rejected this request");
    // The provider's raw error text stays out of the chat.
    expect(result.message.content).not.toContain("Model not found");
  });

  it("skips the patient 429 retry when the run deadline cannot absorb the wait", async () => {
    chatWithAiGateway.mockRejectedValue(
      new AiGatewayClientError("Too Many Requests", "rate_limit")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?", {
      deadlineAtMs: Date.now() + 10_000,
    });
    // No time for the wait: fail immediately with a user-facing explanation.
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("Too many requests right now");
  });

  it("returns configuration message when the chat throws a configuration error", async () => {
    chatWithAiGateway.mockRejectedValueOnce(
      new AiGatewayClientError("no key", "configuration")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("not connected");
    // The gateway's raw error text stays out of the chat.
    expect(result.message.content).not.toContain("no key");
  });

  it("returns invalid-response message when every retry is invalid", async () => {
    chatWithAiGateway.mockRejectedValue(
      new AiGatewayClientError("bad", "invalid_response")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("invalid response");
    expect(chatWithAiGateway).toHaveBeenCalledTimes(3);
  });

  it("recovers from a transient gateway failure by retrying the round", async () => {
    chatWithAiGateway
      .mockRejectedValueOnce(
        new AiGatewayClientError("blip", "unavailable")
      )
      .mockResolvedValueOnce(chatResult({ text: "All good." }))
      .mockResolvedValueOnce(
        chatResult({ toolCalls: [endTurnCall("All good.")] })
      );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(chatWithAiGateway).toHaveBeenCalledTimes(3);
    expect(result.message.content).toBe("All good.");
    expect(onChunk).toHaveBeenCalledWith("All good.");
  });

  it("does not retry once text has already streamed to the client", async () => {
    // Simulate a mid-stream failure: a chunk reached the client, then the
    // gateway round aborted. Retrying would duplicate what the user saw.
    chatWithAiGateway.mockImplementationOnce(
      async (owner, messages, options) => {
        options?.onChunk?.("Partial ");
        throw new AiGatewayClientError("blip", "unavailable");
      }
    );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(chatWithAiGateway).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith("Partial ");
    // The partial reply the user already watched is kept, with a note that the
    // gateway dropped - not replaced by a bare error notice.
    expect(result.message.content).toContain("Partial");
    expect(result.message.content).toContain("lost the connection");
    // The streamed partial is not re-emitted; only the failure note follows.
    const emitted = onChunk.mock.calls.map(call => call[0]).join("");
    expect(emitted).toBe(
      "Partial " +
        "\n\nNova lost the connection to its AI service before this reply finished. Everything so far is saved - send another message and I will continue from here."
    );
  });

  it("keeps tool-narration text streamed in earlier rounds when the final round fails", async () => {
    // Round 1 streams "Checking your files" and requests a tool; round 2
    // fails with nothing streamed - the user still keeps what they watched.
    chatWithAiGateway
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
        new AiGatewayClientError("dead", "invalid_response")
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

  it("renames a default-titled chat from its first messages via the AI gateway", async () => {
    completeWithAiGateway.mockResolvedValueOnce({
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
    expect(completeWithAiGateway).not.toHaveBeenCalled();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it("does nothing before the first assistant reply", async () => {
    chatMessages.mockResolvedValueOnce([
      { id: 1, role: "user", content: "Help me plan a sprint." },
    ]);
    await autoTitleChatForUser(1, 3);
    expect(completeWithAiGateway).not.toHaveBeenCalled();
  });

  it("strips wrapping quotes and newlines from the model title", async () => {
    completeWithAiGateway.mockResolvedValueOnce({
      text: '"Sprint\nplanning ideas"',
    });
    await autoTitleChatForUser(1, 3);
    expect(renameChat).toHaveBeenCalledWith(1, 3, "Sprint", expect.any(Array));
  });

  it("does not rename when the generated title is missing", async () => {
    completeWithAiGateway.mockResolvedValueOnce({ text: "" });
    await autoTitleChatForUser(1, 3);
    expect(renameChat).not.toHaveBeenCalled();
  });
});

describe("connector tool gating", () => {
  it("drops connector tools when nothing is connected", () => {
    const tools = workspaceToolsForConnectors([]);
    expect(
      tools.find(tool => tool.function.name === "use_connector_tool")
    ).toBeUndefined();
    expect(
      tools.find(tool => tool.function.name === "list_connector_tools")
    ).toBeUndefined();
    expect(
      tools.find(tool => tool.function.name === "run_vm_task")
    ).toBeDefined();
  });

  it("exposes the dedicated GitHub tool without the raw action catalog", () => {
    const tools = workspaceToolsForConnectors(["github"]);
    expect(tools.find(tool => tool.function.name === "github")).toBeDefined();
    expect(
      tools.find(tool => tool.function.name === "list_connector_tools")
    ).toBeUndefined();
    expect(
      tools.find(tool => tool.function.name === "use_connector_tool")
    ).toBeUndefined();
  });

  it("exposes Gmail's raw catalog only when Gmail is connected", () => {
    const tools = workspaceToolsForConnectors(["github", "gmail"]);
    const listTool = tools.find(
      tool => tool.function.name === "list_connector_tools"
    );
    expect(
      (
        listTool!.function.parameters as {
          properties: Record<string, { enum?: string[] }>;
        }
      ).properties.connector.enum
    ).toEqual(["gmail"]);
    expect(tools.find(tool => tool.function.name === "github")).toBeDefined();
  });

  it("status failures degrade to no connected toolkits", async () => {
    const failing = vi.fn(async () => {
      throw new Error("composio down");
    });
    const connected = await getConnectedConnectorToolkits(1, failing as never);
    expect(connected).toEqual([]);
  });

  it("keeps a healthy connector when another connector status check fails", async () => {
    const check = async (_owner: number, toolkit: string) => {
      if (toolkit === "gmail") throw new Error("gmail status unavailable");
      return { connected: true };
    };
    const connected = await getConnectedConnectorToolkits(1, check as never);
    expect(connected).toEqual(["github"]);
  });

  it("reports only connected toolkits", async () => {
    const check = async (_owner: number, toolkit: string) => ({
      connected: toolkit === "gmail",
    });
    const connected = await getConnectedConnectorToolkits(1, check as never);
    expect(connected).toEqual(["gmail"]);
  });

  it("exposes the memory tools to the model", async () => {
    chatWithAiGateway.mockReset();
    chatWithAiGateway
      .mockResolvedValueOnce(chatResult({ text: "Hi!" }))
      .mockResolvedValueOnce(endTurnReply({ reply: "Hi!" }));
    await runWorkspaceAgent(1, 3, "hi");
    const [, , options] = chatWithAiGateway.mock.calls[0];
    const names = options.tools.map(
      (t: { function: { name: string } }) => t.function.name
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "search_memories",
        "read_memory",
        "save_memory",
        "delete_memory",
      ])
    );
  });

  it("feeds search_memories results back to the model", async () => {
    chatWithAiGateway.mockReset();
    searchMemoriesForUser.mockClear();
    appendConversationTurn.mockClear();
    searchMemoriesForUser.mockResolvedValueOnce([
      {
        id: 9,
        chatId: 3,
        kind: "conversation",
        title: "Deploy the portfolio site",
        summary: "Built and deployed the portfolio site to Netlify.",
        tags: null,
        content:
          "User: deploy the portfolio site\nNova: Live at https://example.netlify.app",
        s3Uri: null,
        updatedAt: new Date("2026-09-20T10:00:00Z"),
      },
    ]);
    chatWithAiGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-mem",
              name: "search_memories",
              arguments: JSON.stringify({ query: "portfolio" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Found it." }))
      .mockResolvedValueOnce(endTurnReply({ reply: "Found it." }));
    await runWorkspaceAgent(1, 3, "what did we do with the portfolio site?");
    expect(searchMemoriesForUser).toHaveBeenCalledWith(1, "portfolio", 8);
    const secondCallMessages = chatWithAiGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-mem",
          content: expect.stringContaining(
            "Memory 9 - Deploy the portfolio site"
          ),
        }),
      ])
    );
  });

  it("captures the completed turn into the conversation memory", async () => {
    chatWithAiGateway.mockReset();
    appendConversationTurn.mockClear();
    chatWithAiGateway
      .mockResolvedValueOnce(chatResult({ text: "Done." }))
      .mockResolvedValueOnce(endTurnReply({ reply: "Done." }));
    await runWorkspaceAgent(1, 3, "remember this task");
    expect(appendConversationTurn).toHaveBeenCalledWith(1, 3, {
      userText: "remember this task",
      assistantText: "Done.",
    });
  });
});
