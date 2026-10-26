import {
  E2B_WORKSPACE_DIR,
  type E2BSandboxLike,
  createPersistentSandboxFromSnapshot,
  deleteSandboxSnapshot,
  ensurePersistentSandbox,
  getE2BClient,
  isE2BConfigured,
  pauseE2BSandbox,
  withE2BWorkspaceLock,
  refreshSandboxTimeout,
  createSandboxSnapshot,
} from "./e2b";
import { persistE2BWorkspace, restoreWorkspaceToE2B } from "./workspace/workspaceSync";
import { safeRelativePath } from "./workspace/paths";
import { truncateOutput } from "./truncate";
import {
  getWorkspaceComputer,
  getWorkspaceFileRevision,
  updateWorkspacePersistentSandbox,
  updateWorkspaceSnapshot,
} from "./db";

/**
 * The sandbox-first workspace layer. Every agent run wakes the workspace's
 * persistent E2B sandbox and syncs the durable Neon/S3 store into it before
 * the first tool executes; file/folder tools then mirror every operation onto
 * the live sandbox filesystem, bash commands run straight on it, and the
 * sandbox state is synced back into Neon at the end of the run.
 */

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
    workspace: {
      id: number;
      persistentSandboxId?: string | null;
      snapshotId?: string | null;
    };
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
        const current = await getWorkspaceComputer(ownerId);
        const workspace = current.workspace;
        const snapshotIsCurrent = Boolean(
          workspace.snapshotId &&
            workspace.snapshotRevision === workspace.fileRevision
        );
        let woken: E2BSandboxLike | undefined;
        let restoredFromSnapshot = false;
        let snapshotNeedsRefresh = !snapshotIsCurrent;

        if (workspace.persistentSandboxId) {
          try {
            woken = await ensurePersistentSandbox(
              client,
              workspace.id,
              ownerId,
              workspace.persistentSandboxId
            );
          } catch {
            // A retained snapshot can recover a sandbox whose E2B ID expired.
          }
        }

        if (!woken && snapshotIsCurrent && workspace.snapshotId) {
          try {
            woken = await createPersistentSandboxFromSnapshot(
              client,
              workspace.id,
              ownerId,
              workspace.snapshotId
            );
            restoredFromSnapshot = true;
          } catch (error) {
            snapshotNeedsRefresh = true;
            console.warn(
              `[Sandbox] snapshot recovery failed for workspace ${workspace.id}`,
              error instanceof Error ? error.message : error
            );
          }
        }

        if (!woken) {
          woken = await ensurePersistentSandbox(
            client,
            workspace.id,
            ownerId
          );
        }

        if (restoredFromSnapshot) {
          const revisionAfterSnapshot = await getWorkspaceFileRevision(
            workspace.id
          );
          if (revisionAfterSnapshot !== workspace.fileRevision) {
            restoredFromSnapshot = false;
            snapshotNeedsRefresh = true;
          }
        }

        if (!restoredFromSnapshot) {
          const activeSandbox = woken;
          if (!activeSandbox)
            throw new Error("Workspace sandbox was not created.");
          // Files/folders stored in Neon Postgres are restored into the live
          // sandbox before the run's first tool executes.
          await restoreWorkspaceToE2B(ownerId, activeSandbox);

          // Take a checkpoint only after restoring the durable workspace. The
          // revision check avoids saving a snapshot if files changed during
          // the restore or while E2B was creating the snapshot.
          const revisionAfterRestore = await getWorkspaceFileRevision(
            workspace.id
          );
          if (
            snapshotNeedsRefresh &&
            revisionAfterRestore === workspace.fileRevision
          ) {
            await saveWorkspaceSnapshot(
              workspace.id,
              activeSandbox,
              revisionAfterRestore
            );
          }
        }

        if (!woken) throw new Error("Workspace sandbox was not created.");
        if (woken.sandboxId !== workspace.persistentSandboxId) {
          await updateWorkspacePersistentSandbox(
            workspace.id,
            woken.sandboxId
          ).catch(() => {
            // The id not persisting only costs a fresh sandbox next run.
          });
        }
        return woken;
      }
    );
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

/**
 * Creates a snapshot after the durable workspace has been restored. If E2B
 * loses the live sandbox, the snapshot can recover its files without uploads.
 * Returns the snapshot ID on success, undefined on failure.
 */
export async function snapshotAgentSandbox(
  sandbox: E2BSandboxLike | undefined
): Promise<string | undefined> {
  if (!sandbox || !isE2BConfigured()) return undefined;
  try {
    return await createSandboxSnapshot(sandbox);
  } catch (error) {
    console.warn(
      "[Sandbox] snapshot creation failed (non-critical)",
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

async function saveWorkspaceSnapshot(
  workspaceId: number,
  sandbox: E2BSandboxLike,
  fileRevision: number
) {
  const snapshotId = await snapshotAgentSandbox(sandbox);
  if (!snapshotId) return;

  const previousSnapshotId = await updateWorkspaceSnapshot(
    workspaceId,
    snapshotId,
    fileRevision
  ).catch(() => undefined);
  if (previousSnapshotId === undefined) {
    await deleteSandboxSnapshot(snapshotId);
    return;
  }
  if (previousSnapshotId && previousSnapshotId !== snapshotId)
    await deleteSandboxSnapshot(previousSnapshotId);
}

/**
 * Pauses the workspace's persistent sandbox once a run has synced its files,
 * so an idle machine is not billed. E2B keeps the disk across a pause, so the
 * next run resumes the same machine instead of cold-booting a fresh one. The
 * pause happens under the same per-workspace lifecycle lock as the sync, so
 * it can never land in the middle of another run's restore/execute window.
 * Never throws - a sandbox with no pause primitive, or one already paused, is
 * simply left alone.
 */
export async function pauseAgentSandbox(
  ownerId: number,
  workspaceId: number,
  sandbox: E2BSandboxLike | undefined
): Promise<boolean> {
  if (!sandbox?.pause || !isE2BConfigured()) return false;
  try {
    return await withE2BWorkspaceLock(ownerId, workspaceId, () =>
      pauseE2BSandbox(sandbox)
    );
  } catch (error) {
    console.error(
      "[Sandbox] end-of-run pause failed",
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

const BASH_TIMEOUT_MS = 120_000;
const BASH_OUTPUT_LIMIT = 8_000;

/**
 * Runs a bash command in the live workspace sandbox, with the workspace
 * directory as cwd. Returns a model-ready result with exit code, stdout and
 * stderr; never throws. Refreshes the sandbox timeout before long commands
 * to prevent mid-execution expiration.
 */
export async function runBashOnSandbox(
  sandbox: E2BSandboxLike,
  command: string
): Promise<{ ok: boolean; result: string }> {
  try {
    // Refresh timeout before potentially long-running commands
    await refreshSandboxTimeout(sandbox);

    const run = await sandbox.commands.run(command, {
      cwd: E2B_WORKSPACE_DIR,
      timeoutMs: BASH_TIMEOUT_MS,
    });
    const exitCode = (run as { exitCode?: number }).exitCode ?? 0;
    const stdout = truncateOutput(
      (run as { stdout?: string }).stdout,
      BASH_OUTPUT_LIMIT
    );
    const stderr = truncateOutput(
      (run as { stderr?: string }).stderr,
      BASH_OUTPUT_LIMIT
    );
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
