import { and, eq, isNull, sql } from "drizzle-orm";
import { workspaceFiles, workspaceFolders, workspaces } from "../../drizzle/schema";
import {
  deleteSandboxSnapshot,
  destroyPersistentSandbox,
  initWorkspacePersistentVm,
} from "../e2b";
import { requireDb } from "./core";
import { cancelActiveAgentVmRunsForUser } from "./agentRuns";

/**
 * Ensures that a user's durable E2B sandbox exists and that Nova retains
 * its sandbox identifier. This is deliberately idempotent: it runs for a new
 * workspace and repairs an older workspace whose computer was never stored.
 */
async function ensureWorkspacePersistentVm<T extends typeof workspaces.$inferSelect>(workspace: T, ownerId: number): Promise<T> {
  const sandboxId = await initWorkspacePersistentVm(workspace.id, ownerId, workspace.persistentSandboxId);
  if (!sandboxId || workspace.persistentSandboxId === sandboxId) return workspace;

  const db = await requireDb();
  const [claimed] = await db
    .update(workspaces)
    .set({ persistentSandboxId: sandboxId, updatedAt: new Date() })
    .where(and(eq(workspaces.id, workspace.id), isNull(workspaces.persistentSandboxId)))
    .returning({ persistentSandboxId: workspaces.persistentSandboxId });

  if (claimed) {
    return { ...workspace, persistentSandboxId: sandboxId };
  }
  // Another process won the race - re-read the winner's sandbox ID
  const db2 = await requireDb();
  const [winner] = await db2
    .select({ persistentSandboxId: workspaces.persistentSandboxId })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.id))
    .limit(1);
  return { ...workspace, persistentSandboxId: winner?.persistentSandboxId ?? sandboxId };
}

/**
 * Backfills the durable container for an existing account without replacing
 * its workspace or any already-recorded sandbox identifier.
 */
export async function ensureUserWorkspaceProvisioned(ownerId: number): Promise<void> {
  const db = await requireDb();
  const [workspace] = await db
    .select({ id: workspaces.id, persistentSandboxId: workspaces.persistentSandboxId })
    .from(workspaces)
    .where(eq(workspaces.ownerId, ownerId))
    .limit(1);

  if (workspace?.persistentSandboxId) return;

  await getOrCreateWorkspace(ownerId);
}

/**
 * Factory reset: wipes every workspace file and folder, cancels in-flight
 * agent VM runs, destroys the persistent sandbox (and every file on its
 * disk), and provisions a brand-new machine in its place. Chat history and
 * workspace settings survive; nothing about the reset touches other users.
 */
export async function factoryResetWorkspaceForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);

  // Cancel runs first so no in-flight agent keeps writing into the machine
  // that is about to be destroyed.
  const cancelledRuns = await cancelActiveAgentVmRunsForUser(ownerId);

  // Wipe the recorded file and folder records (files reference folders, so
  // files go first to respect the foreign key).
  const deletedFiles = await db
    .delete(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspace.id))
    .returning({ id: workspaceFiles.id });
  const deletedFolders = await db
    .delete(workspaceFolders)
    .where(eq(workspaceFolders.workspaceId, workspace.id))
    .returning({ id: workspaceFolders.id });

  // Destroy the old machine, then detach its id so the next VM access
  // provisions a fresh one from the base template. The browse tool's desktop
  // sandbox is a second machine with its own Chrome session, so it goes too -
  // otherwise "start from scratch" would leave the user's logged-in browser
  // sitting there. Snapshots are also cleared since they reference the old
  // sandbox's filesystem state.
  const previousSandboxId = workspace.persistentSandboxId ?? null;
  const previousSnapshotId = workspace.snapshotId ?? null;
  if (previousSandboxId) await destroyPersistentSandbox(previousSandboxId);
  if (workspace.browserSandboxId)
    await destroyPersistentSandbox(workspace.browserSandboxId);
  await db
    .update(workspaces)
    .set({
      persistentSandboxId: null,
      browserSandboxId: null,
      snapshotId: null,
      snapshotRevision: null,
      fileRevision: sql`${workspaces.fileRevision} + 1`,
    })
    .where(eq(workspaces.id, workspace.id));
  if (previousSnapshotId) await deleteSandboxSnapshot(previousSnapshotId);

  const sandboxId = await initWorkspacePersistentVm(workspace.id, ownerId, null);
  return {
    success: true,
    cancelledRuns,
    deletedFiles: deletedFiles.length,
    deletedFolders: deletedFolders.length,
    previousSandboxId,
    sandboxId: sandboxId ?? null,
  };
}

