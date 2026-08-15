import { describe, expect, it } from "vitest";
import { getFolderTrail, getWorkspaceContents } from "./workspaceBrowser";

describe("workspace browser data", () => {
  const folders = [
    { id: 1, name: "Plans", parentId: null },
    { id: 2, name: "Research", parentId: 1 },
    { id: 3, name: "Archive", parentId: null },
  ];
  const files = [
    { id: 1, name: "README.md", folderId: null },
    { id: 2, name: "brief.md", folderId: 1 },
    { id: 3, name: "notes.txt", folderId: 1 },
  ];

  it("shows only the active folder's immediate folders and files", () => {
    expect(getWorkspaceContents(folders, files, null)).toEqual({
      folders: [folders[2], folders[0]],
      files: [files[0]],
    });
    expect(getWorkspaceContents(folders, files, 1)).toEqual({
      folders: [folders[1]],
      files: [files[1], files[2]],
    });
  });

  it("builds a safe breadcrumb trail from the nested workspace tree", () => {
    expect(getFolderTrail(folders, 2).map(folder => folder.name)).toEqual(["Plans", "Research"]);
    expect(getFolderTrail(folders, null)).toEqual([]);
  });
});
