import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTerminalStatusForUser,
  readTerminalForUser,
  resetTerminalSessionsForTests,
  resizeTerminalForUser,
  startTerminalForUser,
  stopTerminalForUser,
  writeTerminalForUser,
} from "./terminal";

/** Fake PTY that records calls and can emit output bytes on demand. */
type FakePty = {
  created: Array<Record<string, unknown>>;
  inputs: Array<{ pid: number; data: string }>;
  resizes: Array<{ pid: number; size: { cols: number; rows: number } }>;
  kills: number[];
  create: (opts: Record<string, unknown>) => Promise<{ pid: number }>;
  sendInput: (pid: number, data: string) => Promise<void>;
  resize: (pid: number, size: { cols: number; rows: number }) => Promise<void>;
  kill: (pid: number) => Promise<boolean>;
  emit: (data: Uint8Array | string) => void;
};

function makeFakePty(pid = 421): FakePty {
  let onData: ((data: Uint8Array) => void) | undefined;
  const encode = (chunk: string) => new TextEncoder().encode(chunk);
  return {
    created: [],
    inputs: [],
    resizes: [],
    kills: [],
    async create(opts) {
      this.created.push(opts);
      onData = opts.onData as (data: Uint8Array) => void;
      return { pid };
    },
    async sendInput(target, data) {
      this.inputs.push({ pid: target, data });
    },
    async resize(target, size) {
      this.resizes.push({ pid: target, size });
    },
    async kill(target) {
      this.kills.push(target);
      return true;
    },
    emit: chunk => onData?.(typeof chunk === "string" ? encode(chunk) : chunk),
  };
}

const state = vi.hoisted(() => ({
  pty: makeFakePty(),
  client: undefined as { create: unknown; connect: unknown } | undefined,
  sandbox: { sandboxId: "sbx-live", commands: { run: vi.fn(async () => ({})) } },
  persisted: 0,
}));

vi.mock("./e2b", async importOriginal => {
  const actual = await importOriginal<typeof import("./e2b")>();
  return {
    ...actual,
    E2B_WORKSPACE_DIR: actual.E2B_WORKSPACE_DIR,
    ensureE2BWorkspaceDir: vi.fn(async () => {}),
    ensurePersistentSandbox: vi.fn(async () => state.sandbox),
    getE2BClient: vi.fn(() => state.client),
  };
});

vi.mock("./db", () => ({
  getWorkspaceComputer: vi.fn(async () => ({ workspace: { id: 3, persistentSandboxId: "sbx-live" } })),
}));

vi.mock("./workspaceSync", () => ({
  persistE2BWorkspace: vi.fn(async (ownerId: number) => {
    state.persisted += 1;
    return { ownerId, imported: 4 };
  }),
}));

function configure(configured = true) {
  state.client = configured
    ? { create: vi.fn(), connect: vi.fn(async () => state.sandbox) }
    : undefined;
  state.pty = makeFakePty();
  (state.sandbox as { pty?: unknown }).pty = state.pty;
}

beforeEach(() => {
  resetTerminalSessionsForTests();
  state.persisted = 0;
  configure(true);
});

describe("terminal sessions", () => {
  it("creates a PTY in the workspace directory and streams output", async () => {
    const started = await startTerminalForUser(1, { cols: 120, rows: 30 });
    expect(started).toMatchObject({ reused: false, ptyId: 421, offset: 0, seq: 0 });
    expect(state.pty.created[0]).toMatchObject({ cols: 120, rows: 30, cwd: "/home/user/workspace" });

    state.pty.emit("$ whoami\r\n");
    const read = readTerminalForUser(1, 0);
    expect(read).toMatchObject({ active: true, seq: 10, data: "$ whoami\r\n", reset: false });
    // Only the bytes after sinceSeq come back.
    expect(readTerminalForUser(1, 7)).toMatchObject({ data: "i\r\n", seq: 10 });
  });

  it("reuses the live session instead of spawning a second shell", async () => {
    await startTerminalForUser(1, { cols: 100, rows: 25 });
    state.pty.emit("first\r\n");
    const again = await startTerminalForUser(1, { cols: 100, rows: 25 });
    expect(again).toMatchObject({ reused: true, ptyId: 421 });
    // The full retained scrollback is returned for the reattached tab.
    expect(again.output).toBe("first\r\n");
    expect(state.pty.created).toHaveLength(1);
  });

  it("forwards typed input and resizes to the PTY", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    await writeTerminalForUser(1, "ls -la\n");
    expect(state.pty.inputs).toEqual([{ pid: 421, data: "ls -la\n" }]);
    await resizeTerminalForUser(1, { cols: 140, rows: 40 });
    expect(state.pty.resizes).toEqual([{ pid: 421, size: { cols: 140, rows: 40 } }]);
    expect(getTerminalStatusForUser(1)).toMatchObject({ active: true, cols: 140, rows: 40 });
  });

  it("closes the shell and imports terminal-created files into Files", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    const stopped = await stopTerminalForUser(1);
    expect(stopped).toMatchObject({ success: true });
    expect(state.pty.kills).toEqual([421]);
    expect(state.persisted).toBe(1);
    expect(readTerminalForUser(1, 0)).toMatchObject({ active: false });
    await expect(stopTerminalForUser(1)).resolves.toMatchObject({ success: false });
  });

  it("reports the friendly error when E2B is not configured", async () => {
    configure(false);
    await expect(startTerminalForUser(1, { cols: 80, rows: 24 })).rejects.toThrow(/E2B is not connected/);
  });

  it("refuses writes and oversized input when no session is open", async () => {
    await expect(writeTerminalForUser(1, "ls")).rejects.toThrow(/Open the terminal/);
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    await expect(writeTerminalForUser(1, "x".repeat(9000))).rejects.toThrow(/too large/);
  });

  it("trims scrollback and flags the reset so the client can resync", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    // Push past the 256 KB retained window.
    state.pty.emit("x".repeat(300_000));
    const read = readTerminalForUser(1, 100);
    expect(read.reset).toBe(true);
    expect(read.offset).toBeGreaterThan(0);
    expect(read.data.length).toBeLessThanOrEqual(262_144);
    // A client that already has the tail keeps streaming incrementally.
    expect(readTerminalForUser(1, read.seq)).toMatchObject({ data: "", reset: false });
  });

  it("keeps one owner's session isolated from another user", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    expect(getTerminalStatusForUser(2)).toMatchObject({ active: false });
    await expect(writeTerminalForUser(2, "ls")).rejects.toThrow(/Open the terminal/);
    await expect(stopTerminalForUser(2)).resolves.toMatchObject({ success: false });
  });
});
