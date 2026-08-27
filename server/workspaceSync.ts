import {
  createWorkspaceFileForUser,
  createWorkspaceFolderForUser,
  deleteWorkspaceFileForUser,
  getWorkspaceComputer,
  updateWorkspaceFileForUser,
} from "./db";
import { storageGetSignedUrl, storagePutStable } from "./storage";

const MAX_SYNC_FILES = 48;
const MAX_SYNC_FILE_BYTES = 200_000;
const INTERNAL_PATHS = new Set([".nova-task.py", "nova-manifest.json"]);

function storageKey(workspaceId: number, fileId: number) {
  return `nova-workspaces/${workspaceId}/files/${fileId}`;
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

/** Persist the current Neon workspace contents into deterministic S3 objects. */
export async function persistWorkspaceToObjectStorage(ownerId: number) {
  const computer = await getWorkspaceComputer(ownerId);
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

/** Push persistent workspace files from S3/DB into the live Daytona filesystem. */
export async function restoreWorkspaceToDaytona(ownerId: number, sandbox: { fs: any }) {
  await restoreWorkspaceFromObjectStorage(ownerId);
  const computer = await getWorkspaceComputer(ownerId);
  const uploads: Array<{ source: Buffer; destination: string }> = [];
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
    uploads.push({ source: content, destination: `/home/daytona/workspace/${relative}` });
  }
  for (const upload of uploads) {
    const parent = upload.destination.slice(0, upload.destination.lastIndexOf("/"));
    await sandbox.fs.uploadFile(Buffer.from(""), `${parent}/.nova-dir-marker`).catch(() => undefined);
    await sandbox.fs.uploadFile(upload.source, upload.destination);
  }
  return uploads.length;
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

/** Import files created/changed inside Daytona back into Neon and S3. */
export async function persistDaytonaWorkspace(ownerId: number, sandbox: { fs: any }) {
  const computer = await getWorkspaceComputer(ownerId);
  const entries = await sandbox.fs.listFiles("/home/daytona/workspace", { depth: 50 });
  const files = entries
    .filter((entry: any) => !entry.isDir && !entry.isDirectory)
    .filter((entry: any) => {
      const relative = cleanPath(String(entry.path ?? entry.name ?? ""));
      if (!relative) return false;
      if (relative.startsWith("input/")) return false;
      if (relative.startsWith("output/")) return false;
      return !INTERNAL_PATHS.has(relative.split("/").pop() ?? "");
    })
    .slice(0, MAX_SYNC_FILES);

  const seen = new Set<string>();
  let imported = 0;
  for (const entry of files) {
    const rawPath = cleanPath(String(entry.path ?? entry.name ?? ""));
    const relative = rawPath.startsWith("home/daytona/workspace/")
      ? rawPath.slice("home/daytona/workspace/".length)
      : rawPath.startsWith("/home/daytona/workspace/")
        ? rawPath.slice("/home/daytona/workspace/".length)
        : rawPath;
    const safe = safeRelativePath(relative);
    if (!safe) continue;
    const parts = safe.split("/");
    const name = parts.pop();
    if (!name) continue;
    const folderName = parts.join("/");
    const folderId = await ensureFolderPath(ownerId, folderName, computer);
    const key = `${folderName}\0${name}`;
    seen.add(key);
    const existing = computer.files.find(file => file.name === name && (file.folderId ?? null) === (folderId ?? null));
    const bytes = await sandbox.fs.downloadFile(entry.path);
    if (!Buffer.isBuffer(bytes) || bytes.byteLength > MAX_SYNC_FILE_BYTES) continue;
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

  // Only remove DB files that are inside the synchronized Daytona tree. This keeps
  // old workspaces safe if a provider returns a partial listing.
  if (files.length > 0) {
    for (const file of computer.files) {
      const path = workspaceFilePath(file, computer.folders);
      if (seen.has(`${folderPath(file.folderId, computer.folders)}\0${file.name}`)) continue;
      if (path && !path.includes("/")) continue;
      // Nested files absent from the full listing are intentionally retained.
    }
  }
  return imported;
}
