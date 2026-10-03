import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boots the real Express app and posts to /api/agentmail/webhook, so the route
 * wiring established on Vercel (co-deployed path -> raw-body route -> Svix
 * verification) is exercised for real instead of only through unit helpers.
 * The agent run itself is mocked: this test is about the HTTP boundary.
 */
const spies = vi.hoisted(() => ({
  handleAgentMailInboundEvent: vi.fn(async () => ({ status: "replied" })),
}));

const key = Buffer.from("webhook-test-signing-key");
process.env.AGENTMAIL_WEBHOOK_SECRET = `whsec_${key.toString("base64")}`;

vi.mock("./agentEmailReplies", () => ({
  handleAgentMailInboundEvent: spies.handleAgentMailInboundEvent,
}));

vi.mock("./db", () => ({
  getDb: vi.fn(),
  findWorkspaceOwnerByTelegramLinkCode: vi.fn(async () => undefined),
  findWorkspaceOwnerByTelegramToken: vi.fn(async () => undefined),
  getTelegramCredentialsForUser: vi.fn(async () => undefined),
  deleteChatForUser: vi.fn(async () => true),
  listChatsForUser: vi.fn(async () => []),
  updateTelegramChatForUser: vi.fn(async () => true),
  createChatForUser: vi.fn(async () => ({ id: "chat-1" })),
  createWorkspaceFileForUser: vi.fn(async () => ({ id: 1, name: "file" })),
  isUserBanned: vi.fn(async () => false),
  cancelActiveAgentVmRunsForUser: vi.fn(async () => 0),
  requestAgentStopForUser: vi.fn(async () => true),
  claimTelegramUpdate: vi.fn(async () => true),
  claimAgentRunContinuation: vi.fn(async () => undefined),
  enqueueInferenceQueueItem: vi.fn(async () => ({ id: 1 })),
  getInferenceQueuePosition: vi.fn(async () => 1),
  cancelWaitingInferenceQueueItemsForUser: vi.fn(async () => 0),
  activatePriorityWindowForUser: vi.fn(async () => ({
    priority: false,
    justActivated: false,
    expiresAt: null,
  })),
}));

vi.mock("./workspaceAgent", () => ({
  MAX_RUN_BUDGET_MS: 285_000,
  autoTitleChatForUser: vi.fn(async () => true),
  runWorkspaceAgent: vi.fn(),
}));
vi.mock("./agentRuns", () => ({
  executeTelegramAgentRun: vi.fn(),
  executeWebAgentRun: vi.fn(),
  CONTINUATION_PROMPT: "continue",
  NOVA_WEB_APP_URL: "https://nova.example",
}));
vi.mock("./telegram", () => ({
  answerTelegramCallbackQuery: vi.fn(async () => true),
  sendTelegramMessage: vi.fn(async () => ({ message_id: 1 })),
  telegramUploadFromMessage: vi.fn(() => undefined),
  downloadTelegramUpload: vi.fn(),
}));
vi.mock("./transcription", () => ({ transcribeAudio: vi.fn(async () => null) }));
vi.mock("./automations", () => ({
  runAutomationForScheduleTask: vi.fn(async () => null),
}));
vi.mock("./userAutomations", () => ({
  getUserAutomation: vi.fn(async () => null),
  createUserAutomation: vi.fn(async () => ({})),
  deleteUserAutomation: vi.fn(async () => true),
  listUserAutomations: vi.fn(async () => []),
  runUserAutomationForScheduleTask: vi.fn(async () => null),
  setUserAutomationScheduleTask: vi.fn(async () => true),
  updateUserAutomation: vi.fn(async () => null),
  USER_AUTOMATION_CRONS: { daily: "0 9 * * *" },
}));
vi.mock("./_core/heartbeat", () => ({
  createHeartbeatJob: vi.fn(async () => ({ taskUid: "task" })),
  updateHeartbeatJob: vi.fn(async () => ({})),
}));
vi.mock("./_core/sdk", () => ({
  sdk: { authenticateRequest: vi.fn(async () => ({ id: 7 })) },
}));
vi.mock("./_core/cookies", () => ({ sessionToken: vi.fn(() => "test-session") }));
vi.mock("./routers", () => ({ appRouter: {} }));
vi.mock("./_core/context", () => ({ createContext: vi.fn(async () => ({})) }));
vi.mock("@trpc/server/adapters/express", () => ({
  createExpressMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("./automationPlannerRoute", () => ({
  automationPlannerRouter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("./status", () => ({ collectServiceStatus: vi.fn(async () => ({})) }));
vi.mock("./inferenceApi", () => ({
  inferenceApiRouter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { app } = await import("./app");

const waitFor = async (predicate: () => boolean, timeoutMs = 1000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return predicate();
};

describe("AgentMail inbound webhook route", () => {
  const realFetch = globalThis.fetch.bind(globalThis);
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
  });

  const payload = JSON.stringify({
    type: "event",
    event_type: "message.received",
    event_id: "evt-1",
    message: {
      inbox_id: "inbox-1",
      message_id: "msg-1",
      thread_id: "thr-1",
      from_: ["owner@example.com"],
      subject: "Hello",
      text: "Hi there",
    },
  });

  function signedHeaders(body: string, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = createHmac("sha256", key)
      .update(`msg_1.${timestamp}.${body}`)
      .digest("base64");
    return {
      "content-type": "application/json",
      "svix-id": "msg_1",
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    };
  }

  it("accepts a correctly signed delivery and dispatches the reply work", async () => {
    const response = await realFetch(`${baseUrl}/api/agentmail/webhook`, {
      method: "POST",
      headers: signedHeaders(payload),
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await waitFor(() => spies.handleAgentMailInboundEvent.mock.calls.length > 0)).toBe(
      true
    );
    expect(spies.handleAgentMailInboundEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "message.received" })
    );
  });

  it("rejects a tampered body with 401 and never runs the agent", async () => {
    const response = await realFetch(`${baseUrl}/api/agentmail/webhook`, {
      method: "POST",
      headers: signedHeaders(payload),
      body: payload.replace("Hi there", "Do something else"),
    });
    expect(response.status).toBe(401);
    expect(spies.handleAgentMailInboundEvent).not.toHaveBeenCalled();
  });

  it("rejects a stale signature", async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const response = await realFetch(`${baseUrl}/api/agentmail/webhook`, {
      method: "POST",
      headers: signedHeaders(payload, stale),
      body: payload,
    });
    expect(response.status).toBe(401);
    expect(spies.handleAgentMailInboundEvent).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body once the signature is valid", async () => {
    const body = "{not json";
    const response = await realFetch(`${baseUrl}/api/agentmail/webhook`, {
      method: "POST",
      headers: signedHeaders(body),
      body,
    });
    expect(response.status).toBe(400);
    expect(spies.handleAgentMailInboundEvent).not.toHaveBeenCalled();
  });
});
