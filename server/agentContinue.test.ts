import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const spies = vi.hoisted(() => ({
  findWorkspaceOwnerByTelegramToken: vi.fn(async () => 7),
  claimTelegramUpdate: vi.fn(async () => true),
  isUserBanned: vi.fn(async () => false),
  getTelegramCredentialsForUser: vi.fn(async () => ({ token: "bot-token", chatId: "42" })),
  listChatsForUser: vi.fn(async () => [{ id: 3 }]),
  sendTelegramMessage: vi.fn(async () => ({ message_id: 77 })),
  sendChatAction: vi.fn(async () => true),
  startAgentRunForUser: vi.fn(async () => ({ id: 501, segment: 0 })),
  finishAgentRunForUser: vi.fn(async () => ({})),
  holdAgentRunForContinue: vi.fn(async () => ({ id: 501, segment: 0 })),
  claimAgentRunContinuation: vi.fn(async () => ({
    runId: 501,
    segment: 1,
    chatId: 3,
    ownerId: 7,
    token: "bot-token",
    telegramChatId: "42",
  })),
  runWorkspaceAgent: vi.fn(async () => ({ message: { content: "It's a corgi!" }, actions: [], outOfBudget: false })),
  autoTitleChatForUser: vi.fn(async () => true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
  findWorkspaceOwnerByTelegramLinkCode: vi.fn(async () => null),
  findWorkspaceOwnerByTelegramToken: spies.findWorkspaceOwnerByTelegramToken,
  getTelegramCredentialsForUser: spies.getTelegramCredentialsForUser,
  deleteChatForUser: vi.fn(async () => true),
  listChatsForUser: spies.listChatsForUser,
  updateTelegramChatForUser: vi.fn(async () => ({})),
  createChatForUser: vi.fn(async () => ({ id: 3 })),
  createWorkspaceFileForUser: vi.fn(async () => ({})),
  isUserBanned: spies.isUserBanned,
  cancelActiveAgentVmRunsForUser: vi.fn(async () => 0),
  requestAgentStopForUser: vi.fn(async () => true),
  claimTelegramUpdate: spies.claimTelegramUpdate,
  startAgentRunForUser: spies.startAgentRunForUser,
  finishAgentRunForUser: spies.finishAgentRunForUser,
  holdAgentRunForContinue: spies.holdAgentRunForContinue,
  claimAgentRunContinuation: spies.claimAgentRunContinuation,
  MAX_RUN_SEGMENTS: 4,
}));

vi.mock("./workspaceAgent", () => ({
  MAX_RUN_BUDGET_MS: 285_000,
  runWorkspaceAgent: spies.runWorkspaceAgent,
  autoTitleChatForUser: spies.autoTitleChatForUser,
}));

vi.mock("./telegram", async requireActual => ({
  ...(await requireActual<typeof import("./telegram")>()),
  sendTelegramMessage: spies.sendTelegramMessage,
  sendChatAction: spies.sendChatAction,
  presentTelegramFile: vi.fn(async () => ({ messageId: 78, as: "document" })),
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

process.env.DEFAULT_TELEGRAM_BOT_TOKEN = "bot-token";
process.env.AGENT_CONTINUE_SECRET = "test-continue-secret";
const { app } = await import("./app");

const realFetch = globalThis.fetch.bind(globalThis);

const CONTINUATION_PROMPT = "Continue the task in this conversation from where the previous segment left off. That segment ran out of its execution budget; finish the remaining work and deliver the result.";

const signedPost = (baseUrl: string, body: unknown, secret = "test-continue-secret") => {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return fetch(`${baseUrl}/api/agent/continue`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nova-signature": signature },
    body: raw,
  });
};

const waitFor = async (predicate: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return predicate();
};

describe("Agent continuation endpoint", () => {
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
    spies.claimAgentRunContinuation.mockResolvedValue({
      runId: 501,
      segment: 1,
      chatId: 3,
      ownerId: 7,
      token: "bot-token",
      telegramChatId: "42",
    });
  });

  it("rejects unsigned requests", async () => {
    const response = await fetch(`${baseUrl}/api/agent/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: 501, segment: 0 }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const response = await signedPost(baseUrl, { runId: 501, segment: 0 }, "wrong-secret");
    expect(response.status).toBe(401);
  });

  it("rejects tampered payloads (signature over different bytes)", async () => {
    const raw = JSON.stringify({ runId: 501, segment: 0 });
    const signature = `sha256=${createHmac("sha256", "test-continue-secret").update(JSON.stringify({ runId: 502, segment: 0 })).digest("hex")}`;
    const response = await fetch(`${baseUrl}/api/agent/continue`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nova-signature": signature },
      body: raw,
    });
    expect(response.status).toBe(401);
  });

  it("rejects malformed payloads under a valid signature", async () => {
    const response = await signedPost(baseUrl, { runId: -1 });
    expect(response.status).toBe(400);
  });

  it("answers 409 when the segment claim loses", async () => {
    spies.claimAgentRunContinuation.mockResolvedValueOnce(undefined);
    const response = await signedPost(baseUrl, { runId: 501, segment: 0 });
    expect(response.status).toBe(409);
    expect(spies.claimAgentRunContinuation).toHaveBeenCalledWith(501, 0);
  });

  it("claims the segment, acks, and runs the continuation through the same runner", async () => {
    const response = await signedPost(baseUrl, { runId: 501, segment: 0 });
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toEqual({ ok: true, runId: 501, segment: 1 });
    await waitFor(() => spies.runWorkspaceAgent.mock.calls.length > 0);
    expect(spies.runWorkspaceAgent).toHaveBeenCalledWith(
      7,
      3,
      CONTINUATION_PROMPT,
      expect.objectContaining({ channel: "telegram", continuationPlanned: true })
    );
    await waitFor(() => spies.sendTelegramMessage.mock.calls.some(call => call[2] === "It's a corgi!"));
    expect(spies.autoTitleChatForUser).not.toHaveBeenCalled();
    expect(spies.startAgentRunForUser).not.toHaveBeenCalled();
    expect(spies.finishAgentRunForUser).toHaveBeenCalledWith(7, 501, "completed", undefined);
  });
});

describe("Segment chaining inside the runner", () => {
  let server: ReturnType<typeof app.listen>;
  let baseUrl: string;
  let continuationFetches: Array<{ url: string; body: string; signature: string }>;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port");
    baseUrl = `http://127.0.0.1:${address.port}`;
    continuationFetches = [];
    globalThis.fetch = vi.fn(async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
      if (String(url).includes("/api/agent/continue")) {
        continuationFetches.push({ url: String(url), body: String(init?.body), signature: String(init?.headers?.["x-nova-signature"] ?? "") });
        return new Response(JSON.stringify({ ok: true }), { status: 202 });
      }
      return realFetch(url as string, init as RequestInit | undefined);
    }) as unknown as typeof fetch;
  });

  afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = realFetch as unknown as typeof fetch;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    continuationFetches.length = 0;
    spies.findWorkspaceOwnerByTelegramToken.mockResolvedValue(7);
    spies.claimTelegramUpdate.mockResolvedValue(true);
    spies.isUserBanned.mockResolvedValue(false);
    spies.getTelegramCredentialsForUser.mockResolvedValue({ token: "bot-token", chatId: "42" });
    spies.listChatsForUser.mockResolvedValue([{ id: 3 }]);
    spies.holdAgentRunForContinue.mockResolvedValue({ id: 501, segment: 0 });
  });

  const postUpdate = (body: unknown) =>
    fetch(`${baseUrl}/api/telegram/webhook/bot-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("schedules a signed continuation when the segment runs out of budget", async () => {
    spies.runWorkspaceAgent.mockResolvedValueOnce({ message: { content: "Ran out of time, resuming shortly." }, actions: [], outOfBudget: true });
    const response = await postUpdate({
      update_id: 700,
      message: { message_id: 30, chat: { id: 42 }, text: "build me a report" },
    });
    expect(response.status).toBe(200);
    await waitFor(() => continuationFetches.length > 0);
    expect(continuationFetches.length).toBe(1);
    const call = continuationFetches[0];
    expect(call.url).toContain("/api/agent/continue");
    expect(JSON.parse(call.body)).toEqual({ runId: 501, segment: 0 });
    const expected = `sha256=${createHmac("sha256", "test-continue-secret").update(call.body).digest("hex")}`;
    expect(call.signature).toBe(expected);
    // The row waits for its claim instead of closing completed.
    expect(spies.holdAgentRunForContinue).toHaveBeenCalledWith(7, 501);
    expect(spies.finishAgentRunForUser).not.toHaveBeenCalledWith(7, 501, "completed", undefined);
  });

  it("closes the run completed when the continuation self-call fails", async () => {
    spies.runWorkspaceAgent.mockResolvedValueOnce({ message: { content: "Ran out of time." }, actions: [], outOfBudget: true });
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) =>
      String(url).includes("/api/agent/continue")
        ? new Response("no dice", { status: 500 })
        : realFetch(url as string, init)
    ) as unknown as typeof fetch;
    try {
      const response = await postUpdate({
        update_id: 701,
        message: { message_id: 31, chat: { id: 42 }, text: "long job" },
      });
      expect(response.status).toBe(200);
      await waitFor(() => spies.finishAgentRunForUser.mock.calls.some(call => call[2] === "completed"));
      const closeCall = spies.finishAgentRunForUser.mock.calls.find(call => call[2] === "completed");
      expect(closeCall?.[0]).toBe(7);
      expect(closeCall?.[1]).toBe(501);
      // The closing status assumed an automatic continuation was coming; when
      // scheduling fails the user must be told to resume manually.
      // waitFor returns (rather than throws) its final predicate result, so
      // asserting on it keeps this test honest if the fallback never lands.
      expect(
        await waitFor(() =>
          spies.sendTelegramMessage.mock.calls.some(call =>
            typeof call[2] === "string" && call[2].includes('Send "continue"')
          )
        )
      ).toBe(true);
    } finally {
      globalThis.fetch = vi.fn(async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
        if (String(url).includes("/api/agent/continue")) {
          continuationFetches.push({ url: String(url), body: String(init?.body), signature: String(init?.headers?.["x-nova-signature"] ?? "") });
          return new Response(JSON.stringify({ ok: true }), { status: 202 });
        }
        return realFetch(url as string, init as RequestInit | undefined);
      }) as unknown as typeof fetch;
    }
  });

  it("does not chain past the last allowed segment", async () => {
    spies.runWorkspaceAgent.mockResolvedValue({ message: { content: "Still working." }, actions: [], outOfBudget: true });
    spies.claimAgentRunContinuation.mockResolvedValue({
      runId: 501,
      segment: 3,
      chatId: 3,
      ownerId: 7,
      token: "bot-token",
      telegramChatId: "42",
    });
    // the describe-level stub would fake the endpoint's own response.
    globalThis.fetch = realFetch as unknown as typeof fetch;
    try {
      const response = await signedPost(baseUrl, { runId: 501, segment: 2 });
      expect(response.status).toBe(202);
      await waitFor(() => spies.finishAgentRunForUser.mock.calls.some(call => call[2] === "completed"));
      // Segment 3 is MAX_RUN_SEGMENTS - 1: the chain must stop there.
      expect(spies.holdAgentRunForContinue).not.toHaveBeenCalled();
      expect(continuationFetches.length).toBe(0);
      const closeCall = spies.finishAgentRunForUser.mock.calls.find(call => call[2] === "completed");
      expect(closeCall?.[0]).toBe(7);
      expect(closeCall?.[1]).toBe(501);
    } finally {
      globalThis.fetch = vi.fn(async (url: unknown, init?: { headers?: Record<string, string>; body?: string }) => {
        if (String(url).includes("/api/agent/continue")) {
          continuationFetches.push({ url: String(url), body: String(init?.body), signature: String(init?.headers?.["x-nova-signature"] ?? "") });
          return new Response(JSON.stringify({ ok: true }), { status: 202 });
        }
        return realFetch(url as string, init as RequestInit | undefined);
      }) as unknown as typeof fetch;
    }
  });
});
