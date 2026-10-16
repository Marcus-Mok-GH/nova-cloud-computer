import { folderPathOf, workspaceRelativePathOf } from "../sandboxWorkspace";
import {
  type Computer,
  type FileRow,
  type FolderRow,
  type FolderRowLike,
  type ToolExecution,
} from "./types";

export function resolveFolder(
  computer: Computer,
  ref: unknown
): FolderRow | undefined {
  if (typeof ref !== "string" || !ref.trim()) return undefined;
  const key = ref.trim();
  const numeric = /^\d+$/.test(key) ? Number(key) : undefined;
  if (numeric !== undefined) {
    const byId = computer.folders.find(folder => folder.id === numeric);
    if (byId) return byId;
  }
  const normalized = normalizeWorkspaceRef(key);
  const byName = computer.folders.find(
    folder => folder.name.toLowerCase() === normalized
  );
  if (byName) return byName;
  // Nested folder path, e.g. "sites/ph-meter": match the last segment with
  // its parent path.
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  const base = segments[segments.length - 1];
  const dir = segments.slice(0, -1).join("/");
  const folderRows = folderRowsOf(computer);
  return computer.folders.find(
    folder =>
      folder.name.toLowerCase() === base &&
      (folderPathOf(folderRows, folder.parentId ?? null)?.toLowerCase() ??
        "") === dir
  );
}

/** Normalizes a workspace reference the way a model might write it: a bare
 * name, an id, or a path like "folder-name/index.html" (optionally prefixed
 * with "./" or "/"). Returns lowercase, no leading/trailing slashes. */
export function normalizeWorkspaceRef(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:\.?\/)+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export function folderRowsOf(computer: Computer): FolderRowLike[] {
  return computer.folders as FolderRowLike[];
}

/** The workspace-relative path of a file, lowercase ("folder/index.html"). */
function fileWorkspacePath(
  folderRows: FolderRowLike[],
  file: { name: string; folderId: number | null }
): string {
  return (
    workspaceRelativePathOf(
      folderRows,
      file.name,
      file.folderId
    )?.toLowerCase() ?? file.name.toLowerCase()
  );
}

export function resolveFile(
  computer: Computer,
  ref: unknown,
  options: { strict?: boolean } = {}
): FileRow | undefined {
  if (typeof ref !== "string" || !ref.trim()) return undefined;
  const key = ref.trim();
  const numeric = /^\d+$/.test(key) ? Number(key) : undefined;
  if (numeric !== undefined) {
    const byId = computer.files.find(file => file.id === numeric);
    if (byId) return byId;
  }
  const normalized = normalizeWorkspaceRef(key);
  const folderRows = folderRowsOf(computer);
  // 1. Exact name match (case-insensitive) - the common case.
  const byName = computer.files.find(
    file => file.name.toLowerCase() === normalized
  );
  if (byName) return byName;
  // 2. Full workspace-path match, e.g. "ph-meter/index.html".
  const byPath = computer.files.find(
    file => fileWorkspacePath(folderRows, file) === normalized
  );
  if (byPath) return byPath;
  // 3. Path-style ref whose last segment names a file: resolve by basename,
  //    preferring the file inside the folder path the ref points at.
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  const base = segments[segments.length - 1];
  const dir = segments.slice(0, -1).join("/");
  const basenameMatches = computer.files.filter(
    file => file.name.toLowerCase() === base
  );
  if (basenameMatches.length === 0) return undefined;
  if (dir) {
    const inDir = basenameMatches.find(file => {
      const parent =
        folderPathOf(folderRows, file.folderId ?? null)?.toLowerCase() ?? "";
      return parent === dir;
    });
    if (inDir) return inDir;
  }
  // Mutating tools must not act on a loose basename match for a
  // path-qualified ref: deleting "wrong-folder/report.md" should never
  // delete some other folder's report.md.
  if (options.strict) return undefined;
  return basenameMatches[0];
}

/** A "File not found" tool result that steers the model out of path-guessing
 * loops: the original ref, the closest existing candidates, and the one
 * command that always works. Keeps the "File not found:" prefix the failure
 * nudges quote. */
export function fileNotFoundResult(computer: Computer, ref: unknown): string {
  const raw = typeof ref === "string" ? ref : String(ref ?? "");
  const normalized = normalizeWorkspaceRef(String(raw));
  const folderRows = folderRowsOf(computer);
  const segments = normalized.split("/").filter(Boolean);
  const base = segments[segments.length - 1] ?? normalized;
  const suggestions: string[] = [];
  const seen = new Set<string>();
  for (const file of computer.files) {
    const path = fileWorkspacePath(folderRows, file);
    if (seen.has(path)) continue;
    const pathSegments = path.split("/");
    const matches =
      file.name.toLowerCase() === base ||
      path === normalized ||
      (segments.length > 1 && path.endsWith(`/${normalized}`)) ||
      segments.some(
        seg =>
          seg.length >= 3 &&
          pathSegments.some(
            pSeg => pSeg === seg || pSeg.includes(seg) || seg.includes(pSeg)
          )
      );
    if (!matches) continue;
    seen.add(path);
    suggestions.push(`${path} (id ${file.id})`);
    if (suggestions.length >= 5) break;
  }
  const hint = suggestions.length
    ? ` Closest matches: ${suggestions.join(", ")}. Use the exact name or id from that list.`
    : " No existing file looks similar - call list_workspace to see every file and folder before trying again.";
  return `File not found: ${raw}.${hint}`;
}

/**
 * The failure returned when a tool names a folder that does not exist. Every
 * folder-taking tool steers the model the same way, from one place.
 */
export function folderNotFound(
  ref: unknown,
  label: "Folder" | "Parent folder" = "Folder"
): ToolExecution {
  const raw = typeof ref === "string" ? ref.trim() : "";
  const hint =
    label === "Folder" ? " Use list_workspace to see every folder." : "";
  return { ok: false, result: `${label} not found: ${raw}.${hint}` };
}

/**
 * True when a sibling at the same level already uses this name. Root-level
 * rows never collide in the database (a NULL parent id is not compared), so
 * every create/rename/move guards itself with this same check - files through
 * their folderId, folders through their parentId.
 */
export function nameTakenAtLevel<T extends { id: number; name: string }>(
  rows: readonly T[],
  name: string,
  levelOf: (row: T) => number | null,
  level: number | null,
  excludeId?: number
): boolean {
  const wanted = name.toLowerCase();
  return rows.some(
    row =>
      (excludeId === undefined || row.id !== excludeId) &&
      levelOf(row) === level &&
      row.name.toLowerCase() === wanted
  );
}

export function describeWorkspace(computer: Computer) {
  const folders =
    computer.folders
      .map(
        folder =>
          `${folder.name} (id ${folder.id}${folder.parentId ? `, parent id ${folder.parentId}` : ""})`
      )
      .join(", ") || "none";
  const files =
    computer.files
      .map(
        file =>
          `${file.name} (id ${file.id}${file.folderId ? `, folder id ${file.folderId}` : ""})`
      )
      .join(", ") || "none";
  return { folders, files };
}
