import {
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  getWorkspaceComputer,
  updateWorkspaceFileForUser,
} from "./db";
import { storageGetSignedUrl, storagePutStable } from "./storage";
import { requireWorkspaceOwner, requireWorkspaceStorageKey } from "./workspaceSecurity";
import { E2B_WORKSPACE_DIR, type E2BSandboxLike } from "./e2b";

const MAX_SYNC_FILES = 48;
const MAX_SYNC_FILE_BYTES = 200_000;
const INTERNAL_PATHS = new Set([".nova-task.py", "nova-manifest.json"]);

function storageKey(workspaceId: number, fileId: number) {
  return requireWorkspaceStorageKey(workspaceId, `nova-workspaces/${workspaceId}/files/${fileId}`);
}

function cleanPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function folderPath(folderId: number | null, folders: Array<{ id: number; name: string; parentId: number | null }>) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const parts: string[] = [];
  const seen = new Set<number>();
  let current = folderId;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    parts.unshift(folder.name);
    current = folder.parentId;
  }
  return parts.join("/");
}

function workspaceFilePath(file: { name: string; folderId: number | null }, folders: Array<{ id: number; name: string; parentId: number | null }>) {
  const parent = folderPath(file.folderId, folders);
  return parent ? `${parent}/${file.name}` : file.name;
}

function safeRelativePath(value: string) {
  const parts = cleanPath(value).split("/").filter(Boolean);
  if (parts.some(part => part === "." || part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

function workspaceRelativePath(value: string) {
  const raw = cleanPath(value);
  const relativePrefix = E2B_WORKSPACE_DIR.slice(1);
  if (raw.startsWith(`${relativePrefix}/`)) return raw.slice(relativePrefix.length + 1);
  if (raw.startsWith(`${E2B_WORKSPACE_DIR}/`)) return raw.slice(E2B_WORKSPACE_DIR.length + 1);
  return raw;
}

async function createE2BFolders(sandbox: E2BSandboxLike, destination: string) {
  const parent = destination.slice(0, destination.lastIndexOf("/"));
  if (!parent) return;
  const parts = parent.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    if (sandbox.files.makeDir) await sandbox.files.makeDir(current).catch(() => undefined);
  }
}

/** Persist the current Neon workspace contents into deterministic, private S3 objects. */
export async function persistWorkspaceToObjectStorage(ownerId: number) {
  const computer = await getWorkspaceComputer(ownerId);
  await requireWorkspaceOwner(ownerId, computer.workspace.id);
  let uploaded = 0;
  for (const file of computer.files.slice(0, MAX_SYNC_FILES)) {
    const body = Buffer.from(file.content ?? "", "utf8");
    if (body.byteLength > MAX_SYNC_FILE_BYTES) continue;
    await storagePutStable(storageKey(computer.workspace.id, file.id), body, file.mimeType || "text/plain");
    uploaded += 1;
  }
  return { workspaceId: computer.workspace.id, uploaded };
}

/** Restore S3-backed file contents into the workspace records, falling back to DB for older files. */
export async function restoreWorkspaceFromObjectStorage(ownerId: number) {
  const computer = await getWorkspaceComputer(ownerId);
  await requireWorkspaceOwner(ownerId, computer.workspace.id);
  let restored = 0;
  for (const file of computer.files.slice(0, MAX_SYNC_FILES)) {
    try {
      const signedUrl = await storageGetSignedUrl(storageKey(computer.workspace.id, file.id));
      const response = await fetch(signedUrl);
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_SYNC_FILE_BYTES) continue;
      const content = bytes.toString("utf8");
      if (content !== file.content) {
        await updateWorkspaceFileForUser(ownerId, file.id, { content });
        restored += 1;
      }
    } catch {
      // Older workspace files may not have an S3 object yet. The DB copy remains valid.
    }
  }
  return restored;
}

/** Push persistent workspace files from S3/DB into the live E2B filesystem. */
export async function restoreWorkspaceToE2B(ownerId: number, sandbox: E2BSandboxLike) {
  await restoreWorkspaceFromObjectStorage(ownerId);
  const computer = await getWorkspaceComputer(ownerId);
  await requireWorkspaceOwner(ownerId, computer.workspace.id);
  let uploaded = 0;
  for (const file of computer.files.slice(0, MAX_SYNC_FILES)) {
    let content = Buffer.from(file.content ?? "", "utf8");
    try {
      const signedUrl = await storageGetSignedUrl(storageKey(computer.workspace.id, file.id));
      const response = await fetch(signedUrl);
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength <= MAX_SYNC_FILE_BYTES) content = bytes;
      }
    } catch {
      // Use the DB cache if the object is not available.
    }
    const relative = safeRelativePath(workspaceFilePath(file, computer.folders));
    if (!relative) continue;
    const destination = `${E2B_WORKSPACE_DIR}/${relative}`;
    await createE2BFolders(sandbox, destination);
    await sandbox.files.write(destination, content);
    uploaded += 1;
  }
  return uploaded;
}

