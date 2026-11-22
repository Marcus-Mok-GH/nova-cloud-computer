import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  createWorkspaceFolderForUser: vi.fn(async (_ownerId: number, input: { name: string; parentId?: number | null }) => ({
    id: input.parentId ?? 100 + Math.floor(Math.random() * 1000),
    name: input.name,
    parentId: input.parentId ?? null,
  })),
  createWorkspaceFileForUser: vi.fn(async (_ownerId: number, input: { name: string; content?: string; folderId?: number | null }) => ({
    id: Math.floor(Math.random() * 1000),
    name: input.name,
    content: input.content ?? "",
    folderId: input.folderId ?? null,
  })),
}));
vi.mock("../db", () => db);

const composio = vi.hoisted(() => ({
  requestGithubRepositoryArchive: vi.fn(async () => ({
    url: "https://codeload.example/octocat/Hello-World/tar.gz/main",
    ref: "main",
  })),
}));
vi.mock("../composio", () => composio);

import { parseTar, toolGithubClone } from "./githubClone";

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 99), 0, 100, "utf8");
  header.write(size.toString(8).padStart(11, "0") + " ", 124, 12, "ascii");
  header[156] = "0".charCodeAt(0);
  return header;
}

function tarEntry(name: string, content: Buffer): Buffer {
  const padded = Buffer.concat([content, Buffer.alloc((512 - (content.length % 512)) % 512)]);
  return Buffer.concat([tarHeader(name, content.length), padded]);
}

function tarOf(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const parts = entries.map(entry => tarEntry(entry.name, entry.content));
  parts.push(Buffer.alloc(1024)); // end-of-archive
  return Buffer.concat(parts);
}

type Ctx = Parameters<typeof toolGithubClone>[0];

function makeCtx(): Ctx {
  return {
    ownerId: 7,
    computer: { folders: [], files: [] },
    folderRows: [],
    args: {},
    str: (value: unknown) => String(value ?? ""),
    mirror: vi.fn(async () => undefined),
  } as unknown as Ctx;
}

describe("parseTar", () => {
  it("reads file entries and skips directories and pax headers", () => {
    const tar = tarOf([
      { name: "Hello-World-main/", content: Buffer.alloc(0) },
      { name: "Hello-World-main/README.md", content: Buffer.from("# Hello") },
      { name: "Hello-World-main/src/index.ts", content: Buffer.from("export {};\n") },
    ]);
    expect(parseTar(tar)).toEqual([
      { path: "Hello-World-main/README.md", content: "# Hello" },
      { path: "Hello-World-main/src/index.ts", content: "export {};\n" },
    ]);
  });
});

describe("toolGithubClone", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    db.createWorkspaceFolderForUser.mockClear();
    db.createWorkspaceFileForUser.mockClear();
    composio.requestGithubRepositoryArchive.mockClear();
    composio.requestGithubRepositoryArchive.mockResolvedValue({
      url: "https://codeload.example/octocat/Hello-World/tar.gz/main",
      ref: "main",
    });
  });

  it("unpacks the repository into a named workspace folder and mirrors it", async () => {
    const archive = gzipSync(
      tarOf([
        { name: "Hello-World-main/README.md", content: Buffer.from("# Hello") },
        { name: "Hello-World-main/src/index.ts", content: Buffer.from("export {};\n") },
        { name: "Hello-World-main/logo.png", content: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]) },
      ])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(archive), { status: 200 }))
    );

    const ctx = makeCtx();
    const result = await toolGithubClone(ctx, { repo: "octocat/Hello-World" });
    expect(result.ok).toBe(true);
    expect(result.result).toContain("Cloned octocat/Hello-World");
    expect(result.result).toContain("branch/ref \"main\"");
    expect(result.result).toContain("2 file(s) written");
    expect(result.result).toContain("1 binary file(s) skipped");

    // Root folder plus the nested src/ folder were created.
    const names = db.createWorkspaceFolderForUser.mock.calls.map(call => call[1].name);
    expect(names).toEqual(["Hello-World", "src"]);
    expect(db.createWorkspaceFileForUser).toHaveBeenCalledTimes(2);
    const mirrored = (ctx.mirror as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0].path);
    expect(mirrored).toEqual([
      "Hello-World/README.md",
      "Hello-World/src/index.ts",
    ]);
    vi.unstubAllGlobals();
  });

  it("surfaces a failed download instead of writing anything", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 }))
    );
    const ctx = makeCtx();
    const result = await toolGithubClone(ctx, { repo: "octocat/Hello-World" });
    expect(result.ok).toBe(false);
    expect(result.result).toContain("status 404");
    expect(db.createWorkspaceFileForUser).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
