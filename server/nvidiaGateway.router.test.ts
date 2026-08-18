import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const status = vi.fn(async (ownerId: number) => ({
  configured: ownerId === 1,
  reachable: ownerId === 1,
  providerConfigured: ownerId === 1,
  provider: "nvidia-nim" as const,
  model: "nvidia/nemotron-3-nano-30b-a3b",
  allowance: { usedRequests: ownerId === 1 ? 2 : 0, maxRequests: 50, remainingRequests: ownerId === 1 ? 48 : 50, exhausted: false },
}));
const complete = vi.fn(async (ownerId: number, prompt: string) => ({
  text: `owner ${ownerId}: ${prompt}`,
  model: "nvidia/nemotron-3-nano-30b-a3b",
  usage: null,
  allowance: { usedRequests: 3, maxRequests: 50, remainingRequests: 47, exhausted: false },
}));

class MockNvidiaGatewayClientError extends Error {
  constructor(message: string, public readonly kind: "configuration" | "unavailable" | "rate_limit" | "invalid_response") {
    super(message);
  }
}

vi.mock("./db", () => ({
  getOrCreateWorkspace: vi.fn(), getWorkspaceComputer: vi.fn(), getWorkspaceDashboard: vi.fn(), getWorkspaceModelSettingsForUser: vi.fn(), updateWorkspaceModelSettingsForUser: vi.fn(),
  createWorkspaceFolderForUser: vi.fn(), updateWorkspaceFolderForUser: vi.fn(), deleteWorkspaceFolderForUser: vi.fn(), createWorkspaceFileForUser: vi.fn(), updateWorkspaceFileForUser: vi.fn(), deleteWorkspaceFileForUser: vi.fn(),
  createChatForUser: vi.fn(), listChatMessagesForUser: vi.fn(), createCustomModelForUser: vi.fn(), deleteCustomModelForUser: vi.fn(), createProjectForUser: vi.fn(), createTaskForUser: vi.fn(), deleteProjectForUser: vi.fn(), deleteTaskForUser: vi.fn(), getProjectForUser: vi.fn(), listProjectsForUser: vi.fn(), listTasksForUser: vi.fn(), updateProjectForUser: vi.fn(), updateTaskStatusForUser: vi.fn(),
  getTelegramSettingsForUser: vi.fn(), saveTelegramSettingsForUser: vi.fn(), getTelegramCredentialsForUser: vi.fn(), updateTelegramChatForUser: vi.fn(), deleteTelegramSettingsForUser: vi.fn(),
}));
vi.mock("./agentVm", () => ({ getAgentVmStatus: vi.fn(), listAgentVmRuns: vi.fn(), startAgentVmRun: vi.fn(), cancelAgentVmRun: vi.fn() }));
vi.mock("./telegram", () => ({ validateTelegramBotToken: vi.fn(), discoverTelegramChat: vi.fn(), sendTelegramMessage: vi.fn() }));
vi.mock("./workspaceAgent", () => ({ runWorkspaceAgent: vi.fn() }));
vi.mock("./nvidiaGateway", () => ({
  getNvidiaGatewayStatus: status,
  completeWithNvidiaGateway: complete,
  NvidiaGatewayClientError: MockNvidiaGatewayClientError,
}));

const { appRouter } = await import("./routers");

function context(id: number): TrpcContext {
  return { user: { id, openId: String(id), name: null, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("NVIDIA protected router", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes gateway status and completions to the signed-in workspace owner", async () => {
    const owner = appRouter.createCaller(context(1));
    const stranger = appRouter.createCaller(context(2));
    await expect(owner.nvidia.status()).resolves.toMatchObject({ configured: true, allowance: { usedRequests: 2 } });
    await expect(stranger.nvidia.status()).resolves.toMatchObject({ configured: false, allowance: { usedRequests: 0 } });
    await expect(owner.nvidia.complete({ prompt: "Summarize these workspace notes" })).resolves.toMatchObject({ text: "owner 1: Summarize these workspace notes" });
    expect(status).toHaveBeenCalledWith(1);
    expect(status).toHaveBeenCalledWith(2);
    expect(complete).toHaveBeenCalledWith(1, "Summarize these workspace notes");
  });

  it("enforces bounded prompts and maps allowance exhaustion to a safe rate-limit error", async () => {
    const owner = appRouter.createCaller(context(1));
    await expect(owner.nvidia.complete({ prompt: "no" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.nvidia.complete({ prompt: "x".repeat(12001) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    complete.mockRejectedValueOnce(new MockNvidiaGatewayClientError("Workspace allowance reached.", "rate_limit"));
    await expect(owner.nvidia.complete({ prompt: "Draft a compact release plan" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: "Workspace allowance reached." });
  });
});
