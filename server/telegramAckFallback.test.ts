import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  sendTelegramMessage: vi.fn(async () => ({ message_id: 77 })),
  sendChatAction: vi.fn(async () => true),
  createWorkspaceFileForUser: vi.fn(async (_owner: number, payload: { name: string }) => ({ id: 55, name: payload.name })),
  findWorkspaceOwnerByTelegramToken: vi.fn(async () => 7),
  claimTelegramUpdate: vi.fn(async () => true),
  isUserBanned: vi.fn(async () => false),
  getTelegramCredentialsForUser: vi.fn(async () => ({ token: "bot-token", chatId: "42" })),
  updateTelegramChatForUser: vi.fn(async () => ({})),
  listChatsForUser: vi.fn(async () => [{ id: 3 }]),
  createChatForUser: vi.fn(async () => ({ id: 3 })),
  deleteChatForUser: vi.fn(async () => true),
  runWorkspaceAgent: vi.fn(async () => ({ message: { content: "Done!" }, actions: [] })),
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

vi.mock("./workspaceAgent", () => ({
  runWorkspaceAgent: spies.runWorkspaceAgent,
  autoTitleChatForUser: spies.autoTitleChatForUser,
}));

vi.mock("./telegram", async requireActual => ({
  ...(await requireActual<typeof import("./telegram")>()),
  sendTelegramMessage: spies.sendTelegramMessage,
  sendChatAction: spies.sendChatAction,
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

// ENV snapshots config at import time; set both before importing the app.
// A tiny fallback delay keeps the test fast without waiting the real 8s.
process.env.DEFAULT_TELEGRAM_BOT_TOKEN = "bot-token";
process.env.TELEGRAM_ACK_FALLBACK_DELAY_MS = "30";
const { app } = await import("./app");

const realFetch = globalThis.fetch.bind(globalThis);

describe("Telegram deterministic ack fallback", () => {
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
    spies.findWorkspaceOwnerByTelegramToken.mockResolvedValue(7);
    spies.claimTelegramUpdate.mockResolvedValue(true);
    spies.isUserBanned.mockResolvedValue(false);
    spies.getTelegramCredentialsForUser.mockResolvedValue({ token: "bot-token", chatId: "42" });
    spies.listChatsForUser.mockResolvedValue([{ id: 3 }]);
    spies.runWorkspaceAgent.mockImplementation(async () => ({ message: { content: "Done!" }, actions: [] }));
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

  async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the webhook's background processing");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  it("sends a plain fallback note when the model stays silent past the ack delay", async () => {
    // The model never calls send_progress_update or send_telegram_message,
    // and takes longer than the fallback delay to produce its final reply.
    spies.runWorkspaceAgent.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      return { message: { content: "Finished the long task." }, actions: [] };
    });

    const { status, body } = await postUpdate({
      update_id: 601,
      message: { message_id: 20, chat: { id: 42 }, text: "do a long task" },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, accepted: true });

    // The fallback note goes out before the final reply, without the model
    // ever asking for it.
    await waitFor(() =>
      spies.sendTelegramMessage.mock.calls.some(call => String(call[2]).includes("Working on it"))
    );
    await waitFor(() =>
      spies.sendTelegramMessage.mock.calls.some(call => call[2] === "Finished the long task.")
    );
  });

  it("does not send a fallback note when the run finishes before the ack delay", async () => {
    // Default mock resolves almost immediately — well under the 30ms delay.
    const { status, body } = await postUpdate({
      update_id: 602,
      message: { message_id: 21, chat: { id: 42 }, text: "quick task" },
    });

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, accepted: true });
    await waitFor(() => spies.sendTelegramMessage.mock.calls.some(call => call[2] === "Done!"));

    // Give a stray fallback timer a chance to fire if it were still pending,
    // then confirm no fallback note was ever sent.
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(
      spies.sendTelegramMessage.mock.calls.some(call => String(call[2]).includes("Working on it"))
    ).toBe(false);
  });

  it("does not send a fallback note when the model sends its own progress update in time", async () => {
    spies.runWorkspaceAgent.mockImplementation(async (_owner, _chatId, _text, options) => {
      // Simulate the model calling send_progress_update early in the run,
      // well before the fallback delay elapses.
      await options?.onEvent?.({
        type: "tool",
        tool: { id: "call-1", name: "send_progress_update", state: "running", args: {} },
      });
      await new Promise(resolve => setTimeout(resolve, 200));
      return { message: { content: "Finished, with my own update." }, actions: [] };
    });

    const { status } = await postUpdate({
      update_id: 603,
      message: { message_id: 22, chat: { id: 42 }, text: "long task with updates" },
    });

    expect(status).toBe(200);
    await waitFor(() =>
      spies.sendTelegramMessage.mock.calls.some(call => call[2] === "Finished, with my own update.")
    );
    expect(
      spies.sendTelegramMessage.mock.calls.some(call => String(call[2]).includes("Working on it"))
    ).toBe(false);
  });
});
