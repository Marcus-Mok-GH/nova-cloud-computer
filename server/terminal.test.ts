import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalError } from "./terminal";
import {
  getTerminalStatusForUser,
  readTerminalForUser,
  resetTerminalSessionsForTests,
  resizeTerminalForUser,
  startTerminalForUser,
  stopTerminalForUser,
  writeTerminalForUser,
} from "./terminal";

/** Fake PTY that records calls, can emit output bytes, and supports exit waits. */
type FakePty = {
  created: Array<Record<string, unknown>>;
  inputs: Array<{ pid: number; data: string }>;
  resizes: Array<{ pid: number; size: { cols: number; rows: number } }>;
  kills: number[];
  failKill: boolean;
  failResize: boolean;
  nextPid: number;
  waiters: Map<number, Array<() => void>>;
  create: (opts: Record<string, unknown>) => Promise<{ pid: number; wait: () => Promise<unknown> }>;
  sendInput: (pid: number, data: string) => Promise<void>;
  resize: (pid: number, size: { cols: number; rows: number }) => Promise<void>;
  kill: (pid: number) => Promise<boolean>;
  emit: (data: Uint8Array | string) => void;
  exit: (pid: number) => void;
};

function makeFakePty(basePid = 421): FakePty {
  let onData: ((data: Uint8Array) => void) | undefined;
  const encode = (chunk: string) => new TextEncoder().encode(chunk);
  const pty: FakePty = {
    created: [],
    inputs: [],
    resizes: [],
    kills: [],
    failKill: false,
    failResize: false,
    nextPid: basePid,
    waiters: new Map(),
    async create(opts) {
      this.created.push(opts);
      onData = opts.onData as (data: Uint8Array) => void;
      const pid = ++this.nextPid - 1;
      return {
        pid,
        wait: () =>
          new Promise(resolve => {
            const list = this.waiters.get(pid) ?? [];
            list.push(resolve);
            this.waiters.set(pid, list);
          }),
      };
    },
    async sendInput(target, data) {
      this.inputs.push({ pid: target, data });
    },
    async resize(target, size) {
      this.resizes.push({ pid: target, size });
      if (this.failResize) throw new Error("sandbox refused resize");
    },
    async kill(target) {
      this.kills.push(target);
      if (this.failKill) throw new Error("sandbox refused kill");
      return true;
    },
    emit: chunk => onData?.(typeof chunk === "string" ? encode(chunk) : chunk),
    exit(pid) {
      const list = this.waiters.get(pid) ?? [];
      this.waiters.set(pid, []);
      list.forEach(resolve => resolve());
    },
  };
  return pty;
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

/** Settles the PTY exit observer's microtask chain so cleanup assertions are deterministic. */
async function settle() {
  await new Promise(resolve => setTimeout(resolve, 0));
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
    // Only the code units after sinceSeq come back.
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

  it("deduplicates concurrent starts into a single PTY", async () => {
    const [a, b] = await Promise.all([
      startTerminalForUser(1, { cols: 80, rows: 24 }),
      startTerminalForUser(1, { cols: 100, rows: 30 }),
    ]);
    expect(a).toMatchObject({ reused: false, ptyId: 421 });
    expect(b).toMatchObject({ ptyId: 421 });
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

  it("keeps the previous dimensions when the PTY refuses a resize", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    state.pty.failResize = true;
    await expect(resizeTerminalForUser(1, { cols: 140, rows: 40 })).rejects.toThrow();
    expect(getTerminalStatusForUser(1)).toMatchObject({ cols: 80, rows: 24 });
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

  it("retains the session when the PTY kill request fails, so the user can retry", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    state.pty.failKill = true;
    await expect(stopTerminalForUser(1)).rejects.toBeInstanceOf(TerminalError);
    expect(getTerminalStatusForUser(1)).toMatchObject({ active: true, ptyId: 421 });
    state.pty.failKill = false;
    await expect(stopTerminalForUser(1)).resolves.toMatchObject({ success: true });
  });

  it("cleans up automatically when the shell exits on its own", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    state.pty.emit("bye\r\n");
    state.pty.exit(421);
    await settle();
    expect(getTerminalStatusForUser(1)).toMatchObject({ active: false });
    expect(state.persisted).toBe(1);
  });

  it("ignores a stale shell exit after a newer session took over", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    await stopTerminalForUser(1);
    await startTerminalForUser(1, { cols: 90, rows: 26 });
    const replacement = getTerminalStatusForUser(1);
    expect(replacement).toMatchObject({ active: true });
    // The first shell's late exit must not disturb the replacement session.
    state.pty.exit(421);
    await settle();
    expect(getTerminalStatusForUser(1)).toMatchObject({ active: true, ptyId: replacement.ptyId });
  });

  it("reports the friendly error when E2B is not configured", async () => {
    configure(false);
    await expect(startTerminalForUser(1, { cols: 80, rows: 24 })).rejects.toThrow(/E2B is not connected/);
  });

  it("refuses writes and oversized input when no session is open", async () => {
    await expect(writeTerminalForUser(1, "ls")).rejects.toBeInstanceOf(TerminalError);
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    await expect(writeTerminalForUser(1, "x".repeat(9000))).rejects.toThrow(/too large/);
  });

  it("trims scrollback at code-point boundaries within the UTF-8 byte cap", async () => {
    await startTerminalForUser(1, { cols: 80, rows: 24 });
    // Multibyte (3-byte) plus astral (4-byte) output pushes past the 256 KB cap.
    state.pty.emit("€".repeat(120_000));
    state.pty.emit("😀".repeat(30_000));
    const read = readTerminalForUser(1, 100);
    expect(read.reset).toBe(true);
    expect(Buffer.byteLength(read.data, "utf8")).toBeLessThanOrEqual(262_144);
    // The retained window starts on a whole code point, never a lone surrogate.
    const firstUnit = read.data.charCodeAt(0);
    expect(firstUnit & 0xfc00).not.toBe(0xdc00);
    expect(read.data.codePointAt(0)).toBeGreaterThan(0);
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
