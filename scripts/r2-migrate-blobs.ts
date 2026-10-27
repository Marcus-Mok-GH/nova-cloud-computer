/**
 * Migrate `workspace_files.content` bodies to Cloudflare R2.
 *
 * Usage: bun scripts/r2-migrate-blobs.ts [--dry-run]
 *
 * Config: R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY -
 * the same four variables `server/storage/r2.ts` reads. The script refuses to
 * run without them: migrating with no bucket would blank every file body while
 * writing the bytes nowhere.
 *
 * `--dry-run` reports what would move and never writes.
 *
 * Rows are processed in id order in pages, and each row is rewritten only after
 * its object is durably in R2, so re-running after a failure resumes cleanly and
 * never loses a body that is still only in Postgres.
 */
import { and, eq, gt, isNull, ne, or } from "drizzle-orm";
import { workspaceFiles } from "../drizzle/schema";
import { getDb } from "../server/db";
import {
  isBlobStorageConfigured,
  putObject,
  workspaceFileKey,
} from "../server/storage/r2";

const dryRun = process.argv.includes("--dry-run");
const PAGE_SIZE = 200;

async function main() {
  if (!isBlobStorageConfigured()) {
    throw new Error(
      "R2 is not configured: set R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY"
    );
  }

  const db = await getDb();
  if (!db) throw new Error("database connection failed");

  let cursor = 0;
  let processed = 0;
  let migrated = 0;
  let failed = 0;

  for (;;) {
    const rows = await db
      .select({
        id: workspaceFiles.id,
        workspaceId: workspaceFiles.workspaceId,
        content: workspaceFiles.content,
        mimeType: workspaceFiles.mimeType,
        storageKey: workspaceFiles.storageKey,
      })
      .from(workspaceFiles)
      .where(
        and(
          gt(workspaceFiles.id, cursor),
          ne(workspaceFiles.content, ""),
          or(eq(workspaceFiles.storageKey, ""), isNull(workspaceFiles.storageKey))
        )
      )
      .orderBy(workspaceFiles.id)
      .limit(PAGE_SIZE);

    if (!rows.length) break;

    for (const row of rows) {
      cursor = row.id;
      processed++;

      const key = workspaceFileKey(row.workspaceId, row.id);
      const sizeKiB = Math.round(row.content.length / 1024);

      if (dryRun) {
        console.log(`[dry-run] would offload file ${row.id} (${sizeKiB} KiB) -> ${key}`);
        continue;
      }

      try {
        await putObject(key, row.content, row.mimeType || "application/octet-stream");
        await db
          .update(workspaceFiles)
          .set({ content: "", storageKey: key })
          .where(eq(workspaceFiles.id, row.id));
        migrated++;
        console.log(`[migrate] offloaded file ${row.id} (${sizeKiB} KiB) -> ${key}`);
      } catch (error) {
        failed++;
        console.error(
          `[migrate] file ${row.id} failed:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  if (dryRun) {
    console.log(`[dry-run] would offload ${processed} files`);
    return;
  }

  console.log(`[migrate] processed ${processed}; migrated ${migrated}; failed ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});