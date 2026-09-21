import {
  E2B_WORKSPACE_DIR,
  ensureE2BWorkspaceDir,
  ensurePersistentSandbox,
  getE2BClient,
} from "./e2b";
import { getWorkspaceComputer } from "./db";
import { persistE2BWorkspace } from "./workspaceSync";

/**
 * Direct terminal access to the workspace's persistent agent VM (E2B). A
 * pseudo-terminal is attached to the live sandbox so the user can run shell
 * commands in the same environment the agent works in. The PTY lives in the
 * sandbox; this server-side session keeps the output stream (bounded
 * scrollback) so a closed tab can reattach without losing history.
 *
 * Sessions are in-memory and owner-scoped: one live terminal per workspace,
 * kept alive while the Nova server runs or until the user closes it.
 */

const TERMINAL_OUTPUT_CAP_BYTES = 262_144; // 256 KB of scrollback retained
const TERMINAL_MAX_INPUT_BYTES = 8192;

type TerminalSession = {
  sandboxId: string;
  ptyId: number;
  cols: number;
  rows: number;
  /** Byte offset of `output[0]` in the logical stream (front trims move it). */
  offset: number;
  output: string;
  decoder: TextDecoder;
  lastUsedAt: number;
  sendInput: (data: string) => Promise<void>;
  resize: (size: { cols: number; rows: number }) => Promise<void>;
  kill: () => Promise<boolean>;
};

const sessions = new Map<number, TerminalSession>();

type TerminalPtyHandle = { pid: number };

function appendOutput(session: TerminalSession, data: Uint8Array) {
  session.output += session.decoder.decode(data, { stream: true });
  session.lastUsedAt = Date.now();
  if (session.output.length > TERMINAL_OUTPUT_CAP_BYTES) {
    const excess = session.output.length - TERMINAL_OUTPUT_CAP_BYTES;
    session.output = session.output.slice(excess);
    session.offset += excess;
  }
}

function describeTerminalError(error: unknown) {
  return (
    error instanceof Error && error.message
      ? error.message
      : "Nova could not reach the agent VM terminal."
  );
}

/** True when the workspace has a live terminal session (reattachable). */
export function getTerminalStatusForUser(ownerId: number) {
  const session = sessions.get(ownerId);
  return {
    active: Boolean(session),
    ptyId: session?.ptyId ?? null,
    cols: session?.cols ?? null,
    rows: session?.rows ?? null,
    seq: session ? session.offset + session.output.length : 0,
  };
}

/**
 * Opens (or reattaches to) the workspace terminal. Returns the current
 * scrollback so a reopened tab instantly shows recent output.
 */
export async function startTerminalForUser(
  ownerId: number,
  size: { cols: number; rows: number }
) {
  const existing = sessions.get(ownerId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return {
      reused: true as const,
      ptyId: existing.ptyId,
      offset: existing.offset,
      seq: existing.offset + existing.output.length,
      output: existing.output,
    };
  }

  const client = getE2BClient();
  if (!client) {
    throw new Error(
      "E2B is not connected yet. An administrator must add the server-only E2B API key before Nova can open a terminal."
    );
  }
  const computer = await getWorkspaceComputer(ownerId);
  // The terminal works on the live sandbox state; restoring Neon's stored
  // files here would wipe whatever the agent or the user changed live.
  const sandbox = await ensurePersistentSandbox(
    client,
    computer.workspace.id,
    ownerId,
    computer.workspace.persistentSandboxId
  );
  await ensureE2BWorkspaceDir(sandbox);
  const pty = (sandbox as { pty?: any }).pty;
  if (!pty) {
    throw new Error(
      "The agent VM template does not expose terminals. Ask an administrator to enable the terminal-enabled E2B template."
    );
  }

  let session: TerminalSession | null = null;
  const handle: TerminalPtyHandle = await pty.create({
    cols: size.cols,
    rows: size.rows,
    cwd: E2B_WORKSPACE_DIR,
    onData: (data: Uint8Array) => {
      if (session) appendOutput(session, data);
    },
  });
  session = {
    sandboxId: sandbox.sandboxId,
    ptyId: handle.pid,
    cols: size.cols,
    rows: size.rows,
    offset: 0,
    output: "",
    decoder: new TextDecoder(),
    lastUsedAt: Date.now(),
    sendInput: (data: string) => pty.sendInput(handle.pid, data),
    resize: (next: { cols: number; rows: number }) => pty.resize(handle.pid, next),
    kill: () => pty.kill(handle.pid),
  };
  sessions.set(ownerId, session);
  return {
    reused: false as const,
    ptyId: handle.pid,
    offset: 0,
    seq: 0,
    output: "",
  };
}

/** New terminal bytes since `sinceSeq` in the logical output stream. */
export function readTerminalForUser(ownerId: number, sinceSeq: number) {
  const session = sessions.get(ownerId);
  if (!session) return { active: false as const, offset: 0, seq: 0, data: "", reset: false };
  session.lastUsedAt = Date.now();
  const since = Math.max(0, Math.floor(sinceSeq));
  // The client's view fell behind the retained window: resend everything we
  // still have and flag it so the client can reset its terminal view.
  const reset = since < session.offset;
  const from = reset ? session.offset : since;
  return {
    active: true as const,
    offset: session.offset,
    seq: session.offset + session.output.length,
    data: session.output.slice(from - session.offset),
    reset,
  };
}

/** Sends typed keys (or pasted text) to the PTY. */
export async function writeTerminalForUser(ownerId: number, data: string) {
  const session = sessions.get(ownerId);
  if (!session) {
    throw new Error("Open the terminal before typing into it.");
  }
  if (new TextEncoder().encode(data).length > TERMINAL_MAX_INPUT_BYTES) {
    throw new Error("That terminal input was too large. Paste smaller chunks.");
  }
  session.lastUsedAt = Date.now();
  await session.sendInput(data);
}

/** Matches the PTY to the client's terminal size. */
export async function resizeTerminalForUser(
  ownerId: number,
  size: { cols: number; rows: number }
) {
  const session = sessions.get(ownerId);
  if (!session) return { resized: false as const };
  session.cols = size.cols;
  session.rows = size.rows;
  session.lastUsedAt = Date.now();
  await session.resize(size);
  return { resized: true as const };
}

/**
 * Closes the live shell. Files created in the terminal session are imported
 * back into Neon Postgres (best-effort) so they show up in Files.
 */
export async function stopTerminalForUser(ownerId: number) {
  const session = sessions.get(ownerId);
  if (!session) return { success: false as const };
  sessions.delete(ownerId);
  await session.kill().catch(() => false);
  try {
    const client = getE2BClient();
    if (client) {
      const sandbox = await client.connect(session.sandboxId);
      await persistE2BWorkspace(ownerId, sandbox);
    }
  } catch (error) {
    console.warn(
      `[terminal] could not import terminal-created files into Neon: ${describeTerminalError(error)}`
    );
  }
  return { success: true as const };
}

/** Test seam: drop all in-memory sessions between tests. */
export function resetTerminalSessionsForTests() {
  sessions.clear();
}
