import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getAutomationRecordForUser = vi.fn();
const setAutomationScheduleTaskForUser = vi.fn();
const updateAutomationForUser = vi.fn();
const createHeartbeatJob = vi.fn();
const updateHeartbeatJob = vi.fn();

vi.mock("./db", () => ({
  getAutomationRecordForUser,
  setAutomationScheduleTaskForUser,
  updateAutomationForUser,
  listAutomationsForUser: vi.fn(),
  listAutomationRunsForUser: vi.fn(),
  getTelegramSettingsForUser: vi.fn(), saveTelegramSettingsForUser: vi.fn(), getTelegramCredentialsForUser: vi.fn(), updateTelegramChatForUser: vi.fn(), deleteTelegramSettingsForUser: vi.fn(),
  createWorkspaceFolderForUser: vi.fn(), updateWorkspaceFolderForUser: vi.fn(), deleteWorkspaceFolderForUser: vi.fn(),
  createWorkspaceFileForUser: vi.fn(), updateWorkspaceFileForUser: vi.fn(), deleteWorkspaceFileForUser: vi.fn(),
  createChatForUser: vi.fn(), listChatMessagesForUser: vi.fn(), getWorkspaceComputer: vi.fn(),
  getOrCreateWorkspace: vi.fn(), getWorkspaceDashboard: vi.fn(), getWorkspaceModelSettingsForUser: vi.fn(), updateWorkspaceModelSettingsForUser: vi.fn(),
  createCustomModelForUser: vi.fn(), deleteCustomModelForUser: vi.fn(), createProjectForUser: vi.fn(), createTaskForUser: vi.fn(), deleteProjectForUser: vi.fn(), deleteTaskForUser: vi.fn(), getProjectForUser: vi.fn(), listProjectsForUser: vi.fn(), listTasksForUser: vi.fn(), updateProjectForUser: vi.fn(), updateTaskStatusForUser: vi.fn(),
}));
vi.mock("./automations", () => ({ WORKSPACE_DIGEST_CRON: "0 0 9 * * *", runDueAutomationsForUser: vi.fn() }));
vi.mock("./_core/heartbeat", () => ({ createHeartbeatJob, updateHeartbeatJob }));
vi.mock("./agentVm", () => ({ getAgentVmStatus: vi.fn(), listAgentVmRuns: vi.fn(), startAgentVmRun: vi.fn(), cancelAgentVmRun: vi.fn() }));
vi.mock("./telegram", () => ({ validateTelegramBotToken: vi.fn(), discoverTelegramChat: vi.fn(), sendTelegramMessage: vi.fn() }));
vi.mock("./workspaceAgent", () => ({ runWorkspaceAgent: vi.fn() }));
vi.mock("./nvidiaGateway", () => ({ getNvidiaGatewayStatus: vi.fn(), completeWithNvidiaGateway: vi.fn(), NvidiaGatewayClientError: class extends Error {} }));

const { appRouter } = await import("./routers");

function context(id: number): TrpcContext {
  return {
    user: { id, openId: String(id), name: null, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { headers: { cookie: "app_session_id=owner-session" } } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("automation schedule registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createHeartbeatJob.mockResolvedValue({ taskUid: "task_owner_1" });
    setAutomationScheduleTaskForUser.mockResolvedValue({ id: 17, enabled: false, scheduleActive: true });
    updateAutomationForUser.mockImplementation(async (_ownerId: number, id: number, input: { enabled: boolean }) => ({ id, enabled: input.enabled, scheduleActive: true }));
  });

  it("creates a persisted, account-owned schedule before enabling the automation", async () => {
    getAutomationRecordForUser.mockImplementation(async (ownerId: number, automationId: number) => ownerId === 1 && automationId === 17
      ? { id: 17, ownerId: 1, workspaceId: 31, kind: "workspace_digest", enabled: false, scheduleCronTaskUid: null }
      : undefined);

    const owner = appRouter.createCaller(context(1));
    await expect(owner.automations.update({ id: 17, enabled: true })).resolves.toMatchObject({ id: 17, enabled: true });

    expect(createHeartbeatJob).toHaveBeenCalledWith({
      name: "nova-automation-17",
      cron: "0 0 9 * * *",
      path: "/api/scheduled/automation",
      method: "POST",
      description: "Daily private Nova workspace briefing",
    }, "owner-session");
    expect(setAutomationScheduleTaskForUser).toHaveBeenCalledWith(1, 17, "task_owner_1");
    expect(updateAutomationForUser).toHaveBeenCalledWith(1, 17, { enabled: true });
  });

  it("prevents another account from registering a schedule for an automation it does not own", async () => {
    getAutomationRecordForUser.mockResolvedValue(undefined);
    const stranger = appRouter.createCaller(context(2));

    await expect(stranger.automations.update({ id: 17, enabled: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(createHeartbeatJob).not.toHaveBeenCalled();
    expect(updateAutomationForUser).not.toHaveBeenCalled();
  });

  it("pauses the persisted owner schedule before marking the automation disabled", async () => {
    getAutomationRecordForUser.mockResolvedValue({
      id: 17,
      ownerId: 1,
      workspaceId: 31,
      kind: "workspace_digest",
      enabled: true,
      scheduleCronTaskUid: "task_owner_1",
    });

    const owner = appRouter.createCaller(context(1));
    await expect(owner.automations.update({ id: 17, enabled: false })).resolves.toMatchObject({ id: 17, enabled: false });

    expect(updateHeartbeatJob).toHaveBeenCalledWith("task_owner_1", { enable: false }, "owner-session");
    expect(updateAutomationForUser).toHaveBeenCalledWith(1, 17, { enabled: false });
  });
});
