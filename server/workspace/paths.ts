/**
 * The one traversal guard for workspace-relative paths. Historically
 * sandboxWorkspace.ts and workspaceSync.ts each carried their own copy of
 * these helpers, so a hardening fix applied to one silently missed the other;
 * they now all live here.
 */

/** Normalizes separators and strips leading/trailing slashes. */
export function cleanPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/**
 * A workspace-relative path, or null if it is not safe to touch: `..`
 * segments and NUL bytes are rejected outright, and `.` segments are dropped
 * as the no-ops they are (`./src/a.ts` normalizes to `src/a.ts`).
 */
export function safeRelativePath(value: string): string | null {
  const parts = cleanPath(value)
    .split("/")
    .filter(part => part && part !== ".");
  if (parts.some(part => part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

/**
 * The workspace-relative path of a folder row, walking parent ids and
 * guarding against cycles; null for the root (no folder) or an unreachable id.
 */
export function folderPathOf(
  folders: Array<{ id: number; name: string; parentId: number | null }>,
  folderId: number | null
): string | null {
  if (folderId === null || folderId === undefined) return null;
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const parts: string[] = [];
  const seen = new Set<number>();
  let current: number | null = folderId;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    parts.unshift(folder.name);
    current = folder.parentId ?? null;
  }
  return parts.join("/") || null;
}

/** The workspace-relative path of a file, given its folder id. */
export function workspaceRelativePathOf(
  folders: Array<{ id: number; name: string; parentId: number | null }>,
  name: string,
  folderId: number | null
): string | null {
  const parent = folderPathOf(folders, folderId);
  return safeRelativePath(parent ? `${parent}/${name}` : name);
}
