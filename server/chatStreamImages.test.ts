import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

const spies = vi.hoisted(() => ({
  createWorkspaceFileForUser: vi.fn(
    async (_owner: number, payload: { name: string; mimeType: string }) => ({
      id: 55,
      name: payload.name,
      mimeType: payload.mimeType,
    })
  ),
  runWorkspaceAgent: vi.fn(async () => ({
    message: { content: "It's a corgi!" },
    actions: [],
  })),
  autoTitleChatForUser: vi.fn(async () => true),
  startAgentRunForUser: vi.fn(async () => ({ id: 501 })),
  finishAgentRunForUser: vi.fn(async () => ({})),
}));

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
  getDb: vi.fn(),
  activatePriorityWindowForUser: vi.fn(async () => ({ priority: false, justActivated: false, expiresAt: null })),
  createWorkspaceFileForUser: spies.createWorkspaceFileForUser,
  startAgentRunForUser: spies.startAgentRunForUser,
  finishAgentRunForUser: spies.finishAgentRunForUser,
  holdAgentRunForContinue: vi.fn(async () => false),
  appendChatMessageForUser: vi.fn(async () => ({ id: 1 })),
}));

vi.mock("./workspaceAgent", () => ({
  MAX_RUN_BUDGET_MS: 285_000,
  runWorkspaceAgent: spies.runWorkspaceAgent,
  autoTitleChatForUser: spies.autoTitleChatForUser,
}));

vi.mock("./telegram", () => ({
  sendChatAction: vi.fn(async () => true),
  sendTelegramMessage: vi.fn(async () => ({ message_id: 77 })),
  telegramUploadFromMessage: vi.fn(() => undefined),
  downloadTelegramUpload: vi.fn(),
  answerTelegramCallbackQuery: vi.fn(async () => true),
  presentTelegramFile: vi.fn(async () => ({ messageId: 78, as: "document" })),
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
  USER_AUTOMATION_CRONS: { daily: "0 9 * * *", weekly: "0 9 * * 1" },
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
  createExpressMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));
vi.mock("./automationPlannerRoute", () => ({
  automationPlannerRouter: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
}));

const { app } = await import("./app");

describe("Chat stream image attachments", () => {
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

  async function post(body: unknown) {
    const response = await realFetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  }

  it("saves attached images, notes them for the model, and streams the reply", async () => {
    const { status, text } = await post({
      chatId: "chat-1",
      content: "what is in this picture?",
      images: [PNG],
    });
    expect(status).toBe(200);
    expect(text).toContain("data: [DONE]");
    expect(spies.createWorkspaceFileForUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ content: PNG, mimeType: "image/png" })
    );
    const runOptions = spies.runWorkspaceAgent.mock.calls[0][3] as {
      imageAttachments?: string[];
      uploadContext?: string;
      channel?: string;
    };
    expect(runOptions.imageAttachments).toEqual([PNG]);
    expect(runOptions.channel).toBe("web");
    expect(runOptions.uploadContext).toContain("file id 55");
    // The visible user message stays the clean typed text.
    expect(spies.runWorkspaceAgent.mock.calls[0][2]).toBe(
      "what is in this picture?"
    );
  });

  it("accepts an image-only message and names the uploaded file", async () => {
    const { status } = await post({ chatId: "chat-1", images: [PNG] });
    expect(status).toBe(200);
    expect(spies.runWorkspaceAgent.mock.calls[0][2]).toMatch(
      /^Uploaded image-/
    );
  });

  it("rejects too many images", async () => {
    const { status } = await post({
      chatId: "chat-1",
      content: "here",
      images: [PNG, PNG, PNG, PNG, PNG],
    });
    expect(status).toBe(400);
    expect(spies.runWorkspaceAgent).not.toHaveBeenCalled();
  });

  it("rejects a non-image data URI", async () => {
    const { status } = await post({
      chatId: "chat-1",
      content: "here",
      images: ["data:text/plain;base64,aGk="],
    });
    expect(status).toBe(400);
    expect(spies.runWorkspaceAgent).not.toHaveBeenCalled();
  });

  it("still rejects a request with neither text nor images", async () => {
    const { status } = await post({ chatId: "chat-1", content: "   " });
    expect(status).toBe(400);
    expect(spies.runWorkspaceAgent).not.toHaveBeenCalled();
  });
});
