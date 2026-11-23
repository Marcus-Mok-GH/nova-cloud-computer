import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createWorkspaceFolderForUser: vi.fn(
    async (): Promise<{ id: number; name: string; parentId: number | null }> => ({
      id: 3,
      name: "temp",
      parentId: null,
    })
  ),
  listWorkspaceFoldersForUser: vi.fn(
    async (): Promise<Array<{ id: number; name: string; parentId: number | null }>> => []
  ),
}));
vi.mock("./db", () => db);

import { UPLOADS_FOLDER, uploadsFolderId, uploadsPath } from "./uploadFolder";

describe("uploadsFolderId", () => {
  beforeEach(() => {
    db.createWorkspaceFolderForUser.mockClear();
    db.listWorkspaceFoldersForUser.mockClear();
    db.listWorkspaceFoldersForUser.mockResolvedValue([]);
  });

  it("lazily creates the temp folder on the first upload", async () => {
    await expect(uploadsFolderId(5)).resolves.toBe(3);
    expect(db.createWorkspaceFolderForUser).toHaveBeenCalledWith(5, {
      name: UPLOADS_FOLDER,
      parentId: null,
    });
  });

  it("reuses an existing temp folder instead of making a second one", async () => {
    db.listWorkspaceFoldersForUser.mockResolvedValue([
      { id: 8, name: UPLOADS_FOLDER, parentId: null },
    ]);
    await expect(uploadsFolderId(5)).resolves.toBe(8);
    expect(db.createWorkspaceFolderForUser).not.toHaveBeenCalled();
  });

  it("reports files as temp/<name>", () => {
    expect(uploadsPath("report.pdf")).toBe("temp/report.pdf");
  });
});
