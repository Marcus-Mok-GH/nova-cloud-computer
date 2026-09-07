import { describe, expect, it } from "vitest";
import { wouldCreateWorkspaceFolderCycle } from "./workspaceFolderTree";

describe("wouldCreateWorkspaceFolderCycle", () => {
  const folders = [
    { id: 1, parentId: null },
    { id: 2, parentId: 1 },
    { id: 3, parentId: 2 },
    { id: 4, parentId: null },
  ];

  it("rejects moving a folder beneath one of its descendants", () => {
    expect(wouldCreateWorkspaceFolderCycle(folders, 1, 3)).toBe(true);
    expect(wouldCreateWorkspaceFolderCycle(folders, 2, 3)).toBe(true);
  });

  it("allows moves to another branch or the workspace root", () => {
    expect(wouldCreateWorkspaceFolderCycle(folders, 2, 4)).toBe(false);
    expect(wouldCreateWorkspaceFolderCycle(folders, 2, null)).toBe(false);
  });

  it("terminates when inspecting an already-corrupt ancestor chain", () => {
    const corruptFolders = [
      { id: 1, parentId: 2 },
      { id: 2, parentId: 1 },
      { id: 3, parentId: null },
    ];

    expect(wouldCreateWorkspaceFolderCycle(corruptFolders, 3, 1)).toBe(false);
  });
});
