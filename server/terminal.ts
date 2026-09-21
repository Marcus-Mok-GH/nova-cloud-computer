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
 *
 * Stream positions (`offset`, `seq`, `sinceSeq`) count UTF-16 code units of
 * the decoded output stream, matching JavaScript's String.slice semantics.
 */

const TERMINAL_OUTPUT_CAP_BYTES = 262_144; // 256 KB of scrollback retained
const TERMINAL_MAX_INPUT_BYTES = 8192;

/**
 * A terminal failure that is safe to show to the calling user as-is. Any
 * error that is NOT a TerminalError is treated as unexpected and mapped to a
 * generic message by the router, so E2B/network internals never leak.
 */
export class TerminalError extends Error {
  readonly kind: "precondition" | "bad_request";
  constructor(message: string, kind: "precondition" | "bad_request" = "bad_request") {
    super(message);
    this.name = "TerminalError";
    this.kind = kind;
  }
}

type TerminalSession = {
  sandboxId: string;
  ptyId: number;
  cols: number;
  rows: number;
  /** UTF-16 code-unit offset of `output[0]` in the logical stream (front trims move it). */
  offset: number;
  output: string;
  /** UTF-8 byte size of `output`, tracked incrementally for the trim loop. */
  bytes: number;
  decoder: TextDecoder;
  lastUsedAt: number;
  sendInput: (data: string) => Promise<void>;
  resize: (size: { cols: number; rows: number }) => Promise<void>;
  kill: () => Promise<boolean>;
};

type TerminalStartResult = {
  reused: boolean;
  ptyId: number;
  offset: number;
  seq: number;
  output: string;
};

const sessions = new Map<number, TerminalSession>();
const pendingStarts = new Map<number, Promise<TerminalStartResult>>();

type TerminalPtyHandle = { pid: number; wait?: () => Promise<unknown> };

function appendOutput(session: TerminalSession, data: Uint8Array) {
  const decoded = session.decoder.decode(data, { stream: true });
  if (!decoded) return;
  session.output += decoded;
  session.bytes += Buffer.byteLength(decoded, "utf8");
  // Trim the front at code-point boundaries until the retained scrollback
  // fits the UTF-8 byte cap. Whole code points are removed so the stream
  // never starts on a lone surrogate, and `offset` stays an exact UTF-16
  // code-unit position in the logical output stream.
  while (session.bytes > TERMINAL_OUTPUT_CAP_BYTES && session.output.length > 0) {
    const codePoint = session.output.codePointAt(0);
    if (codePoint === undefined) break;
    const units = codePoint > 0xffff ? 2 : 1;
    session.output = session.output.slice(units);
    session.offset += units;
    session.bytes -= Buffer.byteLength(String.fromCodePoint(codePoint), "utf8");
  }
  session.lastUsedAt = Date.now();
}

function describeTerminalError(error: unknown) {
  return (
    error instanceof Error && error.message
      ? error.message
      : "Nova could not reach the agent VM terminal."
  );
}

/** Best-effort import of sandbox-created files into Neon so they show in Files. */
async function persistTerminalWorkspace(ownerId: number, sandboxId: string) {
  try {
    const client = getE2BClient();
    if (!client) return;
    const sandbox = await client.connect(sandboxId);
    await persistE2BWorkspace(ownerId, sandbox);
  } catch (error) {
    console.warn(
      `[terminal] could not import terminal-created files into Neon: ${describeTerminalError(error)}`
    );
  }
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

async function createTerminalSession(
  ownerId: number,
  size: { cols: number; rows: number }
): Promise<TerminalStartResult> {
  const client = getE2BClient();
  if (!client) {
    throw new TerminalError(
      "E2B is not connected yet. An administrator must add the server-only E2B API key before Nova can open a terminal.",
      "precondition"
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
    throw new TerminalError(
      "The agent VM template does not expose terminals. Ask an administrator to enable the terminal-enabled E2B template.",
      "precondition"
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
    bytes: 0,
    decoder: new TextDecoder(),
    lastUsedAt: Date.now(),
    sendInput: (data: string) => pty.sendInput(handle.pid, data),
    resize: (next: { cols: number; rows: number }) => pty.resize(handle.pid, next),
    kill: () => pty.kill(handle.pid),
  };
  sessions.set(ownerId, session);
  // When the shell exits on its own (e.g. the user runs `exit`), drop the
  // session and import terminal-created files - without disturbing any newer
  // replacement session that may have taken over this owner's slot.
  if (handle.wait) {
    void handle
      .wait()
      .then(() => {
        const current = sessions.get(ownerId);
        if (!current || current.ptyId !== handle.pid) return;
        sessions.delete(ownerId);
        void persistTerminalWorkspace(ownerId, current.sandboxId);
      })
      .catch(() => {});
  }
  return {
    reused: false as const,
    ptyId: handle.pid,
    offset: 0,
    seq: 0,
    output: "",
  };
}

/**
 * Opens (or reattaches to) the workspace terminal. Returns the current
 * scrollback so a reopened tab instantly shows recent output. Concurrent
 * calls for the same owner share one in-flight start so only one PTY is
 * ever created.
 */
export function startTerminalForUser(
  ownerId: number,
  size: { cols: number; rows: number }
): Promise<TerminalStartResult> {
  const existing = sessions.get(ownerId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return Promise.resolve({
      reused: true as const,
      ptyId: existing.ptyId,
      offset: existing.offset,
      seq: existing.offset + existing.output.length,
      output: existing.output,
    });
  }
  const pending = pendingStarts.get(ownerId);
  if (pending) return pending;
  const created = createTerminalSession(ownerId, size).finally(() => {
    if (pendingStarts.get(ownerId) === created) pendingStarts.delete(ownerId);
  });
  pendingStarts.set(ownerId, created);
  return created;
}

/** New terminal bytes since `sinceSeq` (UTF-16 code units) in the output stream. */
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
    throw new TerminalError("Open the terminal before typing into it.");
  }
  if (new TextEncoder().encode(data).length > TERMINAL_MAX_INPUT_BYTES) {
    throw new TerminalError("That terminal input was too large. Paste smaller chunks.");
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
  session.lastUsedAt = Date.now();
  await session.resize(size);
  // Only commit the new geometry once the PTY accepted it, so the status
  // endpoint never reports dimensions the shell did not take.
  session.cols = size.cols;
  session.rows = size.rows;
  return { resized: true as const };
}

/**
 * Closes the live shell. Files created in the terminal session are imported
 * back into Neon Postgres (best-effort) so they show up in Files.
 */
export async function stopTerminalForUser(ownerId: number) {
  const session = sessions.get(ownerId);
  if (!session) return { success: false as const };
  try {
    await session.kill();
  } catch {
    // Keep the session so the user can retry closing it.
    throw new TerminalError("Nova could not close the terminal. Please retry.");
  }
  sessions.delete(ownerId);
  await persistTerminalWorkspace(ownerId, session.sandboxId);
  return { success: true as const };
}

/** Test seam: drop all in-memory sessions between tests. */
export function resetTerminalSessionsForTests() {
  sessions.clear();
  pendingStarts.clear();
}
