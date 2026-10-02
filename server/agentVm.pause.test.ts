import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A standalone agent VM run (started from the VM panel, not from inside an
 * agent run) must pause the persistent sandbox when it finishes so an idle
 * machine is not billed. A run invoked as an agent tool call (`skipRestore`)
 * must leave the sandbox warm for the rest of that agent run.
 */
const state = vi.hoisted(() => ({
  sandbox: {
    sandboxId: "sbx-1",
    pause: vi.fn(async () => true),
    files: {},
    commands: { run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })) },
  },
  failPersist: false,
}));

const pauseE2BSandbox = vi.hoisted(() => vi.fn(async () => true));
const pauseAgentSandbox = vi.hoisted(() => vi.fn(async () => true));

vi.mock("./e2b", () => ({
  getE2BClient: vi.fn(() => ({
    create: vi.fn(),
    connect: vi.fn(async () => state.sandbox),
  })),
  isE2BConfigured: vi.fn(() => true),
  pauseE2BSandbox,
  runE2BTaskInPersistentSandbox: vi.fn(async () => ({
    sandboxId: "sbx-1",
    output: "done",
    uploadedFileCount: 1,
  })),
  ensurePersistentSandbox: vi.fn(async () => state.sandbox),
  getE2BSandboxStatus: vi.fn(async () => "active" as const),
  withE2BWorkspaceLock: vi.fn((_owner, _workspace, operation) => operation()),
  buildE2BWorkspaceBundle: vi.fn(() => ({ manifest: [], uploads: [] })),
}));

vi.mock("./workspaceSync", () => ({
  restoreWorkspaceToE2B: vi.fn(async () => 1),
  persistE2BWorkspace: vi.fn(async () => {
    if (state.failPersist) throw new Error("sync failed");
    return 2;
  }),
}));

vi.mock("./sandboxWorkspace", () => ({ pauseAgentSandbox }));

vi.mock("./db", () => ({
  getWorkspaceComputer: vi.fn(async () => ({
    workspace: { id: 31, persistentSandboxId: "sbx-1" },
    files: [],
    folders: [],
  })),
  getStoredWorkspaceSandboxId: vi.fn(async () => ({
    persistentSandboxId: "sbx-1",
  })),
  createAgentVmRunForUser: vi.fn(async () => ({ id: 9, task: "t" })),
  createWorkspaceFileForUser: vi.fn(async () => ({ id: 44 })),
  listAgentVmRunsForUser: vi.fn(async () => []),
  updateAgentVmRunForUser: vi.fn(async (_owner, _id, input) => ({
    id: 9,
    ...input,
  })),
  updateWorkspacePersistentSandbox: vi.fn(async () => undefined),
}));

const { startAgentVmRun } = await import("./agentVm");

beforeEach(() => {
  state.failPersist = false;
  pauseE2BSandbox.mockClear();
  pauseAgentSandbox.mockClear();
  state.sandbox.pause.mockClear();
});

describe("standalone agent VM runs pause when finished", () => {
  it("pauses the sandbox after a run the user started from the VM panel", async () => {
    await startAgentVmRun(7, { task: "process the files" }, { pauseWhenDone: true });
    expect(pauseE2BSandbox).toHaveBeenCalledWith(state.sandbox);
  });

  it("leaves the sandbox warm for a run invoked inside an agent run", async () => {
    await startAgentVmRun(7, { task: "process the files" }, { skipRestore: true });
    expect(pauseE2BSandbox).not.toHaveBeenCalled();
    expect(pauseAgentSandbox).not.toHaveBeenCalled();
  });

  it("pauses even when the run fails, so the idle machine is not billed", async () => {
    state.failPersist = true;
    const result = await startAgentVmRun(
      7,
      { task: "process the files" },
      { pauseWhenDone: true }
    );
    expect(result.run).toMatchObject({ status: "failed" });
    expect(pauseAgentSandbox).toHaveBeenCalledWith(7, 31, state.sandbox);
  });
});
