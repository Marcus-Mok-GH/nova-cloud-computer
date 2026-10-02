import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InferenceQueueItem } from "../drizzle/schema";

const spies = {
  claimNextInferenceQueueItem: vi.fn(),
  completeInferenceQueueItem: vi.fn(async () => undefined),
  failInferenceQueueItem: vi.fn(async () => undefined),
  requeueStaleInferenceQueueItems: vi.fn(async () => 0),
  getTelegramCredentialsForUser: vi.fn(async () => undefined),
  executeWebAgentRun: vi.fn(async () => ({ message: null, actions: [] })),
  executeTelegramAgentRun: vi.fn(async () => ({ delivered: true, reply: "ok" })),
  chatWithAiGateway: vi.fn(),
  chatWithCustomModel: vi.fn(),
  getActiveCustomModel: vi.fn(async () => null),
  kickPeakQueue: vi.fn(),
};

vi.mock("./db", () => ({
  claimNextInferenceQueueItem: spies.claimNextInferenceQueueItem,
  completeInferenceQueueItem: spies.completeInferenceQueueItem,
  failInferenceQueueItem: spies.failInferenceQueueItem,
  requeueStaleInferenceQueueItems: spies.requeueStaleInferenceQueueItems,
  getTelegramCredentialsForUser: spies.getTelegramCredentialsForUser,
}));

vi.mock("./agentRuns", () => ({
  executeWebAgentRun: spies.executeWebAgentRun,
  executeTelegramAgentRun: spies.executeTelegramAgentRun,
}));

vi.mock("./aiGateway", async importOriginal => {
  const actual = await importOriginal<typeof import("./aiGateway")>();
  return { ...actual, chatWithAiGateway: spies.chatWithAiGateway };
});

vi.mock("./byokGateway", () => ({
  chatWithCustomModel: spies.chatWithCustomModel,
  getActiveCustomModel: spies.getActiveCustomModel,
}));

vi.mock("./peakQueueScheduler", () => ({
  scheduleQueueAdvance: vi.fn(async () => true),
  kickPeakQueue: spies.kickPeakQueue,
}));

const { advancePeakQueue } = await import("./peakQueueWorker");

function queueItem(overrides: Partial<InferenceQueueItem> = {}): InferenceQueueItem {
  return {
    id: 1,
    ownerId: 7,
    channel: "api",
    status: "running",
    chatId: null,
    content: "",
    payload: {},
    result: null,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const gatewayResult = {
  text: "Hello!",
  toolCalls: [],
  model: "chat-small-latest",
  usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
  allowance: { usedRequests: 1, maxRequests: 500, remainingRequests: 499, exhausted: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  spies.requeueStaleInferenceQueueItems.mockResolvedValue(0);
  spies.getActiveCustomModel.mockResolvedValue(null);
  spies.getTelegramCredentialsForUser.mockResolvedValue(undefined);
  spies.chatWithAiGateway.mockResolvedValue(gatewayResult);
});

describe("advancePeakQueue", () => {
  it("does nothing when the queue is empty", async () => {
    spies.claimNextInferenceQueueItem.mockResolvedValue(undefined);
    await expect(advancePeakQueue()).resolves.toEqual({ processed: 0 });
    expect(spies.completeInferenceQueueItem).not.toHaveBeenCalled();
    expect(spies.kickPeakQueue).not.toHaveBeenCalled();
  });

  it("runs a deferred API call and stores the completion for polling", async () => {
    spies.claimNextInferenceQueueItem.mockResolvedValue(
      queueItem({ payload: { modelId: "nova-pro", messages: [{ role: "user", content: "Hi" }] } })
    );
    await expect(advancePeakQueue()).resolves.toEqual({ processed: 1 });
    expect(spies.chatWithAiGateway).toHaveBeenCalledWith(7, [{ role: "user", content: "Hi" }], {});
    const [queueId, result] = spies.completeInferenceQueueItem.mock.calls[0];
    expect(queueId).toBe(1);
    expect((result as { object?: string }).object).toBe("chat.completion");
    expect((result as { model?: string }).model).toBe("nova-pro");
    expect(spies.kickPeakQueue).toHaveBeenCalled();
  });

  it("records a failed API call instead of leaving it running", async () => {
    const { AiGatewayClientError } = await import("./aiGateway");
    spies.chatWithAiGateway.mockRejectedValue(new AiGatewayClientError("upstream overloaded", "rate_limit"));
    spies.claimNextInferenceQueueItem.mockResolvedValue(queueItem({ payload: { messages: [] } }));
    await advancePeakQueue();
    expect(spies.failInferenceQueueItem).toHaveBeenCalledWith(1, "upstream overloaded");
    expect(spies.completeInferenceQueueItem).not.toHaveBeenCalled();
    expect(spies.kickPeakQueue).toHaveBeenCalled();
  });

  it("runs a deferred web turn and closes the item", async () => {
    spies.claimNextInferenceQueueItem.mockResolvedValue(
      queueItem({ channel: "web", chatId: "chat-1", content: "do it" })
    );
    await advancePeakQueue();
    expect(spies.executeWebAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 7, chatId: "chat-1", content: "do it" })
    );
    expect(spies.completeInferenceQueueItem).toHaveBeenCalledWith(1);
  });

  it("fails a web turn that throws so the queue keeps moving", async () => {
    spies.executeWebAgentRun.mockRejectedValueOnce(new Error("agent exploded"));
    spies.claimNextInferenceQueueItem.mockResolvedValue(queueItem({ channel: "web", chatId: "chat-1" }));
    await advancePeakQueue();
    expect(spies.failInferenceQueueItem).toHaveBeenCalledWith(1, "agent exploded");
    expect(spies.kickPeakQueue).toHaveBeenCalled();
  });

  it("pushes a deferred Telegram reply through the bot", async () => {
    spies.getTelegramCredentialsForUser.mockResolvedValue({ token: "bot-token", chatId: "42" });
    spies.claimNextInferenceQueueItem.mockResolvedValue(
      queueItem({ channel: "telegram", chatId: "chat-2", content: "hi", payload: { notifyChatId: "42" } })
    );
    await advancePeakQueue();
    expect(spies.executeTelegramAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 7, chatId: "chat-2", telegramChatId: "42", token: "bot-token" })
    );
    expect(spies.completeInferenceQueueItem).toHaveBeenCalledWith(1);
  });

  it("fails a deferred Telegram turn when no delivery target resolves", async () => {
    spies.claimNextInferenceQueueItem.mockResolvedValue(
      queueItem({ channel: "telegram", chatId: "chat-2", payload: {} })
    );
    await advancePeakQueue();
    expect(spies.executeTelegramAgentRun).not.toHaveBeenCalled();
    expect(spies.failInferenceQueueItem).toHaveBeenCalledWith(1, "the deferred Telegram reply could not resolve its delivery target");
  });
});
