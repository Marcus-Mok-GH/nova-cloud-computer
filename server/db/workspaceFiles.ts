import { and, asc, desc, eq } from "drizzle-orm";
import { workspaceFiles, workspaceFolders } from "../../drizzle/schema";
import { wouldCreateWorkspaceFolderCycle } from "../workspace/workspaceFolderTree";
import { searchWorkspaceFiles, type FileSearchOptions } from "../fileSearch";
import { isUniqueViolation, requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";
import { listChatsForUser } from "./chats";
import { getWorkspaceModelSettingsForUser } from "./models";

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
  return (await db.select().from(workspaceFiles).where(and(
    eq(workspaceFiles.id, fileId),
    eq(workspaceFiles.workspaceId, workspace.id),
  )).limit(1))[0];
}

export async function listWorkspaceFoldersForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(workspaceFolders).where(eq(workspaceFolders.workspaceId, workspace.id)).orderBy(asc(workspaceFolders.name));
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
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(workspaceFiles).where(eq(workspaceFiles.workspaceId, workspace.id)).orderBy(desc(workspaceFiles.updatedAt));
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
    return (await db.insert(workspaceFiles).values({
      workspaceId: workspace.id,
      name: input.name,
      content: input.content ?? "",
      mimeType: input.mimeType ?? "text/plain",
      folderId: input.folderId ?? null,
    }).returning())[0];
  } catch (error) {
    if (isUniqueViolation(error)) return undefined;
    throw error;
  }
}

export async function updateWorkspaceFileForUser(ownerId: number, fileId: number, input: { name?: string; content?: string; folderId?: number | null }) {
  const db = await requireDb();
  const file = await getFileForUser(ownerId, fileId);
  if (!file) return undefined;
  if (input.folderId !== undefined && input.folderId !== null) {
    const folder = await getFolderForUser(ownerId, input.folderId);
    if (!folder) return undefined;
  }
  const updateSet: Partial<typeof workspaceFiles.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updateSet.name = input.name;
  if (input.content !== undefined) updateSet.content = input.content;
  if (input.folderId !== undefined) updateSet.folderId = input.folderId;
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
  await db.delete(workspaceFiles).where(eq(workspaceFiles.id, file.id));
  return true;
}

export async function getWorkspaceComputer(ownerId: number) {
  const workspace = await getOrCreateWorkspace(ownerId);
  const [folders, files, chatRows, settings] = await Promise.all([
    listWorkspaceFoldersForUser(ownerId),
    listWorkspaceFilesForUser(ownerId),
    listChatsForUser(ownerId),
    getWorkspaceModelSettingsForUser(ownerId),
  ]);
  return { workspace, folders, files, chats: chatRows, settings };
}
