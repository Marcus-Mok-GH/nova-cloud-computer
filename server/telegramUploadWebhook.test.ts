import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(async () => ({ message_id: 77 })),
  sendChatAction: vi.fn(async () => true),
  presentTelegramFile: vi.fn(async () => ({ messageId: 78, as: "document" })),
  createWorkspaceFileForUser: vi.fn(async (_owner: number, payload: { name: string }) => ({ id: 55, name: payload.name })),
  findWorkspaceOwnerByTelegramToken: vi.fn(async () => 7),
  claimTelegramUpdate: vi.fn(async () => true),
  isUserBanned: vi.fn(async () => false),
  getTelegramCredentialsForUser: vi.fn(async () => ({ token: "bot-token", chatId: "42" })),
  updateTelegramChatForUser: vi.fn(async () => ({})),
  listChatsForUser: vi.fn(async () => [{ id: 3 }]),
  createChatForUser: vi.fn(async () => ({ id: 3 })),
  deleteChatForUser: vi.fn(async () => true),
  runWorkspaceAgent: vi.fn(async () => ({ message: { content: "It's a corgi!" }, actions: [] })),
  transcribeAudio: vi.fn(async () => null),
  autoTitleChatForUser: vi.fn(async () => true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
  findWorkspaceOwnerByTelegramLinkCode: vi.fn(async () => null),
  findWorkspaceOwnerByTelegramToken: spies.findWorkspaceOwnerByTelegramToken,
  getTelegramCredentialsForUser: spies.getTelegramCredentialsForUser,
  deleteChatForUser: spies.deleteChatForUser,
  listChatsForUser: spies.listChatsForUser,
  updateTelegramChatForUser: spies.updateTelegramChatForUser,
  createChatForUser: spies.createChatForUser,
  createWorkspaceFileForUser: spies.createWorkspaceFileForUser,
  isUserBanned: spies.isUserBanned,
  cancelActiveAgentVmRunsForUser: vi.fn(async () => 0),
  requestAgentStopForUser: vi.fn(async () => true),
  claimTelegramUpdate: spies.claimTelegramUpdate,
}));

vi.mock("./transcription", () => ({ transcribeAudio: spies.transcribeAudio }));
vi.mock("./workspaceAgent", () => ({
  MAX_RUN_BUDGET_MS: 285_000,
  runWorkspaceAgent: spies.runWorkspaceAgent,
  autoTitleChatForUser: spies.autoTitleChatForUser,
}));

vi.mock("./telegram", async requireActual => ({
  ...(await requireActual<typeof import("./telegram")>()),
  sendTelegramMessage: spies.sendTelegramMessage,
  sendChatAction: spies.sendChatAction,
  presentTelegramFile: spies.presentTelegramFile,
}));

