import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  claimAutomationRun: vi.fn(),
  createWorkspaceFileForUser: vi.fn(),
  getOrCreateWorkspace: vi.fn(),
  getWorkspaceComputer: vi.fn(),
  listAutomationsForUser: vi.fn(),
  updateAutomationRun: vi.fn(),
  updateAutomationScheduleState: vi.fn(),
};

vi.mock("./db", () => db);

const { buildWorkspaceBriefing, getAutomationRunKey, runDueAutomationsForUser } = await import("./automations");

const now = new Date("2026-08-18T08:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.getOrCreateWorkspace.mockResolvedValue({ id: 31, ownerId: 7 });
  db.listAutomationsForUser.mockResolvedValue([]);
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
    db.listAutomationsForUser.mockResolvedValue([
      { id: 9, kind: "workspace_digest", enabled: true, lastRunAt: null },
    ]);
    db.claimAutomationRun.mockResolvedValue({ id: 12 });
    db.getWorkspaceComputer.mockResolvedValue({
      workspace: { name: "Owner space" },
      folders: [],
      files: [],
      chats: [],
      settings: {},
    });
    db.createWorkspaceFileForUser.mockResolvedValue({ id: 44 });

    await expect(runDueAutomationsForUser(7, now)).resolves.toEqual({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(db.getOrCreateWorkspace).toHaveBeenCalledWith(7);
    expect(db.listAutomationsForUser).toHaveBeenCalledWith(7);
    expect(db.claimAutomationRun).toHaveBeenCalledWith({ automationId: 9, workspaceId: 31, runKey: "workspace_digest:2026-08-18" });
    expect(db.getWorkspaceComputer).toHaveBeenCalledWith(7);
    expect(db.createWorkspaceFileForUser).toHaveBeenCalledWith(7, expect.objectContaining({ name: "daily-workspace-briefing-2026-08-18.md", mimeType: "text/markdown" }));
    expect(db.updateAutomationRun).toHaveBeenCalledWith(expect.objectContaining({ automationId: 9, workspaceId: 31, runId: 12, artifactFileId: 44, status: "succeeded" }));
    expect(db.updateAutomationScheduleState).toHaveBeenCalledWith(expect.objectContaining({ automationId: 9, workspaceId: 31, lastError: null }));
  });

  it("does not rerun a duplicate in-app request for the same account and day", async () => {
    db.listAutomationsForUser.mockResolvedValue([
      { id: 9, kind: "workspace_digest", enabled: true, lastRunAt: null },
    ]);
    db.claimAutomationRun.mockResolvedValue(undefined);

    await expect(runDueAutomationsForUser(7, now)).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 1 });
    expect(db.getWorkspaceComputer).not.toHaveBeenCalled();
    expect(db.createWorkspaceFileForUser).not.toHaveBeenCalled();
  });

  it("skips a disabled automation without reading or writing workspace data", async () => {
    db.listAutomationsForUser.mockResolvedValue([
      { id: 9, kind: "workspace_digest", enabled: false, lastRunAt: null },
    ]);

    await expect(runDueAutomationsForUser(7, now)).resolves.toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 1 });
    expect(db.claimAutomationRun).not.toHaveBeenCalled();
    expect(db.getWorkspaceComputer).not.toHaveBeenCalled();
  });
});
