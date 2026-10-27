import { and, asc, desc, eq } from "drizzle-orm";
import { workspaceFiles, workspaceFolders } from "../../drizzle/schema";
import { wouldCreateWorkspaceFolderCycle } from "../workspace/workspaceFolderTree";
import { searchWorkspaceFiles, type FileSearchOptions } from "../fileSearch";
import { isUniqueViolation, requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";
import { listChatsByWorkspaceId } from "./chats";
import { getWorkspaceModelSettingsByWorkspaceId } from "./models";
import { deleteObject, getObjectText, isBlobStorageConfigured, putObject, workspaceFileKey } from "../storage/r2";

async function getFolderForUser(ownerId: number, folderId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return (await db.select().from(workspaceFolders).where(and(
    eq(workspaceFolders.id, folderId),
    eq(workspaceFolders.workspaceId, workspace.id),
  )).limit(1))[0];
}

async function getFileForUser(ownerId: number, fileId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const row = (await db.select().from(workspaceFiles).where(and(
    eq(workspaceFiles.id, fileId),
    eq(workspaceFiles.workspaceId, workspace.id),
  )).limit(1))[0];
  return row ? await hydrateFile(row) : row;
}

export async function listWorkspaceFoldersForUser(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return listWorkspaceFoldersByWorkspaceId(workspace.id);
}

/**
 * Stores one file body. With R2 configured the bytes go to the bucket and only
 * the object key lands in Postgres; without it the body stays inline in
 * `content` exactly as before, so environments with no bucket keep working.
 *
 * The key is derived from ids, so a file's object never moves when the user
 * renames or re-parents it - the row is the identity, the bucket is the bytes.
 */
async function storeFileBody(
  workspaceId: number,
  fileId: number,
  content: string,
  mimeType: string
): Promise<{ content: string; storageKey: string | null }> {
  if (!isBlobStorageConfigured()) return { content, storageKey: null };
  const key = workspaceFileKey(workspaceId, fileId);
  await putObject(key, content, mimeType);
  return { content: "", storageKey: key };
}

/**
 * The body of one file, read from R2 when the row carries a key and from
 * `content` otherwise. A keyed row whose object is missing returns "" rather
 * than throwing, so one pruned object cannot 500 the whole workspace load.
 */
export async function readWorkspaceFileContent(
  file: { content?: string | null; storageKey?: string | null }
): Promise<string> {
  if (!file.storageKey) return file.content ?? "";
  return (await getObjectText(file.storageKey)) ?? "";
}

/**
 * Fills `content` from R2 for rows that carry a storage key, so every caller
 * keeps seeing file bodies exactly as it did when they lived inline. The read
 * happens against R2 (zero egress), not Postgres.
 */
async function hydrateFile<T extends { content?: string | null; storageKey?: string | null }>(
  file: T
): Promise<T> {
  if (!file.storageKey) return file;
  const body = await getObjectText(file.storageKey).catch(() => null);
  return { ...file, content: body ?? "" };
}

/** Hydrates a batch of rows in parallel; order is preserved. */
async function hydrateFiles<T extends { content?: string | null; storageKey?: string | null }>(
  files: T[]
): Promise<T[]> {
  return Promise.all(files.map(hydrateFile));
}

/** Drops a file's stored object; a no-op for rows that were never offloaded. */
async function dropFileBody(storageKey: string | null | undefined) {
  if (!storageKey) return;
  await deleteObject(storageKey).catch(error =>
    console.error("[Storage] R2 delete failed:", error)
  );
}

/** Internal: the caller must have resolved a workspace this owner owns. */
export async function listWorkspaceFoldersByWorkspaceId(workspaceId: number) {
  const db = await requireDb();
  return db.select().from(workspaceFolders).where(eq(workspaceFolders.workspaceId, workspaceId)).orderBy(asc(workspaceFolders.name));
}

export async function createWorkspaceFolderForUser(ownerId: number, input: { name: string; parentId?: number | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  if (input.parentId) {
    const parent = await getFolderForUser(ownerId, input.parentId);
    if (!parent) return undefined;
  }
  return (await db.insert(workspaceFolders).values({
    workspaceId: workspace.id,
    name: input.name,
    parentId: input.parentId ?? null,
  }).returning())[0];
}

export async function updateWorkspaceFolderForUser(ownerId: number, folderId: number, input: { name?: string; parentId?: number | null }) {
  const db = await requireDb();
  const folder = await getFolderForUser(ownerId, folderId);
  if (!folder) return undefined;
  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === folder.id) return undefined;
    const parent = await getFolderForUser(ownerId, input.parentId);
    if (!parent) return undefined;
    const workspace = await getOrCreateWorkspace(ownerId);
    const folders = await db
      .select({ id: workspaceFolders.id, parentId: workspaceFolders.parentId })
      .from(workspaceFolders)
      .where(eq(workspaceFolders.workspaceId, workspace.id));
    if (wouldCreateWorkspaceFolderCycle(folders, folder.id, parent.id))
      return undefined;
  }
  const updateSet: Partial<typeof workspaceFolders.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.parentId !== undefined) updateSet.parentId = input.parentId;
  return (await db.update(workspaceFolders).set(updateSet).where(eq(workspaceFolders.id, folder.id)).returning())[0];
}