vi.mock("./automations", () => ({ runAutomationForScheduleTask: vi.fn(async () => null) }));
vi.mock("./userAutomations", () => ({
  getUserAutomation: vi.fn(async () => null),
  createUserAutomation: vi.fn(async () => ({})),
  deleteUserAutomation: vi.fn(async () => true),
  listUserAutomations: vi.fn(async () => []),
  runUserAutomationForScheduleTask: vi.fn(async () => null),
  setUserAutomationScheduleTask: vi.fn(async () => true),
  updateUserAutomation: vi.fn(async () => null),
  USER_AUTOMATION_CRONS: { daily: "0 9 * * *", weekly: "0 9 * * 1" },
}));
vi.mock("./_core/heartbeat", () => ({
  createHeartbeatJob: vi.fn(async () => ({ taskUid: "task" })),
  updateHeartbeatJob: vi.fn(async () => ({})),
}));
vi.mock("./_core/sdk", () => ({ sdk: { authenticateRequest: vi.fn(async () => null) } }));
vi.mock("./_core/cookies", () => ({ sessionToken: vi.fn(() => "test-session") }));
vi.mock("./routers", () => ({ appRouter: {} }));
vi.mock("./_core/context", () => ({ createContext: vi.fn(async () => ({})) }));
vi.mock("@trpc/server/adapters/express", () => ({ createExpressMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
vi.mock("./automationPlannerRoute", () => ({ automationPlannerRouter: (_req: unknown, _res: unknown, next: () => void) => next() }));

// ENV snapshots the default-bot token at import time; set it before importing the app.
process.env.DEFAULT_TELEGRAM_BOT_TOKEN = "bot-token";
const { app } = await import("./app");

const realFetch = globalThis.fetch.bind(globalThis);

describe("Telegram upload webhook (full handler)", () => {
  const originalFetch = globalThis.fetch;
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default owner resolution + duplicate-claim acceptance; individual cases override.
    spies.findWorkspaceOwnerByTelegramToken.mockResolvedValue(7);
    spies.claimTelegramUpdate.mockResolvedValue(true);
    spies.isUserBanned.mockResolvedValue(false);
    spies.getTelegramCredentialsForUser.mockResolvedValue({ token: "bot-token", chatId: "42" });
    spies.listChatsForUser.mockResolvedValue([{ id: 3 }]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function postUpdate(update: unknown, token = "bot-token") {
    const response = await realFetch(`${baseUrl}/api/telegram/webhook/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(update),
    });
    return { status: response.status, body: await response.json().catch(() => undefined) };
  }

  // The webhook acknowledges instantly and processes the update in the
  // background, so tests poll for the side effects instead of the response.
  async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the webhook's background processing");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  it("saves an uploaded photo, attaches it as vision input, and replies in chat", async () => {
    // Telegram API: getFile for the download path, then the file bytes.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile"))
        return new Response(JSON.stringify({ ok: true, result: { file_path: "photos/big.jpg" } }), { status: 200 });
      if (url.includes("/file/bot"))
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { status, body } = await postUpdate({
      update_id: 501,
      message: {
        message_id: 10,
        chat: { id: 42 },
        photo: [
          { file_id: "small", file_size: 100 },
          { file_id: "big", file_size: 900 },
        ],
        caption: "what breed is this dog?",
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, accepted: true });
    await waitFor(() => spies.sendTelegramMessage.mock.calls.some(call => call[2] === "It's a corgi!"));

    // The largest photo size was downloaded from Telegram.
    const getFileCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      call => String(call[0]).includes("/getFile")
    );
    expect(getFileCall).toBeTruthy();
    expect(String((getFileCall as unknown[])[1]?.body)).toContain("big");

    // Saved into the workspace as a decodable JPEG data URI.
    expect(spies.createWorkspaceFileForUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        name: expect.stringMatching(/^photo-\d+\.jpg$/),
        mimeType: "image/jpeg",
        content: expect.stringMatching(/^data:image\/jpeg;base64,/),
      })
    );

    // The agent turn carries the caption, an attachment note, and the image as vision input.
    const [ownerId, chatId, agentContent, options] = spies.runWorkspaceAgent.mock.calls[0];
    expect(ownerId).toBe(7);
    expect(chatId).toBe(3);
    expect(agentContent).toContain("what breed is this dog?");
    expect(agentContent).toContain("Attachment: the user uploaded");
    expect(agentContent).toContain("you can see it directly");
    expect(agentContent).toContain("file id 55");
    expect(options).toMatchObject({ channel: "telegram" });
    expect(options.imageAttachments).toEqual([
      expect.stringMatching(/^data:image\/jpeg;base64,/),
    ]);

    // The agent's reply reached the Telegram chat.
    expect(spies.sendTelegramMessage).toHaveBeenCalledWith("bot-token", "42", "It's a corgi!");
  });

  it("routes a text file upload to read_file without image attachments", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile"))
        return new Response(JSON.stringify({ ok: true, result: { file_path: "documents/notes.txt" } }), { status: 200 });
      if (url.includes("/file/bot")) return new Response("shopping list", { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { status } = await postUpdate({
      update_id: 502,
      message: {
        message_id: 11,
        chat: { id: 42 },
        document: { file_id: "doc1", file_name: "notes.txt", mime_type: "text/plain", file_size: 13 },
      },
    });

    expect(status).toBe(200);
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.length >= 1);
    expect(spies.createWorkspaceFileForUser).toHaveBeenCalledWith(7, {
      name: "notes.txt",
      content: "shopping list",
      mimeType: "text/plain",
    });
    const [, , agentContent, options] = spies.runWorkspaceAgent.mock.calls[0];
    expect(agentContent).toContain("Uploaded notes.txt");
    expect(agentContent).toContain("Read its contents with read_file");
    expect(options.imageAttachments).toBeUndefined();
  });

  it("points binary uploads at a VM decode and tells the agent when saving fails", async () => {
    // First: a PDF that saves fine. Second: a download that fails.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile"))
        return new Response(JSON.stringify({ ok: true, result: { file_path: "docs/report.pdf" } }), { status: 200 });
      if (url.includes("/file/bot")) return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    await postUpdate({
      update_id: 503,
      message: {
        message_id: 12,
        chat: { id: 42 },
        document: { file_id: "pdf1", file_name: "report.pdf", mime_type: "application/pdf" },
      },
    });
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.length >= 1);

    let [, , agentContent] = spies.runWorkspaceAgent.mock.calls[0];
    expect(agentContent).toContain("run_vm_task");
    expect(agentContent).toContain("base64");

    // A failed download must not fail the request: the model is told to explain.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile"))
        return new Response(JSON.stringify({ ok: false, description: "Bad Request: file is too big" }), { status: 400 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { status } = await postUpdate({
      update_id: 504,
      message: {
        message_id: 13,
        chat: { id: 42 },
        document: { file_id: "pdf2", file_name: "huge.pdf", mime_type: "application/pdf" },
      },
    });

    expect(status).toBe(200);
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.length >= 2);
    expect(spies.createWorkspaceFileForUser).toHaveBeenCalledTimes(1);
    [, , agentContent] = spies.runWorkspaceAgent.mock.calls[1];
    expect(agentContent).toContain("saving it to the workspace failed");
    expect(agentContent).toContain("file is too big");
  });

  it("routes /models to the agent instead of revealing model ids or providers", async () => {
    const { status, body } = await postUpdate({
      update_id: 506,
      message: {
        message_id: 15,
        chat: { id: 42 },
        text: "/models",
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, accepted: true });
    await waitFor(() => spies.sendTelegramMessage.mock.calls.some(call => call[2] === "It's a corgi!"));
    expect(spies.runWorkspaceAgent).toHaveBeenCalledTimes(1);
    // The only Telegram message is the agent's own reply - no model list.
    expect(spies.sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(spies.sendTelegramMessage).toHaveBeenCalledWith("bot-token", "42", "It's a corgi!");
    const sent = spies.sendTelegramMessage.mock.calls[0][2] as string;
    expect(sent).not.toMatch(/moonshotai|nvidia|kimi|nemotron/i);
  });

  it("processes /stop while an agent run is still in flight", async () => {
    let resolveRun!: (value: { message: { content: string }; actions: unknown[] }) => void;
    spies.runWorkspaceAgent.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRun = resolve;
        })
    );

    await postUpdate({
      update_id: 507,
      message: { message_id: 16, chat: { id: 42 }, text: "write a very long essay" },
    });
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.length >= 1);

    // The run is still pending, yet /stop is handled right away.
    await postUpdate({
      update_id: 508,
      message: { message_id: 17, chat: { id: 42 }, text: "/stop" },
    });
    await waitFor(() =>
      spies.sendTelegramMessage.mock.calls.some(call =>
        String(call[2]).includes("Stopping all running agent processes")
      )
    );
    const { requestAgentStopForUser } = await import("./db");
    expect(requestAgentStopForUser).toHaveBeenCalledWith(7);
    expect(spies.runWorkspaceAgent).toHaveBeenCalledTimes(1);

    resolveRun({ message: { content: "the essay anyway" }, actions: [] });
    await waitFor(() => spies.sendTelegramMessage.mock.calls.some(call => call[2] === "the essay anyway"));
    // Restore the default implementation: clearAllMocks does not reset
    // mockImplementation, and a deferred impl leaks into later tests.
    spies.runWorkspaceAgent.mockImplementation(async () => ({ message: { content: "It's a corgi!" }, actions: [] }));
  });

  it("binds the background agent run to the invocation with waitUntil (Vercel freeze regression)", async () => {
    // Regression: on Vercel, a plain `void` promise froze with the instance the
    // moment the ack response was sent, and replies only landed when unrelated
    // traffic later thawed the same container. The handler must hand its
    // background work to the runtime's request context instead.
    spies.runWorkspaceAgent.mockImplementation(async () => ({ message: { content: "It's a corgi!" }, actions: [] }));
    const requestContextSymbol = Symbol.for("@vercel/request-context");
    const tracked: Promise<unknown>[] = [];
    const originalContext = (globalThis as Record<symbol, unknown>)[requestContextSymbol];
    (globalThis as Record<symbol, unknown>)[requestContextSymbol] = {
      get: () => ({ waitUntil: (promise: Promise<unknown>) => { tracked.push(promise); } }),
    };
    try {
      const { status, body } = await postUpdate({
        update_id: 506,
        message: { message_id: 15, chat: { id: 42 }, text: "bind me" },
      });
      expect(status).toBe(200);
      expect(body).toEqual({ ok: true, accepted: true });
      expect(tracked.length).toBeGreaterThanOrEqual(1);
      // Every tracked promise must settle (the wrapped work plus side tasks).
      await Promise.all(tracked.map(promise => promise.then(() => {}, () => {})));
    } finally {
      if (originalContext === undefined) Reflect.deleteProperty(globalThis, requestContextSymbol as symbol);
      else (globalThis as Record<symbol, unknown>)[requestContextSymbol] = originalContext;
    }
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.some(call => call[2] === "bind me"));
    await waitFor(() => spies.sendTelegramMessage.mock.calls.some(call => call[2] === "It's a corgi!"));
  });

  it("still rejects uploads from chats that are not linked", async () => {
    spies.findWorkspaceOwnerByTelegramToken.mockResolvedValue(null);

    const { status, body } = await postUpdate({
      update_id: 505,
      message: {
        message_id: 14,
        chat: { id: 999 },
        photo: [{ file_id: "stray", file_size: 50 }],
      },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, accepted: true });
    await waitFor(() => spies.sendTelegramMessage.mock.calls.some(call => String(call[2]).includes("not yet linked")));
    expect(spies.createWorkspaceFileForUser).not.toHaveBeenCalled();
    expect(spies.runWorkspaceAgent).not.toHaveBeenCalled();
    expect(spies.sendTelegramMessage).toHaveBeenCalledWith("bot-token", "999", expect.stringContaining("not yet linked"));
  });

  it("transcribes a voice note and hands the transcript to the agent as the user's turn", async () => {
    spies.transcribeAudio.mockResolvedValue("remind me to water the plants at 6pm");
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile"))
        return new Response(JSON.stringify({ ok: true, result: { file_path: "voice/note.ogg" } }), { status: 200 });
      if (url.includes("/file/bot"))
        return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { status } = await postUpdate({
      update_id: 506,
      message: {
        message_id: 15,
        chat: { id: 42 },
        voice: { file_id: "voice-1", mime_type: "audio/ogg", duration: 4 },
      },
    });
    expect(status).toBe(200);
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.length > 0);

    // The saved audio was decoded and sent to the transcription provider.
    const [bytes, mimeType, fileName] = spies.transcribeAudio.mock.calls[0] as [Buffer, string, string];
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(mimeType).toBe("audio/ogg");
    expect(String(fileName)).toMatch(/\.ogg$/);

    // The transcript became the user's turn, with a voice-note context line.
    const [, , agentContent] = spies.runWorkspaceAgent.mock.calls[0] as [number, number, string, unknown];
    expect(agentContent.startsWith("remind me to water the plants at 6pm")).toBe(true);
    expect(agentContent).toContain("voice message");
  });

  it("tells the model to ask the user to type when transcription is not configured", async () => {
    spies.transcribeAudio.mockResolvedValue(null);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/getFile"))
        return new Response(JSON.stringify({ ok: true, result: { file_path: "voice/note.ogg" } }), { status: 200 });
      if (url.includes("/file/bot"))
        return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    await postUpdate({
      update_id: 507,
      message: {
        message_id: 16,
        chat: { id: 42 },
        voice: { file_id: "voice-2", mime_type: "audio/ogg", duration: 4 },
      },
    });
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.length > 0);

    const [, , agentContent] = spies.runWorkspaceAgent.mock.calls[0] as [number, number, string, unknown];
    expect(agentContent).toContain("TRANSCRIPTION_API_KEY");
    expect(agentContent).toContain("voice message");
  });
});
