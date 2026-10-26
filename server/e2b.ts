import { Sandbox, type CommandResult } from "e2b";
import { errorMessage } from "@shared/_core/errors";

export const E2B_WORKSPACE_DIR = "/home/user/workspace";

const MAX_WORKSPACE_FILES = 24;
const MAX_FILE_BYTES = 60_000;
const MAX_CODE_BYTES = 12_000;
const MAX_OUTPUT_BYTES = 12_000;
// Per-run cap for the task script. Generous by design: the Vercel function
// budget (maxDuration 300s) is the real ceiling; this only stops a truly
// hung script from eating the whole request.
const RUN_TIMEOUT_MS = 240_000;
const PERSISTENT_SANDBOX_TIMEOUT_MS = 3_600_000;
const DEFAULT_MAX_SANDBOX_CREATIONS = 50;
const TIMEOUT_REFRESH_INTERVAL_MS = 1_800_000; // Refresh timeout every 30 minutes

let sandboxCreationCount = 0;
const sandboxExecutionLocks = new Map<string, Promise<void>>();
const workspaceLifecycleLocks = new Map<string, Promise<void>>();

/** Telemetry for sandbox operations. */
type SandboxMetrics = {
  sandboxCreations: number;
  sandboxConnects: number;
  sandboxPauses: number;
  snapshotCreations: number;
  snapshotLoads: number;
  snapshotDeletions: number;
  connectFailures: number;
  pauseFailures: number;
  timeoutRefreshes: number;
  totalConnectLatencyMs: number;
  totalCreateLatencyMs: number;
};

const metrics: SandboxMetrics = {
  sandboxCreations: 0,
  sandboxConnects: 0,
  sandboxPauses: 0,
  snapshotCreations: 0,
  snapshotLoads: 0,
  snapshotDeletions: 0,
  connectFailures: 0,
  pauseFailures: 0,
  timeoutRefreshes: 0,
  totalConnectLatencyMs: 0,
  totalCreateLatencyMs: 0,
};

export function getSandboxMetrics(): Readonly<SandboxMetrics> {
  return { ...metrics };
}

export function resetSandboxMetrics() {
  metrics.sandboxCreations = 0;
  metrics.sandboxConnects = 0;
  metrics.sandboxPauses = 0;
  metrics.snapshotCreations = 0;
  metrics.snapshotLoads = 0;
  metrics.snapshotDeletions = 0;
  metrics.connectFailures = 0;
  metrics.pauseFailures = 0;
  metrics.timeoutRefreshes = 0;
  metrics.totalConnectLatencyMs = 0;
  metrics.totalCreateLatencyMs = 0;
}

/** Serialize the full restore/execute/persist lifecycle for one workspace. */
export async function withE2BWorkspaceLock<T>(
  ownerId: number,
  workspaceId: number,
  operation: () => Promise<T>
): Promise<T> {
  const key = `${ownerId}:${workspaceId}`;
  const previous = workspaceLifecycleLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  workspaceLifecycleLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (workspaceLifecycleLocks.get(key) === queued)
      workspaceLifecycleLocks.delete(key);
  }
}

export type E2BWorkspaceFile = {
  id: number;
  name: string;
  content: string;
  mimeType: string;
  folderId: number | null;
};

export type E2BWorkspaceFolder = {
  id: number;
  name: string;
  parentId: number | null;
};

export type E2BCommandResult = Pick<
  CommandResult,
  "exitCode" | "stdout" | "stderr"
> & { error?: string };

type E2BFileEntry = {
  path: string;
  name?: string;
  type?: string;
  size?: number;
  mimeType?: string;
  isDir?: boolean;
  isDirectory?: boolean;
};

type E2BCommandsLike = {
  run: (
    command: string,
    options?: Record<string, unknown>
  ) => Promise<E2BCommandResult>;
};

type E2BFilesLike = {
  write: (
    path: string,
    data: string | ArrayBuffer | Uint8Array
  ) => Promise<unknown>;
  read: (
    path: string,
    options?: { format?: "bytes" | "text" }
  ) => Promise<string | Uint8Array>;
  list: (path: string, options?: { depth?: number }) => Promise<E2BFileEntry[]>;
  makeDir?: (path: string) => Promise<boolean>;
  remove?: (path: string) => Promise<unknown>;
};

