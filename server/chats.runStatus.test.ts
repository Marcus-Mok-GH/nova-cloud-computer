import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

// Stub the heavy agent-runner + model-gateway modules so a focused `chats.runStatus`
// check can import the router without pulling up the whole send path.
vi.mock("./workspace/workspaceAgent", () => ({
  runWorkspaceAgent: vi.fn(async () => ({ message: { id: 1, content: "ok" }, actions: [], outOfBudget: false })),
}));
vi.mock("./memories", () => ({
  clearMemoriesForUser: vi.fn(),
  listMemoriesForUser: vi.fn(),
  deleteOwnedMemoryForUser: vi.fn(),
}));
vi.mock("./aiGateway", () => ({
  listGatewayModels: vi.fn(async () => []),
  getAiGatewayStatus: vi.fn(async () => ({ configured: true, reachable: true })),
  completeWithAiGateway: vi.fn(async () => ({ text: "ok" })),
  AiGatewayClientError: class AiGatewayClientError extends Error {},
}));
vi.mock("./byokGateway", () => ({ testCustomModelEndpoint: vi.fn() }));

const getChatForUser = vi.fn();
const getActiveAgentRunInChat = vi.fn();
const hasLiveRunningProcessForChat = vi.fn();
vi.mock("./db", () => ({
  getChatForUser,
  getActiveAgentRunInChat,
  hasLiveRunningProcessForChat,
}));

const { appRouter } = await import("./routers");

function contextFor(id: number): TrpcContext {
  return {
    user: {
      id,
      openId: `user-${id}`,
      name: `User ${id}`,
      email: null,
      loginMethod: "test",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as unknown as NonNullable<TrpcContext["user"]>,
    banned: false,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const ORPHAN_RUN = { runId: "run-1", status: "running", segment: 2, updatedAt: new Date("2026-11-08T00:00:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
  getChatForUser.mockResolvedValue({ id: "chat-1" });
});

describe("chats.runStatus", () => {
  it("reports active while a worker is live for the chat", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    getActiveAgentRunInChat.mockResolvedValue(ORPHAN_RUN);
    hasLiveRunningProcessForChat.mockResolvedValue(true);

    await expect(caller.chats.runStatus({ chatId: "chat-1" })).resolves.toEqual({
      active: true,
      ...ORPHAN_RUN,
    });
  });

  it("reports idle for an orphaned run row with no live worker", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    getActiveAgentRunInChat.mockResolvedValue(ORPHAN_RUN);
    hasLiveRunningProcessForChat.mockResolvedValue(false); // the platform killed the process

    // This is the "composer stuck on Stop" bug: a running/awaiting_continue row
    // with no heartbeat must NOT read as active, or the composer keeps blocking
    // sends until the row reaps itself.
    await expect(caller.chats.runStatus({ chatId: "chat-1" })).resolves.toEqual({ active: false });
  });

  it("reports idle when there is no active run row at all", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    getActiveAgentRunInChat.mockResolvedValue(null);

    await expect(caller.chats.runStatus({ chatId: "chat-1" })).resolves.toEqual({ active: false });
  });

  it("passes the chat id and a liveness window to the process lookup", async () => {
    const caller = appRouter.createCaller(contextFor(41));
    getActiveAgentRunInChat.mockResolvedValue(ORPHAN_RUN);
    hasLiveRunningProcessForChat.mockResolvedValue(true);

    await caller.chats.runStatus({ chatId: "chat-1" });
    // excludeProcessId 0 = any live process counts; the window is the process
    // staleness threshold (heartbeat fresher than this = live).
    expect(hasLiveRunningProcessForChat).toHaveBeenCalledWith(
      "chat-1",
      0,
      expect.any(Date),
    );
  });
});
