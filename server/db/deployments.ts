import { and, desc, eq, ne } from "drizzle-orm";
import { siteDeployments } from "../../drizzle/schema";
import { requireDb } from "./core";
import { getOrCreateWorkspace } from "./workspace";

export type SiteDeploymentRow = typeof siteDeployments.$inferSelect;

/** Latest website deployment for the workspace, for the live URL. Deleted
 * deployments are excluded so a taken-down site never reappears on the page. */
export async function getLatestSiteDeploymentForUser(ownerId: number) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [latest] = await db.select().from(siteDeployments)
    .where(and(eq(siteDeployments.workspaceId, workspace.id), ne(siteDeployments.status, "deleted")))
    .orderBy(desc(siteDeployments.createdAt))
    .limit(1);
  return latest ?? null;
}

/** Recent website deployments, newest first. Deleted deployments are excluded
 * so the Deployments page only shows sites that are still hosted. */
export async function listSiteDeploymentsForUser(ownerId: number, limit = 10) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  return db.select().from(siteDeployments)
    .where(and(eq(siteDeployments.workspaceId, workspace.id), ne(siteDeployments.status, "deleted")))
    .orderBy(desc(siteDeployments.createdAt))
    .limit(limit);
}

/** Marks every deployment record of one Netlify site as deleted. Returns how many rows changed. */
export async function markSiteDeploymentsDeletedForUser(ownerId: number, siteId: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.update(siteDeployments)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(and(eq(siteDeployments.siteId, siteId), eq(siteDeployments.workspaceId, workspace.id)))
    .returning({ id: siteDeployments.id });
  return rows.length;
}

/** One entry per Netlify site the workspace has ever deployed - the deployment
 * registry the agent targets sites by. Every run row of the same site carries
 * the same deploymentKey; the newest row decides the entry's status and URL. */
export type SiteDeploymentRegistryEntry = {
  key: string;
  siteId: string;
  siteName: string | null;
  siteUrl: string;
  description: string | null;
  status: "deploying" | "live" | "failed" | "deleted";
  lastDeployedAt: Date;
};

export async function listSiteDeploymentRegistryForUser(ownerId: number): Promise<SiteDeploymentRegistryEntry[]> {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  // Newest first: the first row seen per key is that deployment's latest run.
  const rows = await db.select().from(siteDeployments)
    .where(eq(siteDeployments.workspaceId, workspace.id))
    .orderBy(desc(siteDeployments.createdAt))
    .limit(500);
  const byKey = new Map<string, SiteDeploymentRegistryEntry>();
  for (const row of rows) {
    // Null keys only exist for rows a backfill could not reach; group them by site.
    const key = row.deploymentKey ?? row.siteId;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      key,
      siteId: row.siteId,
      siteName: row.siteName,
      siteUrl: row.siteUrl,
      description: row.description,
      status: row.status,
      lastDeployedAt: row.createdAt,
    });
  }
  return Array.from(byKey.values());
}

/** The registry entry for one deployment key, or null when the key is unknown. */
export async function getSiteDeploymentByKeyForUser(ownerId: number, key: string): Promise<SiteDeploymentRegistryEntry | null> {
  const registry = await listSiteDeploymentRegistryForUser(ownerId);
  return registry.find(entry => entry.key.toLowerCase() === key.trim().toLowerCase()) ?? null;
}

/** The next free deployment key for this workspace, e.g. 'd-03' after d-02. */
export async function nextSiteDeploymentKeyForUser(ownerId: number): Promise<string> {
  const registry = await listSiteDeploymentRegistryForUser(ownerId);
  let max = 0;
  for (const entry of registry) {
    const match = /^d-(\d+)$/.exec(entry.key);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `d-${String(max + 1).padStart(2, "0")}`;
}

/** Rewrites a deployment's short description on every run row that carries the key. */
export async function updateSiteDeploymentDescriptionForUser(ownerId: number, key: string, description: string) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const rows = await db.update(siteDeployments)
    .set({ description: description.slice(0, 240), updatedAt: new Date() })
    .where(and(eq(siteDeployments.deploymentKey, key), eq(siteDeployments.workspaceId, workspace.id)))
    .returning({ id: siteDeployments.id });
  return rows.length;
}

/** Records the start of a website deployment. */
export async function recordSiteDeployment(
  ownerId: number,
  input: { siteId: string; siteName: string | null; siteUrl: string; fileCount: number; status: "deploying" | "live" | "failed"; deploymentKey?: string; description?: string | null; error?: string }
) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [row] = await db.insert(siteDeployments).values({
    workspaceId: workspace.id,
    siteId: input.siteId,
    siteName: input.siteName,
    siteUrl: input.siteUrl,
    deploymentKey: input.deploymentKey,
    description: input.description ? input.description.slice(0, 240) : null,
    fileCount: input.fileCount,
    status: input.status,
    ...(input.error ? { error: input.error.slice(0, 1200) } : {}),
  }).returning();
  return row;
}

/** Marks a website deployment live or failed once Netlify finishes processing. */
export async function updateSiteDeploymentStatusForUser(
  ownerId: number,
  deploymentId: number,
  status: "live" | "failed",
  error?: string
) {
  const db = await requireDb();
  const workspace = await getOrCreateWorkspace(ownerId);
  const [row] = await db.update(siteDeployments)
    .set({ status, ...(error ? { error: error.slice(0, 1200) } : {}), updatedAt: new Date() })
    .where(and(eq(siteDeployments.id, deploymentId), eq(siteDeployments.workspaceId, workspace.id)))
    .returning();
  return row ?? null;
}