export async function updateWorkspacePersistentSandbox(workspaceId: number, sandboxId: string) {
  const db = await requireDb();
  await db.update(workspaces).set({ persistentSandboxId: sandboxId }).where(eq(workspaces.id, workspaceId));
}

/** Records a sandbox snapshot only if workspace files have not changed since it was created. */
export async function updateWorkspaceSnapshot(
  workspaceId: number,
  snapshotId: string | null,
  expectedFileRevision: number
): Promise<string | null | undefined> {
  const db = await requireDb();
  const current = (
    await db
      .select({ snapshotId: workspaces.snapshotId })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.fileRevision, expectedFileRevision)
        )
      )
      .limit(1)
  )[0];
  if (!current) return undefined;

  const updated = await db
    .update(workspaces)
    .set({
      snapshotId,
      snapshotRevision: snapshotId ? expectedFileRevision : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaces.id, workspaceId),
        eq(workspaces.fileRevision, expectedFileRevision)
      )
    )
    .returning({ id: workspaces.id });
  return updated.length > 0 ? current.snapshotId ?? null : undefined;
}

export async function getWorkspaceFileRevision(workspaceId: number) {
  const db = await requireDb();
  const row = (
    await db
      .select({ fileRevision: workspaces.fileRevision })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
  )[0];
  return row?.fileRevision;
}

/** Records (or clears) the workspace's desktop-GUI sandbox - the browse tool's
 *  Chrome machine - so later calls reconnect to the same desktop session. */
export async function updateWorkspaceBrowserSandbox(workspaceId: number, sandboxId: string | null) {
  const db = await requireDb();
  await db.update(workspaces).set({ browserSandboxId: sandboxId }).where(eq(workspaces.id, workspaceId));
}

export async function getOrCreateWorkspace(ownerId: number) {
  const db = await requireDb();
  const existing = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  let workspace = existing[0];
  if (!workspace) {
    await db.insert(workspaces).values({ ownerId, name: "My Nova Space" }).onConflictDoNothing();
    const created = await db.select().from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
    workspace = created[0];
  }
  if (!workspace) throw new Error("Nova could not create a workspace.");

  // The durable sandbox is already recorded: return the fresh row without
  // reconnecting or re-provisioning. VM/automation flows that need a live
  // sandbox connect explicitly via ensurePersistentSandbox/initWorkspacePersistentVm.
  if (workspace.persistentSandboxId) return workspace;

  try {
    return await ensureWorkspacePersistentVm(workspace, ownerId);
  } catch {
    // Workspace access remains available if the provider is temporarily unavailable.
    return workspace;
  }
}

/** Read the stored sandbox identifier without provisioning or resuming a sandbox. */
export async function getStoredWorkspaceSandboxId(ownerId: number) {
  const db = await requireDb();
  const [workspace] = await db.select({ id: workspaces.id, persistentSandboxId: workspaces.persistentSandboxId }).from(workspaces).where(eq(workspaces.ownerId, ownerId)).limit(1);
  return workspace ?? null;
}

/** One workspace row by id (including its owner and sandbox id), so a resumed process can reconnect and deliver its result. */
export async function getWorkspaceById(workspaceId: number) {
  const db = await requireDb();
  return (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
}
