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
  getCommunicationStyleForUser: vi.fn(async () => null),
  setCommunicationStyleForUser: vi.fn(async (_owner: number, style: string) => style.trim().slice(0, 500)),
  getDatabaseTime,
  hasAgentStopAfter,
}));

const completeWithMistralGateway = vi.fn();
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
      .find(m => m.role === "assistant" && typeof m.content === "string" && m.content);
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
const chatWithMistralGateway = vi.fn(endTurnEchoOnNudge);
const getMistralGatewayStatus = vi.fn(() => ({
  configured: true,
  reachable: true,
  providerConfigured: true,
  providerConfigurationKnown: true,
  model: "mistral-medium-latest",
  allowance: {
    usedRequests: 0,
    maxRequests: 50,
    remainingRequests: 50,
    exhausted: false,
  },
}));
class MistralGatewayClientError extends Error {
  kind:
    | "configuration"
    | "unavailable"
    | "rate_limit"
    | "allowance_reached"
    | "invalid_response";
  constructor(message, kind) {
    super(message);
    this.name = "MistralGatewayClientError";
    this.kind = kind;
  }
}
vi.mock("./mistralGateway", () => ({
  completeWithMistralGateway,
  chatWithMistralGateway,
  getMistralGatewayStatus,
  MistralGatewayClientError,
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

const deployWebsite = vi.fn(async () => ({
  ok: true,
  deployment: {
    id: 5,
    siteId: "site-1",
    siteName: "nova-live-site",
    siteUrl: "https://nova-live-site.netlify.app",
    fileCount: 3,
    status: "live",
  },
}));
vi.mock("./siteDeploy", () => ({
  deployWorkspaceSite: deployWebsite,
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
  sendTelegramWorkStartedAck,
  END_TURN_NUDGE_PREFIX,
  autoTitleChatForUser,
  setGatewayRetryDelaysForTests,
  setGatewayRateLimitRetryDelayForTests,
  TOOL_ACTIVITY_MESSAGE_PREFIX,
  workspaceToolsForConnectors,
  getConnectedConnectorToolkits,
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
  model: "mistral-medium-latest",
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
    setGatewayRateLimitRetryDelayForTests(0);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setGatewayRateLimitRetryDelayForTests(null);
    // Streaming runs now poll the stop flag mid-response: keep the default.
    hasAgentStopAfter.mockImplementation(async () => false);
  });

  it("runs every message through the model with workspace tools exposed", async () => {
    chatWithMistralGateway.mockResolvedValueOnce(
      chatResult({ text: "Sure - what should it contain?" })
    );
    await runWorkspaceAgent(1, 3, "hi");
    // A plain reply no longer ends the run: the answer is followed by the
    // end-turn nudge, which the model answers with end_turn.
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(2);
    const [owner, messages, options] = chatWithMistralGateway.mock.calls[0];
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
    expect(messages).toEqual(
      expect.arrayContaining([{ role: "user", content: "hi" }])
    );
    expect(computer).toHaveBeenCalled();
  });

  it("gives the model the prior conversation instead of starting fresh every turn", async () => {
    // Chat history has an earlier exchange plus a tool-activity row (raw
    // JSON bookkeeping) that must never reach the model as a real turn.
    chatMessages.mockResolvedValueOnce([
      { id: 1, role: "user", content: "Add a game history feature." },
      { id: 2, role: "assistant", content: `${TOOL_ACTIVITY_MESSAGE_PREFIX}{"name":"create_file"}` },
      { id: 3, role: "assistant", content: "Added a local high-score history to the game." },
      { id: 4, role: "user", content: "Are you done?" },
    ]);
    chatWithMistralGateway.mockResolvedValueOnce(chatResult({ text: "Yep, all set!" }));
    await runWorkspaceAgent(1, 3, "Are you done?");
    const messages = chatWithMistralGateway.mock.calls[0][1];
    // The messages array is mutated in place across rounds (draft + end-turn
    // nudge rows land after the first call), so the prior conversation is
    // asserted as the leading rows, in order, without the tool-activity row.
    expect(messages.slice(1, 4)).toEqual([
      { role: "user", content: "Add a game history feature." },
      { role: "assistant", content: "Added a local high-score history to the game." },
      { role: "user", content: "Are you done?" },
    ]);
  });

  it("creates a file when the model calls create_file, then finishes with a reply", async () => {
    chatWithMistralGateway
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
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
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

  it("deploys the workspace website when the model calls deploy_website", async () => {
    chatWithMistralGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-1", name: "deploy_website", arguments: JSON.stringify({ directory: "/" }) },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Your site is live at https://nova-live-site.netlify.app" })
      );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", { onChunk });
    expect(deployWebsite).toHaveBeenCalledWith(1, null, { site: "update" });
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "https://nova-live-site.netlify.app",
        operation: "deployed",
      },
    ]);
    // The tool result fed the live URL back to the model (the messages
    // array is mutated in place across rounds, so assert membership).
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(secondCallMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
          content: expect.stringContaining("https://nova-live-site.netlify.app"),
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
    expect(persistedToolActivities.some(activity => activity.content.includes("deploy_website"))).toBe(true);
    expect(
      persistedToolActivities.some(activity =>
        activity.content.includes(
          "Deployed the website: https://nova-live-site.netlify.app."
        )
      )
    ).toBe(true);
  });

  it("sends the guaranteed model-written work confirmation over Telegram", async () => {
    completeWithMistralGateway.mockResolvedValueOnce({
      text: "On it - this should take about 30 seconds.",
    });
    await sendTelegramWorkStartedAck(1, "bot-token", "42", "build me a landing page", Date.now() + 285_000);
    expect(completeWithMistralGateway).toHaveBeenCalledWith(1, expect.stringContaining("build me a landing page"));
    expect(sendTelegramMessage).toHaveBeenCalledWith("bot-token", "42", "On it - this should take about 30 seconds.");
  });

  it("skips the work confirmation when the run budget is nearly gone", async () => {
    await sendTelegramWorkStartedAck(1, "bot-token", "42", "do a thing", Date.now() + 10_000);
    expect(completeWithMistralGateway).not.toHaveBeenCalled();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("never breaks the run when the work confirmation fails", async () => {
    completeWithMistralGateway.mockRejectedValueOnce(new Error("gateway down"));
    await expect(
      sendTelegramWorkStartedAck(1, "bot-token", "42", "do a thing", Date.now() + 285_000)
    ).resolves.toBeUndefined();
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("uses the model-written closing status at the deadline when the gateway answers", async () => {
    completeWithMistralGateway.mockResolvedValueOnce({
      text: "I got the research done but ran out of time to write the file. Send \"continue\" and I will pick up right where I left off.",
    });
    deployWebsite.mockImplementationOnce(() => new Promise(() => {}));
    chatWithMistralGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          { id: "call-1", name: "deploy_website", arguments: JSON.stringify({ directory: "/" }) },
        ],
      })
    );
    const result = await runWorkspaceAgent(1, 3, "research and deploy", {
      deadlineAtMs: Date.now() + 25,
    });
    const reply = result.message.content;
    expect(reply).toContain("Send \"continue\" and I will pick up");
    expect(reply).not.toContain("end of what I can do in one go");
  });

  it("closes with a synthesized reply when the FIRST gateway round hangs past the deadline", async () => {
    // Round 0 used to be unraced: a stalled or retrying first model round
    // could push the whole task past the runtime kill with no reply. It is
    // now raced whenever the budget is not already gone.
    chatWithMistralGateway.mockImplementationOnce(() => new Promise(() => {}));
    completeWithMistralGateway.mockResolvedValueOnce({
      text: 'I did not finish in time. Send "continue" and I will pick up right where I left off.',
    });
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      deadlineAtMs: Date.now() + 100,
    });
    const reply = result.message.content;
    expect(reply).toBe('I did not finish in time. Send "continue" and I will pick up right where I left off.');
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
      chatWithMistralGateway
        .mockResolvedValueOnce(
          chatResult({
            toolCalls: [
              { id: "call-1", name: "read_file", arguments: JSON.stringify({ path: "notes.txt" }) },
            ],
          })
        )
        .mockImplementationOnce(() => new Promise(() => {})); // hangs: never resolves
      completeWithMistralGateway.mockResolvedValueOnce({
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
      expect(completeWithMistralGateway.mock.calls.at(-1)[1]).toContain("read_file");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes with a model-written reply when the run budget runs out before the final model round", async () => {
    // The deploy consumed the request budget: the next gateway round would
    // be killed by maxDuration before the reply could persist.
    chatWithMistralGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          { id: "call-1", name: "deploy_website", arguments: JSON.stringify({ directory: "/" }) },
        ],
      })
    );
    completeWithMistralGateway.mockResolvedValueOnce({
      text: 'The site is live at https://nova-live-site.netlify.app - I ran out of time for the last checks. Send "continue" and I will pick up right where I left off.',
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      onChunk,
      deadlineAtMs: Date.now() + 1_000,
    });
    // No second model round was started.
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
    // The closing reply is model-written, briefed with the tool summary.
    const reply = result.message.content;
    expect(reply).toContain("https://nova-live-site.netlify.app");
    expect(reply).toContain('Send "continue"');
    expect(completeWithMistralGateway.mock.calls.at(-1)[1]).toContain(
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
    chatWithMistralGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          { id: "call-1", name: "deploy_website", arguments: JSON.stringify({ directory: "/" }) },
        ],
      })
    );
    completeWithMistralGateway.mockResolvedValueOnce({
      text: 'The deploy was still running when I ran out of time and did not finish. Send "continue" and I will pick up right where I left off.',
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      onChunk,
      deadlineAtMs: Date.now() + 25,
    });
    // No second model round - the run closed at the deadline.
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
    const reply = result.message.content;
    // The closing reply is model-written; the interrupted step is briefed to
    // it and the reply tells the user how to keep going.
    expect(reply).toContain('Send "continue"');
    const closePrompt = completeWithMistralGateway.mock.calls.at(-1)[1];
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
    chatWithMistralGateway.mockResolvedValueOnce(
      chatResult({
        toolCalls: [
          { id: "call-1", name: "deploy_website", arguments: JSON.stringify({ directory: "/" }) },
        ],
      })
    );
    completeWithMistralGateway.mockResolvedValueOnce({
      text: 'I did not get to the deploy before time ran out, so it never started. Send "continue" and I will pick up right where I left off.',
    });
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "publish my site", {
      onChunk,
      deadlineAtMs: Date.now() - 1_000,
    });
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
    // The call's side effects never began - nothing deployed after closing.
    expect(deployWebsite).not.toHaveBeenCalled();
    const reply = result.message.content;
    expect(reply).toContain('Send "continue"');
    const closePrompt = completeWithMistralGateway.mock.calls.at(-1)[1];
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
      message: "Add an index.html file to your workspace first - it is your website's entry page.",
    });
    chatWithMistralGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-1", name: "deploy_website", arguments: JSON.stringify({ directory: "/" }) },
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
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain("The website was not deployed");
    expect(lastToolResult(secondCallMessages)!.content).toContain("index.html");
    expect(result.message.content).toBe("I could not deploy: an index.html is missing.");
  });

  it("saves the communication style when the model calls set_communication_style", async () => {
    chatWithMistralGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-style", name: "set_communication_style", arguments: JSON.stringify({ style: "Keep replies short and direct." }) },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Got it - short and direct from now on." }));

    const result = await runWorkspaceAgent(1, 3, "keep replies short please", {});
    const { setCommunicationStyleForUser } = await import("./db");
    expect(setCommunicationStyleForUser).toHaveBeenCalledWith(1, "Keep replies short and direct.");
    // The tool result confirmed the save back to the model.
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({ role: "tool", tool_call_id: "call-style" });
    expect(lastToolResult(secondCallMessages)!.content).toContain("Saved the user's preferred communication style");
    expect(String(result.message?.content)).toContain("short and direct");
  });

  it("injects the saved communication style into the system prompt", async () => {
    const { getCommunicationStyleForUser } = await import("./db");
    vi.mocked(getCommunicationStyleForUser).mockResolvedValueOnce("Short, direct replies. No filler.");
    chatWithMistralGateway.mockResolvedValueOnce(chatResult({ text: "Done." }));

    await runWorkspaceAgent(1, 3, "do the thing", {});
    const messages = chatWithMistralGateway.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const system = messages.find(message => message.role === "system");
    expect(system?.content).toContain("The user's saved preferred communication style");
    expect(system?.content).toContain("Short, direct replies. No filler.");
  });

  it("deploys a chosen directory when the model passes one", async () => {
    chatWithMistralGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "deploy_website",
              arguments: JSON.stringify({ directory: "my-react-app" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Deployed the my-react-app folder - your site is live." })
      );
    const result = await runWorkspaceAgent(1, 3, "publish my portfolio app");
    expect(deployWebsite).toHaveBeenCalledWith(1, "my-react-app", { site: "update" });
    expect(result.actions).toEqual([
      {
        kind: "deployment",
        name: "https://nova-live-site.netlify.app",
        operation: "deployed",
      },
    ]);
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain("published from /my-react-app");
  });

  it("refuses to deploy when the model does not choose a directory", async () => {
    chatWithMistralGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-1", name: "deploy_website", arguments: "{}" },
          ],
        })
      )
      .mockResolvedValueOnce(chatResult({ text: "Which directory should I deploy?" }));
    const result = await runWorkspaceAgent(1, 3, "put my site online");
    expect(deployWebsite).not.toHaveBeenCalled();
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain("You must choose the directory to deploy");
    expect(result.actions).toEqual([]);
  });

  it("scaffolds a project template when the model calls create_project_template", async () => {
    chatWithMistralGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            {
              id: "call-1",
              name: "create_project_template",
              arguments: JSON.stringify({ name: "My Portfolio", template: "react" }),
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "Scaffolded your React portfolio - want me to deploy it?" })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a react portfolio");
    // Project folder at the workspace root with a slugified name.
    expect(createFolder).toHaveBeenCalledWith(1, { name: "my-portfolio", parentId: null });
    // Every template file is created, nested folders included.
    const createdFiles = createFile.mock.calls.map(call => call[1].name);
    expect(createdFiles).toEqual(expect.arrayContaining(["index.html", "main.jsx", "App.jsx", "styles.css"]));
    expect(createFile.mock.calls.some(call => call[1].content.includes("My Portfolio"))).toBe(true);
    expect(result.actions).toEqual([
      { kind: "project", name: "my-portfolio", operation: "created" },
    ]);
    // The tool result teaches the model where to point deploy_website.
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain("deploy_website");
    expect(lastToolResult(secondCallMessages)!.content).toContain("my-portfolio");
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
    chatWithMistralGateway
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call-1", name: "create_project_template", arguments: JSON.stringify({ name: "My Landing Page" }) },
          ],
        })
      )
      .mockResolvedValueOnce(
        chatResult({ text: "I started you on a static site - ready to deploy whenever you are." })
      );
    const result = await runWorkspaceAgent(1, 3, "make me a landing page");
    expect(createFolder).toHaveBeenCalledWith(1, { name: "my-landing-page", parentId: null });
    // The tool result names the template that was used so the model can say so.
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain("(react template)");
    expect(result.actions).toEqual([
      { kind: "project", name: "my-landing-page", operation: "created" },
    ]);
  });

  it("rejects an unknown template instead of improvising one", async () => {
    chatWithMistralGateway
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
      .mockResolvedValueOnce(chatResult({ text: "I can scaffold static, react, or next templates." }));
    const result = await runWorkspaceAgent(1, 3, "make me a svelte blog");
    expect(createFolder).not.toHaveBeenCalled();
    expect(createFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)!.content).toContain("Unknown template: svelte");
    expect(result.actions).toEqual([]);
  });

  it("sends a model-driven progress update when the model calls send_progress_update", async () => {
    telegramCredentials.mockResolvedValueOnce({ token: "bot-token", chatId: "42" });
    chatWithMistralGateway
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
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
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
    chatWithMistralGateway.mockResolvedValueOnce(chatResult({ text: "Nice photo of a dog." }));
    await runWorkspaceAgent(1, 3, "what is in this picture?", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    const messages = chatWithMistralGateway.mock.calls[0][1];
    expect(
      messages.find(
        m => m.role === "user" && Array.isArray(m.content)
      )
    ).toMatchObject({
      role: "user",
      content: [
        { type: "text", text: "what is in this picture?" },
        { type: "image_url", image_url: { url: dataUri } },
      ],
    });
  });

  it("drops the attachment instead of failing when the model cannot see images", async () => {
    const dataUri = "data:image/png;base64,aGVsbG8=";
    chatWithMistralGateway
      .mockRejectedValueOnce(
        new MistralGatewayClientError(
          "image input is not supported by this model",
          "unavailable"
        )
      )
      .mockRejectedValueOnce(
        new MistralGatewayClientError(
          "image input is not supported by this model",
          "unavailable"
        )
      )
      .mockRejectedValueOnce(
        new MistralGatewayClientError(
          "image input is not supported by this model",
          "unavailable"
        )
      )
      .mockResolvedValueOnce(chatResult({ text: "I cannot see that image." }))
      .mockResolvedValueOnce(chatResult({ toolCalls: [endTurnCall("I cannot see that image.")] }));
    const result = await runWorkspaceAgent(1, 3, "describe this", {
      channel: "telegram",
      imageAttachments: [dataUri],
    });
    const retriedContent = chatWithMistralGateway.mock.calls
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
    telegramCredentials.mockResolvedValueOnce({ token: "bot-token", chatId: "42" });
    chatWithMistralGateway
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
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({
      role: "tool",
      tool_call_id: "call-present",
      content: "Presented welcome.md to the user as a document (message #78) - they can view or download it in the chat.",
    });
    expect(result.actions).toEqual([
      { kind: "file", name: "welcome.md", operation: "presented" },
    ]);
  });

  it("fails gracefully when Telegram is not connected for a present_file call", async () => {
    chatWithMistralGateway
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
      .mockResolvedValueOnce(chatResult({ text: "Sorry - Telegram is not connected." }));
    await runWorkspaceAgent(1, 3, "send me the file", { channel: "telegram" });
    expect(presentTelegramFile).not.toHaveBeenCalled();
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(lastToolResult(secondCallMessages)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("Telegram is not connected"),
    });
  });

  it("recovers a tool call the model spelled out as text and executes it anyway", async () => {
    telegramCredentials.mockResolvedValueOnce({ token: "bot-token", chatId: "42" });
    chatWithMistralGateway
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
    const secondCallMessages = chatWithMistralGateway.mock.calls[1][1];
    expect(
      secondCallMessages.find(m => m.role === "assistant" && Array.isArray(m.tool_calls))
    ).toMatchObject({
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
    chatWithMistralGateway.mockResolvedValueOnce(
      chatResult({ text: 'Here is the payload: {"name": "unknown_thing", "parameters": {}}' })
    );
    const result = await runWorkspaceAgent(1, 3, "show me the payload", {});
    expect(result.message.content).toContain("unknown_thing");
    expect(presentTelegramFile).not.toHaveBeenCalled();
  });

  it("exposes present_file only to the Telegram bot, never to the web app", async () => {
    chatWithMistralGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi", { channel: "telegram" });
    chatWithMistralGateway.mockResolvedValueOnce(chatResult({ text: "ok" }));
    await runWorkspaceAgent(1, 3, "hi");
    const telegramTools = chatWithMistralGateway.mock.calls[0][2].tools.map(
      tool => tool.function.name
    );
    const webTools = chatWithMistralGateway.mock.calls[2][2].tools.map(
      tool => tool.function.name
    );
    expect(telegramTools).toContain("present_file");
    expect(webTools).not.toContain("present_file");
  });

  it("reports the request channel and progress guidance through the system prompt", async () => {
    chatWithMistralGateway.mockResolvedValueOnce(chatResult({ text: "Sure." }));
    await runWorkspaceAgent(1, 3, "hi", { channel: "telegram" });
    const telegramPrompt = chatWithMistralGateway.mock.calls[0][1][0].content;
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

    chatWithMistralGateway.mockResolvedValueOnce(chatResult({ text: "Sure." }));
    await runWorkspaceAgent(1, 3, "hi");
    const webPrompt = chatWithMistralGateway.mock.calls[2][1][0].content;
    expect(webPrompt).toContain("the Nova web app");
    expect(webPrompt).toContain("the user sees your tool activity live");

    // The progress tool is exposed to the model either way.
    const tools = chatWithMistralGateway.mock.calls[2][2].tools;
    expect(tools.map(tool => tool.function.name)).toContain(
      "send_progress_update"
    );
  });


  it("edits an existing file's content through edit_file", async () => {
    chatWithMistralGateway
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
    chatWithMistralGateway
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
    chatWithMistralGateway.mockImplementation(async () => {
      const calls = chatWithMistralGateway.mock.calls.length;
      if (calls >= 12)
        return chatResult({
          toolCalls: [
            { id: "call-end", name: "end_turn", arguments: JSON.stringify({ reply: "Done after 12 rounds." }) },
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
    expect(chatWithMistralGateway.mock.calls.length).toBe(12);
    expect(result.message.content).toContain("Done after 12 rounds.");
  });

  it("stops the run at the next round boundary when /stop was requested", async () => {
    chatWithMistralGateway.mockReset().mockImplementation(() =>
      Promise.resolve(
        chatWithMistralGateway.mock.calls.length === 1
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
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("⏹️ Stopped");
    expect(result.message.content).toContain("/stop");
    chatWithMistralGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    hasAgentStopAfter.mockReset();
  });

  it("aborts a long streamed reply mid-response when /stop arrives", async () => {
    chatWithMistralGateway.mockReset().mockImplementation(
      (_ownerId: number, _messages: unknown, gatewayOptions: { onChunk?: (chunk: string) => void; signal?: AbortSignal }) =>
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
    expect(result.message.content).toContain("/stop");
    chatWithMistralGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    hasAgentStopAfter.mockReset();
  });

  it("stops between tool calls so a long research run cannot continue", async () => {
    chatWithMistralGateway.mockReset().mockImplementation(() =>
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
    chatWithMistralGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    hasAgentStopAfter.mockReset();
  });

  it("surfaces a disabled Telegram tool to the model", async () => {
    chatWithMistralGateway
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
    const toolMessage = lastToolResult(chatWithMistralGateway.mock.calls[1][1]);
    expect(toolMessage!.content).toContain("Telegram is not connected");
    expect(result.message.content).toBe("Connect Telegram in Settings first.");
  });

  it("streams reply chunks to onChunk as the model produces them", async () => {
    chatWithMistralGateway
      .mockImplementationOnce(async (owner, messages, options) => {
        options?.onChunk?.("Hello");
        options?.onChunk?.(" world");
        return chatResult({ text: "Hello world" });
      })
      .mockResolvedValueOnce(chatResult({ toolCalls: [endTurnCall("Hello world")] }));
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

  it("reports Mistral is unavailable when every retry fails", async () => {
    chatWithMistralGateway.mockRejectedValue(
      new MistralGatewayClientError("boom", "unavailable")
    );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(result.message.content).toContain("Mistral");
    expect(onChunk).toHaveBeenCalled();
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(3);
  });

  it("reports configuration error when the gateway is not configured", async () => {
    getMistralGatewayStatus.mockReturnValueOnce({
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
    expect(chatWithMistralGateway).not.toHaveBeenCalled();
  });

  it("reports unreachable gateway when health check fails", async () => {
    getMistralGatewayStatus.mockReturnValueOnce({
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
    expect(chatWithMistralGateway).not.toHaveBeenCalled();
  });

  it("reports allowance exhausted when request cap is reached", async () => {
    getMistralGatewayStatus.mockReturnValueOnce({
      configured: true,
      reachable: true,
      providerConfigured: true,
      providerConfigurationKnown: true,
      model: "mistral-medium-latest",
      allowance: {
        usedRequests: 50,
        maxRequests: 50,
        remainingRequests: 0,
        exhausted: true,
      },
    });
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("exhausted");
    expect(chatWithMistralGateway).not.toHaveBeenCalled();
  });

  it("returns the allowance message when the workspace cap is reached", async () => {
    chatWithMistralGateway.mockRejectedValueOnce(
      new MistralGatewayClientError("cap", "allowance_reached")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("allowance");
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
  });

  it("waits once and retries an upstream 429 instead of failing", async () => {
    chatWithMistralGateway
      .mockRejectedValueOnce(
        new MistralGatewayClientError("Too Many Requests", "rate_limit")
      )
      .mockResolvedValueOnce(chatResult({ text: "Back online - here is your answer." }))
      .mockResolvedValueOnce(chatResult({ toolCalls: [endTurnCall("Back online - here is your answer.")] }));
    const result = await runWorkspaceAgent(1, 3, "hello?");
    // One patient retry, then the reply, then the explicit end_turn round.
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(3);
    expect(result.message.content).toContain("Back online");
  });

  it("stops after one patient 429 retry and explains the lockout", async () => {
    chatWithMistralGateway
      .mockRejectedValueOnce(
        new MistralGatewayClientError("Too Many Requests", "rate_limit")
      )
      .mockRejectedValueOnce(
        new MistralGatewayClientError("Too Many Requests", "rate_limit")
      )
      .mockRejectedValueOnce(
        new MistralGatewayClientError("Too Many Requests", "rate_limit")
      );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    // The wait happens once per run, never as a fast-retry hammer.
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(2);
    expect(result.message.content).toContain("rate limit was hit");
    expect(result.message.content).toContain("lockouts can persist");
  });

  it("does not retry permanent client errors from the gateway", async () => {
    // Earlier tests leave queued mock rejections behind (clearAllMocks only
    // clears call history), so start from a clean slate like the other
    // error-path tests do.
    chatWithMistralGateway.mockReset().mockImplementation(endTurnEchoOnNudge);
    chatWithMistralGateway.mockRejectedValue(
      new MistralGatewayClientError("Model not found", "client_error")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    // A 4xx rejection cannot succeed by retrying, so the agent stops at once.
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("Mistral AI rejected this request");
  });

  it("skips the patient 429 retry when the run deadline cannot absorb the wait", async () => {
    chatWithMistralGateway.mockRejectedValue(
      new MistralGatewayClientError("Too Many Requests", "rate_limit")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?", {
      deadlineAtMs: Date.now() + 10_000,
    });
    // No time for the wait: fail immediately with the explanation.
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
    expect(result.message.content).toContain("rate limit was hit");
  });

  it("returns configuration message when the chat throws a configuration error", async () => {
    chatWithMistralGateway.mockRejectedValueOnce(
      new MistralGatewayClientError("no key", "configuration")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("not connected");
  });

  it("returns invalid-response message when every retry is invalid", async () => {
    chatWithMistralGateway.mockRejectedValue(
      new MistralGatewayClientError("bad", "invalid_response")
    );
    const result = await runWorkspaceAgent(1, 3, "hello?");
    expect(result.message.content).toContain("invalid response");
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(3);
  });

  it("recovers from a transient gateway failure by retrying the round", async () => {
    chatWithMistralGateway
      .mockRejectedValueOnce(
        new MistralGatewayClientError("blip", "unavailable")
      )
      .mockResolvedValueOnce(chatResult({ text: "All good." }))
      .mockResolvedValueOnce(chatResult({ toolCalls: [endTurnCall("All good.")] }));
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(3);
    expect(result.message.content).toBe("All good.");
    expect(onChunk).toHaveBeenCalledWith("All good.");
  });

  it("does not retry once text has already streamed to the client", async () => {
    // Simulate a mid-stream failure: a chunk reached the client, then the
    // gateway round aborted. Retrying would duplicate what the user saw.
    chatWithMistralGateway.mockImplementationOnce(
      async (owner, messages, options) => {
        options?.onChunk?.("Partial ");
        throw new MistralGatewayClientError("blip", "unavailable");
      }
    );
    const onChunk = vi.fn();
    const result = await runWorkspaceAgent(1, 3, "hello?", { onChunk });
    expect(chatWithMistralGateway).toHaveBeenCalledTimes(1);
    expect(onChunk).toHaveBeenCalledWith("Partial ");
    // The partial reply the user already watched is kept, with a note that the
    // gateway dropped - not replaced by a bare error notice.
    expect(result.message.content).toContain("Partial");
    expect(result.message.content).toContain("lost the connection");
    // The streamed partial is not re-emitted; only the failure note follows.
    const emitted = onChunk.mock.calls.map(call => call[0]).join("");
    expect(emitted).toBe("Partial " + "\n\nNova lost the connection to the inference gateway before this reply finished. Everything so far is saved - send another message and I will continue from here.");
  });

  it("keeps tool-narration text streamed in earlier rounds when the final round fails", async () => {
    // Round 1 streams "Checking your files" and requests a tool; round 2
    // fails with nothing streamed - the user still keeps what they watched.
    chatWithMistralGateway
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
        new MistralGatewayClientError("dead", "invalid_response")
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

  it("renames a default-titled chat from its first messages via Mistral AI", async () => {
    completeWithMistralGateway.mockResolvedValueOnce({
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
    expect(completeWithMistralGateway).not.toHaveBeenCalled();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it("does nothing before the first assistant reply", async () => {
    chatMessages.mockResolvedValueOnce([
      { id: 1, role: "user", content: "Help me plan a sprint." },
    ]);
    await autoTitleChatForUser(1, 3);
    expect(completeWithMistralGateway).not.toHaveBeenCalled();
  });

  it("strips wrapping quotes and newlines from the model title", async () => {
    completeWithMistralGateway.mockResolvedValueOnce({
      text: '"Sprint\nplanning ideas"',
    });
    await autoTitleChatForUser(1, 3);
    expect(renameChat).toHaveBeenCalledWith(1, 3, "Sprint", expect.any(Array));
  });

  it("does not rename when the Mistral title is missing", async () => {
    completeWithMistralGateway.mockResolvedValueOnce({ text: "" });
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
