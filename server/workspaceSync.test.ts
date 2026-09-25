import { beforeEach, describe, expect, it, vi } from "vitest";
import { persistE2BWorkspace } from "./workspaceSync";
import { E2B_WORKSPACE_DIR } from "./e2b";

const state = vi.hoisted(() => ({
  files: [] as Array<{ id: number; name: string; folderId: number | null; content: string; mimeType: string }>,
  folders: [] as Array<{ id: number; name: string; parentId: number | null }>,
  nextFileId: 100,
  nextFolderId: 1,
}));

vi.mock("./db", () => ({
  getWorkspaceComputer: async () => ({ workspace: { id: 1 }, folders: state.folders, files: state.files }),
  getOrCreateWorkspace: async () => ({ id: 1, ownerId: 8 }),
  requireWorkspaceOwner: async () => undefined,
  createWorkspaceFolderForUser: async (ownerId: number, input: { name: string; parentId: number | null }) => {
    const folder = { id: state.nextFolderId++, name: input.name, parentId: input.parentId };
    return folder;
  },
  createWorkspaceFileForUser: async (ownerId: number, input: { name: string; content: string; mimeType: string; folderId: number | null }) => {
    const file = { id: state.nextFileId++, name: input.name, folderId: input.folderId, content: input.content, mimeType: input.mimeType };
    state.files.push(file);
    return file;
  },
  updateWorkspaceFileForUser: async (ownerId: number, id: number, input: { content: string }) => {
    const file = state.files.find(f => f.id === id);
    if (!file) return undefined;
    file.content = input.content;
    return file;
  },
}));

const sandbox = {
  files: {
    list: vi.fn(async () => [
      { path: `${E2B_WORKSPACE_DIR}/site/index.html`, type: "file" },
      { path: `${E2B_WORKSPACE_DIR}/.git/index`, type: "file" },
      { path: `${E2B_WORKSPACE_DIR}/assets/logo.bin`, type: "file" },
    ]),
    read: vi.fn(async (path: string) => {
      if (path.endsWith("index.html")) return new TextEncoder().encode("<h1>hello</h1>");
      if (path.endsWith("logo.bin")) return new Uint8Array([0x44, 0x49, 0x52, 0x43, 0x80, 0x81]);
      throw new Error(`unexpected read ${path}`);
    }),
  },
} as never;

beforeEach(() => {
  state.files = [];
  state.folders = [];
  state.nextFileId = 100;
  state.nextFolderId = 1;
});

describe("persistE2BWorkspace", () => {
  it("imports website files while skipping git internals and non-UTF-8 content", async () => {
    const imported = await persistE2BWorkspace(8, sandbox);
    console.log('DEBUG folders', JSON.stringify(state.folders), 'files', JSON.stringify(state.files));
    expect(imported).toBe(1);
    expect(state.files).toHaveLength(1);
    expect(state.files[0].name).toBe("index.html");
    expect(state.files[0].content).toBe("<h1>hello</h1>");
    expect(state.folders.map(f => f.name)).toEqual(["site"]);
  });

  it("does not let one unreadable file abort the rest of the import", async () => {
    sandbox.files.read = vi.fn(async (path: string) => {
      if (path.endsWith("index.html")) return new TextEncoder().encode("<h1>hello</h1>");
      if (path.endsWith("logo.bin")) throw new Error("file vanished mid-sync");
      throw new Error(`unexpected read ${path}`);
    }) as never;
    const imported = await persistE2BWorkspace(8, sandbox);
    expect(imported).toBe(1);
    expect(state.files.map(f => f.name)).toEqual(["index.html"]);
  });
});