export async function deleteWorkspaceFolderForUser(ownerId: number, folderId: number) {
  const db = await requireDb();
  const folder = await getFolderForUser(ownerId, folderId);
  if (!folder) return false;
  await db.delete(workspaceFolders).where(eq(workspaceFolders.id, folder.id));
  return true;
}

export async function listWorkspaceFilesForUser(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  return listWorkspaceFilesByWorkspaceId(workspace.id);
}

/** Internal: the caller must have resolved a workspace this owner owns. */
export async function listWorkspaceFilesByWorkspaceId(workspaceId: number) {
  const db = await requireDb();
  const rows = await db
    .select()
    .from(workspaceFiles)
    .where(eq(workspaceFiles.workspaceId, workspaceId))
    .orderBy(desc(workspaceFiles.updatedAt));
  return hydrateFiles(rows);
}

/** Searches every file in the workspace by name, body and MIME type. */
export async function searchWorkspaceFilesForUser(ownerId: number, options: FileSearchOptions) {
  const files = await listWorkspaceFilesForUser(ownerId);
  return searchWorkspaceFiles(files, options);
}

export async function createWorkspaceFileForUser(ownerId: number, input: { name: string; content?: string; mimeType?: string; folderId?: number | null }) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  if (input.folderId) {
    const folder = await getFolderForUser(ownerId, input.folderId);
    if (!folder) return undefined;
  }
  try {
    const [row] = await db.insert(workspaceFiles).values({
      workspaceId: workspace.id,
      name: input.name,
      content: "",
      mimeType: input.mimeType ?? "text/plain",
      folderId: input.folderId ?? null,
    }).returning();
    if (!row) return undefined;
    const stored = await storeFileBody(
      workspace.id,
      row.id,
      input.content ?? "",
      input.mimeType ?? "text/plain"
    );
    if (!stored.storageKey) return row;
    const [saved] = await db
      .update(workspaceFiles)
      .set({ ...stored, updatedAt: new Date() })
      .where(eq(workspaceFiles.id, row.id))
      .returning();
    return saved ?? row;
  } catch (error) {
    if (isUniqueViolation(error)) return undefined;
    throw error;
  }
}

export async function updateWorkspaceFileForUser(ownerId: number, fileId: number, input: { name?: string; content?: string; mimeType?: string; folderId?: number | null }) {
  const db = await requireDb();
  const file = await getFileForUser(ownerId, fileId);
  if (!file) return undefined;
  if (input.folderId !== undefined && input.folderId !== null) {
    const folder = await getFolderForUser(ownerId, input.folderId);
    if (!folder) return undefined;
  }
  const updateSet: Partial<typeof workspaceFiles.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.mimeType !== undefined) updateSet.mimeType = input.mimeType;
  if (input.folderId !== undefined) updateSet.folderId = input.folderId;
  // A body write always goes through storeFileBody: with R2 configured the
  // object is rewritten and `content` is cleared, so a row never carries both.
  if (input.content !== undefined) {
    const stored = await storeFileBody(
      file.workspaceId,
      file.id,
      input.content,
      input.mimeType ?? file.mimeType ?? "text/plain"
    );
    updateSet.content = stored.content;
    updateSet.storageKey = stored.storageKey;
  }
  try {
    return (await db.update(workspaceFiles).set(updateSet).where(eq(workspaceFiles.id, file.id)).returning())[0];
  } catch (error) {
    // Renaming or moving a file onto an existing name hits the same
    // unique constraint as a duplicate create.
    if (isUniqueViolation(error)) return undefined;
    throw error;
  }
}

export async function deleteWorkspaceFileForUser(ownerId: number, fileId: number) {
  const db = await requireDb();
  const file = await getFileForUser(ownerId, fileId);
  if (!file) return false;
  await dropFileBody(file.storageKey);
  await db.delete(workspaceFiles).where(eq(workspaceFiles.id, file.id));
  return true;
}

/**
 * The workspace snapshot the app loads on open. The workspace is resolved once
 * and every collection is read against that id: resolving it per collection
 * (the way each `...ForUser` helper does on its own) cost four extra queries
 * per load for a value this call already holds.
 */
export async function getWorkspaceComputer(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const [folders, files, chatRows, settings] = await Promise.all([
    listWorkspaceFoldersByWorkspaceId(workspace.id),
    listWorkspaceFilesByWorkspaceId(workspace.id),
    listChatsByWorkspaceId(workspace.id),
    getWorkspaceModelSettingsByWorkspaceId(workspace.id),
  ]);
  return { workspace, folders, files, chats: chatRows, settings };
}
