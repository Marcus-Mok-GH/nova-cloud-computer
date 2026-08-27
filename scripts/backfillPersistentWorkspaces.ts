import { and, eq, isNull } from "drizzle-orm";
import { workspaces } from "../drizzle/schema";
import { getDb } from "../server/db";
import { initWorkspacePersistentVm } from "../server/daytona";

/**
 * One-time repair utility for workspaces created before universal Daytona
 * provisioning. It is safe to rerun: only rows without a recorded sandbox ID
 * are selected, and Daytona lookup uses a deterministic workspace name.
 */
async function main() {
  const db = await getDb();
  const missing = await db
    .select({ id: workspaces.id, ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(isNull(workspaces.persistentSandboxId));

  let provisioned = 0;
  let failed = 0;

  for (const workspace of missing) {
    const sandboxId = await initWorkspacePersistentVm(workspace.id, workspace.ownerId);
    if (!sandboxId) {
      failed += 1;
      console.error(`Unable to provision persistent workspace ${workspace.id}.`);
      continue;
    }

    await db
      .update(workspaces)
      .set({ persistentSandboxId: sandboxId, updatedAt: new Date() })
      .where(and(eq(workspaces.id, workspace.id), isNull(workspaces.persistentSandboxId)));
    provisioned += 1;
  }

  console.log(`Persistent workspace backfill finished: ${provisioned} provisioned, ${failed} failed, ${missing.length} examined.`);
  if (failed) process.exitCode = 1;
}

void main().catch(error => {
  console.error("Persistent workspace backfill failed.", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
