export type WorkspaceFolderParent = {
  id: number;
  parentId: number | null;
};

/** Returns whether assigning `parentId` to `folderId` would make it its own ancestor. */
export function wouldCreateWorkspaceFolderCycle(
  folders: WorkspaceFolderParent[],
  folderId: number,
  parentId: number | null,
) {
  if (parentId === null) return false;

  const foldersById = new Map(folders.map(folder => [folder.id, folder]));
  const visited = new Set<number>();
  let currentId: number | null = parentId;

  while (currentId !== null && !visited.has(currentId)) {
    if (currentId === folderId) return true;
    visited.add(currentId);
    currentId = foldersById.get(currentId)?.parentId ?? null;
  }

  return false;
}
