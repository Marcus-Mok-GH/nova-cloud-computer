import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Terminal router: owner-scoped wiring between the tRPC procedures and the
 * terminal session module, plus error mapping for the UI.
 */

const status = vi.fn((ownerId: number) => ({ active: ownerId === 1, ptyId: ownerId === 1 ? 421 : null, cols: 120, rows: 30, seq: 42 }));
const start = vi.fn(async (ownerId: number, size: { cols: number; rows: number }) => {
  if (ownerId === 1) return { reused: false as const, ptyId: 421, offset: 0, seq: 0, output: "" };
  throw new Error("E2B is not connected yet. An administrator must add the server-only E2B API key before Nova can open a terminal.");
});
const read = vi.fn((ownerId: number, sinceSeq: number) =>
  ownerId === 1
    ? { active: true as const, offset: 0, seq: 10, data: "output", reset: false }
    : { active: false as const, offset: 0, seq: 0, data: "", reset: false }
);
const write = vi.fn(async (ownerId: number, data: string) => {
  if (ownerId !== 1) throw new Error("Open the terminal before typing into it.");
  return { written: true as const };
});
const resize = vi.fn(async (ownerId: number, size: { cols: number; rows: number }) => ({ resized: ownerId === 1 }));
const stop = vi.fn(async (ownerId: number) => ({ success: ownerId === 1 }));

vi.mock("./db", () => ({
  getActiveCustomModelForUser: vi.fn(async () => null),
  getTelegramSettingsForUser: vi.fn(), saveTelegramSettingsForUser: vi.fn(), getTelegramCredentialsForUser: vi.fn(), updateTelegramChatForUser: vi.fn(), deleteTelegramSettingsForUser: vi.fn(),
  createWorkspaceFolderForUser: vi.fn(), updateWorkspaceFolderForUser: vi.fn(), deleteWorkspaceFolderForUser: vi.fn(),
  createWorkspaceFileForUser: vi.fn(), updateWorkspaceFileForUser: vi.fn(), deleteWorkspaceFileForUser: vi.fn(),
  createChatForUser: vi.fn(), listChatMessagesForUser: vi.fn(), getWorkspaceComputer: vi.fn(),
  getOrCreateWorkspace: vi.fn(), getWorkspaceDashboard: vi.fn(), getWorkspaceModelSettingsForUser: vi.fn(), updateWorkspaceModelSettingsForUser: vi.fn(),
  createCustomModelForUser: vi.fn(), deleteCustomModelForUser: vi.fn(), createProjectForUser: vi.fn(), createTaskForUser: vi.fn(), deleteProjectForUser: vi.fn(), deleteTaskForUser: vi.fn(), getProjectForUser: vi.fn(), listProjectsForUser: vi.fn(), listTasksForUser: vi.fn(), updateProjectForUser: vi.fn(), updateTaskStatusForUser: vi.fn(),
}));
vi.mock("./terminal", () => ({
  getTerminalStatusForUser: status, startTerminalForUser: start, readTerminalForUser: read,
  writeTerminalForUser: write, resizeTerminalForUser: resize, stopTerminalForUser: stop,
}));
vi.mock("./agentVm", () => ({ getAgentVmStatus: vi.fn(), listAgentVmRuns: vi.fn(async () => []), startAgentVmRun: vi.fn(), cancelAgentVmRun: vi.fn() }));
vi.mock("./telegram", () => ({ validateTelegramBotToken: vi.fn(), discoverTelegramChat: vi.fn(), sendTelegramMessage: vi.fn() }));
vi.mock("./workspaceAgent", () => ({ runWorkspaceAgent: vi.fn() }));
const { appRouter } = await import("./routers");

function context(id: number): TrpcContext {
  return { user: { id, openId: String(id), name: null, email: null, loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() }, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("Terminal protected router", () => {
  it("keeps every procedure scoped to the calling user", async () => {
    const owner = appRouter.createCaller(context(1));
    const stranger = appRouter.createCaller(context(2));

    expect(await owner.terminal.status()).toMatchObject({ active: true, ptyId: 421 });
    expect(await stranger.terminal.status()).toMatchObject({ active: false, ptyId: null });

    await owner.terminal.start({ cols: 120, rows: 30 });
    expect(start).toHaveBeenCalledWith(1, { cols: 120, rows: 30 });

    expect(await owner.terminal.read({ sinceSeq: 0 })).toMatchObject({ active: true, data: "output" });
    expect(await stranger.terminal.read({ sinceSeq: 0 })).toMatchObject({ active: false });

    await owner.terminal.write({ data: "ls\n" });
    expect(write).toHaveBeenCalledWith(1, "ls\n");
    await expect(stranger.terminal.write({ data: "ls\n" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await owner.terminal.resize({ cols: 140, rows: 40 });
    expect(resize).toHaveBeenCalledWith(1, { cols: 140, rows: 40 });

    await owner.terminal.stop();
    expect(stop).toHaveBeenCalledWith(1);
    expect(stop).not.toHaveBeenCalledWith(2);
  });

  it("maps a missing E2B configuration to a precondition error", async () => {
    const stranger = appRouter.createCaller(context(2));
    await expect(stranger.terminal.start({ cols: 120, rows: 30 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("E2B is not connected"),
    });
  });

  it("rejects invalid terminal geometry and oversized input", async () => {
    const owner = appRouter.createCaller(context(1));
    await expect(owner.terminal.start({ cols: 4, rows: 30 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.terminal.write({ data: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.terminal.write({ data: "x".repeat(9000) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
