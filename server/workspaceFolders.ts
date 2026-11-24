import { createWorkspaceFolderForUser, listWorkspaceFoldersForUser } from "./db";

/**
 * Finds (or lazily creates) the single root-level folder with this exact name,
 * so each feature that wants its own corner of the workspace (uploads,
 * captures, ...) shares one lookup instead of re-implementing it. Matching is
 * case-insensitive; the folder is created on first use and its id is returned,
 * or `null` when the workspace will not accept it.
 */
export async function ensureRootFolder(
  ownerId: number,
  name: string
): Promise<number | null> {
  const folders = await listWorkspaceFoldersForUser(ownerId);
  const existing = folders.find(
    folder =>
      folder.parentId === null &&
      folder.name.toLowerCase() === name.toLowerCase()
  );
  if (existing) return existing.id;
  const created = await createWorkspaceFolderForUser(ownerId, {
    name,
    parentId: null,
  });
  return created?.id ?? null;
}
