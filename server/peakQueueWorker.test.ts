import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InferenceQueueItem } from "../drizzle/schema";

const spies = {
  claimNextInferenceQueueItem: vi.fn(),
  completeInferenceQueueItem: vi.fn(async () => undefined),
  failInferenceQueueItem: vi.fn(async () => undefined),
  requeueStaleInferenceQueueItems: vi.fn(async () => 0),
  getRunningInferenceQueueItem: vi.fn(async () => undefined),
  getTelegramCredentialsForUser: vi.fn(async () => undefined),
  getCustomModelForUser: vi.fn(async () => undefined),
  executeWebAgentRun: vi.fn(async () => ({ message: null, actions: [] })),
  executeTelegramAgentRun: vi.fn(async () => ({ delivered: true, reply: "ok" })),
  chatWithAiGateway: vi.fn(),
  chatWithCustomModel: vi.fn(),
  kickPeakQueue: vi.fn(),
};

vi.mock("./db", () => ({
  claimNextInferenceQueueItem: spies.claimNextInferenceQueueItem,
  completeInferenceQueueItem: spies.completeInferenceQueueItem,
  failInferenceQueueItem: spies.failInferenceQueueItem,
  requeueStaleInferenceQueueItems: spies.requeueStaleInferenceQueueItems,
  getRunningInferenceQueueItem: spies.getRunningInferenceQueueItem,
  getTelegramCredentialsForUser: spies.getTelegramCredentialsForUser,
  getCustomModelForUser: spies.getCustomModelForUser,
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
    attempts: 1,
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

const customModel = {
  id: 9,
  workspaceId: 1,
  name: "My provider",
  modelId: "gpt-4o",
  baseUrl: "https://api.example.com/v1",
  compatibility: "openai" as const,
  encryptedApiKey: "encrypted",
  supportsImageInput: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

beforeEach(() => {
  vi.clearAllMocks();
  spies.requeueStaleInferenceQueueItems.mockResolvedValue(0);
  spies.getRunningInferenceQueueItem.mockResolvedValue(undefined);
  spies.getTelegramCredentialsForUser.mockResolvedValue(undefined);
  spies.getCustomModelForUser.mockResolvedValue(undefined);
  spies.chatWithAiGateway.mockResolvedValue(gatewayResult);
  spies.chatWithCustomModel.mockResolvedValue(gatewayResult);
});

describe("advancePeakQueue", () => {
  it("does nothing when the queue is empty and nothing is running", async () => {
    spies.claimNextInferenceQueueItem.mockResolvedValue(undefined);
    await expect(advancePeakQueue()).resolves.toEqual({ processed: 0 });
    expect(spies.completeInferenceQueueItem).not.toHaveBeenCalled();
    expect(spies.kickPeakQueue).not.toHaveBeenCalled();
  });

  it("sweeps and re-kicks when a killed worker left a stale running row", async () => {
    spies.claimNextInferenceQueueItem.mockResolvedValue(undefined);
    spies.getRunningInferenceQueueItem.mockResolvedValue(
      queueItem({ startedAt: new Date(Date.now() - 10 * 60_000) })
    );
    await expect(advancePeakQueue()).resolves.toEqual({ processed: 0 });
    expect(spies.requeueStaleInferenceQueueItems).toHaveBeenCalled();
    expect(spies.kickPeakQueue).toHaveBeenCalled();
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

  it("routes a queued BYOK call through the model selected at admission", async () => {
    spies.getCustomModelForUser.mockResolvedValue(customModel);
    spies.claimNextInferenceQueueItem.mockResolvedValue(
      queueItem({ payload: { modelId: "gpt-4o", customModelId: 9, messages: [{ role: "user", content: "Hi" }] } })
    );
    await advancePeakQueue();
    expect(spies.getCustomModelForUser).toHaveBeenCalledWith(7, 9);
    expect(spies.chatWithCustomModel).toHaveBeenCalled();
    expect(spies.chatWithAiGateway).not.toHaveBeenCalled();
    const [, result] = spies.completeInferenceQueueItem.mock.calls[0];
    expect((result as { model?: string }).model).toBe("gpt-4o");
  });

  it("fails a queued BYOK call whose model disappeared while it waited", async () => {
    spies.getCustomModelForUser.mockResolvedValue(undefined);
    spies.claimNextInferenceQueueItem.mockResolvedValue(
      queueItem({ payload: { modelId: "gpt-4o", customModelId: 9, messages: [] } })
    );
    await advancePeakQueue();
    expect(spies.chatWithCustomModel).not.toHaveBeenCalled();
    expect(spies.failInferenceQueueItem).toHaveBeenCalledWith(1, "the model selected when this request was queued is no longer available");
  });

  it("does not leak raw internal errors to the poll response", async () => {
    spies.chatWithAiGateway.mockRejectedValue(new Error("ECONNRESET 10.0.0.1:5432 at postgres"));
    spies.claimNextInferenceQueueItem.mockResolvedValue(queueItem({ payload: { messages: [] } }));
    await advancePeakQueue();
    expect(spies.failInferenceQueueItem).toHaveBeenCalledWith(1, "the deferred request hit an unexpected error");
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
    expect(spies.failInferenceQueueItem).toHaveBeenCalledWith(1, "the deferred request hit an unexpected error");
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
