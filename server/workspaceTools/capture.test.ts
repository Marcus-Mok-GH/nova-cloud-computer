import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createWorkspaceFileForUser: vi.fn(async (_ownerId: number, input: { name: string; folderId?: number | null }) => ({
    id: 42,
    name: input.name,
    folderId: input.folderId ?? null,
  })),
  createWorkspaceFolderForUser: vi.fn(async () => ({ id: 7, name: "Captures", parentId: null })),
  listWorkspaceFoldersForUser: vi.fn(async () => []),
}));
vi.mock("../db", () => db);

import { CAPTURES_FOLDER, saveBrowseCapture } from "./capture";

const capture = { dataUri: "data:image/png;base64,AAAA" } as never;

describe("saveBrowseCapture", () => {
  beforeEach(() => {
    db.createWorkspaceFileForUser.mockClear();
    db.createWorkspaceFolderForUser.mockClear();
    db.listWorkspaceFoldersForUser.mockClear();
    db.listWorkspaceFoldersForUser.mockResolvedValue([]);
  });

  it("keeps captures out of the workspace root by creating the Captures folder", async () => {
    const message = await saveBrowseCapture(7, capture);
    expect(db.createWorkspaceFolderForUser).toHaveBeenCalledWith(7, {
      name: CAPTURES_FOLDER,
      parentId: null,
    });
    expect(db.createWorkspaceFileForUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ folderId: 7 })
    );
    expect(message).toContain(`${CAPTURES_FOLDER}/`);
    expect(message).toContain(".png");
  });

  it("reuses an existing Captures folder instead of making a second one", async () => {
    db.listWorkspaceFoldersForUser.mockResolvedValue([
      { id: 9, name: CAPTURES_FOLDER, parentId: null },
    ]);
    await saveBrowseCapture(7, capture);
    expect(db.createWorkspaceFolderForUser).not.toHaveBeenCalled();
    expect(db.createWorkspaceFileForUser).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ folderId: 9 })
    );
  });
});
