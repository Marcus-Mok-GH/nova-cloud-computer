import { describe, expect, it, vi, beforeEach } from "vitest";

// The E2B SDK is never loaded in the test worker.
vi.mock("./e2b", () => ({
  getE2BClient: vi.fn(() => ({ connect: vi.fn() })),
  isE2BConfigured: vi.fn(() => true),
  runE2BTaskInPersistentSandbox: vi.fn(async () => ({
    sandboxId: "sbx-vm",
    output: "Computation complete: 42",
    uploadedFileCount: 2,
  })),
  ensurePersistentSandbox: vi.fn(async () => "sbx-vm"),
  getE2BSandboxStatus: vi.fn(),
  buildE2BWorkspaceBundle: vi.fn(() => ({ uploads: [] })),
  withE2BWorkspaceLock: vi.fn((_owner, _workspace, operation) => operation()),
}));

vi.mock("./workspaceSync", () => ({
  persistE2BWorkspace: vi.fn(async () => 3),
  restoreWorkspaceToE2B: vi.fn(),
}));

const createWorkspaceFileForUser = vi.fn();
const updateAgentVmRunForUser = vi.fn(async (_owner, _runId, input) => ({
  id: 5,
  task: "the task",
  status: input.status,
  resultSummary: input.resultSummary ?? null,
  errorMessage: input.errorMessage ?? null,
  artifactFileId: input.artifactFileId ?? null,
}));
const updateWorkspacePersistentSandbox = vi.fn(async () => true);

vi.mock("./db", () => ({
  createAgentVmRunForUser: vi.fn(async () => ({ id: 5, task: "the task", status: "queued" })),
  createWorkspaceFileForUser,
  getWorkspaceComputer: vi.fn(async () => ({
    workspace: { id: 31, persistentSandboxId: "sbx-vm" },
    files: [],
    folders: [],
  })),
  getStoredWorkspaceSandboxId: vi.fn(async () => ({ persistentSandboxId: "sbx-vm" })),
  listAgentVmRunsForUser: vi.fn(async () => []),
  updateAgentVmRunForUser,
  updateWorkspacePersistentSandbox,
}));

const { startAgentVmRun } = await import("./agentVm");

describe("agent VM run artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores the full output on the run record instead of a nova-run workspace file", async () => {
    const result = await startAgentVmRun(1, { task: "compute the answer" });
    expect(result.configured).toBe(true);
    // No nova-run-<id>.txt is written to the workspace anymore: the run
    // record is the storage, so the file tree stays clean.
    expect(createWorkspaceFileForUser).not.toHaveBeenCalled();
    const [owner, runId, input] = updateAgentVmRunForUser.mock.calls.at(-1);
    expect(owner).toBe(1);
    expect(runId).toBe(5);
    expect(input.resultSummary).toBe("Computation complete: 42");
    expect(input.artifactFileId).toBeUndefined();
    // The tool result still carries the output excerpt for the model.
    expect(result.message).toContain("Computation complete: 42");
  });

  it("does not write a workspace artifact on a failed run either", async () => {
    const { runE2BTaskInPersistentSandbox } = await import("./e2b");
    vi.mocked(runE2BTaskInPersistentSandbox).mockRejectedValueOnce(
      new Error("sandbox exploded")
    );
    const result = await startAgentVmRun(1, { task: "compute the answer" });
    expect(result.run).toMatchObject({ status: "failed" });
    expect(createWorkspaceFileForUser).not.toHaveBeenCalled();
  });
});
