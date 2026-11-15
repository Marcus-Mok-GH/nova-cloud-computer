import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The workspace sandbox is shared: the terminal attaches a PTY inside the same
 * persistent machine the agent run uses. Pausing that machine freezes it and
 * kills every PTY on it, so an agent run finishing in another tab silently
 * ends the user's open shell — it "exits for no reason" from the terminal's
 * point of view.
 *
 * This pins the guard: while a terminal session is live for an owner, the
 * end-of-run pause must not touch that owner's sandbox.
 */
const pauseE2BSandbox = vi.hoisted(() => vi.fn(async () => true));

vi.mock("./e2b", () => ({
  E2B_WORKSPACE_DIR: "/home/user/workspace",
  ensureE2BWorkspaceDir: vi.fn(async () => {}),
  ensurePersistentSandbox: vi.fn(async () => ({ sandboxId: "sbx-live" })),
  getE2BClient: vi.fn(() => ({ create: vi.fn(), connect: vi.fn(async () => ({ sandboxId: "sbx-live" })) })),
  isE2BConfigured: vi.fn(() => true),
  pauseE2BSandbox,
  withE2BWorkspaceLock: vi.fn((_owner: number, _workspace: number, operation: () => unknown) => operation()),
}));

vi.mock("./workspace/workspaceSync", () => ({
  persistE2BWorkspace: vi.fn(async () => ({ imported: 0 })),
  restoreWorkspaceToE2B: vi.fn(async () => 0),
}));

vi.mock("./db", () => ({
  hasActiveAccessForUser: vi.fn(async () => true),
  getWorkspaceComputer: vi.fn(async () => ({ workspace: { id: 3, persistentSandboxId: "sbx-live" } })),
}));

import { pauseAgentSandbox } from "./sandboxWorkspace";
import { markTerminalSessionOpen, markTerminalSessionClosed, resetSandboxLivenessForTests } from "./sandboxLiveness";

const sandbox = { sandboxId: "sbx-live", pause: vi.fn(async () => true), commands: { run: vi.fn(async () => ({})) } };

beforeEach(() => {
  resetSandboxLivenessForTests();
  pauseE2BSandbox.mockClear();
});

describe("end-of-run sandbox pause vs a live terminal", () => {
  it("pauses when no terminal session is open", async () => {
    const paused = await pauseAgentSandbox(1, 3, sandbox);
    expect(paused).toBe(true);
    expect(pauseE2BSandbox).toHaveBeenCalledTimes(1);
  });

  it("does not pause while the owner has a live terminal session", async () => {
    markTerminalSessionOpen(1);
    const paused = await pauseAgentSandbox(1, 3, sandbox);
    // The machine must stay warm: pausing it would kill the open shell.
    expect(paused).toBe(false);
    expect(pauseE2BSandbox).not.toHaveBeenCalled();
  });

  it("pauses again once the terminal session has ended", async () => {
    markTerminalSessionOpen(1);
    await pauseAgentSandbox(1, 3, sandbox);
    markTerminalSessionClosed(1);
    const paused = await pauseAgentSandbox(1, 3, sandbox);
    expect(paused).toBe(true);
    expect(pauseE2BSandbox).toHaveBeenCalledTimes(1);
  });

  it("keeps owners isolated: another owner's terminal never keeps this sandbox warm", async () => {
    markTerminalSessionOpen(2);
    const paused = await pauseAgentSandbox(1, 3, sandbox);
    expect(paused).toBe(true);
    expect(pauseE2BSandbox).toHaveBeenCalledTimes(1);
  });
});
