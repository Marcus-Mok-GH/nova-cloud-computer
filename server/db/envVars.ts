import { and, asc, eq, inArray } from "drizzle-orm";
import { envVarRequests, workspaceEnvVars } from "../../drizzle/schema";
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

/**
 * Normalizes an env var name the way storage stores it (trimmed, upper case)
 * and validates it, returning null when it is not a legal name. Shared by the
 * settings save path, the agent tool, and the request lifecycle so all three
 * agree on what a name is.
 */
export function normalizeEnvVarName(raw: string): string | null {
  const name = raw.trim().toUpperCase();
  if (!name || name.length > 128) return null;
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return null;
  return name;
}

/** Upserts one name/value pair, leaving every other variable untouched. */
async function upsertEnvVarValue(workspaceId: number, name: string, value: string): Promise<void> {
  const db = await requireDb();
  const encryptedValue = encryptPrivateCredential(value);
  const existing = await db.select({ id: workspaceEnvVars.id }).from(workspaceEnvVars)
    .where(and(eq(workspaceEnvVars.workspaceId, workspaceId), eq(workspaceEnvVars.name, name)));
  if (existing.length > 0) {
    await db.update(workspaceEnvVars)
      .set({ encryptedValue, updatedAt: new Date() })
      .where(eq(workspaceEnvVars.id, existing[0].id));
  } else {
    await db.insert(workspaceEnvVars).values({ workspaceId, name, encryptedValue });
  }
}

/**
 * Saves a single env var by name (add or replace), leaving the rest of the
 * workspace's variables untouched - the incremental counterpart to the
 * settings page's replace-everything save. Returns the saved pair, or null
 * when the name is not a legal env var name.
 */
export async function setWorkspaceEnvVarForUser(ownerId: number, rawName: string, value: string): Promise<WorkspaceEnvVarEntry | null> {
  const name = normalizeEnvVarName(rawName);
  const trimmed = value.trim();
  if (!name || !trimmed) return null;
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  await upsertEnvVarValue(workspace.id, name, trimmed);
  return { name, value: trimmed };
}

/** A pending env-var value request as the chat composer renders it: NAME only. */
export type EnvVarRequestSummary = {
  id: number;
  chatId: string | null;
  name: string;
  reason: string | null;
  createdAt: Date;
};

/** The chat's pending value requests, oldest first. Values never exist here. */
export async function listPendingEnvVarRequestsForUser(ownerId: number, chatId: string): Promise<EnvVarRequestSummary[]> {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.select().from(envVarRequests)
    .where(and(
      eq(envVarRequests.workspaceId, workspace.id),
      eq(envVarRequests.chatId, chatId),
      eq(envVarRequests.status, "pending")
    ))
    .orderBy(asc(envVarRequests.createdAt));
  return rows.map(row => ({ id: row.id, chatId: row.chatId, name: row.name, reason: row.reason, createdAt: row.createdAt }));
}

/**
 * Records the agent's request for the user to supply a value in this chat.
 * Re-requesting the same name refreshes the existing pending row instead of
 * stacking a second one, so a repeated ask never doubles the composer prompt.
 */
export async function requestWorkspaceEnvVarForUser(
  ownerId: number,
  input: { chatId: string; name: string; reason?: string | null }
): Promise<EnvVarRequestSummary | null> {
  const name = normalizeEnvVarName(input.name);
  if (!name) return null;
  const reason = (input.reason ?? "").trim().slice(0, 400) || null;
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const existing = await db.select().from(envVarRequests)
    .where(and(
      eq(envVarRequests.workspaceId, workspace.id),
      eq(envVarRequests.chatId, input.chatId),
      eq(envVarRequests.name, name),
      eq(envVarRequests.status, "pending")
    ));
  if (existing.length > 0) {
    const row = existing[0];
    if (row.reason !== reason) {
      await db.update(envVarRequests)
        .set({ reason, updatedAt: new Date() })
        .where(eq(envVarRequests.id, row.id));
    }
    return { id: row.id, chatId: row.chatId, name: row.name, reason, createdAt: row.createdAt };
  }
  const inserted = await db.insert(envVarRequests)
    .values({ workspaceId: workspace.id, chatId: input.chatId, name, reason })
    .returning();
  const row = inserted[0];
  if (!row) return null;
  return { id: row.id, chatId: row.chatId, name: row.name, reason: row.reason, createdAt: row.createdAt };
}

/**
 * Fulfils one pending request: stores the submitted value as the workspace's
 * encrypted env var and closes the request. The value goes straight into the
 * encrypted column - it is never echoed back in the result, so no caller can
 * leak it into a model turn, a chat message, or a log.
 */
export async function fulfillEnvVarRequestForUser(
  ownerId: number,
  requestId: number,
  value: string
): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, message: "Enter a value first." };
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.select().from(envVarRequests)
    .where(and(eq(envVarRequests.id, requestId), eq(envVarRequests.workspaceId, workspace.id)));
  const request = rows[0];
  if (!request) return { ok: false, message: "That request no longer exists." };
  if (request.status !== "pending") return { ok: false, message: `The request for ${request.name} was already ${request.status}.` };
  await upsertEnvVarValue(workspace.id, request.name, trimmed);
  await db.update(envVarRequests)
    .set({ status: "fulfilled", updatedAt: new Date() })
    .where(eq(envVarRequests.id, request.id));
  return { ok: true, name: request.name };
}

/** Dismisses one pending request (the user declined to provide a value). */
export async function cancelEnvVarRequestForUser(ownerId: number, requestId: number): Promise<boolean> {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.select({ id: envVarRequests.id, status: envVarRequests.status }).from(envVarRequests)
    .where(and(eq(envVarRequests.id, requestId), eq(envVarRequests.workspaceId, workspace.id)));
  const request = rows[0];
  if (!request || request.status !== "pending") return false;
  await db.update(envVarRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(envVarRequests.id, request.id));
  return true;
}

/**
 * Closes every still-pending request for a name once its value is known - the
 * agent set it directly, so the composer must stop asking for it.
 */
export async function cancelPendingEnvVarRequestsForName(ownerId: number, rawName: string): Promise<void> {
  const name = normalizeEnvVarName(rawName);
  if (!name) return;
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  await db.update(envVarRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(envVarRequests.workspaceId, workspace.id),
      eq(envVarRequests.name, name),
      eq(envVarRequests.status, "pending")
    ));
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
