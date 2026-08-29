import { getOrCreateWorkspace } from "./db";

/** Defense-in-depth boundary for private workspace data. */
export async function requireWorkspaceOwner(ownerId: number, workspaceId: number) {
  if (!Number.isInteger(ownerId) || ownerId <= 0 || !Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new Error("Invalid private workspace identity.");
  }
  const workspace = await getOrCreateWorkspace(ownerId);
  if (workspace.id !== workspaceId || workspace.ownerId !== ownerId) {
    throw new Error("Private workspace access denied.");
  }
  return workspace;
}

/** Storage keys are never allowed to escape the owning workspace namespace. */
export function requireWorkspaceStorageKey(workspaceId: number, key: string) {
  const normalized = key.replace(/^\/+/, "");
  const prefix = `nova-workspaces/${workspaceId}/`;
  if (!normalized.startsWith(prefix) || normalized.includes("..") || normalized.includes("\\")) {
    throw new Error("Private storage access denied.");
  }
  return normalized;
}
