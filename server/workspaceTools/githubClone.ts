/**
 * The GitHub clone operation: download a repository's default-branch tarball
 * through the connected GitHub account and unpack it into workspace Files.
 *
 * The archive download happens server-side (the connector's OAuth credential
 * never reaches the sandbox), so private repositories clone too. The unpack is
 * deliberately conservative: text files up to a size cap, a bounded file count
 * and archive size, and a hard skip of anything that looks binary.
 */
import { gunzipSync } from "node:zlib";

import {
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
} from "../db";
import { requestGithubRepositoryArchive } from "../composio";
import { type ToolCtx, type ToolExecution } from "./types";

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 3_000;
const MAX_FILE_CHARS = 1_000_000;

type ArchiveEntry = { path: string; content: string };

/** Parses an uncompressed tar buffer into text file entries. */
export function parseTar(buffer: Buffer): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break; // end-of-archive marker
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const rawSize = header.subarray(124, 136).toString("ascii").replace(/[\0 ].*$/, "");
    const size = Number.parseInt(rawSize, 8) || 0;
    const type = String.fromCharCode(header[156] ?? 0);
    offset += 512;
    const data = buffer.subarray(offset, Math.min(buffer.length, offset + size));
    offset += Math.ceil(size / 512) * 512;

    if (type === "g" || type === "x") continue; // pax extended headers
    if (type === "5" || rawName.endsWith("/")) continue; // directory
    if (!rawName || size < 0) continue;
    entries.push({ path: rawName, content: data.toString("utf8") });
  }
  return entries;
}

function stripArchiveRoot(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length > 1) parts.shift(); // GitHub archives wrap everything in "<repo>-<ref>/"
  const cleaned = parts.filter(part => part !== "." && part !== "..");
  if (!cleaned.length) return null;
  return cleaned.join("/");
}

function safeFolderName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 80) || "repository";
}

function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

/** Ensures the nested folder chain exists and returns the leaf folder id. */
async function ensureFolder(
  ctx: ToolCtx,
  rootFolderId: number,
  segments: string[]
): Promise<number> {
  const cacheKey = segments.join("/");
  const cached = ensureFolder.cache.get(cacheKey);
  if (cached) return cached;
  let parentId = rootFolderId;
  for (let index = 0; index < segments.length; index += 1) {
    const name = safeFolderName(segments[index]);
    const pathKey = segments.slice(0, index + 1).join("/");
    const existing = ensureFolder.cache.get(pathKey);
    if (existing) {
      parentId = existing;
      continue;
    }
    const created = await createWorkspaceFolderForUser(ctx.ownerId, {
      name,
      parentId,
    });
    if (!created) throw new Error(`Could not create the ${pathKey} folder.`);
    ensureFolder.cache.set(pathKey, created.id);
    parentId = created.id;
  }
  ensureFolder.cache.set(cacheKey, parentId);
  return parentId;
}
ensureFolder.cache = new Map<string, number>();

export async function toolGithubClone(ctx: ToolCtx, args: Record<string, unknown>): Promise<ToolExecution> {
  const label = "GitHub: clone repository";
  try {
    const repo = typeof args.repo === "string" ? args.repo.trim() : "";
    if (!repo) return { ok: false, result: "A repository (owner/name) is required.", action: { kind: "connector", name: label, operation: "failed" } };
    const ref = typeof args.ref === "string" ? args.ref.trim() || undefined : undefined;
    const destination =
      typeof args.destination === "string" && args.destination.trim()
        ? safeFolderName(args.destination)
        : safeFolderName(repo.split("/")[1] ?? repo);

    const { url, ref: resolvedRef } = await requestGithubRepositoryArchive(ctx.ownerId, {
      repo,
      ...(ref ? { ref } : {}),
    });

    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok)
      return {
        ok: false,
        result: `Downloading the archive failed (status ${response.status}). Make sure the connected GitHub account can read this repository.`,
        action: { kind: "connector", name: label, operation: "failed" },
      };
    const archiveBytes = Buffer.from(await response.arrayBuffer());
    if (archiveBytes.length > MAX_ARCHIVE_BYTES)
      return {
        ok: false,
        result: `The repository archive is ${(archiveBytes.length / 1024 / 1024).toFixed(1)} MB, over the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB clone limit.`,
        action: { kind: "connector", name: label, operation: "failed" },
      };

    let entries: ArchiveEntry[];
    try {
      entries = parseTar(gunzipSync(archiveBytes));
    } catch {
      return {
        ok: false,
        result: "The downloaded archive could not be unpacked. Try again, or clone a smaller repository.",
        action: { kind: "connector", name: label, operation: "failed" },
      };
    }

    const rootName = destination;
    const existingRoot = ctx.computer.folders.find(
      folder => folder.parentId === null && folder.name.toLowerCase() === rootName.toLowerCase()
    );
    const rootFolder =
      existingRoot ??
      (await createWorkspaceFolderForUser(ctx.ownerId, { name: rootName, parentId: null }));
    if (!rootFolder)
      return { ok: false, result: "Could not create the destination folder.", action: { kind: "connector", name: label, operation: "failed" } };

    ensureFolder.cache.clear();
    const skipped = { binary: 0, oversize: 0, path: 0 };
    const writes: Array<{ path: string; content: string }> = [];
    for (const entry of entries) {
      if (writes.length >= MAX_FILES) break;
      const relativePath = stripArchiveRoot(entry.path);
      if (!relativePath) {
        skipped.path += 1;
        continue;
      }
      if (entry.content.length > MAX_FILE_CHARS) {
        skipped.oversize += 1;
        continue;
      }
      if (looksBinary(entry.content)) {
        skipped.binary += 1;
        continue;
      }
      const segments = relativePath.split("/");
      const fileName = segments.pop()!;
      const folderId = segments.length
        ? await ensureFolder(ctx, rootFolder.id, segments)
        : rootFolder.id;
      const created = await createWorkspaceFileForUser(ctx.ownerId, {
        name: fileName,
        content: entry.content,
        folderId,
      });
      if (created) writes.push({ path: `${rootName}/${relativePath}`, content: entry.content });
    }

    // Mirror in small batches so a big repo cannot stall the run.
    for (let index = 0; index < writes.length; index += 25) {
      await Promise.all(
        writes.slice(index, index + 25).map(write =>
          ctx.mirror({ kind: "write_file", path: write.path, content: write.content })
        )
      );
    }

    const parts = [
      `Cloned ${repo} (branch/ref "${resolvedRef}") into ${rootName}/.`,
      `${writes.length} file(s) written.`,
    ];
    if (skipped.binary) parts.push(`${skipped.binary} binary file(s) skipped.`);
    if (skipped.oversize) parts.push(`${skipped.oversize} oversized file(s) skipped.`);
    if (skipped.path) parts.push(`${skipped.path} unusable path(s) skipped.`);
    if (writes.length >= MAX_FILES) parts.push(`Stopped at the ${MAX_FILES}-file clone limit.`);
    return {
      ok: true,
      result: parts.join(" "),
      action: { kind: "connector", name: label, operation: "executed" },
    };
  } catch (error) {
    return {
      ok: false,
      result: error instanceof Error ? error.message : "The clone failed for an unknown reason.",
      action: { kind: "connector", name: label, operation: "failed" },
    };
  }
}
