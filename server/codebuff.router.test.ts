import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const configured = new Set<number>();
const plan = vi.fn(async (ownerId: number, input: { prompt: string; fileIds: number[] }) => ({ configured: true as const, run: { id: 71, provider: "codebuff", task: input.prompt, status: "succeeded" }, plan: { summary: "Plan ready", steps: ["Review notes"], cautions: [], selectedFileNames: ["notes.md"] }, message: `owner ${ownerId}` }));

vi.mock("./db", () => ({
  getOrCreateWorkspace: vi.fn(), getWorkspaceComputer: vi.fn(), getWorkspaceDashboard: vi.fn(), getWorkspaceModelSettingsForUser: vi.fn(), updateWorkspaceModelSettingsForUser: vi.fn(),
  createWorkspaceFolderForUser: vi.fn(), updateWorkspaceFolderForUser: vi.fn(), deleteWorkspaceFolderForUser: vi.fn(), createWorkspaceFileForUser: vi.fn(), updateWorkspaceFileForUser: vi.fn(), deleteWorkspaceFileForUser: vi.fn(),
  createChatForUser: vi.fn(), listChatMessagesForUser: vi.fn(), createCustomModelForUser: vi.fn(), deleteCustomModelForUser: vi.fn(), createProjectForUser: vi.fn(), createTaskForUser: vi.fn(), deleteProjectForUser: vi.fn(), deleteTaskForUser: vi.fn(), getProjectForUser: vi.fn(), listProjectsForUser: vi.fn(), listTasksForUser: vi.fn(), updateProjectForUser: vi.fn(), updateTaskStatusForUser: vi.fn(),
  getTelegramSettingsForUser: vi.fn(), saveTelegramSettingsForUser: vi.fn(), getTelegramCredentialsForUser: vi.fn(), updateTelegramChatForUser: vi.fn(), deleteTelegramSettingsForUser: vi.fn(),
  saveCodebuffSettingsForUser: vi.fn(async (ownerId: number, apiKey: string) => { configured.add(ownerId); return { configured: true as const, updatedAt: new Date(), savedKeyLength: apiKey.length }; }),
  deleteCodebuffSettingsForUser: vi.fn(async (ownerId: number) => configured.delete(ownerId)),
}));
vi.mock("./agentVm", () => ({ getAgentVmStatus: vi.fn(), listAgentVmRuns: vi.fn(), startAgentVmRun: vi.fn(), cancelAgentVmRun: vi.fn() }));
vi.mock("./codebuff", () => ({
  getCodebuffPlannerStatus: vi.fn(async (ownerId: number) => ({ configured: configured.has(ownerId), provider: "codebuff", limits: { maxSelectedFiles: 12, maxFileChars: 24000, maxBundleChars: 120000, maxAgentSteps: 6, execution: "planning_only" } })),
  startCodebuffPlannerRun: plan,
}));
vi.mock("./telegram", () => ({ validateTelegramBotToken: vi.fn(), discoverTelegramChat: vi.fn(), sendTelegramMessage: vi.fn() }));
vi.mock("./workspaceAgent", () => ({ runWorkspaceAgent: vi.fn() }));
const { appRouter } = await import("./routers");

function context(id: number): TrpcContext {
  return { user: { id, openId: String(id), name: null, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("Codebuff protected router", () => {
  beforeEach(() => { configured.clear(); vi.clearAllMocks(); });

  it("stores a key without returning it and exposes configuration only to the signed-in workspace", async () => {
    const owner = appRouter.createCaller(context(1));
    const stranger = appRouter.createCaller(context(2));
    const result = await owner.codebuff.configure({ apiKey: "cb_private_key_123456789" });
    expect(JSON.stringify(result)).not.toContain("cb_private_key_123456789");
    await expect(owner.codebuff.status()).resolves.toMatchObject({ configured: true, provider: "codebuff" });
    await expect(stranger.codebuff.status()).resolves.toMatchObject({ configured: false });
    await expect(owner.codebuff.remove()).resolves.toEqual({ success: true });
  });

  it("requires explicit consent and passes only the owner-selected file IDs to the planner", async () => {
    const owner = appRouter.createCaller(context(1));
    await expect(owner.codebuff.plan({ prompt: "Plan the release notes", fileIds: [9], consent: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await owner.codebuff.plan({ prompt: "Plan the release notes", fileIds: [9, 11], consent: true });
    expect(plan).toHaveBeenCalledWith(1, { prompt: "Plan the release notes", fileIds: [9, 11], consent: true });
    await expect(owner.codebuff.plan({ prompt: "Plan duplicate file", fileIds: [9, 9], consent: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
