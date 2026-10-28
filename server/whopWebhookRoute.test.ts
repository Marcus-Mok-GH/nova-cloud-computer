import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Boots the real Express app and posts to /api/whop/webhook, so the route
 * wiring (raw-body route registered before the JSON parser -> signing-secret
 * verification) is exercised for real instead of only through unit helpers.
 * The billing state changes themselves are mocked: this test is about the
 * HTTP boundary and, in particular, about the handler receiving the raw bytes.
 */
const spies = vi.hoisted(() => ({
  purchasePriorityForUser: vi.fn(async () => ({
    priority: false,
    armed: true,
    purchasedAt: new Date(),
    activatedAt: null as Date | null,
    expiresAt: null as Date | null,
  })),
  recordWhopWebhookEvent: vi.fn(async () => true),
  upsertSubscriptionForUser: vi.fn(async () => ({ plan: "paid" as const, status: "active" })),
  ensureMonthlyAllocationForUser: vi.fn(async () => undefined),
  getOwnerIdForWhopMembership: vi.fn(async () => null),
  setWhopCheckoutConfigIdForUser: vi.fn(async () => undefined),
}));

const signingSecret = Buffer.from("whop-route-test-secret");
process.env.WHOP_API_KEY = "whop_test_api_key_1234";
process.env.WHOP_WEBHOOK_SECRET = `ws_${signingSecret.toString("base64")}`;

vi.mock("./db", () => ({
  getDb: vi.fn(),
  purchasePriorityForUser: spies.purchasePriorityForUser,
  recordWhopWebhookEvent: spies.recordWhopWebhookEvent,
  upsertSubscriptionForUser: spies.upsertSubscriptionForUser,
  ensureMonthlyAllocationForUser: spies.ensureMonthlyAllocationForUser,
  getOwnerIdForWhopMembership: spies.getOwnerIdForWhopMembership,
  setWhopCheckoutConfigIdForUser: spies.setWhopCheckoutConfigIdForUser,
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

vi.mock("./workspace/workspaceAgent", () => ({
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

describe("Whop billing webhook route", () => {
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
    id: "evt_test_1",
    type: "payment.succeeded",
    data: {
      id: "pay_1",
      metadata: { nova_user_id: "42", nova_product: "priority" },
      plan: { id: "plan_test_priority" },
    },
  });

  function signedHeaders(body: string, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = createHmac("sha256", signingSecret)
      .update(`evt_test_1.${timestamp}.${body}`)
      .digest("base64");
    return {
      "content-type": "application/json",
      "webhook-id": "evt_test_1",
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${signature}`,
    };
  }

  it("verifies the signature over the raw bytes and arms the priority purchase", async () => {
    const response = await realFetch(`${baseUrl}/api/whop/webhook`, {
      method: "POST",
      headers: signedHeaders(payload),
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, handled: true, ownerId: 42, product: "priority", armed: true });
    // The raw bytes matter: had the JSON parser run first, this callback
    // would have received a plain object and signature verification would fail.
    expect(spies.purchasePriorityForUser).toHaveBeenCalledWith(42);
  });

  it("rejects a tampered body with 400 and never reaches the billing handler", async () => {
    const tampered = payload.replace("pay_1", "pay_2");
    const response = await realFetch(`${baseUrl}/api/whop/webhook`, {
      method: "POST",
      headers: signedHeaders(payload),
      body: tampered,
    });
    expect(response.status).toBe(400);
    expect(spies.purchasePriorityForUser).not.toHaveBeenCalled();
  });

  it("returns 404 when webhooks are disabled on this deployment", async () => {
    const savedSecret = process.env.WHOP_WEBHOOK_SECRET;
    delete process.env.WHOP_WEBHOOK_SECRET;
    try {
      const response = await realFetch(`${baseUrl}/api/whop/webhook`, {
        method: "POST",
        headers: signedHeaders(payload),
        body: payload,
      });
      expect(response.status).toBe(404);
      expect(spies.purchasePriorityForUser).not.toHaveBeenCalled();
    } finally {
      process.env.WHOP_WEBHOOK_SECRET = savedSecret;
    }
  });
});