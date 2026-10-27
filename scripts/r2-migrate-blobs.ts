/**
 * Migrate `workspace_files.content` bodies to Cloudflare R2.
 *
 * Usage: bun scripts/r2-migrate-blobs.ts [--dry-run]
 *
 * Config: R2_SECRET_ID, R2_SECRET_KEY, R2_BUCKET, R2_ACCOUNT_ID (same as storage/r2.ts).
 * --dry-run only reports what would change; it never writes.
 */
import { getDb } from "../server/db";
import { putObject } from "../server/storage/r2";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limit = 1000;

async function* streamContent() {
  const db = await getDb();
  if (!db) throw new Error("database connection failed");
  let offset = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await db
      .select({ id: "workspace_files.id", content: "workspace_files.content" })
      .from("workspace_files")
      .where({ content: "" })
      .limit(limit)
      .offset(offset);
    if (!rows.length) break;
    for (const r of rows) {
      yield { id: Number(r.id), content: r.content ?? "" };
    }
    offset += rows.length;
  }
}

async function main() {
  if (dryRun) {
    let count = 0;
    for await (const { id, content } of streamContent()) {
      console.log(`[dry-run] would offload file ${id} (${(content.length / 1024) | 0} KiB)`);
      count++;
    }
    console.log(`[dry-run] would offload ${count} files`);
    return;
  }

  let processed = 0, migrated = 0;
  for await (const { id, content } of streamContent()) {
    processed++;
    const stored = await putObject(content);
    if (!stored.storageKey) {
      console.error(`[migrate] file ${id} did not return a storage key`);
      continue;
    }
    const db = await getDb();
    await db
      .update("workspace_files")
      .set({ content: "", storageKey: stored.storageKey })
      .where({ id });
    console.log(`[migrate] offloaded file ${id} -> ${stored.storageKey}`);
    migrated++;
  }
  console.log(`[migrate] processed ${processed}; migrated ${migrated} to R2`);
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
