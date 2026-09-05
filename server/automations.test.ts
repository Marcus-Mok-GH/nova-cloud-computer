import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  claimAutomationRun: vi.fn(),
  createWorkspaceFileForUser: vi.fn(),
  getAutomationForScheduleTask: vi.fn(),
  getAutomationRecordForUser: vi.fn(),
  getOrCreateWorkspace: vi.fn(),
  getWorkspaceComputer: vi.fn(),
  listAutomationRecordsForUser: vi.fn(),
  updateAutomationRun: vi.fn(),
  updateAutomationScheduleState: vi.fn(),
};

const e2b = {
  getE2BClient: vi.fn(() => ({})),
  runE2BTaskInPersistentSandbox: vi.fn(),
};

vi.mock("./db", () => db);
vi.mock("./e2b", () => e2b);

const { buildWorkspaceBriefing, getAutomationRunKey, runAutomationForScheduleTask, runDueAutomationsForUser } = await import("./automations");

const now = new Date("2026-08-18T08:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.getOrCreateWorkspace.mockResolvedValue({ id: 31, ownerId: 7 });
  db.listAutomationRecordsForUser.mockResolvedValue([]);
  e2b.getE2BClient.mockReturnValue({});
  e2b.runE2BTaskInPersistentSandbox.mockResolvedValue({
    sandboxId: "sbx-owner-7",
    output: JSON.stringify({
      name: "daily-workspace-briefing-2026-08-18.md",
      content: "# Daily workspace briefing\n\nGenerated inside the E2B sandbox.\n",
      mimeType: "text/markdown",
    }),
    uploadedFileCount: 0,
  });
});

describe("account-scoped automations", () => {
  it("creates a deterministic, content-safe private workspace briefing", () => {
    const briefing = buildWorkspaceBriefing({
      workspace: { name: "Private Nova" },
      folders: [{ name: "Projects" }],
      files: [
        { name: "launch.md", mimeType: "text/markdown", updatedAt: new Date("2026-08-18T07:00:00.000Z") },
        { name: "notes.txt", mimeType: "text/plain", updatedAt: new Date("2026-08-18T06:00:00.000Z") },
      ],
      chats: [{ title: "Launch planning", updatedAt: new Date("2026-08-18T07:30:00.000Z") }],
      settings: { workspaceRules: "Keep reports concise." },
    }, now);

    expect(briefing).toContain("# Daily workspace briefing");
    expect(briefing).toContain("Private Nova");
    expect(briefing).toContain("launch.md (text/markdown)");
    expect(briefing).toContain("Launch planning");
    expect(briefing).toContain("Keep reports concise.");
    expect(getAutomationRunKey("workspace_digest", now)).toBe("workspace_digest:2026-08-18");
  });

  it("writes a run and artifact only to the authenticated account workspace", async () => {
    db.listAutomationRecordsForUser.mockResolvedValue([
      { id: 9, ownerId: 7, workspaceId: 31, kind: "workspace_digest", enabled: true, lastRunAt: null },
    ]);
    db.claimAutomationRun.mockResolvedValue({ id: 12 });
    db.getWorkspaceComputer.mockResolvedValue({
      workspace: { name: "Owner space", persistentSandboxId: "sbx-owner-7" },
      folders: [],
      files: [],
      chats: [],
      settings: {},
    });
    db.createWorkspaceFileForUser.mockResolvedValue({ id: 44 });

    await expect(runDueAutomationsForUser(7, now)).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(db.getOrCreateWorkspace).toHaveBeenCalledWith(7);
    expect(db.listAutomationRecordsForUser).toHaveBeenCalledWith(7);
    expect(db.claimAutomationRun).toHaveBeenCalledWith({ automationId: 9, ownerId: 7, workspaceId: 31, runKey: "workspace_digest:2026-08-18" });
    expect(db.getWorkspaceComputer).toHaveBeenCalledWith(7);
    expect(e2b.runE2BTaskInPersistentSandbox).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId: 31,
      ownerId: 7,
      code: expect.stringContaining("artifact_path.write_text"),
    }));
    expect(db.createWorkspaceFileForUser).toHaveBeenCalledWith(7, {
      name: "daily-workspace-briefing-2026-08-18.md",
      content: "# Daily workspace briefing\n\nGenerated inside the E2B sandbox.\n",
      mimeType: "text/markdown",
    });
    expect(db.updateAutomationRun).toHaveBeenCalledWith(expect.objectContaining({ automationId: 9, ownerId: 7, workspaceId: 31, runId: 12, artifactFileId: 44, status: "succeeded" }));
    expect(db.updateAutomationScheduleState).toHaveBeenCalledWith(expect.objectContaining({ automationId: 9, ownerId: 7, workspaceId: 31, lastError: null }));
  });

  it("runs a scheduled callback only for the automation record authenticated by its opaque task ID", async () => {
    db.getAutomationForScheduleTask.mockResolvedValue({
      id: 9,
      ownerId: 7,
      workspaceId: 31,
      kind: "workspace_digest",
      enabled: true,
      lastRunAt: null,
    });
    db.claimAutomationRun.mockResolvedValue({ id: 12 });
    db.getWorkspaceComputer.mockResolvedValue({
      workspace: { name: "Owner space", persistentSandboxId: "sbx-owner-7" },
      folders: [],
      files: [],
      chats: [],
      settings: {},
    });
    db.createWorkspaceFileForUser.mockResolvedValue({ id: 44 });

    await expect(runAutomationForScheduleTask("task_private_owner_7", now)).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(db.getAutomationForScheduleTask).toHaveBeenCalledWith("task_private_owner_7");
    expect(db.listAutomationRecordsForUser).not.toHaveBeenCalled();
    expect(db.getOrCreateWorkspace).not.toHaveBeenCalled();
    expect(db.claimAutomationRun).toHaveBeenCalledWith({ automationId: 9, ownerId: 7, workspaceId: 31, runKey: "workspace_digest:2026-08-18" });
    expect(db.createWorkspaceFileForUser).toHaveBeenCalledWith(7, expect.any(Object));
  });

  it("does not rerun a duplicate request for the same account and day", async () => {
    db.listAutomationRecordsForUser.mockResolvedValue([
      { id: 9, ownerId: 7, workspaceId: 31, kind: "workspace_digest", enabled: true, lastRunAt: null },
    ]);
    db.claimAutomationRun.mockResolvedValue(undefined);

    await expect(runDueAutomationsForUser(7, now)).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 1 });
    expect(db.getWorkspaceComputer).not.toHaveBeenCalled();
    expect(db.createWorkspaceFileForUser).not.toHaveBeenCalled();
  });

  it("skips a disabled automation without reading or writing workspace data", async () => {
    db.listAutomationRecordsForUser.mockResolvedValue([
      { id: 9, ownerId: 7, workspaceId: 31, kind: "workspace_digest", enabled: false, lastRunAt: null },
    ]);

    await expect(runDueAutomationsForUser(7, now)).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 1 });
    expect(db.claimAutomationRun).not.toHaveBeenCalled();
    expect(db.getWorkspaceComputer).not.toHaveBeenCalled();
  });
});
