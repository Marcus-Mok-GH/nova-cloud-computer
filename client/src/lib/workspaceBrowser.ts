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

export function getWorkspaceContents<
  Folder extends WorkspaceBrowserFolder,
  File extends WorkspaceBrowserFile,
>(
  folders: Folder[],
  files: File[],
  activeFolderId: number | null,
): { folders: Folder[]; files: File[] } {
  const inActiveFolder = (itemFolderId: number | null) => itemFolderId === activeFolderId;

  return {
    folders: folders
      .filter(folder => inActiveFolder(folder.parentId))
      .sort((left, right) => left.name.localeCompare(right.name)),
    files: files
      .filter(file => inActiveFolder(file.folderId))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export function getFolderTrail(folders: WorkspaceBrowserFolder[], activeFolderId: number | null) {
  const foldersById = new Map(folders.map(folder => [folder.id, folder]));
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