export type E2BSandboxLike = {
  sandboxId: string;
  commands: E2BCommandsLike;
  files: E2BFilesLike;
  pause?: (options?: { keepMemory?: boolean }) => Promise<boolean>;
  kill?: () => Promise<boolean>;
  setTimeout?: (timeoutMs: number) => Promise<void>;
  createSnapshot?: () => Promise<{ snapshotId: string }>;
  keepAlive?: (timeoutMs: number) => Promise<void>;
};

export type E2BSandboxInfo = {
  sandboxId: string;
  state: "running" | "paused";
  metadata?: Record<string, string>;
};

export type E2BClientLike = {
  create: (options?: Record<string, unknown>) => Promise<E2BSandboxLike>;
  createFromSnapshot?: (
    snapshotId: string,
    options?: Record<string, unknown>
  ) => Promise<E2BSandboxLike>;
  deleteSnapshot?: (snapshotId: string) => Promise<boolean>;
  connect: (
    sandboxId: string,
    options?: Record<string, unknown>
  ) => Promise<E2BSandboxLike>;
  list?: (options?: Record<string, unknown>) => Promise<E2BSandboxInfo[]>;
};

export type E2BTaskInput = {
  runId: number;
  workspaceId: number;
  ownerId: number;
  task: string;
  code?: string;
  files: E2BWorkspaceFile[];
  folders: E2BWorkspaceFolder[];
  onSandboxCreated?: (sandboxId: string) => Promise<void> | void;
};

export type E2BTaskResult = {
  sandboxId: string;
  output: string;
  uploadedFileCount: number;
};

export function isE2BConfigured() {
  return Boolean(process.env.E2B_API_KEY?.trim());
}

function maxSandboxCreations() {
  const configured = Number.parseInt(
    process.env.E2B_MAX_SANDBOX_CREATIONS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_MAX_SANDBOX_CREATIONS;
}

/** Reserve one sandbox creation before contacting E2B, enforcing Nova's zero-spend safety cap. */
export function reserveSandboxCreation() {
  const limit = maxSandboxCreations();
  if (sandboxCreationCount >= limit) {
    throw new Error(
      "Nova has paused new sandbox work to stay within its no-card safety limit."
    );
  }
  sandboxCreationCount += 1;
}

/** Reset the process-local creation counter for isolated tests and controlled worker restarts. */
export function resetSandboxCreationCount() {
  sandboxCreationCount = 0;
}

function safeE2BError(error: unknown) {
  const message = errorMessage(error);
  return message
    .replace(
      /(?:E2B_API_KEY\s*[=:]\s*|authorization\s*[:=]\s*bearer\s+|bearer\s+)\S+/gi,
      "[private credential]"
    )
    .slice(0, 500);
}

export function getE2BClient(): E2BClientLike | undefined {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) return undefined;
  return {
    create: options =>
      Sandbox.create({
        ...(options ?? {}),
        apiKey,
      }) as unknown as Promise<E2BSandboxLike>,
    createFromSnapshot: (snapshotId, options) =>
      Sandbox.create(snapshotId, {
        ...(options ?? {}),
        apiKey,
      } as never) as unknown as Promise<E2BSandboxLike>,
    deleteSnapshot: snapshotId =>
      Sandbox.deleteSnapshot(snapshotId, { apiKey }),
    connect: (sandboxId, options) =>
      Sandbox.connect(sandboxId, {
        ...(options ?? {}),
        apiKey,
      }) as unknown as Promise<E2BSandboxLike>,
    list: async options => {
      const paginator = Sandbox.list({
        ...(options ?? {}),
        apiKey,
      } as never);
      return (await paginator.nextItems()) as E2BSandboxInfo[];
    },
  };
}

export async function getE2BSandboxStatus(
  client: E2BClientLike,
  sandboxId: string
): Promise<"active" | "sleeping" | "unavailable"> {
  if (!client.list) return "unavailable";
  try {
    const sandbox = (await client.list()).find(
      item => item.sandboxId === sandboxId
    );
    if (!sandbox) return "unavailable";
    return sandbox.state === "paused" ? "sleeping" : "active";
  } catch {
    return "unavailable";
  }
}

