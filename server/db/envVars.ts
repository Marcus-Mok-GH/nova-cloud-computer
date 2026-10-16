import { and, asc, eq, inArray } from "drizzle-orm";
import { workspaceEnvVars } from "../../drizzle/schema";
import { decryptPrivateCredential, encryptPrivateCredential } from "../modelSecrets";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";

export type WorkspaceEnvVarEntry = { name: string; value: string };

/** Every env var of the workspace as plain name/value pairs, name-sorted. */
export async function listWorkspaceEnvVarsForUser(ownerId: number): Promise<WorkspaceEnvVarEntry[]> {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.select().from(workspaceEnvVars)
    .where(eq(workspaceEnvVars.workspaceId, workspace.id))
    .orderBy(asc(workspaceEnvVars.name));
  return rows.map(row => ({ name: row.name, value: decryptPrivateCredential(row.encryptedValue) }));
}

/**
 * Replaces the workspace's full env-var set with `vars` (settings-page save
 * semantics: the submitted list is the new truth - anything omitted is
 * removed). Duplicate names collapse to the last entry, empty names/values
 * are dropped, and every name is normalized to upper case so the agent's
 * name-based deploy argument matches case-insensitively.
 */
export async function saveWorkspaceEnvVarsForUser(ownerId: number, vars: WorkspaceEnvVarEntry[]): Promise<WorkspaceEnvVarEntry[]> {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const byName = new Map<string, string>();
  for (const entry of vars) {
    const name = entry.name.trim().toUpperCase();
    const value = entry.value.trim();
    if (!name || !value) continue;
    byName.set(name, value);
  }
  const existing = await db.select().from(workspaceEnvVars).where(eq(workspaceEnvVars.workspaceId, workspace.id));
  const existingNames = new Set(existing.map(row => row.name));
  const keptNames = new Set(byName.keys());
  const staleIds = existing.filter(row => !keptNames.has(row.name)).map(row => row.id);
  if (staleIds.length > 0)
    await db.delete(workspaceEnvVars).where(and(eq(workspaceEnvVars.workspaceId, workspace.id), inArray(workspaceEnvVars.id, staleIds)));
  for (const [name, value] of Array.from(byName.entries())) {
    const encryptedValue = encryptPrivateCredential(value);
    if (existingNames.has(name)) {
      await db.update(workspaceEnvVars)
        .set({ encryptedValue, updatedAt: new Date() })
        .where(and(eq(workspaceEnvVars.workspaceId, workspace.id), eq(workspaceEnvVars.name, name)));
    } else {
      await db.insert(workspaceEnvVars).values({ workspaceId: workspace.id, name, encryptedValue });
    }
  }
  return Array.from(byName.entries()).map(([name, value]) => ({ name, value }));
}

/** The workspace's env var names (never values), for the agent's system prompt. */
export async function describeWorkspaceEnvVarsForUser(ownerId: number): Promise<string> {
  const vars = await listWorkspaceEnvVarsForUser(ownerId);
  if (vars.length === 0) return "none yet - the user can add environment variables in Settings";
  return vars.map(entry => entry.name).join(", ");
}

/**
 * Resolves the env var NAMES the agent passed to deploy_website into the
 * stored name/value pairs to attach to the site. Unknown names fail with the
 * full list of known names so the model corrects itself instead of guessing.
 */
export async function resolveWorkspaceEnvVarsForUser(
  ownerId: number,
  names: string[]
): Promise<{ ok: true; vars: WorkspaceEnvVarEntry[] } | { ok: false; message: string }> {
  if (names.length === 0) return { ok: true, vars: [] };
  const stored = await listWorkspaceEnvVarsForUser(ownerId);
  const byName = new Map(stored.map(entry => [entry.name.toLowerCase(), entry]));
  const resolved: WorkspaceEnvVarEntry[] = [];
  const unknown: string[] = [];
  for (const rawName of names) {
    const match = byName.get(rawName.trim().toLowerCase());
    if (match) resolved.push(match);
    else unknown.push(rawName);
  }
  if (unknown.length > 0) {
    const known = stored.length === 0
      ? "the workspace has no environment variables yet - tell the user to add them in Settings"
      : `known environment variables: ${stored.map(entry => entry.name).join(", ")}`;
    return { ok: false, message: `Unknown environment variable name${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")} - ${known}. Pass the names exactly as saved; never invent or guess environment variable values.` };
  }
  return { ok: true, vars: resolved };
}
