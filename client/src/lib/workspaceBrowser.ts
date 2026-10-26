export type WorkspaceBrowserFolder = {
  id: number;
  name: string;
  parentId: number | null;
};

export type WorkspaceBrowserFile = {
  id: number;
  name: string;
  folderId: number | null;
  updatedAt?: Date;
};

const compareByName = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name);

export function getWorkspaceContents<
  Folder extends WorkspaceBrowserFolder,
  File extends WorkspaceBrowserFile,
>(
  folders: Folder[],
  files: File[],
  activeFolderId: number | null,
): { folders: Folder[]; files: File[] } {
  return {
    folders: folders
      .filter(folder => folder.parentId === activeFolderId)
      .sort(compareByName),
    files: files
      .filter(file => file.folderId === activeFolderId)
      .sort(compareByName),
  };
}

export function getFolderTrail(folders: WorkspaceBrowserFolder[], activeFolderId: number | null) {
  const foldersById = new Map<number, WorkspaceBrowserFolder>();
  for (const folder of folders) foldersById.set(folder.id, folder);
  const trail: WorkspaceBrowserFolder[] = [];
  const visited = new Set<number>();
  let currentId = activeFolderId;

  while (currentId !== null && !visited.has(currentId)) {
    const folder = foldersById.get(currentId);
    if (!folder) break;
    trail.push(folder);
    visited.add(currentId);
    currentId = folder.parentId;
  }

  return trail.reverse();
}