/**
 * Pauses a live sandbox so it stops being billed while idle. E2B keeps the
 * disk across a pause, so the next wake resumes the same machine instead of
 * cold-booting a fresh one. Never throws: a sandbox with no pause primitive
 * and one already paused both report false and are left alone. Callers that
 * hold a workspace lifecycle lock must use this directly (the lock is not
 * reentrant); everyone else goes through pauseAgentSandbox.
 */
export async function pauseE2BSandbox(
  sandbox: E2BSandboxLike | undefined
): Promise<boolean> {
  if (!sandbox?.pause) return false;
  try {
    const paused = await sandbox.pause({ keepMemory: true });
    if (paused) metrics.sandboxPauses += 1;
    return paused;
  } catch (error) {
    metrics.pauseFailures += 1;
    console.error(
      "[E2B] sandbox pause failed",
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

function safePathSegment(value: string, fallback: string) {
  const normalized = value
    .replace(/[\\/]+/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[_.]+/, "")
    .slice(0, 100);
  return normalized || fallback;
}

function truncate(value: string, maximum: number) {
  return value.length <= maximum
    ? value
    : `${value.slice(0, maximum)}\n\n[truncated by Nova]`;
}

export function sanitizeE2BOutput(value: string | undefined) {
  return (
    truncate(
      (value ?? "")
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/\0/g, ""),
      MAX_OUTPUT_BYTES
    ).trim() || "Task finished without console output."
  );
}

export function validateE2BCode(code: string | undefined) {
  if (!code?.trim()) return;
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES)
    throw new Error("Nova limits one VM task to 12 KB of Python code.");
}

export function buildE2BWorkspaceBundle(
  files: E2BWorkspaceFile[],
  folders: E2BWorkspaceFolder[]
) {
  const folderNames = new Map(folders.map(folder => [folder.id, folder.name]));
  const selected = files.slice(0, MAX_WORKSPACE_FILES);
  const manifest = selected.map(file => ({
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    folder: file.folderId ? (folderNames.get(file.folderId) ?? null) : null,
    path: `input/${file.id}-${safePathSegment(file.name, `file-${file.id}.txt`)}`,
  }));
  return {
    manifest,
    uploads: selected.map((file, index) => ({
      remotePath: `${E2B_WORKSPACE_DIR}/input/${file.id}-${safePathSegment(file.name, `file-${index + 1}.txt`)}`,
      content: truncate(file.content, MAX_FILE_BYTES),
    })),
  };
}

function buildTaskScript(code?: string) {
  const userCode =
    code?.trim() ||
    [
      "print('Nova workspace inventory')",
      "for path in sorted(INPUT_DIR.iterdir()):",
      "    print(f'- {path.name}')",
    ].join("\n");
  return [
    "from pathlib import Path",
    `WORKSPACE_DIR = Path(${JSON.stringify(E2B_WORKSPACE_DIR)})`,
    "INPUT_DIR = WORKSPACE_DIR / 'input'",
    "OUTPUT_DIR = WORKSPACE_DIR / 'output'",
    "OUTPUT_DIR.mkdir(parents=True, exist_ok=True)",
    "# The sandbox below is isolated for the requested task (not the user's computer).",
    userCode,
    "",
  ].join("\n");
}

export function persistentSandboxConfig(workspaceId: number, ownerId: number) {
  return {
    template: "base",
    metadata: {
      "nova.owner": String(ownerId),
      "nova.workspace": String(workspaceId),
      "nova.persistent": "true",
    },
    timeoutMs: PERSISTENT_SANDBOX_TIMEOUT_MS,
    lifecycle: { onTimeout: "pause" as const, autoResume: true },
    allowInternetAccess: true,
  };
}

/**
 * The `desktop` template: Ubuntu with an XFCE session and Chrome for Testing
 * already installed - the same image E2B's own computer-use SDK creates (it
 * defaults to this template name too). The workspace VM runs the bare `base`
 * template, which has no display server at all, so the browse tool gets a
 * sandbox of its own from here instead of a several-hundred-megabyte GUI
 * install inside an agent run.
 */
export const DESKTOP_SANDBOX_TEMPLATE = "desktop";
/** The X display the desktop session runs on; the browse commands and Chrome
 *  both read it, so it is set for every command the sandbox runs. */
export const DESKTOP_DISPLAY = ":0";
const DESKTOP_SANDBOX_TIMEOUT_MS = 3_600_000;

/**
 * The desktop GUI sandbox config. It mirrors the persistent VM's lifecycle -
 * pause instead of kill on timeout, resume on the next call - so the Chrome
 * window the user was looking at is still there next time, and it carries the
 * same owner/workspace metadata plus a `nova.browser` marker so Nova's
 * sandboxes stay distinguishable in the E2B dashboard.
 */
export function desktopSandboxConfig(workspaceId: number, ownerId: number) {
  return {
    template: DESKTOP_SANDBOX_TEMPLATE,
    envs: { DISPLAY: DESKTOP_DISPLAY },
    metadata: {
      "nova.owner": String(ownerId),
      "nova.workspace": String(workspaceId),
      "nova.browser": "true",
    },
    timeoutMs: DESKTOP_SANDBOX_TIMEOUT_MS,
    lifecycle: { onTimeout: "pause" as const, autoResume: true },
    allowInternetAccess: true,
  };
}

export function desktopSandboxTimeoutMs() {
  return DESKTOP_SANDBOX_TIMEOUT_MS;
}

const persistentSandboxInFlight = new Map<string, Promise<E2BSandboxLike>>();
const sandboxLastRefresh = new Map<string, number>();

/**
 * Refreshes a sandbox's timeout to prevent mid-run expiration. Should be called
 * on reconnect and periodically during long-running operations.
 */
export async function refreshSandboxTimeout(
  sandbox: E2BSandboxLike
): Promise<boolean> {
  const now = Date.now();
  const lastRefresh = sandboxLastRefresh.get(sandbox.sandboxId) ?? 0;

  // Only refresh if it's been at least 30 minutes since last refresh
  if (now - lastRefresh < TIMEOUT_REFRESH_INTERVAL_MS) {
    return true;
  }

  try {
    if (sandbox.setTimeout) {
      await sandbox.setTimeout(PERSISTENT_SANDBOX_TIMEOUT_MS);
      metrics.timeoutRefreshes += 1;
      sandboxLastRefresh.set(sandbox.sandboxId, now);
      return true;
    }
    // Fallback to keepAlive if setTimeout doesn't exist
    if (sandbox.keepAlive) {
      await sandbox.keepAlive(PERSISTENT_SANDBOX_TIMEOUT_MS);
      metrics.timeoutRefreshes += 1;
      sandboxLastRefresh.set(sandbox.sandboxId, now);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(
      `[E2B] Failed to refresh timeout for sandbox ${sandbox.sandboxId}`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

async function runCommand(
  sandbox: E2BSandboxLike,
  command: string,
  options: Record<string, unknown>
): Promise<E2BCommandResult> {
  try {
    return await sandbox.commands.run(command, options);
  } catch (error) {
    const result = error as Partial<E2BCommandResult>;
    if (typeof result.exitCode === "number") {
      return {
        exitCode: result.exitCode,
        stdout: typeof result.stdout === "string" ? result.stdout : "",
        stderr: typeof result.stderr === "string" ? result.stderr : "",
        error:
          typeof result.error === "string" ? result.error : safeE2BError(error),
      };
    }
    throw error;
  }
}

async function createOrGetPersistentSandbox(
  client: E2BClientLike,
  workspaceId: number,
  ownerId: number,
  knownSandboxId?: string | null
): Promise<E2BSandboxLike> {
  if (knownSandboxId) {
    const connectStart = Date.now();
    try {
      const sandbox = await client.connect(knownSandboxId, {
        timeoutMs: PERSISTENT_SANDBOX_TIMEOUT_MS,
      });
      metrics.sandboxConnects += 1;
      metrics.totalConnectLatencyMs += Date.now() - connectStart;
      // Refresh timeout on every reconnect to prevent mid-run expiration.
      await refreshSandboxTimeout(sandbox);
      return sandbox;
    } catch (error) {
      metrics.connectFailures += 1;
      throw error;
    }
  }

  reserveSandboxCreation();
  const createStart = Date.now();
  const sandbox = await client.create(
    persistentSandboxConfig(workspaceId, ownerId)
  );
  metrics.sandboxCreations += 1;
  metrics.totalCreateLatencyMs += Date.now() - createStart;
  return sandbox;
}

export async function ensurePersistentSandbox(
  client: E2BClientLike,
  workspaceId: number,
  ownerId: number,
  knownSandboxId?: string | null
): Promise<E2BSandboxLike> {
  const key = `${ownerId}:${workspaceId}:${knownSandboxId ?? "new"}`;
  const existing = persistentSandboxInFlight.get(key);
  if (existing) return existing;

  const pending = createOrGetPersistentSandbox(
    client,
    workspaceId,
    ownerId,
    knownSandboxId
  );
  persistentSandboxInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (persistentSandboxInFlight.get(key) === pending)
      persistentSandboxInFlight.delete(key);
  }
}

/** Create a replacement workspace sandbox from a durable E2B snapshot. */
export async function createPersistentSandboxFromSnapshot(
  client: E2BClientLike,
  workspaceId: number,
  ownerId: number,
  snapshotId: string
): Promise<E2BSandboxLike> {
  if (!client.createFromSnapshot)
    throw new Error("This E2B client cannot create from snapshots.");

  const key = `${ownerId}:${workspaceId}:snapshot:${snapshotId}`;
  const existing = persistentSandboxInFlight.get(key);
  if (existing) return existing;

  reserveSandboxCreation();
  const createStart = Date.now();
  const { template: _template, ...options } = persistentSandboxConfig(
    workspaceId,
    ownerId
  );
  const pending = client.createFromSnapshot(snapshotId, options);
  persistentSandboxInFlight.set(key, pending);
  try {
    const sandbox = await pending;
    metrics.sandboxCreations += 1;
    metrics.snapshotLoads += 1;
    metrics.totalCreateLatencyMs += Date.now() - createStart;
    return sandbox;
  } finally {
    if (persistentSandboxInFlight.get(key) === pending)
      persistentSandboxInFlight.delete(key);
  }
}

/** Fresh sandboxes do not ship with the Nova workspace directory. Create it
 *  before any command references it as its cwd (E2B rejects missing cwds). */
export async function ensureE2BWorkspaceDir(sandbox: E2BSandboxLike) {
  await sandbox.commands
    .run(`mkdir -p ${JSON.stringify(E2B_WORKSPACE_DIR)}`)
    .catch(() => undefined);
}

async function uploadBundleToSandbox(
  sandbox: E2BSandboxLike,
  files: E2BWorkspaceFile[],
  folders: E2BWorkspaceFolder[],
  task: string,
  code?: string
) {
  await ensureE2BWorkspaceDir(sandbox);
  if (sandbox.files.remove)
    await sandbox.files
      .remove(`${E2B_WORKSPACE_DIR}/input`)
      .catch(() => undefined);
  await sandbox.files.makeDir?.(`${E2B_WORKSPACE_DIR}/input`);
  await sandbox.files.makeDir?.(`${E2B_WORKSPACE_DIR}/output`);
  const bundle = buildE2BWorkspaceBundle(files, folders);
  await sandbox.files.write(
    `${E2B_WORKSPACE_DIR}/nova-manifest.json`,
    JSON.stringify({ task, files: bundle.manifest }, null, 2)
  );
  for (const file of bundle.uploads)
    await sandbox.files.write(file.remotePath, file.content);
  await sandbox.files.write(
    `${E2B_WORKSPACE_DIR}/.nova-task.py`,
    buildTaskScript(code)
  );
}

function commandOutput(result: E2BCommandResult) {
  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}

class E2BTaskExitError extends Error {}

async function runTaskInPersistentSandbox(
  sandbox: E2BSandboxLike,
  input: {
    task: string;
    code?: string;
    files: E2BWorkspaceFile[];
    folders: E2BWorkspaceFolder[];
  }
): Promise<E2BTaskResult> {
  const key = sandbox.sandboxId;
  const previous = sandboxExecutionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  sandboxExecutionLocks.set(key, queued);
  await previous;
  try {
    await uploadBundleToSandbox(
      sandbox,
      input.files,
      input.folders,
      input.task,
      input.code
    );
    const response = await runCommand(sandbox, "python3 .nova-task.py", {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs: RUN_TIMEOUT_MS,
    });
    const output = sanitizeE2BOutput(commandOutput(response));
    if (response.exitCode !== 0) throw new E2BTaskExitError(output);
    return {
      sandboxId: sandbox.sandboxId,
      output,
      uploadedFileCount: Math.min(input.files.length, MAX_WORKSPACE_FILES),
    };
  } finally {
    release();
    if (sandboxExecutionLocks.get(key) === queued)
      sandboxExecutionLocks.delete(key);
  }
}

export async function runE2BTaskInPersistentSandbox(
  client: E2BClientLike,
  input: {
    workspaceId: number;
    ownerId: number;
    sandboxId?: string | null;
    task: string;
    code?: string;
    files: E2BWorkspaceFile[];
    folders: E2BWorkspaceFolder[];
  }
): Promise<E2BTaskResult> {
  validateE2BCode(input.code);
  const sandbox = await ensurePersistentSandbox(
    client,
    input.workspaceId,
    input.ownerId,
    input.sandboxId
  );
  try {
    return await runTaskInPersistentSandbox(sandbox, input);
  } catch (error) {
    if (error instanceof E2BTaskExitError) throw error;
    throw new Error(
      `E2B task outcome is uncertain; Nova will not rerun it automatically: ${safeE2BError(error)}`
    );
  }
}

/**
 * Destroys a workspace's persistent sandbox outright - the factory reset
 * path. Unlike pause/kill-and-forget recovery flows this reclaims the
 * machine and every file on its disk. A sandbox that is already gone
 * (expired or killed behind our back) is treated as destroyed rather than
 * an error, so a reset always proceeds to provisioning a fresh machine.
 */
export async function destroyPersistentSandbox(sandboxId: string): Promise<boolean> {
  const client = getE2BClient();
  if (!client) return false;
  try {
    const sandbox = await client.connect(sandboxId, {
      timeoutMs: PERSISTENT_SANDBOX_TIMEOUT_MS,
    });
    const killed = await sandbox.kill?.();
    return killed !== false;
  } catch (error) {
    console.warn(
      `[E2B] Persistent sandbox ${sandboxId} could not be destroyed (treating as gone): ${safeE2BError(error)}`
    );
    return false;
  }
}

/**
 * Creates a snapshot of the sandbox state. Returns the snapshot ID on success,
 * undefined on failure. A replacement sandbox can be created from this ID.
 */
export async function createSandboxSnapshot(
  sandbox: E2BSandboxLike
): Promise<string | undefined> {
  if (!sandbox.createSnapshot) return undefined;
  try {
    const snapshot = await sandbox.createSnapshot();
    const snapshotId = snapshot?.snapshotId;
    if (!snapshotId) return undefined;
    metrics.snapshotCreations += 1;
    console.log(`[E2B] Created snapshot ${snapshotId} for sandbox ${sandbox.sandboxId}`);
    return snapshotId;
  } catch (error) {
    console.warn(
      `[E2B] Failed to create snapshot for sandbox ${sandbox.sandboxId}`,
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

/**
 * Deletes an old snapshot after a replacement has been saved. Snapshot cleanup
 * is best-effort so it never blocks workspace persistence.
 */
export async function deleteSandboxSnapshot(
  snapshotId: string
): Promise<void> {
  const client = getE2BClient();
  if (!client?.deleteSnapshot) return;
  try {
    const deleted = await client.deleteSnapshot(snapshotId);
    if (deleted) metrics.snapshotDeletions += 1;
  } catch (error) {
    console.warn(
      `[E2B] Failed to delete snapshot ${snapshotId}`,
      error instanceof Error ? error.message : error
    );
  }
}

export async function initWorkspacePersistentVm(
  workspaceId: number,
  ownerId: number,
  knownSandboxId?: string | null
): Promise<string | undefined> {
  const client = getE2BClient();
  if (!client) return undefined;

  try {
    const sandbox = await ensurePersistentSandbox(
      client,
      workspaceId,
      ownerId,
      knownSandboxId
    );
    return sandbox.sandboxId;
  } catch (error) {
    if (knownSandboxId)
      console.warn(
        `[E2B] Stored sandbox lookup failed for workspace ${workspaceId}: ${safeE2BError(error)}`
      );
    try {
      const sandbox = await ensurePersistentSandbox(
        client,
        workspaceId,
        ownerId
      );
      return sandbox.sandboxId;
    } catch (provisionError) {
      console.error(
        `[E2B] Persistent sandbox provisioning failed for workspace ${workspaceId}: ${safeE2BError(provisionError)}`
      );
      return undefined;
    }
  }
}
