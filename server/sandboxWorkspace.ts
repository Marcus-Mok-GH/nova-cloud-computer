import {
  E2B_WORKSPACE_DIR,
  type E2BSandboxLike,
  ensurePersistentSandbox,
  getE2BClient,
  isE2BConfigured,
  withE2BWorkspaceLock,
} from "./e2b";
import { persistE2BWorkspace, restoreWorkspaceToE2B } from "./workspaceSync";
import { updateWorkspacePersistentSandbox } from "./db";

/**
 * The sandbox-first workspace layer. Every agent run wakes the workspace's
 * persistent E2B sandbox and syncs the durable Neon/S3 store into it before
 * the first tool executes; file/folder tools then mirror every operation onto
 * the live sandbox filesystem, bash commands run straight on it, and the
 * sandbox state is synced back into Neon at the end of the run.
 */

function cleanPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** A workspace-relative path, or null if it is not safe to touch. */
function safeRelativePath(value: string): string | null {
  const parts = cleanPath(value)
    .split("/")
    .filter(part => part && part !== ".");
  if (parts.some(part => part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

/** The workspace-relative folder path of a folder row, walking parent ids. */
export function folderPathOf(
  folders: Array<{ id: number; name: string; parentId: number | null }>,
  folderId: number | null
): string | null {
  if (folderId === null || folderId === undefined) return null;
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const parts: string[] = [];
  const seen = new Set<number>();
  let current: number | null = folderId;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    parts.unshift(folder.name);
    current = folder.parentId ?? null;
  }
  return parts.join("/") || null;
}

/** The workspace-relative path of a file, given its folder id. */
export function workspaceRelativePathOf(
  folders: Array<{ id: number; name: string; parentId: number | null }>,
  name: string,
  folderId: number | null
): string | null {
  const parent = folderPathOf(folders, folderId);
  return safeRelativePath(parent ? `${parent}/${name}` : name);
}

type FolderLike = { id: number; name: string; parentId: number | null };

/** One sandbox filesystem operation mirroring a workspace tool call. */
export type SandboxOp =
  | { kind: "write_file"; path: string; content: string }
  | { kind: "read_file"; path: string }
  | { kind: "move_path"; from: string; to: string }
  | { kind: "delete_file"; path: string }
  | { kind: "create_folder"; path: string }
  | { kind: "delete_folder"; path: string };

function sandboxAbsolutePath(relative: string): string | null {
  const safe = safeRelativePath(relative);
  return safe ? `${E2B_WORKSPACE_DIR}/${safe}` : null;
}

async function mkdirP(sandbox: E2BSandboxLike, directory: string) {
  await sandbox.commands
    .run(`mkdir -p ${JSON.stringify(directory)}`, { timeoutMs: 15_000 })
    .catch(() => undefined);
}

async function pathExists(
  sandbox: E2BSandboxLike,
  absolutePath: string
): Promise<boolean> {
  try {
    const probe = await sandbox.commands.run(
      `test -e ${JSON.stringify(absolutePath)} && echo yes || echo no`,
      { timeoutMs: 15_000 }
    );
    return ((probe as { stdout?: string }).stdout ?? "").trim() === "yes";
  } catch {
    return false;
  }
}

/**
 * Mirrors a single workspace tool operation onto the live sandbox filesystem.
 * Never throws: failures are reported so the caller can log them and carry on
 * with the durable store, which stays authoritative for ids and names.
 */
export async function mirrorWorkspaceOp(
  sandbox: E2BSandboxLike,
  op: SandboxOp
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (op.kind) {
      case "write_file": {
        const absolute = sandboxAbsolutePath(op.path);
        if (!absolute) return { ok: false, error: `Unsafe path: ${op.path}` };
        const parent = absolute.slice(0, absolute.lastIndexOf("/"));
        await mkdirP(sandbox, parent);
        await sandbox.files.write(absolute, Buffer.from(op.content, "utf8"));
        return { ok: true };
      }
      case "read_file": {
        const absolute = sandboxAbsolutePath(op.path);
        if (!absolute) return { ok: false, error: `Unsafe path: ${op.path}` };
        if (!(await pathExists(sandbox, absolute)))
          return { ok: false, error: `Not on the sandbox: ${op.path}` };
        return { ok: true };
      }
      case "move_path": {
        const from = sandboxAbsolutePath(op.from);
        const to = sandboxAbsolutePath(op.to);
        if (!from || !to)
          return { ok: false, error: `Unsafe path in move ${op.from} -> ${op.to}` };
        const parent = to.slice(0, to.lastIndexOf("/"));
        await mkdirP(sandbox, parent);
        if (!(await pathExists(sandbox, from)))
          return { ok: false, error: `Not on the sandbox: ${op.from}` };
        const moved = await sandbox.commands.run(
          `mv ${JSON.stringify(from)} ${JSON.stringify(to)}`,
          { timeoutMs: 30_000 }
        );
        if (((moved as { exitCode?: number }).exitCode ?? 0) !== 0)
          return { ok: false, error: `mv failed: ${(moved as { stderr?: string }).stderr ?? ""}` };
        return { ok: true };
      }
      case "delete_file": {
        const absolute = sandboxAbsolutePath(op.path);
        if (!absolute) return { ok: false, error: `Unsafe path: ${op.path}` };
        await sandbox.commands
          .run(`rm -f -- ${JSON.stringify(absolute)}`, { timeoutMs: 30_000 })
          .catch(() => undefined);
        return { ok: true };
      }
      case "create_folder": {
        const absolute = sandboxAbsolutePath(op.path);
        if (!absolute) return { ok: false, error: `Unsafe path: ${op.path}` };
        await mkdirP(sandbox, absolute);
        return { ok: true };
      }
      case "delete_folder": {
        const absolute = sandboxAbsolutePath(op.path);
        if (!absolute) return { ok: false, error: `Unsafe path: ${op.path}` };
        await sandbox.commands
          .run(`rm -rf -- ${JSON.stringify(absolute)}`, { timeoutMs: 30_000 })
          .catch(() => undefined);
        return { ok: true };
      }
      default:
        return { ok: false, error: "Unknown sandbox op." };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unknown sandbox error" };
  }
}

/**
 * Wakes the workspace's persistent sandbox for an agent run and syncs the
 * durable Neon/S3 store into it. Returns undefined (never throws) when E2B
 * is not configured or the wake fails, so the run degrades to direct
 * database tools instead of breaking.
 */
export async function prepareAgentSandbox(
  ownerId: number,
  computer: {
    workspace: { id: number; persistentSandboxId?: string | null };
    folders: FolderLike[];
  }
): Promise<E2BSandboxLike | undefined> {
  if (!isE2BConfigured()) return undefined;
  const client = getE2BClient();
  if (!client) return undefined;
  try {
    const sandbox = await withE2BWorkspaceLock(
      ownerId,
      computer.workspace.id,
      async () => {
        const woken = await ensurePersistentSandbox(
          client,
          computer.workspace.id,
          ownerId,
          computer.workspace.persistentSandboxId ?? null
        );
        // Files/folders stored in Neon Postgres are restored into the live
        // sandbox filesystem before the run's first tool executes.
        await restoreWorkspaceToE2B(ownerId, woken);
        return woken;
      }
    );
    // Remember the sandbox id so the next run connects instead of creating.
    if (
      sandbox?.sandboxId &&
      sandbox.sandboxId !== computer.workspace.persistentSandboxId
    ) {
      try {
        await updateWorkspacePersistentSandbox(
          computer.workspace.id,
          sandbox.sandboxId
        );
      } catch {
        // The id not persisting only costs a fresh sandbox next run.
      }
    }
    return sandbox ?? undefined;
  } catch (error) {
    console.error(
      "[Sandbox] failed to wake the workspace sandbox; falling back to direct database tools",
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

/**
 * Syncs the live sandbox filesystem back into the durable Neon/S3 store at
 * the end of an agent run: files created or changed by bash commands, VM
 * tasks, or file tools are imported. Never throws.
 */
export async function syncAgentSandbox(
  ownerId: number,
  workspaceId: number,
  sandbox: E2BSandboxLike | undefined
): Promise<number> {
  if (!sandbox || !isE2BConfigured()) return 0;
  try {
    return await withE2BWorkspaceLock(ownerId, workspaceId, () =>
      persistE2BWorkspace(ownerId, sandbox)
    );
  } catch (error) {
    console.error(
      "[Sandbox] end-of-run sync back to the durable store failed",
      error instanceof Error ? error.message : error
    );
    return 0;
  }
}

const BASH_TIMEOUT_MS = 120_000;
const BASH_OUTPUT_LIMIT = 8_000;

function truncateOutput(value: string | undefined): string {
  const text = (value ?? "").replace(/\u0000/g, "");
  if (text.length <= BASH_OUTPUT_LIMIT) return text;
  return `${text.slice(0, BASH_OUTPUT_LIMIT)}\n…(truncated)`;
}

/**
 * Runs a bash command in the live workspace sandbox, with the workspace
 * directory as cwd. Returns a model-ready result with exit code, stdout and
 * stderr; never throws.
 */
export async function runBashOnSandbox(
  sandbox: E2BSandboxLike,
  command: string
): Promise<{ ok: boolean; result: string }> {
  try {
    const run = await sandbox.commands.run(command, {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs: BASH_TIMEOUT_MS,
    });
    const exitCode = (run as { exitCode?: number }).exitCode ?? 0;
    const stdout = truncateOutput((run as { stdout?: string }).stdout);
    const stderr = truncateOutput((run as { stderr?: string }).stderr);
    const ok = exitCode === 0;
    const parts = [`Exit code ${exitCode}.`];
    parts.push(`stdout:\n${stdout || "(empty)"}`);
    if (stderr) parts.push(`stderr:\n${stderr}`);
    if (!ok)
      parts.push(
        "The command failed. Inspect the error above, fix the command, and try again."
      );
    return { ok, result: parts.join("\n\n") };
  } catch (error) {
    return {
      ok: false,
      result: `The bash command could not run: ${
        error instanceof Error ? error.message : "unknown sandbox error"
      }. The sandbox may have timed out; ask the user to try again in a moment.`,
    };
  }
}