async function ensureFolderPath(ownerId: number, path: string, computer: Awaited<ReturnType<typeof getWorkspaceComputer>>) {
  if (!path) return null;
  const segments = cleanPath(path).split("/").filter(Boolean);
  let parentId: number | null = null;
  for (const segment of segments) {
    let folder = computer.folders.find(item => item.name === segment && item.parentId === parentId);
    if (!folder) {
      folder = await createWorkspaceFolderForUser(ownerId, { name: segment, parentId });
      if (!folder) return null;
      computer.folders.push(folder);
    }
    parentId = folder.id;
  }
  return parentId;
}

/** Import files created/changed inside E2B back into Neon and private S3. */
export async function persistE2BWorkspace(ownerId: number, sandbox: E2BSandboxLike) {
  const computer = await getWorkspaceComputer(ownerId);
  await requireWorkspaceOwner(ownerId, computer.workspace.id);
  const entries = await sandbox.files.list(E2B_WORKSPACE_DIR, { depth: 50 });
  const files = entries
    .filter((entry: any) => entry.type !== "dir" && !entry.isDir && !entry.isDirectory)
    .filter((entry: any) => {
      const relative = workspaceRelativePath(String(entry.path ?? entry.name ?? ""));
      if (!relative) return false;
      if (relative.startsWith("input/")) return false;
      if (relative.startsWith("output/")) return false;
      return !INTERNAL_PATHS.has(relative.split("/").pop() ?? "");
    })
    .slice(0, MAX_SYNC_FILES);

  let imported = 0;
  for (const entry of files) {
    const relative = workspaceRelativePath(String(entry.path ?? entry.name ?? ""));
    const safe = safeRelativePath(relative);
    if (!safe) continue;
    const parts = safe.split("/");
    const name = parts.pop();
    if (!name) continue;
    const folderName = parts.join("/");
    const folderId = await ensureFolderPath(ownerId, folderName, computer);
    if (folderName && folderId === null) continue;
    const existing = computer.files.find(file => file.name === name && (file.folderId ?? null) === (folderId ?? null));
    const bytes = await sandbox.files.read(entry.path, { format: "bytes" });
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_SYNC_FILE_BYTES) continue;
    const content = Buffer.from(bytes).toString("utf8");
    const mimeType = typeof entry.mimeType === "string" ? entry.mimeType : "text/plain";
    let saved = existing;
    if (saved) {
      if (saved.content !== content || saved.mimeType !== mimeType) {
        saved = await updateWorkspaceFileForUser(ownerId, saved.id, { content, folderId }) ?? saved;
      }
    } else {
      saved = await createWorkspaceFileForUser(ownerId, { name, content, mimeType, folderId }) ?? undefined;
    }
    if (!saved) continue;
    await storagePutStable(storageKey(computer.workspace.id, saved.id), Buffer.from(content, "utf8"), mimeType);
    imported += 1;
  }

  return imported;
}
