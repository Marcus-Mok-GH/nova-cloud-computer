import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const status = vi.fn(() => ({ configured: true, provider: "e2b" as const, policy: "persistent_workspace" as const, limits: { timeoutSeconds: 30, network: "allowed" as const }, allowance: { usedRuns: 1, maxRuns: 50, remainingRuns: 49, exhausted: false } }));
const list = vi.fn(async (ownerId: number) => ownerId === 1 ? [{ id: 9, provider: "e2b", sandboxId: "sbx-owner", task: "Inspect notes", status: "succeeded", resultSummary: "Done", errorMessage: null, artifactFileId: 22, startedAt: new Date(), completedAt: new Date(), createdAt: new Date(), updatedAt: new Date() }] : []);
const start = vi.fn(async (ownerId: number, input: { task: string; code?: string }) => ownerId === 1
  ? { configured: true as const, run: { id: 9, task: input.task, status: "succeeded" }, message: "E2B completed the task." }
  : { configured: false as const, run: null, message: "E2B is not connected yet." });
const cancel = vi.fn(async (ownerId: number, runId: number) => ownerId === 1 && runId === 9 ? { id: 9, task: "Inspect notes", status: "cancelled" } : undefined);

vi.mock("./db", () => ({
  getTelegramSettingsForUser: vi.fn(), saveTelegramSettingsForUser: vi.fn(), getTelegramCredentialsForUser: vi.fn(), updateTelegramChatForUser: vi.fn(), deleteTelegramSettingsForUser: vi.fn(),
  createWorkspaceFolderForUser: vi.fn(), updateWorkspaceFolderForUser: vi.fn(), deleteWorkspaceFolderForUser: vi.fn(),
  createWorkspaceFileForUser: vi.fn(), updateWorkspaceFileForUser: vi.fn(), deleteWorkspaceFileForUser: vi.fn(),
  createChatForUser: vi.fn(), listChatMessagesForUser: vi.fn(), getWorkspaceComputer: vi.fn(),
  getOrCreateWorkspace: vi.fn(), getWorkspaceDashboard: vi.fn(), getWorkspaceModelSettingsForUser: vi.fn(), updateWorkspaceModelSettingsForUser: vi.fn(),
  createCustomModelForUser: vi.fn(), deleteCustomModelForUser: vi.fn(), createProjectForUser: vi.fn(), createTaskForUser: vi.fn(), deleteProjectForUser: vi.fn(), deleteTaskForUser: vi.fn(), getProjectForUser: vi.fn(), listProjectsForUser: vi.fn(), listTasksForUser: vi.fn(), updateProjectForUser: vi.fn(), updateTaskStatusForUser: vi.fn(),
}));
vi.mock("./agentVm", () => ({ getAgentVmStatus: status, listAgentVmRuns: list, startAgentVmRun: start, cancelAgentVmRun: cancel }));
vi.mock("./telegram", () => ({ validateTelegramBotToken: vi.fn(), discoverTelegramChat: vi.fn(), sendTelegramMessage: vi.fn() }));
vi.mock("./workspaceAgent", () => ({ runWorkspaceAgent: vi.fn() }));
const { appRouter } = await import("./routers");

function context(id: number): TrpcContext {
  return { user: { id, openId: String(id), name: null, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("E2B protected router", () => {
  it("returns safe platform status and owner-scoped run history", async () => {
    const owner = appRouter.createCaller(context(1));
    const stranger = appRouter.createCaller(context(2));
    expect(await owner.agentVm.status()).toMatchObject({ configured: true, provider: "e2b", policy: "persistent_workspace" });
    expect(await owner.agentVm.list()).toMatchObject([{ id: 9, sandboxId: "sbx-owner", task: "Inspect notes" }]);
    expect(await stranger.agentVm.list()).toEqual([]);
  });

  it("starts explicit tasks and prevents a second owner from cancelling the run", async () => {
    const owner = appRouter.createCaller(context(1));
    const stranger = appRouter.createCaller(context(2));
    await expect(owner.agentVm.start({ task: "Inspect notes" })).resolves.toMatchObject({ configured: true, run: { id: 9 } });
    expect(start).toHaveBeenCalledWith(1, { task: "Inspect notes" });
    await expect(stranger.agentVm.cancel({ id: 9 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.agentVm.cancel({ id: 9 })).resolves.toMatchObject({ status: "cancelled" });
  });
});
